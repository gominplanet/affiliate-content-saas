// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Did the update help? Search Console clicks and impressions for the same
// number of days before and after a creator's update (lib/post-refresh).
//
// REPORT THE RESULT, NOT THE PLAN. Every state here reads differently on
// screen: too soon to tell, measured, Google did not answer, no Search
// Console, a post on a site this property does not cover. A zero from a
// failed call or from the wrong property must never read as "the update
// did nothing".

/** Search Console data settles about three days behind. */
export const GSC_LAG_DAYS = 3
/** The shortest window worth comparing, and the longest used. */
export const MIN_WINDOW_DAYS = 14
export const MAX_WINDOW_DAYS = 28

export interface Totals { clicks: number; impressions: number }
export type Impact =
  | { state: 'waiting'; readyInDays: number }
  | { state: 'measured'; days: number; before: Totals; after: Totals }
  | { state: 'no-search-console' }
  | { state: 'other-site' }
  | { state: 'unavailable' }

const DAY = 86_400_000
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10)
const startOfDay = (t: number) => Math.floor(t / DAY) * DAY

/** The two equal windows either side of the update day, or how long to wait. */
export function impactWindows(updatedAt: string, now: Date = new Date()):
  | { ready: false; readyInDays: number }
  | { ready: true; days: number; before: { startDate: string; endDate: string }; after: { startDate: string; endDate: string } } {
  const day = startOfDay(new Date(updatedAt).getTime())
  const lastSettled = startOfDay(now.getTime()) - GSC_LAG_DAYS * DAY
  const available = Math.floor((lastSettled - day) / DAY)
  if (available < MIN_WINDOW_DAYS) return { ready: false, readyInDays: MIN_WINDOW_DAYS - available }
  const days = Math.min(MAX_WINDOW_DAYS, available)
  return {
    ready: true, days,
    before: { startDate: ymd(day - days * DAY), endDate: ymd(day - DAY) },
    after: { startDate: ymd(day + DAY), endDate: ymd(day + days * DAY) },
  }
}

/** Whether a Search Console property covers a page's address. */
export function propertyCovers(property: string, pageUrl: string): boolean {
  try {
    const host = new URL(pageUrl).host.replace(/^www\./, '').toLowerCase()
    if (property.startsWith('sc-domain:')) {
      const d = property.slice('sc-domain:'.length).toLowerCase()
      return host === d || host.endsWith(`.${d}`)
    }
    return new URL(property).host.replace(/^www\./, '').toLowerCase() === host
  } catch { return false }
}

export function sumRows(rows: Array<{ clicks?: number; impressions?: number }>): Totals {
  const t: Totals = { clicks: 0, impressions: 0 }
  for (const r of rows) { t.clicks += r.clicks ?? 0; t.impressions += r.impressions ?? 0 }
  return t
}
