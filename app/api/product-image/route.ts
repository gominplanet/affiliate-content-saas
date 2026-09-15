/**
 * /api/product-image — the approved image for one product.
 *
 *   GET    ?asin=B0XXXXXXXX   → { image: {...} | null }
 *   POST   { asin, imageUrl | imageDataUri, source?, surface?, modelUsed? }
 *   DELETE ?asin=B0XXXXXXXX   → forget it
 *
 * Read by every composer that can post a product (Deal Radar quick post, the
 * Amazon post + pin composers) so a creator who already made or uploaded art
 * for an ASIN is offered it back instead of starting over. See
 * lib/product-image-memory for why this is a pointer and not a cache.
 *
 * POST always stores OUR OWN copy of the bytes. The URL handed in is usually a
 * fal.media result that expires, and an image that vanishes in a month is
 * worse than no memory at all.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { assertPublicHttpUrl, SsrfBlocked } from '@/lib/ssrf-guard'
import {
  rememberProductImage, recallProductImage, parseImageDataUri, isAsin,
  type ProductImageSource,
} from '@/lib/product-image-memory'

export const runtime = 'nodejs'
export const maxDuration = 30

/** Refuse anything that would be a silly thing to keep forever. */
const MAX_BYTES = 8 * 1024 * 1024

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const asin = (new URL(request.url).searchParams.get('asin') || '').trim().toUpperCase()
  if (!isAsin(asin)) return NextResponse.json({ image: null })

  const image = await recallProductImage(supabase, user.id, asin)
  return NextResponse.json({ image })
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as {
      asin?: string; imageUrl?: string; imageDataUri?: string
      source?: string; surface?: string; modelUsed?: string
    }
    const asin = (body.asin || '').trim().toUpperCase()
    if (!isAsin(asin)) return NextResponse.json({ error: 'A valid ASIN is required.' }, { status: 400 })

    const source: ProductImageSource = body.source === 'upload' ? 'upload' : 'generated'
    const raw = (body.imageDataUri || body.imageUrl || '').trim()
    if (!raw) return NextResponse.json({ error: 'An image is required.' }, { status: 400 })

    let buffer: Buffer
    let mimeType: string

    const asData = parseImageDataUri(raw)
    if (asData) {
      buffer = asData.buffer
      mimeType = asData.mimeType
    } else if (/^https?:\/\//i.test(raw)) {
      // The URL comes from a request body, so it could point anywhere. Same
      // guard the YouTube thumbnail resolver uses, including a re-check after
      // redirects in case a public host 30x's into private space.
      try {
        assertPublicHttpUrl(raw)
      } catch (e) {
        if (e instanceof SsrfBlocked) return NextResponse.json({ error: 'That image URL was rejected.' }, { status: 400 })
        throw e
      }
      const res = await fetch(raw, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (MVP Affiliate)' },
      })
      if (res.url && res.url !== raw) {
        try { assertPublicHttpUrl(res.url) } catch { return NextResponse.json({ error: 'That image URL was rejected.' }, { status: 400 }) }
      }
      if (!res.ok) return NextResponse.json({ error: `Could not read that image (${res.status}).` }, { status: 502 })
      buffer = Buffer.from(await res.arrayBuffer())
      mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
      if (!mimeType.startsWith('image/')) mimeType = 'image/jpeg'
    } else {
      return NextResponse.json({ error: "That wasn't an image URL or a data URI." }, { status: 400 })
    }

    if (buffer.byteLength === 0) return NextResponse.json({ error: 'That image was empty.' }, { status: 400 })
    if (buffer.byteLength > MAX_BYTES) return NextResponse.json({ error: 'That image is too large to keep.' }, { status: 413 })

    const imageUrl = await rememberProductImage({
      db: supabase, userId: user.id, asin, buffer, mimeType, source,
      surface: (body.surface || '').trim() || null,
      modelUsed: (body.modelUsed || '').trim() || null,
    })
    // Say which it was. A caller that got { ok: true } for a write that did not
    // happen is exactly the "reported the plan, not the result" failure the
    // repo has been bitten by before.
    if (!imageUrl) return NextResponse.json({ ok: false, error: "Couldn't save that image for reuse." }, { status: 500 })
    return NextResponse.json({ ok: true, imageUrl })
  } catch (err) {
    console.error('[product-image]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Couldn't save that image for reuse." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const asin = (new URL(request.url).searchParams.get('asin') || '').trim().toUpperCase()
  if (!isAsin(asin)) return NextResponse.json({ error: 'A valid ASIN is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('product_images')
    .delete().eq('user_id', user.id).eq('asin', asin)
  if (error) return NextResponse.json({ error: "Couldn't forget that image." }, { status: 500 })
  return NextResponse.json({ ok: true })
}
