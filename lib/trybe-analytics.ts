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

import { subStatus } from '@/lib/trybe-mybrands'
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
