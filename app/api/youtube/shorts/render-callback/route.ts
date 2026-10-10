/**
 * POST /api/youtube/shorts/render-callback
 *
 * Where the ingest service reports a BACKGROUND render (lib/render-job): a clip
 * long enough that its render cannot finish inside the request that asked for
 * it. Body: { job, ok, url?, durationSeconds?, trimmed?, hook?, error? }.
 *
 * Only a render MVP started can land here: the request carries the ingest
 * secret, and the job token is signed and names the clip, its owner and the
 * render slot reserved for it. A failure marks the clip failed with a reason
 * in plain words and gives the slot back.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readRenderJob, backgroundFailureWords } from '@/lib/render-job'
import { recordUsage } from '@/lib/ai-usage'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const secret = process.env.YOUTUBE_INGEST_SECRET || ''
  if (!secret || request.headers.get('x-ingest-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({})) as {
    job?: string; ok?: boolean; url?: string; durationSeconds?: number; trimmed?: boolean; hook?: boolean; error?: string
  }
  const job = readRenderJob(body.job)
  if (!job) return NextResponse.json({ error: 'bad job' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const at = new Date().toISOString()
  const url = String(body.url || '')

  if (body.ok === true && /^https:\/\//i.test(url)) {
    const { data, error } = await sb.from('youtube_shorts')
      .update({ status: 'rendered', rendered_url: url, render_error: null, rendered_at: at, updated_at: at })
      .eq('id', job.shortId).eq('user_id', job.userId).select('id').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ ok: true, note: 'clip no longer exists' })
    recordUsage({ userId: job.userId, tier: null, feature: 'shorts_render_cost', model: 'ffmpeg-ass', images: 1 })
    return NextResponse.json({ ok: true })
  }

  // FAILED: said on the clip in plain words, and the reserved slot given back.
  await sb.from('youtube_shorts')
    .update({ status: 'failed', render_error: backgroundFailureWords(body.error), updated_at: at })
    .eq('id', job.shortId).eq('user_id', job.userId)
  if (job.reservationId) {
    try { await sb.from('ai_usage').delete().eq('id', job.reservationId).eq('user_id', job.userId) } catch { /* best-effort refund */ }
  }
  return NextResponse.json({ ok: true, failed: true })
}
