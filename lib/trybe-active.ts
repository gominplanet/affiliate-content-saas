// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MOST ACTIVE BRANDS (Seb, 2026-10-17: "do one", after TrybeDaily's Today:
// "Most active brands", posts in 30 days, creators "up from", paid out "up
// from"). TRYBE's brand list carries no count of a brand's videos or posts
// (every field it sends was listed on 2026-10-09: brand, program, categories,
// creatorEarningsBucket, reviews, targets, dates), so the board ranks by what
// MVP does see move in its own daily copies of the list (snap:YYYY-MM-DD,
// lib/trybe-finder): creators joining a brand. A brand's videos count instead
// once enough copies carry them. The window is as many days as MVP has
// copies, up to 30, and is said with every number. Pure, so it is tested
// (scripts/test-trybe-board.ts).

import { bucketDollars } from '@/lib/trybe-pick'
import type { Snapshot } from '@/lib/trybe-finder'

/** Brands on the board. */
export const ACTIVE_MAX = 200
/** Brands with a video count in the window before videos lead the ranking. */
export const VIDEOS_LEAD_MIN = 50
const DAY = 86_400_000

export interface ActivePick {
  /** The newest daily copy, and the one a day before it (null when MVP has no copy that day). */
  latest: string
  prev: string | null
  /** The copy closest to 30 days before the newest, at least a day older; null with one copy only. */
  base: string | null
  /** Days between the base and the newest. */
  days: number | null
}

/** Which daily copies to compare. Pure. */
export function activeKeys(keys: string[]): ActivePick | null {
  const days = keys.map((k) => ({ k, t: Date.parse(k.replace(/^snap:/, '')) })).filter((x) => Number.isFinite(x.t)).sort((a, b) => b.t - a.t)
  if (!days.length) return null
  const latest = days[0]
  const prev = days.find((d) => Math.round((latest.t - d.t) / DAY) === 1) ?? null
  let base: { k: string; n: number } | null = null
  for (const d of days) {
    const n = Math.round((latest.t - d.t) / DAY)
    if (n < 1 || n > 30) continue
    if (!base || Math.abs(n - 30) < Math.abs(base.n - 30)) base = { k: d.k, n }
  }
  return { latest: latest.k, prev: prev?.k ?? null, base: base?.k ?? null, days: base?.n ?? null }
}

export interface ActiveRow {
  brand_id: string
  creators: number | null
  /** Creators who joined in the window; null when either copy has no count. */
  joined: number | null
  /** Since the copy a day before. */
  joinedDay: number | null
  /** Videos approved in the window, when the copies carry a count. */
  videos: number | null
  videosDay: number | null
}

/** Every brand in the newest copy, with what moved over the window and since
 *  the day before. A brand missing from the older copy has no change: not
 *  known, never counted as all new. Pure. */
export function activeRows(latest: Snapshot, prev: Snapshot | null, base: Snapshot | null): ActiveRow[] {
  const diff = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null ? Math.max(0, a - b) : null)
  return Object.entries(latest || {}).map(([id, pair]) => {
    const [c, v] = Array.isArray(pair) ? pair : [null, null]
    const p = prev?.[id], b = base?.[id]
    return { brand_id: id, creators: c ?? null, joined: diff(c, b?.[0]), joinedDay: diff(c, p?.[0]), videos: diff(v, b?.[1]), videosDay: diff(v, p?.[1]) }
  })
}

export type ActiveBy = 'videos' | 'creators'

/** Videos when enough brands have a count for the window, else creators joining. Pure. */
export function activeBy(rows: ActiveRow[]): ActiveBy {
  return rows.filter((r) => r.videos != null).length >= VIDEOS_LEAD_MIN ? 'videos' : 'creators'
}

/** The most active by that measure, then by the day's change, then size.
 *  A brand where nothing moved, or MVP cannot tell, is left out: the board
 *  lists activity it saw, it never calls a brand quiet. Pure. */
export function rankActive(rows: ActiveRow[], by: ActiveBy, max = ACTIVE_MAX): ActiveRow[] {
  const val = (r: ActiveRow) => (by === 'videos' ? r.videos : r.joined) ?? 0
  const day = (r: ActiveRow) => (by === 'videos' ? r.videosDay : r.joinedDay) ?? 0
  return rows.filter((r) => val(r) > 0)
    .sort((a, b) => val(b) - val(a) || day(b) - day(a) || (b.creators ?? 0) - (a.creators ?? 0) || a.brand_id.localeCompare(b.brand_id))
    .slice(0, max)
}

/** How many of these brands are in each category, most first. A brand counts
 *  in every category TRYBE lists for it. Pure. */
export function categoryCounts(list: Array<{ categories?: string[] | null }>): Array<{ name: string; n: number }> {
  const m = new Map<string, { name: string; n: number }>()
  for (const b of list) {
    for (const c of new Set((b.categories || []).map((x) => String(x || '').trim()).filter(Boolean))) {
      const k = c.toLowerCase()
      const cur = m.get(k) ?? { name: c, n: 0 }
      cur.n++
      m.set(k, cur)
    }
  }
  return Array.from(m.values()).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
}

/** A payout tier that went up ("$80K+" to "$200K+"). A tier MVP cannot read
 *  as dollars is not "up". Pure. */
export function tierWentUp(before: string | null | undefined, after: string | null | undefined): boolean {
  const a = bucketDollars(before), b = bucketDollars(after)
  return a != null && b != null && b > a
}

/** The newest tier change per brand from the changes log, newest first in
 *  `list`. Pure. */
export function latestTierChanges(list: Array<{ brand_id: string; before: string | null; after: string | null; at: string }>): Map<string, { before: string | null; after: string | null; at: string; up: boolean }> {
  const out = new Map<string, { before: string | null; after: string | null; at: string; up: boolean }>()
  for (const c of list) if (!out.has(c.brand_id)) out.set(c.brand_id, { before: c.before, after: c.after, at: c.at, up: tierWentUp(c.before, c.after) })
  return out
}
