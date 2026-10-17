// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/drop/product?asin=<ASIN or Amazon link> — the product an ASIN is,
// with its photo, so a dropped video's card can show "this is the product"
// before anything goes out (Seb, 2026-10-17: "a visual recognition. And yes,
// this is the right ASIN"). Reads Amazon's own listing; nothing is saved.
//
// A product Amazon would not show says so, and the card says it could not be
// checked rather than showing an empty box that looks like a match.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'
import { fetchAmazonProduct } from '@/services/amazon'
import { asinInText } from '@/lib/clip-product-guess'
import { isAsin } from '@/lib/product-image-label'

export const runtime = 'nodejs'
export const maxDuration = 30

/** Read once an hour per product: a card that reloads does not read Amazon again. */
const kept = new Map<string, { at: number; body: Record<string, unknown> }>()
const KEEP_MS = 60 * 60_000

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('drop', intg?.tier)) return NextResponse.json({ error: 'Drop is still being tested.' }, { status: 403 })

  const raw = (new URL(req.url).searchParams.get('asin') || '').trim()
  const asin = isAsin(raw.toUpperCase()) ? raw.toUpperCase() : asinInText(raw)
  if (!asin) return NextResponse.json({ ok: false, error: 'That is not an ASIN or an Amazon product link.' }, { status: 400 })

  const hit = kept.get(asin)
  if (hit && Date.now() - hit.at < KEEP_MS) return NextResponse.json(hit.body)
  try {
    const p = await fetchAmazonProduct(asin)
    const body = {
      ok: true, asin,
      title: p.title || null,
      imageUrl: (p.images && p.images[0]) || p.imageUrl || null,
      price: p.price ?? null,
      rating: p.rating ?? null,
      url: `https://www.amazon.com/dp/${asin}`,
    }
    if (!body.title && !body.imageUrl) return NextResponse.json({ ok: false, asin, error: 'Amazon did not show this product just now.' }, { status: 502 })
    kept.set(asin, { at: Date.now(), body })
    return NextResponse.json(body)
  } catch (e) {
    return NextResponse.json({ ok: false, asin, error: e instanceof Error && /not found|404/i.test(e.message) ? 'Amazon has no product with this ASIN.' : 'Amazon did not show this product just now.' }, { status: 502 })
  }
}
