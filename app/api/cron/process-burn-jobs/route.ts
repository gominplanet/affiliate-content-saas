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
import { overlayCaptionOnVideo, getLastOverlayError, type OverlayPosition, type CaptionStyle } from '@/services/cloudinary'
import { researchProductContext, composeReelCaption } from '@/lib/ig-burn'
import { publishMedia } from '@/services/instagram'
import { recordUsage } from '@/lib/ai-usage'
import { metaEnabled } from '@/lib/feature-flags'

export const maxDuration = 300

interface BurnJob {
  id: string
  user_id: string
  source_video_url: string
  caption_text: string
  style: string
  position: string
  product: string | null
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimed, error: claimErr } = await (admin as any)
    .from('ig_burn_jobs')
    .update({ status: 'processing', claimed_at: nowIso })
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .select('id,user_id,source_video_url,caption_text,style,position,product')
    .order('scheduled_at', { ascending: true })
    .limit(1)
  if (claimErr) return NextResponse.json({ error: `Claim failed: ${claimErr.message}` }, { status: 500 })

  const job: BurnJob | undefined = (claimed ?? [])[0]
  if (!job) return NextResponse.json({ ok: true, processed: 0 })

  try {
    // 1. Burn the caption.
    const burned = await overlayCaptionOnVideo(job.source_video_url, job.caption_text, {
      position: job.position as OverlayPosition,
      style: job.style as CaptionStyle,
    })
    if (!burned?.url) throw new Error(`burn failed: ${getLastOverlayError() || 'unknown'}`)
    recordUsage({ userId: job.user_id, tier: null, feature: 'instagram_burn', model: 'cloudinary', images: 1 })

    // 2. Research + compose Reel caption.
    const ctx = { userId: job.user_id, tier: null as string | null }
    const productContext = job.product ? await researchProductContext(job.product, ctx) : ''
    const reelCaption = productContext ? await composeReelCaption(productContext, ctx) : null

    // 3. Publish the Reel to the user's connected Instagram (default account).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: integ } = await (admin as any)
      .from('integrations')
      .select('instagram_user_id,instagram_access_token')
      .eq('user_id', job.user_id)
      .single()
    if (!integ?.instagram_user_id || !integ?.instagram_access_token) {
      throw new Error('Instagram not connected')
    }
    await publishMedia({
      userId: integ.instagram_user_id,
      accessToken: integ.instagram_access_token,
      mediaType: 'REELS',
      videoUrl: burned.url,
      caption: reelCaption ?? job.caption_text,
      shareToFeed: true,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('ig_burn_jobs').update({
      status: 'completed', result_url: burned.url, reel_caption: reelCaption, ig_published: true,
    }).eq('id', job.id)
    return NextResponse.json({ ok: true, processed: 1, jobId: job.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/process-burn-jobs] failed', { jobId: job.id, error: msg })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('ig_burn_jobs').update({ status: 'failed', error_message: msg.slice(0, 500) }).eq('id', job.id)
    return NextResponse.json({ ok: false, processed: 1, jobId: job.id, error: msg })
  }
}
