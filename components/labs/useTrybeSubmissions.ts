'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR SUBMISSIONS PER BRAND, for TRYBE Analytics (lib/trybe-analytics). The
// brands come from your brand totals, then each brand's own submissions list
// is read through SCOUT (the same addresses My brands reads) and counted for
// the period: approved, pending, revision, rejected. Kept for this visit (five
// minutes). A brand whose list could not be read is counted as not read and
// said, so a low total never passes for a real one.

import { useCallback, useEffect, useState } from 'react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats, readSubmissions } from '@/lib/trybe-mybrands'
import { countSubmissions, NO_COUNTS, type SubmissionCounts } from '@/lib/trybe-analytics'
import { PERIOD_DAYS, type AdPeriod } from '@/lib/trybe-ads'

export interface BrandSubs { id: string; name: string; logo: string | null; counts: SubmissionCounts; read: boolean }
export interface SubsRead { period: AdPeriod; brands: BrandSubs[]; notRead: number; at: number }

const TTL = 5 * 60_000
const MAX_BRANDS = 25
const cache = new Map<AdPeriod, SubsRead>()

const words = (error?: string, status?: number) =>
  status === 401 || status === 403 ? 'TRYBE says you are signed out. Sign in to TRYBE in this browser, then press Read again.'
    : `MVP could not read your submissions from TRYBE just now${error ? ` (${error}${status ? `, TRYBE answered ${status}` : ''})` : ''}.`

async function brandSubs(id: string, period: AdPeriod) {
  const base = `/backend/api/creator/v2/brands/${encodeURIComponent(id)}/submissions?page=1&limit=100`
  let r = await requestTrybeApi('GET', `${base}&period=${period}`)
  // A period TRYBE does not take here: everything, counted by date below.
  if (!r.ok && (r.status === 400 || r.status === 422)) r = await requestTrybeApi('GET', `${base}&period=all`)
  return r.ok ? readSubmissions(r.json) : null
}

export async function readSubs(period: AdPeriod, fresh = false): Promise<{ read: SubsRead | null; error: string | null }> {
  const kept = cache.get(period)
  if (!fresh && kept && Date.now() - kept.at < TTL) return { read: kept, error: null }
  const s = await requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all')
  if (!s.ok) return { read: null, error: words(s.error, s.status) }
  const list = readBrandStats(s.json).slice(0, MAX_BRANDS)
  const out: BrandSubs[] = []
  // Four at a time: quick for a few brands, gentle on TRYBE for many.
  for (let i = 0; i < list.length; i += 4) {
    const part = await Promise.all(list.slice(i, i + 4).map(async (b) => {
      const subs = await brandSubs(b.id, period).catch(() => null)
      return { id: b.id, name: b.name, logo: b.logo, read: subs != null, counts: subs ? countSubmissions(subs, PERIOD_DAYS[period]) : { ...NO_COUNTS } }
    }))
    out.push(...part)
  }
  const read: SubsRead = { period, brands: out, notRead: out.filter((b) => !b.read).length, at: Date.now() }
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
