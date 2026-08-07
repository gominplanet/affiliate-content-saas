/**
 * Link in Bio — import the creator's posted products as tiles.
 *
 * Pulls product_watches (populated when they turn a deal into a post, plus any
 * manual watches), and adds one tile per product it doesn't already have. Each
 * tile links to the tagged Amazon URL so clicks earn on the creator's Associates
 * tag; our own /api/link-click adds tile-level click counts on top. (Manual
 * tiles can carry a Geniuslink the creator pastes.)
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { resolveAffiliateUrl } from '@/lib/weekly-digest'
import { asinFromAmazonUrl } from '@/lib/product-link'

export const runtime = 'nodejs'
export const maxDuration = 60

const IMPORT_MAX = 40

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: intRow } = await sb.from('integrations').select('tier,amazon_associates_tag,geniuslink_api_key,geniuslink_api_secret').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(intRow?.tier) as Tier
  if (!canUseDealRadar(tier)) return NextResponse.json({ error: 'Link in Bio is available on paid plans.' }, { status: 403 })
  const tag = ((intRow?.amazon_associates_tag as string | null) || '').trim() || null
  const gKey = ((intRow?.geniuslink_api_key as string | null) || '').trim() || null
  const gSecret = ((intRow?.geniuslink_api_secret as string | null) || '').trim() || null

  const { data: page } = await sb.from('link_pages').select('id').eq('user_id', user.id).maybeSingle()
  if (!page?.id) return NextResponse.json({ error: 'Create your page first.' }, { status: 400 })

  type SrcRow = { asin: string | null; title: string | null; image_url: string | null; url?: string | null; source: 'deal' | 'review' }

  // Source 1 — products the creator has engaged with (posted DEALS auto-watch;
  // plus manual watches).
  const { data: watches } = await sb.from('product_watches')
    .select('asin,title,image_url,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(IMPORT_MAX)
  const dealRows: SrcRow[] = ((watches ?? []) as Array<{ asin: string; title: string | null; image_url: string | null }>)
    .map((w) => ({ asin: w.asin, title: w.title, image_url: w.image_url, source: 'deal' as const }))

  // Source 2 — the creator's published REVIEWS. Most creators (like Scott) make
  // review posts, not deals, so a deals-only import left their shop empty. Each
  // review is about one product; pull its ASIN + photo from the linked video and
  // turn it into a shop tile too.
  const { data: reviews } = await sb.from('blog_posts')
    .select('title, published_at, youtube_videos(product_url, product_image_url, blog_thumbnail_url, thumbnail_url, title)')
    .eq('user_id', user.id)
    .not('video_id', 'is', null)
    .order('published_at', { ascending: false })
    .limit(IMPORT_MAX)
  // A product link we can use as-is for a tile even when we can't read an ASIN
  // out of it (the common case: MVP already wrapped it into a geni.us short link).
  const usableUrl = (u: string) => /^https?:\/\//i.test(u) && /(amazon\.|amzn\.to|a\.co|geni\.us)/i.test(u)
  type YV = { product_url: string | null; product_image_url: string | null; blog_thumbnail_url: string | null; thumbnail_url: string | null; title: string | null }
  const reviewRows: SrcRow[] = []
  for (const b of (reviews ?? []) as Array<{ title: string | null; youtube_videos: YV | YV[] | null }>) {
    const yv = Array.isArray(b.youtube_videos) ? b.youtube_videos[0] : b.youtube_videos
    const purl = (yv?.product_url || '').trim()
    if (!purl) continue // no product link stored for this review → nothing to link a tile to
    const title = b.title || yv?.title || null
    // Prefer the real product photo, else the review's hero image, else the
    // video thumbnail — so a review tile is never blank.
    const image_url = yv?.product_image_url || yv?.blog_thumbnail_url || yv?.thumbnail_url || null
    const asin = asinFromAmazonUrl(purl)
    if (asin) {
      // Raw Amazon link → import by ASIN (dedups + re-wraps into a Geniuslink).
      reviewRows.push({ asin, title, image_url, source: 'review' })
    } else if (usableUrl(purl)) {
      // Already a geni.us / short affiliate link → use it directly, dedup by URL.
      reviewRows.push({ asin: null, title, image_url, url: purl, source: 'review' })
    }
    // else: not an affiliate link we can use → skip
  }

  // Merge + dedupe (deals first, so a posted deal keeps its richer data), capped
  // to the import limit. ASIN rows dedupe by ASIN; link-only review rows (no ASIN)
  // dedupe by URL.
  const seenAsin = new Set<string>()
  const seenUrl = new Set<string>()
  const rows: SrcRow[] = []
  for (const r of [...dealRows, ...reviewRows]) {
    if (r.asin) {
      const a = r.asin.toUpperCase()
      if (!/^[A-Z0-9]{10}$/.test(a) || seenAsin.has(a)) continue
      seenAsin.add(a)
    } else if (r.url) {
      const u = r.url.trim()
      if (seenUrl.has(u)) continue
      seenUrl.add(u)
    } else {
      continue
    }
    rows.push(r)
    if (rows.length >= IMPORT_MAX) break
  }
  if (!rows.length) return NextResponse.json({ ok: true, added: 0, message: 'No posted products or reviews to import yet.' })

  // Append after the current last position.
  const { data: last } = await sb.from('link_page_items').select('position').eq('page_id', page.id)
    .order('position', { ascending: false }).limit(1).maybeSingle()
  const position = (last?.position ?? -1) + 1

  // Product tiles already on the page (ALL of them — need urls to dedupe the
  // link-only review tiles, and asins to HEAL bare-tagged ones).
  const { data: existing } = await sb.from('link_page_items')
    .select('id,asin,url,title,image_url').eq('page_id', page.id).eq('kind', 'product')
  const existingRows = ((existing ?? []) as Array<{ id: string; asin: string | null; url: string; title: string | null; image_url: string | null }>)
  const have = new Set(existingRows.filter((e) => e.asin).map((e) => (e.asin || '').toUpperCase()))
  const haveUrls = new Set(existingRows.map((e) => (e.url || '').trim()).filter(Boolean))

  // Backfill images onto tiles already on the page that have none — review tiles
  // imported before we had a photo source stay blank on re-sync (they're deduped
  // as "already present"), so heal them from the current product/hero/thumbnail.
  const imgByAsin = new Map<string, string>()
  const imgByUrl = new Map<string, string>()
  for (const r of rows) {
    if (!r.image_url) continue
    if (r.asin) imgByAsin.set(r.asin.toUpperCase(), r.image_url)
    if (r.url) imgByUrl.set(r.url.trim(), r.image_url)
  }
  let imageHealed = 0
  for (const e of existingRows) {
    if (e.image_url) continue
    const img = (e.asin && imgByAsin.get((e.asin || '').toUpperCase())) || (e.url && imgByUrl.get((e.url || '').trim())) || null
    if (img) {
      await sb.from('link_page_items').update({ image_url: img }).eq('id', e.id)
      imageHealed++
    }
  }

  const started = Date.now()
  const isGeni = (u: string) => /geni\.us/i.test(u)
  const isTaggedAmazon = (u: string) => /amazon\./i.test(u)

  // HEAL existing tiles: re-wrap any that still carry a bare Amazon link into a
  // Geniuslink (pages imported before wrapping existed keep their old links, and
  // the "skip existing" logic never touched them). Only replace when wrapping
  // actually produced a geni.us URL — so a failing wrap never rewrites a good link.
  let relinked = 0
  if (gKey && gSecret) {
    for (const e of existingRows) {
      if (Date.now() - started > 40_000) break
      const asinU = (e.asin || '').toUpperCase()
      if (!/^[A-Z0-9]{10}$/.test(asinU)) continue
      if (!e.url || isGeni(e.url) || !isTaggedAmazon(e.url)) continue
      const wrapped = await resolveAffiliateUrl(asinU, e.title || asinU, tag, gKey, gSecret)
      if (wrapped && isGeni(wrapped) && wrapped !== e.url) {
        await sb.from('link_page_items').update({ url: wrapped }).eq('id', e.id)
        relinked++
      }
    }
  }

  // Build each NEW tile's link. ALWAYS wrap through Geniuslink when configured.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tiles: any[] = []
  let position2 = position
  for (const r of rows) {
    if (r.asin) {
      const asinU = r.asin.toUpperCase()
      if (!/^[A-Z0-9]{10}$/.test(asinU) || have.has(asinU)) continue
      const title = (r.title || `Amazon product ${asinU}`).slice(0, 120)
      let url: string
      if (gKey && gSecret && Date.now() - started < 45_000) {
        url = await resolveAffiliateUrl(asinU, title, tag, gKey, gSecret)
      } else {
        url = tag ? `https://www.amazon.com/dp/${asinU}?tag=${encodeURIComponent(tag)}` : `https://www.amazon.com/dp/${asinU}`
      }
      tiles.push({ page_id: page.id, user_id: user.id, kind: 'product', title, image_url: r.image_url || null, url, asin: asinU, source: r.source, position: position2++ })
    } else if (r.url) {
      // Link-only review tile: the product link is already a usable affiliate URL
      // (geni.us). Use it directly; dedupe by URL against what's on the page.
      const u = r.url.trim()
      if (haveUrls.has(u)) continue
      haveUrls.add(u)
      const title = (r.title || 'Product').slice(0, 120)
      tiles.push({ page_id: page.id, user_id: user.id, kind: 'product', title, image_url: r.image_url || null, url: u, asin: null, source: r.source, position: position2++ })
    }
  }

  let added = 0
  if (tiles.length) {
    const { data: ins, error } = await sb.from('link_page_items')
      .upsert(tiles, { onConflict: 'page_id,asin', ignoreDuplicates: true })
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    added = (ins ?? []).length
  }

  return NextResponse.json({ ok: true, added, relinked, imageHealed })
}
