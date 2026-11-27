'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MUSIC BEDS (Seb, 2026-11-26: "tick a few boxes in terms of mood and tempo
// and style, and then be able to preview it and accept"). The same panel the
// Video Builder will use: tick, make a preview, listen, accept or make another.
// A track with voices is never offered, and a voice check that could not run
// says so and blocks Accept until it is checked (lib/music-bed).

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Music2, Check, RefreshCw, X, AlertTriangle, ShieldCheck } from 'lucide-react'
import { BED_MODELS, DEFAULT_MODEL, MOODS, TEMPOS, STYLES, MAX_MOODS, MAX_STYLES, MIN_SECONDS, canAccept, voiceWords, type BedModel, type VoiceCheck } from '@/lib/music-bed'

interface Bed {
  id: string; model: BedModel; moods: string[]; tempo: string | null; styles: string[]; seconds: number; prompt: string
  url: string | null; voice_check: VoiceCheck; heard: string[]; status: 'preview' | 'accepted' | 'rejected'; error: string | null; created_at: string
  /** In the MVP music library (migration 478); undefined before it. */
  shared?: boolean
}

const GREEN = '#16A34A'
const RED = '#DC2626'
const AMBER = '#B45309'
const LENGTHS = [15, 30, 45, 60, 90]

async function call(body: Record<string, unknown> | null, ms: number) {
  const r = await fetch('/api/music-bed', body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }
    : { signal: AbortSignal.timeout(ms) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `MVP answered ${r.status}`)
  return j
}

const labelOf = (list: Array<{ id: string; label: string }>, id: string | null) => list.find((x) => x.id === id)?.label ?? id ?? ''

function Chip({ on, children, onClick, disabled }: { on: boolean; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      className="rounded-full px-3.5 py-1.5 text-[13.5px] font-semibold transition-colors disabled:opacity-40"
      style={on ? { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' } : { border: '1px solid var(--border)', color: 'var(--text)', background: 'var(--surface)' }}>
      {children}
    </button>
  )
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[12px] font-bold uppercase mb-2" style={{ color: 'var(--text-soft)', letterSpacing: '0.07em' }}>{title}{hint && <span className="normal-case font-medium ml-1.5" style={{ letterSpacing: 0 }}>{hint}</span>}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function VoiceLine({ bed }: { bed: Bed }) {
  const color = bed.voice_check === 'clean' ? GREEN : bed.voice_check === 'voices' ? RED : AMBER
  const Icon = bed.voice_check === 'clean' ? ShieldCheck : AlertTriangle
  return <p className="text-[12.5px] inline-flex items-start gap-1.5" style={{ color }}><Icon size={13} className="mt-0.5 shrink-0" />{voiceWords(bed.voice_check, bed.heard, bed.error)}</p>
}

function BedCard({ bed, busy, onAct, showPrompt, onShare }: { bed: Bed; busy: boolean; onAct: (action: 'accept' | 'reject' | 'check', id: string) => void; showPrompt: boolean; onShare?: (id: string, shared: boolean) => void }) {
  const words = [...bed.moods.map((m) => labelOf(MOODS, m)), labelOf(TEMPOS, bed.tempo), ...bed.styles.map((s) => labelOf(STYLES, s))].filter(Boolean).join(' · ')
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2.5" style={{ border: `1px solid ${bed.status === 'accepted' ? GREEN : 'var(--border)'}`, background: 'var(--surface)' }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[14px] font-semibold flex-1 min-w-[12rem]" style={{ color: 'var(--text)' }}>{words}</p>
        <span className="text-[12px]" style={{ color: 'var(--text-soft)' }}>{bed.seconds} s · {BED_MODELS[bed.model]?.name ?? bed.model}{bed.status === 'accepted' ? ' · Accepted' : bed.status === 'rejected' ? ' · Not used' : ''}</span>
      </div>
      {bed.url && bed.status !== 'rejected' && <audio controls preload="none" src={bed.url} className="w-full" />}
      <VoiceLine bed={bed} />
      {bed.status === 'preview' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !canAccept(bed.voice_check, bed.status)} onClick={() => onAct('accept', bed.id)} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold disabled:opacity-40" style={{ background: GREEN, color: '#fff' }}><Check size={14} /> Accept</button>
          {bed.voice_check === 'unchecked' && <button type="button" disabled={busy} onClick={() => onAct('check', bed.id)} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold disabled:opacity-40" style={{ border: `1px solid ${AMBER}`, color: AMBER }}><ShieldCheck size={14} /> Check it again</button>}
          <button type="button" disabled={busy} onClick={() => onAct('reject', bed.id)} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}><X size={14} /> Not this one</button>
        </div>
      )}
      {/* THE MVP MUSIC LIBRARY (migration 478): an accepted track is offered to other members, never with who made it. */}
      {bed.status === 'accepted' && typeof bed.shared === 'boolean' && onShare && (
        <label className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
          <input type="checkbox" checked={bed.shared} disabled={busy} onChange={(e) => onShare(bed.id, e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
          {bed.shared ? 'In the MVP music library: other members can use it in their videos. It never says who made it.' : 'Kept to you: not in the MVP music library.'}
        </label>
      )}
      {showPrompt && <details className="text-[12px]" style={{ color: 'var(--text-soft)' }}><summary className="cursor-pointer">What MVP asked Stable Audio for</summary><p className="mt-1">{bed.prompt}</p></details>}
    </div>
  )
}

export default function MusicBedMaker({ showEngine = false, defaultSeconds = 30 }: {
  /** The team picks Small or Medium and sees the prompt; members get one engine. */
  showEngine?: boolean
  /** The video's length, when the panel opens from an edit. */
  defaultSeconds?: number
}) {
  const [moods, setMoods] = useState<string[]>(['upbeat'])
  const [tempo, setTempo] = useState('medium')
  const [styles, setStyles] = useState<string[]>(['pop'])
  const [seconds, setSeconds] = useState(defaultSeconds)
  const [model, setModel] = useState<BedModel>(DEFAULT_MODEL)
  const [beds, setBeds] = useState<Bed[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [making, setMaking] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // The month's new tracks (lib/music-bed MUSIC_TRACKS_MONTHLY_CAP).
  const [allow, setAllow] = useState<{ left: number | null; words: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const j = await call(null, 30_000)
      setBeds(j.beds || []); setLoadErr(null)
      if (j.allowance) setAllow({ left: j.allowance.left ?? null, words: String(j.allowanceWords || '') })
    } catch (e) { setLoadErr(e instanceof Error ? e.message : 'No answer') }
  }, [])
  useEffect(() => { void load() }, [load])

  const toggle = (list: string[], set: (v: string[]) => void, id: string, max: number) => {
    if (list.includes(id)) { if (list.length > 1) set(list.filter((x) => x !== id)) }
    else set(list.length >= max ? [...list.slice(1), id] : [...list, id])
  }

  async function make() {
    setMaking(true); setErr(null)
    try {
      const j = await call({ action: 'make', moods, tempo, styles, seconds, model }, 240_000)
      setBeds((b) => [j.bed as Bed, ...(b || [])])
      void load()
    } catch (e) {
      setErr(e instanceof Error ? (/timeout|abort/i.test(e.message) ? 'No answer in four minutes. Your list below shows whether it was made.' : e.message) : 'No answer')
      void load()
    } finally { setMaking(false) }
  }

  async function share(id: string, shared: boolean) {
    setBusy(id); setErr(null)
    try { const j = await call({ action: 'share', id, shared }, 30_000); setBeds((b) => (b || []).map((x) => (x.id === id ? (j.bed as Bed) : x))) }
    catch (e) { setErr(e instanceof Error ? e.message : 'No answer') }
    finally { setBusy(null) }
  }

  async function act(action: 'accept' | 'reject' | 'check', id: string) {
    setBusy(id); setErr(null)
    try { const j = await call({ action, id }, action === 'check' ? 90_000 : 30_000); setBeds((b) => (b || []).map((x) => (x.id === id ? (j.bed as Bed) : x))) }
    catch (e) { setErr(e instanceof Error ? e.message : 'No answer') }
    finally { setBusy(null) }
  }

  const max = BED_MODELS[model].maxSec
  const latest = beds?.[0] && beds[0].status === 'preview' ? beds[0] : null
  const accepted = (beds || []).filter((b) => b.status === 'accepted')
  const earlier = (beds || []).filter((b) => b !== latest && b.status !== 'accepted')

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl p-5 flex flex-col gap-5" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <Group title="Mood" hint={`pick up to ${MAX_MOODS}`}>{MOODS.map((m) => <Chip key={m.id} on={moods.includes(m.id)} onClick={() => toggle(moods, setMoods, m.id, MAX_MOODS)}>{m.label}</Chip>)}</Group>
        <Group title="Tempo">{TEMPOS.map((t) => <Chip key={t.id} on={tempo === t.id} onClick={() => setTempo(t.id)}>{t.label} <span className="font-normal opacity-75">{t.bpm} BPM</span></Chip>)}</Group>
        <Group title="Style" hint={`pick up to ${MAX_STYLES}`}>{STYLES.map((s) => <Chip key={s.id} on={styles.includes(s.id)} onClick={() => toggle(styles, setStyles, s.id, MAX_STYLES)}>{s.label}</Chip>)}</Group>
        <Group title="Length">
          {LENGTHS.filter((n) => n <= max).map((n) => <Chip key={n} on={seconds === n} onClick={() => setSeconds(n)}>{n} s</Chip>)}
          <label className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-soft)' }}>or
            <input type="number" min={MIN_SECONDS} max={max} value={seconds} onChange={(e) => setSeconds(Math.max(MIN_SECONDS, Math.min(max, Math.round(Number(e.target.value) || MIN_SECONDS))))} className="w-20 rounded-xl border bg-transparent px-2.5 py-1.5 text-[13.5px]" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} aria-label="Length in seconds" /> seconds
          </label>
        </Group>
        {showEngine && (
          <Group title="Engine" hint="for the team: compare them">
            {(Object.keys(BED_MODELS) as BedModel[]).map((k) => <Chip key={k} on={model === k} onClick={() => { setModel(k); setSeconds((s) => Math.min(s, BED_MODELS[k].maxSec)) }}>{BED_MODELS[k].name} <span className="font-normal opacity-75">${BED_MODELS[k].usd < 0.1 ? BED_MODELS[k].usd.toFixed(3) : BED_MODELS[k].usd.toFixed(2)} a track</span></Chip>)}
          </Group>
        )}
        {showEngine && (
          <p className="text-[12.5px] -mt-3" style={{ color: 'var(--text-soft)' }}>{BED_MODELS[model].says}. Up to {BED_MODELS[model].maxSec} seconds.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void make()} disabled={making || allow?.left === 0} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold disabled:opacity-60" style={{ background: 'var(--accent)', color: '#fff' }}>
            {making ? <Loader2 size={15} className="animate-spin" /> : latest ? <RefreshCw size={15} /> : <Music2 size={15} />} {making ? 'Making your track' : latest ? 'Make another' : 'Make a preview'}
          </button>
          <span className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>{making ? 'Usually 10 to 40 seconds, then MVP checks it for voices.' : 'Always instrumental. Every track is checked for voices before you hear it.'}</span>
        </div>
        {allow?.words && <p className="text-[12.5px]" style={{ color: allow.left === 0 ? AMBER : 'var(--text-soft)' }}>{allow.words}</p>}
        {err && <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: RED }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}</p>}
      </section>

      {loadErr && <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: RED }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> Your tracks did not load: {loadErr}</p>}
      {latest && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[16px] font-bold" style={{ color: 'var(--text)' }}>Your preview</h2>
          <BedCard bed={latest} busy={busy === latest.id} onAct={act} showPrompt={showEngine} />
        </section>
      )}
      {accepted.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[16px] font-bold" style={{ color: 'var(--text)' }}>Accepted</h2>
          {accepted.map((b) => <BedCard key={b.id} bed={b} busy={busy === b.id} onAct={act} showPrompt={showEngine} onShare={(id, on) => void share(id, on)} />)}
        </section>
      )}
      {earlier.length > 0 && (
        <details className="flex flex-col gap-2">
          <summary className="cursor-pointer text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Earlier previews ({earlier.length})</summary>
          <div className="flex flex-col gap-2 mt-2">{earlier.map((b) => <BedCard key={b.id} bed={b} busy={busy === b.id} onAct={act} showPrompt={showEngine} />)}</div>
        </details>
      )}
      {beds && beds.length === 0 && !loadErr && <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>No tracks yet. Tick a mood, a tempo and a style, then make a preview.</p>}
    </div>
  )
}
