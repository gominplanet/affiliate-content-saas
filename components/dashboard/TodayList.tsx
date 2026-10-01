'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TODAY: one ranked list of what needs the creator (Pro), in place of a stack
// of banners. Broken things first, then money waiting, then upkeep. The data
// is lib/today-list via /api/today.
//
// Three outcomes look different on screen: a list, "nothing needs you" (only
// when every source was read), and a failure that says what could not be read.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import type { TodayItem } from '@/lib/today-list'

const TONE: Record<TodayItem['tone'], { color: string; label: string }> = {
  urgent: { color: '#ff3b30', label: 'Fix' },
  money: { color: '#10b981', label: 'Earn' },
  upkeep: { color: '#3b82f6', label: 'Tidy' },
}
const SHOW_FIRST = 5

export default function TodayList() {
  const [items, setItems] = useState<TodayItem[] | null>(null)
  const [unread, setUnread] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [all, setAll] = useState(false)

  const load = useCallback(async () => {
    setError(null); setItems(null)
    try {
      const r = await fetch('/api/today', { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (r.status === 403) { setHidden(true); return }
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setItems(Array.isArray(j.items) ? j.items : [])
      setUnread(Array.isArray(j.unread) ? j.unread : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => { load() }, [load])

  if (hidden) return null
  const shown = items ? (all ? items : items.slice(0, SHOW_FIRST)) : []

  return (
    <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }} aria-labelledby="today-h">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="min-w-0">
          <h2 id="today-h" className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Today</h2>
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            {items === null && !error ? 'Checking everything that might need you…'
              : error ? 'The list could not load.'
                : items && items.length ? `${items.length} ${items.length === 1 ? 'thing needs' : 'things need'} you, most important first.`
                  : unread.length ? 'Nothing found, but some sources could not be checked.' : 'Everything was checked.'}
          </p>
        </div>
        <button onClick={load} disabled={items === null && !error} aria-label="Check again" title="Check again"
          className="p-2 rounded-lg disabled:opacity-40" style={{ color: 'var(--text-soft)' }}>
          {items === null && !error ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        </button>
      </div>

      {error && (
        <div className="px-5 py-4 text-[13px] flex items-center gap-3 flex-wrap">
          <span className="text-[#ff3b30]">Could not load today&apos;s list: {error}</span>
          <button onClick={load} className="font-semibold text-[#7C3AED] hover:underline">Try again</button>
        </div>
      )}

      {items && items.length === 0 && !unread.length && (
        <div className="px-5 py-4 flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-soft)' }}>
          <CheckCircle2 size={16} className="text-[#34c759]" /> Nothing needs you today.
        </div>
      )}

      {shown.length > 0 && (
        <ul>
          {shown.map((it, i) => (
            <li key={`${it.kind}-${i}`} className="flex items-start gap-3 px-5 py-3 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
              <span className="mt-0.5 flex-shrink-0 text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5"
                style={{ color: TONE[it.tone].color, background: `${TONE[it.tone].color}1a` }}>{TONE[it.tone].label}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold leading-snug" style={{ color: 'var(--text)' }}>{it.title}</p>
                <p className="text-[12px] leading-snug mt-0.5" style={{ color: 'var(--text-faint)' }}>{it.detail}</p>
              </div>
              <Link href={it.href} className="flex-shrink-0 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"
                style={{ background: TONE[it.tone].color }}>
                {it.cta} <ArrowRight size={12} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {items && items.length > SHOW_FIRST && (
        <button onClick={() => setAll((v) => !v)} className="w-full px-5 py-2.5 text-[12.5px] font-semibold border-t text-[#7C3AED] hover:underline" style={{ borderColor: 'var(--border)' }}>
          {all ? 'Show fewer' : `Show ${items.length - SHOW_FIRST} more`}
        </button>
      )}

      {items && unread.length > 0 && (
        <p className="px-5 py-2.5 text-[12px] border-t text-[#ff9500]" style={{ borderColor: 'var(--border)' }}>
          Could not check: {unread.join(', ')}. Anything waiting there is not in this list.
        </p>
      )}
    </section>
  )
}
