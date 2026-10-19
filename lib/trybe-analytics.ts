// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE'S ANALYTICS, IN MVP (Seb, 2026-10-19, with screenshots of TRYBE's
// Analytics screen: "this is what we can get from Trybe and should also be
// showing inside of MVP's feature"). TRYBE shows, for 7, 14 or 30 days and
// for all brands or one: Total Submissions split into approved, pending,
// revision and rejected with an approval rate, then total earnings, average
// watch time, active ads, hook rate, impressions, click through and link
// clicks, then the top earning videos.
//
// The ad numbers were already read (lib/trybe-ads, "Your ads, live"). This
// adds the submissions, per brand, from each brand's own submissions list
// (GET /backend/api/creator/v2/brands/{id}/submissions, which SCOUT already
// reads for My brands), and the brand filter. Pure, tested in
// scripts/test-trybe-analytics.

import { subStatus, type MyBrand } from '@/lib/trybe-mybrands'
import { fillTotals, NO_TOTALS, type AdTotals, type AdVideo } from '@/lib/trybe-ads'

export type AnalyticsStatus = 'approved' | 'pending' | 'revision' | 'rejected' | 'other'

/** TRYBE's status word as one of its four Analytics rows. A revision is asked
 *  for before it is decided, so it is checked first ("REVISION_REQUESTED"
 *  would otherwise read as pending or as nothing). */
export function analyticsStatus(raw: string): AnalyticsStatus {
  const s = String(raw || '').toLowerCase().replace(/[\s-]+/g, '_')
  if (/revis|changes?_request|request_changes|resubmi|needs_(edit|change)|edit_request/.test(s)) return 'revision'
  const base = subStatus(raw)
  return base === 'other' ? 'other' : base
}

export interface SubmissionCounts {
  total: number
  approved: number
  pending: number
  revision: number
  rejected: number
  /** Statuses MVP could not place, counted in total so it matches TRYBE's. */
  other: number
}
export const NO_COUNTS: SubmissionCounts = { total: 0, approved: 0, pending: 0, revision: 0, rejected: 0, other: 0 }

/** Submissions in the last `days`: one with no date is counted, since TRYBE
 *  was asked for that period. Pure. */
export function countSubmissions(subs: Array<{ rawStatus: string; at: number | null }>, days: number, now = Date.now()): SubmissionCounts {
  const from = now - days * 86_400_000
  const c = { ...NO_COUNTS }
  for (const s of subs) {
    if (s.at != null && s.at < from) continue
    c.total++
    c[analyticsStatus(s.rawStatus)]++
  }
  return c
}

export function addCounts(a: SubmissionCounts, b: SubmissionCounts): SubmissionCounts {
  return { total: a.total + b.total, approved: a.approved + b.approved, pending: a.pending + b.pending, revision: a.revision + b.revision, rejected: a.rejected + b.rejected, other: a.other + b.other }
}

/** TRYBE's approval rate: approved out of everything submitted in the
 *  period (its screen shows 0% for one video still pending). Null when
 *  nothing was submitted. */
export function approvalRateOf(c: SubmissionCounts): number | null {
  return c.total ? c.approved / c.total : null
}

/** The same brand, whichever way a video or a submission names it. */
export function sameBrand(v: { brandId: string | null; brand: string | null }, b: { id: string; name: string }): boolean {
  if (v.brandId && v.brandId === b.id) return true
  return !!v.brand && v.brand.trim().toLowerCase() === b.name.trim().toLowerCase()
}

/** The ad numbers for one brand, added up from its videos: TRYBE's totals
 *  are for all brands, so one brand's are only ever its videos' own. */
export function brandAdTotals(videos: AdVideo[], b: { id: string; name: string }): { totals: AdTotals; videos: AdVideo[] } {
  const mine = videos.filter((v) => sameBrand(v, b))
  return { totals: fillTotals({ ...NO_TOTALS }, mine), videos: mine }
}

// ── TRYBE'S OWN TOTALS FIRST (Seb, 2026-10-19: one submission pending on
// TRYBE's app, zero in MVP). Counting each brand's list read only the 25
// brands that had earned the most, and a creator with hundreds of brands had
// the pending one further down. TRYBE's analytics answer and its per-brand
// totals for the period are what its own screen shows, so they come first;
// the lists are the last resort. ─────────────────────────────────────────

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  if (isObj(v)) return num(v.count ?? v.total ?? v.value)
  return null
}

const SUB_KEYS: Record<'total' | 'approved' | 'pending' | 'revision' | 'rejected', string[]> = {
  total: ['totalSubmissions', 'total_submissions', 'submissionsTotal', 'submissionCount', 'submissionsCount', 'submissions_count', 'totalSubmissionCount'],
  approved: ['approvedSubmissions', 'approved_submissions', 'approvedCount', 'approved'],
  pending: ['pendingSubmissions', 'pending_submissions', 'pendingCount', 'inReviewSubmissions', 'pending', 'inReview', 'underReview'],
  revision: ['revisionSubmissions', 'revision_submissions', 'revisionRequestedSubmissions', 'revisionCount', 'revisions', 'revision', 'needsRevision', 'changesRequested'],
  rejected: ['rejectedSubmissions', 'rejected_submissions', 'rejectedCount', 'declinedSubmissions', 'rejected', 'declined'],
}
// Where a dashboard answer keeps its counts: the answer itself, or an object
// named for submissions or statuses, one or two levels in.
const HOLDERS = /submission|status|summary|totals|overview|stats|kpis|counts/i

function holders(root: Obj): Obj[] {
  const out: Obj[] = [root]
  for (const [k, v] of Object.entries(root)) {
    if (!isObj(v) || !HOLDERS.test(k)) continue
    out.push(v)
    for (const [k2, v2] of Object.entries(v)) if (isObj(v2) && HOLDERS.test(k2)) out.push(v2)
  }
  return out
}

/** Submission counts in TRYBE's analytics answer, or null when it carries
 *  none MVP knows (then the brand totals are used). A nested "submissions"
 *  object may name its counts plainly: total, approved, pending. Pure. */
export function readSubmissionTotals(json: unknown): SubmissionCounts | null {
  const root = isObj(json) && isObj(json.data) ? json.data : json
  if (!isObj(root)) return null
  const places = holders(root)
  const find = (keys: string[], plain?: string[]) => {
    for (const p of places) for (const k of keys) {
      const hit = Object.keys(p).find((n) => n.toLowerCase() === k.toLowerCase())
      if (hit && num(p[hit]) != null) return num(p[hit])
    }
    for (const p of places.slice(1)) for (const k of plain || []) if (num(p[k]) != null) return num(p[k])
    return null
  }
  const c = {
    total: find(SUB_KEYS.total, ['total', 'count', 'all']),
    approved: find(SUB_KEYS.approved),
    pending: find(SUB_KEYS.pending),
    revision: find(SUB_KEYS.revision),
    rejected: find(SUB_KEYS.rejected),
  }
  if (Object.values(c).every((v) => v == null)) return null
  const known = (c.approved ?? 0) + (c.pending ?? 0) + (c.revision ?? 0) + (c.rejected ?? 0)
  const total = c.total ?? known
  return { total, approved: c.approved ?? 0, pending: c.pending ?? 0, revision: c.revision ?? 0, rejected: c.rejected ?? 0, other: Math.max(0, total - known) }
}

/** One brand's counts from its totals for the period, or null when TRYBE
 *  gave none. Pure. */
export function brandCounts(b: Pick<MyBrand, 'submitted' | 'approved' | 'pending' | 'rejected' | 'revision'>): SubmissionCounts | null {
  if ([b.submitted, b.approved, b.pending, b.rejected, b.revision].every((v) => v == null)) return null
  const approved = b.approved ?? 0, pending = b.pending ?? 0, rejected = b.rejected ?? 0, revision = b.revision ?? 0
  const known = approved + pending + rejected + revision
  const total = b.submitted ?? known
  return { total, approved, pending, revision, rejected, other: Math.max(0, total - known) }
}
