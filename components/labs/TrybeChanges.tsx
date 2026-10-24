'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT CHANGED ON TRYBE (Seb, 2026-10-13, after looking at TrybeDaily): the
// changes MVP saw on its copy of TRYBE in the last days, yours first: brands
// new on the list, pay that changed, a higher earnings tier, more Meta ads,
// a brand in the Top 100, brands that left or came back. Read from
// app/api/labs/trybe (action 'changes'); described by lib/trybe-changes.
// A list MVP could not read says so, never "nothing changed".
//
// Seb, 2026-10-17 ("do one, two ... ten", after TrybeDaily's Today): any one
// day can be picked, back two weeks; and two more views, Most active brands
// (components/labs/TrybeActive) and the brands off TRYBE's Discover list
// (components/labs/TrybeOffDiscover).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, RotateCcw, Sparkles, ChevronDown } from 'lucide-react'
import TrybeLink from '@/components/labs/TrybeLink'
import TrybeBestNew from '@/components/labs/TrybeBestNew'
import TrybeBrandPeek, { type PeekActions } from '@/components/labs/TrybeBrandPeek'
import TrybeActive from '@/components/labs/TrybeActive'
import TrybeOffDiscover from '@/components/labs/TrybeOffDiscover'
import { changeLine, changeDay, changeDays, CHANGE_WORDS, CHANGE_ORDER, type ChangeKind } from '@/lib/trybe-changes'
import { bucketDollars } from '@/lib/trybe-pick'
import { readPay } from '@/lib/trybe-outreach'
import { readJoinedBrandIds } from '@/lib/trybe-joined'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'

export interface ChangeRow { brand_id: string; kind: ChangeKind; before: string | null; after: string | null; at: string; name: string | null; pay: string | null; categories: string[]; yours: boolean }
export interface ChangesRead { changes: ChangeRow[]; lastCollectedAt: string | null; days: number
  /** Brands you joined that were wrongly marked as left, put right on this read. */
  healed?: number }

const TONE: Record<ChangeKind, string> = { new: PURPLE, pay: GREEN, tier: GREEN, ads: GREEN, top100: GREEN, back: PURPLE, left: RED }

/** A pay or tier change is green only when it went up: a cut is amber
 *  (review 2026-10-24: every pay change was drawn green). Pure. */
export function changeTone(c: { kind: ChangeKind; before: string | null; after: string | null }): string {
  if (c.kind === 'tier') {
    const a = bucketDollars(c.after), b = bucketDollars(c.before)
    return a != null && b != null && a < b ? AMBER : TONE.tier
  }
  if (c.kind === 'pay') {
    const a = readPay(c.after), b = readPay(c.before)
    const down = (a.dollars != null && b.dollars != null && a.dollars < b.dollars) || (a.dollars == null && b.dollars == null && a.percent != null && b.percent != null && a.percent < b.percent)
    return down ? AMBER : TONE.pay
  }
  return TONE[c.kind]
}

export async function fetchChanges(days = 7, scoutOpens = false): Promise<ChangesRead> {
  // Your joined brands, read live, clear any false "left" before the list is read.
  const joined = scoutOpens ? await readJoinedBrandIds() : null
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'changes', days, ...(joined ? { joined } : {}) }), signal: AbortSignal.timeout(45_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
  return { changes: (d.changes || []) as ChangeRow[], lastCollectedAt: d.lastCollectedAt ?? null, days: d.days ?? days, healed: Number(d.healed) || 0 }
}

const dayWords = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/** The one-line summary for the top of the page. */
export function changesSummary(c: ChangesRead | null): string | null {
  if (!c) return null
  const yours = new Set(c.changes.filter((x) => x.yours).map((x) => x.brand_id)).size
  const fresh = c.changes.filter((x) => x.kind === 'new').length
  // Pay terms and TRYBE's payout tier are different things, said apart.
  const pay = c.changes.filter((x) => x.kind === 'pay').length
  const tier = c.changes.filter((x) => x.kind === 'tier').length
  return [yours ? `${yours} of your brands changed` : null, fresh ? `${fresh} new on TRYBE` : null, pay ? `${pay} pay change${pay === 1 ? '' : 's'}` : null, tier ? `${tier} payout tier change${tier === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || null
}

export default function TrybeChanges({ scoutOpens, initial, onRead, onSeeNew, actions }: { scoutOpens: boolean; initial?: ChangesRead | null; onRead?: (c: ChangesRead) => void; onSeeNew?: () => void; actions?: PeekActions }) {
  const [data, setData] = useState<ChangesRead | null>(initial ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [who, setWho] = useState<'yours' | 'all'>('all')
  const [kind, setKind] = useState<ChangeKind | 'any'>('any')
  const [limit, setLimit] = useState(60)
  const [view, setView] = useState<'changes' | 'active' | 'off'>('changes')
  // One day, or every day read ('all'); 14 days are read once asked for.
  const [dayPick, setDayPick] = useState<string>('all')
  // The rows opened to show the brand's details, by row key.
  const [open, setOpen] = useState<Set<string>>(new Set())
  const flip = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const load = useCallback(async (days?: number) => {
    setLoading(true); setError(null)
    // The page's Your week line reads 7 days; a longer read stays here.
    try { const c = await fetchChanges(days ?? 7, scoutOpens); setData(c); if ((days ?? 7) === 7) onRead?.(c) }
    catch (e) { setError(e instanceof Error ? e.message : 'MVP could not read what changed.') }
    finally { setLoading(false) }
  }, [onRead, scoutOpens])
  useEffect(() => { if (!initial) void load() }, [initial, load])

  const days = useMemo(() => changeDays(data?.changes || []), [data])
  const onDay = useCallback((c: ChangeRow) => dayPick === 'all' || changeDay(c.at) === dayPick, [dayPick])
  const counts = useMemo(() => {
    const m = new Map<ChangeKind, number>()
    for (const c of data?.changes || []) if ((who === 'all' || c.yours) && onDay(c)) m.set(c.kind, (m.get(c.kind) || 0) + 1)
    return m
  }, [data, who, onDay])
  // Brands, not changes: the same number the summary and the menu say.
  const yoursCount = useMemo(() => new Set((data?.changes || []).filter((c) => c.yours && onDay(c)).map((c) => c.brand_id)).size, [data, onDay])
  const shown = useMemo(() => (data?.changes || []).filter((c) => (who === 'all' || c.yours) && (kind === 'any' || c.kind === kind) && onDay(c)), [data, who, kind, onDay])
  const byDay = useMemo(() => {
    const out: Array<{ day: string; list: ChangeRow[] }> = []
    for (const c of shown.slice(0, limit)) {
      const day = new Date(c.at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
      const last = out[out.length - 1]
      if (last && last.day === day) last.list.push(c); else out.push({ day, list: [c] })
    }
    return out
  }, [shown, limit])

  const soft = { color: 'var(--text-soft)' }
  const chip = (on: boolean) => `rounded-full px-3 py-1 text-[12.5px] font-semibold border ${on ? '' : 'hover:border-[#7C3AED]/50'}`
  const chipStyle = (on: boolean) => (on ? { background: 'rgba(124,58,237,0.10)', color: PURPLE, borderColor: 'transparent' } : { borderColor: 'var(--border)', color: 'var(--text)' })

  if (error) {
    return (
      <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>
        <button onClick={() => void load(data?.days)} className="mt-2 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold" style={{ border: '1px solid var(--border)' }}><RotateCcw size={12} /> Try again</button>
      </div>
    )
  }
  if (!data) return <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading what changed on TRYBE...</p>

  const VIEWS = [
    { id: 'changes' as const, label: 'What changed', says: 'Day by day' },
    { id: 'active' as const, label: 'Most active brands', says: 'Creators joining fastest' },
    { id: 'off' as const, label: 'Not on Discover', says: 'Hidden or gone' },
  ]
  const viewNav = (
    <div className="flex flex-wrap gap-1.5 rounded-2xl border p-1.5" role="tablist" aria-label="What changed views" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      {VIEWS.map((v) => (
        <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
          className="flex-1 min-w-[9rem] rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--surface-2)]" style={view === v.id ? { background: 'rgba(124,58,237,0.12)', color: PURPLE } : { color: 'var(--text)' }}>
          <span className="block text-[13.5px] font-semibold leading-tight">{v.label}</span>
          <span className="block text-[11.5px]" style={view === v.id ? undefined : soft}>{v.says}</span>
        </button>
      ))}
    </div>
  )
  if (view === 'active') return <div className="space-y-4">{viewNav}<TrybeActive scoutOpens={scoutOpens} actions={actions} /></div>
  if (view === 'off') return <div className="space-y-4">{viewNav}<TrybeOffDiscover scoutOpens={scoutOpens} /></div>
  const span = dayPick === 'all' ? `in ${data.days} days` : `on ${dayWords(dayPick)}`

  return (
    <div className="space-y-4">
      {viewNav}
      <TrybeBestNew scoutOpens={scoutOpens} onSeeAll={onSeeNew} actions={actions} />
      {/* At a glance: one tile per kind of change, a press filters the list. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {CHANGE_ORDER.filter((k) => k !== 'back').map((k) => {
          const n = counts.get(k) || 0
          return (
            <button key={k} onClick={() => setKind(kind === k ? 'any' : k)} aria-pressed={kind === k}
              className="text-left rounded-2xl border px-4 py-3 transition-colors" style={{ borderColor: kind === k ? PURPLE : 'var(--border)', background: 'var(--surface)', borderTopWidth: 3, borderTopColor: TONE[k] }}>
              <p className="text-[12px] font-semibold" style={soft}>{CHANGE_WORDS[k]}</p>
              <p className="text-[26px] font-bold leading-tight tabular-nums" style={{ color: n ? TONE[k] : 'var(--text-soft)' }}>{n}</p>
              <p className="text-[11.5px]" style={soft}>{span}{who === 'yours' ? ', your brands' : ''}</p>
            </button>
          )
        })}
      </div>

      {(data.healed ?? 0) > 0 && (
        <p className="text-[12.5px] rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border)', background: 'rgba(22,163,74,0.06)' }}>
          Put right: {data.healed} brand{data.healed === 1 ? '' : 's'} you joined {data.healed === 1 ? 'was' : 'were'} listed here as left TRYBE. TRYBE&rsquo;s Discover list leaves out the brands you already joined, which MVP had read as leaving. They are on TRYBE, and no longer shown as left.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setWho('all')} className={chip(who === 'all')} style={chipStyle(who === 'all')}>All of TRYBE</button>
        <button onClick={() => setWho('yours')} className={chip(who === 'yours')} style={chipStyle(who === 'yours')}>Your brands ({yoursCount})</button>
        {kind !== 'any' && <button onClick={() => setKind('any')} className="text-[12.5px] font-semibold" style={{ color: PURPLE }}>Show every kind</button>}
        {/* EARLIER DAYS (TrybeDaily's "Latest · Oct 17"): one day at a time, back two weeks. */}
        <label className="inline-flex items-center gap-1.5 rounded-lg border pl-2.5 pr-1.5 py-1 text-[12.5px]" style={{ borderColor: dayPick === 'all' ? 'var(--border)' : PURPLE }}>
          <span style={soft}>Day</span>
          <select value={dayPick} aria-label="Pick a day"
            onChange={(e) => { const v = e.target.value; if (v === 'more') { setDayPick('all'); void load(14) } else { setDayPick(v); setLimit(60) } }}
            className="bg-transparent font-semibold outline-none cursor-pointer" style={{ color: dayPick === 'all' ? 'var(--text)' : PURPLE }}>
            <option value="all" style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>Last {data.days} days</option>
            {days.map((d, i) => <option key={d.day} value={d.day} style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>{i === 0 ? 'Latest · ' : ''}{dayWords(d.day)} ({d.n})</option>)}
            {data.days < 14 && <option value="more" style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>Earlier days: read 14 days</option>}
          </select>
        </label>
        <span className="ml-auto text-[12px]" style={soft}>
          {data.lastCollectedAt ? `MVP's copy of TRYBE last updated ${new Date(data.lastCollectedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'MVP has not finished a full read of TRYBE yet'}
        </span>
        <button onClick={() => void load(data.days)} disabled={loading} className="inline-flex items-center gap-1 text-[12.5px] font-semibold disabled:opacity-50" style={{ color: PURPLE }}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Refresh
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border p-5 text-[13px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)', ...soft }}>
          {data.changes.length === 0
            ? 'No changes recorded yet. MVP records them each time its copy of TRYBE is updated, so the first ones appear after the next full read.'
            : who === 'yours' ? `None of your brands changed ${dayPick === 'all' ? 'in this time' : 'that day'}. Your brands are the ones on your MVP list and the samples you logged.` : dayPick === 'all' ? 'Nothing of this kind in this time.' : 'Nothing of this kind that day.'}
        </div>
      ) : (
        <div className="space-y-4">
          {byDay.map((g) => (
            <section key={g.day}>
              <p className="text-[12px] font-bold uppercase tracking-wider mb-1.5" style={soft}>{g.day}</p>
              <ul className="rounded-2xl border divide-y overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                {g.list.map((c, i) => {
                  const k = `${c.brand_id}-${c.kind}-${i}`
                  const isOpen = open.has(k)
                  return (
                  <li key={k} className="px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: changeTone(c) }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="text-[13.5px] font-semibold">{c.name || 'A brand MVP no longer lists'}</span>
                        {c.yours && <span className="ml-2 text-[10.5px] font-bold rounded-full px-1.5 py-0.5 align-middle" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>Yours</span>}
                        <span className="block text-[12.5px]" style={{ color: c.kind === 'left' ? RED : 'var(--text-soft)' }}>{changeLine(c)}{c.categories?.length ? ` · ${c.categories.slice(0, 2).join(', ')}` : ''}</span>
                      </span>
                      {c.name && <TrybeLink brandId={c.brand_id} name={c.name} scout={scoutOpens} />}
                      {c.name && (
                        <button onClick={() => flip(k)} aria-expanded={isOpen} className="inline-flex items-center gap-0.5 text-[12.5px] font-semibold" style={{ color: PURPLE }}>
                          {isOpen ? 'Hide' : actions && c.kind !== 'left' ? 'Details and message' : 'Details'} <ChevronDown size={13} className={isOpen ? 'rotate-180' : ''} />
                        </button>
                      )}
                    </div>
                    {isOpen && c.name && <TrybeBrandPeek brandId={c.brand_id} name={c.name} actions={actions} />}
                  </li>
                  )
                })}
              </ul>
            </section>
          ))}
          {shown.length > limit && (
            <button onClick={() => setLimit((n) => n + 100)} className="inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: PURPLE }}><Sparkles size={13} /> Show more ({shown.length - limit} left)</button>
          )}
        </div>
      )}
    </div>
  )
}
