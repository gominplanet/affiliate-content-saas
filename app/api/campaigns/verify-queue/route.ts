/**
 * POST /api/campaigns/verify-queue
 *
 * Probes every campaign currently in the user's queue against Amazon and
 * deletes the ones whose ASIN now returns 404 (delisted). Companion to
 * the auto-prune that fires during carousel-video searches — this one
 * handles items the user queued BEFORE the auto-prune existed, OR items
 * that were live at queue time but got delisted afterward.
 *
 * Uses the same probeCarouselVideo helper as the live filter (3-attempt
 * retry chain w/ Google referer + mobile fallback) so a transient bot
 * challenge doesn't wrongly delete a live product. Only the 'not-found'
 * verdict drives deletion; anything ambiguous (bot-challenge,
 * fetch-failed) is left alone for the next verify call.
 *
 * Also de-queues by hitting /api/campaigns/delete internally for each
 * dead one — that path already handles cleaning up the linked
 * blog_posts row + the WP post if any.
 *
 * Returns:
 *   { probed, deleted, deletedAsins, ambiguous, errors }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createWordPressService } from '@/services/wordpress'
import { probeCarouselVideo } from '@/services/amazon'

export const runtime = 'nodejs'
// 100 items / 10 parallel = ~10 batches; each batch worst-case 3 attempts
// × 8s = 24s, plus DB cleanup. 120s gives plenty of headroom.
export const maxDuration = 120

function slugFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '')
    const seg = path.split('/').filter(Boolean).pop()
    return seg ? decodeURIComponent(seg) : null
  } catch {
    return null
  }
}

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()

    // Load every queued campaign. Cap at 200 to bound the verify pass —
    // anyone with >200 queued has bigger problems than dead links.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: campaigns, error: listErr } = await (admin as any)
      .from('campaigns')
      .select('id, asin, blog_post_id, wordpress_url')
      .eq('user_id', user.id)
      .limit(200)
    if (listErr) {
      return NextResponse.json({ error: `Couldn't load your queue: ${listErr.message}` }, { status: 500 })
    }
    const rows = (campaigns ?? []) as Array<{ id: string; asin: string; blog_post_id: string | null; wordpress_url: string | null }>
    if (rows.length === 0) {
      return NextResponse.json({ probed: 0, deleted: 0, deletedAsins: [], ambiguous: 0, errors: [] })
    }

    // Pre-load the user's WP credentials once so we can clean up the
    // WordPress post during deletion (mirror of /api/campaigns/delete).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: wpRow } = await supabase
      .from('integrations')
      .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wp = wpRow as any
    const wpService = wp?.wordpress_url
      ? createWordPressService(
          wp.wordpress_url,
          wp.wordpress_username,
          wp.wordpress_app_password,
          wp.wordpress_api_token || undefined,
        )
      : null

    // Probe in 10-wide chunks. Same chunk size the carousel-filter
    // search uses, so we're consistent with the existing rate-limit
    // ceiling against Amazon.
    const CHUNK = 10
    const deletedIds: string[] = []
    const deletedAsins: string[] = []
    let ambiguous = 0
    const errors: string[] = []
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK)
      const verdicts = await Promise.all(batch.map(r => probeCarouselVideo(r.asin)))
      // Tag each row with its verdict, then delete the not-found ones.
      // Other verdicts (has-video / no-video / bot-challenge / fetch-failed)
      // get left alone — bot-challenge in particular is ambiguous and we
      // never want to delete a live product because Amazon temporarily
      // blocked us.
      for (let j = 0; j < batch.length; j++) {
        const row = batch[j]
        const verdict = verdicts[j]
        if (verdict === 'not-found') {
          // Best-effort WP cleanup first (mirrors /api/campaigns/delete).
          if (wpService) {
            try {
              let wpPostId: number | null = null
              if (row.blog_post_id) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: postRow } = await (admin as any)
                  .from('blog_posts').select('wordpress_post_id')
                  .eq('id', row.blog_post_id).eq('user_id', user.id).single()
                wpPostId = postRow?.wordpress_post_id ?? null
              }
              if (!wpPostId) {
                const slug = slugFromUrl(row.wordpress_url)
                if (slug) wpPostId = await wpService.getPostIdBySlug(slug)
              }
              if (wpPostId) await wpService.deletePost(wpPostId)
            } catch (e) {
              errors.push(`${row.asin}: WP cleanup failed (${e instanceof Error ? e.message : 'unknown'}) — campaign row still deleted`)
            }
          }
          if (row.blog_post_id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any).from('blog_posts').delete().eq('id', row.blog_post_id).eq('user_id', user.id)
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: delErr } = await (admin as any)
            .from('campaigns').delete().eq('id', row.id).eq('user_id', user.id)
          if (delErr) {
            errors.push(`${row.asin}: campaign row delete failed (${delErr.message})`)
            continue
          }
          deletedIds.push(row.id)
          deletedAsins.push(row.asin)
        } else if (verdict === 'bot-challenge' || verdict === 'fetch-failed') {
          ambiguous++
        }
      }
    }

    return NextResponse.json({
      probed: rows.length,
      deleted: deletedIds.length,
      deletedAsins,
      // ambiguous count tells the user "we couldn't reach Amazon for N
      // items, click Verify again later to recheck them". Critical so
      // users don't think the button silently failed.
      ambiguous,
      errors,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
