// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE, DAY BY DAY, AND WHAT MEMBERS SEE TOGETHER (Seb, 2026-10-13, after
// looking at TrybeDaily). Two things, both pure so they are tested
// (scripts/test-trybe-changes.ts):
//
//   1. What changed on MVP's shared copy of TRYBE: a brand new on the list,
//      one that left or came back, its pay, its earnings tier, it starting
//      to run Meta ads (or many more), it entering TRYBE's Top 100. Logged
//      when the copy is written (app/api/labs/trybe), read as "what changed".
//
//   2. Members' combined numbers per brand: the approval rate and the pay per
//      approved video, from every member's own TRYBE results. Shown only when
//      at least POOL_MIN members have results for the brand and no one member
//      is more than half of it, so no member's own numbers can be read back.

export type ChangeKind = 'new' | 'left' | 'back' | 'pay' | 'tier' | 'ads' | 'top100'

export interface Change { brand_id: string; kind: ChangeKind; before: string | null; after: string | null; at?: string }

export const CHANGE_WORDS: Record<ChangeKind, string> = {
  new: 'New on TRYBE', left: 'Left TRYBE’s list', back: 'Back on TRYBE', pay: 'Pay changed',
  tier: 'Earnings tier changed', ads: 'Running more Meta ads', top100: 'In the Top 100',
}

/** Good news for a creator first, then the rest. */
export const CHANGE_ORDER: ChangeKind[] = ['new', 'pay', 'tier', 'ads', 'top100', 'back', 'left']

/** One line about one change, in plain words. */
export function changeLine(c: Pick<Change, 'kind' | 'before' | 'after'>): string {
  const b = c.before || ''
  const a = c.after || ''
  switch (c.kind) {
    case 'new': return a ? `New on TRYBE, pays ${a}` : 'New on TRYBE'
    case 'left': return 'No longer on TRYBE’s brand list'
    case 'back': return 'Back on TRYBE’s brand list'
    case 'pay': return b && a ? `Pay changed from ${b} to ${a}` : `Pay is now ${a || 'not shown'}`
    case 'tier': return b && a ? `Creators' earnings tier went from ${b} to ${a}` : `Earnings tier: ${a}`
    case 'ads': return !b || b === '0' ? `Started running Meta ads (${a} active)` : `Meta ads went from ${b} to ${a}`
    case 'top100': return a ? `Entered TRYBE's Top 100 (best #${a})` : 'Entered TRYBE’s Top 100'
  }
}

/** A change's day in the viewer's own clock, as YYYY-MM-DD (What changed's
 *  Day pick, Seb 2026-10-17: "do ... two"). Pure. */
export function changeDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The days with changes, newest first, with how many each. Pure. */
export function changeDays(list: Array<{ at: string }>): Array<{ day: string; n: number }> {
  const m = new Map<string, number>()
  for (const c of list) { const k = changeDay(c.at); m.set(k, (m.get(k) || 0) + 1) }
  return Array.from(m.entries()).map(([day, n]) => ({ day, n })).sort((a, b) => b.day.localeCompare(a.day))
}

/** What the writes to MVP's copy changed, brand by brand. `prev` is what was
 *  kept before the write (absent for a brand MVP never saw); `next` is what
 *  was written. `firstCollection` is true while MVP's copy is being filled
 *  the first time: then nothing is "new". Pure. */
export function directoryChanges(
  rows: Array<{ brand_id: string; pay_text: string | null }>,
  prev: Map<string, { pay_text?: string | null; left_at?: string | null }>,
  firstCollection: boolean,
): Change[] {
  const out: Change[] = []
  for (const r of rows) {
    const p = prev.get(r.brand_id)
    if (!p) { if (!firstCollection) out.push({ brand_id: r.brand_id, kind: 'new', before: null, after: r.pay_text }); continue }
    if (p.left_at) out.push({ brand_id: r.brand_id, kind: 'back', before: null, after: null })
    const was = (p.pay_text || '').trim()
    const now = (r.pay_text || '').trim()
    if (was && now && was !== now) out.push({ brand_id: r.brand_id, kind: 'pay', before: was, after: now })
  }
  return out
}

/** A Meta ad count worth telling: from none to some, or half again and at
 *  least 5 more. Pure. */
export function adsChange(before: number | null, after: number): boolean {
  if (after <= 0) return false
  if (before == null || before <= 0) return true
  return after - before >= 5 && after >= before * 1.5
}

// ── Members' combined numbers ────────────────────────────────────────────────

/** Members needed before a brand's combined number shows. */
export const POOL_MIN = 5
/** The most of a figure one member may be. */
export const POOL_MAX_SHARE = 0.5

export interface MemberRow {
  user_id: string; brand_id: string; approved: number | null; rejected: number | null; earnings: number | null
  /** How fast the brand decides this member's videos (migration 431):
   *  the median days, how many videos that is from, and of the videos sent
   *  7 to 60 days ago, how many still wait past 7 days. */
  review_days?: number | null; review_n?: number | null; slow?: number | null; recent?: number | null
}

export interface Pooled {
  /** Members with decided videos for this brand. */
  members: number
  /** Approved over approved plus rejected, 0 to 1; null when it may not show. */
  approvalRate: number | null
  /** Dollars per approved video; null when it may not show. */
  payPerApproved: number | null
  /** Days the brand takes to decide a video (the middle member's middle
   *  video), and the share of videos still waiting past 7 days; null when
   *  they may not show. */
  reviewDays?: number | null
  slowShare?: number | null
  /** Why a figure is not shown, in words. */
  why: string | null
}

/** The mean once the lowest and highest are set aside (with 5 or more), so
 *  no one member's figure is the one shown. */
const trimmedMean = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const t = s.length >= 5 ? s.slice(1, -1) : s; return t.reduce((n, x) => n + x, 0) / t.length }
/** Rounded so a figure cannot be worked back to one member's (review
 *  2026-10-24): rates to 5 points, pay to $5, days to whole days. */
const to5pts = (x: number) => Math.round(x * 20) / 20
const to5usd = (x: number) => Math.max(5, Math.round(x / 5) * 5)

/** Combines members' rows for each brand. A figure shows only with at least
 *  POOL_MIN members in it and no one member more than POOL_MAX_SHARE of it,
 *  rounded, and never with the asking member's own row in it (`exclude`), so
 *  changing one's own numbers cannot reveal anyone else's. An approval rate
 *  counts only members whose approved AND rejected videos were read: a
 *  rejected count not read is not zero. Pure. */
export function poolBrands(rows: MemberRow[], opts: { exclude?: string | null } = {}): Map<string, Pooled> {
  const by = new Map<string, MemberRow[]>()
  for (const r of rows) {
    if (opts.exclude && r.user_id === opts.exclude) continue
    const l = by.get(r.brand_id) || []; l.push(r); by.set(r.brand_id, l)
  }
  const out = new Map<string, Pooled>()
  for (const [id, list] of by) {
    const decided = list.filter((r) => r.approved != null && r.rejected != null).map((r) => ({ a: Math.max(0, r.approved as number), d: Math.max(0, r.approved as number) + Math.max(0, r.rejected as number) })).filter((x) => x.d > 0)
    const totalD = decided.reduce((n, x) => n + x.d, 0)
    const rateOk = decided.length >= POOL_MIN && totalD > 0 && decided.every((x) => x.d / totalD <= POOL_MAX_SHARE)
    const paid = list.filter((r) => (r.approved ?? 0) > 0 && r.earnings != null && r.earnings >= 0)
    const totalE = paid.reduce((n, r) => n + (r.earnings as number), 0)
    const totalA = paid.reduce((n, r) => n + (r.approved as number), 0)
    const payOk = paid.length >= POOL_MIN && totalE > 0 && totalA > 0
      && paid.every((r) => (r.earnings as number) / totalE <= POOL_MAX_SHARE && (r.approved as number) / totalA <= POOL_MAX_SHARE)
    // REVIEW SPEED (Huntr's "review speed", Seb 2026-10-14): each member's
    // own middle figure counts once, so no one member sets it.
    const timed = list.filter((r) => r.review_days != null && r.review_days >= 0 && (r.review_n ?? 0) >= 2)
    const reviewOk = timed.length >= POOL_MIN
    const waited = list.filter((r) => (r.recent ?? 0) > 0 && r.slow != null)
    const totalR = waited.reduce((n, r) => n + (r.recent as number), 0)
    const slowOk = waited.length >= POOL_MIN && totalR > 0 && waited.every((r) => (r.recent as number) / totalR <= POOL_MAX_SHARE)
    out.set(id, {
      reviewDays: reviewOk ? Math.round(trimmedMean(timed.map((r) => r.review_days as number))) : null,
      slowShare: slowOk ? to5pts(waited.reduce((n, r) => n + Math.min(r.slow as number, r.recent as number), 0) / totalR) : null,
      // How many: only "at least POOL_MIN" once it shows, never the exact count.
      members: Math.min(decided.length, POOL_MIN),
      approvalRate: rateOk ? to5pts(decided.reduce((n, x) => n + x.a, 0) / totalD) : null,
      payPerApproved: payOk ? to5usd(totalE / totalA) : null,
      why: rateOk || payOk ? null
        : decided.length < POOL_MIN ? `Shown once ${POOL_MIN} MVP members have results for this brand.`
        : 'Not shown yet: one member is most of this brand’s results.',
    })
  }
  return out
}
