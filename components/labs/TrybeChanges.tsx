'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT CHANGED ON TRYBE (Seb, 2026-10-13, after looking at TrybeDaily): the
// changes MVP saw on its copy of TRYBE in the last days, yours first: brands
// new on the list, pay that changed, a higher earnings tier, more Meta ads,
// a brand in the Top 100, brands that left or came back. Read from
// app/api/labs/trybe (action 'changes'); described by lib/trybe-changes.
// A list MVP could not read says so, never "nothing changed".

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, RotateCcw, Sparkles } from 'lucide-react'
import TrybeLink from '@/components/labs/TrybeLink'
import { changeLine, CHANGE_WORDS, CHANGE_ORDER, type ChangeKind } from '@/lib/trybe-changes'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'

export interface ChangeRow { brand_id: string; kind: ChangeKind; before: string | null; after: string | null; at: string; name: string | null; pay: string | null; categories: string[]; yours: boolean }
export interface ChangesRead { changes: ChangeRow[]; lastCollectedAt: string | null; days: number }

const TONE: Record<ChangeKind, string> = { new: PURPLE, pay: GREEN, tier: GREEN, ads: GREEN, top100: GREEN, back: PURPLE, left: RED }

export async function fetchChanges(days = 7): Promise<ChangesRead> {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'changes', days }), signal: AbortSignal.timeout(45_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
  return { changes: (d.changes || []) as ChangeRow[], lastCollectedAt: d.lastCollectedAt ?? null, days: d.days ?? days }
}

/** The one-line summary for the top of the page. */
export function changesSummary(c: ChangesRead | null): string | null {
  if (!c) return null
  const yours = new Set(c.changes.filter((x) => x.yours).map((x) => x.brand_id)).size
  const fresh = c.changes.filter((x) => x.kind === 'new').length
  const pay = c.changes.filter((x) => x.kind === 'pay' || x.kind === 'tier').length
  return [yours ? `${yours} of your brands changed` : null, fresh ? `${fresh} new on TRYBE` : null, pay ? `${pay} pay change${pay === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || null
}

export default function TrybeChanges({ scoutOpens, initial, onRead }: { scoutOpens: boolean; initial?: ChangesRead | null; onRead?: (c: ChangesRead) => void }) {
  const [data, setData] = useState<ChangesRead | null>(initial ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [who, setWho] = useState<'yours' | 'all'>('all')
  const [kind, setKind] = useState<ChangeKind | 'any'>('any')
  const [limit, setLimit] = useState(60)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { const c = await fetchChanges(7); setData(c); onRead?.(c) }
    catch (e) { setError(e instanceof Error ? e.message : 'MVP could not read what changed.') }
    finally { setLoading(false) }
  }, [onRead])
  useEffect(() => { if (!initial) void load() }, [initial, load])

  const counts = useMemo(() => {
    const m = new Map<ChangeKind, number>()
    for (const c of data?.changes || []) if (who === 'all' || c.yours) m.set(c.kind, (m.get(c.kind) || 0) + 1)
    return m
  }, [data, who])
  const yoursCount = useMemo(() => (data?.changes || []).filter((c) => c.yours).length, [data])
  const shown = useMemo(() => (data?.changes || []).filter((c) => (who === 'all' || c.yours) && (kind === 'any' || c.kind === kind)), [data, who, kind])
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
        <button onClick={() => void load()} className="mt-2 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold" style={{ border: '1px solid var(--border)' }}><RotateCcw size={12} /> Try again</button>
      </div>
    )
  }
  if (!data) return <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading what changed on TRYBE...</p>

  return (
    <div className="space-y-4">
      {/* At a glance: one tile per kind of change, a press filters the list. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {CHANGE_ORDER.filter((k) => k !== 'back').map((k) => {
          const n = counts.get(k) || 0
          return (
            <button key={k} onClick={() => setKind(kind === k ? 'any' : k)} aria-pressed={kind === k}
              className="text-left rounded-2xl border px-4 py-3 transition-colors" style={{ borderColor: kind === k ? PURPLE : 'var(--border)', background: 'var(--surface)', borderTopWidth: 3, borderTopColor: TONE[k] }}>
              <p className="text-[12px] font-semibold" style={soft}>{CHANGE_WORDS[k]}</p>
              <p className="text-[26px] font-bold leading-tight tabular-nums" style={{ color: n ? TONE[k] : 'var(--text-soft)' }}>{n}</p>
              <p className="text-[11.5px]" style={soft}>in {data.days} days{who === 'yours' ? ', your brands' : ''}</p>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setWho('all')} className={chip(who === 'all')} style={chipStyle(who === 'all')}>All of TRYBE</button>
        <button onClick={() => setWho('yours')} className={chip(who === 'yours')} style={chipStyle(who === 'yours')}>Your brands ({yoursCount})</button>
        {kind !== 'any' && <button onClick={() => setKind('any')} className="text-[12.5px] font-semibold" style={{ color: PURPLE }}>Show every kind</button>}
        <span className="ml-auto text-[12px]" style={soft}>
          {data.lastCollectedAt ? `MVP's copy of TRYBE last updated ${new Date(data.lastCollectedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'MVP has not finished a full read of TRYBE yet'}
        </span>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 text-[12.5px] font-semibold disabled:opacity-50" style={{ color: PURPLE }}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Refresh
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border p-5 text-[13px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)', ...soft }}>
          {data.changes.length === 0
            ? 'No changes recorded yet. MVP records them each time its copy of TRYBE is updated, so the first ones appear after the next full read.'
            : who === 'yours' ? 'None of your brands changed in this time. Your brands are the ones on your MVP list and the samples you logged.' : 'Nothing of this kind in this time.'}
        </div>
      ) : (
        <div className="space-y-4">
          {byDay.map((g) => (
            <section key={g.day}>
              <p className="text-[12px] font-bold uppercase tracking-wider mb-1.5" style={soft}>{g.day}</p>
              <ul className="rounded-2xl border divide-y overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                {g.list.map((c, i) => (
                  <li key={`${c.brand_id}-${c.kind}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TONE[c.kind] }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="text-[13.5px] font-semibold">{c.name || 'A brand MVP no longer lists'}</span>
                      {c.yours && <span className="ml-2 text-[10.5px] font-bold rounded-full px-1.5 py-0.5 align-middle" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>Yours</span>}
                      <span className="block text-[12.5px]" style={{ color: c.kind === 'left' ? RED : 'var(--text-soft)' }}>{changeLine(c)}{c.categories?.length ? ` · ${c.categories.slice(0, 2).join(', ')}` : ''}</span>
                    </span>
                    {c.name && <TrybeLink brandId={c.brand_id} name={c.name} scout={scoutOpens} />}
                  </li>
                ))}
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
