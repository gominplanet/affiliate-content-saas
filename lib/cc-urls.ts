// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Amazon Creator Connections URL builders.
//
// The campaign "request / accept" page lives at /p/connect/request with the
// campaign id passed as BOTH adId and campaignId. This is the real, working
// shape (confirmed from a live campaign link), e.g.:
//
//   https://affiliate-program.amazon.com/p/connect/request
//     ?creatorId=amzn1.creator.…      ← per-creator; Amazon fills from the
//                                        logged-in session when omitted
//     &adId=amzn1.campaign.3T829DMXNBA4F
//     &campaignId=amzn1.campaign.3T829DMXNBA4F
//     &recc=0&early-acc=1&type=spcc&status=opportunity
//
// The OLD builder used /creatorconnections/campaign/<id>, a guessed path
// Amazon does not resolve — that's why "Open on Amazon" landed on a dead page.
//
// We omit creatorId by default: it's the creator's own id (amzn1.creator.…),
// which we don't hold server-side, and Amazon fills it from the session cookie
// when it's absent. Pass one through when SCOUT has resolved it for a tighter
// link.

const CC_ORIGIN = 'https://affiliate-program.amazon.com'

/** Which Creator Connections program a campaign belongs to. Amazon's own tabs
 *  are "Affiliate+ campaigns" and "Sponsored Products for Creators". */
export type CcProgram = 'spcc' | 'affiliate-plus'

export interface CcRequestUrlOpts {
  /** amzn1.creator.… — omitted → Amazon fills it from the session cookie. */
  creatorId?: string | null
  /** Omit when unknown. See the warning below. */
  type?: CcProgram | null
  /** 'opportunity' for something not yet accepted, 'accepted' for a joined
   *  campaign. Omit when unknown. */
  status?: 'opportunity' | 'accepted' | null
}

/**
 * Build the Creator Connections request/accept URL for a campaign.
 *
 * TYPE AND STATUS ARE OPT-IN, AND THAT IS THE FIX.
 *
 * These used to be hardcoded to type=spcc&status=opportunity for every link,
 * copied from one live example. spcc is Sponsored Products for Creators, a
 * different Amazon tab from Affiliate+. Opening a JOINED Affiliate+ campaign
 * with those params loaded the campaign and then, about two seconds later,
 * Amazon's SPA reconciled the mismatch and threw the creator onto the EPC list.
 * The page they asked for appeared, then took itself away.
 *
 * Passing a WRONG value is worse than passing none: Amazon resolves the program
 * and the status from the campaign id on its own. So a caller that does not
 * know says nothing, and only a caller that is certain names them.
 *
 * @param campaignId Amazon campaign id (amzn1.campaign.…).
 * @param opts       Options, or a bare creatorId string for older callers.
 */
export function ccRequestUrl(campaignId: string, opts?: string | CcRequestUrlOpts | null): string {
  const o: CcRequestUrlOpts = typeof opts === 'string' ? { creatorId: opts } : (opts || {})
  const p = new URLSearchParams()
  if (o.creatorId) p.set('creatorId', o.creatorId)
  p.set('adId', campaignId)
  p.set('campaignId', campaignId)
  p.set('recc', '0')
  p.set('early-acc', '1')
  if (o.type) p.set('type', o.type)
  if (o.status) p.set('status', o.status)
  return `${CC_ORIGIN}/p/connect/request?${p.toString()}`
}

/**
 * Repair a details_url that was stored before the above was fixed.
 *
 * Rows saved by the join and message flows carry the old
 * type=spcc&status=opportunity tail, so fixing the builder alone would leave
 * every campaign already in a creator's library still bouncing. This strips
 * the params that cause the bounce, and optionally sets the ones a caller is
 * sure about, without rebuilding a URL whose other parameters we may not know.
 *
 * Returns the input unchanged when it is not a CC request URL.
 */
export function ccNormalizeRequestUrl(
  url: string | null | undefined,
  opts?: CcRequestUrlOpts,
): string | null {
  const raw = String(url ?? '').trim()
  if (!raw) return null
  let u: URL
  try { u = new URL(raw) } catch { return raw }
  if (!/affiliate-program\.amazon\.[a-z.]+$/i.test(u.hostname) || !/\/p\/connect\/request$/i.test(u.pathname)) return raw
  u.searchParams.delete('type')
  u.searchParams.delete('status')
  if (opts?.type) u.searchParams.set('type', opts.type)
  if (opts?.status) u.searchParams.set('status', opts.status)
  if (opts?.creatorId) u.searchParams.set('creatorId', opts.creatorId)
  return u.toString()
}
