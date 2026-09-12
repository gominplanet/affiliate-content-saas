/**
 * GET /api/cron/process-amazon-schedules
 *
 * Vercel cron worker (every minute). Publishes due Amazon Influencer social
 * posts scheduled from the Social Influencer composer (amazon_scheduled_posts).
 * Pinterest is live; IG/FB rows are left pending until those composers ship.
 *
 * Auth: Vercel cron requests carry `Authorization: Bearer ${CRON_SECRET}`.
 * Concurrency: an atomic UPDATE claims pending+due rows to 'processing' first.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier, type Tier } from '@/lib/tier'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { publishAmazonPin } from '@/lib/amazon-pin-publish'
import { publishToInstagram, publishToFacebook, type SocialIntegration } from '@/lib/amazon-social-publish'

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_PER_TICK = 15

interface Row {
  id: string
  user_id: string
  platform: string
  image_url: string
  asin: string | null
  product_url: string | null
  product_title: string | null
  board_id: string | null
  title: string | null
  description: string | null
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set on server' }, { status: 500 })
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()
  const nowIso = new Date().toISOString()

  // Stuck-claim recovery: rows stuck 'processing' >5 min → reclaimed for another
  // try, but with an attempt cap so a row that keeps outliving the function's
  // wall-clock is terminal-failed instead of re-claimed/re-billed forever
  // (migration 248). Best-effort: if the RPC/column isn't live yet the tick
  // still proceeds to the claim below.
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
  const { error: reclaimErr } = await admin.rpc('reclaim_stuck_scheduled_posts', {
    p_table: 'amazon_scheduled_posts',
    p_stuck_before: fiveMinAgo,
    p_max_attempts: 3,
  })
  if (reclaimErr) console.error('[cron/process-amazon-schedules] reclaim failed', reclaimErr.message)

  // Atomic claim of due + pending rows. Only platforms we can publish today.
  const { data: claimed, error: claimErr } = await admin
    .from('amazon_scheduled_posts')
    .update({ status: 'processing', claimed_at: nowIso, updated_at: nowIso })
    .eq('status', 'pending')
    .in('platform', ['pinterest', 'instagram', 'facebook'])
    .lte('scheduled_at', nowIso)
    .select('id,user_id,platform,image_url,asin,product_url,product_title,board_id,title,description')
    .limit(MAX_PER_TICK)
  if (claimErr) return NextResponse.json({ error: `Claim failed: ${claimErr.message}` }, { status: 500 })
  const rows = (claimed ?? []) as Row[]
  if (rows.length === 0) return NextResponse.json({ ok: true, processed: 0 })

  const results = await Promise.allSettled(rows.map(async (row) => {
    try {
      const { data: intRaw } = await admin
        .from('integrations')
        .select('tier,user_id,pinterest_access_token,pinterest_board_id,pinterest_pin_target,instagram_user_id,instagram_access_token,facebook_page_id,facebook_page_access_token,geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
        .eq('user_id', row.user_id).maybeSingle()
      const intRow = decryptIntegrationRow(intRaw) as (SocialIntegration & { tier?: string }) | null
      const tier = normalizeTier(intRow?.tier) as Tier
      if (!intRow) throw new Error('No integration row at post time.')

      let externalId = ''
      let externalUrl = ''
      let note: string | null = null
      if (row.platform === 'instagram') {
        const out = await publishToInstagram({
          db: admin, userId: row.user_id, tier, intRow,
          imageUrl: row.image_url, asin: row.asin ?? undefined, productUrl: row.product_url ?? undefined,
          productTitle: row.product_title ?? undefined, caption: row.description ?? undefined,
        })
        externalId = out.id; externalUrl = out.url; note = out.note
      } else if (row.platform === 'facebook') {
        const out = await publishToFacebook({
          userId: row.user_id, tier, intRow,
          imageUrl: row.image_url, asin: row.asin ?? undefined, productUrl: row.product_url ?? undefined,
          productTitle: row.product_title ?? undefined, caption: row.description ?? undefined,
        })
        externalId = out.id; externalUrl = out.url; note = out.note
      } else {
        if (!intRow.pinterest_access_token) throw new Error('Pinterest not connected at post time.')
        const out = await publishAmazonPin({
          userId: row.user_id, tier, intRow,
          imageUrl: row.image_url, asin: row.asin ?? undefined, productUrl: row.product_url ?? undefined,
          productTitle: row.product_title ?? undefined, boardId: row.board_id ?? undefined,
          title: row.title ?? undefined, description: row.description ?? undefined,
        })
        externalId = out.pinId; externalUrl = out.pinUrl; note = out.geniuslinkNote
      }
      // The note goes in `note`, not `error_message`. It means the post DID go
      // out and something about it is worth reading (the link was substituted),
      // which is a different thing from a failure and has to look different in
      // the queue.
      //
      // Two writes on purpose. `note` ships in migration 329; on a database
      // where that has not run, naming it would make PostgREST reject the whole
      // update and leave the row stuck in 'processing' forever — a published
      // post the queue reports as still pending, and the cron would never claim
      // it again. So the status write names only columns that have always
      // existed, and the note is a separate best-effort write after it.
      await admin.from('amazon_scheduled_posts').update({
        status: 'completed', external_id: externalId, external_url: externalUrl,
        error_message: null, updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      if (note) {
        const { error: noteErr } = await admin.from('amazon_scheduled_posts')
          .update({ note }).eq('id', row.id)
        // Log it rather than swallow it: a missing column here means every
        // substituted link is invisible again, which is the thing this is for.
        if (noteErr) console.error('[cron/process-amazon-schedules] note not stored (run migration 329?)', { id: row.id, error: noteErr.message, note })
      }
      return { id: row.id, status: 'completed' as const }
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500)
      console.error('[cron/process-amazon-schedules] publish failed', { id: row.id, error: msg })
      await admin.from('amazon_scheduled_posts').update({
        status: 'failed', error_message: msg, updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      return { id: row.id, status: 'failed' as const }
    }
  }))

  const flat = results.map((r) => r.status === 'fulfilled' ? r.value : { id: 'unknown', status: 'failed' as const })
  return NextResponse.json({ ok: true, processed: rows.length, results: flat })
}
