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
 * Amazon's campaign names are internal labels, not product names: they carry the
 * ASIN, a leading # or +, and the commission stapled on the end, so a row reads
 * "B0F327X17F +Room Numbers for Office Doors, Collaboration Invite 10%". The
 * commission is already its own chip on the card and the ASIN means nothing to
 * anyone, so both come off. Whatever survives goes through the banned-word scrub
 * like every other string MVP puts on a screen: a title inherited from an old
 * post is still MVP showing it.
 */
export function displayTitle(raw: string | null | undefined): string | null {
  let t = String(raw || '').trim()
  if (!t) return null
  t = t.replace(/^[#+\-•\s]+/, '')
  t = t.replace(/^B0[A-Z0-9]{8}\b[\s+,:-]*/i, '')
  t = t.replace(/[,\s]*Collaboration Invite\s*\d+(?:\.\d+)?%\s*$/i, '')
  t = t.replace(/[,\s]*Campaign\s*$/i, '')
  t = t.replace(/\s{2,}/g, ' ').trim()
  const clean = scrubBanned(t).trim()
  return clean || null
}
