// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR VIDEOS ON TRYBE, LISTED AND SEARCHED (Seb, 2026-10-29: "is there a
// way we can filter and do searches to check for pending submissions,
// rejected ones"). Analytics counted submissions by status; tapping a count
// now lists those videos, from every brand or the one picked, with a search
// over the product, the brand, TRYBE's status and the brand's feedback. The
// period rule is the counts' own (lib/trybe-analytics countSubmissions), so
// the list and its chips agree. Pure, tested in scripts/test-trybe-sub-list.

import { analyticsStatus, type AnalyticsStatus } from '@/lib/trybe-analytics'
import type { Submission } from '@/lib/trybe-mybrands'

export interface ListedSub {
  id: string
  brandId: string
  brand: string
  logo: string | null
  status: AnalyticsStatus
  /** TRYBE's own word, shown when MVP could not place it. */
  rawStatus: string
  at: number | null
  decidedAt: number | null
  product: string | null
  thumbnail: string | null
  reason: string | null
}

export type SubFilter = AnalyticsStatus | 'all'

export const STATUS_WORDS: Record<AnalyticsStatus, string> = {
  pending: 'Pending', revision: 'Revision', rejected: 'Rejected', approved: 'Approved', other: 'Other',
}
/** The chips' order: what needs the creator first. */
export const FILTER_ORDER: SubFilter[] = ['all', 'pending', 'revision', 'rejected', 'approved', 'other']

/** One brand's submissions in the last `days`. One with no date is kept,
 *  since TRYBE was asked for that period. Pure. */
export function listedOf(brand: { id: string; name: string; logo: string | null }, subs: Submission[], days: number, now = Date.now()): ListedSub[] {
  const from = now - days * 86_400_000
  return subs.filter((s) => s.at == null || s.at >= from).map((s) => ({
    id: s.id, brandId: brand.id, brand: brand.name, logo: brand.logo,
    status: analyticsStatus(s.rawStatus), rawStatus: s.rawStatus,
    at: s.at, decidedAt: s.decidedAt ?? null, product: s.product, thumbnail: s.thumbnail, reason: s.reason ?? null,
  }))
}

/** Every word of the search is somewhere in the product, the brand, the
 *  status or the brand's feedback. Pure. */
export function subMatches(s: ListedSub, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [s.product, s.brand, s.rawStatus, STATUS_WORDS[s.status], s.reason].filter(Boolean).join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** The videos a chip, the search and the brand chip keep, newest first.
 *  Pure. */
export function filterSubs(list: ListedSub[], filter: SubFilter, query: string, brandId: string | null = null): ListedSub[] {
  return list
    .filter((s) => (!brandId || s.brandId === brandId) && (filter === 'all' || s.status === filter) && subMatches(s, query))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

/** How many each chip would show under the same search and brand. Pure. */
export function statusTally(list: ListedSub[], query: string, brandId: string | null = null): Record<SubFilter, number> {
  const t: Record<SubFilter, number> = { all: 0, pending: 0, revision: 0, rejected: 0, approved: 0, other: 0 }
  for (const s of filterSubs(list, 'all', query, brandId)) { t.all++; t[s.status]++ }
  return t
}
