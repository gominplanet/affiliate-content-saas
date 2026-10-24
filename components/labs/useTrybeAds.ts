'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR ADS, LIVE, read from the creator's own TRYBE through SCOUT 1.47.0
// (lib/trybe-ads). Each period's totals and videos are read once and kept
// for this visit (five minutes), so switching 7, 14 and 30 days is instant.
// An older SCOUT, a signed out TRYBE and an answer MVP cannot read are each
// said in their own words, never shown as zeros. With an older SCOUT, what
// you earned per period is still read from your brand totals (SCOUT 1.46.0).

import { useCallback, useEffect, useState } from 'react'
import { requestTrybeApi, type TrybeApiResult } from '@/lib/extension-frame'
import { readBrandStats, keysOf } from '@/lib/trybe-mybrands'
import { readAdTotals, readAdVideos, fillTotals, readCount, adBrands, adWinners, NO_TOTALS, PERIOD_DAYS, type AdPeriod, type AdTotals, type AdVideo, type AdWinner } from '@/lib/trybe-ads'

export interface AdsRead {
  period: AdPeriod
  totals: AdTotals
  videos: AdVideo[]
  /** 'full': SCOUT 1.47.0 read your ad results. 'earnings': an older SCOUT,
   *  so only what you earned per brand was read. */
  source: 'full' | 'earnings'
  /** Which of TRYBE's two answers came back (review 2026-10-24): totals not
   *  read are added up from the videos (at most 100) and said so; videos not
   *  read are never "no videos ran as ads". Absent on older kept reads. */
  totalsRead?: boolean
  videosRead?: boolean
  /** Why the videos did not read, in TRYBE's or SCOUT's own words (Seb,
   *  2026-10-24: "not loading here", with no reason on screen). */
  videosWhy?: string | null
  /** For an admin when the answer had nothing MVP knows: its keys. */
  keys: string | null
  at: number
}

export type AdsProblem = { kind: 'old' | 'signedout' | 'failed'; text: string }

const TTL = 5 * 60_000
const cache = new Map<AdPeriod, AdsRead>()

const problemOf = (error: string | undefined, status?: number): AdsProblem =>
  error === 'not-allowed' ? { kind: 'old', text: 'Your ad results need SCOUT 1.47.0. Chrome updates SCOUT by itself within a day; to do it now, open chrome://extensions, turn on Developer mode and press Update, then reload this page.' }
    : status === 401 || status === 403 ? { kind: 'signedout', text: 'TRYBE says you are signed out. Sign in to TRYBE in this browser, then press Read again.' }
      : { kind: 'failed', text: `MVP could not read your ad results from TRYBE just now${error ? ` (${error}${status ? `, TRYBE answered ${status}` : ''})` : ''}. Press Read again.` }

/** What a refused request said: TRYBE's status and its own message, or SCOUT's. */
function whyNot(r: TrybeApiResult): string {
  const j = r.json as Record<string, unknown> | null | undefined
  const said = j && typeof j === 'object' ? [j.message, j.error, j.detail].find((x) => typeof x === 'string' && x.trim()) as string | undefined : undefined
  const words = (said || (r.text || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 140)
  return r.status ? `TRYBE answered ${r.status}${words ? `: ${words}` : ''}` : (r.error || 'SCOUT did not answer')
}

/** THE AD VIDEOS, ASKED MORE THAN ONE WAY. The address comes from TRYBE's
 *  page code and its limit was never confirmed: a page size TRYBE does not
 *  take is refused (400 or 422) while the totals still read, and a busy
 *  TRYBE (500s) or a slow tab answers the next time. So: 100, then 50, then
 *  no page size, stopping at signed out or not found. */
async function readVideos(period: AdPeriod): Promise<TrybeApiResult> {
  const base = `/backend/api/creator/v2/analytics/submissions?period=${period}`
  let last: TrybeApiResult = { ok: false, error: 'SCOUT did not answer.' }
  for (const path of [`${base}&limit=100`, `${base}&limit=50`, base]) {
    last = await requestTrybeApi('GET', path)
    if (last.ok || last.status === 401 || last.status === 403 || last.status === 404) break
  }
  return last
}

/** One period, read: the ad results when SCOUT can, else what you earned. */
export async function readAds(period: AdPeriod, fresh = false): Promise<{ read: AdsRead | null; problem: AdsProblem | null }> {
  const kept = cache.get(period)
  if (!fresh && kept && Date.now() - kept.at < TTL) return { read: kept, problem: null }
  const [t, v] = await Promise.all([
    requestTrybeApi('GET', `/backend/api/creator/v2/analytics?period=${period}`),
    readVideos(period),
  ])
  if (t.ok || v.ok) {
    // The totals answer carries a submissions entry: when it is the list of
    // videos, it stands in for a videos answer that did not come. Only a list
    // with videos in it counts, so an empty one is never "no ads ran".
    const fromTotals = !v.ok && t.ok ? readAdVideos(t.json) : []
    const videosRead = v.ok || fromTotals.length > 0
    const videos = v.ok ? readAdVideos(v.json) : fromTotals
    const totals = fillTotals(t.ok ? readAdTotals(t.json) : { ...NO_TOTALS }, videos)
    const read: AdsRead = { period, totals, videos, source: 'full', totalsRead: t.ok, videosRead, videosWhy: videosRead ? null : whyNot(v), keys: readCount(totals) ? null : `analytics: ${t.ok ? keysOf(t.json) : 'not read'}; submissions: ${v.ok ? keysOf(v.json) : 'not read'}`, at: Date.now() }
    cache.set(period, read)
    return { read, problem: null }
  }
  const problem = problemOf(t.error, t.status)
  if (problem.kind === 'signedout') return { read: null, problem }
  // An older SCOUT, or an answer TRYBE refused: what you earned with each
  // brand in the period still reads from your brand totals.
  const b = await requestTrybeApi('GET', `/backend/api/creator/v2/brands/stats?period=${period}`)
  if (!b.ok) return { read: null, problem }
  const brands = readBrandStats(b.json)
  const earned = brands.reduce((n, x) => n + (x.earnings ?? 0), 0)
  const videos: AdVideo[] = brands.filter((x) => (x.earnings ?? 0) > 0).map((x) => ({ ...NO_TOTALS, id: `brand-${x.id}`, title: null, brand: x.name, brandId: x.id, thumbnail: null, live: null, earned: x.earnings }))
  const read: AdsRead = { period, totals: { ...NO_TOTALS, earned: brands.some((x) => x.earnings != null) ? earned : null }, videos, source: 'earnings', keys: null, at: Date.now() }
  cache.set(period, read)
  return { read, problem: problem.kind === 'old' ? problem : { kind: 'failed', text: `${problem.text.replace(/ Press Read again\.$/, '')} What you earned with each brand is shown instead.` } }
}

/** The brands winning on ads in the last 30 days, for Your stage. Null when
 *  they could not be read (an older SCOUT included): the stage then judges
 *  by approvals and pay only, as before. */
export async function readAdWinners(): Promise<AdWinner[] | null> {
  const { read } = await readAds('30d').catch(() => ({ read: null }))
  if (!read || read.source !== 'full' || !read.videos.length) return null
  return adWinners(adBrands(read.videos), 30)
}

export function useTrybeAds(canRead: boolean, period: AdPeriod) {
  const [read, setRead] = useState<AdsRead | null>(() => cache.get(period) ?? null)
  const [week, setWeek] = useState<AdTotals | null>(() => cache.get('7d')?.totals ?? null)
  const [month, setMonth] = useState<AdTotals | null>(() => cache.get('30d')?.totals ?? null)
  const [problem, setProblem] = useState<AdsProblem | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!canRead) return
    let gone = false
    setLoading(true)
    ;(async () => {
      const fresh = nonce > 0
      const r = await readAds(period, fresh).catch((e) => ({ read: null, problem: { kind: 'failed' as const, text: e instanceof Error ? e.message : 'SCOUT did not answer.' } }))
      if (gone) return
      setRead(r.read); setProblem(r.problem)
      // The pace: a day in the last 7 against a day in the last 30.
      const [w, m] = await Promise.all([
        period === '7d' ? Promise.resolve(r) : readAds('7d', fresh).catch(() => ({ read: null })),
        period === '30d' ? Promise.resolve(r) : readAds('30d', fresh).catch(() => ({ read: null })),
      ])
      if (gone) return
      setWeek(w.read?.totals ?? null); setMonth(m.read?.totals ?? null)
    })().finally(() => { if (!gone) setLoading(false) })
    return () => { gone = true }
  }, [canRead, period, nonce])

  return { read, week, month, problem, loading, reload, days: PERIOD_DAYS[period] }
}
