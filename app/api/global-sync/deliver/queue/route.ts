// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/global-sync/deliver/queue — the creator's pending storefront
// deliveries, for the SCOUT extension to upload into each Amazon storefront via
// the creator's logged-in Creator Hub session. Returns the localized title and
// the market's video (the dub when there is one, else the master render) plus
// the ASIN, per market not yet delivered.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { marketByDomain } from '@/lib/global-sync'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (!['pro', 'admin'].includes(tier)) return NextResponse.json({ error: 'Pro feature.' }, { status: 403 })

  // Optional ?jobId= to scope to one sync run.
  const jobId = new URL(req.url).searchParams.get('jobId') || ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  let q = sb.from('global_sync_targets')
    .select('id,job_id,domain,lang,title,description,video_url,asin,state,delivered_at')
    .eq('user_id', user.id)
    .in('state', ['localized'])
    .is('delivered_at', null)
  if (jobId) q = q.eq('job_id', jobId)
  const { data: targets } = await q

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (targets ?? []) as any[]
  if (rows.length === 0) return NextResponse.json({ ok: true, items: [] })

  // Master source video per job (the fallback when a market wasn't dubbed).
  const jobIds = Array.from(new Set(rows.map(r => r.job_id)))
  const { data: jobs } = await sb.from('global_sync_jobs').select('id,video_id').eq('user_id', user.id).in('id', jobIds)
  const videoIdByJob = new Map<string, string>()
  for (const j of (jobs ?? [])) if (j.video_id) videoIdByJob.set(j.id, j.video_id)
  const videoIds = Array.from(new Set([...videoIdByJob.values()]))
  const { data: vids } = videoIds.length
    ? await sb.from('youtube_videos').select('id,source_video_url,thumbnail_url,thumbnail_clean_url').eq('user_id', user.id).in('id', videoIds)
    : { data: [] }
  const srcByVideo = new Map<string, string>()
  const thumbByVideo = new Map<string, string>()
  const cleanThumbByVideo = new Map<string, string>()
  for (const v of (vids ?? [])) {
    if (v.source_video_url) srcByVideo.set(v.id, v.source_video_url)
    if (v.thumbnail_url) thumbByVideo.set(v.id, v.thumbnail_url)
    if (v.thumbnail_clean_url) cleanThumbByVideo.set(v.id, v.thumbnail_clean_url)
  }

  const items = rows.map(r => {
    const mkt = marketByDomain(r.domain)
    const vidId = videoIdByJob.get(r.job_id) || ''
    const masterSrc = srcByVideo.get(vidId) || null
    // Non-English storefronts get the text-free thumbnail so no English hook
    // sits on the image; English markets keep the branded (with-text) one. Fall
    // back to the text thumbnail if the clean one isn't ready yet.
    const textThumb = thumbByVideo.get(vidId) || null
    const thumb = mkt?.needsTranslation ? (cleanThumbByVideo.get(vidId) || textThumb) : textThumb
    return {
      targetId: r.id as string,
      jobId: r.job_id as string,
      domain: r.domain as string,
      market: mkt?.code || r.domain,
      country: mkt?.country || '',
      lang: r.lang as string,
      title: (r.title as string) || '',
      description: (r.description as string) || '',
      asin: (r.asin as string) || null,
      // The dubbed video for a dubbed market; otherwise the master render.
      videoUrl: (r.video_url as string) || masterSrc,
      thumbnailUrl: thumbByVideo.get(videoIdByJob.get(r.job_id) || '') || null,
    }
  }).filter(i => !!i.videoUrl && !!i.title)

  return NextResponse.json({ ok: true, items })
}
