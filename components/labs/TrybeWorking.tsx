'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT'S WORKING ON TRYBE (Seb, 2026-10-13, screenshots of TrybeDaily). The
// videos TRYBE picked for its Top 100 right now, read through SCOUT from the
// creator's own TRYBE, with the words of the first ones: how their opening
// lines start, real examples to watch, and how long they run. Every count
// says what it is out of; what TRYBE did not share is said, never guessed.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, RotateCcw, Play } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readScript, keysOf } from '@/lib/trybe-mybrands'
import { readTopEntries, openingLine, hookType, hookCounts, middleHalf, HOOK_TYPES, type TopVideoEntry, type HookType } from '@/lib/trybe-working'

const PURPLE = '#7C3AED'
const AMBER = '#B45309'
/** Videos whose words are read, one at a time through SCOUT. */
const WORDS_FOR = 40
const CACHE_KEY = 'mvp.trybe.working'

interface Read { at: number; entries: TopVideoEntry[]; lines: Record<string, string>; tried: number; keys: string }

function cached(): Read | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null') as Read | null
    return v && Date.now() - v.at < 6 * 3600_000 ? v : null
  } catch { return null }
}

export default function TrybeWorking({ canRead, isAdmin, newToTop }: {
  /** SCOUT 1.46.0+ allowed on TRYBE. */
  canRead: boolean
  isAdmin: boolean
  /** Brands that entered the Top 100 in the last days, from What changed. */
  newToTop: Array<{ id: string; name: string }> | null
}) {
  const [data, setData] = useState<Read | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null)
  const [pick, setPick] = useState<HookType | null>(null)

  const load = useCallback(async (fresh = false) => {
    if (!fresh) { const c = cached(); if (c) { setData(c); return } }
    setError(null); setProgress({ done: 0, of: 0 })
    try {
      const r = await requestTrybeApi('GET', '/backend/api/creator/v2/top-creatives')
      if (!r.ok) { setError(`MVP could not read TRYBE's Top 100: ${r.error === 'not-allowed' ? 'this needs SCOUT 1.46.0 or newer.' : r.error || 'SCOUT did not answer.'}${r.status ? ` (TRYBE answered ${r.status})` : ''}`); return }
      const entries = readTopEntries(r.json)
      if (!entries.length) { setError(`TRYBE answered, but MVP could not read the Top 100 from it.${isAdmin ? ` (TRYBE sent: ${keysOf(r.json)})` : ''}`); return }
      const lines: Record<string, string> = {}
      const todo = entries.filter((e) => e.id).slice(0, WORDS_FOR)
      setProgress({ done: 0, of: todo.length })
      for (let i = 0; i < todo.length; i++) {
        const s = await requestTrybeApi('GET', `/backend/api/creator/v2/submissions/${encodeURIComponent(todo[i].id as string)}/script`).catch(() => null)
        const words = s && s.ok ? readScript(s.json) : null
        if (words) lines[todo[i].id as string] = openingLine(words)
        setProgress({ done: i + 1, of: todo.length })
      }
      const read: Read = { at: Date.now(), entries, lines, tried: todo.length, keys: keysOf(r.json) }
      setData(read)
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(read)) } catch { /* read again next visit */ }
    } catch (e) { setError(e instanceof Error ? e.message : 'MVP could not read the Top 100.') }
    finally { setProgress(null) }
  }, [isAdmin])
  useEffect(() => { if (canRead) void load() }, [canRead, load])

  const lineList = useMemo(() => Object.values(data?.lines || {}), [data])
  const counts = useMemo(() => hookCounts(lineList), [lineList])
  const top = counts[0]
  const lengths = useMemo(() => middleHalf((data?.entries || []).map((e) => e.seconds || 0)), [data])
  const byCategory = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const e of data?.entries || []) if (e.category && e.seconds) m.set(e.category, [...(m.get(e.category) || []), e.seconds])
    return Array.from(m.entries()).map(([cat, s]) => ({ cat, mid: middleHalf(s) })).filter((x) => x.mid).sort((a, b) => (a.mid!.low - b.mid!.low))
  }, [data])
  const brands = useMemo(() => new Set((data?.entries || []).map((e) => e.brandId || e.brandName)).size, [data])
  const examples = useMemo(() => (data?.entries || []).filter((e) => e.id && data?.lines[e.id] && (!pick || hookType(data.lines[e.id]) === pick)).slice(0, 6), [data, pick])

  const soft = { color: 'var(--text-soft)' }
  const tile = 'rounded-2xl border px-5 py-4 flex flex-col'

  if (!canRead) {
    return <div className={tile} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}><p className="text-[14px] font-semibold">What&rsquo;s working needs SCOUT on TRYBE</p><p className="text-[13px] mt-1" style={soft}>Install SCOUT, allow it on TRYBE and sign in to TRYBE in this browser. MVP then reads TRYBE&rsquo;s Top 100 and how those videos open.</p></div>
  }
  if (error) {
    return (
      <div className={tile} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>
        <button onClick={() => void load(true)} className="mt-2 self-start inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold" style={{ border: '1px solid var(--border)' }}><RotateCcw size={12} /> Try again</button>
      </div>
    )
  }
  if (!data) {
    return <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> {progress && progress.of ? `Reading the words of TRYBE's top videos: ${progress.done} of ${progress.of}` : 'Reading TRYBE’s Top 100 through SCOUT...'}</p>
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[22px] font-bold tracking-tight">TRYBE&rsquo;s Top 100 at a glance</h2>
        <span className="text-[12.5px]" style={soft}>read {new Date(data.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <button onClick={() => void load(true)} className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: PURPLE }}><RotateCcw size={12} /> Read again</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Glance color={HOOK_TYPES.find((h) => h.type === top?.type)?.color || PURPLE} label="Most common opening"
          big={top && top.n ? `${Math.round(top.share * 100)}%` : 'Not read'}
          title={top && top.n ? HOOK_TYPES.find((h) => h.type === top.type)?.label || '' : ''}
          sub={top && top.n ? `${top.n} of ${top.of} openings MVP could read` : `TRYBE shared the words of none of the ${data.tried} videos MVP asked about.`} />
        <Glance color="#0E7490" label="Typical length" big={lengths ? `${lengths.low} to ${lengths.high}s` : 'Not shared'}
          title={lengths ? 'Where the middle half lands' : ''} sub={lengths ? `${lengths.n} Top 100 videos with a length` : 'TRYBE did not send video lengths with its Top 100.'} />
        <Glance color="#16A34A" label="New to the Top 100" big={newToTop ? `${newToTop.length} brand${newToTop.length === 1 ? '' : 's'}` : 'Not counted'}
          title={newToTop ? 'In the last 7 days' : ''} sub={newToTop ? (newToTop.slice(0, 3).map((b) => b.name).join(', ') || 'None this week') : 'Open What changed once to count them.'} />
        <Glance color="#DB2777" label="Brands in it" big={String(brands)} title="Brands with a Top 100 video" sub={`${data.entries.length} videos in TRYBE's Top 100 right now`} />
      </div>

      <section>
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-[22px] font-bold tracking-tight">How the top videos open</h2>
          <span className="text-[12px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>{lineList.length} openings</span>
        </div>
        <p className="text-[13px] mt-0.5" style={soft}>The first line of the videos TRYBE picked for its Top 100. Press a kind to see examples of it.</p>
        {lineList.length === 0 ? (
          <p className="text-[13px] mt-3" style={soft}>TRYBE did not share the words of these videos, so MVP cannot count how they open. Watch a few from the Top 100 on TRYBE and note their first 2 seconds.</p>
        ) : (
          <div className="mt-3 grid gap-3 grid-cols-2 lg:grid-cols-5">
            {HOOK_TYPES.map((h) => {
              const c = counts.find((x) => x.type === h.type)!
              const on = pick === h.type
              return (
                <button key={h.type} onClick={() => setPick(on ? null : h.type)} aria-pressed={on} className="text-left rounded-2xl border px-4 py-3.5 transition-colors"
                  style={{ borderColor: on ? h.color : 'var(--border)', background: 'var(--surface)' }}>
                  <p className="text-[14px] font-bold leading-snug">{h.label}</p>
                  <p className="text-[12px] mt-0.5 min-h-[2.5em]" style={soft}>{h.says}</p>
                  <p className="text-[26px] font-bold mt-1 tabular-nums" style={{ color: h.color }}>{Math.round(c.share * 100)}%</p>
                  <span className="block h-1.5 rounded-full mt-1" style={{ background: 'var(--border)' }}><span className="block h-1.5 rounded-full" style={{ width: `${Math.max(2, Math.round(c.share * 100))}%`, background: h.color }} /></span>
                  <p className="text-[12px] mt-1.5 tabular-nums" style={soft}>{c.n} of {c.of}</p>
                </button>
              )
            })}
          </div>
        )}
        {examples.length > 0 && (
          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {examples.map((e) => (
              <article key={e.id} className="rounded-2xl border p-3 flex gap-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <a href={e.video || e.thumbnail || '#'} target="_blank" rel="noopener noreferrer" className="relative shrink-0 w-[84px] rounded-xl overflow-hidden border" style={{ aspectRatio: '9 / 16', borderColor: 'var(--border)', background: 'rgba(0,0,0,0.05)' }} title="Watch it">
                  {e.thumbnail
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={e.thumbnail} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                    : <span className="absolute inset-0 flex items-center justify-center text-[11px]" style={soft}>No cover</span>}
                </a>
                <div className="min-w-0 flex flex-col">
                  <p className="text-[14.5px] font-semibold leading-snug">&ldquo;{data.lines[e.id as string]}&rdquo;</p>
                  <p className="mt-1.5 text-[12.5px] flex flex-wrap items-center gap-1.5">
                    <b>{e.brandName || 'A brand'}</b>
                    {e.rank != null && <span className="text-[11px] font-bold rounded-full px-1.5 py-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>TRYBE #{e.rank}</span>}
                  </p>
                  <p className="text-[12px]" style={soft}>{[e.category, e.creator ? `Creator: ${e.creator}` : null].filter(Boolean).join(' · ')}</p>
                  {e.video && <a href={e.video} target="_blank" rel="noopener noreferrer" className="mt-auto pt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: PURPLE }}><Play size={12} /> Watch this example</a>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {byCategory.length > 0 && (
        <section>
          <h2 className="text-[22px] font-bold tracking-tight">Video length by category</h2>
          <p className="text-[13px] mt-0.5" style={soft}>Where the middle half of the Top 100 videos land, on a 0 to 75 second scale. Not a target, just where they fall.</p>
          <div className="mt-3 rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <table className="w-full text-[13px] min-w-[520px]">
              <tbody>
                {byCategory.map(({ cat, mid }) => (
                  <tr key={cat} className="border-t first:border-t-0" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-2.5 font-semibold w-[34%]">{cat}</td>
                    <td className="py-2.5 w-[42%]"><span className="block relative h-2 rounded-full" style={{ background: 'var(--border)' }}><span className="absolute h-2 rounded-full" style={{ left: `${Math.min(100, (mid!.low / 75) * 100)}%`, width: `${Math.max(2, Math.min(100, ((mid!.high - mid!.low) / 75) * 100))}%`, background: PURPLE }} /></span></td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">{mid!.low} to {mid!.high}s</td>
                    <td className="pr-4 py-2.5 text-right tabular-nums" style={soft}>{mid!.n} videos</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {isAdmin && <p className="text-[11px]" style={soft}>Admin: TRYBE&rsquo;s Top 100 answer had {data.keys}. Words read for {lineList.length} of {data.tried} videos asked.</p>}
    </div>
  )
}

function Glance({ color, label, big, title, sub }: { color: string; label: string; big: string; title: string; sub: string }) {
  return (
    <div className="rounded-2xl border px-5 py-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderTop: `4px solid ${color}` }}>
      <p className="text-[13px] font-semibold" style={{ color: 'var(--text-soft)' }}>{label}</p>
      <p className="text-[30px] font-bold leading-tight mt-1 tabular-nums" style={{ color }}>{big}</p>
      {title && <p className="text-[14px] font-bold mt-0.5">{title}</p>}
      <p className="text-[12.5px] mt-1" style={{ color: 'var(--text-soft)' }}>{sub}</p>
    </div>
  )
}
