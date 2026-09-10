// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One definition of "this brand's campaigns", used by both routes that answer
// that question.
//
// The Favorite brands badge said "3 open" for Anker and stayed at "3 open" after
// Accept all, every time, forever. Two independent reasons, and both of them are
// the same mistake: a number describing something other than what the button
// acts on.
//
// 1. Neither route filtered out campaigns that had ENDED. The catalogue carries
//    25,104 of them and a good number still have available_slot > 0, frozen at
//    whatever Amazon last exported. An ended campaign with slots reads as open,
//    cannot be accepted (Amazon refuses, SCOUT reports a failure), and therefore
//    counts as open again on the next load. The badge was unclearable by
//    construction.
//
// 2. The two routes sampled the catalogue differently. The badge took 1,000 rows
//    in no order at all, and Accept all took 1,000 rows ordered by monthly_sold.
//    On a brand like Anker, which matches far more than 1,000 rows out of
//    918,748, those are different thousand campaigns. The badge counted opens
//    that Accept all never saw, and no amount of accepting could reconcile them.
//
// So there is now one query, in one place. If the badge counts it, Accept all
// acts on it.
//
// The cap is still real, and `capped` is returned rather than hidden: a brand
// with more matching rows than the cap has a count taken from a slice, and the
// caller is expected to say so instead of printing a bare number that will not
// go to zero.

import { brandIsSeller, brandLikeToken } from '@/lib/brand-match'

/** How many catalogue rows one brand scan reads. The ILIKE pre-filter is not
 *  indexable, so this bounds a query that would otherwise walk the table. */
export const CC_BRAND_SCAN_LIMIT = 1000

export const CC_BRAND_SCAN_COLS =
  'campaign_id, campaign_name, brand_name, asins, rep_asin, commission_pct, ends_at, image_url, available_slot, total_slot'

export interface CcBrandScanRow {
  campaign_id: string
  campaign_name: string | null
  brand_name: string | null
  asins: string[] | null
  rep_asin: string | null
  commission_pct: number | null
  ends_at: string | null
  image_url: string | null
  available_slot: number | null
  total_slot: number | null
}

/** Today, as the catalogue stores dates. */
export function ccToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Every STILL-RUNNING catalogue campaign for one brand.
 *
 *  `capped` is true when the scan hit its limit, which means the rows are a
 *  slice of the brand's campaigns rather than all of them. Callers must surface
 *  that rather than presenting a count as complete.
 *
 *  `includeEnded` drops the still-running filter. Only ONE caller wants it:
 *  Message all, when a brand has no live campaigns left. Joining needs a running
 *  campaign, but talking to a brand does not, and refusing to open the message
 *  window because their last campaign ended is refusing the exact conversation
 *  that gets the next one. The badge must never pass it: counting an ended
 *  campaign as open is what made that badge unclearable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ccScanBrandCampaigns(
  sb: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  label: string,
  opts: { includeEnded?: boolean } = {},
): Promise<{ rows: CcBrandScanRow[]; capped: boolean }> {
  const tok = brandLikeToken(label)
  if (!tok) return { rows: [], capped: false }

  let q = sb
    .from('cc_campaign_catalog')
    .select(CC_BRAND_SCAN_COLS)
    // Broad DB pre-filter (brand OR title contains the token). The precise
    // whole-word check happens in JS below, so "Dreame" catches a campaign whose
    // brand column is empty but whose title names it, without dragging in
    // look-alikes like "Dreamegg".
    .or(`brand_name.ilike.%${tok}%,campaign_name.ilike.%${tok}%`)
  // Still running. This is the line whose absence made the badge unclearable.
  if (!opts.includeEnded) q = q.gte('ends_at', ccToday())

  const { data } = await q
    // A DETERMINISTIC order, identical in every caller. Without one, PostgREST
    // returns rows in physical order, so two requests for the same brand can
    // read two different thousand-row slices and disagree about what is open.
    //
    // The direction follows what the slice is FOR. Live: soonest-ending first,
    // because those are the ones about to be missed. Ended: most-recent first,
    // because a brand's slice of dead campaigns is only useful as a way to reach
    // them, and their last campaign says more than their first.
    .order('ends_at', { ascending: !opts.includeEnded })
    .order('campaign_id', { ascending: true })
    .limit(CC_BRAND_SCAN_LIMIT)

  const raw = (Array.isArray(data) ? data : []) as CcBrandScanRow[]
  // brandIsSeller, not brandMatches. The loose match accepts the label in the
  // TITLE as well as the brand, which pulls in every other seller's replacement
  // filter, compatible part and comparison listing. Counting those inflates the
  // badge; messaging them sends mail from the creator's Amazon account to brands
  // they never picked. One scan feeds the badge, Accept all and Message all, so
  // narrowing it here fixes all three at once and keeps them agreeing.
  const rows = raw.filter(r => brandIsSeller(label, r.brand_name, r.campaign_name))
  return { rows, capped: raw.length >= CC_BRAND_SCAN_LIMIT }
}

/** The campaign ids this user has already joined.
 *
 *  Keyed on the campaign id, NOT the ASIN: Amazon runs several distinct
 *  campaigns for one product, each separately joinable, so an ASIN key would
 *  hide a brand-new campaign because an earlier one for the same product was
 *  joined. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ccAcceptedCampaignIds(sb: any, userId: string): Promise<Set<string>> {
  const set = new Set<string>()
  // Authoritative: the per-campaign ledger holds every joined campaign id, so a
  // brand's count can reach zero even when its campaigns share one ASIN.
  try {
    const { data } = await sb.from('cc_accepted_campaigns')
      .select('campaign_id').eq('user_id', userId).limit(8000)
    for (const r of (data ?? [])) {
      const id = String(r?.campaign_id || '').trim()
      if (id) set.add(id)
    }
  } catch { /* ledger may not exist yet — the backfill below still applies */ }
  // Backfill: campaigns joined before the ledger existed carry one
  // cc_campaign_id on their ASIN-keyed row.
  try {
    const { data } = await sb.from('campaigns')
      .select('cc_campaign_id, accepted_at, amazon_joined_at').eq('user_id', userId).limit(4000)
    for (const r of (data ?? [])) {
      const id = String(r?.cc_campaign_id || '').trim()
      if (id && (r.accepted_at || r.amazon_joined_at)) set.add(id)
    }
  } catch { /* nothing extra excluded */ }
  return set
}

/** Is this campaign one Accept all can actually act on?
 *
 *  The three conditions are the same three the badge counts, deliberately: a
 *  campaign the button will skip must never be counted as open, which is how a
 *  badge ends up describing work that cannot be done.
 *   - not already joined by this user
 *   - has a free slot (a null slot count is UNKNOWN, not open)
 *   - has a representative ASIN, without which there is nothing to accept
 */
export function ccIsAcceptable(
  r: CcBrandScanRow,
  accepted: Set<string>,
  isFull: boolean,
): boolean {
  const cid = String(r.campaign_id || '')
  if (cid && accepted.has(cid)) return false
  if (isFull) return false
  const asin = String(r.rep_asin || (Array.isArray(r.asins) ? r.asins[0] : '') || '').trim()
  return !!asin
}
