// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Turning the campaigns table into one row per product.
//
// The table is not one row per product, and assuming it was made the Joined
// Campaigns page tell a creator with 279 published posts that one of their 775
// campaigns had content.
//
// There are two writers and they do not agree. Accepting a campaign writes a row
// with the join markers, Amazon's internal campaign label as the title, and no
// post. Generating a blog post INSERTS its own row for the same product, with the
// real Amazon product title and the post attached, and no join marker at all. So
// a product the creator joined and then wrote about has two rows, each holding
// half the truth, and reading only the rows with a join marker keeps the empty
// half and throws away the work.
//
// Merging is therefore not tidiness. It is the difference between the page being
// right and the page being a lie, which is why it lives here as a pure function
// with tests rather than inline in a route where nothing checks it.

import { scrubBanned } from './scrub'

export interface CampaignRow {
  asin: string
  cc_campaign_id?: string | null
  brand_name?: string | null
  product_title?: string | null
  campaign_name?: string | null
  commission_pct?: number | null
  ends_at?: string | null
  accepted_at?: string | null
  amazon_joined_at?: string | null
  messaged_at?: string | null
  details_url?: string | null
  wordpress_url?: string | null
  blog_post_id?: string | null
  status?: string | null
  updated_at?: string | null
  /** Every product the campaign covers, as SCOUT read it off Amazon's page.
   *  Kept because the shared catalog's list is empty for a large share of
   *  campaigns and the campaign eventually drops off Amazon's live list. */
  campaign_asins?: string[] | null
}

/** True when any row for this product carries a join marker, whichever writer
 *  put it there. MVP's accept writes accepted_at; the Amazon sync writes
 *  amazon_joined_at for campaigns joined on Amazon directly. */
export function isJoined(r: CampaignRow): boolean {
  return !!(r.accepted_at || r.amazon_joined_at)
}

/**
 * One row per product, keeping every fact from every row.
 *
 * Each field takes the first row that actually has it, with two exceptions worth
 * stating. The window takes the LATEST end date, because that is the one the
 * creator can still publish into. The title prefers the row that carries a post,
 * because that row's title came off the Amazon product page while the accept
 * row's came from Amazon's internal campaign label.
 */
export function mergeCampaignRows(rows: CampaignRow[]): Map<string, CampaignRow> {
  const byAsin = new Map<string, CampaignRow>()
  for (const raw of rows) {
    const asin = String(raw.asin || '').toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue
    const prev = byAsin.get(asin)
    if (!prev) { byAsin.set(asin, { ...raw, asin }); continue }
    const first = <K extends keyof CampaignRow>(k: K): CampaignRow[K] =>
      (prev[k] ?? raw[k]) as CampaignRow[K]
    byAsin.set(asin, {
      ...prev,
      asin,
      ends_at: (raw.ends_at || '') > (prev.ends_at || '') ? raw.ends_at : prev.ends_at,
      blog_post_id: first('blog_post_id'),
      wordpress_url: first('wordpress_url'),
      accepted_at: first('accepted_at'),
      amazon_joined_at: first('amazon_joined_at'),
      messaged_at: first('messaged_at'),
      cc_campaign_id: first('cc_campaign_id'),
      brand_name: first('brand_name'),
      commission_pct: first('commission_pct'),
      details_url: first('details_url'),
      campaign_name: first('campaign_name'),
      // The longer list wins: a row that has never been read holds nothing, and
      // taking "the first one with a value" would let an empty read overwrite a
      // real one on the next merge.
      campaign_asins: (raw.campaign_asins?.length ?? 0) > (prev.campaign_asins?.length ?? 0)
        ? raw.campaign_asins : prev.campaign_asins,
      product_title:
        (prev.blog_post_id ? prev.product_title : null)
        ?? (raw.blog_post_id ? raw.product_title : null)
        ?? first('product_title'),
    })
  }
  return byAsin
}

/**
 * A name a person would recognise.
 *
 * Amazon's campaign names are marketing strings written for the campaign browser,
 * not product names. They arrive as pipe-separated promo segments with the
 * commission stapled on, wrapped in quotes, prefixed with the ASIN, decorated
 * with stars, and suffixed with internal codes:
 *
 *   "⭐3K+ Sold | Bear Baby Food Maker | Homemade Baby Food | 15% Commission" (FW)
 *   1 New Release | 4K Large Projector Screen for World Cup.Earn 20% Commission!
 *   B0F327X17F +Room Numbers for Office Doors, Collaboration Invite 10%
 *
 * The commission is already its own chip on the card and the rest is noise, so
 * the segments that are pure promotion are dropped and the longest real one is
 * kept. Whatever survives goes through the banned-word scrub like every other
 * string MVP puts on a screen: a title inherited from an old post is still MVP
 * showing it.
 */

/** Segments that are advertising rather than the product. Matched whole, so a
 *  product legitimately called "Deal Cutter" is not thrown away. */
const PROMO_SEGMENT = /^(?:\s*(?:⭐|★|🔥|#|\d+\s*)*(?:new\s+release|best\s*seller|amazon'?s\s+choice|top\s+rated|hot\s+deal|deal\s+of\s+the\s+day|limited\s+time|free\s+shipping|fast\s+shipping|high\s+conversion|new\s+arrival|trending|sale|clearance)\s*)$/i
/** "3K+ Sold", "1,200 sold", "⭐3K+ Sold". */
const SOLD_SEGMENT = /^\s*[⭐★🔥\s]*[\d.,]+\s*[KkMm]?\+?\s*sold\s*$/i
/** Any segment that is only about the commission. */
const COMMISSION_SEGMENT = /^\s*[\d.]+\s*%\s*commission\s*$/i

/** Sentences brands open their campaign brief with, where the product name is
 *  what follows. "Let more customers know more about Levoit Classic 36-Inch Tower
 *  Fan White" is a request written to a creator, not a name for a fan. Stripped
 *  only when enough is left to still be a name. */
const BRIEF_PREFIX = /^(?:let\s+more\s+(?:customers|people|shoppers)\s+(?:know|learn)(?:\s+more)?\s+about|help\s+(?:us\s+)?(?:promote|spread\s+the\s+word\s+about|introduce)|we\s+(?:are|'re)\s+looking\s+for\s+creators\s+(?:to\s+\w+\s+)?(?:for|about)|looking\s+for\s+creators\s+(?:to\s+\w+\s+)?(?:for|about)|introducing|check\s+out|promote|showcase|review)\s+(?:our\s+|the\s+|new\s+|my\s+)*/i

export function displayTitle(raw: string | null | undefined): string | null {
  let t = String(raw || '').trim()
  if (!t) return null

  // Wrapping quotes, and a trailing internal code like "(FW)".
  t = t.replace(/^["'\u201c\u2018]+/, '').replace(/["'\u201d\u2019]+$/, '').trim()
  t = t.replace(/\s*\([A-Z]{2,4}\)\s*$/, '').trim()
  // The commission, wherever Amazon stapled it on.
  t = t.replace(/[.\s]*Earn\s+[\d.]+\s*%\s*Commission!?/gi, ' ')
  t = t.replace(/[,\s]*Collaboration Invite\s*[\d.]+\s*%/gi, ' ')

  // Pipe-separated promo segments: keep the longest one that is about a product.
  if (t.includes('|')) {
    const parts = t.split('|').map(x => x.trim()).filter(Boolean)
    const real = parts.filter(x =>
      !PROMO_SEGMENT.test(x) && !SOLD_SEGMENT.test(x) && !COMMISSION_SEGMENT.test(x)
      && /[a-z]{3}/i.test(x))
    if (real.length) t = real.reduce((a, b) => (b.length > a.length ? b : a))
  }

  t = t.replace(/^[#+\-•⭐★\s]+/, '')
  // A brief written to the creator, with the product buried inside it.
  const briefless = t.replace(BRIEF_PREFIX, '').trim()
  if (briefless.length >= 12) t = briefless
  t = t.replace(/^B0[A-Z0-9]{8}\b[\s+,:-]*/i, '')
  t = t.replace(/[,\s]*Campaign\s*$/i, '')
  t = t.replace(/[\s.,;:!]+$/, '')
  t = t.replace(/\s{2,}/g, ' ').trim()
  const clean = scrubBanned(t).trim()
  return clean || null
}
