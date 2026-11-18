'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// 20 NEW BRANDS A DAY, FROM A SEARCH YOU CHOOSE (Seb, 2026-11-18: "it's a
// little harder for people to understand where to check that little box ...
// we need to ask MVP to find or to message those 20 brands based on a very
// particular set of filters"). Right under the search on Find brands: the
// search the 20 come from, said in words, on or off, put back to the search
// on the page in one press, and run now. What it did last is said, so a day
// it found nothing never looks like a day it did not run (lib/trybe-daily).

import { CalendarClock, Check, Loader2, Play, RefreshCw } from 'lucide-react'
import { TOGGLE_WORDS, NUMBER_WORDS } from '@/components/labs/TrybeFinderControls'
import { sameSearch, type DailySearch } from '@/lib/trybe-daily'
import { DAILY_FIND, type PayType, type BrowseSort } from '@/lib/trybe-outreach'

const ACCENT = 'var(--accent)'
const AMBER = '#B45309'
const soft = { color: 'var(--text-3)' }
const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold disabled:opacity-50'

const PAY_WORDS: Record<PayType, string> = { any: '', flat: 'Pays per video', percent: 'Pays a % of sales', both: 'Pays per video and a %', adspend: 'Pays a % of ad spend', guaranteed: 'Guaranteed pay' }
const SORT_WORDS: Partial<Record<BrowseSort, string>> = { picks: 'Best picks first', pay: 'Best pay first', spend: 'Most ad spend first', roomPay: 'Room and pay first', payouts: 'Biggest payouts first', creators: 'Fewest creators first', newest: 'Newest first', adsPerCreator: 'Most ads per creator first' }

/** The search in words: what is searched, then each filter, then the order. Pure. */
export function searchWords(s: Omit<DailySearch, 'savedAt'>): string[] {
  const out: string[] = [...s.keywords.map((k) => `"${k}"`), ...s.categories]
  if (PAY_WORDS[s.payType]) out.push(PAY_WORDS[s.payType])
  for (const [k, w] of Object.entries(TOGGLE_WORDS)) if ((s.filters as unknown as Record<string, unknown>)[k]) out.push(w)
  for (const [k, w] of Object.entries(NUMBER_WORDS)) { const n = (s.filters as unknown as Record<string, unknown>)[k]; if (typeof n === 'number' && n > 0) out.push(w(n)) }
  if (s.filters.sells) out.push(`Sells: ${s.filters.sells}`)
  if (SORT_WORDS[s.sort]) out.push(SORT_WORDS[s.sort]!)
  return out
}

export default function TrybeDailyBrands({ search, on, current, lastRunAt, note, running, saving, blocked, needsSql, onUse, onToggle, onRun }: {
  /** The saved daily search, or null. */
  search: DailySearch | null
  on: boolean
  /** The search on the page right now. */
  current: Omit<DailySearch, 'savedAt'>
  lastRunAt: string | null
  /** What the last run did, in words. */
  note: string | null
  running: boolean
  saving: boolean
  /** Why it cannot run now (no core message, SCOUT not allowed), or null. */
  blocked: string | null
  /** The database needs migration 469 before a search can be saved. */
  needsSql: boolean
  onUse: () => void
  onToggle: (on: boolean) => void
  onRun: () => void
}) {
  const differs = !!search && !sameSearch(search, current)
  const words = search ? searchWords(search) : []
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
  return (
    <section className="rounded-2xl border p-4 space-y-2.5" style={{ borderColor: on && search ? 'rgb(var(--brand-rgb) / 0.45)' : 'var(--border)', background: on && search ? 'rgb(var(--brand-rgb) / 0.04)' : 'var(--surface)' }} aria-label="Daily brands">
      <div className="flex flex-wrap items-start gap-3">
        <span className="w-9 h-9 shrink-0 rounded-xl grid place-items-center" style={{ background: 'rgb(var(--brand-rgb) / 0.12)', color: ACCENT }}><CalendarClock size={18} /></span>
        <div className="flex-1 min-w-[15rem]">
          <h3 className="text-[15.5px] font-bold">{DAILY_FIND} new brands a day, from a search you choose</h3>
          <p className="text-[12.5px]" style={soft}>Each day you open TRYBE in MVP, MVP takes the next {DAILY_FIND} brands from this search that you have not messaged, writes each one your message, and puts them in Ready to send for you to check.</p>
        </div>
        {search && (
          <button type="button" role="switch" aria-checked={on} onClick={() => onToggle(!on)} disabled={saving}
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={on ? { background: ACCENT, color: '#fff', borderColor: 'transparent' } : { borderColor: 'var(--border)', color: 'var(--text)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: on ? '#fff' : 'var(--text-3)' }} aria-hidden /> {on ? 'On every day' : 'Off'}
          </button>
        )}
      </div>

      {needsSql ? (
        <p className="text-[12.5px] font-semibold" style={{ color: AMBER }}>Saving a daily search needs migration 469 in Supabase first.</p>
      ) : search ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-semibold mr-1" style={soft}>Your daily search:</span>
          {words.length ? words.map((w) => <span key={w} className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>{w}</span>)
            : <span className="text-[12px]" style={soft}>All of TRYBE, MVP&rsquo;s best picks first</span>}
        </div>
      ) : (
        <p className="text-[13px]">No daily search yet. Search and pick your filters above, then press <b>Use this search every day</b>.</p>
      )}

      {!needsSql && (
        <div className="flex flex-wrap items-center gap-2">
          {(!search || differs) && (
            <button className={btn} style={{ background: ACCENT, color: '#fff' }} onClick={onUse} disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : search ? <RefreshCw size={13} /> : <Check size={13} />}
              {search ? 'Use the search above instead' : 'Use this search every day'}
            </button>
          )}
          {search && on && (
            <button className={btn} style={{ border: '1px solid var(--border)', color: 'var(--text)' }} onClick={onRun} disabled={running || !!blocked}>
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run it now
            </button>
          )}
          {search && !differs && <span className="text-[12px]" style={soft}>This is the search on the page now.</span>}
        </div>
      )}
      {search && on && blocked && <p className="text-[12.5px]" style={{ color: AMBER }}>{blocked}</p>}
      {search && (lastRunAt || note) && (
        <p className="text-[12.5px]" style={soft}>{lastRunAt ? `Last run ${when(lastRunAt)}.` : ''}{note ? ` ${note}` : ''}</p>
      )}
    </section>
  )
}
