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
    // Record it (upsert — carries the catalog ids so status sticks). Fire-and-forget.
    void fetch('/api/campaigns/mark-accepted', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asin: p.asin, campaignId: p.campaignId, detailsUrl: p.detailsUrl,
        brand: p.brand, commissionPct: p.commissionPct, productTitle: p.productTitle,
      }),
    }).catch(() => {})
    toast.success(res.already ? 'Already accepted — you’re in.' : 'Accepted. You can message the brand or make a post.', { id: tId, duration: 6_000 })
    return true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Accept failed', { id: tId, duration: 8_000 })
    return false
  }
}
