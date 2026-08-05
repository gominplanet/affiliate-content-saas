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

/**
 * Build the Creator Connections request/accept URL for a campaign.
 * @param campaignId Amazon campaign id (amzn1.campaign.…) — our
 *                   cc_campaign_catalog.campaign_id.
 * @param creatorId  Optional amzn1.creator.… id; omitted → filled from session.
 */
export function ccRequestUrl(campaignId: string, creatorId?: string | null): string {
  const p = new URLSearchParams()
  if (creatorId) p.set('creatorId', creatorId)
  p.set('adId', campaignId)
  p.set('campaignId', campaignId)
  p.set('recc', '0')
  p.set('early-acc', '1')
  p.set('type', 'spcc')
  p.set('status', 'opportunity')
  return `${CC_ORIGIN}/p/connect/request?${p.toString()}`
}
