/**
 * GET /api/blog/tiktok-post/video-meta?videoId=…[&productInput=…]
 *
 * Meta + AI caption for the direct vertical → TikTok flow (no blog post).
 *
 * Optional `productInput` — an ASIN, Amazon URL, Geniuslink, or any
 * product page URL. When present, we resolve it to title + bullets and
 * pass that into the caption generator so the hook + value line
 * reference the REAL product instead of a generic guess from the
 * video title alone.
 *
 * Resolution priority:
 *   1. Bare 10-char ASIN
 *   2. Amazon /dp/ASIN URL → extract ASIN
 *   3. Geniuslink / amzn.to / a.co short link → follow + retry
 *   4. Otherwise fetch the page meta (title only)
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

/** Best-effort product resolution. Never throws — returns null on failure
 *  and the caller falls back to "title + description only" mode. */
async function resolveProductInput(raw: string): Promise<ResolvedProduct | null> {
  const input = raw.trim()
  if (!input) return null
  // 1) bare ASIN or URL with /dp/ASIN
  let asin = extractAsin(input.toUpperCase())
  // 2) follow shortlinks
  if (!asin && /^https?:\/\//i.test(input) && /(?:geni\.us|gnz\.|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i.test(input)) {
    try {
      const resolved = await resolveFinalUrl(input)
      asin = extractAsin(resolved)
    } catch { /* fall through */ }
  }
  // 3) Amazon product fetch
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
  // 4) non-Amazon URL — surface as a "use this title" hint
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
    .select('id,title,description,instagram_video_url')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })

  const videoUrl = (video.instagram_video_url as string | null) ?? null
  if (!videoUrl) {
    return NextResponse.json({
      error: 'Upload the vertical MP4 first — go back to Vertical Videos, replace the video on this row, then come back.',
      noVideo: true,
      title: video.title,
    })
  }

  const [{ data: brand }, { data: integ }] = await Promise.all([
    sb.from('brand_profiles').select('niches,words_to_avoid,affiliate_disclaimer').eq('user_id', user.id).maybeSingle(),
    sb.from('integrations').select('tier').eq('user_id', user.id).maybeSingle(),
  ])
  const tier: Tier = normalizeTier(integ?.tier)

  // Resolve product context if the user provided one. Best-effort — the
  // caption still generates without it.
  const product = productInput ? await resolveProductInput(productInput) : null

  const result = await generateDirectCaption(
    {
      videoTitle: (video.title as string) || '',
      videoDescription: (video.description as string) || '',
      niches: Array.isArray(brand?.niches) ? (brand!.niches as string[]) : [],
      wordsToAvoid: Array.isArray(brand?.words_to_avoid) ? (brand!.words_to_avoid as string[]) : [],
      affiliateDisclaimer: (brand?.affiliate_disclaimer as string) || '',
      platform: 'tiktok',
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
    productResolved: product ? { title: product.title, asin: product.asin } : null,
  })
}
