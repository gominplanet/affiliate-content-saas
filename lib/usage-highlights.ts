// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The allowances the new Dashboard's "This month" strip shows (components/
// dashboard/TealDashboard): up to four from /api/usage/summary, the most useful
// first, so a Pro member sees edited videos and Shorts before Pins.

export type UsageBucket = { key: string; label: string; used: number; limit: number | null }

const FIRST = ['reviewEdits', 'shorts', 'generations', 'thumbnails', 'metadata', 'pins', 'instagram', 'facebook']

/** Up to four allowances, the most useful first. Pure. */
export function pickBuckets<T extends UsageBucket>(all: T[]): T[] {
  const rank = (k: string) => { const i = FIRST.indexOf(k); return i === -1 ? FIRST.length : i }
  return [...all].sort((a, b) => rank(a.key) - rank(b.key)).slice(0, 4)
}
