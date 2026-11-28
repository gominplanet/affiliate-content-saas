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
//
// CLIP FIRST (Seb, 2026-11-27: "start the faster clip first method"): each
// hook, body and CTA a video uses is uploaded and edited once, as a clip, and
// every video is its clips joined on the video server (lib/studio-clips).
// B-roll goes over the bodies and CTAs; a talking hook stays on the face.
//
// A VOICEOVER SET (Seb, 2026-11-26: "only voiceover type videos"): the hooks,
// bodies and CTAs are the creator's voice (a voice memo, or a video whose
// sound is used), and the B-roll is required, because it is the whole
// picture: the video server lays the clips over the cut voice, taking turns
// (lib/studio-render, ingest-service voiceoverShots).

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, X, AlertTriangle, Wand2, Film, Mic, Check } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { readVideoFacts } from '@/lib/video-file-facts'
import { BULK_VIDEO_MAX_BYTES, tooBigWords } from '@/lib/clip-source-limits'
import { uploadTake } from '@/components/review-editor/upload-take'
import { mixCombos, mixCounts, MIX_WORDS, type MixMode } from '@/lib/studio-mix'
import { neededClips, clipBroll, comboLabels } from '@/lib/studio-clips'
import type { EditSettings } from '@/lib/review-edit'
import { VOICE_NAME } from '@/lib/studio-render'

const ACCENT = 'var(--accent)'
const RED = '#DC2626'
const AMBER = '#B45309'
const soft = { color: 'var(--text-3)' }
const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold disabled:opacity-50'
const VIDEO_NAME = /\.(mov|mp4|m4v|mts|m2ts|avi|mkv|webm|3gp)$/i

type Part = 'hook' | 'body' | 'cta' | 'broll'
/** A clip from this computer (file), or one already in MVP: a part cut from
 *  one recording (up), lib/voice-split. */
interface Clip { key: string; file: File | null; name: string; seconds: number | null; up?: { url: string; bytes: number; name: string } }
const PARTS: Array<{ id: Part; title: string; short: string; says: string; voice: string }> = [
  { id: 'hook', title: 'Hooks', short: 'H', says: 'The openings. Each one is tested against the others.', voice: 'Your voice for each opening: a voice memo, or a video whose sound is used.' },
  { id: 'body', title: 'Bodies', short: 'B', says: 'The middle: the product shown and talked about.', voice: 'Your voice for the middle, about the product.' },
  { id: 'cta', title: 'CTAs', short: 'C', says: 'The endings: what to do next. Optional when a body ends on its own.', voice: 'Your voice for the endings. Optional when a body ends on its own.' },
  { id: 'broll', title: 'B-roll', short: 'R', says: 'Optional: beauty shots and the product in use, laid over the talk.', voice: 'Needed: the whole picture. The clips take turns over your voice, a few seconds each.' },
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

export default function StudioMixer({ brand, settings, trybeLeft, onAdded, projectId = null, namePrefix, voiceover = false }: {
  brand: { id: string; name: string }
  /** The options ticked above, on every video. */
  settings: EditSettings
  /** TRYBE ad edits left this month, or null for no limit. */
  trybeLeft: number | null
  onAdded: () => Promise<void>
  /** The Video Builder set these videos belong to (migration 477). */
  projectId?: string | null
  /** What each video's name starts with: the brand and product. */
  namePrefix?: string
  /** A voiceover set: voice files, and B-roll for the whole picture. */
  voiceover?: boolean
}) {
  const [supabase] = useState(() => createBrowserClient())
  const [clips, setClips] = useState<Record<Part, Clip[]>>({ hook: [], body: [], cta: [], broll: [] })
  const [problems, setProblems] = useState<string[]>([])
  const [reading, setReading] = useState<Part | null>(null)
  const [mode, setMode] = useState<MixMode>('all')
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<{ added: number; clips: number; failed: string[]; skipped: number } | null>(null)
  const stop = useRef(false)
  // ONE RECORDING, EVERY PART (lib/voice-split): uploading, then MVP listening.
  const [splitting, setSplitting] = useState<string | null>(null)
  const [splitSaid, setSplitSaid] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)

  // Left the page while a long cut runs: stop asking.
  const gone = useRef(false)
  useEffect(() => () => { gone.current = true }, [])

  /** The parts, in their columns, each already in MVP. */
  function fillParts(parts: Array<{ label: string; kind: Part; url?: string; seconds?: number; bytes?: number }>, from: string, path: string) {
    const add: Record<Part, Clip[]> = { hook: [], body: [], cta: [], broll: [] }
    for (const p of parts) {
      if ((p.kind !== 'hook' && p.kind !== 'body' && p.kind !== 'cta') || !p.url) continue
      const name = `${p.label} from ${from}`.slice(0, 120)
      add[p.kind].push({ key: `${p.kind}:split:${p.label}:${path}`, file: null, name, seconds: p.seconds ?? null, up: { url: p.url, bytes: p.bytes ?? 0, name } })
    }
    setClips((c) => ({ hook: [...c.hook, ...add.hook], body: [...c.body, ...add.body], cta: [...c.cta, ...add.cta], broll: c.broll }))
  }

  async function splitOne(list: FileList | null) {
    const f = list?.[0]
    if (!f || splitting) return
    setSplitSaid(null)
    if (!projectId) { setSplitSaid({ tone: 'bad', text: 'Pick the product first: the recording is split by this set\u2019s scripts.' }); return }
    if (voiceover && !f.type.startsWith('audio/') && !f.type.startsWith('video/') && !VOICE_NAME.test(f.name)) { setSplitSaid({ tone: 'bad', text: `${f.name} is not a sound or video file.` }); return }
    if (!voiceover && !f.type.startsWith('video/') && !VIDEO_NAME.test(f.name)) { setSplitSaid({ tone: 'bad', text: `${f.name} is not a video file.` }); return }
    if (f.size > BULK_VIDEO_MAX_BYTES) { setSplitSaid({ tone: 'bad', text: `${f.name}: ${tooBigWords(f.size)}` }); return }
    if (!voiceover) {
      // Vertical 9:16 only, as every clip in the Video Builder.
      let facts = await readVideoFacts(f)
      if (!facts.width || !facts.height) { const pf = await playerFacts(f); facts = { ...facts, width: pf.width, height: pf.height } }
      if (facts.width && facts.height && facts.width > facts.height) { setSplitSaid({ tone: 'bad', text: `${f.name} was filmed sideways. The Video Builder takes vertical 9:16 video only.` }); return }
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSplitSaid({ tone: 'bad', text: 'Sign in again, then add the recording.' }); return }
    try {
      setSplitting('Uploading your recording')
      const u = await uploadTake(supabase, user.id, f, (sent) => setSplitting(`Uploading your recording (${Math.min(99, Math.round((sent / Math.max(1, f.size)) * 100))}%)`))
      setSplitting('MVP is listening and finding each hook, body and CTA. Usually under a minute.')
      const ask = (b: Record<string, unknown>, ms: number) => fetch('/api/labs/trybe-studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(ms), body: JSON.stringify({ projectId, brandId: brand.id, ...b }) })
      const r = await ask({ action: voiceover ? 'split_voice' : 'split_video', url: u.url }, 290_000)
      type SplitPartOut = { label: string; kind: Part; url?: string; seconds?: number; bytes?: number }
      const d = await r.json().catch(() => ({})) as { error?: string; words?: string; missing?: string[]; job?: string; parts?: SplitPartOut[] }
      if (!r.ok || !d.parts) { setSplitSaid({ tone: 'bad', text: d.error || `MVP answered ${r.status}. Try again.` }); return }
      let parts: SplitPartOut[] = d.parts
      if (!voiceover && d.job) {
        // CUT IN THE BACKGROUND (ingest-service /cut-video): asked how it goes every few seconds.
        const n = d.parts.length
        setSplitting(`${d.words || `Found ${n} parts.`} The video server is cutting ${n === 1 ? 'it' : `all ${n}`} now: a long video takes a few minutes. Keep this tab open.`)
        let done: { state?: string; error?: string; parts?: SplitPartOut[] } = {}
        for (let i = 0; i < 360 && !gone.current; i++) {
          await new Promise((ok) => setTimeout(ok, 5000))
          const st = await ask({ action: 'split_status', job: d.job }, 30_000).then((x) => x.json()).catch(() => null) as typeof done | null
          if (!st) continue
          if (st.state === 'done' || st.state === 'failed') { done = st; break }
        }
        if (gone.current) return
        if (done.state !== 'done' || !done.parts) { setSplitSaid({ tone: 'bad', text: done.error ? `The video was not cut: ${done.error}` : 'The video server did not finish cutting in 30 minutes. Add the video again.' }); return }
        parts = done.parts
      }
      fillParts(parts, f.name, u.path)
      const cut = parts.filter((p) => p.url).length
      setSplitSaid({ tone: d.missing?.length || cut < parts.length ? 'warn' : 'ok', text: `${d.words || ''}${cut < parts.length ? ` ${parts.length - cut} could not be cut.` : ''} Each part is in its column below: press ${voiceover ? 'Listen' : 'Watch'} to check where it was cut.` })
    } catch (e) {
      setSplitSaid({ tone: 'bad', text: e instanceof Error ? e.message : 'The recording was not split. Try again.' })
    } finally { setSplitting(null) }
  }

  async function pick(part: Part, list: FileList | null) {
    const chosen = Array.from(list ?? [])
    if (!chosen.length) return
    setReading(part); setResult(null)
    const bad: string[] = []
    const ok: Clip[] = []
    const voice = voiceover && part !== 'broll'
    for (const f of chosen) {
      if (voice) {
        // A voice: any sound file, or a video whose sound is used; its shape does not matter.
        if (!f.type.startsWith('audio/') && !f.type.startsWith('video/') && !VOICE_NAME.test(f.name)) { bad.push(`${f.name}: not a sound or video file.`); continue }
        if (f.size > BULK_VIDEO_MAX_BYTES) { bad.push(`${f.name}: ${tooBigWords(f.size)}`); continue }
        const p = await playerFacts(f)
        ok.push({ key: `${part}:${f.name}:${f.size}:${f.lastModified}`, file: f, name: f.name, seconds: p.seconds })
        continue
      }
      if (!f.type.startsWith('video/') && !VIDEO_NAME.test(f.name)) { bad.push(`${f.name}: not a video file.`); continue }
      if (f.size > BULK_VIDEO_MAX_BYTES) { bad.push(`${f.name}: ${tooBigWords(f.size)}`); continue }
      let facts = await readVideoFacts(f)
      if (!facts.width || !facts.height) { const p = await playerFacts(f); facts = { ...facts, seconds: facts.seconds ?? p.seconds, width: p.width, height: p.height } }
      // Vertical 9:16 only (Seb, 2026-11-26): a sideways clip is left out and named.
      if (facts.width && facts.height && facts.width > facts.height) { bad.push(`${f.name}: filmed sideways. The Video Builder takes vertical 9:16 video only.`); continue }
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
  const need = useMemo(() => neededClips(trybeLeft !== null ? combos.slice(0, Math.max(0, trybeLeft)) : combos), [combos, trybeLeft])
  const ready = clips.hook.length > 0 && clips.body.length > 0 && (!voiceover || clips.broll.length > 0)

  async function process() {
    if (!ready || running) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Sign in again, then press Process.'); return }
    stop.current = false
    setResult(null)
    const list = trybeLeft !== null ? combos.slice(0, Math.max(0, trybeLeft)) : combos
    const skipped = combos.length - list.length
    // 1. The clips the videos use (lib/studio-clips), and their B-roll, each file uploaded once.
    const need = neededClips(list)
    const brollOf = need.map((c, k) => clipBroll(k, c.part, clips.broll.length, voiceover))
    const needed = new Set<string>()
    need.forEach((c, k) => { needed.add(clips[c.part][c.i].key); for (const r of brollOf[k]) needed.add(clips.broll[r].key) })
    const every = [...clips.hook, ...clips.body, ...clips.cta, ...clips.broll]
    // Parts cut from one recording are in MVP already.
    const all = every.filter((c) => needed.has(c.key) && !c.up && c.file)
    const up = new Map<string, { url: string; bytes: number; name: string }>(every.filter((c) => c.up).map((c) => [c.key, c.up!]))
    for (let i = 0; i < all.length; i++) {
      if (stop.current) { setRunning(null); setResult({ added: 0, clips: 0, failed: ['Nothing was made: you stopped.'], skipped }); return }
      const c = all[i]
      setRunning(`Uploading ${i + 1} of ${all.length}: ${c.name}`)
      try {
        const file = c.file!
        const u = await uploadTake(supabase, user.id, file, (sent) => setRunning(`Uploading ${i + 1} of ${all.length}: ${c.name} (${Math.min(99, Math.round((sent / Math.max(1, file.size)) * 100))}%)`))
        up.set(c.key, { url: u.url, bytes: file.size, name: c.name })
      } catch (e) {
        setRunning(null)
        toast.error(`${c.name}: ${e instanceof Error ? e.message : 'the upload failed.'} Nothing was made: press Process again.`)
        return
      }
    }
    // 2. One call: the clips, each edited once, and the videos put together from them.
    setRunning(`Sending ${need.length} clips and ${list.length} ${list.length === 1 ? 'video' : 'videos'} to MVP`)
    const take = (fs: Array<{ url: string; bytes: number; name: string }>) => ({ url: fs[0].url, name: fs[0].name, bytes: fs[0].bytes, ...(fs.length > 1 ? { more: fs.slice(1).map((f) => ({ url: f.url, name: f.name, bytes: f.bytes })) } : {}) })
    let added = 0, made = 0
    const failed: string[] = []
    try {
      const r = await fetch('/api/review-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({
          action: 'studio_set', namePrefix: namePrefix || brand.name, settings,
          studio: { brandId: brand.id, ...(projectId ? { projectId } : {}), ...(voiceover ? { voiceover: true } : {}) },
          clips: need.map((c, k) => ({ label: c.label, review: take([up.get(clips[c.part][c.i].key)!]), ...(brollOf[k].length ? { broll: take(brollOf[k].map((x) => up.get(clips.broll[x].key)!)) } : {}) })),
          combos: list.map((cb) => ({ label: cb.label, parts: comboLabels(cb) })),
        }),
      })
      const d = await r.json().catch(() => ({})) as { error?: string; clips?: number; videos?: number }
      if (r.ok) { added = d.videos ?? list.length; made = d.clips ?? need.length }
      else failed.push(d.error || `MVP answered ${r.status}. Nothing was made: press Process again.`)
    } catch (e) { failed.push(`${e instanceof Error ? e.message : 'No answer from MVP'}. Nothing may have been made: reload this page before pressing Process again.`) }
    setRunning(null)
    setResult({ added, clips: made, failed, skipped })
    await onAdded()
  }

  return (
    <div className="space-y-3">
      {/* ONE FILE, EVERY PART (lib/voice-split): a voiceover recording, or a long talking take (Seb, 2026-11-28). */}
      <div className="rounded-2xl border p-3 flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex-1 min-w-[16rem]">
          <p className="text-[14px] font-bold">{voiceover ? 'Recorded every line in one go?' : 'Filmed every line in one long take?'}</p>
          <p className="text-[12.5px]" style={soft}>{voiceover ? 'Add the one recording.' : 'Add the one video, vertical.'} MVP finds each hook, body and CTA of your scripts in it, keeps the last good take of each, {voiceover ? 'and puts every part in its column' : 'cuts each one out cleanly, and puts every part in its column'}. No scripts? Say each part&rsquo;s name before it: &ldquo;Hook one&rdquo;, &ldquo;Body two&rdquo;, &ldquo;CTA one&rdquo;.</p>
        </div>
        <label className={`${btn} cursor-pointer`} style={{ border: '1px solid var(--border)', color: ACCENT }}>
          {splitting ? <Loader2 size={14} className="animate-spin" /> : voiceover ? <Mic size={14} /> : <Film size={14} />} {voiceover ? 'Add one recording' : 'Add one video'}
          <input type="file" accept={voiceover ? 'audio/*,video/*,.m4a,.mp3,.wav,.aac,.caf,.mov,.mp4' : 'video/*,.mov,.mp4,.m4v'} className="hidden" disabled={!!splitting || !!running} onChange={(e) => { void splitOne(e.target.files); e.target.value = '' }} />
        </label>
        {splitting && <p className="w-full text-[12.5px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> {splitting}</p>}
        {splitSaid && <p className="w-full text-[12.5px] inline-flex items-start gap-1.5" style={{ color: splitSaid.tone === 'bad' ? RED : splitSaid.tone === 'warn' ? AMBER : 'var(--text)' }}>{splitSaid.tone === 'ok' ? <Check size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />} {splitSaid.text}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PARTS.map((p) => (
          <div key={p.id} className="rounded-2xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg inline-flex items-center justify-center text-[12px] font-bold" style={{ background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT }}>{p.short}</span>
              <p className="text-[14px] font-bold flex-1">{p.title}</p>
              <span className="text-[12px] tabular-nums" style={soft}>{clips[p.id].length}</span>
            </div>
            <p className="text-[12px]" style={soft}>{voiceover ? p.voice : p.says}</p>
            <ul className="space-y-1">
              {clips[p.id].map((c, i) => (
                <li key={c.key} className="flex items-center gap-1.5 text-[12.5px]">
                  <span className="font-semibold tabular-nums" style={{ color: ACCENT }}>{p.id === 'broll' ? '' : `${p.short}${i + 1}`}</span>
                  <span className="truncate flex-1" title={c.name}>{c.name}</span>
                  {c.seconds != null && <span className="tabular-nums" style={soft}>{Math.round(c.seconds)}s</span>}
                  {c.up && <a href={c.up.url} target="_blank" rel="noopener noreferrer" className="font-semibold" style={{ color: ACCENT }}>{voiceover ? 'Listen' : 'Watch'}</a>}
                  <button onClick={() => setClips((x) => ({ ...x, [p.id]: x[p.id].filter((y) => y.key !== c.key) }))} disabled={!!running} aria-label={`Remove ${c.name}`} style={soft}><X size={12} /></button>
                </li>
              ))}
            </ul>
            <label className={`${btn} justify-center cursor-pointer mt-auto`} style={{ border: '1px dashed var(--border)', color: ACCENT }}>
              {reading === p.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add {p.title.toLowerCase()}
              <input type="file" accept={voiceover && p.id !== 'broll' ? 'audio/*,video/*,.m4a,.mp3,.wav,.aac,.caf,.mov,.mp4' : 'video/*,.mov,.mp4,.m4v'} multiple className="hidden" disabled={!!running || !!reading} onChange={(e) => { void pick(p.id, e.target.files); e.target.value = '' }} />
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
            {' '}MVP edits each hook, body and CTA once ({need.length} {need.length === 1 ? 'clip' : 'clips'}), then puts every video together from them.
            {voiceover
              ? ` Your B-roll is the whole picture, the clips taking turns over your voice${clips.broll.length > 6 ? ', 6 for each part' : ''}.`
              : clips.broll.length > 0 ? ` B-roll goes over the bodies and CTAs${clips.broll.length > 6 ? ', 6 clips each, taking turns' : ''}; the hooks stay on your face.` : ''}
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
      {!ready && <p className="text-[12.5px] inline-flex items-center gap-1.5" style={soft}><Film size={13} /> {voiceover ? 'Add at least one hook, one body and one B-roll clip to start. CTAs are optional.' : 'Add at least one hook and one body to start. CTAs and B-roll are optional.'}</p>}
      {result && (
        <div className="text-[13px] space-y-1">
          <p style={{ color: result.added ? 'var(--text)' : RED }}>{result.added ? `${result.clips} ${result.clips === 1 ? 'clip is' : 'clips are'} in line to be edited, then ${result.added} ${result.added === 1 ? 'video is' : 'videos are'} put together from them. Each shows below as it goes` : 'Nothing was made'}{result.skipped ? `; ${result.skipped} not made, no TRYBE ad edits left` : ''}.</p>
          {result.failed.length > 0 && <ul className="text-[12.5px] space-y-0.5" style={{ color: RED }}>{result.failed.map((t) => <li key={t}>{t}</li>)}</ul>}
        </div>
      )}
    </div>
  )
}
