'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR SUBMISSIONS, for TRYBE Analytics (lib/trybe-analytics), read through
// SCOUT and kept for this visit (five minutes).
//
// TRYBE'S OWN TOTALS FIRST (Seb, 2026-10-19: one submission pending on
// TRYBE's app, zero here). The first version counted each brand's list for
// the 25 brands that had earned the most, and a creator with hundreds of
// brands had the pending one further down. Now, in order:
//   1. TRYBE's analytics answer for the period, when it carries the counts
//      (what TRYBE's own Analytics screen shows), for All;
//   2. TRYBE's totals per brand for the period, for each brand chip;
//   3. a brand's own submissions list only where its totals do not say which
//      row a submission is in (pending, say, is not in every answer).
// Which one the numbers came from is kept, and an admin sees it with the
// keys TRYBE sent, so a wrong count can be traced instead of guessed at.

import { useCallback, useEffect, useState } from 'react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats, readSubmissions, keysOf, type MyBrand } from '@/lib/trybe-mybrands'
import { countSubmissions, readSubmissionTotals, brandCounts, addCounts, NO_COUNTS, type SubmissionCounts } from '@/lib/trybe-analytics'
import { PERIOD_DAYS, type AdPeriod } from '@/lib/trybe-ads'

export type SubsSource = 'analytics' | 'brand totals' | 'brand lists'
export interface BrandSubs { id: string; name: string; logo: string | null; counts: SubmissionCounts; read: boolean }
export interface SubsRead {
  period: AdPeriod
  brands: BrandSubs[]
  /** All brands together: TRYBE's own totals when its analytics answer had
   *  them, else the brands added up. */
  all: SubmissionCounts
  source: SubsSource
  notRead: number
  /** For an admin: what TRYBE's answers carried. */
  keys: string
  at: number
}

const TTL = 5 * 60_000
const MAX_LISTS = 25
const cache = new Map<AdPeriod, SubsRead>()

const words = (error?: string, status?: number) =>
  status === 401 || status === 403 ? 'TRYBE says you are signed out. Sign in to TRYBE in this browser, then press Read again.'
    : `MVP could not read your submissions from TRYBE just now${error ? ` (${error}${status ? `, TRYBE answered ${status}` : ''})` : ''}.`

async function listCounts(id: string, period: AdPeriod): Promise<SubmissionCounts | null> {
  const base = `/backend/api/creator/v2/brands/${encodeURIComponent(id)}/submissions?page=1&limit=100`
  let r = await requestTrybeApi('GET', `${base}&period=${period}`)
  // A period TRYBE does not take here: everything, counted by date.
  if (!r.ok && (r.status === 400 || r.status === 422)) r = await requestTrybeApi('GET', `${base}&period=all`)
  return r.ok ? countSubmissions(readSubmissions(r.json), PERIOD_DAYS[period]) : null
}

/** A brand's totals say which row each submission is in. */
const settled = (c: SubmissionCounts | null): c is SubmissionCounts => !!c && (c.total === 0 || c.other === 0)

export async function readSubs(period: AdPeriod, fresh = false): Promise<{ read: SubsRead | null; error: string | null }> {
  const kept = cache.get(period)
  if (!fresh && kept && Date.now() - kept.at < TTL) return { read: kept, error: null }
  const [a, s] = await Promise.all([
    requestTrybeApi('GET', `/backend/api/creator/v2/analytics?period=${period}`),
    requestTrybeApi('GET', `/backend/api/creator/v2/brands/stats?period=${period}`),
  ])
  const fromAnalytics = a.ok ? readSubmissionTotals(a.json) : null
  let brands: MyBrand[] = s.ok ? readBrandStats(s.json) : []
  let listed = false
  // No totals for the period: the brands TRYBE knows you by, all time.
  if (!s.ok || !brands.length) {
    const all = await requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all')
    if (!all.ok && !fromAnalytics) return { read: null, error: words(all.error ?? s.error, all.status ?? s.status) }
    brands = all.ok ? readBrandStats(all.json) : []
    listed = true
  }

  const out: BrandSubs[] = []
  const unsettled: MyBrand[] = []
  for (const b of brands) {
    const c = listed ? null : brandCounts(b)
    if (settled(c)) out.push({ id: b.id, name: b.name, logo: b.logo, counts: c, read: true })
    else unsettled.push(b)
  }
  // Only where the totals leave a submission unplaced, or there are none:
  // the brand's own list, four at a time, the most active first.
  const when = (b: MyBrand) => Date.parse(b.enrolledAt || '') || 0
  unsettled.sort((x, y) => (y.submitted ?? 0) - (x.submitted ?? 0) || when(y) - when(x))
  const toList = unsettled.slice(0, MAX_LISTS)
  for (let i = 0; i < toList.length; i += 4) {
    const part = await Promise.all(toList.slice(i, i + 4).map(async (b) => {
      const c = await listCounts(b.id, period).catch(() => null)
      const fallback = listed ? null : brandCounts(b)
      return { id: b.id, name: b.name, logo: b.logo, read: c != null || fallback != null, counts: c ?? fallback ?? { ...NO_COUNTS } }
    }))
    out.push(...part)
  }
  const notRead = out.filter((b) => !b.read).length + Math.max(0, unsettled.length - toList.length)
  const summed = out.reduce((acc, b) => addCounts(acc, b.counts), { ...NO_COUNTS })
  const read: SubsRead = {
    period, brands: out,
    all: fromAnalytics ?? summed,
    source: fromAnalytics ? 'analytics' : listed || toList.length ? 'brand lists' : 'brand totals',
    notRead: fromAnalytics ? 0 : notRead,
    keys: `analytics: ${a.ok ? keysOf(a.json) : `not read (${a.status ?? a.error ?? '?'})`}; brand totals: ${s.ok ? keysOf(s.json) : `not read (${s.status ?? s.error ?? '?'})`}`,
    at: Date.now(),
  }
  cache.set(period, read)
  return { read, error: null }
}

export function useTrybeSubmissions(canRead: boolean, period: AdPeriod) {
  const [read, setRead] = useState<SubsRead | null>(() => cache.get(period) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(async (fresh: boolean) => {
    if (!canRead) return
    setLoading(true)
    try {
      const r = await readSubs(period, fresh)
      setRead(r.read); setError(r.error)
    } catch { setError(words()) } finally { setLoading(false) }
  }, [canRead, period])
  useEffect(() => { setRead(cache.get(period) ?? null); void load(false) }, [load, period])
  return { read, error, loading, reload: () => void load(true) }
}
