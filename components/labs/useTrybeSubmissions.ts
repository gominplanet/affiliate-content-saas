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

import { useCallback, useEffect, useRef, useState } from 'react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats, readSubmissions, keysOf, type MyBrand, type Submission } from '@/lib/trybe-mybrands'
import { listedOf, type ListedSub } from '@/lib/trybe-sub-list'
import { countSubmissions, readSubmissionTotals, brandCounts, addCounts, NO_COUNTS, type SubmissionCounts } from '@/lib/trybe-analytics'
import { PERIOD_DAYS, type AdPeriod } from '@/lib/trybe-ads'

export type SubsSource = 'analytics' | 'brand totals' | 'brand lists'
export interface BrandSubs { id: string; name: string; logo: string | null; counts: SubmissionCounts; read: boolean
  /** What TRYBE says you earned with it in the period; null when not read
   *  (or only all time was read). */
  earned?: number | null
  /** Its totals are counted but not split by status (past the lists read). */
  partial?: boolean }
export interface SubsRead {
  period: AdPeriod
  brands: BrandSubs[]
  /** All brands together: TRYBE's own totals when its analytics answer had
   *  them, else the brands added up. */
  all: SubmissionCounts
  source: SubsSource
  notRead: number
  /** Brands whose totals count but are not split by status. */
  partial?: number
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

// A brand's own list, kept for this visit, so the counts and the videos
// list (useTrybeSubList) read it once between them.
const lists = new Map<string, { subs: Submission[]; at: number }>()

async function listOf(id: string, period: AdPeriod | 'all', fresh = false): Promise<Submission[] | null> {
  const key = `${period}:${id}`
  const kept = lists.get(key)
  if (!fresh && kept && Date.now() - kept.at < TTL) return kept.subs
  const base = `/backend/api/creator/v2/brands/${encodeURIComponent(id)}/submissions?page=1&limit=100`
  let r = await requestTrybeApi('GET', `${base}&period=${period}`)
  // A period TRYBE does not take here: everything, counted by date.
  if (!r.ok && (r.status === 400 || r.status === 422)) r = await requestTrybeApi('GET', period === 'all' ? base : `${base}&period=all`)
  if (!r.ok) return null
  const subs = readSubmissions(r.json)
  lists.set(key, { subs, at: Date.now() })
  return subs
}

async function listCounts(id: string, period: AdPeriod, fresh = false): Promise<SubmissionCounts | null> {
  const subs = await listOf(id, period, fresh)
  return subs ? countSubmissions(subs, PERIOD_DAYS[period]) : null
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
    if (settled(c)) out.push({ id: b.id, name: b.name, logo: b.logo, counts: c, read: true, earned: listed ? null : b.earnings ?? null })
    else unsettled.push(b)
  }
  // Only where the totals leave a submission unplaced, or there are none:
  // the brand's own list, four at a time, the most active first.
  const when = (b: MyBrand) => Date.parse(b.enrolledAt || '') || 0
  unsettled.sort((x, y) => (y.submitted ?? 0) - (x.submitted ?? 0) || when(y) - when(x))
  const toList = unsettled.slice(0, MAX_LISTS)
  for (let i = 0; i < toList.length; i += 4) {
    const part = await Promise.all(toList.slice(i, i + 4).map(async (b) => {
      const c = await listCounts(b.id, period, fresh).catch(() => null)
      const fallback = listed ? null : brandCounts(b)
      return { id: b.id, name: b.name, logo: b.logo, read: c != null || fallback != null, counts: c ?? fallback ?? { ...NO_COUNTS }, earned: listed ? null : b.earnings ?? null }
    }))
    out.push(...part)
  }
  // Past the lists read: their totals still count (TRYBE gave them), only
  // not split by status. They used to vanish from All, and "Press Read
  // again" never brought them back (review 2026-10-24).
  for (const b of unsettled.slice(MAX_LISTS)) {
    const fallback = listed ? null : brandCounts(b)
    out.push({ id: b.id, name: b.name, logo: b.logo, read: fallback != null, partial: fallback != null, counts: fallback ?? { ...NO_COUNTS }, earned: listed ? null : b.earnings ?? null })
  }
  const notRead = out.filter((b) => !b.read).length
  const summed = out.reduce((acc, b) => addCounts(acc, b.counts), { ...NO_COUNTS })
  const read: SubsRead = {
    period, brands: out,
    all: fromAnalytics ?? summed,
    source: fromAnalytics ? 'analytics' : listed || toList.length ? 'brand lists' : 'brand totals',
    notRead: fromAnalytics ? 0 : notRead,
    partial: fromAnalytics ? 0 : out.filter((b) => b.partial).length,
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

/** Brands whose videos the list reads, the busiest first. */
export const MAX_LIST_BRANDS = 40

export interface SubList {
  list: ListedSub[]
  /** Brands read so far, out of `of`. */
  done: number
  of: number
  /** Brands whose list TRYBE did not give. */
  failed: string[]
  /** Brands past MAX_LIST_BRANDS, not read. */
  skipped: number
  loading: boolean
  /** The brands could not be read at all: why, in words. */
  error?: string
}

/** YOUR VIDEOS, LISTED (Seb, 2026-10-29: "filter and do searches to check for
 *  pending submissions, rejected ones"). Read only once the list is opened:
 *  each brand with a submission in the period (or whose counts could not be
 *  read), four at a time, from the same lists the counts use. */
export function useTrybeSubList(read: SubsRead | null, open: boolean) {
  const [state, setState] = useState<SubList | null>(null)
  const run = useRef(0)
  const load = useCallback(async (fresh: boolean) => {
    if (!read) return
    const mine = ++run.current
    const want = read.brands.filter((b) => b.counts.total > 0 || !b.read).sort((x, y) => y.counts.total - x.counts.total)
    const go = want.slice(0, MAX_LIST_BRANDS)
    const skipped = want.length - go.length
    const list: ListedSub[] = []
    const failed: string[] = []
    setState({ list: [], done: 0, of: go.length, failed: [], skipped, loading: go.length > 0 })
    for (let i = 0; i < go.length; i += 4) {
      const part = await Promise.all(go.slice(i, i + 4).map(async (b) => ({ b, subs: await listOf(b.id, read.period, fresh).catch(() => null) })))
      if (mine !== run.current) return
      for (const { b, subs } of part) {
        if (subs) list.push(...listedOf(b, subs, PERIOD_DAYS[read.period]))
        else failed.push(b.name)
      }
      setState({ list: [...list], done: Math.min(i + 4, go.length), of: go.length, failed: [...failed], skipped, loading: i + 4 < go.length })
    }
  }, [read])
  useEffect(() => { if (open && read) void load(false) }, [open, read, load])
  return { state, reload: () => void load(true) }
}

/** Brands whose videos the Submissions tab reads, the busiest first. */
export const ALL_TIME_BRANDS = 60
const ALL_TIME = 36_500

/** EVERY VIDEO SENT TO A BRAND (Seb, 2026-10-30: "a tab where we can see our
 *  submissions to brands ... where we can filter through rejections,
 *  submissions that were approved, and also ones that are requiring
 *  revisions"). All time: the brands TRYBE says you sent to, then each one's
 *  own list, four at a time, the busiest first. */
export function useTrybeAllSubs(canRead: boolean) {
  const [state, setState] = useState<SubList | null>(null)
  const run = useRef(0)
  const load = useCallback(async (fresh: boolean) => {
    if (!canRead) return
    const mine = ++run.current
    setState({ list: [], done: 0, of: 0, failed: [], skipped: 0, loading: true })
    const s = await requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all')
    if (mine !== run.current) return
    if (!s.ok) { setState({ list: [], done: 0, of: 0, failed: [], skipped: 0, loading: false, error: words(s.error, s.status) }); return }
    const brands = readBrandStats(s.json)
    const sent = brands.filter((b) => (b.submitted ?? 0) > 0)
    // TRYBE's totals say who you sent to; without them, every brand is read.
    const want = (sent.length ? sent : brands).sort((x, y) => (y.submitted ?? 0) - (x.submitted ?? 0))
    const go = want.slice(0, ALL_TIME_BRANDS)
    const skipped = want.length - go.length
    const list: ListedSub[] = []
    const failed: string[] = []
    setState({ list: [], done: 0, of: go.length, failed: [], skipped, loading: go.length > 0 })
    for (let i = 0; i < go.length; i += 4) {
      const part = await Promise.all(go.slice(i, i + 4).map(async (b) => ({ b, subs: await listOf(b.id, 'all', fresh).catch(() => null) })))
      if (mine !== run.current) return
      for (const { b, subs } of part) {
        if (subs) list.push(...listedOf({ id: b.id, name: b.name, logo: b.logo }, subs, ALL_TIME))
        else failed.push(b.name)
      }
      setState({ list: [...list], done: Math.min(i + 4, go.length), of: go.length, failed: [...failed], skipped, loading: i + 4 < go.length })
    }
  }, [canRead])
  useEffect(() => { void load(false) }, [load])
  return { state, reload: () => void load(true) }
}
