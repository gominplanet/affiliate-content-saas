// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/amazon-research — filterable browse of the WHOLE Amazon catalogue.
//
// This is the "Amazon Product Research" side of the finder: NOT deals, NOT
// Creator Connections campaigns — just the regular Amazon catalogue, searchable
// by MVP filters (keyword, price, rating, reviews, best-sellers, category).
//
// Engine: Keepa Product Finder (/query) returns matching ASINs by attribute;
// the Amazon Creators API then hydrates image / title / price for the page of
// ASINs shown. Each product link carries the CREATOR'S OWN Associates tag (from
// integrations.amazon_associates_tag) so clicks earn on their account — falling
// back to the operator tag only when the creator hasn't set one.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsFinders, type Tier } from '@/lib/tier'
import { toUserMessage } from '@/lib/friendly-error'
import { keepaProductFinder, keepaConfigured, type KeepaFinderFilters } from '@/services/keepa'
import { getItemsByAsin, creatorsApiConfigured } from '@/services/amazon-creators'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Top-level Keepa rootCategory ids (amazon.com). Enough to niche the browse
// without shipping the full browse-node tree. Empty label = all categories.
const CATEGORIES: Array<{ id: number; label: string }> = [
  { id: 0, label: 'All categories' },
  { id: 1055398, label: 'Home & Kitchen' },
  { id: 3760901, label: 'Beauty & Personal Care' },
  { id: 3375251, label: 'Sports & Outdoors' },
  { id: 2619525011, label: 'Tools & Home Improvement' },
  { id: 165793011, label: 'Toys & Games' },
  { id: 172282, label: 'Electronics' },
  { id: 7141123011, label: 'Clothing, Shoes & Jewelry' },
  { id: 3760911, label: 'Health & Household' },
  { id: 2972638011, label: 'Grocery & Gourmet Food' },
  { id: 2619533011, label: 'Pet Supplies' },
  { id: 1064954, label: 'Baby' },
  { id: 1000, label: 'Books' },
]
const VALID_CATEGORY = new Set(CATEGORIES.map(c => c.id))

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Same paid gate as the rest of the finder.
    const { data: intRow } = await supabase
      .from('integrations').select('tier, amazon_associates_tag').eq('user_id', user.id).maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsFinders(tier)) {
      return NextResponse.json({ error: 'The AMZ Product Finder requires a paid plan.' }, { status: 403 })
    }
    const isAdmin = tier === 'admin'

    if (!keepaConfigured()) {
      return NextResponse.json({ error: 'Amazon Product Research is warming up. Please try again shortly.' }, { status: 503 })
    }

    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
    const minPrice = numParam(url, 'minPrice')      // dollars
    const maxPrice = numParam(url, 'maxPrice')      // dollars
    const minRating = numParam(url, 'minRating')    // 0–5
    const minReviews = intParam(url, 'minReviews')
    const maxSalesRank = intParam(url, 'maxSalesRank')
    const catParam = intParam(url, 'category')
    const rootCategory = catParam != null && VALID_CATEGORY.has(catParam) && catParam > 0 ? catParam : undefined
    const sort = normalizeSort(url.searchParams.get('sort'))
    const page = Math.max(0, intParam(url, 'page') ?? 0)
    const PER_PAGE = 24

    // Require at least one real filter so we never fire a wide-open scan that
    // burns Keepa tokens on a random slice of 240M products.
    const hasFilter = !!q || minPrice != null || maxPrice != null || minRating != null
      || minReviews != null || maxSalesRank != null || rootCategory != null
    if (!hasFilter) {
      return NextResponse.json({ ok: true, page, products: [], hasMore: false, needsFilter: true })
    }

    const filters: KeepaFinderFilters = {
      title: q || undefined,
      priceRangeCents: (minPrice != null || maxPrice != null)
        ? [minPrice != null ? Math.round(minPrice * 100) : null, maxPrice != null ? Math.round(maxPrice * 100) : null]
        : undefined,
      minRating: minRating ?? undefined,
      minReviews: minReviews ?? undefined,
      maxSalesRank: maxSalesRank ?? undefined,
      rootCategory,
      sort,
      page,
      perPage: PER_PAGE,
    }

    const found = await keepaProductFinder(filters)
    // Safe, numbers-only diagnostic (never raw provider text) — shown to admins
    // in the empty state so a "no results" is explainable (bad status / no tokens
    // / genuinely zero matches) instead of a silent dead end.
    const debug = isAdmin
      ? { status: found.status, tokensLeft: found.tokensLeft, totalResults: found.totalResults, matched: found.asins.length }
      : undefined
    if (!found.asins.length) {
      return NextResponse.json({ ok: true, page, products: [], hasMore: false, debug })
    }

    // Hydrate image / title / price for this page of ASINs via the Creators API
    // (best-effort — if it isn't configured or rate-limits, we still return the
    // ASINs with tagged links, just without images).
    const tag = ((intRow?.amazon_associates_tag as string | null) || '').trim() || null
    const cards = creatorsApiConfigured() ? await getItemsByAsin(found.asins) : new Map()

    const products = found.asins.map(asin => {
      const card = cards.get(asin)
      return {
        asin,
        title: card?.title ?? null,
        imageUrl: card?.imageUrl ?? null,
        priceNow: card?.priceCents != null ? Math.round(card.priceCents) / 100 : null,
        productUrl: taggedLink(asin, tag),
      }
    })

    return NextResponse.json({
      ok: true,
      page,
      products,
      hasMore: found.asins.length === PER_PAGE,
      hasOwnTag: !!tag,
    })
  } catch (err) {
    console.error('[amazon-research]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Could not search Amazon just now. Please try again in a moment.') }, { status: 500 })
  }
}

/** A /dp/ASIN link carrying the creator's own Associates tag (operator tag as a
 *  fallback so links always attribute somewhere). */
function taggedLink(asin: string, ownTag: string | null): string {
  const tag = ownTag || (process.env.AMAZON_PARTNER_TAG || '').trim()
  const base = `https://www.amazon.com/dp/${asin}`
  return tag ? `${base}?tag=${encodeURIComponent(tag)}` : base
}

function normalizeSort(v: string | null): KeepaFinderFilters['sort'] {
  switch (v) {
    case 'reviews': return 'reviews'
    case 'rating': return 'rating'
    case 'priceLow': return 'priceLow'
    case 'priceHigh': return 'priceHigh'
    case 'salesRank':
    default: return 'salesRank'
  }
}

function intParam(url: URL, key: string): number | null {
  const v = url.searchParams.get(key); if (v == null || v === '') return null
  const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null
}
function numParam(url: URL, key: string): number | null {
  const v = url.searchParams.get(key); if (v == null || v === '') return null
  const n = Number(v); return Number.isFinite(n) ? n : null
}
