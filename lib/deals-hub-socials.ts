// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHEN EACH DEALS HUB DEAL GOES OUT ON SOCIAL (Seb, 2026-10-19: "we should
// really focus on social media pushes from there"). Pure, so the route and
// scripts/test-deals-hub-file.ts agree on it.
//
// A deal posts when it starts on Amazon, never before (Amazon allows a deal
// to be published only once it is live). Posts are spaced at least
// `intervalMins` apart, because a Black Friday file has hundreds of deals that
// start in the same minute, and a burst of near-identical posts is how a
// social account gets flagged. A deal whose turn would come after it ends is
// not scheduled, and says so.

export const HUB_INTERVALS = [5, 15, 30, 60, 180]
export const HUB_MAX_BATCH = 30

export interface HubSocialDeal {
  asin: string
  title: string
  brand?: string | null
  imageUrl?: string | null
  discountPct?: number | null
  belowYtd?: boolean
  /** ISO. */
  startsAt: string
  endsAt?: string | null
}

export interface HubPlan {
  scheduled: Array<{ deal: HubSocialDeal; at: string }>
  skipped: Array<{ asin: string; reason: string }>
}

const LEAD_MS = 2 * 60_000

export function hubSchedule(raw: HubSocialDeal[], intervalMins: number, now = Date.now()): HubPlan {
  const gap = Math.max(1, intervalMins) * 60_000
  const skipped: HubPlan['skipped'] = []
  const seen = new Set<string>()
  const valid: Array<{ deal: HubSocialDeal; starts: number; ends: number }> = []
  for (const d of raw) {
    const asin = String(d?.asin || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) { skipped.push({ asin: asin || '?', reason: 'Not a product ASIN.' }); continue }
    if (seen.has(asin)) { skipped.push({ asin, reason: 'Picked twice, so it is scheduled once.' }); continue }
    const starts = Date.parse(String(d.startsAt || ''))
    if (!Number.isFinite(starts)) { skipped.push({ asin, reason: 'The file gave no start time MVP could read.' }); continue }
    const ends = d.endsAt ? Date.parse(String(d.endsAt)) : NaN
    if (Number.isFinite(ends) && ends <= now) { skipped.push({ asin, reason: 'The deal has already ended.' }); continue }
    seen.add(asin)
    const pct = typeof d.discountPct === 'number' && Number.isFinite(d.discountPct) && d.discountPct > 0 && d.discountPct < 100 ? Math.round(d.discountPct) : null
    valid.push({
      starts, ends,
      deal: {
        asin,
        title: String(d.title || asin).slice(0, 300),
        brand: d.brand ? String(d.brand).slice(0, 120) : null,
        imageUrl: d.imageUrl && /^https:\/\//i.test(String(d.imageUrl)) ? String(d.imageUrl).slice(0, 1000) : null,
        discountPct: pct,
        belowYtd: d.belowYtd === true,
        startsAt: new Date(starts).toISOString(),
        endsAt: Number.isFinite(ends) ? new Date(ends).toISOString() : null,
      },
    })
  }
  valid.sort((a, b) => a.starts - b.starts)
  const scheduled: HubPlan['scheduled'] = []
  let prev = -Infinity
  for (const v of valid) {
    const at = Math.max(v.starts, now + LEAD_MS, prev + gap)
    if (Number.isFinite(v.ends) && at >= v.ends - 5 * 60_000) {
      skipped.push({ asin: v.deal.asin, reason: 'With the posts spaced out, its turn would come after the deal ends. Space them closer or pick fewer.' })
      continue
    }
    scheduled.push({ deal: v.deal, at: new Date(at).toISOString() })
    prev = at
  }
  return { scheduled, skipped }
}
