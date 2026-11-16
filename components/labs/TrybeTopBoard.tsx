'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE TOP 100 BOARD (Seb, 2026-11-16, after TrybeDaily's Top brands: "MVP
// should be really the place where people go and get help with this stuff";
// of four layouts, "a little mix of everything": A is very clean, B is great
// in terms of visual, C the charting). So, top to bottom:
//   A's three tiles and who is worth contacting this week, each with why in
//     one line and the next step;
//   C's race of points over the month, with a day slider, beside it;
//   B's movers (climbers, drops, new) and the whole leaderboard with filters.
// Every brand name opens its brand page, which has "On the board".
//
// From the Top 100 MVP saves every day (lib/trybe-topboard). Fit is MVP's
// own pick, the same as Find brands, read through 'browse' by ids; a brand
// not read yet says "Not read yet", never a blank that looks like a no. The
// board says how many saved days it stands on, and when the last one was.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, AlertTriangle, RotateCcw, ChevronLeft, ChevronRight, MessageCircle, Clapperboard, TrendingUp, TrendingDown, Sparkles } from 'lucide-react'
import TrybeLink from '@/components/labs/TrybeLink'
import { BrandName } from '@/components/labs/trybe-dossier-context'
import type { PeekActions } from '@/components/labs/TrybeBrandPeek'
import { moversOf, raceOn, placesWords, moveWords, whyLine, worthContacting, risingOf, sparkOf, inTop, askedOf, type BoardBrand, type Board, type FitWord } from '@/lib/trybe-topboard'
import { verdictOf, VERDICT_WORDS, type PickReason } from '@/lib/trybe-pick'
import { readPay, payPasses } from '@/lib/trybe-outreach'

const ACCENT = 'var(--accent)'
const GREEN = '#16A34A'
const RED = '#DC2626'
const BLUE = '#2563EB'
const AMBER = '#B45309'
const ORANGE = '#C2410C'
const soft = { color: 'var(--text-3)' }
const card = 'rounded-2xl border'
const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
/** Brands MVP reads the fit of per call ('browse' takes 60 ids). */
const FIT_CHUNK = 60
const SHOWN = 50

interface Info { name: string; website: string | null; categories: string[]; pay_text: string | null; creators: number | null; earnings_bucket: string | null }
interface BoardRead extends Board { info: Record<string, Info>; status: Record<string, string> }
interface Fit { word: FitWord; reasons: PickReason[]; niche: boolean }

const STATUS_WORDS: Record<string, string> = { drafted: 'In Ready to send', sending: 'Sending', sent: 'You asked', already: 'You asked', failed: 'Send failed', skipped: 'You passed', removed: 'You removed it', not_fit: 'Not a fit', new: 'On your list' }
const FIT_LOOK: Record<FitWord, { bg: string; fg: string; bar: string }> = {
  strong: { bg: 'rgb(22 163 74 / 0.12)', fg: GREEN, bar: GREEN },
  look: { bg: 'rgb(180 83 9 / 0.12)', fg: AMBER, bar: '#D97706' },
  skip: { bg: 'var(--surface-2)', fg: 'var(--text-3)', bar: '#94A3B8' },
  unknown: { bg: 'var(--surface-2)', fg: 'var(--text-3)', bar: '#94A3B8' },
}
const dayWords = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')
const PAYS = [{ id: 'any', label: 'Any pay' }, { id: 'flat', label: 'Pays per video' }, { id: 'percent', label: 'Pays % of sales' }] as const
type PayPick = typeof PAYS[number]['id']

async function post(body: Record<string, unknown>, ms = 60_000) {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
  return d
}

export default function TrybeTopBoard({ scoutOpens, actions, cats, kws, onScripts }: {
  scoutOpens: boolean; actions?: PeekActions; cats: string[]; kws: string[]; onScripts?: (id: string, name: string) => void
}) {
  const [board, setBoard] = useState<BoardRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fits, setFits] = useState<Record<string, Fit>>({})
  const [fitError, setFitError] = useState<string | null>(null)
  const [reading, setReading] = useState(0)
  const asked = useRef(new Set<string>())
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const [retry, setRetry] = useState(0)
  const [day, setDay] = useState<number | null>(null)
  const [pay, setPay] = useState<PayPick>('any')
  const [openOnly, setOpenOnly] = useState(false)
  const [limit, setLimit] = useState(SHOWN)
  const [doing, setDoing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setBoard(await post({ action: 'top_board' }) as BoardRead) }
    catch (e) { setError(e instanceof Error ? e.message : 'MVP could not read the Top 100 board.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const saved = board?.days.length ?? 0
  const statusOf = useCallback((id: string) => board?.status[id] ?? null, [board])
  const fitOf = useCallback((id: string): FitWord | null => fits[id]?.word ?? null, [fits])
  const movers = useMemo(() => (board ? moversOf(board) : null), [board])
  const rows = useMemo(() => (board ? board.brands.filter((b) => b.daysIn > 0)
    .filter((b) => pay === 'any' || payPasses(readPay(board.info[b.id]?.pay_text), pay))
    .filter((b) => !openOnly || !askedOf(statusOf(b.id))) : []), [board, pay, openOnly, statusOf])
  const picks = useMemo(() => (board ? worthContacting(board, fitOf, statusOf, 5, (id) => !!fits[id]?.niche) : []), [board, fitOf, statusOf, fits])

  // THE FIT, A FEW AT A TIME: the brands on screen first (rising ones,
  // movers, the leaderboard shown), each id asked once.
  const need = useMemo(() => {
    if (!board) return [] as string[]
    const ids = [
      ...board.brands.filter(risingOf).map((b) => b.id),
      ...(movers ? [...movers.climbers, ...movers.drops, ...movers.fresh].map((b) => b.id) : []),
      ...rows.slice(0, limit).map((b) => b.id),
    ]
    return Array.from(new Set(ids))
  }, [board, movers, rows, limit])
  useEffect(() => {
    const todo = need.filter((id) => !asked.current.has(id))
    if (!todo.length) return
    todo.forEach((id) => asked.current.add(id))
    // Not dropped when the list grows: an answer still lands, so no id is
    // left asked and never read.
    ;(async () => {
      setReading((n) => n + todo.length)
      for (let i = 0; i < todo.length; i += FIT_CHUNK) {
        const part = todo.slice(i, i + FIT_CHUNK)
        try {
          const d = await post({ action: 'browse', ids: part, limit: part.length, includeMine: true, categories: cats, keywords: kws, payType: 'any', sort: 'match' }, 90_000)
          const got: Record<string, Fit> = {}
          for (const x of (d.brands || []) as Array<{ brand_id: string; pick?: number; pick_read?: number; pick_reasons?: PickReason[]; match?: number }>) {
            got[x.brand_id] = { word: verdictOf(Number(x.pick ?? 0), Number(x.pick_read ?? 0)), reasons: Array.isArray(x.pick_reasons) ? x.pick_reasons : [], niche: (cats.length + kws.length) > 0 && Number(x.match ?? 0) > 0 }
          }
          // A brand browse did not return (left TRYBE's list) is read, with too little to judge.
          for (const id of part) if (!got[id]) got[id] = { word: 'unknown', reasons: [], niche: false }
          if (alive.current) { setFits((f) => ({ ...f, ...got })); setFitError(null) }
        } catch (e) {
          part.forEach((id) => asked.current.delete(id))
          if (alive.current) setFitError(e instanceof Error ? e.message : 'MVP could not read the fit.')
        } finally { if (alive.current) setReading((n) => Math.max(0, n - part.length)) }
      }
    })()
  }, [need, cats, kws, retry])

  const write = async (b: BoardBrand) => {
    if (!actions) return
    setDoing(b.id)
    try { await actions.message(b.id); await load() } finally { setDoing(null) }
  }

  if (error) {
    return (
      <div className={`${card} p-5`} style={cardStyle}>
        <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>
        <button onClick={() => void load()} className="mt-2 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold" style={{ border: '1px solid var(--border)' }}><RotateCcw size={12} /> Try again</button>
      </div>
    )
  }
  if (!board) return <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Working out the Top 100 board from the days MVP saved...</p>
  if (!saved) {
    return (
      <div className={`${card} p-5 text-[13.5px]`} style={{ ...cardStyle, ...soft }}>
        MVP has not saved a day of TRYBE&rsquo;s Top 100 yet. It saves one each day the MVP team reads the Top 100, and the board starts from the first.
      </div>
    )
  }

  const name = (id: string) => board.info[id]?.name || 'A brand'
  const stale = board.latest ? Date.now() - Date.parse(`${board.latest}T23:59:59Z`) > 2 * 86_400_000 : false
  const idx = day ?? saved - 1
  const race = raceOn(board, idx, 10)
  const raceMax = Math.max(1, ...race.map((r) => r.points))
  const fitLabel = (id: string) => { const f = fits[id]; return f ? VERDICT_WORDS[f.word] : reading && asked.current.has(id) ? 'Reading...' : 'Not read yet' }
  const fitPill = (id: string) => {
    const f = fits[id]
    const look = FIT_LOOK[f?.word ?? 'unknown']
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: look.bg, color: look.fg }}>
        {fitLabel(id)}
      </span>
    )
  }
  const youWords = (id: string) => { const s = statusOf(id); return s && STATUS_WORDS[s] ? STATUS_WORDS[s] : 'Not asked yet' }
  const youColor = (id: string) => { const s = statusOf(id); return askedOf(s) ? ACCENT : s === 'failed' ? RED : 'var(--text-2)' }

  // A's tiles.
  const risingFit = board.brands.filter((b) => risingOf(b) && !askedOf(statusOf(b.id)) && (fitOf(b.id) === 'strong' || fitOf(b.id) === 'look'))
  const risingUnread = board.brands.filter((b) => risingOf(b) && !fits[b.id]).length
  const fresh = board.brands.filter((b) => b.kind === 'new')
  const mineIn = board.brands.filter((b) => askedOf(statusOf(b.id)) && inTop(b.today))
  const mineBest = mineIn.slice().sort((a, b) => (b.move ?? 0) - (a.move ?? 0))[0]
  const tiles = [
    { label: 'Rising and a fit for you', value: `${risingFit.length} brand${risingFit.length === 1 ? '' : 's'}`, color: ORANGE,
      sub: risingUnread ? `MVP is still reading the fit of ${risingUnread} more` : 'New, back, or up 10 places or more, and you have not asked yet' },
    { label: 'New to the board', value: board.weekDay ? `${fresh.length} brand${fresh.length === 1 ? '' : 's'}` : 'Not yet', color: BLUE,
      sub: board.weekDay ? 'First in the Top 100 this week, before they get crowded' : `New needs a week of saved days. MVP has ${saved}.` },
    { label: 'Brands you asked, in it today', value: String(mineIn.length), color: 'var(--text)',
      sub: mineBest && (mineBest.move ?? 0) > 0 ? `${name(mineBest.id)} climbed ${mineBest.move} places: film for it now` : mineIn.length ? `Best today: ${name(mineIn.slice().sort((a, b) => (a.today ?? 999) - (b.today ?? 999))[0].id)}` : 'None of the brands you asked are in it today' },
  ]

  return (
    <section className="space-y-5" aria-label="TRYBE Top 100">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-[13px]" style={soft}>
          From TRYBE&rsquo;s Top 100, saved by MVP every day: {saved} saved day{saved === 1 ? '' : 's'} since {dayWords(board.days[0])}
          {board.notSaved > 0 ? `, ${board.notSaved} not saved` : ''}.
        </p>
        <p className="ml-auto text-[12.5px] font-semibold" style={{ color: stale ? AMBER : 'var(--text-3)' }}>
          {stale ? `Last saved ${dayWords(board.latest)}: no newer day was saved yet` : `Last saved ${dayWords(board.latest)}`}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className={`${card} px-4 py-3`} style={cardStyle}>
            <p className="text-[11.5px] font-bold uppercase tracking-wider" style={soft}>{t.label}</p>
            <p className="text-[26px] font-bold leading-tight tabular-nums mt-1" style={{ color: t.color }}>{t.value}</p>
            <p className="text-[12.5px]" style={soft}>{t.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* A: worth contacting this week. */}
        <div className={`${card} overflow-hidden`} style={cardStyle}>
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <h3 className="text-[16px] font-bold">Worth contacting this week</h3>
            <p className="text-[12.5px]" style={soft}>Rising in the Top 100, a fit for you, and you have not asked yet</p>
          </div>
          {picks.length === 0 ? (
            <p className="px-4 py-4 text-[13px]" style={soft}>
              {reading ? 'Reading the fit of this week’s rising brands...' : !board.weekDay ? `This needs a week of saved days to see who is rising. MVP has ${saved}.` : 'No rising brand is a fit you have not asked yet. The leaderboard below has every brand.'}
            </p>
          ) : picks.map((b) => (
            <div key={b.id} className="px-4 py-3 border-t first:border-t-0 space-y-1.5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <BrandName id={b.id} name={name(b.id)} className="text-[15px] font-bold" />
                <span className="text-[13px] font-bold tabular-nums" style={{ color: b.kind === 'new' ? BLUE : GREEN }}>{moveWords(b)}</span>
                <span className="text-[12.5px] tabular-nums" style={soft}>{placesWords(b)}</span>
                {b.back && b.kind !== 'new' && <span className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgb(194 65 12 / 0.12)', color: ORANGE }}>Back after a gap</span>}
                <span className="ml-auto inline-flex items-center gap-1.5">{fits[b.id]?.niche && <span className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT }}>In your niche</span>}{fitPill(b.id)}</span>
              </div>
              <p className="text-[13px] leading-snug" style={{ color: 'var(--text-2)' }}>{whyLine(b, saved, fits[b.id]?.reasons)}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {actions && (
                  <button onClick={() => void write(b)} disabled={actions.busy || doing === b.id} className="inline-flex items-center gap-1 text-[12.5px] font-semibold disabled:opacity-50" style={{ color: ACCENT }}
                    title="Write this brand a message from your core message, into Ready to send">
                    {doing === b.id ? <Loader2 size={12} className="animate-spin" /> : <MessageCircle size={12} />} Write a message
                  </button>
                )}
                {onScripts && (
                  <button onClick={() => onScripts(b.id, name(b.id))} className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: ACCENT }}>
                    <Clapperboard size={12} /> Write scripts
                  </button>
                )}
                <TrybeLink brandId={b.id} name={name(b.id)} scout={scoutOpens} />
              </div>
            </div>
          ))}
        </div>

        {/* C: the race. */}
        <div className={`${card} p-4 space-y-3`} style={cardStyle}>
          <div>
            <h3 className="text-[16px] font-bold">The race</h3>
            <p className="text-[12.5px]" style={soft}>Points for every saved day in the Top 100: #1 earns 100, #100 earns 1</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDay(Math.max(0, idx - 1))} disabled={idx <= 0} aria-label="One saved day back" className="w-8 h-8 rounded-lg border grid place-items-center disabled:opacity-40" style={{ borderColor: 'var(--border)' }}><ChevronLeft size={15} /></button>
            <input type="range" min={0} max={saved - 1} value={idx} onChange={(e) => setDay(Number(e.target.value))} aria-label="Saved day" className="flex-1" style={{ accentColor: 'var(--accent)' }} />
            <button onClick={() => setDay(Math.min(saved - 1, idx + 1))} disabled={idx >= saved - 1} aria-label="One saved day forward" className="w-8 h-8 rounded-lg border grid place-items-center disabled:opacity-40" style={{ borderColor: 'var(--border)' }}><ChevronRight size={15} /></button>
            <span className="min-w-[6.5rem] text-right text-[13px] font-bold tabular-nums">Day {idx + 1} · {dayWords(board.days[idx])}</span>
          </div>
          <ol className="space-y-1.5">
            {race.map((r, i) => {
              const look = FIT_LOOK[fits[r.b.id]?.word ?? 'unknown']
              return (
                <li key={r.b.id} className="grid items-center gap-2" style={{ gridTemplateColumns: '1.5rem minmax(0, 8.5rem) minmax(0, 1fr) 3.5rem' }}>
                  <span className="text-[12.5px] font-bold tabular-nums" style={soft}>{i + 1}</span>
                  <BrandName id={r.b.id} name={name(r.b.id)} className="block max-w-full text-[13px] font-semibold truncate" />
                  <span className="h-5 rounded-md overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                    <span className="block h-5 rounded-md motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${Math.max(1, (r.points / raceMax) * 100)}%`, background: look.bar }} />
                  </span>
                  <span className="text-[12.5px] font-bold tabular-nums text-right">{r.points.toLocaleString()}</span>
                </li>
              )
            })}
          </ol>
          <p className="text-[11.5px] flex flex-wrap gap-x-3 gap-y-1" style={soft}>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: GREEN }} /> Strong pick</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#D97706' }} /> Worth a look</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#94A3B8' }} /> Skip, or not read yet</span>
          </p>
        </div>
      </div>

      {/* B: this week's movers. */}
      {board.weekDay && movers ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { title: 'Biggest climbers', icon: TrendingUp, color: GREEN, list: movers.climbers, none: 'No brand climbed since the week day.' },
            { title: 'Biggest drops', icon: TrendingDown, color: RED, list: movers.drops, none: 'No brand dropped since the week day.' },
            { title: 'New to the board', icon: Sparkles, color: BLUE, list: movers.fresh, none: 'No brand is new to the Top 100 this week.' },
          ].map((col) => (
            <div key={col.title} className={`${card} px-4 py-3`} style={cardStyle}>
              <h3 className="text-[14.5px] font-bold inline-flex items-center gap-1.5" style={{ color: col.color }}><col.icon size={15} /> {col.title}</h3>
              <p className="text-[11.5px] mb-1" style={soft}>Since {dayWords(board.weekDay)}</p>
              {col.list.length === 0 ? <p className="text-[12.5px] py-2" style={soft}>{col.none}</p> : (
                <ul>
                  {col.list.map((b) => (
                    <li key={b.id} className="flex items-center gap-2 py-1.5 border-t" style={{ borderColor: 'var(--border)' }}>
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: FIT_LOOK[fits[b.id]?.word ?? 'unknown'].bar }} title={fitLabel(b.id)} />
                      <BrandName id={b.id} name={name(b.id)} className="block flex-1 min-w-0 truncate text-[13.5px] font-semibold" />
                      <span className="text-[12px] tabular-nums" style={soft}>{placesWords(b)}</span>
                      <span className="min-w-[2.75rem] text-right text-[13px] font-bold tabular-nums" style={{ color: col.color }}>{moveWords(b)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className={`${card} px-4 py-3 text-[13px]`} style={{ ...cardStyle, ...soft }}>This week&rsquo;s climbers, drops and new brands need a week of saved days. MVP has {saved} so far.</p>
      )}

      {/* B: the leaderboard. */}
      <div className={`${card} p-4 space-y-3`} style={cardStyle}>
        <div>
          <h3 className="text-[18px] font-bold tracking-tight">Leaderboard</h3>
          <p className="text-[12.5px]" style={soft}>Every brand in the Top 100 on a saved day, ranked by score: its average points a saved day, so every day at #1 is 100.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PAYS.map((p) => (
            <button key={p.id} onClick={() => { setPay(p.id); setLimit(SHOWN) }} aria-pressed={pay === p.id}
              className="rounded-full px-3 py-1 text-[12.5px] font-semibold border whitespace-nowrap"
              style={pay === p.id ? { background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT, borderColor: 'transparent' } : { borderColor: 'var(--border)', color: 'var(--text)' }}>{p.label}</button>
          ))}
          <label className="inline-flex items-center gap-1.5 text-[12.5px] ml-1">
            <input type="checkbox" checked={openOnly} onChange={(e) => { setOpenOnly(e.target.checked); setLimit(SHOWN) }} style={{ accentColor: 'var(--accent)' }} /> Only brands I have not asked
          </label>
          {fitError && <span className="text-[12px] inline-flex items-center gap-1" style={{ color: AMBER }}><AlertTriangle size={12} /> Fit not read: {fitError}</span>}
        </div>
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full min-w-[960px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wider" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                <th className="px-3 py-2">#</th><th className="px-3 py-2">Brand</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">{saved} days</th>
                <th className="px-3 py-2">Days in</th><th className="px-3 py-2">#1 days</th><th className="px-3 py-2">Best</th><th className="px-3 py-2">Today</th>
                <th className="px-3 py-2">Pays</th><th className="px-3 py-2">Fit for you</th><th className="px-3 py-2">You</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((b, i) => {
                const inf = board.info[b.id]
                return (
                  <tr key={b.id} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2.5 font-bold tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2.5 min-w-[11rem]">
                      <BrandName id={b.id} name={name(b.id)} className="font-bold" />
                      {inf?.categories.length ? <div className="text-[11.5px]" style={soft}>{inf.categories.slice(0, 2).join(' · ')}</div> : null}
                      {b.back && b.kind !== 'new' && <div className="text-[11px] font-bold mt-0.5" style={{ color: ORANGE }}>Back after a gap</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-12 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}><span className="block h-1.5" style={{ width: `${Math.min(100, b.score)}%`, background: ACCENT }} /></span>
                        <span className="font-bold tabular-nums">{b.score.toFixed(1)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <svg width="90" height="26" viewBox="0 0 90 26" role="img" aria-label={`${name(b.id)}: in the Top 100 on ${b.daysIn} of ${saved} saved days`}>
                        <polyline points={sparkOf(b, 90, 26)} fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
                      </svg>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{b.daysIn}/{saved}</td>
                    <td className="px-3 py-2.5 tabular-nums">{b.ones}</td>
                    <td className="px-3 py-2.5 tabular-nums">{b.best != null ? `#${b.best}` : ''}</td>
                    <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{inTop(b.today) ? `#${b.today}` : <span style={soft}>Not in it</span>}</td>
                    <td className="px-3 py-2.5 min-w-[9rem] max-w-[13rem]" style={{ color: 'var(--text-2)' }}><span className="line-clamp-2">{inf?.pay_text || <span style={soft}>TRYBE does not say</span>}</span></td>
                    <td className="px-3 py-2.5">{fitPill(b.id)}</td>
                    <td className="px-3 py-2.5 min-w-[8rem] font-semibold" style={{ color: youColor(b.id) }}>{youWords(b.id)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[12.5px]" style={soft}>{Math.min(limit, rows.length)} shown of {rows.length} brand{rows.length === 1 ? '' : 's'}{reading ? `. Reading the fit of ${reading}...` : ''}</p>
          {rows.length > limit && <button onClick={() => setLimit((n) => n + SHOWN)} className="text-[13px] font-semibold" style={{ color: ACCENT }}>Show {Math.min(SHOWN, rows.length - limit)} more</button>}
          {fitError && <button onClick={() => { setFitError(null); setRetry((n) => n + 1) }} className="text-[12.5px] font-semibold inline-flex items-center gap-1" style={{ color: ACCENT }}><RotateCcw size={12} /> Read the fit again</button>}
        </div>
      </div>
    </section>
  )
}
