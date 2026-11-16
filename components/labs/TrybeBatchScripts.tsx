'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BATCH SCRIPTS FOR A BRAND CHALLENGE (Seb, 2026-11-14: "we need to add a
// functionality into trybe scriptwriting so people can do batches of
// scripts"). MVP writes 50 to 300 story-time scripts in rounds of ten, checks
// each against the brand's rules, and keeps them here to edit, rewrite, track
// from draft to accepted, and download as a PDF or CSV.
//
// STARTS FROM TRYBE (Seb, 2026-11-15: "we should have a way to be able to
// select the product and then MVP figure out the brief and all that stuff"):
// pick the brand and the product the way Brand scripts does, and MVP reads
// the brand's brief on TRYBE, the documents the brand sent and its own
// description into the rules. Where the creator films and who is on camera
// come from their last campaign, so they are asked once, not every time.
// Every source is named on screen as read or not read.
// lib/trybe-batch is the engine; app/api/labs/trybe-batch the server.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Trash2, ChevronLeft, ChevronRight, Wand2, Download, FileText, RefreshCw, Star, Pencil, Check, X, Square, Play, AlertTriangle, Search, ArrowLeft } from 'lucide-react'
import {
  readCampaign, seedCampaign, planSummary, paceWords, notReadyWords, suggestDeny, storySeconds, SCRIPT_STATUSES, MAX_PER_CAMPAIGN, DEFAULT_ANGLES, DEFAULT_HOOKS,
  type Campaign, type Script, type ScriptStatus,
} from '@/lib/trybe-batch'
import { addBrandPdf } from '@/lib/trybe-brand-pdf-client'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats, byBrandName, type MyBrand } from '@/lib/trybe-mybrands'
import { loadBrandPage, type BrandPage } from '@/components/labs/TrybeVideoIdeas'
import TrybeBatchEdits, { editStage, type BatchEdit } from '@/components/labs/TrybeBatchEdits'

const ACCENT = 'var(--accent)'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'
const soft = { color: 'var(--text-soft)' }
const card = 'rounded-2xl border p-5'
const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
const input = 'w-full rounded-xl border bg-transparent px-3 py-2 text-[13.5px]'
const inputStyle = { borderColor: 'var(--border)', color: 'var(--text)' }
const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13.5px] font-semibold disabled:opacity-50'
const btnMain = { background: ACCENT, color: 'white' }
const btnSoft = { border: '1px solid var(--border)', color: 'var(--text)' }

export type Allowance = { used: number; limit: number | null; left: number | null; resetLabel: string; introNote: string | null }
type Listed = { id: string; name: string; brandId?: string | null; target: number; scripts: number; accepted: number; updatedAt: string }
type Answer = Record<string, unknown> & { error?: string }
/** What TRYBE's page gave for the brief, sent to the rules reader. */
export type TrybeBrief = { brief: string | null; state: BrandPage['state']; why: string | null; brandName: string }
/** What the rules reader read, as the server reports it. */
export type Read = {
  trybe: { words: number } | { state: string; why: string | null } | null
  sent: string[]; pasted: number; brand: boolean; claims: number
  claimsFrom: 'brief' | 'sent' | 'pasted' | 'brand' | 'none' | null
  context?: { ideas: number } | { failed: true } | null
} | { error: string }

export async function call(action: string, payload: Record<string, unknown> = {}, ms = 60_000): Promise<Answer> {
  try {
    const r = await fetch('/api/labs/trybe-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }), signal: AbortSignal.timeout(ms) })
    const j = await r.json().catch(() => ({})) as Answer
    if (!r.ok) return { ...j, error: j.error || `MVP answered ${r.status}.` }
    return j
  } catch (e) {
    return { error: e instanceof Error && e.name === 'TimeoutError' ? 'MVP took too long to answer. Nothing is lost; try again.' : 'MVP did not answer. Check your connection and try again.' }
  }
}

/** One item a line, for the lists in the setup. */
function Lines({ value, onChange, rows = 3, placeholder }: { value: string[]; onChange: (v: string[]) => void; rows?: number; placeholder?: string }) {
  const [text, setText] = useState(value.join('\n'))
  useEffect(() => { setText(value.join('\n')) }, [value])
  return <textarea rows={rows} className={input} style={inputStyle} placeholder={placeholder} value={text}
    onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text.split('\n').map((x) => x.trim()).filter(Boolean))} />
}
const Label = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
  <div className="mb-1"><p className="text-[13px] font-semibold">{children}</p>{hint && <p className="text-[12px]" style={soft}>{hint}</p>}</div>
)
const Toggle = ({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) => (
  <label className="flex items-start gap-2 text-[13.5px] cursor-pointer"><input type="checkbox" className="mt-1" checked={on} onChange={(e) => onChange(e.target.checked)} /> <span>{children}</span></label>
)
const FILTER_WORDS: Record<string, string> = { green: 'Passes every rule', amber: 'Has a warning', red: 'Breaks a rule', yes: 'Real stories only', no: 'Stories anyone can tell' }
const statusLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const stateColour = (s: Script['checks']['state']) => (s === 'red' ? RED : s === 'amber' ? AMBER : GREEN)
const STEPS = ['Rules', 'Where you film', 'Angles and hooks', 'Write']
export const trybeOf = (p: BrandPage | null, brandName: string): TrybeBrief => ({ brief: p?.brief || null, state: p?.state || 'unread', why: p?.briefWhy || null, brandName })

export default function TrybeBatchScripts({ canRead = false }: { canRead?: boolean }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<Listed[] | null>(null)
  const [last, setLast] = useState<Record<string, unknown> | null>(null)
  const [allowance, setAllowance] = useState<Allowance | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [c, setC] = useState<Campaign | null>(null)
  const [scripts, setScripts] = useState<Script[]>([])
  const [view, setView] = useState<'list' | 'pick' | 'reading' | 'setup' | 'scripts'>('list')
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [read, setRead] = useState<Read | null>(null)
  const [reading, setReading] = useState('')
  // TRYBE's brief for each brand picked this visit, so Read again needs no second trip.
  const briefs = useRef(new Map<string, TrybeBrief>())

  const loadList = useCallback(async () => {
    const r = await call('list')
    if (r.error) { setErr(r.error); setList([]); return }
    setList((r.campaigns as Listed[]) || []); setLast((r.last as Record<string, unknown>) || null); setAllowance((r.allowance as Allowance) || null); setErr(null)
  }, [])
  useEffect(() => { if (open && list === null) void loadList() }, [open, list, loadList])

  const openCampaign = async (id: string) => {
    setBusy('open'); setErr(null); setRead(null)
    const r = await call('get', { id })
    setBusy(null)
    if (r.error) { setErr(r.error); return }
    setC(r.campaign as Campaign); setScripts((r.scripts as Script[]) || []); setAllowance((r.allowance as Allowance) || null)
    setView((r.scripts as Script[])?.length ? 'scripts' : 'setup'); setStep(0)
  }
  const save = async (next: Campaign = c!): Promise<Campaign | null> => {
    setBusy('save')
    const r = await call('save', { id: next.id || undefined, campaign: next })
    setBusy(null)
    if (r.error) { setErr(r.error); return null }
    const saved = r.campaign as Campaign
    setC(saved); setErr(null)
    return saved
  }
  // Without SCOUT on TRYBE: the same setup, typed and pasted.
  const newByHand = () => {
    setC(seedCampaign({ product: '' }, last as Parameters<typeof seedCampaign>[1])); setScripts([]); setRead(null); setView('setup'); setStep(0); setErr(null)
  }
  const newCampaign = () => { if (canRead) { setErr(null); setView('pick') } else newByHand() }

  /** The rules read from everything MVP has for the brand. */
  const readRules = async (saved: Campaign, trybe: TrybeBrief | null, pasted = '') => {
    const r = await call('rules', { id: saved.id, briefText: pasted, trybe }, 120_000)
    if (r.error) { setRead({ error: r.error }); return }
    setC(r.campaign as Campaign); setRead(r.read as Read)
  }
  /** The brief on TRYBE for this campaign's brand: kept from the pick, or read again. */
  const briefFor = async (k: Campaign): Promise<TrybeBrief | null> => {
    if (!k.brandId || !canRead) return null
    const had = briefs.current.get(k.brandId)
    if (had) return had
    const got = trybeOf(await loadBrandPage(k.brandId).catch(() => null), '')
    briefs.current.set(k.brandId, got)
    return got
  }
  const startFromTrybe = async (b: { id: string; name: string }, product: string, page: BrandPage | null) => {
    setErr(null); setRead(null); setScripts([])
    setReading(`Reading ${b.name}'s brief on TRYBE, what ${b.name} sent you, and how ${b.name} describes ${product}`)
    setView('reading')
    const saved = await save(seedCampaign({ brandId: b.id, brandName: b.name, product }, last as Parameters<typeof seedCampaign>[1]))
    if (!saved) { setView('pick'); return }
    const trybe = trybeOf(page, b.name)
    briefs.current.set(b.id, trybe)
    await readRules(saved, trybe)
    setView('setup'); setStep(0)
  }
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}" and every script in it? This cannot be undone.`)) return
    const r = await call('delete', { id }); if (r.error) { setErr(r.error); return }
    void loadList()
  }

  if (!open) {
    return (
      <section className={card} style={cardStyle}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <p className="text-[16px] font-bold">Batch scripts for a challenge</p>
            <p className="text-[13px]" style={soft}>When a brand needs many approved videos: pick the brand and product, and MVP reads the brief and writes 50 to {MAX_PER_CAMPAIGN} story-time scripts, each checked against it.</p>
          </div>
          <button className={btn} style={btnMain} onClick={() => setOpen(true)}>Open batch scripts</button>
        </div>
      </section>
    )
  }

  return (
    <section className={card} style={cardStyle}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {view !== 'list' && <button className={btn} style={btnSoft} onClick={() => { setView('list'); setC(null); setRead(null); void loadList() }}><ChevronLeft size={15} /> Campaigns</button>}
        <p className="text-[18px] font-bold flex-1">{view === 'list' ? 'Batch scripts' : view === 'pick' ? 'New campaign' : c?.name}</p>
        {allowance && <p className="text-[12.5px]" style={soft}>{allowance.limit === null ? `${allowance.used} written this month` : `${allowance.used} of ${allowance.limit} this month${allowance.resetLabel ? `, more on ${allowance.resetLabel}` : ''}`}</p>}
      </div>
      {err && <p className="text-[13px] mb-3 inline-flex items-start gap-1.5" style={{ color: RED }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}</p>}

      {view === 'list' && (
        <div className="space-y-2">
          <button className={btn} style={btnMain} onClick={newCampaign}><Plus size={15} /> New campaign</button>
          {list === null && <p className="text-[13px] inline-flex items-center gap-2" style={soft}><Loader2 size={14} className="animate-spin" /> Loading your campaigns</p>}
          {list?.length === 0 && !err && <p className="text-[13px]" style={soft}>No campaigns yet.</p>}
          {list?.map((x) => (
            <div key={x.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
              <button className="flex-1 text-left" onClick={() => void openCampaign(x.id)}>
                <p className="text-[14px] font-semibold">{x.name}</p>
                <p className="text-[12.5px]" style={soft}>{x.scripts} of {x.target} written, {x.accepted} accepted</p>
              </button>
              <button aria-label="Delete campaign" onClick={() => void remove(x.id, x.name)} style={soft}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}

      {view === 'pick' && <Picker onPick={(b, product, page) => void startFromTrybe(b, product, page)} onByHand={newByHand} />}
      {view === 'reading' && <p className="text-[14px] inline-flex items-center gap-2 py-6" style={soft}><Loader2 size={16} className="animate-spin" /> {reading}...</p>}
      {view === 'setup' && c && <Setup c={c} setC={setC} step={step} setStep={setStep} save={save} busy={busy} read={read}
        readRules={async (pasted) => { const s = await save(c); if (s) await readRules(s, await briefFor(s), pasted) }}
        onWrite={() => setView('scripts')} />}
      {view === 'scripts' && c && <Scripts c={c} scripts={scripts} setScripts={setScripts} setAllowance={setAllowance} onSetup={() => { setView('setup'); setStep(0) }} />}
    </section>
  )
}

// ── Pick the brand and the product, from TRYBE ───────────────────────────────

function Picker({ onPick, onByHand }: { onPick: (b: { id: string; name: string }, product: string, page: BrandPage | null) => void; onByHand: () => void }) {
  const [brands, setBrands] = useState<MyBrand[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState<MyBrand | null>(null)
  const [page, setPage] = useState<BrandPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [typed, setTyped] = useState('')
  useEffect(() => {
    requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all').then((r) => {
      if (!r.ok) { setError(r.error === 'not-allowed' ? 'This needs SCOUT 1.46.0 or newer.' : `TRYBE did not answer${r.status ? ` (${r.status})` : ''}. Are you signed in to TRYBE in this Chrome?`); return }
      setBrands(readBrandStats(r.json))
    }).catch((e) => setError(e instanceof Error ? e.message : 'SCOUT did not answer.'))
  }, [])
  // Only the brand still picked gets its page (a slow page never lands under another brand).
  const picking = useRef<string | null>(null)
  const pickBrand = async (b: MyBrand) => {
    picking.current = b.id; setBrand(b); setPage(null); setTyped(''); setLoading(true)
    try { const p = await loadBrandPage(b.id); if (picking.current === b.id) setPage(p) } finally { if (picking.current === b.id) setLoading(false) }
  }
  const shown = useMemo(() => (brands || []).filter((b) => !q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase())).sort(byBrandName), [brands, q])
  const go = (name: string) => { if (brand && name.trim()) onPick({ id: brand.id, name: brand.name }, name.trim(), page) }

  if (!brand) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <p className="text-[16px] font-bold flex-1">Which brand is the challenge for?</p>
          {(brands?.length ?? 0) > 8 && (
            <label className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={soft} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a brand" className="rounded-xl border bg-transparent pl-8 pr-3 py-1.5 text-[13.5px]" style={inputStyle} />
            </label>
          )}
        </div>
        {error ? <p className="text-[13.5px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>
          : !brands ? <p className="text-[13.5px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={14} className="animate-spin" /> Reading the brands you work with on TRYBE</p>
          : brands.length === 0 ? <p className="text-[13.5px]" style={soft}>No brand has accepted you on TRYBE yet.</p>
          : (
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
              {shown.map((b) => (
                <button key={b.id} onClick={() => void pickBrand(b)} className="rounded-xl border p-2.5 flex items-center gap-2 text-left hover:shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  {b.logo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={b.logo} alt="" className="w-9 h-9 rounded-lg object-contain border shrink-0 bg-white" style={{ borderColor: 'var(--border)' }} />
                    : <span className="w-9 h-9 rounded-lg inline-flex items-center justify-center text-[15px] font-bold shrink-0" style={{ background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT }}>{b.name.slice(0, 1).toUpperCase()}</span>}
                  <span className="text-[13.5px] font-semibold leading-tight">{b.name}</span>
                </button>
              ))}
            </div>
          )}
        <button className="mt-4 text-[12.5px] font-semibold" style={{ color: ACCENT }} onClick={onByHand}>The brand is not on TRYBE: set it up by hand</button>
      </div>
    )
  }

  return (
    <div>
      <button onClick={() => { picking.current = null; setBrand(null); setPage(null) }} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: ACCENT }}><ArrowLeft size={13} /> Another brand</button>
      <p className="text-[16px] font-bold">Which {brand.name} product is the challenge for?</p>
      {loading ? (
        <p className="mt-3 text-[13.5px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={14} className="animate-spin" /> Reading {brand.name}&rsquo;s page on TRYBE: its products and its creative brief</p>
      ) : (<>
        {page && page.products.length > 0 ? (
          <div className="mt-3 grid gap-2 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
            {page.products.map((p) => (
              <button key={p.id || p.name} onClick={() => go(p.name)} className="rounded-xl border p-2.5 flex items-center gap-3 text-left hover:shadow-sm"
                style={{ borderColor: p.sample ? 'rgba(22,163,74,0.45)' : 'var(--border)', background: 'var(--surface)' }}>
                {p.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.image} alt="" className="w-14 h-14 rounded-lg object-contain border shrink-0 bg-white" style={{ borderColor: 'var(--border)' }} />
                  : <span className="w-14 h-14 rounded-lg shrink-0" style={{ background: 'rgb(var(--brand-rgb) / 0.08)' }} />}
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold leading-snug">{p.name}</span>
                  {p.sample && <span className="inline-block mt-1 text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgba(22,163,74,0.10)', color: GREEN }}>Your sample: {p.sample.status.replace(/_/g, ' ')}</span>}
                  {!p.sample && p.promoted && <span className="inline-block mt-1 text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT }}>TRYBE asks for this</span>}
                </span>
              </button>
            ))}
          </div>
        ) : <p className="mt-3 text-[13.5px]" style={soft}>{page ? `TRYBE lists no products for ${brand.name}.` : `MVP could not read ${brand.name}'s page on TRYBE.`} Type the product below.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="rounded-xl border bg-transparent px-3 py-2 text-[13.5px] flex-1 min-w-[200px]" style={inputStyle} placeholder="Or type the product, as the brand spells it" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(typed) }} />
          <button className={btn} style={btnMain} disabled={!typed.trim()} onClick={() => go(typed)}>Use this product</button>
        </div>
        {page && <p className="mt-3 text-[12.5px]" style={soft}>{page.state === 'text' ? `${brand.name} has a creative brief on TRYBE; MVP reads it next.` : page.state === 'link_only' ? `${brand.name}'s brief on TRYBE is a link MVP could not open${page.briefWhy ? ` (${page.briefWhy})` : ''}; you can add it as a PDF next.` : page.state === 'none' ? `${brand.name} has no creative brief on TRYBE; MVP reads what it sent you instead.` : ''}</p>}
      </>)}
    </div>
  )
}

/** What the rules reader read and did not, in words (CLAUDE.md: report what
 *  happened, so "nothing found" never looks like "not looked"). */
export function sourcesRead(read: Exclude<Read, { error: string }>, brand: string): { got: string[]; missed: string[] } {
  const got: string[] = []
  const missed: string[] = []
  if (read.trybe && 'words' in read.trybe) got.push(`${brand}'s brief on TRYBE (${read.trybe.words} words)`)
  else if (read.trybe && read.trybe.state === 'link_only') missed.push(`The brief on TRYBE is a link MVP could not open${read.trybe.why ? ` (${read.trybe.why})` : ''}. Add it as a PDF.`)
  else if (read.trybe && read.trybe.state === 'none') missed.push(`${brand} has no brief on its TRYBE page.`)
  else if (read.trybe && read.trybe.state === 'unread') missed.push(`MVP could not read ${brand}'s page on TRYBE.`)
  if (read.sent.length) got.push(`${read.sent.length === 1 ? 'a document' : `${read.sent.length} documents`} ${brand} sent you (${read.sent.join(', ')})`)
  else missed.push(`No documents from your messages with ${brand}. If they sent a deck or doc, open their chat in Messages and press Read them for me, or add the PDF.`)
  if (read.brand) got.push(`how ${brand} describes itself`)
  if (read.pasted) got.push(`what you pasted (${read.pasted} words)`)
  return { got, missed }
}

/** What the rules reader read, each source named as read or not. */
export function ReadReport({ read, brand }: { read: Read; brand: string }) {
  if ('error' in read) return <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {read.error}</p>
  const { got, missed } = sourcesRead(read, brand)
  const from = { brief: 'from the brief on TRYBE', sent: `from what ${brand} sent you`, pasted: 'from what you pasted', brand: '', none: '' }
  return (
    <div className="rounded-xl border p-3 space-y-1.5 text-[13px]" style={{ borderColor: 'var(--border)', background: 'rgb(var(--brand-rgb) / 0.04)' }}>
      <p><span className="font-semibold">MVP read:</span> {got.length ? got.join('; ') : 'nothing it could use'}.</p>
      {missed.map((m) => <p key={m} style={soft}>{m}</p>)}
      {read.claims > 0 && read.claimsFrom !== 'brand' && <p className="inline-flex items-start gap-1.5" style={{ color: GREEN }}><Check size={14} className="mt-0.5 shrink-0" /> {read.claims} approved {read.claims === 1 ? 'claim' : 'claims'}{read.claimsFrom && from[read.claimsFrom] ? ` ${from[read.claimsFrom]}` : ''}. Check them below.</p>}
      {read.claims > 0 && read.claimsFrom === 'brand' && <p className="inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> The brief names no product features, so these {read.claims} come from {brand}&rsquo;s own description. Check each one before writing.</p>}
      {read.claims === 0 && <p className="inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> No product claims in any of it. Add the brief PDF below, or type the features {brand} allows.</p>}
    </div>
  )
}

// ── The setup, step by step ──────────────────────────────────────────────────

export function Setup({ c, setC, step, setStep, save, busy, read, readRules, onWrite, writeLabel = 'Save and go to the scripts' }: {
  c: Campaign; setC: (c: Campaign) => void; step: number; setStep: (n: number) => void; save: (c?: Campaign) => Promise<Campaign | null>; busy: string | null
  read: Read | null; readRules: (pasted: string) => Promise<void>; onWrite: () => void; writeLabel?: string
}) {
  const set = (patch: Partial<Campaign>) => setC({ ...c, ...patch })
  const setProduct = (patch: Partial<Campaign['product']>) => set({ product: { ...c.product, ...patch } })
  const setRules = (patch: Partial<Campaign['rules']>) => set({ rules: { ...c.rules, ...patch } })
  const setReality = (patch: Partial<Campaign['reality']>) => set({ reality: { ...c.reality, ...patch } })
  const [brief, setBrief] = useState('')
  const [reading, setReading] = useState<string | null>(null)
  const [readErr, setReadErr] = useState<string | null>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const go = async (n: number) => { const s = await save(c); if (s) setStep(n) }
  // More from the brief is open when MVP had nothing, or found no claims.
  const needMore = !read || 'error' in read || read.claims === 0

  const readAgain = async () => {
    setReadErr(null); setReading('Reading the brief')
    await readRules(brief)
    setReading(null)
  }
  const addPdf = async (f: File) => {
    setReadErr(null); setReading('Saving the campaign')
    const s = await save(c)
    if (!s) { setReading(null); return }
    const r = await addBrandPdf(s.brandId || `batch-${s.id}`, s.name, f, (st) => setReading(st === 'uploading' ? 'Uploading the PDF' : 'Reading every page of the PDF'))
    if (r.error) { setReading(null); setReadErr(r.error); return }
    setReading('Turning it into rules')
    await readRules(brief)
    setReading(null)
  }
  const nextClaimId = () => { let i = c.rules.approvedClaims.length + 1; while (c.rules.approvedClaims.some((x) => x.id === `c${i}`)) i++; return `c${i}` }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => void go(i)} className="rounded-full px-3 py-1 text-[12.5px] font-semibold"
            style={i === step ? { background: ACCENT, color: 'white' } : { border: '1px solid var(--border)', color: 'var(--text-soft)' }}>{i + 1}. {s}</button>
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-4 max-w-3xl">
          {read && <ReadReport read={read} brand={c.brandName || 'the brand'} />}
          <details open={needMore} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <summary className="text-[13.5px] font-semibold cursor-pointer">{read ? 'Add more from the brief' : 'The brand’s brief'}</summary>
            <div className="mt-2 space-y-2">
              <p className="text-[12.5px]" style={soft}>Paste a brief the brand sent outside TRYBE, or add its PDF. MVP reads it with everything else and fills in the rules.</p>
              <textarea rows={5} className={input} style={inputStyle} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Paste the brief here" />
              <div className="flex flex-wrap gap-2">
                <button className={btn} style={btnMain} disabled={!!reading} onClick={() => void readAgain()}>{reading ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} {reading || (read ? 'Read everything again' : 'Read the rules from the brief')}</button>
                <button className={btn} style={btnSoft} disabled={!!reading} onClick={() => pdfRef.current?.click()}><FileText size={15} /> Add the brief PDF</button>
                <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addPdf(f) }} />
              </div>
              {readErr && <p className="text-[13px]" style={{ color: RED }}>{readErr}</p>}
            </div>
          </details>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label hint="Exactly as the brand spells it.">Product</Label><input className={input} style={inputStyle} placeholder="e.g. NOBL Air Tracker" value={c.product.name} onChange={(e) => setProduct({ name: e.target.value })} /></div>
            <div><Label hint="Words that must keep these capitals. Empty: the name's all-capitals words.">Spelling to enforce</Label><Lines value={c.product.mustSpell} onChange={(v) => setProduct({ mustSpell: v })} rows={1} placeholder="e.g. NOBL" /></div>
          </div>
          <div>
            <Label hint="The only features and claims a script may state. Every product line is tagged with the ones it uses.">Approved claims</Label>
            <div className="space-y-1.5">
              {c.rules.approvedClaims.map((x, i) => (
                <div key={x.id} className="flex items-center gap-2">
                  <span className="text-[12px] font-mono w-10 shrink-0" style={soft}>{x.id}</span>
                  <input className={input} style={inputStyle} value={x.text} onChange={(e) => setRules({ approvedClaims: c.rules.approvedClaims.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) })} />
                  <button aria-label="Remove claim" onClick={() => setRules({ approvedClaims: c.rules.approvedClaims.filter((_, j) => j !== i) })} style={soft}><X size={15} /></button>
                </div>
              ))}
              <button className={btn} style={btnSoft} onClick={() => setRules({ approvedClaims: [...c.rules.approvedClaims, { id: nextClaimId(), text: '' }] })}><Plus size={14} /> Add a claim</button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label hint="Never said or shown, any case.">Banned words</Label><Lines value={c.rules.bannedTerms} onChange={(v) => setRules({ bannedTerms: v })} rows={3} placeholder="e.g. free" /></div>
            <div><Label hint="Competitors or names never to use.">Never say</Label><Lines value={c.product.neverSay} onChange={(v) => setProduct({ neverSay: v })} rows={3} placeholder="e.g. a competitor's name" /></div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div><Label hint="Seconds before the product, brand or category is seen or said. 0: anywhere.">Product delay</Label><input type="number" min={0} max={30} className={input} style={inputStyle} value={c.rules.productDelaySec} onChange={(e) => setRules({ productDelaySec: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} /></div>
            <div><Label>Shortest (seconds)</Label><input type="number" min={5} className={input} style={inputStyle} value={c.rules.targetLengthSec[0]} onChange={(e) => setRules({ targetLengthSec: [Number(e.target.value) || 25, c.rules.targetLengthSec[1]] })} /></div>
            <div><Label>Longest (seconds)</Label><input type="number" min={5} className={input} style={inputStyle} value={c.rules.targetLengthSec[1]} onChange={(e) => setRules({ targetLengthSec: [c.rules.targetLengthSec[0], Number(e.target.value) || 45] })} /></div>
          </div>
          <details className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <summary className="text-[13.5px] font-semibold cursor-pointer">More rules</summary>
            <div className="mt-3 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Toggle on={c.rules.noPrices} onChange={(v) => setRules({ noPrices: v })}>No prices or money amounts</Toggle>
                  <Toggle on={c.rules.noPercentOff} onChange={(v) => setRules({ noPercentOff: v })}>No percentages</Toggle>
                </div>
                <div><Label>Sale language</Label><input className={input} style={inputStyle} value={c.rules.saleLanguageRule} placeholder="e.g. sale words only in the last 10 seconds" onChange={(e) => setRules({ saleLanguageRule: e.target.value })} /></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><Label hint="Kept out of the story before the product enters.">Category words</Label><Lines value={c.product.categoryWords} onChange={(v) => setProduct({ categoryWords: v })} rows={2} placeholder="e.g. tracker" /></div>
                <div><Label hint="Objects that give the product away, kept out of the story's shots.">Product-related objects</Label><Lines value={c.product.showDeny} onChange={(v) => setProduct({ showDeny: v })} rows={2} placeholder="e.g. suitcase" /></div>
              </div>
              <div><Label>Framing and safe zones</Label><input className={input} style={inputStyle} value={c.rules.safeZoneNotes} placeholder="e.g. 9:16, keep text out of the bottom 20%" onChange={(e) => setRules({ safeZoneNotes: e.target.value })} /></div>
            </div>
          </details>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4 max-w-3xl">
          <div>
            <Label hint="Beyond the place: who or what is in your life or your videos, and how you film it. MVP builds every story from it and ties it back to the product.">Context (optional)</Label>
            <textarea rows={3} className={input} style={inputStyle} value={c.context} onChange={(e) => set({ context: e.target.value.slice(0, 2000) })}
              placeholder="e.g. Michelle films in the parked car before or after walking Walter, our French bulldog, with B-roll of the walks. Use Walter in every story." />
          </div>
          <p className="text-[13px]" style={soft}>The places and people below are yours, not the brand&rsquo;s, so MVP keeps them for your next campaign.</p>
          <Label hint="Where you can really film, and what is not there. Every line has to make sense in the place it is shot.">Places</Label>
          {c.reality.locations.map((l, i) => (
            <div key={i} className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
              <div className="flex gap-2">
                <input className={input} style={inputStyle} placeholder="e.g. Airport (before security)" value={l.name} onChange={(e) => setReality({ locations: c.reality.locations.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
                <button aria-label="Remove place" onClick={() => setReality({ locations: c.reality.locations.filter((_, j) => j !== i) })} style={soft}><Trash2 size={15} /></button>
              </div>
              <input className={input} style={inputStyle} placeholder="Access notes, e.g. before security only" value={l.accessNotes} onChange={(e) => setReality({ locations: c.reality.locations.map((y, j) => (j === i ? { ...y, accessNotes: e.target.value } : y)) })} />
              <Lines value={l.deny} rows={2} placeholder={'Not there, one a line, e.g. gate'} onChange={(v) => setReality({ locations: c.reality.locations.map((y, j) => (j === i ? { ...y, deny: v } : y)) })} />
              {!l.deny.length && suggestDeny(l).length > 0 && <button className="text-[12.5px] font-semibold" style={{ color: ACCENT }} onClick={() => setReality({ locations: c.reality.locations.map((y, j) => (j === i ? { ...y, deny: suggestDeny(l) } : y)) })}>Add the usual: {suggestDeny(l).join(', ')}</button>}
            </div>
          ))}
          <button className={btn} style={btnSoft} onClick={() => setReality({ locations: [...c.reality.locations, { name: '', accessNotes: '', deny: [] }] })}><Plus size={14} /> Add a place</button>
          <div className="space-y-2 pt-1">
            <Toggle on={c.reality.isTraveling} onChange={(v) => setReality({ isTraveling: v })}>You are travelling in these videos. Off: no script says you are flying, checking in or landing today.</Toggle>
            <Toggle on={c.reality.onePersonPerVideo} onChange={(v) => setReality({ onePersonPerVideo: v })}>One person on camera per video</Toggle>
            <Toggle on={c.reality.appFootageReuse} onChange={(v) => setReality({ appFootageReuse: v })}>App demo shots may reuse a screen recording from a past trip</Toggle>
          </div>
          <Label hint="Each script has one host. Their phone shows in app demos.">Who is on camera</Label>
          {c.reality.cast.map((p, i) => (
            <div key={i} className="flex gap-2">
              <input className={input} style={inputStyle} placeholder="Name" value={p.name} onChange={(e) => setReality({ cast: c.reality.cast.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
              <input className={input} style={inputStyle} placeholder="Phone (iPhone or Android)" value={p.phone} onChange={(e) => setReality({ cast: c.reality.cast.map((y, j) => (j === i ? { ...y, phone: e.target.value } : y)) })} />
              <button aria-label="Remove person" onClick={() => setReality({ cast: c.reality.cast.filter((_, j) => j !== i) })} style={soft}><Trash2 size={15} /></button>
            </div>
          ))}
          <button className={btn} style={btnSoft} onClick={() => setReality({ cast: [...c.reality.cast, { name: '', phone: '' }] })}><Plus size={14} /> Add a person</button>
          <div><Label hint="True, short facts the stories can use, one a line.">About you</Label><Lines value={c.creatorFacts} onChange={(v) => set({ creatorFacts: v })} rows={3} placeholder={'e.g. Lives on an island\nWorks in shipping'} /></div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 max-w-2xl">
          <p className="text-[13px]" style={soft}>Optional. MVP has good defaults here.</p>
          <div><Label hint="Scripts rotate through these evenly.">Story angles</Label><Lines value={c.angles} onChange={(v) => set({ angles: v.length ? v : DEFAULT_ANGLES })} rows={4} /></div>
          <div><Label hint="Used sparingly: at most one script in four opens with one.">Signature hooks</Label><Lines value={c.hooks} onChange={(v) => set({ hooks: v })} rows={5} /><button className="text-[12.5px] font-semibold mt-1" style={{ color: ACCENT }} onClick={() => set({ hooks: DEFAULT_HOOKS })}>Use the ten proven openers</button></div>
          <div><Label hint="Style only; never copied.">The brand&rsquo;s own starter scripts</Label><textarea rows={4} className={input} style={inputStyle} value={c.references} onChange={(e) => set({ references: e.target.value })} /></div>
          <div><Label>Brand feedback</Label><input className={input} style={inputStyle} placeholder="e.g. less like an ad, more like story time" value={c.feedback} onChange={(e) => set({ feedback: e.target.value })} /></div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 max-w-2xl">
          <div><Label>Campaign name</Label><input className={input} style={inputStyle} value={c.name} onChange={(e) => set({ name: e.target.value })} /></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label hint={`Up to ${MAX_PER_CAMPAIGN}.`}>Scripts to write</Label><input type="number" min={1} max={MAX_PER_CAMPAIGN} className={input} style={inputStyle} value={c.target} onChange={(e) => set({ target: Math.max(1, Math.min(MAX_PER_CAMPAIGN, Number(e.target.value) || 50)) })} /></div>
            <div><Label hint="For the pace you need.">Deadline</Label><input type="date" className={input} style={inputStyle} value={c.deadline || ''} onChange={(e) => set({ deadline: e.target.value || null })} /></div>
          </div>
          {notReadyWords(c).length > 0
            ? <p className="text-[13px]" style={{ color: AMBER }}>Before writing, add {notReadyWords(c).join(', ')}.</p>
            : <p className="text-[13px]" style={soft}>MVP writes ten at a time and checks every one against the rules. Keep this page open while it writes; closing it pauses, and nothing written is lost.</p>}
          <button className={btn} style={btnMain} disabled={!!busy || notReadyWords(c).length > 0} onClick={async () => { const s = await save(c); if (s) onWrite() }}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {writeLabel}</button>
        </div>
      )}

      <div className="flex gap-2 mt-5">
        {step > 0 && <button className={btn} style={btnSoft} disabled={!!busy} onClick={() => void go(step - 1)}><ChevronLeft size={15} /> Back</button>}
        {step < STEPS.length - 1 && <button className={btn} style={btnMain} disabled={!!busy} onClick={() => void go(step + 1)}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} {step === 0 ? 'Rules look right' : 'Next'} <ChevronRight size={15} /></button>}
      </div>
    </div>
  )
}

// ── The scripts ──────────────────────────────────────────────────────────────

export function Scripts({ c, scripts, setScripts, setAllowance, onSetup, autoStart = false, setupLabel = 'Setup', canEdit = false }: {
  c: Campaign; scripts: Script[]; setScripts: (f: (s: Script[]) => Script[]) => void; setAllowance: (a: Allowance) => void; onSetup: () => void
  /** Start writing at once: the creator pressed Start writing on the plan. */
  autoStart?: boolean; setupLabel?: string
  /** Film and edit inside the batch (labs-preview trybe_edit). */
  canEdit?: boolean
}) {
  // THE BATCH'S VIDEOS (components/labs/TrybeBatchEdits): each script shows
  // where its latest video stands.
  const [edits, setEdits] = useState<BatchEdit[]>([])
  const editOf = useMemo(() => {
    const m = new Map<number, BatchEdit>()
    for (const e of edits) if (e.trybe?.idx && !m.has(e.trybe.idx)) m.set(e.trybe.idx, e)
    return m
  }, [edits])
  const [running, setRunning] = useState(false)
  const [runNote, setRunNote] = useState<string | null>(null)
  const [runErr, setRunErr] = useState<string | null>(null)
  const stop = useRef(false)
  const [f, setF] = useState({ location: '', host: '', angle: '', status: '', state: '', real: '' })
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [bulk, setBulk] = useState<string | null>(null)
  const [making, setMaking] = useState<string | null>(null)

  const writeAll = async () => {
    stop.current = false; setRunning(true); setRunErr(null)
    let total = scripts.length
    while (!stop.current && total < c.target) {
      setRunNote(`Writing scripts ${total + 1} to ${Math.min(c.target, total + 10)} of ${c.target}, and checking each against your rules`)
      const r = await call('write', { id: c.id }, 295_000)
      if (r.allowance) setAllowance(r.allowance as Allowance)
      if (r.error) { setRunErr(r.error); break }
      const got = (r.scripts as Script[]) || []
      setScripts((s) => [...s, ...got])
      total += got.length
      if (r.done || !got.length) break
    }
    setRunning(false); setRunNote(null)
  }
  // Once only, however often the list redraws.
  const autoRan = useRef(false)
  useEffect(() => {
    if (!autoStart || autoRan.current || scripts.length >= c.target) return
    autoRan.current = true
    void writeAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])
  const replace = (s: Script) => setScripts((all) => all.map((x) => (x.idx === s.idx ? s : x)))
  const rewrite = async (idx: number, note = '') => {
    const r = await call('rewrite', { id: c.id, idx, note }, 200_000)
    if (r.error) return r.error
    replace(r.script as Script); return null
  }
  const update = async (idx: number, patch: Record<string, unknown>) => {
    const r = await call('update', { id: c.id, idx, patch })
    if (r.error) return r.error
    replace(r.script as Script); return null
  }
  const removeOne = async (idx: number) => {
    if (!window.confirm(`Take script #${idx} out? It does not give back the month's allowance.`)) return
    const r = await call('remove', { id: c.id, idx }); if (r.error) { setRunErr(r.error); return }
    setScripts((all) => all.filter((x) => x.idx !== idx))
  }
  const recheck = async () => {
    setBulk('Checking every script again')
    const r = await call('recheck', { id: c.id }, 120_000)
    setBulk(null)
    if (r.error) { setRunErr(r.error); return }
    if (Array.isArray(r.scripts)) setScripts(() => r.scripts as Script[])
  }
  const rewritePicked = async () => {
    const ids = Array.from(picked)
    for (let i = 0; i < ids.length; i++) {
      setBulk(`Rewriting ${i + 1} of ${ids.length}`)
      const e = await rewrite(ids[i])
      if (e) { setBulk(null); setRunErr(`Stopped at #${ids[i]}: ${e}`); return }
    }
    setBulk(null); setPicked(new Set())
  }
  const download = (blob: Blob, name: string) => { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000) }
  const pdf = async () => {
    setMaking('pdf')
    try {
      const [{ renderBatchPdf }, { loadBrandAssets }] = await Promise.all([import('@/lib/trybe-batch-pdf'), import('@/lib/mvp-pdf')])
      download(await renderBatchPdf(c, scripts, await loadBrandAssets()), `${c.name.replace(/[^\w-]+/g, '-')}-scripts.pdf`)
    } catch (e) { setRunErr(`The PDF could not be made: ${e instanceof Error ? e.message : 'unknown'}`) }
    setMaking(null)
  }
  const csv = async () => {
    const { batchCsv } = await import('@/lib/trybe-batch-pdf')
    download(new Blob([batchCsv(scripts)], { type: 'text/csv' }), `${c.name.replace(/[^\w-]+/g, '-')}-scripts.csv`)
  }

  const shown = useMemo(() => scripts.filter((s) => (!f.location || s.location === f.location) && (!f.host || s.host === f.host) && (!f.angle || s.angle === f.angle)
    && (!f.status || s.status === f.status) && (!f.state || s.checks.state === f.state) && (!f.real || (f.real === 'yes') === s.realStory)), [scripts, f])
  const pace = paceWords(c, scripts)
  const reds = scripts.filter((s) => s.checks.state === 'red').length
  const options = (vals: string[]) => Array.from(new Set(vals)).filter(Boolean)
  const sel = (key: keyof typeof f, label: string, vals: string[]) => (
    <select className="rounded-xl border bg-transparent px-2 py-1.5 text-[12.5px]" style={inputStyle} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
      <option value="">{label}</option>{vals.map((v) => <option key={v} value={v}>{FILTER_WORDS[v] && (key === 'state' || key === 'real') ? FILTER_WORDS[v] : key === 'status' ? statusLabel(v) : v}</option>)}
    </select>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[14px] font-semibold w-full sm:w-auto sm:flex-1">{scripts.length} of {c.target} written. {pace.line}{reds ? ` ${reds} still ${reds === 1 ? 'breaks' : 'break'} a rule.` : ''}</p>
        <button className={btn} style={btnSoft} onClick={onSetup}><Pencil size={14} /> {setupLabel}</button>
        <button className={btn} style={btnSoft} disabled={!scripts.length || !!making} onClick={() => void pdf()}>{making === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} PDF</button>
        <button className={btn} style={btnSoft} disabled={!scripts.length} onClick={() => void csv()}><Download size={14} /> CSV</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {running
          ? <button className={btn} style={btnSoft} onClick={() => { stop.current = true }}><Square size={14} /> Stop after this round</button>
          : scripts.length < c.target && <button className={btn} style={btnMain} disabled={!!bulk} onClick={() => void writeAll()}><Play size={14} /> {scripts.length ? 'Keep writing' : `Write ${c.target} scripts`}</button>}
        <button className={btn} style={btnSoft} disabled={running || !!bulk || !scripts.length} onClick={() => void recheck()}><RefreshCw size={14} /> Check all again</button>
        {picked.size > 0 && <button className={btn} style={btnSoft} disabled={running || !!bulk} onClick={() => void rewritePicked()}><Wand2 size={14} /> Rewrite {picked.size} picked</button>}
        {reds > 0 && <button className="text-[12.5px] font-semibold" style={{ color: ACCENT }} onClick={() => setPicked(new Set(scripts.filter((s) => s.checks.state === 'red').map((s) => s.idx)))}>{reds === 1 ? 'Pick the red one' : `Pick the ${reds} red`}</button>}
      </div>
      {(runNote || bulk) && <p className="text-[13px] inline-flex items-center gap-2" style={soft}><Loader2 size={14} className="animate-spin" /> {runNote || bulk}</p>}
      {runErr && <p className="text-[13px]" style={{ color: RED }}>{runErr}</p>}
      {canEdit && scripts.length > 0 && <TrybeBatchEdits c={c} scripts={scripts} onEdits={setEdits} />}

      {scripts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sel('location', 'Every place', options(c.reality.locations.map((l) => l.name)))}
          {sel('host', 'Every host', options(c.reality.cast.map((p) => p.name)))}
          {sel('angle', 'Every angle', options(c.angles))}
          {sel('status', 'Every status', SCRIPT_STATUSES)}
          {sel('state', 'Every check', ['green', 'amber', 'red'])}
          {sel('real', 'Real stories or not', ['yes', 'no'])}
          <p className="text-[12.5px] self-center" style={soft}>{shown.length} shown</p>
        </div>
      )}
      <div className="space-y-2">
        {shown.map((s) => <ScriptCard key={s.idx} s={s} c={c} video={editOf.get(s.idx) ?? null} picked={picked.has(s.idx)} onPick={(v) => setPicked((p) => { const n = new Set(p); if (v) n.add(s.idx); else n.delete(s.idx); return n })} rewrite={rewrite} update={update} remove={removeOne} />)}
      </div>
    </div>
  )
}

function ScriptCard({ s, c, video = null, picked, onPick, rewrite, update, remove }: {
  s: Script; c: Campaign; picked: boolean; onPick: (v: boolean) => void
  /** Its latest video, when one was edited in the batch. */
  video?: BatchEdit | null
  rewrite: (idx: number, note?: string) => Promise<string | null>; update: (idx: number, patch: Record<string, unknown>) => Promise<string | null>; remove: (idx: number) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [edit, setEdit] = useState<Script | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [e, setE] = useState<string | null>(null)
  const [link, setLink] = useState(s.link || '')
  useEffect(() => { setLink(s.link || '') }, [s.link])
  const claimText = (id: string) => c.rules.approvedClaims.find((x) => x.id === id)?.text || id
  const doRewrite = async () => { setBusy('Rewriting'); setE(await rewrite(s.idx, note)); setBusy(null); setNote('') }
  const doSave = async () => { if (!edit) return; setBusy('Saving'); const err = await update(s.idx, { title: edit.title, story: edit.story, body: edit.body }); setBusy(null); if (err) setE(err); else setEdit(null) }
  const beat = (b: { say: string; show: string }, story: boolean, i: number, kind: 'story' | 'body') => edit ? (
    <div key={`${kind}${i}`} className="grid sm:grid-cols-2 gap-2 py-1.5 px-2 rounded-lg" style={story ? { background: 'rgba(245,236,220,0.35)' } : undefined}>
      <textarea rows={2} className={input} style={inputStyle} value={b.say} onChange={(ev) => setEdit({ ...edit, [kind]: (edit[kind] as Array<typeof b>).map((x, j) => (j === i ? { ...x, say: ev.target.value } : x)) })} />
      <textarea rows={2} className={input} style={inputStyle} value={b.show} onChange={(ev) => setEdit({ ...edit, [kind]: (edit[kind] as Array<typeof b>).map((x, j) => (j === i ? { ...x, show: ev.target.value } : x)) })} />
    </div>
  ) : (
    <div key={`${kind}${i}`} className="grid sm:grid-cols-2 gap-x-4 py-1.5 px-2 rounded-lg text-[13px]" style={story ? { background: 'rgba(245,236,220,0.35)' } : undefined}>
      <p>{b.say}</p><p style={soft}><span className="sm:hidden font-semibold">Show: </span>{b.show}</p>
    </div>
  )
  const view = edit || s
  return (
    <div className="rounded-xl border" style={{ borderColor: s.checks.state === 'red' ? RED : 'var(--border)' }}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <input type="checkbox" className="mt-1.5" checked={picked} onChange={(ev) => onPick(ev.target.checked)} aria-label={`Pick script ${s.idx}`} />
        <span className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0" style={{ background: stateColour(s.checks.state) }} title={s.checks.state} />
        <button className="flex-1 text-left" onClick={() => setOpen(!open)}>
          <p className="text-[14px] font-semibold">#{s.idx} {s.title}</p>
          <p className="text-[12.5px]" style={soft}>{s.angle} | {s.host} | {s.location} | about {s.estSeconds}s{s.realStory && <span style={{ color: '#E8604C' }}> | <Star size={11} className="inline -mt-0.5" /> Real story: shoot only if true</span>}</p>
          {s.checks.state === 'red' && <p className="text-[12.5px] mt-0.5" style={{ color: RED }}>{s.checks.reasons.join(' ')}</p>}
          {video && (() => {
            const st = editStage(video)
            const bad = video.trybe?.check?.items.find((i) => i.tone === 'bad')
            return <p className="text-[12.5px] mt-0.5 font-semibold" style={{ color: st.tone === 'ok' ? '#16A34A' : st.tone === 'bad' ? RED : st.tone === 'warn' ? AMBER : 'var(--text-3)' }}>Video: {st.word}{bad ? `. ${bad.text}` : ''}</p>
          })()}
        </button>
        <select className="rounded-lg border bg-transparent px-2 py-1 text-[12.5px]" style={inputStyle} value={s.status} onChange={async (ev) => setE(await update(s.idx, { status: ev.target.value as ScriptStatus }))}>
          {SCRIPT_STATUSES.map((x) => <option key={x} value={x}>{statusLabel(x)}</option>)}
        </select>
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {s.checks.warnings.length > 0 && <p className="text-[12.5px]" style={{ color: AMBER }}>{s.checks.warnings.join(' ')}</p>}
          {edit && <input className={input} style={inputStyle} value={edit.title} onChange={(ev) => setEdit({ ...edit, title: ev.target.value })} />}
          <div className="hidden sm:grid sm:grid-cols-2 gap-x-4 px-2 text-[11px] font-bold uppercase tracking-wide" style={soft}><p>Say</p><p>Show</p></div>
          {view.story.map((b, i) => beat(b, true, i, 'story'))}
          {view.story.length > 0 && <p className="text-[11.5px] font-bold border-t pt-1 text-right" style={{ color: '#E8604C', borderColor: '#E8604C' }}>product enters at about {storySeconds(view.story)}s</p>}
          {view.body.map((b, i) => beat(b, false, i, 'body'))}
          {s.body.some((b) => b.claimIds.length) && <p className="text-[12px]" style={soft}>Claims: {Array.from(new Set(s.body.flatMap((b) => b.claimIds))).map(claimText).join('; ')}</p>}
          {s.realityReason && <p className="text-[12px]" style={soft}>Why {s.host} is there: {s.realityReason}</p>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {edit
              ? <><button className={btn} style={btnMain} disabled={!!busy} onClick={() => void doSave()}><Check size={14} /> Save and check</button><button className={btn} style={btnSoft} onClick={() => setEdit(null)}>Cancel</button></>
              : <button className={btn} style={btnSoft} onClick={() => setEdit(JSON.parse(JSON.stringify(s)))}><Pencil size={14} /> Edit</button>}
            <input className="rounded-xl border bg-transparent px-3 py-2 text-[13px] flex-1 min-w-[180px]" style={inputStyle} placeholder="Rewrite with a note (optional)" value={note} onChange={(ev) => setNote(ev.target.value)} />
            <button className={btn} style={btnSoft} disabled={!!busy} onClick={() => void doRewrite()}>{busy === 'Rewriting' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Rewrite</button>
            <button aria-label="Take this script out" onClick={() => void remove(s.idx)} style={soft}><Trash2 size={15} /></button>
          </div>
          <div className="flex gap-2">
            <input className="rounded-xl border bg-transparent px-3 py-2 text-[13px] flex-1" style={inputStyle} placeholder="Submission link, once it is on TRYBE" value={link} onChange={(ev) => setLink(ev.target.value)} onBlur={() => { if (link !== (s.link || '')) void update(s.idx, { link }) }} />
          </div>
          {e && <p className="text-[12.5px]" style={{ color: RED }}>{e}</p>}
        </div>
      )}
    </div>
  )
}

// ── Inside Brand scripts: the plan card, a batch run, the brand's batches ────
// (Seb, 2026-11-15: "I like A with a C plan card"). Brand scripts picks the
// brand and the product; a batch is planned and said before anything is
// written, then written in rounds with every script checked.

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** MVP's plan, said before it writes: what it read, how the scripts spread,
 *  the rules, the pace. Writing waits for Start writing. */
export function PlanCard({ c, read, scripts, onStart, onChange, onFix, onUsePlaces, busy }: {
  c: Campaign; read: Read | null; scripts: Script[]; onStart: () => void; onChange: () => void; onFix: (step: number) => void
  /** Film in the places the context names, in place of the ones carried over. */
  onUsePlaces?: (names: string[]) => void
  busy?: boolean
}) {
  const p = planSummary(c, scripts)
  const brand = c.brandName || 'the brand'
  const src = read && !('error' in read) ? sourcesRead(read, brand) : null
  const needPlaces = !c.reality.locations.length || !c.reality.cast.length
  const row = (label: string, body: React.ReactNode, warn = false) => (
    <p className="text-[13.5px] leading-snug" style={warn ? { color: AMBER } : undefined}><span className="font-semibold" style={{ color: 'var(--text)' }}>{label}:</span> {body}</p>
  )
  return (
    <div className="flex gap-3 items-start">
      <span className="w-9 h-9 rounded-full inline-flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: ACCENT, color: 'white' }}>MVP</span>
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-[14.5px]">{scripts.length ? `Here is my plan for the next ${p.left}.` : 'Here is my plan before I write anything.'}</p>
        <div className="rounded-2xl p-4 space-y-3" style={{ border: `2px solid ${ACCENT}` }}>
          <p className="text-[18px] font-bold">{p.left} story-time {p.left === 1 ? 'script' : 'scripts'} for {c.product.name}</p>
          {read && 'error' in read && <ReadReport read={read} brand={brand} />}
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
            {row('Following', src && src.got.length ? src.got.join('; ') : 'nothing MVP could read yet', !src || !src.got.length)}
            {row('Places', p.places.length ? p.places.map((x) => `${x.name} ${x.n}`).join(', ') : 'none yet', !p.places.length)}
            {row('On camera', p.cast.length ? `${p.cast.map((x) => `${x.name} ${x.n}`).join(', ')}${c.reality.onePersonPerVideo ? ', one per video' : ''}` : 'nobody yet', !p.cast.length)}
            {row('Angles', p.angles.join(', '))}
            {row('Shoot day', c.reality.isTraveling ? 'you are travelling in these' : 'not travelling: nobody flies, checks in or lands in these')}
            {row('Rules', [`${p.claims} approved ${p.claims === 1 ? 'claim' : 'claims'}`, p.delaySec ? `product after ${p.delaySec} seconds` : '', p.noPrices ? 'no prices' : '', p.never.length ? `never: ${p.never.join(', ')}` : ''].filter(Boolean).join(', '), !p.claims)}
            {row('Length', `${p.lengthSec[0]} to ${p.lengthSec[1]} seconds`)}
            {row('Pace', !c.deadline ? 'no due date' : p.perDay ? `due ${shortDate(c.deadline)}, about ${p.perDay} a day` : `the due date (${shortDate(c.deadline)}) has passed`, !!c.deadline && !p.perDay)}
          </div>
          {c.context && (
            <div className="rounded-xl p-3 space-y-1.5" style={{ background: 'rgb(var(--brand-rgb) / 0.05)' }}>
              {row('Context', c.context.length > 220 ? `${c.context.slice(0, 220)}...` : c.context)}
              {c.contextPlan && c.contextPlan.from === c.context ? (<>
                <p className="text-[13px] font-semibold">{c.contextPlan.seeds.length} story ideas from it, one per script in turn{p.left > c.contextPlan.seeds.length ? ` (each used about ${Math.ceil(p.left / c.contextPlan.seeds.length)} times, told differently)` : ''}:</p>
                <ul className="text-[13px] list-disc pl-5 space-y-0.5">{c.contextPlan.seeds.slice(0, 6).map((x) => <li key={x}>{x}</li>)}</ul>
                {c.contextPlan.seeds.length > 6 && <p className="text-[12.5px]" style={soft}>and {c.contextPlan.seeds.length - 6} more.</p>}
                {(() => {
                  // The context says where you film, and the places carried over from your last campaign differ.
                  const named = c.contextPlan.places
                  const have = c.reality.locations.map((l) => l.name.toLowerCase())
                  if (!named.length || named.every((n) => have.includes(n.toLowerCase())) || !onUsePlaces) return null
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px]" style={{ color: AMBER }}>Your context says you film in: {named.join(', ')}. The places above are from your last campaign.</p>
                      <button className={btn} style={btnSoft} disabled={!!busy} onClick={() => onUsePlaces(named)}>Film in {named.length === 1 ? 'this' : 'these'} instead</button>
                    </div>
                  )
                })()}
                {c.contextPlan.keepApart.length > 0 && <p className="text-[13px]"><span className="font-semibold">Kept apart:</span> {c.contextPlan.keepApart.join('; ')}</p>}
                {c.contextPlan.careful.length > 0 && <p className="text-[13px]"><span className="font-semibold">Said with care:</span> {c.contextPlan.careful.join('; ')}</p>}
              </>) : (
                <p className="text-[12.5px]" style={{ color: AMBER }}>{c.rules.approvedClaims.length ? 'MVP could not turn your context into story ideas this time. The writer still gets it as you wrote it; press Change something and save to try again.' : 'MVP turns your context into story ideas once the brief gives the approved claims.'}</p>
              )}
            </div>
          )}
          {src && src.missed.length > 0 && <div className="space-y-1">{src.missed.map((m) => <p key={m} className="text-[12.5px]" style={soft}>{m}</p>)}</div>}
          {read && !('error' in read) && read.claimsFrom === 'brand' && read.claims > 0 && <p className="text-[12.5px]" style={{ color: AMBER }}>The brief names no product features, so the claims come from {brand}&rsquo;s own description. Check them under Change something.</p>}
          {p.missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-semibold" style={{ color: AMBER }}>Before I write, add {p.missing.join(', ')}.</p>
              {needPlaces && <button className={btn} style={btnSoft} onClick={() => onFix(1)}>Add where you film</button>}
              {!c.product.name || !c.rules.approvedClaims.length ? <button className={btn} style={btnSoft} onClick={() => onFix(0)}>Add the brief</button> : null}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button className={btn} style={btnMain} disabled={!!busy || p.missing.length > 0 || p.left === 0} onClick={onStart}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Start writing</button>
            <button className={btn} style={btnSoft} disabled={!!busy} onClick={onChange}><Pencil size={14} /> Change something</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** One batch for one brand's product: set up and read, the plan, then the
 *  rounds. `openId` opens a batch already started instead. */
export function BatchRun({ brand, product, page, count, deadline, context = '', openId, onBack, canEdit = false }: {
  brand: { id: string; name: string }; product: string; page: BrandPage | null; count: number; deadline: string | null
  /** Film and edit inside the batch (labs-preview trybe_edit). */
  canEdit?: boolean
  /** What the stories are about beyond the place, typed on the brand page. */
  context?: string
  openId?: string | null; onBack: () => void
}) {
  const [view, setView] = useState<'reading' | 'plan' | 'setup' | 'scripts'>('reading')
  const [c, setC] = useState<Campaign | null>(null)
  const [scripts, setScripts] = useState<Script[]>([])
  const [read, setRead] = useState<Read | null>(null)
  const [allowance, setAllowance] = useState<Allowance | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [auto, setAuto] = useState(false)
  const trybe = trybeOf(page, brand.name)
  const save = async (next: Campaign): Promise<Campaign | null> => {
    setBusy('save')
    const r = await call('save', { id: next.id || undefined, campaign: next }, 120_000)
    setBusy(null)
    if (r.error) { setErr(r.error); return null }
    setC(r.campaign as Campaign); setErr(null)
    return r.campaign as Campaign
  }
  const readRules = async (saved: Campaign, pasted = '') => {
    const r = await call('rules', { id: saved.id, briefText: pasted, trybe }, 120_000)
    if (r.error) { setRead({ error: r.error }); return }
    setC(r.campaign as Campaign); setRead(r.read as Read)
  }
  // Once, even when React mounts it twice.
  const begun = useRef(false)
  useEffect(() => {
    if (begun.current) return
    begun.current = true
    void (async () => {
      if (openId) {
        const r = await call('get', { id: openId })
        if (r.error) { setErr(r.error); return }
        const got = (r.scripts as Script[]) || []
        setC(r.campaign as Campaign); setScripts(got); setAllowance((r.allowance as Allowance) || null)
        setView(got.length ? 'scripts' : 'plan')
        return
      }
      const l = await call('list')
      if (l.error) { setErr(l.error); return }
      setAllowance((l.allowance as Allowance) || null)
      const seeded = { ...seedCampaign({ brandId: brand.id, brandName: brand.name, product }, l.last as Parameters<typeof seedCampaign>[1]), target: count, deadline, name: `${product}: ${count} scripts`, context: context.trim().slice(0, 2000) }
      const saved = await save(seeded)
      if (!saved) return
      await readRules(saved)
      setView('plan')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} style={btnSoft} onClick={onBack}><ChevronLeft size={15} /> Back to {brand.name}</button>
        <p className="text-[18px] font-bold flex-1">{c?.name || `${product}: ${count} scripts`}</p>
        {allowance && <p className="text-[12.5px]" style={soft}>{allowance.limit === null ? `${allowance.used} batch scripts written this month` : `${allowance.used} of ${allowance.limit} this month${allowance.resetLabel ? `, more on ${allowance.resetLabel}` : ''}`}</p>}
      </div>
      {err && <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: RED }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}</p>}
      {view === 'reading' && !err && <p className="text-[14px] inline-flex items-center gap-2 py-4" style={soft}><Loader2 size={16} className="animate-spin" /> Reading {brand.name}&rsquo;s brief on TRYBE, what {brand.name} sent you, and how {brand.name} describes {product}{context.trim() ? ', then turning your context into story ideas' : ''}...</p>}
      {view === 'plan' && c && <PlanCard c={c} read={read} scripts={scripts} busy={!!busy}
        onStart={async () => { const s = await save(c); if (s) { setAuto(true); setView('scripts') } }}
        onChange={() => { setStep(0); setView('setup') }} onFix={(n) => { setStep(n); setView('setup') }}
        onUsePlaces={(names) => void save({ ...c, reality: { ...c.reality, locations: names.map((name) => ({ name, accessNotes: '', deny: [] })) } })} />}
      {view === 'setup' && c && <Setup c={c} setC={setC} step={step} setStep={setStep} save={(k) => save(k || c)} busy={busy} read={read}
        readRules={async (pasted) => { const s = await save(c); if (s) await readRules(s, pasted) }}
        onWrite={() => setView('plan')} writeLabel="Save and see the plan" />}
      {view === 'scripts' && c && <Scripts c={c} scripts={scripts} setScripts={setScripts} setAllowance={setAllowance} autoStart={auto} setupLabel="The plan" canEdit={canEdit} onSetup={() => { setAuto(false); setView('plan') }} />}
    </div>
  )
}

/** This brand's batches, to open again. */
export function BrandBatches({ brandId, brandName, onOpen, refreshKey = 0 }: { brandId: string; brandName: string; onOpen: (id: string) => void; refreshKey?: number }) {
  const [rows, setRows] = useState<Listed[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setRows(null)
    void call('list').then((r) => {
      if (!live) return
      if (r.error) { setErr(r.error); setRows([]); return }
      setErr(null); setRows(((r.campaigns as Listed[]) || []).filter((x) => x.brandId === brandId))
    })
    return () => { live = false }
  }, [brandId, refreshKey])
  if (rows === null) return <p className="text-[13px] inline-flex items-center gap-2" style={soft}><Loader2 size={13} className="animate-spin" /> Reading your {brandName} batches</p>
  if (err) return <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> MVP could not read your batches: {err}</p>
  if (!rows.length) return <p className="text-[13px]" style={soft}>No batches for {brandName} yet.</p>
  return (
    <div className="space-y-2">
      {rows.map((x) => (
        <div key={x.id} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
          <div className="flex-1 min-w-[200px]">
            <p className="text-[14px] font-semibold">{x.name}</p>
            <p className="text-[12.5px]" style={soft}>{x.scripts} of {x.target} written, {x.accepted} accepted</p>
          </div>
          <button className={btn} style={btnSoft} onClick={() => onOpen(x.id)}>Open</button>
        </div>
      ))}
    </div>
  )
}
