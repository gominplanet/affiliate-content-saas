// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/video-asin?videoId=… — which Amazon product is this video about.
//
// WHY THIS IS NOT THE CREATOR'S JOB. Storefront Sync asked for a Featured ASIN
// by hand on every video, while the answer was sitting in the video's own
// description the whole time: "Check Today's Price and Availability on AMAZON
// here: https://www.mvpl.ink/2eniqan". MVP can open that link. Asking someone
// to go and read it themselves, for each of three thousand videos, is exactly
// the work this product exists to remove.
//
// CACHED ON THE VIDEO. The resolved ASIN is written to youtube_videos.asin,
// which is what migration 204 added it for, so the redirect is followed once
// and the CC badge, the back catalogue and every other ASIN-keyed feature read
// it for free afterwards.
//
// NEVER A SILENT GUESS. The response says where the ASIN came from, so the
// screen can show "found in the description" rather than quietly filling a
// required field with something the creator did not choose.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { asinFromAmazonUrl } from '@/lib/asin'
import { resolveAsinFromLinks } from '@/lib/product-link'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const videoId = (new URL(req.url).searchParams.get('videoId') || '').trim()
  if (!videoId) return NextResponse.json({ error: 'videoId is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: video } = await sb.from('youtube_videos')
    .select('id,title,description,product_url,asin')
    .eq('id', videoId).eq('user_id', user.id).maybeSingle()
  if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })

  // Already known. No network, no second opinion.
  const cached = (video.asin as string | null)?.trim()
  if (cached) return NextResponse.json({ ok: true, asin: cached.toUpperCase(), from: 'saved' })

  // The two columns, free.
  const direct = asinFromAmazonUrl(String(video.product_url ?? ''))
    || asinFromAmazonUrl(String(video.description ?? ''))
  if (direct) {
    await sb.from('youtube_videos').update({ asin: direct }).eq('id', video.id)
    return NextResponse.json({ ok: true, asin: direct, from: 'the product link' })
  }

  // Then follow whatever links are there, branded short domains included.
  const text = `${video.product_url ?? ''}\n${video.description ?? ''}`
  let found: Awaited<ReturnType<typeof resolveAsinFromLinks>> = null
  try {
    found = await resolveAsinFromLinks(text, null, 3)
  } catch {
    // A LOOKUP THAT FELL OVER IS NOT A VERDICT. Reporting it as "no product"
    // would have the creator hunting for a link that is sitting right there.
    return NextResponse.json({
      ok: true, asin: null, from: null,
      note: 'could not follow the product link just now, so type the ASIN or try again',
    })
  }

  if (!found) {
    return NextResponse.json({
      ok: true, asin: null, from: null,
      note: 'no Amazon product link in this video’s description',
    })
  }

  await sb.from('youtube_videos').update({ asin: found.asin }).eq('id', video.id)
  let host = 'the description'
  try { host = new URL(found.via).hostname.replace(/^www\./, '') } catch { /* keep the fallback */ }
  return NextResponse.json({ ok: true, asin: found.asin, from: host })
}
