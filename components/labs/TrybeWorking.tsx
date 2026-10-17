'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT'S WORKING ON TRYBE (Seb, 2026-10-13, screenshots of TrybeDaily). The
// videos TRYBE picked for its Top 100 right now, read through SCOUT from the
// creator's own TRYBE, with the words of the first ones: how their opening
// lines start, real examples to watch, and how long they run. Every count
// says what it is out of; what TRYBE did not share is said, never guessed.
//
// Seb, 2026-10-17 ("do ... four, five, six", after TrybeDaily's What's
// Working and Creators): one category narrows the whole tab, the top creators
// behind the Top 100 (lib/trybe-creators), and the ads TRYBE brands run on
// Meta (components/labs/TrybeAdsGallery).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, RotateCcw, Play, Users } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readScript, keysOf } from '@/lib/trybe-mybrands'
import { readTopEntries, openingLine, hookType, hookCounts, middleHalf, HOOK_TYPES, type TopVideoEntry, type HookType } from '@/lib/trybe-working'
import { topCreators } from '@/lib/trybe-creators'
import { BrandMark } from '@/components/labs/TrybeFinderControls'
import TrybeAdsGallery from '@/components/labs/TrybeAdsGallery'

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

/** A brand's categories and website, from MVP's copy of TRYBE. */
type Brief = { categories: string[]; website: string | null }
const CREATORS_SHOWN = 10

export default function TrybeWorking({ canRead, isAdmin, newToTop, scoutVersion = null }: {
  /** SCOUT 1.46.0+ allowed on TRYBE. */
  canRead: boolean
  isAdmin: boolean
  /** Brands that entered the Top 100 in the last days, from What changed. */
  newToTop: Array<{ id: string; name: string }> | null
  scoutVersion?: string | null
}) {
  const [data, setData] = useState<Read | null>(null)
  // CATEGORY (Seb, 2026-10-17: "do ... six"): one pick narrows every part of the tab.
  const [cat, setCat] = useState<string | null>(null)
  const [brief, setBrief] = useState<Record<string, Brief>>({})
  const [creatorsShown, setCreatorsShown] = useState(CREATORS_SHOWN)
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
  // Each Top 100 brand's categories and website from MVP's copy of TRYBE, for
  // the category pick and the brand marks. Without it, the Top 100's own
  // category word is used.
  useEffect(() => {
    if (!data?.entries.length) return
    const ids = Array.from(new Set(data.entries.map((e) => e.brandId).filter(Boolean))) as string[]
    const names = Array.from(new Set(data.entries.filter((e) => !e.brandId && e.brandName).map((e) => e.brandName as string)))
    fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'brands_brief', ids: ids.slice(0, 200), names: names.slice(0, 200) }), signal: AbortSignal.timeout(30_000) })
      .then((r) => r.json()).then((d) => {
        const out: Record<string, Brief> = {}
        for (const b of (d.brands || []) as Array<{ brand_id: string; name: string; website: string | null; categories: string[] | null }>) {
          const v = { categories: b.categories || [], website: b.website }
          out[b.brand_id] = v; if (b.name) out[`name:${b.name.toLowerCase()}`] = v
        }
        setBrief(out)
      }).catch(() => { /* the Top 100's own category word is used */ })
  }, [data])
  const briefOf = useCallback((e: TopVideoEntry): Brief | null => (e.brandId && brief[e.brandId]) || (e.brandName && brief[`name:${e.brandName.toLowerCase()}`]) || null, [brief])
  const catsOf = useCallback((e: TopVideoEntry): string[] => Array.from(new Set([...(e.category ? [e.category] : []), ...(briefOf(e)?.categories || [])])), [briefOf])
  const catOptions = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>()
    for (const e of data?.entries || []) for (const c of catsOf(e)) { const k = c.toLowerCase(); const cur = m.get(k) ?? { name: c, n: 0 }; cur.n++; m.set(k, cur) }
    return Array.from(m.values()).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
  }, [data, catsOf])
  const entries = useMemo(() => (data?.entries || []).filter((e) => !cat || catsOf(e).some((c) => c.toLowerCase() === cat.toLowerCase())), [data, cat, catsOf])

  const lineList = useMemo(() => entries.filter((e) => e.id && data?.lines[e.id]).map((e) => data!.lines[e.id as string]), [entries, data])
  const counts = useMemo(() => hookCounts(lineList), [lineList])
  const top = counts[0]
  const lengths = useMemo(() => middleHalf(entries.map((e) => e.seconds || 0)), [entries])
  const byCategory = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const e of data?.entries || []) if (e.category && e.seconds) m.set(e.category, [...(m.get(e.category) || []), e.seconds])
    return Array.from(m.entries()).map(([cat, s]) => ({ cat, mid: middleHalf(s) })).filter((x) => x.mid).sort((a, b) => (a.mid!.low - b.mid!.low))
  }, [data])
  const brands = useMemo(() => new Set(entries.map((e) => e.brandId || e.brandName)).size, [entries])
  const examples = useMemo(() => entries.filter((e) => e.id && data?.lines[e.id] && (!pick || hookType(data.lines[e.id]) === pick)).slice(0, 6), [entries, data, pick])
  const creators = useMemo(() => topCreators(entries), [entries])
  const topBrands = useMemo(() => Array.from(new Map((data?.entries || []).filter((e) => e.brandId && e.brandName).map((e) => [e.brandId as string, { brandId: e.brandId as string, name: e.brandName as string }])).values()), [data])

  const soft = { color: 'var(--text-soft)' }
  const tile = 'rounded-2xl border px-5 py-4 flex flex-col'

  // The ads gallery is MVP's own copy, so it shows even when the Top 100 cannot be read.
  const gallery = <TrybeAdsGallery isAdmin={isAdmin} scoutVersion={scoutVersion} canRead={canRead} topBrands={topBrands} category={data ? cat : null} />
  if (!canRead) {
    return (
      <div className="space-y-7">
        <div className={tile} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}><p className="text-[14px] font-semibold">What&rsquo;s working needs SCOUT on TRYBE</p><p className="text-[13px] mt-1" style={soft}>Install SCOUT, allow it on TRYBE and sign in to TRYBE in this browser. MVP then reads TRYBE&rsquo;s Top 100, how those videos open and who made them.</p></div>
        {gallery}
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-7">
        <div className={tile} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>
          <button onClick={() => void load(true)} className="mt-2 self-start inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold" style={{ border: '1px solid var(--border)' }}><RotateCcw size={12} /> Try again</button>
        </div>
        {gallery}
      </div>
    )
  }
  if (!data) {
    return <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> {progress && progress.of ? `Reading the words of TRYBE's top videos: ${progress.done} of ${progress.of}` : 'Reading TRYBE’s Top 100 through SCOUT...'}</p>
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-1.5" aria-label="On this tab">
          {[['ww-glance', 'At a glance'], ['ww-hooks', 'Hooks'], ['ww-lengths', 'Video lengths'], ['ww-creators', 'Top creators'], ['ww-ads', 'Meta ads']].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-full px-3 py-1 text-[12.5px] font-semibold border hover:border-[#7C3AED]/50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>{label}</a>
          ))}
        </nav>
        <label className="ml-auto inline-flex items-center gap-1.5 rounded-lg border pl-2.5 pr-1.5 py-1.5 text-[13px]" style={{ borderColor: cat ? PURPLE : 'var(--border)' }}>
          <span style={soft}>Category</span>
          <select value={cat ?? ''} onChange={(e) => { setCat(e.target.value || null); setCreatorsShown(CREATORS_SHOWN) }} aria-label="Category" className="bg-transparent font-semibold outline-none cursor-pointer max-w-[14rem]" style={{ color: cat ? PURPLE : 'var(--text)' }}>
            <option value="" style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>All categories</option>
            {catOptions.map((c) => <option key={c.name} value={c.name} style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>{c.name} ({c.n})</option>)}
          </select>
        </label>
      </div>

      <div id="ww-glance" className="flex flex-wrap items-baseline gap-2 scroll-mt-24">
        <h2 className="text-[22px] font-bold tracking-tight">TRYBE&rsquo;s Top 100 at a glance{cat ? `: ${cat}` : ''}</h2>
        <span className="text-[12.5px]" style={soft}>read {new Date(data.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <button onClick={() => void load(true)} className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: PURPLE }}><RotateCcw size={12} /> Read again</button>
      </div>
      {cat && entries.length === 0 && <p className="text-[13px]" style={soft}>No Top 100 video right now is from a brand in {cat}. <button onClick={() => setCat(null)} className="font-semibold underline" style={{ color: PURPLE }}>Show all categories</button></p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Glance color={HOOK_TYPES.find((h) => h.type === top?.type)?.color || PURPLE} label="Most common opening"
          big={top && top.n ? `${Math.round(top.share * 100)}%` : 'Not read'}
          title={top && top.n ? HOOK_TYPES.find((h) => h.type === top.type)?.label || '' : ''}
          sub={top && top.n ? `${top.n} of ${top.of} openings MVP could read` : `TRYBE shared the words of none of the ${data.tried} videos MVP asked about.`} />
        <Glance color="#0E7490" label="Typical length" big={lengths ? `${lengths.low} to ${lengths.high}s` : 'Not shared'}
          title={lengths ? 'Where the middle half lands' : ''} sub={lengths ? `${lengths.n} Top 100 videos with a length` : 'TRYBE did not send video lengths with its Top 100.'} />
        <Glance color="#16A34A" label="New to the Top 100" big={newToTop ? `${newToTop.length} brand${newToTop.length === 1 ? '' : 's'}` : 'Not counted'}
          title={newToTop ? 'In the last 7 days' : ''} sub={newToTop ? (newToTop.slice(0, 3).map((b) => b.name).join(', ') || 'None this week') : 'Open What changed once to count them.'} />
        <Glance color="#DB2777" label="Brands in it" big={String(brands)} title="Brands with a Top 100 video" sub={cat ? `${entries.length} of the ${data.entries.length} Top 100 videos are in ${cat}` : `${data.entries.length} videos in TRYBE's Top 100 right now`} />
      </div>

      <section id="ww-hooks" className="scroll-mt-24">
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
        <section id="ww-lengths" className="scroll-mt-24">
          <h2 className="text-[22px] font-bold tracking-tight">Video length by category</h2>
          <p className="text-[13px] mt-0.5" style={soft}>Where the middle half of the Top 100 videos land, on a 0 to 75 second scale. Not a target, just where they fall.</p>
          <div className="mt-3 rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <table className="w-full text-[13px]">
              <tbody>
                {byCategory.map(({ cat: c, mid }) => (
                  <tr key={c} className="border-t first:border-t-0" style={{ borderColor: 'var(--border)', ...(cat && c.toLowerCase() === cat.toLowerCase() ? { background: 'rgba(124,58,237,0.06)' } : {}) }}>
                    <td className="px-4 py-2.5 font-semibold w-[34%]">{c}</td>
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
      {/* TOP CREATORS (Seb, 2026-10-17: "do ... four"): who is behind the Top 100. */}
      <section id="ww-creators" className="scroll-mt-24">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-[22px] font-bold tracking-tight">Top creators in TRYBE&rsquo;s Top 100</h2>
          {creators.length > 0 && <span className="text-[12px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>{creators.length} creators</span>}
        </div>
        <p className="text-[13px] mt-0.5" style={soft}>The creators with the most videos TRYBE picked for its Top 100 right now{cat ? ` in ${cat}` : ''}, their best place, the brands, and the videos to watch.{creators.some((c) => c.sales) ? ' Sales ranges are TRYBE’s own.' : ''}</p>
        {creators.length === 0 ? (
          <p className="text-[13px] mt-3" style={soft}>{entries.length ? 'TRYBE did not say who made these videos, so MVP cannot list the creators.' : 'No Top 100 videos to list creators from.'}</p>
        ) : (
          <ol className="mt-3 rounded-2xl border divide-y overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {creators.slice(0, creatorsShown).map((c, i) => (
              <li key={`${c.handle || c.name}-${i}`} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ borderColor: 'var(--border)' }}>
                <span className="w-7 h-7 rounded-full inline-flex items-center justify-center text-[12.5px] font-bold tabular-nums shrink-0" style={i < 3 ? { background: PURPLE, color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--text-2)' }}>{i + 1}</span>
                {c.avatar
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={c.avatar} alt="" loading="lazy" className="w-10 h-10 rounded-full object-cover border shrink-0" style={{ borderColor: 'var(--border)' }} />
                  : <span className="w-10 h-10 rounded-full inline-flex items-center justify-center shrink-0" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}><Users size={16} /></span>}
                <div className="min-w-[9rem] flex-1">
                  <p className="text-[14.5px] font-semibold leading-tight">{c.name}</p>
                  {c.handle && c.handle.toLowerCase() !== c.name.toLowerCase() && <p className="text-[12.5px]" style={soft}>@{c.handle}</p>}
                  {c.sales && <p className="text-[12px] font-semibold" style={{ color: '#16A34A' }}>TRYBE sales range: {c.sales}</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-bold rounded-full px-2 py-0.5 tabular-nums" style={{ background: 'rgba(219,39,119,0.10)', color: '#DB2777' }}>{c.videos} video{c.videos === 1 ? '' : 's'}</span>
                  {c.best != null && <span className="text-[12px] font-bold rounded-full px-2 py-0.5 tabular-nums" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>Best #{c.best}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2 min-w-[10rem] flex-1">
                  {c.brands.slice(0, 3).map((b) => (
                    <span key={b.name} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold">
                      <BrandMark name={b.name} website={(b.id && brief[b.id]?.website) || brief[`name:${b.name.toLowerCase()}`]?.website || null} size={22} />{b.name}
                    </span>
                  ))}
                  {c.brands.length > 3 && <span className="text-[12px]" style={soft}>+{c.brands.length - 3} more</span>}
                </div>
                <div className="flex gap-1.5">
                  {c.clips.slice(0, 3).map((v, k) => (
                    <a key={`${v.id || k}`} href={v.video || v.thumbnail || '#'} target="_blank" rel="noopener noreferrer" title={`${v.brand || 'Video'}${v.rank ? `, TRYBE #${v.rank}` : ''}`}
                      className="relative w-[46px] rounded-lg overflow-hidden border shrink-0" style={{ aspectRatio: '9 / 16', borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                      {v.thumbnail
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={v.thumbnail} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                        : null}
                      <span className="absolute inset-0 flex items-center justify-center"><span className="w-5 h-5 rounded-full inline-flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}><Play size={10} /></span></span>
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
        {creators.length > creatorsShown && <button onClick={() => setCreatorsShown((n) => n + 25)} className="mt-2 text-[13px] font-semibold" style={{ color: PURPLE }}>Show more ({creators.length - creatorsShown} left)</button>}
      </section>

      {gallery}

      {isAdmin && <p className="text-[11px]" style={soft}>Admin: TRYBE&rsquo;s Top 100 answer had {data.keys}. Words read for {Object.keys(data.lines).length} of {data.tried} videos asked.</p>}
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
