'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOOKS, BODIES, CTAs AND B-ROLL, PUT TOGETHER BY MVP (Seb, 2026-11-26: "I'm
// uploading 3 different hooks, and then ... 3 different bodies, and then ...
// 3 different CTAs, and then I could upload some B-roll, beauty shots of the
// product ... and then having MVP put together everything"). Vertical clips
// only. On Process, each clip is uploaded once, then every combination
// chosen (lib/studio-mix) becomes one video in the review editor's queue: its
// hook, body and CTA joined in that order, B-roll laid over it, the ticked
// options on it, checked against the brand's rules when it is made.

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, X, AlertTriangle, Wand2, Film } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { readVideoFacts } from '@/lib/video-file-facts'
import { BULK_VIDEO_MAX_BYTES, tooBigWords } from '@/lib/clip-source-limits'
import { uploadTake } from '@/components/review-editor/upload-take'
import { mixCombos, mixCounts, brollFor, MIX_WORDS, type MixMode } from '@/lib/studio-mix'
import type { EditSettings } from '@/lib/review-edit'

const ACCENT = 'var(--accent)'
const RED = '#DC2626'
const AMBER = '#B45309'
const soft = { color: 'var(--text-3)' }
const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold disabled:opacity-50'
const VIDEO_NAME = /\.(mov|mp4|m4v|mts|m2ts|avi|mkv|webm|3gp)$/i

type Part = 'hook' | 'body' | 'cta' | 'broll'
interface Clip { key: string; file: File; name: string; seconds: number | null }
const PARTS: Array<{ id: Part; title: string; short: string; says: string }> = [
  { id: 'hook', title: 'Hooks', short: 'H', says: 'The openings. Each one is tested against the others.' },
  { id: 'body', title: 'Bodies', short: 'B', says: 'The middle: the product shown and talked about.' },
  { id: 'cta', title: 'CTAs', short: 'C', says: 'The endings: what to do next. Optional when a body ends on its own.' },
  { id: 'broll', title: 'B-roll', short: 'R', says: 'Optional: beauty shots and the product in use, laid over the talk.' },
]

/** Shape and length from the browser's player, when the file's own box could not be read. */
function playerFacts(file: File): Promise<{ seconds: number | null; width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    let t: ReturnType<typeof setTimeout> | null = null
    const done = (f: { seconds: number | null; width: number | null; height: number | null }) => { if (t) clearTimeout(t); v.removeAttribute('src'); URL.revokeObjectURL(url); resolve(f) }
    t = setTimeout(() => done({ seconds: null, width: null, height: null }), 8000)
    v.preload = 'metadata'
    v.onloadedmetadata = () => done({ seconds: Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null, width: v.videoWidth || null, height: v.videoHeight || null })
    v.onerror = () => done({ seconds: null, width: null, height: null })
    v.src = url
  })
}

export default function StudioMixer({ brand, settings, trybeLeft, onAdded }: {
  brand: { id: string; name: string }
  /** The options ticked above, on every video. */
  settings: EditSettings
  /** TRYBE ad edits left this month, or null for no limit. */
  trybeLeft: number | null
  onAdded: () => Promise<void>
}) {
  const [supabase] = useState(() => createBrowserClient())
  const [clips, setClips] = useState<Record<Part, Clip[]>>({ hook: [], body: [], cta: [], broll: [] })
  const [problems, setProblems] = useState<string[]>([])
  const [reading, setReading] = useState<Part | null>(null)
  const [mode, setMode] = useState<MixMode>('all')
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<{ added: number; failed: string[]; skipped: number } | null>(null)
  const stop = useRef(false)

  async function pick(part: Part, list: FileList | null) {
    const chosen = Array.from(list ?? [])
    if (!chosen.length) return
    setReading(part); setResult(null)
    const bad: string[] = []
    const ok: Clip[] = []
    for (const f of chosen) {
      if (!f.type.startsWith('video/') && !VIDEO_NAME.test(f.name)) { bad.push(`${f.name}: not a video file.`); continue }
      if (f.size > BULK_VIDEO_MAX_BYTES) { bad.push(`${f.name}: ${tooBigWords(f.size)}`); continue }
      let facts = await readVideoFacts(f)
      if (!facts.width || !facts.height) { const p = await playerFacts(f); facts = { ...facts, seconds: facts.seconds ?? p.seconds, width: p.width, height: p.height } }
      // Vertical 9:16 only (Seb, 2026-11-26): a sideways clip is left out and named.
      if (facts.width && facts.height && facts.width > facts.height) { bad.push(`${f.name}: filmed sideways. The Edit Studio takes vertical 9:16 video only.`); continue }
      ok.push({ key: `${part}:${f.name}:${f.size}:${f.lastModified}`, file: f, name: f.name, seconds: facts.seconds })
    }
    setClips((c) => {
      const have = new Set(c[part].map((x) => x.key))
      return { ...c, [part]: [...c[part], ...ok.filter((x) => !have.has(x.key))] }
    })
    setProblems(bad)
    setReading(null)
  }

  const counts = mixCounts(clips.hook.length, clips.body.length, clips.cta.length)
  const combos = useMemo(() => mixCombos(clips.hook.length, clips.body.length, clips.cta.length, mode), [clips.hook.length, clips.body.length, clips.cta.length, mode])
  const tooMany = trybeLeft !== null && combos.length > trybeLeft
  const ready = clips.hook.length > 0 && clips.body.length > 0

  async function process() {
    if (!ready || running) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Sign in again, then press Process.'); return }
    stop.current = false
    setResult(null)
    const list = trybeLeft !== null ? combos.slice(0, Math.max(0, trybeLeft)) : combos
    const skipped = combos.length - list.length
    // 1. Each clip a video uses, uploaded once.
    const needed = new Set<string>()
    list.forEach((cb, k) => {
      needed.add(clips.hook[cb.h].key); needed.add(clips.body[cb.b].key)
      if (cb.c != null) needed.add(clips.cta[cb.c].key)
      for (const r of brollFor(k, clips.broll.length)) needed.add(clips.broll[r].key)
    })
    const all = [...clips.hook, ...clips.body, ...clips.cta, ...clips.broll].filter((c) => needed.has(c.key))
    const up = new Map<string, { url: string; bytes: number; name: string }>()
    for (let i = 0; i < all.length; i++) {
      if (stop.current) break
      const c = all[i]
      setRunning(`Uploading ${i + 1} of ${all.length}: ${c.name}`)
      try {
        const u = await uploadTake(supabase, user.id, c.file, (sent) => setRunning(`Uploading ${i + 1} of ${all.length}: ${c.name} (${Math.min(99, Math.round((sent / Math.max(1, c.file.size)) * 100))}%)`))
        up.set(c.key, { url: u.url, bytes: c.file.size, name: c.name })
      } catch (e) {
        setRunning(null)
        toast.error(`${c.name}: ${e instanceof Error ? e.message : 'the upload failed.'} Nothing was made: press Process again.`)
        return
      }
    }
    // 2. Each combination, one video: hook, body and CTA joined in order, B-roll over it.
    let added = 0
    const failed: string[] = []
    for (let k = 0; k < list.length; k++) {
      if (stop.current) { failed.push(`${list.length - k} not made: you stopped.`); break }
      const cb = list[k]
      setRunning(`Making ${k + 1} of ${list.length}: ${cb.label}`)
      const parts = [clips.hook[cb.h], clips.body[cb.b], ...(cb.c != null ? [clips.cta[cb.c]] : [])].map((c) => up.get(c.key)!)
      const roll = brollFor(k, clips.broll.length).map((r) => up.get(clips.broll[r].key)!).filter(Boolean)
      const take = (fs: Array<{ url: string; bytes: number; name: string }>) => ({ url: fs[0].url, name: fs[0].name, bytes: fs[0].bytes, ...(fs.length > 1 ? { more: fs.slice(1).map((f) => ({ url: f.url, name: f.name, bytes: f.bytes })) } : {}) })
      try {
        const r = await fetch('/api/review-edit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90_000),
          body: JSON.stringify({ action: 'add', name: `${brand.name} ${cb.label}`, review: take(parts), ...(roll.length ? { broll: take(roll) } : {}), settings, studio: { brandId: brand.id } }),
        })
        const d = await r.json().catch(() => ({})) as { error?: string; allowanceFull?: boolean }
        if (r.ok) { added++; continue }
        failed.push(`${cb.label}: ${d.error || `MVP answered ${r.status}`}`)
        if (d.allowanceFull) { failed.push(`${list.length - k - 1} more not made: no TRYBE ad edits left this month.`); break }
      } catch (e) { failed.push(`${cb.label}: ${e instanceof Error ? e.message : 'no answer'}`) }
    }
    setRunning(null)
    setResult({ added, failed, skipped })
    await onAdded()
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PARTS.map((p) => (
          <div key={p.id} className="rounded-2xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg inline-flex items-center justify-center text-[12px] font-bold" style={{ background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT }}>{p.short}</span>
              <p className="text-[14px] font-bold flex-1">{p.title}</p>
              <span className="text-[12px] tabular-nums" style={soft}>{clips[p.id].length}</span>
            </div>
            <p className="text-[12px]" style={soft}>{p.says}</p>
            <ul className="space-y-1">
              {clips[p.id].map((c, i) => (
                <li key={c.key} className="flex items-center gap-1.5 text-[12.5px]">
                  <span className="font-semibold tabular-nums" style={{ color: ACCENT }}>{p.id === 'broll' ? '' : `${p.short}${i + 1}`}</span>
                  <span className="truncate flex-1" title={c.name}>{c.name}</span>
                  {c.seconds != null && <span className="tabular-nums" style={soft}>{Math.round(c.seconds)}s</span>}
                  <button onClick={() => setClips((x) => ({ ...x, [p.id]: x[p.id].filter((y) => y.key !== c.key) }))} disabled={!!running} aria-label={`Remove ${c.name}`} style={soft}><X size={12} /></button>
                </li>
              ))}
            </ul>
            <label className={`${btn} justify-center cursor-pointer mt-auto`} style={{ border: '1px dashed var(--border)', color: ACCENT }}>
              {reading === p.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add {p.title.toLowerCase()}
              <input type="file" accept="video/*,.mov,.mp4,.m4v" multiple className="hidden" disabled={!!running || !!reading} onChange={(e) => { void pick(p.id, e.target.files); e.target.value = '' }} />
            </label>
          </div>
        ))}
      </div>
      {problems.length > 0 && <ul className="text-[12.5px] space-y-0.5" style={{ color: AMBER }}>{problems.map((t) => <li key={t} className="inline-flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {t}</li>)}</ul>}

      {ready && (
        <div className="rounded-2xl border p-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[13px] font-semibold">Which videos to make</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Which videos to make">
            {(['all', 'pairs', 'once'] as MixMode[]).map((m) => (
              <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} disabled={!!running} className="rounded-xl px-3 py-2 text-left text-[13px] max-w-[18rem]" style={mode === m ? { border: `2px solid ${ACCENT}`, background: 'rgb(var(--brand-rgb) / 0.06)' } : { border: '1px solid var(--border)' }}>
                <span className="font-bold block">{MIX_WORDS[m].label}: {counts[m]} {counts[m] === 1 ? 'video' : 'videos'}</span>
                <span className="text-[12px]" style={soft}>{MIX_WORDS[m].says}</span>
              </button>
            ))}
          </div>
          <p className="text-[12.5px]" style={soft}>
            {combos.slice(0, 12).map((c) => c.label).join(', ')}{combos.length > 12 ? ` and ${combos.length - 12} more` : ''}.
            {clips.broll.length > 0 ? ` Each gets B-roll laid over it${clips.broll.length > 6 ? ', 6 clips each, taking turns' : ''}.` : ''}
            {' '}Each video uses one of your TRYBE ad edits.
          </p>
          {tooMany && <p className="text-[12.5px]" style={{ color: AMBER }}>You have {trybeLeft} TRYBE ad edits left this month, so only the first {trybeLeft} of these {combos.length} will be made.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => void process()} disabled={!!running || (trybeLeft !== null && trybeLeft <= 0)} className={btn} style={{ background: ACCENT, color: '#fff', padding: '10px 16px', fontSize: 14 }}>
              {running ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Process {tooMany ? trybeLeft : combos.length} {combos.length === 1 ? 'video' : 'videos'}
            </button>
            {running && <><span className="text-[12.5px]" style={soft}>{running}. Keep this tab open.</span><button onClick={() => { stop.current = true }} className="text-[12.5px] font-semibold underline" style={{ color: RED }}>Stop</button></>}
          </div>
        </div>
      )}
      {!ready && <p className="text-[12.5px] inline-flex items-center gap-1.5" style={soft}><Film size={13} /> Add at least one hook and one body to start. CTAs and B-roll are optional.</p>}
      {result && (
        <div className="text-[13px] space-y-1">
          <p style={{ color: result.added ? 'var(--text)' : RED }}>{result.added} {result.added === 1 ? 'video is' : 'videos are'} in line to be made. Each shows below as it is edited and checked{result.skipped ? `; ${result.skipped} not made, no TRYBE ad edits left` : ''}.</p>
          {result.failed.length > 0 && <ul className="text-[12.5px] space-y-0.5" style={{ color: RED }}>{result.failed.map((t) => <li key={t}>{t}</li>)}</ul>}
        </div>
      )}
    </div>
  )
}
