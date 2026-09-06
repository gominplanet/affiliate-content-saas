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
import { getAuthAndOwner } from '@/lib/agency-auth'
import { buildCampaignLibrary, type ContentPiece, type JoinedCampaign } from '@/lib/campaign-library'
import { mergeCampaignRows, displayTitle, isJoined, type CampaignRow } from '@/lib/campaign-rows'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** PostgREST puts the filter in the URL, so a few hundred ASINs at once is a
 *  request that never arrives. */
const CHUNK = 100
const chunk = <T>(xs: T[], n = CHUNK): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

export async function GET() {
  try {
    return await load()
  } catch (e) {
    // A page that says "could not load" and nothing else is a page nobody can
    // fix. Always answer in the library's own shape so the UI renders, and carry
    // the reason so it can be read off the screen instead of guessed at.
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ...buildCampaignLibrary([]), error: message }, { status: 200 })
  }
}

async function load() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth) return auth.error
  const { ownerId } = auth
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Joined means joined, however it happened. amazon_joined_at is the marker the
  // Amazon sync writes for campaigns the creator joined on Amazon directly;
  // accepted_at is the one MVP writes.
  //
  // Read EVERY campaigns row and merge by product, rather than reading only the
  // rows that carry a join marker. This is not tidiness, it is the difference
  // between the page being right and the page being a lie. The blog generator
  // INSERTS its own row for a product instead of updating the accepted one, so a
  // product the creator joined and then wrote a post for has two rows: the accept
  // row with the join marker and no post, and the post row with no join marker.
  // Filtering on the marker kept the empty one and threw away the post, which is
  // how an account with 279 published posts was told that one of its 775
  // campaigns had content.
  const COLS = 'asin, cc_campaign_id, brand_name, product_title, campaign_name, commission_pct, ends_at, accepted_at, amazon_joined_at, messaged_at, details_url, wordpress_url, blog_post_id, status, updated_at'
  const FALLBACK_COLS = 'asin, cc_campaign_id, product_title, campaign_name, ends_at, accepted_at, wordpress_url, blog_post_id, status, updated_at'
  let rowsRaw: CampaignRow[] = []
  let readError: string | null = null
  {
    const read = async (cols: string) => {
      const out: CampaignRow[] = []
      for (let page = 0; page < 5; page++) {
        const r = await sb.from('campaigns').select(cols)
          .eq('user_id', ownerId).range(page * 1000, page * 1000 + 999)
        if (r.error) return { rows: out, error: r.error.message as string }
        const rows = (r.data ?? []) as CampaignRow[]
        out.push(...rows)
        if (rows.length < 1000) break
      }
      return { rows: out, error: null as string | null }
    }
    const full = await read(COLS)
    if (!full.error) rowsRaw = full.rows
    else {
      // Both markers arrived in later migrations and a select fails as a unit, so
      // a database missing one column would drop the whole page rather than one
      // field. Fall back to the columns that have always existed.
      const lean = await read(FALLBACK_COLS)
      readError = lean.error ? `${full.error} / ${lean.error}` : null
      rowsRaw = lean.rows
    }
  }
  if (readError) return NextResponse.json({ ...buildCampaignLibrary([]), error: readError })

  // Merge every row for a product into one, then keep the products that were
  // actually joined. Nothing is dropped for being on the "wrong" row.
  const byAsin = mergeCampaignRows(rowsRaw)
  for (const [asin, r] of byAsin) if (!isJoined(r)) byAsin.delete(asin)

  const asins = [...byAsin.keys()]
  if (!asins.length) {
    return NextResponse.json(buildCampaignLibrary([]))
  }

  // ── what exists for each product ──────────────────────────────────────────
  //
  // Everything below is enrichment: five independent reads that answer "what did
  // this creator already make for this product". They used to run one after
  // another, chunk by chunk, page by page, and on an account with a few hundred
  // joined campaigns and years of earnings that is a hundred round trips in a
  // row. The function's time limit is what the page hit, and a timed-out function
  // returns an error page rather than JSON, which is exactly the blank "could not
  // load" with no reason attached.
  //
  // They do not depend on each other, so they all go at once, and each one fails
  // into an empty list rather than taking the page with it.
  const content = new Map<string, ContentPiece[]>()
  const add = (asin: string, piece: ContentPiece) => {
    const a = asin.toUpperCase()
    if (!byAsin.has(a)) return
    const list = content.get(a) ?? []
    list.push(piece)
    content.set(a, list)
  }
  /** A read whose failure costs one column, never the page. */
  const safe = async <T>(q: PromiseLike<{ data: T[] | null }>): Promise<T[]> => {
    try { const r = await q; return (r?.data ?? []) as T[] } catch { return [] }
  }
  const spread = <T>(parts: string[][], run: (part: string[]) => PromiseLike<{ data: T[] | null }>) =>
    Promise.all(parts.map(p => safe(run(p)))).then(x => x.flat())

  const postIds = [...byAsin.values()].map(r => r.blog_post_id).filter(Boolean) as string[]

  type PostRow = { id: string; title: string | null; published_at: string | null }
  type YtRow = { asin: string; title: string | null; published_at: string | null; youtube_video_id: string | null }
  type AvpRow = { asin: string; aci: string }
  type CcRow = { asin: string | null; platform: string | null; url: string | null; title: string | null; posted_at: string | null }

  // The campaign list is the page. What was made for each one and what Amazon
  // paid are enrichment, so they get a deadline: whatever has come back by then
  // is used and the rest is left out. A creator seeing their campaigns with the
  // content column thin beats a creator seeing an error, and the alternative is
  // the whole function running out of time and returning nothing at all.
  type CatRow = {
    campaign_id?: string | null
    asins: string[] | null; campaign_name: string | null; brand_name: string | null
    commission_pct: number | null; starts_at: string | null; ends_at: string | null
    image_url: string | null; price_now_cents: number | null; price_was_cents?: number | null
    discount_pct?: number | null; rating?: number | null; review_count?: number | null
    monthly_sold?: number | null; sales_rank?: number | null; sales_rank_category?: string | null
  }
  /** Keepa's shared per-product cache. Keyed by ASIN with no user column, so this
   *  is a plain indexed lookup and the same row serves every creator who has the
   *  product. It is what turns "10% commission" into "10% of a $40 product that
   *  sells 2,000 a month", which is the difference between a number and a reason
   *  to make something. */
  type KeepaRow = {
    asin: string; image_url: string | null; sales_rank: number | null
    sales_rank_category: string | null; monthly_sold: number | null
    price_now_cents: number | null; price_avg_cents: number | null
    price_lowest_cents: number | null; discount_pct: number | null
    deal_quality: string | null; empty: boolean | null
  }

  // Amazon's own campaign ids, which the sync stores. Looking the catalog up by
  // id is an indexed key lookup; looking it up by ASIN is an array overlap over a
  // shared table of every live campaign. Both run, because a row can have one and
  // not the other, but the id is the one that reliably answers.
  const campaignIds = [...new Set([...byAsin.values()].map(r => r.cc_campaign_id).filter(Boolean) as string[])]

  const [catRows, catByIdRows, keepaRows, postRows, ytRows, avpRows, ccRows] = await withDeadline(Promise.all([
    // The campaign window, the price and the picture. The accept route stores
    // what the card had, which for a campaign accepted straight from the browse
    // grid is no end date at all, and the window is what every piece of advice on
    // this page is built from. This ran sequentially outside the deadline before,
    // which meant a slow shared catalog could burn the whole time budget on its
    // own with nothing to show for it.
    spread<CatRow>(chunk(asins), part =>
      sb.from('cc_campaign_catalog')
        .select('campaign_id, campaign_name, brand_name, asins, commission_pct, starts_at, ends_at, image_url, price_now_cents, price_was_cents, discount_pct, rating, review_count, monthly_sold, sales_rank, sales_rank_category')
        .overlaps('asins', part).limit(2000)),
    spread<CatRow>(chunk(campaignIds), part =>
      sb.from('cc_campaign_catalog')
        .select('campaign_id, campaign_name, brand_name, asins, commission_pct, starts_at, ends_at, image_url, price_now_cents, price_was_cents, discount_pct, rating, review_count, monthly_sold, sales_rank, sales_rank_category')
        .in('campaign_id', part)),
    spread<KeepaRow>(chunk(asins), part =>
      sb.from('keepa_product_cache')
        .select('asin, image_url, sales_rank, sales_rank_category, monthly_sold, price_now_cents, price_avg_cents, price_lowest_cents, discount_pct, deal_quality, empty')
        .in('asin', part)),
    spread<PostRow>(chunk(postIds), part =>
      sb.from('blog_posts').select('id, title, published_at').in('id', part)),
    spread<YtRow>(chunk(asins), part =>
      sb.from('youtube_videos').select('asin, title, published_at, youtube_video_id')
        .eq('user_id', ownerId).in('asin', part).limit(1000)),
    spread<AvpRow>(chunk(asins), part =>
      sb.from('amazon_video_products').select('asin, aci')
        .eq('user_id', ownerId).in('asin', part).limit(1000)),
    spread<CcRow>(chunk(asins), part =>
      sb.from('creator_content').select('asin, platform, kind, url, title, posted_at')
        .eq('user_id', ownerId).in('asin', part).limit(1000)),
  ]), [[], [], [], [], [], [], []] as const)

  type CatalogEntry = {
    endsAt: string | null; startsAt: string | null; commissionPct: number | null
    priceCents: number | null; imageUrl: string | null; brand: string | null; name: string | null
    signals: { discountPct: number | null; rating: number | null; reviewCount: number | null; monthlySold: number | null; salesRank: number | null; salesRankCategory: string | null }
  }
  const catalog = new Map<string, CatalogEntry>()
  // The id lookup answers for the exact campaign the creator joined, so it is
  // applied to that campaign's own product directly rather than through its ASIN
  // list, and it goes in first so the broader overlap can only add.
  const idToAsin = new Map<string, string>()
  for (const r of byAsin.values()) if (r.cc_campaign_id) idToAsin.set(r.cc_campaign_id, r.asin)
  for (const c of [...catByIdRows, ...catRows]) {
    const own = c.campaign_id
    const targets = own && idToAsin.has(own)
      ? [idToAsin.get(own) as string]
      : (c.asins ?? []).map(x => String(x || '').toUpperCase())
    for (const a of targets) {
      if (!byAsin.has(a)) continue
      const prev = catalog.get(a)
      // Keep the campaign that runs longest for this product: it is the one
      // whose window the creator can still publish into.
      if (prev && (prev.endsAt || '') >= (c.ends_at || '')) continue
      catalog.set(a, {
        endsAt: c.ends_at, startsAt: c.starts_at, commissionPct: c.commission_pct,
        priceCents: c.price_now_cents, imageUrl: c.image_url, brand: c.brand_name, name: c.campaign_name,
        signals: {
          discountPct: c.discount_pct ?? null, rating: c.rating ?? null,
          reviewCount: c.review_count ?? null, monthlySold: c.monthly_sold ?? null,
          salesRank: c.sales_rank ?? null, salesRankCategory: c.sales_rank_category ?? null,
        },
      })
    }
  }

  const keepa = new Map<string, KeepaRow>()
  for (const k of keepaRows) {
    if (k.empty) continue // a tombstone for a product Keepa knows nothing about
    keepa.set(String(k.asin || '').toUpperCase(), k)
  }

  // The blog post MVP wrote for the campaign. The campaigns row carries the
  // published URL; the post itself carries the date, which decides whether it
  // landed inside the campaign window.
  const postDates = new Map<string, { at: string | null; title: string | null }>(
    postRows.map(p => [p.id, { at: p.published_at, title: p.title }]))
  for (const r of byAsin.values()) {
    if (!r.wordpress_url && !r.blog_post_id) continue
    const meta = r.blog_post_id ? postDates.get(r.blog_post_id) : undefined
    add(r.asin, { kind: 'blog', url: r.wordpress_url ?? null, title: meta?.title ?? displayTitle(r.product_title), at: meta?.at ?? null })
  }

  for (const v of ytRows) {
    add(v.asin, {
      kind: 'youtube', title: v.title, at: v.published_at,
      url: v.youtube_video_id ? `https://www.youtube.com/watch?v=${v.youtube_video_id}` : null,
    })
  }

  // Amazon shoppable videos. The join table says which products a video sells,
  // and it is only as complete as the per-video product read, so a missing row
  // here means "not read yet" as often as it means "no video". The metadata read
  // depends on that answer, so it is the one thing that cannot go in the batch
  // above, and it is skipped entirely when there is nothing to look up.
  const aciByAsin = new Map<string, string[]>()
  const acis = new Set<string>()
  for (const v of avpRows) {
    const a = v.asin.toUpperCase()
    aciByAsin.set(a, [...(aciByAsin.get(a) ?? []), v.aci])
    acis.add(v.aci)
  }
  const videoMeta = new Map<string, { at: string | null; title: string | null; url: string | null }>()
  if (acis.size) {
    type VidRow = { aci: string; description: string | null; published_at: string | null; media_url: string | null }
    const vids = await spread<VidRow>(chunk([...acis]), part =>
      sb.from('amazon_videos').select('aci, description, published_at, media_url')
        .eq('user_id', ownerId).in('aci', part).limit(1000))
    for (const v of vids) videoMeta.set(v.aci, { at: v.published_at, title: v.description, url: v.media_url })
  }
  for (const [asin, list] of aciByAsin) {
    for (const aci of list) {
      const m = videoMeta.get(aci)
      add(asin, { kind: 'amazon-video', title: m?.title ?? null, at: m?.at ?? null, url: m?.url ?? null })
    }
  }

  // Anything else recorded in the content library (TikTok posts and the like).
  for (const c of ccRows) {
    if (!c.asin) continue
    // Amazon rows here duplicate the video join table above; only the social
    // platforms add anything, and counting a video twice would tell someone they
    // made two things when they made one.
    if ((c.platform || '').toLowerCase() === 'amazon') continue
    add(c.asin, { kind: 'social', title: c.title, at: c.posted_at, url: c.url })
  }


  const joined: JoinedCampaign[] = [...byAsin.values()].map(r => {
    const cat = catalog.get(r.asin)
    const kp = keepa.get(r.asin)
    const sig = cat?.signals
    // Null everywhere means nothing is known about the product, which the card
    // shows as an absence rather than as a row of zeroes.
    const signals = (kp || sig) ? {
      priceAvgCents: kp?.price_avg_cents ?? null,
      priceLowestCents: kp?.price_lowest_cents ?? null,
      discountPct: kp?.discount_pct ?? sig?.discountPct ?? null,
      dealQuality: kp?.deal_quality ?? null,
      rating: sig?.rating ?? null,
      reviewCount: sig?.reviewCount ?? null,
      monthlySold: kp?.monthly_sold ?? sig?.monthlySold ?? null,
      salesRank: kp?.sales_rank ?? sig?.salesRank ?? null,
      salesRankCategory: kp?.sales_rank_category ?? sig?.salesRankCategory ?? null,
    } : null
    return {
      asin: r.asin,
      campaignId: r.cc_campaign_id ?? null,
      brand: r.brand_name || cat?.brand || null,
      product: displayTitle(r.product_title) || displayTitle(cat?.name) || displayTitle(r.campaign_name),
      imageUrl: cat?.imageUrl ?? kp?.image_url ?? null,
      commissionPct: r.commission_pct ?? cat?.commissionPct ?? null,
      priceCents: cat?.priceCents ?? kp?.price_now_cents ?? null,
      startsAt: cat?.startsAt ?? null,
      // The stored date wins when there is one; it is what the creator joined.
      endsAt: r.ends_at || cat?.endsAt || null,
      joinedAt: r.accepted_at || r.amazon_joined_at || null,
      messagedAt: r.messaged_at || null,
      detailsUrl: r.details_url || null,
      content: content.get(r.asin) ?? [],
      signals,
      // Filled in by a second request. Amazon reports one row per product per
      // month per stream per store, which on a real account is tens of thousands
      // of rows, and reading them was most of what timed this function out. The
      // page is a work queue first: what to make next does not depend on what a
      // product has already paid, so the list goes out without waiting for it.
      earned: null,
    }
  })

  return NextResponse.json(buildCampaignLibrary(joined))
}

/** Enrichment gets this long, then the page goes out with what it has. Well
 *  under the function's own limit, because being late is the same as failing. */
const ENRICHMENT_DEADLINE_MS = 12_000

function withDeadline<T>(work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ENRICHMENT_DEADLINE_MS)),
  ])
}
