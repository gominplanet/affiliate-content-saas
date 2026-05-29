/**
 * GET /api/blog/tiktok-post/video-meta?videoId=… — meta for the DIRECT
 * vertical → TikTok flow (no blog post involved).
 *
 * Inputs:
 *   videoId  uuid of youtube_videos row
 *
 * Returns:
 *   { title, videoUrl, defaultCaption }
 *
 * Caption is generated fresh via Haiku — combines the YT video title +
 * description with the creator's niches + affiliate disclaimer. See
 * lib/direct-caption.ts for the platform-aware rules.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { generateDirectCaption } from '@/lib/direct-caption'
import { normalizeTier, type Tier } from '@/lib/tier'

export const maxDuration = 60

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const videoId = (searchParams.get('videoId') || '').trim()
  if (!videoId) return NextResponse.json({ error: 'videoId is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: video } = await sb
    .from('youtube_videos')
    .select('id,title,description,instagram_video_url')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })

  const videoUrl = (video.instagram_video_url as string | null) ?? null
  if (!videoUrl) {
    return NextResponse.json({
      error: 'Upload the vertical MP4 first — go back to Vertical Videos, click "Upload product photo" / replace the video on this row, then come back.',
      noVideo: true,
      title: video.title,
    })
  }

  // ── Brand voice + caption generation ──────────────────────────────────────
  const [{ data: brand }, { data: integ }] = await Promise.all([
    sb.from('brand_profiles').select('niches,words_to_avoid,affiliate_disclaimer').eq('user_id', user.id).maybeSingle(),
    sb.from('integrations').select('tier').eq('user_id', user.id).maybeSingle(),
  ])
  const tier: Tier = normalizeTier(integ?.tier)

  const result = await generateDirectCaption(
    {
      videoTitle: (video.title as string) || '',
      videoDescription: (video.description as string) || '',
      niches: Array.isArray(brand?.niches) ? (brand!.niches as string[]) : [],
      wordsToAvoid: Array.isArray(brand?.words_to_avoid) ? (brand!.words_to_avoid as string[]) : [],
      affiliateDisclaimer: (brand?.affiliate_disclaimer as string) || '',
      platform: 'tiktok',
    },
    { userId: user.id, tier },
  )

  return NextResponse.json({
    title: video.title,
    videoUrl,
    defaultCaption: result.caption,
    hashtags: result.hashtags,
    hook: result.hook,
  })
}
