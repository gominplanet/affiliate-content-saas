// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Accept one sold-product campaign through SCOUT, in the creator's own Amazon
// session, and record it only once Amazon took it. Shared by the Earnings card
// (by hand) and the daily run (components/earnings/SoldCampaignsDaily).
// Browser only.
import { requestAcceptCampaign } from '@/lib/extension-frame'

export type SoldMatchRow = {
  campaignId: string; campaignName: string; brand: string | null; commissionPct: number; endsAt: string
  slotsLeft: number | null; asin: string; matchKind?: 'exact' | 'variant'; campaignAsin?: string | null; soldAttrs?: string | null
  productTitle: string | null; orders: number; earningsCents: number; detailsUrl: string
}
export type AcceptOutcome = { state: 'accepted' | 'already' | 'failed'; note?: string }

export function acceptReason(error?: string, reason?: string): string {
  const r = `${error || ''} ${reason || ''}`
  if (/not-installed/.test(r)) return 'SCOUT is not installed in this browser.'
  if (/sign|login|auth/i.test(r)) return 'Amazon asked you to sign in. Sign in to your Associates account, then try again.'
  if (/full|no.?slot|closed|ended|expired/i.test(r)) return 'The campaign is full or has closed.'
  if (/button/i.test(r)) return 'Amazon did not show an Accept button for this campaign.'
  if (/timeout/.test(r)) return 'Amazon took too long to answer.'
  return r.trim() ? `Not accepted (${r.trim()}).` : 'Not accepted.'
}

/** A failure that will fail every other campaign the same way. */
export const stopsTheRun = (note?: string) => /SCOUT is not installed|sign in/.test(note || '')

export async function acceptSoldMatch(m: SoldMatchRow, source: 'sold-match' | 'sold-match-daily' = 'sold-match'): Promise<AcceptOutcome> {
  const res = await requestAcceptCampaign(m.detailsUrl).catch(() => ({ ok: false, error: 'failed' } as { ok: boolean; accepted?: boolean; already?: boolean; error?: string; reason?: string }))
  if (!res.ok) return { state: 'failed', note: acceptReason(res.error, res.reason) }
  // The product the campaign pays on: for another colour or size, that one.
  const asin = m.campaignAsin || m.asin
  await Promise.all([
    fetch('/api/campaigns/sold-matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: m.campaignId, asin, brand: m.brand }) }).catch(() => null),
    fetch('/api/campaigns/mark-accepted', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asin, campaignId: m.campaignId, detailsUrl: m.detailsUrl, brand: m.brand, commissionPct: m.commissionPct, productTitle: m.productTitle, source }) }).catch(() => null),
  ])
  return { state: res.already ? 'already' : 'accepted' }
}

/** What the last daily run did, kept in this browser for the Earnings card. */
export const DAILY_RESULT_KEY = 'mvp-sold-daily-result'
export type DailyResult = { day: string; accepted: string[]; failed: Array<{ name: string; note: string }>; stopped?: string }
