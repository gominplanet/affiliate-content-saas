// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/campaigns/library
//
// Every campaign this creator has joined, with whatever they actually made for
// it and whatever Amazon has paid on the product.
//
// Fetching only. Every judgement, every count and every sentence lives in
// lib/campaign-library.ts as a pure function, so the wording and the refusals
// are tested rather than eyeballed.
//
// One row per PRODUCT, not per campaign id. Amazon runs several campaigns for
// the same ASIN across different windows, and a creator joined to three of them
// still has exactly one thing to make. Splitting the row would put the same job
// on the list three times and make the counts read as three times the work.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { buildCampaignLibrary, type ContentPiece, type JoinedCampaign } from '@/lib/campaign-library'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** PostgREST puts the filter in the URL, so a few hundred ASINs at once is a
 *  request that never arrives. */
const CHUNK = 100
const chunk = <T>(xs: T[], n = CHUNK): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

interface CampaignRow {
  asin: string
  cc_campaign_id: string | null
  brand_name: string | null
  product_title: string | null
  campaign_name: string | null
  commission_pct: number | null
  ends_at: string | null
  accepted_at: string | null
  amazon_joined_at: string | null
  messaged_at: string | null
  details_url: string | null
  wordpress_url: string | null
  blog_post_id: string | null
  status: string | null
  updated_at: string | null
}

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth) return auth.error
  const { ownerId } = auth
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  // Joined means joined, however it happened. amazon_joined_at is the marker the
  // Amazon sync writes for campaigns the creator joined on Amazon directly;
  // accepted_at is the one MVP writes. A campaign only MVP knows about and one
  // only Amazon knows about are the same commitment.
  const { data: rowsRaw, error } = await sb
    .from('campaigns')
    .select('asin, cc_campaign_id, brand_name, product_title, campaign_name, commission_pct, ends_at, accepted_at, amazon_joined_at, messaged_at, details_url, wordpress_url, blog_post_id, status, updated_at')
    .eq('user_id', ownerId)
    .or('amazon_joined_at.not.is.null,accepted_at.not.is.null')
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // One row per product, keeping the campaign that runs longest, because that is
  // the window the creator still has to publish into.
  const byAsin = new Map<string, CampaignRow>()
  for (const r of (rowsRaw ?? []) as CampaignRow[]) {
    const asin = (r.asin || '').toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue
    const prev = byAsin.get(asin)
    if (!prev || (r.ends_at || '') > (prev.ends_at || '')) byAsin.set(asin, { ...r, asin })
  }
  const asins = [...byAsin.keys()]
  if (!asins.length) {
    return NextResponse.json(buildCampaignLibrary([]))
  }

  // ── the campaign window, the price and the picture ────────────────────────
  // The accept route stores what the card had, which for a campaign accepted
  // straight from the browse grid is no end date at all. The shared catalog is
  // where that lives, so a joined campaign without a window is looked up rather
  // than shown as undated.
  const catalog = new Map<string, { endsAt: string | null; startsAt: string | null; commissionPct: number | null; priceCents: number | null; imageUrl: string | null; brand: string | null; name: string | null }>()
  for (const part of chunk(asins)) {
    try {
      const { data } = await admin
        .from('cc_campaign_catalog')
        .select('campaign_id, campaign_name, brand_name, asins, commission_pct, starts_at, ends_at, image_url, price_now_cents')
        .overlaps('asins', part)
        .limit(2000)
      for (const c of (data ?? []) as Array<{ asins: string[] | null; campaign_name: string | null; brand_name: string | null; commission_pct: number | null; starts_at: string | null; ends_at: string | null; image_url: string | null; price_now_cents: number | null }>) {
        for (const raw of c.asins ?? []) {
          const a = String(raw || '').toUpperCase()
          if (!byAsin.has(a)) continue
          const prev = catalog.get(a)
          // Keep the campaign that runs longest for this product: it is the one
          // whose window the creator can still publish into.
          if (prev && (prev.endsAt || '') >= (c.ends_at || '')) continue
          catalog.set(a, {
            endsAt: c.ends_at, startsAt: c.starts_at, commissionPct: c.commission_pct,
            priceCents: c.price_now_cents, imageUrl: c.image_url, brand: c.brand_name, name: c.campaign_name,
          })
        }
      }
    } catch { /* the catalog is enrichment; a joined campaign is still a joined campaign */ }
  }

  // ── what exists for each product ──────────────────────────────────────────
  const content = new Map<string, ContentPiece[]>()
  const add = (asin: string, piece: ContentPiece) => {
    const a = asin.toUpperCase()
    if (!byAsin.has(a)) return
    const list = content.get(a) ?? []
    list.push(piece)
    content.set(a, list)
  }

  // The blog post MVP wrote for the campaign. The campaigns row carries the
  // published URL; the post itself carries the date, which decides whether it
  // landed inside the campaign window.
  const postIds = [...byAsin.values()].map(r => r.blog_post_id).filter(Boolean) as string[]
  const postDates = new Map<string, { at: string | null; title: string | null }>()
  for (const part of chunk(postIds)) {
    try {
      const { data } = await sb.from('blog_posts').select('id, title, published_at').in('id', part)
      for (const p of (data ?? []) as Array<{ id: string; title: string | null; published_at: string | null }>) {
        postDates.set(p.id, { at: p.published_at, title: p.title })
      }
    } catch { /* the URL alone still proves the post exists */ }
  }
  for (const r of byAsin.values()) {
    if (!r.wordpress_url && !r.blog_post_id) continue
    const meta = r.blog_post_id ? postDates.get(r.blog_post_id) : undefined
    add(r.asin, { kind: 'blog', url: r.wordpress_url, title: meta?.title ?? r.product_title, at: meta?.at ?? null })
  }

  // YouTube videos MVP knows the product for.
  for (const part of chunk(asins)) {
    try {
      const { data } = await sb
        .from('youtube_videos').select('asin, title, published_at, youtube_video_id')
        .eq('user_id', ownerId).in('asin', part).limit(1000)
      for (const v of (data ?? []) as Array<{ asin: string; title: string | null; published_at: string | null; youtube_video_id: string | null }>) {
        add(v.asin, {
          kind: 'youtube', title: v.title, at: v.published_at,
          url: v.youtube_video_id ? `https://www.youtube.com/watch?v=${v.youtube_video_id}` : null,
        })
      }
    } catch { /* no YouTube connected */ }
  }

  // Amazon shoppable videos. The join table says which products a video sells,
  // and it is only as complete as the per-video product read, so a missing row
  // here means "not read yet" as often as it means "no video".
  const aciByAsin = new Map<string, string[]>()
  const acis = new Set<string>()
  for (const part of chunk(asins)) {
    try {
      const { data } = await sb
        .from('amazon_video_products').select('asin, aci')
        .eq('user_id', ownerId).in('asin', part).limit(1000)
      for (const v of (data ?? []) as Array<{ asin: string; aci: string }>) {
        const a = v.asin.toUpperCase()
        aciByAsin.set(a, [...(aciByAsin.get(a) ?? []), v.aci])
        acis.add(v.aci)
      }
    } catch { /* the video library has not been read */ }
  }
  const videoMeta = new Map<string, { at: string | null; title: string | null; url: string | null }>()
  for (const part of chunk([...acis])) {
    try {
      const { data } = await sb
        .from('amazon_videos').select('aci, description, published_at, media_url')
        .eq('user_id', ownerId).in('aci', part).limit(1000)
      for (const v of (data ?? []) as Array<{ aci: string; description: string | null; published_at: string | null; media_url: string | null }>) {
        videoMeta.set(v.aci, { at: v.published_at, title: v.description, url: v.media_url })
      }
    } catch { /* metadata is optional; the join row already proves the video */ }
  }
  for (const [asin, list] of aciByAsin) {
    for (const aci of list) {
      const m = videoMeta.get(aci)
      add(asin, { kind: 'amazon-video', title: m?.title ?? null, at: m?.at ?? null, url: m?.url ?? null })
    }
  }

  // Anything else recorded in the content library (TikTok posts and the like).
  for (const part of chunk(asins)) {
    try {
      const { data } = await sb
        .from('creator_content').select('asin, platform, kind, url, title, posted_at')
        .eq('user_id', ownerId).in('asin', part).limit(1000)
      for (const c of (data ?? []) as Array<{ asin: string | null; platform: string | null; url: string | null; title: string | null; posted_at: string | null }>) {
        if (!c.asin) continue
        // Amazon rows here duplicate the video join table above; only the social
        // platforms add anything, and counting a video twice would tell someone
        // they made two things when they made one.
        if ((c.platform || '').toLowerCase() === 'amazon') continue
        add(c.asin, { kind: 'social', title: c.title, at: c.posted_at, url: c.url })
      }
    } catch { /* nothing recorded */ }
  }

  // ── what Amazon paid on each product ──────────────────────────────────────
  // Null when the account has never been synced, because "Amazon has not been
  // read" and "Amazon reported nothing" are different facts and the page says
  // different things about them.
  const earned = new Map<string, { clicks: number; orders: number; cents: number }>()
  let earningsSynced = false
  for (const part of chunk(asins)) {
    for (let from = 0; ; from += 1000) {
      let rows: Array<{ asin: string; clicks: number | null; orders: number | null; earnings_cents: number | null }> = []
      try {
        const { data } = await sb
          .from('amazon_earnings_products').select('asin, clicks, orders, earnings_cents')
          .eq('user_id', ownerId).in('asin', part).range(from, from + 999)
        rows = (data ?? []) as typeof rows
      } catch { break }
      if (!rows.length) break
      earningsSynced = true
      for (const e of rows) {
        const a = (e.asin || '').toUpperCase()
        const prev = earned.get(a) ?? { clicks: 0, orders: 0, cents: 0 }
        earned.set(a, {
          clicks: prev.clicks + (e.clicks ?? 0),
          orders: prev.orders + (e.orders ?? 0),
          cents: prev.cents + (e.earnings_cents ?? 0),
        })
      }
      if (rows.length < 1000) break
    }
  }
  // One synced product proves the account is synced, so a product with no row is
  // a real zero rather than an unknown. Without a single row anywhere, nothing
  // is known and every product stays null.
  if (!earningsSynced) earned.clear()

  const joined: JoinedCampaign[] = [...byAsin.values()].map(r => {
    const cat = catalog.get(r.asin)
    const e = earned.get(r.asin)
    return {
      asin: r.asin,
      campaignId: r.cc_campaign_id,
      brand: r.brand_name || cat?.brand || null,
      product: r.product_title || cat?.name || null,
      imageUrl: cat?.imageUrl ?? null,
      commissionPct: r.commission_pct ?? cat?.commissionPct ?? null,
      priceCents: cat?.priceCents ?? null,
      startsAt: cat?.startsAt ?? null,
      // The stored date wins when there is one; it is what the creator joined.
      endsAt: r.ends_at || cat?.endsAt || null,
      joinedAt: r.accepted_at || r.amazon_joined_at || null,
      messagedAt: r.messaged_at || null,
      detailsUrl: r.details_url || null,
      content: content.get(r.asin) ?? [],
      earned: earningsSynced ? { clicks: e?.clicks ?? 0, orders: e?.orders ?? 0, cents: e?.cents ?? 0 } : null,
    }
  })

  return NextResponse.json(buildCampaignLibrary(joined))
}
