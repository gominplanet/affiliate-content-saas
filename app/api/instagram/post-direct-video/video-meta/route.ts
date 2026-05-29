/**
 * GET /api/instagram/post-direct-video/video-meta?videoId=… — meta + AI
 * caption for the direct vertical → IG flow (no blog post needed).
 *
 * Returns the rendered 9:16 video URL plus a caption generated fresh via
 * Haiku (lib/direct-caption.ts, instagram-tuned: 8 niche hashtags +
 * affiliate disclaimer baked in).
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
    .select('id,title,description,instagram_video_url,instagram_reel_id,instagram_story_id')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })

  const videoUrl = (video.instagram_video_url as string | null) ?? null
  if (!videoUrl) {
    return NextResponse.json({
      error: 'No vertical MP4 yet — upload one for this Short first.',
      noVideo: true,
      title: video.title,
    })
  }

  const [{ data: brand }, { data: integ }] = await Promise.all([
    sb.from('brand_profiles').select('niches,words_to_avoid,affiliate_disclaimer').eq('user_id', user.id).maybeSingle(),
    sb.from('integrations').select('tier,instagram_username').eq('user_id', user.id).maybeSingle(),
  ])
  const tier: Tier = normalizeTier(integ?.tier)

  const result = await generateDirectCaption(
    {
      videoTitle: (video.title as string) || '',
      videoDescription: (video.description as string) || '',
      niches: Array.isArray(brand?.niches) ? (brand!.niches as string[]) : [],
      wordsToAvoid: Array.isArray(brand?.words_to_avoid) ? (brand!.words_to_avoid as string[]) : [],
      affiliateDisclaimer: (brand?.affiliate_disclaimer as string) || '',
      platform: 'instagram',
    },
    { userId: user.id, tier },
  )

  return NextResponse.json({
    title: video.title,
    videoUrl,
    defaultCaption: result.caption,
    hashtags: result.hashtags,
    hook: result.hook,
    igUsername: integ?.instagram_username || '',
    alreadyReelPosted: !!video.instagram_reel_id,
    alreadyStoryPosted: !!video.instagram_story_id,
  })
}
