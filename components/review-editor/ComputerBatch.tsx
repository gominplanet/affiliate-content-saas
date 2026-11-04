'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BATCH FROM THIS COMPUTER (Seb, 2026-11-04: "could it be possible to
// upload directly without going through google drive", then "yes build
// batch upload too"). The same batch as one from Google Drive (DriveBatch),
// with the takes on the creator's computer instead:
//   1. they choose their talking takes, then their B-roll, many at once;
//   2. MVP reads each file where it is, before anything is uploaded: when it
//      was filmed, how long it is and whether it was filmed upright
//      (lib/video-file-facts), and pairs them the Drive batch's way
//      (lib/review-edit-batch); files already in a video (same name, same
//      size) are left out and listed;
//   3. they check the videos (BatchCheck, the same list as Drive's);
//   4. one press uploads the takes one video at a time, and each video joins
//      the queue the moment its own files are up, so the first is being
//      edited while the rest upload. Every video says what happened to it.
// The tab has to stay open while it uploads (Drive's batch does not need
// that, which is why both exist), so leaving the page asks first, and
// "Stop after this video" ends it cleanly. A video whose upload or add
// failed has its uploaded files deleted at once; anything left by a closed
// tab is swept the next night (/api/cron/purge-shorts-sources).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Loader2, UploadCloud, Film, Check, AlertTriangle } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { batchVideos, uploadKey, type BatchVideo, type DriveTake } from '@/lib/review-edit-batch'
import { cleanSettings, type EditSettings } from '@/lib/review-edit'
import { BULK_VIDEO_MAX_BYTES } from '@/lib/clip-source-limits'
import { readVideoFacts, type VideoFacts } from '@/lib/video-file-facts'
import { uploadTake, TAKE_BUCKET } from '@/components/review-editor/upload-take'
import BatchCheck, { mixed } from '@/components/review-editor/BatchCheck'

const PURPLE = 'var(--accent)'
const GREEN = '#15803D'
const AMBER = '#B45309'
const soft = { color: 'var(--text-3)' }
/** At most this many files in one pick, like a Drive batch. */
const MAX_PICK = 80
const size = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1048576))} MB`)
const VIDEO_NAME = /\.(mov|mp4|m4v|mts|m2ts|avi|mkv|webm|3gp)$/i

/** Shape and length from the browser's own player, for a file whose movie
 *  box could not be read (a WebM, say). Gives up after 8 seconds. */
function playerFacts(file: File): Promise<Pick<VideoFacts, 'seconds' | 'width' | 'height'>> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    let t: ReturnType<typeof setTimeout> | null = null
    const done = (f: Pick<VideoFacts, 'seconds' | 'width' | 'height'>) => { if (t) clearTimeout(t); v.removeAttribute('src'); URL.revokeObjectURL(url); resolve(f) }
    t = setTimeout(() => done({ seconds: null, width: null, height: null }), 8000)
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => done({ seconds: Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null, width: v.videoWidth || null, height: v.videoHeight || null })
    v.onerror = () => done({ seconds: null, width: null, height: null })
    v.src = url
  })
}

/** A file on the computer as a batch take: what it says about itself, and
 *  when it was last saved for the order when it does not say when it was filmed. */
async function asTake(file: File, id: string): Promise<DriveTake> {
  let f = await readVideoFacts(file)
  if (!f.width || !f.height) {
    const p = await playerFacts(file)
    f = { ...f, seconds: f.seconds ?? p.seconds, width: p.width, height: p.height }
  }
  return {
    id, name: file.name, bytes: file.size, width: f.width, height: f.height, seconds: f.seconds,
    createdAt: file.lastModified ? new Date(file.lastModified).toISOString() : null, filmedAt: f.filmedAt,
  }
}

/** What has happened to one video of the batch. */
type Step =
  | { state: 'wait' }
  | { state: 'up'; file: string; pct: number }
  | { state: 'adding' }
  | { state: 'added' }
  | { state: 'failed'; why: string }
  | { state: 'skipped'; why: string }

export default function ComputerBatch({ settings, onAdded, left = null }: {
  /** The look chosen above (logo, zooms, colour...), used for every video. */
  settings: EditSettings
  onAdded: () => Promise<void>
  /** Edited videos left this month, or null for no limit. */
  left?: number | null
}) {
  const [supabase] = useState(() => createBrowserClient())
  /** The chosen files, by take id: only these are uploaded. */
  const files = useRef(new Map<string, File>())
  const [talk, setTalk] = useState<DriveTake[]>([])
  const [roll, setRoll] = useState<DriveTake[]>([])
  const [videos, setVideos] = useState<BatchVideo[] | null>(null)
  const [reading, setReading] = useState<'a' | 'b' | null>(null)
  const [problems, setProblems] = useState<{ a: string[]; b: string[] }>({ a: [], b: [] })
  const [skipped, setSkipped] = useState<{ a: string[]; b: string[] }>({ a: [], b: [] })
  const [steps, setSteps] = useState<Record<string, Step>>({})
  const [running, setRunning] = useState(false)
  const [at, setAt] = useState<number | null>(null)
  const stop = useRef(false)
  const [stopping, setStopping] = useState(false)
  const [result, setResult] = useState<{ ok: number; failed: number; words?: string } | null>(null)

  // Leaving the page while it uploads stops the uploads: the browser asks first.
  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  const pick = async (which: 'a' | 'b', list: FileList | null) => {
    const chosen = Array.from(list ?? [])
    if (!chosen.length) return
    setReading(which); setResult(null); setSteps({})
    try {
      const bad: string[] = []
      let ok: File[] = []
      for (const f of chosen) {
        if (!f.type.startsWith('video/') && !VIDEO_NAME.test(f.name)) bad.push(`${f.name}: not a video file`)
        else if (f.size > BULK_VIDEO_MAX_BYTES) bad.push(`${f.name}: ${size(f.size)} is over the ${size(BULK_VIDEO_MAX_BYTES)} limit. Film at 1080p, or keep the take shorter.`)
        else ok.push(f)
      }
      if (ok.length > MAX_PICK) {
        bad.push(`${ok.length} files chosen: MVP takes up to ${MAX_PICK} at a time, so the first ${MAX_PICK} are used.`)
        ok = ok.slice(0, MAX_PICK)
      }
      // Already in a video (the same name and size): left out, and said.
      let used = new Set<string>()
      try {
        const r = await fetch('/api/review-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'uploaded_before', files: ok.map((f) => ({ name: f.name, bytes: f.size })) }) })
        const d = await r.json().catch(() => ({})) as { used?: string[] }
        if (r.ok) used = new Set(d.used ?? [])
      } catch { /* not known: none are left out */ }
      const fresh = ok.filter((f) => !used.has(uploadKey(f.name, f.size)))
      for (const id of [...files.current.keys()]) if (id.startsWith(`${which}:`)) files.current.delete(id)
      const takes = await Promise.all(fresh.map((f, i) => {
        const id = `${which}:${i}:${f.size}:${f.name}`
        files.current.set(id, f)
        return asTake(f, id)
      }))
      const nextTalk = which === 'a' ? takes : talk
      const nextRoll = which === 'b' ? takes : roll
      if (which === 'a') setTalk(takes); else setRoll(takes)
      setProblems((p) => ({ ...p, [which]: bad }))
      setSkipped((s) => ({ ...s, [which]: ok.filter((f) => used.has(uploadKey(f.name, f.size))).map((f) => f.name) }))
      setVideos(nextTalk.length ? batchVideos(nextTalk, nextRoll) : null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'MVP could not read those files.')
    } finally { setReading(null) }
  }

  const blocked = (videos ?? []).filter(mixed).length
  const bytesOf = (v: BatchVideo) => [...v.a, ...v.b].reduce((n, f) => n + (f.bytes ?? 0), 0)
  const total = (videos ?? []).reduce((n, v) => n + bytesOf(v), 0)

  const addAll = async () => {
    if (!videos?.length || blocked || running) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Sign in again, then add the batch.'); return }
    const list = videos
    stop.current = false
    setStopping(false); setRunning(true); setResult(null)
    setSteps(Object.fromEntries(list.map((v) => [v.a[0].id, { state: 'wait' } as Step])))
    const set = (key: string, s: Step) => setSteps((m) => ({ ...m, [key]: s }))
    const room = left === null ? list.length : Math.max(0, left)
    const added = new Set<string>()
    let failed = 0
    let words: string | undefined
    for (let i = 0; i < list.length; i++) {
      const v = list[i]
      const key = v.a[0].id
      if (stop.current) {
        for (const rest of list.slice(i)) set(rest.a[0].id, { state: 'skipped', why: 'Not uploaded: you stopped the batch.' })
        words = `Stopped. ${list.length - i} not uploaded; they are still here to add.`
        break
      }
      if (i >= room) {
        for (const rest of list.slice(i)) set(rest.a[0].id, { state: 'skipped', why: 'Not uploaded: no edited videos left this month.' })
        words = `You had ${left} edited ${left === 1 ? 'video' : 'videos'} left this month, so ${list.length - i} were not uploaded.`
        break
      }
      setAt(i)
      // 1. Its files, one after another.
      const up = new Map<string, { url: string; path: string }>()
      let err: string | null = null
      for (const t of [...v.a, ...v.b]) {
        const file = files.current.get(t.id)
        if (!file) { err = `${t.name} is no longer on this page. Choose the files again.`; break }
        set(key, { state: 'up', file: t.name, pct: 0 })
        try {
          up.set(t.id, await uploadTake(supabase, user.id, file, (sent) => set(key, { state: 'up', file: t.name, pct: Math.min(99, Math.round((sent / Math.max(1, file.size)) * 100)) })))
        } catch (e) { err = `${t.name}: ${e instanceof Error ? e.message : 'the upload failed.'}`; break }
      }
      // A video that is not added keeps none of its files.
      const forget = async () => { if (up.size) await supabase.storage.from(TAKE_BUCKET).remove([...up.values()].map((u) => u.path)).catch(() => null) }
      if (err) { await forget(); set(key, { state: 'failed', why: err }); failed++; continue }
      // 2. Into the queue: it starts at once, while the next one uploads.
      set(key, { state: 'adding' })
      const take = (fs: DriveTake[]) => ({
        url: up.get(fs[0].id)!.url, name: fs[0].name, bytes: fs[0].bytes ?? undefined,
        ...(fs.length > 1 ? { more: fs.slice(1).map((f) => ({ url: up.get(f.id)!.url, name: f.name, bytes: f.bytes ?? undefined })) } : {}),
      })
      try {
        // The look on every video. A title left empty is written by MVP for
        // each video; one typed (a disclosure) is the same on all of them.
        const look = cleanSettings({ ...settings, kind: v.kind }, settings)
        const r = await fetch('/api/review-edit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add', name: v.product || v.a[0].name.replace(/\.[^.]+$/, ''), review: take(v.a), ...(v.b.length ? { broll: take(v.b) } : {}), product: v.product, settings: look }),
        })
        const d = await r.json().catch(() => ({})) as { error?: string; allowanceFull?: boolean }
        if (r.ok) {
          added.add(key)
          set(key, { state: 'added' })
          void onAdded()
        } else {
          await forget()
          set(key, { state: 'failed', why: d.error || 'Not added.' })
          failed++
          if (d.allowanceFull) {
            for (const rest of list.slice(i + 1)) set(rest.a[0].id, { state: 'skipped', why: 'Not uploaded: no edited videos left this month.' })
            words = d.error
            break
          }
        }
      } catch {
        await forget()
        set(key, { state: 'failed', why: 'Not added: MVP did not answer. Try this one again.' })
        failed++
      }
    }
    setAt(null); setRunning(false); setStopping(false)
    setResult({ ok: added.size, failed, words })
    // What was added leaves the list; what was not stays, to try again.
    if (added.size) {
      const rest = list.filter((v) => !added.has(v.a[0].id))
      setVideos(rest.length ? rest : null)
      if (!rest.length) { setTalk([]); setRoll([]); files.current.clear() }
      await onAdded()
    }
  }

  const status = (v: BatchVideo) => {
    const s = steps[v.a[0].id]
    if (!s) return null
    const line = (color: string, body: ReactNode) => <p className="text-[12.5px] mt-1.5 inline-flex items-start gap-1.5" style={{ color }}>{body}</p>
    if (s.state === 'wait') return line('var(--text-3)', 'Waiting to upload.')
    if (s.state === 'up') return line('var(--text-2)', <><Loader2 size={13} className="animate-spin mt-0.5 shrink-0" /> Uploading {s.file}: {s.pct}%</>)
    if (s.state === 'adding') return line('var(--text-2)', <><Loader2 size={13} className="animate-spin mt-0.5 shrink-0" /> Adding it to the queue.</>)
    if (s.state === 'added') return line(GREEN, <><Check size={13} className="mt-0.5 shrink-0" /> Uploaded and added. MVP is working on it.</>)
    if (s.state === 'failed') return line(AMBER, <><AlertTriangle size={13} className="mt-0.5 shrink-0" /> Not added. {s.why}</>)
    return line(AMBER, s.why)
  }

  const pickTile = (which: 'a' | 'b', label: string, hint: string) => {
    const takes = which === 'a' ? talk : roll
    const bytes = takes.reduce((n, t) => n + (t.bytes ?? 0), 0)
    return (
      <div className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }}>
        {which === 'a' ? <UploadCloud size={18} className="shrink-0" style={{ color: 'var(--accent-text)' }} /> : <Film size={18} className="shrink-0" style={{ color: 'var(--accent-text)' }} />}
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-semibold uppercase tracking-wider" style={soft}>{label}</p>
          <p className="text-[13.5px] font-semibold truncate">
            {reading === which ? <span className="font-normal inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading the files</span>
              : takes.length ? `${takes.length} ${takes.length === 1 ? 'file' : 'files'}, ${size(bytes)}`
                : <span className="font-normal" style={soft}>{hint}</span>}
          </p>
        </div>
        <label className={`text-[12.5px] font-semibold underline shrink-0 ${running || reading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`} style={{ color: 'var(--accent-text)' }}>
          {takes.length ? 'Choose again' : which === 'a' ? 'Choose talking takes' : 'Choose B-roll'}
          <input type="file" accept="video/*" multiple className="hidden" disabled={running || !!reading}
            onChange={(e) => { const l = e.target.files; void pick(which, l).finally(() => { e.target.value = '' }) }} />
        </label>
      </div>
    )
  }

  const allProblems = [...problems.a, ...problems.b]
  const allSkipped = [...skipped.a, ...skipped.b]
  const noTimes = talk.length > 0 && [...talk, ...roll].every((t) => !t.filmedAt)

  return (
    <div aria-label="A batch from this computer">
      <ol className="text-[13px] flex flex-col gap-1 list-decimal pl-5" style={{ color: 'var(--text-2)' }}>
        <li>Film one product at a time: its talking take, then its B-roll (or the B-roll first, as long as you always do it the same way).</li>
        <li>Choose all your talking takes, then all their B-roll. Pick many at once with Shift or Cmd. Any names: MVP reads when each was filmed from the file itself.</li>
        <li>Check which video each file is for. Two talking files for one video are joined into one.</li>
        <li>Press <b>Upload and add</b>, and keep this tab open while it uploads. Each video starts being edited as soon as its own files are up.</li>
      </ol>
      <div className="grid sm:grid-cols-2 gap-2 mt-3">
        {pickTile('a', 'Talking takes', 'You talking about each product')}
        {pickTile('b', 'B-roll', 'Optional')}
      </div>
      <p className="text-[12px] mt-2" style={soft}>Upright takes become TRYBE ads; sideways ones, Amazon and YouTube reviews. They use your look above. Your takes are deleted from MVP two days after each video is made.</p>

      {allSkipped.length > 0 && <p className="mt-2 text-[12.5px]" style={soft}>Left out, already in a video ({allSkipped.length}): {allSkipped.join(', ')}.</p>}
      {noTimes && <p className="mt-2 text-[12.5px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={13} className="mt-0.5 shrink-0" /> These files do not say when they were filmed, so MVP paired them by name and by when each file was saved. Check each video.</p>}
      {allProblems.length > 0 && (
        <ul className="mt-2 text-[12.5px] flex flex-col gap-0.5" style={{ color: AMBER }}>
          {allProblems.map((p) => <li key={p} className="inline-flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {p}</li>)}
        </ul>
      )}

      {videos && videos.length > 0 && (
        <div>
          <BatchCheck videos={videos} setVideos={setVideos} pool={roll} locked={running} status={status} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void addAll()} disabled={running || !!reading || blocked > 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
              {running ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
              {running && at !== null ? `Uploading video ${at + 1} of ${videos.length}` : `Upload and add all ${videos.length}`}
            </button>
            {running && (
              <button type="button" onClick={() => { stop.current = true; setStopping(true) }} disabled={stopping} className="text-[12.5px] font-semibold underline disabled:opacity-60" style={{ color: 'var(--text-2)' }}>
                {stopping ? 'Stopping after this video' : 'Stop after this video'}
              </button>
            )}
          </div>
          <p className="text-[12px] mt-1" style={blocked || (left !== null && videos.length > left) ? { color: AMBER } : soft}>
            {blocked ? `${blocked === 1 ? 'One video mixes' : `${blocked} videos mix`} upright and sideways files: fix that first.`
              : left !== null && videos.length > left ? `You have ${left} edited ${left === 1 ? 'video' : 'videos'} left this month, so only the first ${left} will be uploaded.`
                : running ? 'Keep this tab open until it finishes. Videos already added carry on if you leave.'
                  : `${size(total)} to upload. Keep this tab open while it uploads.`}
          </p>
        </div>
      )}
      {result && (
        <p className="text-[12.5px] mt-2" style={{ color: result.failed || result.words ? AMBER : GREEN }}>
          {result.ok} uploaded and added to the queue{result.failed ? `; ${result.failed} not added (each says why above)` : ''}.{result.words ? ` ${result.words}` : result.failed ? '' : ' MVP works through them in the background.'}
        </p>
      )}
    </div>
  )
}
