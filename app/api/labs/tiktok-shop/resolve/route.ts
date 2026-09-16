// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/labs/tiktok-shop/resolve — paste a TikTok Shop product link, get
// the product back and save it.
//
//   body: { url }            -> { ok, product, saved }
//   GET                      -> { ok, products }
//   DELETE  body: { id }     -> { ok }
//
// WHY THIS IS A PASTE AND NOT A SCAN. A TikTok showcase has no web page: the
// share link 302s to snssdk1180://ec/showcase, an in-app mini program, and
// TikTok's public web profile does not carry a commerce flag at all (an account
// with fifty live products reports commerceUser:false). So there is nothing for
// a server or a browser extension to crawl. An individual product page is the
// opposite: shop.tiktok.com/<region>/pdp/<id> answers 200 from a datacenter IP
// with no login and carries title, price, rating, reviews, units sold, seller
// and a 1200px image. The catalogue is therefore built one product at a time,
// from the link the creator already has.
//
// TWO THINGS THAT COST REAL MONEY IF THEY GO WRONG:
//
//   1. The pasted link is stored VERBATIM. It carries _t / u_code and the rest
//      of TikTok's share attribution, and that is what credits the sale to the
//      creator. The clean /pdp/<id> URL is kept separately and is only ever
//      used to re-read the page. Nothing user-facing may link to it.
//
//   2. Region. TikTok Shop serves a real page to a supported region and a wall
//      to everyone else, so this route reports WHICH it got rather than saving
//      a half-read product. If the deployment region is not a TikTok Shop one,
//      every resolve fails the same way and the message has to say so, because
//      the creator's own browser fails identically and they will assume the
//      link is broken.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { canSeeNav } from '@/lib/feature-access'
import { fetchWithTimeout, DEFAULT_TIMEOUT_MS } from '@/lib/fetch-timeout'
import {
  parseTikTokProduct, tiktokProductIdFromUrl, TIKTOK_PRODUCT_HINT,
} from '@/lib/tiktok-product'
import { normalizeOwnership } from '@/lib/product-ownership'

export const runtime = 'nodejs'
export const maxDuration = 60
// TikTok Shop serves a real page to a supported region and a wall to everyone
// else, so where this function RUNS decides whether the feature works at all.
// Nothing in vercel.json pins a region, which means this inherited the project
// default: correct today and silently breakable by a settings change nobody
// would connect to TikTok. Pinned to US East, which is a TikTok Shop region.
export const preferredRegion = 'iad1'

/** A real browser UA. TikTok serves the product page to an ordinary client;
 *  it is the SHOWCASE that is app-only, not this. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(intg?.tier)
  if (!canSeeNav('labs', tier)) {
    return { error: NextResponse.json({ error: 'TikTok Shop is a Labs feature, available on Pro.', code: 'tier_not_allowed' }, { status: 403 }) }
  }
  return { supabase, user }
}

export async function GET() {
  const g = await gate()
  if (g.error) return g.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = g.supabase as any
  // select('*') on purpose: PostREST rejects the WHOLE statement when one named
  // column is missing, so naming columns here would turn "migration 334 has an
  // extra column" into "the page is empty".
  const { data, error } = await sb.from('tiktok_products')
    .select('*').eq('user_id', g.user!.id).order('created_at', { ascending: false }).limit(200)
  if (error) {
    return NextResponse.json({
      error: 'Your database is missing the TikTok products table. Run migration 334, then reload.',
      migrationNeeded: '334_tiktok_products',
    }, { status: 500 })
  }
  return NextResponse.json({ ok: true, products: data ?? [] })
}

export async function POST(req: Request) {
  const g = await gate()
  if (g.error) return g.error
  const body = await req.json().catch(() => ({})) as { url?: string; ownership?: string }
  const pasted = String(body.url ?? '').trim()
  // Unrecognised reads as the default rather than failing the add: a creator
  // who never saw the question still gets a working product.
  const ownership = normalizeOwnership(body.ownership)
  const productId = tiktokProductIdFromUrl(pasted)
  if (!productId) return NextResponse.json({ error: TIKTOK_PRODUCT_HINT }, { status: 400 })

  const region = pasted.match(/\/([a-z]{2})\/pdp\//i)?.[1]?.toLowerCase() || 'us'
  const canonicalUrl = `https://shop.tiktok.com/${region}/pdp/${productId}`

  // The PASTED url is what we read, so any redirect TikTok wants to do (and the
  // share parameters it reads on the way) happen exactly as they would for a
  // real visitor.
  let html = ''
  try {
    const res = await fetchWithTimeout(pasted, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    })
    if (!res.ok) {
      return NextResponse.json({
        error: `TikTok answered ${res.status} for that product. If this keeps happening for every link, MVP is running from a region TikTok Shop does not serve.`,
      }, { status: 502 })
    }
    html = await res.text()
  } catch (e) {
    return NextResponse.json({
      error: `Could not reach TikTok Shop: ${e instanceof Error ? e.message : 'the request failed'}.`,
    }, { status: 502 })
  }

  const product = parseTikTokProduct(html, pasted)
  if (!product) {
    // A page came back and it was not a product. Saying so beats saving a row
    // of nulls under a real id, which is the shape that looks fine on the list
    // and produces an empty post a week later.
    return NextResponse.json({
      error: 'That page loaded but MVP could not read a product from it. If you can open the link yourself, send it over and we will look at what changed.',
    }, { status: 422 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = g.supabase as any
  const row = {
    user_id: g.user!.id,
    product_id: product.productId,
    share_url: pasted,              // VERBATIM. This is the attribution.
    canonical_url: canonicalUrl,    // for re-reads only, never published
    title: product.title,
    description: product.description || null,
    image_url: product.imageUrl,
    price: product.price,
    currency: product.currency,
    currency_symbol: product.currencySymbol,
    rating: product.rating,
    review_count: product.reviewCount,
    sold_count: product.soldCount,
    seller_name: product.sellerName,
    region: product.region || region,
    ownership,
    refreshed_at: new Date().toISOString(),
  }
  const { data: saved, error } = await sb.from('tiktok_products')
    .upsert(row, { onConflict: 'user_id,product_id' }).select('*').maybeSingle()

  if (error) {
    // The read WORKED. Report the product anyway and say plainly that it did
    // not save, rather than returning a 500 that reads as "the link is bad".
    return NextResponse.json({
      ok: false, product, saved: false,
      error: /column .*ownership.* does not exist/i.test(error.message)
        ? 'MVP read the product, but your database is missing the ownership column. Run migration 335, then add it again.'
        : /relation .* does not exist|column .* does not exist/i.test(error.message)
          ? 'MVP read the product, but your database is missing the TikTok products table. Run migration 334, then add it again.'
          : `MVP read the product but could not save it: ${error.message}`,
      migrationNeeded: /column .*ownership.* does not exist/i.test(error.message) ? '335_tiktok_product_ownership'
        : /does not exist/i.test(error.message) ? '334_tiktok_products' : undefined,
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true, product, saved: saved ?? null })
}

export async function PATCH(req: Request) {
  const g = await gate()
  if (g.error) return g.error
  const { id, ownership } = await req.json().catch(() => ({})) as { id?: string; ownership?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (g.supabase as any).from('tiktok_products')
    .update({ ownership: normalizeOwnership(ownership) })
    .eq('id', id).eq('user_id', g.user!.id).select('*').maybeSingle()
  if (error) {
    return NextResponse.json({
      error: /column .*ownership.* does not exist/i.test(error.message)
        ? 'Your database is missing the ownership column. Run migration 335, then try again.'
        : error.message,
      migrationNeeded: /does not exist/i.test(error.message) ? '335_tiktok_product_ownership' : undefined,
    }, { status: 500 })
  }
  return NextResponse.json({ ok: true, product: data ?? null })
}

export async function DELETE(req: Request) {
  const g = await gate()
  if (g.error) return g.error
  const { id } = await req.json().catch(() => ({})) as { id?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (g.supabase as any).from('tiktok_products')
    .delete().eq('id', id).eq('user_id', g.user!.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
