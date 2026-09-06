// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Accept a Creator Connections campaign from ANY campaign card — SCOUT clicks
// Accept on the user's own logged-in Amazon session (no tab-hopping), then we
// record it via the upserting mark-accepted route so the "Accepted" badge
// sticks even with no prior campaign row. Shared by the CC Campaigns page, the
// dashboard digest, and the Saved Campaigns page so the behavior + copy stay
// identical everywhere.

import { toast } from 'sonner'
import { requestAcceptCampaign } from '@/lib/extension-frame'

export interface AcceptParams {
  detailsUrl: string
  asin: string | null
  campaignId?: string | null
  brand?: string | null
  commissionPct?: number | null
  productTitle?: string | null
  /** Which part of MVP is doing this. Stored, so the Joined Campaigns list can
   *  say a campaign came from a bulk message rather than a deliberate press. */
  source?: AcceptSource
}

/** Every feature that can join a campaign. Adding one here and passing it to
 *  recordAccept is what keeps MVP's memory of its own actions complete. */
export type AcceptSource =
  | 'campaign-card'      // the Join button on a CC Campaigns card
  | 'bulk-accept'        // Accept all, from the CC Campaigns selection bar
  | 'bulk-message'       // joined as part of a bulk outreach, opt in
  | 'write-post'         // joined at the moment of writing content for it
  | 'launchpad'
  | 'favorite-brands'
  | 'saved-campaigns'

/**
 * Write the accept into MVP's own record.
 *
 * Every accept path calls this, and it is deliberately not fire-and-forget. The
 * accept itself has already happened on Amazon by the time we get here, so a
 * dropped request does not undo anything, it just makes MVP forget: the campaign
 * is joined, the creator is committed, and the page that exists to show them what
 * to make for it never lists it. One retry costs nothing and closes the common
 * case of a single failed request.
 */
export async function recordAccept(p: AcceptParams): Promise<boolean> {
  if (!p.asin) return false
  const body = JSON.stringify({
    asin: p.asin, campaignId: p.campaignId, detailsUrl: p.detailsUrl,
    brand: p.brand, commissionPct: p.commissionPct, productTitle: p.productTitle,
    source: p.source ?? null,
  })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch('/api/campaigns/mark-accepted', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      })
      if (r.ok) return true
    } catch { /* retry once */ }
    if (attempt === 0) await new Promise(r => setTimeout(r, 800))
  }
  return false
}

/** Runs the SCOUT accept + records it. Handles the loading / error / success
 *  toasts. Returns true when the campaign is accepted (or already was). */
export async function acceptCampaignViaScout(p: AcceptParams): Promise<boolean> {
  if (!p.asin) { toast.error('No product ASIN on this campaign yet.'); return false }
  if (!p.detailsUrl) { toast.error('No campaign link to accept yet.'); return false }
  const tId = `cc-accept-${p.campaignId || p.asin}`
  toast.loading('Accepting on Amazon via SCOUT…', { id: tId, duration: Infinity })
  try {
    const res = await requestAcceptCampaign(p.detailsUrl)
    if (!res.ok) {
      const msg = res.error === 'not-installed'
        ? 'SCOUT extension not detected. Install/enable it and open Amazon Creator Connections, then try again.'
        : res.error === 'timeout'
          ? 'SCOUT timed out. Make sure you’re logged into Amazon, then try again.'
          : res.reason || res.error || 'Couldn’t accept automatically — open it on Amazon.'
      toast.error(msg, { id: tId, duration: 8_000 })
      return false
    }
    // Record it. Awaited, because MVP forgetting an accept it just performed is
    // how a joined campaign stops being findable on the page built to list them.
    await recordAccept(p)
    toast.success(res.already ? 'Already accepted — you’re in.' : 'Accepted. You can message the brand or make a post.', { id: tId, duration: 6_000 })
    return true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Accept failed', { id: tId, duration: 8_000 })
    return false
  }
}
