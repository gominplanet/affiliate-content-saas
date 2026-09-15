/**
 * GET /api/cron/process-burn-jobs
 *
 * Vercel cron worker for the Instagram Burner batch queue. Claims ONE due
 * pending ig_burn_jobs row per tick (each burn+publish can take ~2-3 min, so we
 * keep it to one within the 300s budget), burns the caption into the video,
 * composes the Reel caption from the product, publishes the Reel to the user's
 * Instagram, and marks the row completed/failed.
 *
 * Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { maybeDecrypt } from '@/lib/secrets'
import { overlayCaptionOnVideo, getLastOverlayError, type OverlayPosition, type CaptionStyle } from '@/services/cloudinary'
import { researchProductContext, composeReelCaption } from '@/lib/ig-burn'
import { publishMedia } from '@/services/instagram'
import { recordReachSample } from '@/lib/reach-pulse'
import { recordUsage } from '@/lib/ai-usage'
import { checkSpendCeiling } from '@/lib/ai-spend'
import { metaEnabled } from '@/lib/feature-flags'
import { alertOps } from '@/lib/ops-alert'

export const maxDuration = 300

interface BurnJob {
  id: string
  user_id: string
  source_video_url: string
  caption_text: string
  style: string
  position: string
  sticker_url: string | null
  product: string | null
  sticker_duration_sec: number | null
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Meta integration paused (App Review pending) — don't burn/publish any queued jobs.
  if (!metaEnabled()) return NextResponse.json({ ok: true, processed: 0, skipped: 'meta_disabled' })

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  // Atomic claim of one due job.
  //
  // select('*'), NOT a named column list, and that is the whole point.
  //
  // PostgREST rejects the ENTIRE statement with a 400 when one named column is
  // missing. This claim used to name seven, so a single unapplied migration
  // 400'd the PATCH, 500'd the route, and halted every burn job on every tick
  // forever — silently, because a cron has no user watching it. Observed in
  // production on 2026-09-14 at 10:07: PATCH 400 in 55ms, route 500 in 64ms,
  // repeating on the schedule.
  //
  // The comment that used to sit here shows the same trap was already hit once,
  // for sticker_url (migration 139) and sticker_duration_sec (174), and fixed
  // by removing those two names from the list. That fixed the two columns that
  // had broken and left the other seven loaded. A star select cannot be broken
  // by the next column anybody adds.
  //
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimed, error: claimErr } = await admin
    .from('ig_burn_jobs')
    .update({ status: 'processing', claimed_at: nowIso })
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .select('*')
    .order('scheduled_at', { ascending: true })
    .limit(1)
  if (claimErr) {
    // A schema fault halts the whole queue and repeats until somebody looks at
    // Vercel logs, which is the failure mode that hid this for a day. Page ops
    // and say which fault it is, rather than returning a bare 500 forever.
    const schemaFault = /column|schema cache|PGRST2\d\d/i.test(claimErr.message || '')
    void alertOps(
      schemaFault ? 'Burn queue halted — schema fault on the job claim' : 'Burn queue halted — claim failed',
      `ig_burn_jobs claim failed: ${claimErr.message}${schemaFault ? '\n\nThis looks like a missing column. Every queued Shop Burner job is stuck until the migration is applied.' : ''}`,
    )
    return NextResponse.json({ error: `Claim failed: ${claimErr.message}`, schemaFault }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const job: BurnJob | undefined = ((claimed ?? []) as any[])[0] as BurnJob | undefined
  if (!job) return NextResponse.json({ ok: true, processed: 0 })

  // Sticker fields (migrations 139/174), fetched separately so a missing
  // migration can't take down the claim. Absent columns → no sticker, job still runs.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sticker } = await (admin as any).from('ig_burn_jobs').select('sticker_url,sticker_duration_sec').eq('id', job.id).maybeSingle()
    if (sticker) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(job as any).sticker_url = sticker.sticker_url ?? null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(job as any).sticker_duration_sec = sticker.sticker_duration_sec ?? null
    }
  } catch { /* columns absent → no sticker overlay */ }

  try {
    // 0. Check the destination FIRST. This read used to sit after the burn and
    //    the two LLM calls, so a job for a user without Instagram connected
    //    paid for a full Cloudinary render plus product research plus caption
    //    composition — tens of seconds and real money — only to throw
    //    'Instagram not connected' at the end. Hoisting it turns that into an
    //    instant, free failure.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: integ } = await admin
      .from('integrations')
      .select('instagram_user_id,instagram_access_token,tier')
      .eq('user_id', job.user_id)
      .single()
    const igUserId = integ?.instagram_user_id as string | undefined
    const igToken = maybeDecrypt(integ?.instagram_access_token) as string | undefined
    if (!igUserId || !igToken) {
      throw new Error('Instagram not connected')
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tier = ((integ as any)?.tier as string | null) ?? null

    // Per-user AI-spend ceiling — a burn is a paid Cloudinary render + 2 LLM
    // calls, so an over-ceiling account must not keep burning. Fail the job with
    // a clear message (rather than loop it) — the ceiling resets on the 1st.
    const spend = await checkSpendCeiling(job.user_id, tier)
    if (!spend.allowed) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await admin.from('ig_burn_jobs').update({ status: 'failed', error_message: 'Monthly usage limit reached — resets on the 1st. Re-queue after that.' }).eq('id', job.id)
      return NextResponse.json({ ok: true, processed: 0, skipped: 'over_spend_ceiling', jobId: job.id })
    }

    // 1. Burn the overlay — a CTA box sticker (PNG) when set, else the caption
    //    text. Matches the single-video burner: sticker mode passes an empty
    //    caption + the sticker URL; caption mode passes the text.
    const burnDurationSec = job.sticker_duration_sec ?? 0
    const burned = job.sticker_url
      ? await overlayCaptionOnVideo(job.source_video_url, '', {
          position: job.position as OverlayPosition,
          style: job.style as CaptionStyle,
          stickerUrl: job.sticker_url,
          stickerWidthPct: 0.55,
          stickerDurationSec: burnDurationSec,
        })
      : await overlayCaptionOnVideo(job.source_video_url, job.caption_text, {
          position: job.position as OverlayPosition,
          style: job.style as CaptionStyle,
          stickerDurationSec: burnDurationSec,
        })
    if (!burned?.url) throw new Error(`burn failed: ${getLastOverlayError() || 'unknown'}`)
    recordUsage({ userId: job.user_id, tier, feature: 'instagram_burn', model: 'cloudinary', images: 1 })

    // 2. Research + compose Reel caption.
    const ctx = { userId: job.user_id, tier }
    const productContext = job.product ? await researchProductContext(job.product, ctx) : ''
    const reelCaption = productContext ? await composeReelCaption(productContext, ctx) : null

    // 3. Publish the Reel to the user's connected Instagram (default account).
    //    Credentials were resolved in step 0.
    const reelMediaId = await publishMedia({
      userId: igUserId,
      accessToken: igToken,
      mediaType: 'REELS',
      videoUrl: burned.url,
      caption: reelCaption ?? job.caption_text,
      shareToFeed: true,
    })

    // Pulse: learn which tags this Reel used (best-effort, non-blocking).
    void recordReachSample({
      userId: job.user_id,
      mediaId: reelMediaId,
      caption: reelCaption ?? job.caption_text,
      productText: productContext || null,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await admin.from('ig_burn_jobs').update({
      status: 'completed', result_url: burned.url, reel_caption: reelCaption, ig_published: true,
    }).eq('id', job.id)
    return NextResponse.json({ ok: true, processed: 1, jobId: job.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/process-burn-jobs] failed', { jobId: job.id, error: msg })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await admin.from('ig_burn_jobs').update({ status: 'failed', error_message: msg.slice(0, 500) }).eq('id', job.id)
    return NextResponse.json({ ok: false, processed: 1, jobId: job.id, error: msg })
  }
}
