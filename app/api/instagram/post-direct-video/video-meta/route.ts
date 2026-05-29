/**
 * GET /api/instagram/post-direct-video/video-meta?videoId=…[&productInput=…]
 *
 * Meta + AI caption for the direct vertical → IG flow (no blog post).
 *
 * Optional `productInput` — ASIN, Amazon URL, Geniuslink, or any product
 * page URL. When present we resolve it (Amazon scrape preferred) and
 * pass structured product info into the caption generator so the hook
 * + value lines cite a REAL product instead of guessing from the title.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { generateDirectCaption } from '@/lib/direct-caption'
import { normalizeTier, type Tier } from '@/lib/tier'
import { fetchAmazonProduct, extractAsin } from '@/services/amazon'
import { resolveFinalUrl } from '@/lib/product-link'

export const maxDuration = 60

interface ResolvedProduct {
  title: string
  bullets: string[]
  asin: string | null
}

async function resolveProductInput(raw: string): Promise<ResolvedProduct | null> {
  const input = raw.trim()
  if (!input) return null
  let asin = extractAsin(input.toUpperCase())
  if (!asin && /^https?:\/\//i.test(input) && /(?:geni\.us|gnz\.|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i.test(input)) {
    try {
      const resolved = await resolveFinalUrl(input)
      asin = extractAsin(resolved)
    } catch { /* fall through */ }
  }
  if (asin) {
    try {
      const p = await fetchAmazonProduct(asin)
      return {
        title: p.title || '',
        bullets: Array.isArray(p.bullets) ? p.bullets.slice(0, 5) : [],
        asin,
      }
    } catch { /* fall through */ }
  }
  if (/^https?:\/\//i.test(input)) {
    return { title: input, bullets: [], asin: null }
  }
  return null
}

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const videoId = (searchParams.get('videoId') || '').trim()
  const productInput = (searchParams.get('productInput') || '').trim().slice(0, 500)
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

  const product = productInput ? await resolveProductInput(productInput) : null

  const result = await generateDirectCaption(
    {
      videoTitle: (video.title as string) || '',
      videoDescription: (video.description as string) || '',
      niches: Array.isArray(brand?.niches) ? (brand!.niches as string[]) : [],
      wordsToAvoid: Array.isArray(brand?.words_to_avoid) ? (brand!.words_to_avoid as string[]) : [],
      affiliateDisclaimer: (brand?.affiliate_disclaimer as string) || '',
      platform: 'instagram',
      ...(product ? { product: { title: product.title, bullets: product.bullets, asin: product.asin } } : {}),
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
    productResolved: product ? { title: product.title, asin: product.asin } : null,
  })
}
