'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SUBMISSIONS, ITS OWN TAB (Seb, 2026-10-30: "a tab where we can see our
// submissions to brands. So all of our video upload submissions, where we
// can filter through rejections, submissions that were approved, and also
// ones that are requiring revisions. So everything would be very, very clear
// to see"). Every video sent to a TRYBE brand, all time by default, read
// from the creator's own TRYBE through SCOUT (useTrybeAllSubs); MVP keeps
// none of it. Status chips, a brand pick, a window and a search, over the
// same rows Analytics shows (TrybeSubList): what the brand wrote, how long a
// video has been in review, and a link to the brand on TRYBE.

import { useMemo, useState } from 'react'
import { Loader2, RotateCcw, Search, ListChecks } from 'lucide-react'
import TrybeSubList from '@/components/labs/TrybeSubList'
import { useTrybeAllSubs } from '@/components/labs/useTrybeSubmissions'
import type { SubFilter } from '@/lib/trybe-sub-list'

const PURPLE = '#7C3AED'
const soft = { color: 'var(--text-3)' }
const WINDOWS: { days: number | null; label: string }[] = [
  { days: null, label: 'All time' }, { days: 90, label: 'Last 90 days' }, { days: 30, label: 'Last 30 days' }, { days: 7, label: 'Last 7 days' },
]

export default function TrybeSubmissions({ canRead }: { canRead: boolean }) {
  const { state, reload } = useTrybeAllSubs(canRead)
  const [filter, setFilter] = useState<SubFilter>('all')
  const [query, setQuery] = useState('')
  const [brandId, setBrandId] = useState<string | null>(null)
  const [days, setDays] = useState<number | null>(null)

  const inWindow = useMemo(() => {
    const list = state?.list ?? []
    if (!days) return list
    const from = Date.now() - days * 86_400_000
    return list.filter((s) => s.at == null || s.at >= from)
  }, [state, days])
  // The brands with a video in the window, the busiest first.
  const brands = useMemo(() => {
    const by = new Map<string, { id: string; name: string; n: number }>()
    for (const s of inWindow) { const b = by.get(s.brandId) ?? { id: s.brandId, name: s.brand, n: 0 }; b.n++; by.set(s.brandId, b) }
    return [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
  }, [inWindow])
  const brand = brands.find((b) => b.id === brandId) ?? null

  return (
    <section className="rounded-xl border p-3.5 mb-4" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }} aria-label="Submissions">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="w-8 h-8 shrink-0 rounded-lg inline-flex items-center justify-center" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}><ListChecks size={16} /></span>
        <div className="min-w-[12rem] flex-1">
          <p className="text-[14.5px] font-bold leading-tight">Your submissions</p>
          <p className="text-[12px]" style={soft}>Every video you sent to a TRYBE brand, and where it stands. Read from your TRYBE just now; MVP keeps none of it.</p>
        </div>
        <button onClick={reload} disabled={!!state?.loading} className="text-[12px] font-semibold inline-flex items-center gap-1 underline disabled:opacity-50" style={{ color: PURPLE }}>
          {state?.loading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Read again
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-2)' }} role="group" aria-label="When">
          {WINDOWS.map((w) => (
            <button key={w.label} onClick={() => setDays(w.days)} aria-pressed={days === w.days} className="text-[12px] font-semibold px-2.5 py-1"
              style={days === w.days ? { background: PURPLE, color: '#fff' } : { color: 'var(--text-2)' }}>{w.label}</button>
          ))}
        </div>
        <select value={brandId ?? ''} onChange={(e) => setBrandId(e.target.value || null)} aria-label="Brand"
          className="rounded-lg border px-2 py-1 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border-2)', color: 'var(--text)' }}>
          <option value="">All brands ({brands.length})</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.n})</option>)}
        </select>
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={soft} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: product, brand, or what the brand wrote"
            className="w-full rounded-lg border pl-8 pr-3 py-1.5 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
        </div>
      </div>

      {!state && <p className="text-[12px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading your submissions from TRYBE</p>}
      {state && (
        <TrybeSubList state={{ ...state, list: inWindow }} filter={filter} setFilter={setFilter} query={query}
          brandId={brand?.id ?? null} brandName={brand?.name ?? null} days={days} />
      )}
    </section>
  )
}
