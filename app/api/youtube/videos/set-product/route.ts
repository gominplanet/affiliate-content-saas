/**
 * POST /api/youtube/videos/set-product
 *   { videoId: string, link: string }   link = an Amazon product URL or a bare ASIN
 *
 * Lets a creator CONFIRM/CORRECT the product a video is about when MVP detected
 * the wrong one. It resolves the pasted link (following geni.us / short links to
 * the real Amazon destination), reads the true product (title + clean photo),
 * and stores product_url / product_image_url / product_title on the video.
 *
 * Every downstream generator (blog, pins, thumbnails) already reads those three
 * fields, so one correction here fixes the "wrong product" everywhere at once.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAmazonProduct, extractAsin } from '@/services/amazon'
import { asinFromAmazonUrl } from '@/lib/product-link'
import { resolveTrueDestination } from '@/lib/affiliate-resolve'
import { pickProductReferenceImage } from '@/lib/product-image'
import { checkedWrite } from '@/lib/db-error'

export const maxDuration = 30

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { videoId?: string; link?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const videoId = (body.videoId || '').trim()
  const link = (body.link || '').trim()
  if (!videoId || !link) return NextResponse.json({ error: 'videoId and link are required' }, { status: 400 })

  // Accept the DB uuid (content page) OR the YouTube video id (co-pilot). Resolve
  // to the canonical row for this user so the write below is unambiguous.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(videoId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vid } = await (supabase as any)
    .from('youtube_videos').select('id')
    .eq(isUuid ? 'id' : 'youtube_video_id', videoId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!vid) return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  const rowId = vid.id as string

  // Resolve the ASIN: straight from the URL/ASIN, else follow the link to its
  // true Amazon destination (geni.us, amzn.to, a.co…) and read it there.
  let asin = asinFromAmazonUrl(link) || extractAsin(link.toUpperCase())
  if (!asin) {
    try {
      const finalUrl = await resolveTrueDestination(link)
      asin = asinFromAmazonUrl(finalUrl) || extractAsin(finalUrl.toUpperCase())
    } catch { /* couldn't unwrap */ }
  }
  if (!asin) {
    return NextResponse.json({
      error: 'Could not read an Amazon product from that link. Paste the product page URL or its 10-character ASIN.',
    }, { status: 422 })
  }

  let title: string
  let imageUrl: string | null
  try {
    const prod = await fetchAmazonProduct(asin)
    title = prod.title
    const picked = await pickProductReferenceImage(prod.images, prod.title, { userId: user.id })
    imageUrl = (typeof picked === 'string' ? picked : null) || prod.imageUrl || null
  } catch {
    return NextResponse.json({ error: 'Couldn’t load that product from Amazon. Try again in a moment.' }, { status: 502 })
  }

  const ok = await checkedWrite('youtube.videos.set-product',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('youtube_videos').update({
      product_url: `https://www.amazon.com/dp/${asin}`,
      ...(imageUrl ? { product_image_url: imageUrl } : {}),
      product_title: title,
    }).eq('id', rowId).eq('user_id', user.id),
    { userId: user.id, videoId: rowId, asin })
  if (!ok) return NextResponse.json({ error: 'Could not save the product. Try again.' }, { status: 500 })

  return NextResponse.json({ ok: true, asin, title, imageUrl })
}
