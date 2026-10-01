// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The week a recap covers: Monday 00:00 to the next Monday 00:00, UTC. Pure,
// so the top bar (client) and the recap route (server) agree on which week is
// new without asking each other.

const DAY = 86_400_000

export type WeekWindow = { start: Date; end: Date; key: string; label: string }

/** The last full week before `now`, or `back` weeks before that. */
export function weekWindow(now: Date = new Date(), back = 0): WeekWindow {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const sinceMonday = (d.getUTCDay() + 6) % 7
  const thisMonday = d.getTime() - sinceMonday * DAY
  const start = new Date(thisMonday - (back + 1) * 7 * DAY)
  const end = new Date(start.getTime() + 7 * DAY)
  const fmt = (x: Date) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const last = new Date(end.getTime() - DAY)
  return { start, end, key: start.toISOString().slice(0, 10), label: `${fmt(start)} to ${fmt(last)}` }
}

export const RECAP_SEEN_KEY = 'mvp_week_recap_seen'
