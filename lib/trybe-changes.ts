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

export interface MemberRow { user_id: string; brand_id: string; approved: number | null; rejected: number | null; earnings: number | null }

export interface Pooled {
  /** Members with decided videos for this brand. */
  members: number
  /** Approved over approved plus rejected, 0 to 1; null when it may not show. */
  approvalRate: number | null
  /** Dollars per approved video; null when it may not show. */
  payPerApproved: number | null
  /** Why a figure is not shown, in words. */
  why: string | null
}

/** Combines members' rows for each brand. A figure shows only with at least
 *  POOL_MIN members in it and no one member more than POOL_MAX_SHARE of it.
 *  Pure. */
export function poolBrands(rows: MemberRow[]): Map<string, Pooled> {
  const by = new Map<string, MemberRow[]>()
  for (const r of rows) { const l = by.get(r.brand_id) || []; l.push(r); by.set(r.brand_id, l) }
  const out = new Map<string, Pooled>()
  for (const [id, list] of by) {
    const decided = list.map((r) => ({ a: Math.max(0, r.approved ?? 0), d: Math.max(0, r.approved ?? 0) + Math.max(0, r.rejected ?? 0) })).filter((x) => x.d > 0)
    const totalD = decided.reduce((n, x) => n + x.d, 0)
    const rateOk = decided.length >= POOL_MIN && totalD > 0 && decided.every((x) => x.d / totalD <= POOL_MAX_SHARE)
    const paid = list.filter((r) => (r.approved ?? 0) > 0 && r.earnings != null && r.earnings >= 0)
    const totalE = paid.reduce((n, r) => n + (r.earnings as number), 0)
    const totalA = paid.reduce((n, r) => n + (r.approved as number), 0)
    const payOk = paid.length >= POOL_MIN && totalE > 0 && totalA > 0
      && paid.every((r) => (r.earnings as number) / totalE <= POOL_MAX_SHARE && (r.approved as number) / totalA <= POOL_MAX_SHARE)
    out.set(id, {
      members: decided.length,
      approvalRate: rateOk ? decided.reduce((n, x) => n + x.a, 0) / totalD : null,
      payPerApproved: payOk ? totalE / totalA : null,
      why: rateOk || payOk ? null
        : decided.length < POOL_MIN ? `Shown once ${POOL_MIN} MVP members have results for this brand (${decided.length} so far).`
        : 'Not shown yet: one member is most of this brand’s results.',
    })
  }
  return out
}
