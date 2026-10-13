'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THIS WEEK, TRYBE Outreach's own tab (Seb, 2026-10-13, after Alejandro: "a
// weekly plan and list of collaborating brands and samples so I have control
// of who is sending what"). The brands you work with, the samples each one is
// sending, three boxes per sample (here, filmed, submitted), each sample's
// own video ideas, and the next seven days planned from those boxes
// (lib/trybe-week.ts). A list MVP could not read says so, never "no samples".

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, Copy, Check, Printer, CalendarDays, Package, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import TrybeVideoIdeas, { type SavedPlan } from '@/components/labs/TrybeVideoIdeas'
import { planWeek, brandsOf, stageOf, weekText, perDayNeeded, STAGE_WORDS, CHASE_DAYS, MONTHLY_TARGET, type Sample, type Stage, type Pace } from '@/lib/trybe-week'
import { readBrandSubs } from '@/components/labs/TrybeMyBrands'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats, type MyBrand } from '@/lib/trybe-mybrands'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const PER_DAY_KEY = 'mvp.trybe.week.perDay'
const FOCUS_KEY = 'mvp.trybe.week.focus'
const TARGET_KEY = 'mvp.trybe.week.target'

type Row = Omit<Sample, 'has_ideas'> & { ideas: SavedPlan; ideas_at: string | null }

async function call(body?: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe/samples', body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) }
    : { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
  return d
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const DAY = 86_400_000
const ago = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY)) : 0)

export default function TrybeWeek({ knownBrands, canRead, isAdmin = false }: {
  /** Brands MVP knows the creator works with or asked (accepted first). */
  knownBrands: Array<{ id: string; name: string }>
  /** SCOUT can read TRYBE (brand stats, briefs, best videos). */
  canRead: boolean
  isAdmin?: boolean
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [joined, setJoined] = useState<MyBrand[] | null>(null)
  // YOUR MONTH (Lukas Pakter, TRYBE's co-founder): a video target per focus
  // brand, and how many went this month, read from TRYBE through SCOUT.
  const [focus, setFocus] = useState<string[] | null>(null)
  const [target, setTarget] = useState(MONTHLY_TARGET)
  const [sentThisMonth, setSentThisMonth] = useState<Record<string, { n: number | null; error: string | null }>>({})
  const [monthReading, setMonthReading] = useState(false)
  const [brand, setBrand] = useState('')
  const [product, setProduct] = useState('')
  const [count, setCount] = useState(3)
  const [here, setHere] = useState(false)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [copied, setCopied] = useState(false)
  const [perDay, setPerDay] = useState(1)

  useEffect(() => { try { const v = Number(localStorage.getItem(PER_DAY_KEY)); if (v >= 1 && v <= 3) setPerDay(v) } catch { /* default */ } }, [])
  const choosePerDay = (v: number) => { setPerDay(v); try { localStorage.setItem(PER_DAY_KEY, String(v)) } catch { /* kept for this visit */ } }

  const load = useCallback(async () => {
    setLoadError(null)
    try { const d = await call(); setRows((d.samples || []) as Row[]) }
    catch (e) { setLoadError(e instanceof Error ? e.message : 'MVP could not read your samples.') }
  }, [])
  useEffect(() => { void load() }, [load])

  // The brands you joined on TRYBE, for the brand box. Best effort.
  useEffect(() => {
    if (!canRead || joined) return
    void requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all').then((r) => {
      setJoined(r.ok ? readBrandStats(r.json) : [])
    }).catch(() => setJoined([]))
  }, [canRead, joined])

  useEffect(() => {
    try {
      const f = JSON.parse(localStorage.getItem(FOCUS_KEY) || 'null')
      if (Array.isArray(f)) setFocus(f.filter((x) => typeof x === 'string'))
      const t = Number(localStorage.getItem(TARGET_KEY))
      if ([15, 30, 45, 60, 90].includes(t)) setTarget(t)
    } catch { /* defaults */ }
  }, [])
  // Focus brands: chosen by the creator, else the 2 that paid most (on TRYBE
  // the top creators make about 90% of their money from 1 or 2 brands).
  const focusIds = useMemo(() => {
    if (focus) return focus
    return (joined || []).filter((b) => (b.earnings ?? 0) > 0).slice(0, 2).map((b) => b.id)
  }, [focus, joined])
  const toggleFocus = (id: string) => {
    const next = focusIds.includes(id) ? focusIds.filter((x) => x !== id) : [...focusIds, id].slice(0, 5)
    setFocus(next)
    try { localStorage.setItem(FOCUS_KEY, JSON.stringify(next)) } catch { /* kept for this visit */ }
  }
  const chooseTarget = (v: number) => { setTarget(v); try { localStorage.setItem(TARGET_KEY, String(v)) } catch { /* kept for this visit */ } }

  // This month's videos sent per focus brand, one brand at a time.
  const focusKey = focusIds.join(',')
  useEffect(() => {
    if (!canRead || !focusIds.length) return
    let stop = false
    void (async () => {
      setMonthReading(true)
      const d = new Date()
      const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
      for (const id of focusIds) {
        if (stop) return
        const r = await readBrandSubs(id).catch((e) => ({ subs: [], error: e instanceof Error ? e.message : 'SCOUT did not answer.', complete: false }))
        const n = r.error ? null : r.subs.filter((x) => (x.at ?? 0) >= start).length
        if (!stop) setSentThisMonth((m) => ({ ...m, [id]: { n, error: r.error } }))
      }
      if (!stop) setMonthReading(false)
    })()
    return () => { stop = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, focusKey])

  const pace: Pace[] = useMemo(() => focusIds.map((id) => {
    const b = (joined || []).find((x) => x.id === id)
    const s = sentThisMonth[id]
    return b && s && s.n != null ? { brand: b.name, sent: s.n, target } : null
  }).filter((x): x is Pace => !!x), [focusIds, joined, sentThisMonth, target])

  const suggestions = useMemo(() => {
    const seen = new Set<string>()
    return [...(joined || []), ...knownBrands].filter((b) => {
      const k = b.name.trim().toLowerCase()
      if (!k || seen.has(k)) return false
      seen.add(k); return true
    })
  }, [joined, knownBrands])

  const samples: Sample[] = useMemo(() => (rows || []).map((r) => ({ ...r, has_ideas: !!r.ideas })), [rows])
  const days = useMemo(() => planWeek(samples, { perDay, pace }), [samples, perDay, pace])
  const brands = useMemo(() => brandsOf(samples), [samples])
  const byStage = (st: Stage) => (rows || []).filter((r) => stageOf(r) === st)

  async function add() {
    const name = brand.trim()
    if (!name || !product.trim()) { toast.error('Name the brand and the product.'); return }
    const match = suggestions.find((b) => b.name.trim().toLowerCase() === name.toLowerCase())
    setAdding(true)
    try {
      const d = await call({ action: 'add', brandName: name, brandId: match?.id, product: product.trim(), videosPlanned: count, received: here })
      setRows((xs) => [d.sample as Row, ...(xs || [])])
      setProduct(''); setHere(false)
      toast.success(`${product.trim()} from ${name} added`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add it.') }
    finally { setAdding(false) }
  }

  async function tick(r: Row, field: 'received' | 'filmed' | 'submitted', on: boolean) {
    setBusy(`${r.id}:${field}`)
    try {
      const d = await call({ action: 'tick', id: r.id, field, on })
      setRows((xs) => (xs || []).map((x) => (x.id === r.id ? { ...x, ...(d.sample as Row) } : x)))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Not saved.') }
    finally { setBusy(null) }
  }

  async function remove(r: Row) {
    if (!window.confirm(`Remove ${r.product} from ${r.brand_name} from your list?`)) return
    setBusy(`${r.id}:remove`)
    try { await call({ action: 'remove', id: r.id }); setRows((xs) => (xs || []).filter((x) => x.id !== r.id)) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Not removed.') }
    finally { setBusy(null) }
  }

  const copyWeek = async () => {
    try { await navigator.clipboard.writeText(weekText(days)); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { toast.error('Could not copy.') }
  }
  const printWeek = () => {
    const w = window.open('', '_blank', 'width=820,height=900')
    if (!w) { toast.error('Your browser blocked the print window. Allow pop ups for MVP, or use Copy.'); return }
    const body = days.map((d) => `<section><h2>${esc(d.label)} <small>${esc(d.date)}</small></h2>${d.tasks.length ? `<ul>${d.tasks.map((t) => `<li>&#9744; ${esc(t.text)}</li>`).join('')}</ul>` : '<p>Nothing planned</p>'}</section>`).join('')
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Your TRYBE week</title><style>body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:720px;margin:32px auto;padding:0 16px}h1{font-size:20px}h2{font-size:15px;margin:0 0 4px}small{color:#666;font-weight:400}ul{list-style:none;padding:0;margin:0}li{padding:2px 0}section{border-top:1px solid #ddd;padding:10px 0;break-inside:avoid}</style></head><body><h1>Your TRYBE week</h1>${body}</body></html>`)
    w.document.close(); w.focus()
    setTimeout(() => { try { w.print() } catch { /* the page stays open to print by hand */ } }, 300)
  }

  const card = 'rounded-2xl border p-5'
  const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
  const soft = { color: 'var(--text-soft)' }
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50'
  const field = 'rounded-lg border bg-transparent px-2.5 py-1.5 text-[13px]'
  const tasksTotal = days.reduce((n, d) => n + d.tasks.length, 0)

  if (loadError) {
    return (
      <div className={card} style={cardStyle}>
        <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {loadError}</p>
        <button onClick={() => void load()} className={`${btn} mt-2`} style={{ border: '1px solid var(--border)' }}>Try again</button>
      </div>
    )
  }
  if (!rows) return <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading your samples...</p>

  // A plain function, not a component: a component made here would remount
  // on every render and close the open video ideas mid-plan.
  const sampleRow = (r: Row) => {
    const st = stageOf(r)
    const when = st === 'on_the_way' ? `asked ${ago(r.requested_at)} day${ago(r.requested_at) === 1 ? '' : 's'} ago`
      : st === 'to_film' ? `here ${ago(r.received_at)} day${ago(r.received_at) === 1 ? '' : 's'}`
      : st === 'to_submit' ? `filmed ${ago(r.filmed_at)} day${ago(r.filmed_at) === 1 ? '' : 's'} ago` : `submitted ${ago(r.submitted_at)} day${ago(r.submitted_at) === 1 ? '' : 's'} ago`
    const late = (st === 'on_the_way' && ago(r.requested_at) >= CHASE_DAYS) || (st === 'to_film' && ago(r.received_at) >= 7)
    const box = (f: 'received' | 'filmed' | 'submitted', label: string, on: boolean) => (
      <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
        {busy === `${r.id}:${f}` ? <Loader2 size={13} className="animate-spin" /> : <input type="checkbox" checked={on} onChange={(e) => void tick(r, f, e.target.checked)} className="h-4 w-4" style={{ accentColor: GREEN }} />}
        {label}
      </label>
    )
    return (
      <li key={r.id} className="rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold">{r.product}</p>
            <p className="text-[12px]" style={late ? { color: AMBER } : soft}>{r.brand_name} · {r.videos_planned} video{r.videos_planned === 1 ? '' : 's'} · {when}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
            {box('received', 'Received', !!r.received_at)}
            {box('filmed', 'Filmed', !!r.filmed_at)}
            {box('submitted', 'Submitted', !!r.submitted_at)}
            <button onClick={() => void remove(r)} disabled={busy === `${r.id}:remove`} title="Remove from your list" className="p-1 rounded" style={soft}><Trash2 size={13} /></button>
          </div>
        </div>
        {st !== 'done' && (
          <button onClick={() => setOpen((o) => (o === r.id ? null : r.id))} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PURPLE }}>
            {r.ideas ? 'Video ideas for this sample' : 'Plan videos for this sample'} {open === r.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
        {open === r.id && (
          <div className="mt-2">
            <TrybeVideoIdeas brandId={r.brand_id || ''} sampleId={r.id} name={r.brand_name} plan={r.ideas} canRead={canRead} isAdmin={isAdmin}
              onPlan={(p) => setRows((xs) => (xs || []).map((x) => (x.id === r.id ? { ...x, ideas: p, ideas_at: new Date().toISOString() } : x)))} />
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="space-y-4">
      {/* YOUR MONTH: the video target per focus brand. */}
      <div className={card} style={cardStyle}>
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <p className="text-[15px] font-semibold">Your month</p>
          <label className="ml-auto text-[12px] inline-flex items-center gap-1.5" style={soft}>
            Videos a month per focus brand
            <select value={target} onChange={(e) => chooseTarget(Number(e.target.value))} className={field} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              {[15, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <p className="text-[12.5px] mb-3 max-w-[75ch]" style={soft}>About 1 ad in 25 becomes a winner (Meta&rsquo;s figure, as TRYBE&rsquo;s co-founder quotes it), so around 30 videos a month gives you a fair shot at one. Your first 2 or 3 with a new brand only test whether it answers; after that, this is the pace. Most top creators earned little for their first months: the ones who kept the volume up are the ones earning now.</p>
        {!canRead ? (
          <p className="text-[13px]" style={soft}>Allow SCOUT on TRYBE and MVP counts the videos you sent each brand this month.</p>
        ) : joined === null ? (
          <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading the brands you work with on TRYBE...</p>
        ) : joined.length === 0 ? (
          <p className="text-[13px]" style={soft}>No brand has accepted you on TRYBE yet. Once one does, set your monthly target here.</p>
        ) : (<>
          {focusIds.length === 0 && <p className="text-[13px] mb-2" style={soft}>Pick the 1 or 2 brands you are building with. On TRYBE the top creators make about 90% of their money from 1 or 2 brands.</p>}
          <ul className="space-y-2.5">
            {focusIds.map((id) => {
              const b = joined.find((x) => x.id === id)
              if (!b) return null
              const st = sentThisMonth[id]
              const n = st?.n
              const share = n != null ? Math.min(1, n / target) : 0
              const need = n != null ? perDayNeeded({ brand: b.name, sent: n, target }) : null
              return (
                <li key={id}>
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
                    <b>{b.name}</b>
                    <span className="tabular-nums" style={n != null && n >= target ? { color: GREEN } : soft}>
                      {st == null ? 'reading...' : n == null ? `could not read: ${st.error}` : `${n} of ${target} sent this month`}
                    </span>
                    {need != null && need > 0 && <span className="ml-auto text-[12.5px]" style={soft}>{need} a day to get there</span>}
                    {n != null && n >= target && <span className="ml-auto text-[12.5px] font-semibold" style={{ color: GREEN }}>Target reached</span>}
                  </div>
                  <span className="block mt-1 h-2 rounded-full" style={{ background: 'var(--border)' }}>
                    <span className="block h-2 rounded-full" style={{ width: `${Math.max(2, Math.round(share * 100))}%`, background: n != null && n >= target ? GREEN : PURPLE }} />
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {joined.slice(0, 12).map((b) => {
              const on = focusIds.includes(b.id)
              return (
                <button key={b.id} onClick={() => toggleFocus(b.id)} aria-pressed={on} className="rounded-full border px-2.5 py-1 text-[12px] font-semibold"
                  style={on ? { background: 'rgba(124,58,237,0.10)', color: PURPLE, borderColor: 'transparent' } : { borderColor: 'var(--border)', color: 'var(--text)' }}>
                  {on ? '\u2713 ' : '+ '}{b.name}
                </button>
              )
            })}
          </div>
          {monthReading && <p className="mt-2 text-[12px] inline-flex items-center gap-1" style={soft}><Loader2 size={11} className="animate-spin" /> Counting this month&rsquo;s videos on TRYBE...</p>}
        </>)}
      </div>

      {/* The next seven days. */}
      <div className={card} style={cardStyle}>
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <p className="text-[15px] font-semibold inline-flex items-center gap-1.5"><CalendarDays size={16} style={{ color: PURPLE }} /> Your next 7 days</p>
          <label className="ml-auto text-[12px] inline-flex items-center gap-1.5" style={soft}>
            Samples to film a day
            <select value={perDay} onChange={(e) => choosePerDay(Number(e.target.value))} className={field} style={{ borderColor: 'var(--border)' }}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <p className="text-[12.5px] mb-3" style={soft}>Planned from your samples below. Tick a box there and the week changes. Two or three videos per brand to start, oldest sample first.</p>
        {tasksTotal === 0 ? (
          <p className="text-[13px]" style={soft}>{rows.length ? 'Nothing to do this week: every sample is submitted or still on its way.' : 'Add the samples brands are sending you below, and MVP plans your week from them.'}</p>
        ) : (
          <>
            <ol className="grid gap-2 sm:grid-cols-2">
              {days.map((d) => (
                <li key={d.date} className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border)', opacity: d.tasks.length ? 1 : 0.6 }}>
                  <p className="text-[12px] font-bold uppercase tracking-wider" style={soft}>{d.label} <span className="font-normal normal-case tracking-normal">{d.date}</span></p>
                  {d.tasks.length ? (
                    <ul className="mt-1 space-y-1">
                      {d.tasks.map((t, i) => (
                        <li key={i} className="text-[13px] flex items-start gap-1.5" style={t.late ? { color: AMBER } : undefined}>
                          <span aria-hidden className="mt-0.5 shrink-0 text-[11px] font-bold rounded px-1" style={{ background: t.kind === 'film' || t.kind === 'volume' ? 'rgba(124,58,237,0.12)' : 'rgba(0,0,0,0.05)', color: t.kind === 'film' || t.kind === 'volume' ? PURPLE : 'var(--text-soft)' }}>
                            {t.kind === 'film' || t.kind === 'volume' ? 'Film' : t.kind === 'submit' ? 'Submit' : t.kind === 'ideas' ? 'Plan' : 'Ask'}
                          </span>
                          <span>{t.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-[12.5px] mt-1" style={soft}>Nothing planned</p>}
                </li>
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => void copyWeek()} className={btn} style={{ border: '1px solid var(--border)' }}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy the week'}</button>
              <button onClick={printWeek} className={btn} style={{ border: '1px solid var(--border)' }}><Printer size={13} /> Print or save as PDF</button>
            </div>
          </>
        )}
      </div>

      {/* The brands you work with. */}
      {(brands.length > 0 || (joined && joined.length > 0)) && (
        <div className={card} style={cardStyle}>
          <p className="text-[15px] font-semibold mb-2">Brands you work with</p>
          <div className="flex flex-wrap gap-2">
            {brands.map((b) => (
              <span key={b.name} className="rounded-full border px-3 py-1 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
                <b>{b.name}</b>{' '}
                <span style={soft}>{(['on_the_way', 'to_film', 'to_submit', 'done'] as Stage[]).filter((s) => b.counts[s]).map((s) => `${b.counts[s]} ${STAGE_WORDS[s].toLowerCase()}`).join(', ')}</span>
              </span>
            ))}
            {(joined || []).filter((j) => !brands.some((b) => b.name.trim().toLowerCase() === j.name.trim().toLowerCase())).map((j) => (
              <span key={j.id} className="rounded-full border px-3 py-1 text-[12.5px]" style={{ borderColor: 'var(--border)', ...soft }} title="Joined on TRYBE, no sample logged in MVP">{j.name} <span>· no sample logged</span></span>
            ))}
          </div>
          {canRead && joined === null && <p className="mt-2 text-[12px] inline-flex items-center gap-1" style={soft}><Loader2 size={11} className="animate-spin" /> Reading the brands you joined on TRYBE...</p>}
        </div>
      )}

      {/* The samples, with their boxes. */}
      <div className={card} style={cardStyle}>
        <p className="text-[15px] font-semibold inline-flex items-center gap-1.5 mb-1"><Package size={16} style={{ color: PURPLE }} /> Samples</p>
        <p className="text-[12.5px] mb-3" style={soft}>Add each sample you ask a brand for. Tick Received when it arrives, Filmed when the videos are shot, Submitted when they are on TRYBE.</p>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <label className="flex flex-col gap-1 text-[12px] min-w-[160px] flex-1" style={soft}>Brand
            <input list="trybe-week-brands" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" className={field} style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            <datalist id="trybe-week-brands">{suggestions.map((b) => <option key={b.id || b.name} value={b.name} />)}</datalist>
          </label>
          <label className="flex flex-col gap-1 text-[12px] min-w-[180px] flex-[2]" style={soft}>Product
            <input value={product} onChange={(e) => setProduct(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add() }} placeholder="What they are sending" className={field} style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={soft}>Videos
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} className={field} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-[12.5px] pb-2 cursor-pointer"><input type="checkbox" checked={here} onChange={(e) => setHere(e.target.checked)} className="h-4 w-4" style={{ accentColor: GREEN }} /> Already here</label>
          <button onClick={() => void add()} disabled={adding || !brand.trim() || !product.trim()} className={btn} style={{ background: PURPLE, color: '#fff' }}>
            {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add sample
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="text-[13px]" style={soft}>No samples yet. When a brand accepts you on TRYBE, request a sample on its brand page, then add it here.</p>
        ) : (
          <div className="space-y-4">
            {(['to_film', 'to_submit', 'on_the_way'] as Stage[]).map((st) => {
              const list = byStage(st)
              if (!list.length) return null
              return (
                <div key={st}>
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={soft}>{STAGE_WORDS[st]} ({list.length})</p>
                  <ul className="space-y-2">{list.map((r) => sampleRow(r))}</ul>
                </div>
              )
            })}
            {byStage('done').length > 0 && (
              <div>
                <button onClick={() => setShowDone((v) => !v)} className="text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1" style={soft}>
                  {STAGE_WORDS.done} ({byStage('done').length}) {showDone ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {showDone && <ul className="mt-1.5 space-y-2">{byStage('done').map((r) => sampleRow(r))}</ul>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
