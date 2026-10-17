'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DROP (Labs, admin while it is tested; Seb, 2026-10-17). Drop finished
// videos, say once where each one goes, press Launch. Long videos go to
// YouTube and Amazon through a Liftoff batch built with the creator's own last
// Liftoff choices, each with a blog post that goes live after its video.
// Vertical videos go to a TRYBE brand through SCOUT 1.52.0.
//
// THE PAGE CAN CLOSE. Liftoff prepares on MVP's servers; SCOUT's background
// Liftoff tab launches the batch once it is prepared and writes the blog
// posts (lib/drop-run dropSteps). Only a TRYBE send needs this page open,
// and the board says so while it runs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, UploadCloud, X, Rocket, Film, Smartphone, AlertTriangle } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { uploadResumable, ResumableUnavailable } from '@/lib/upload-resumable'
import { uploadWithProgress } from '@/lib/upload-progress'
import { freshAccessToken, saysExpired } from '@/lib/fresh-token'
import { storageSizeRefusal, BULK_VIDEO_MAX_BYTES } from '@/lib/clip-source-limits'
import { getScoutStatus, setLiftoffAuto, requestTrybeApi, requestTrybePutFile } from '@/lib/extension-frame'
import { scoutAtLeast, SCOUT_TRYBE_SUBMIT_MIN_VERSION } from '@/lib/scout-version'
import { scheduleItems } from '@/lib/launch-schedule'
import { readBrandStats, type MyBrand } from '@/lib/trybe-mybrands'
import { dropKind, defaultDest, firstDay, startFor, planWords, DROP_MAX, type DropKind, type DropDest, type LastBatch } from '@/lib/drop-plan'
import { browserHttp, buildLiftoff, dropSteps, sendDropToTrybe, type TrybeDropItem } from '@/lib/drop-run'
import DropTrybePicker, { emptyChoice, choiceBlocker, type TrybeChoice } from '@/components/labs/DropTrybePicker'
import DropResults, { type DropView, type BatchView } from '@/components/labs/DropResults'

const TEAL = '#0EA5A4'
const LANES = 3

interface Pending {
  key: string
  file: File
  name: string
  size: number
  type: string
  duration: number
  width: number
  height: number
  kind: DropKind
  up: 'waiting' | 'uploading' | 'done' | 'failed'
  sent: number
  error?: string
  url?: string
  asin: string
  /** Where the product came from when MVP filled it, said on the card. */
  asinFrom: 'file' | 'video' | null
  productName: string | null
  title: string
  dest: DropDest
  trybe: TrybeChoice
}

/** The frame size and length, read by the browser without uploading.
 *  Zeroes mean it could not tell, and the card says so. */
function probe(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    try {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => {
        const d = Number(v.duration)
        resolve({ duration: Number.isFinite(d) ? Math.round(d) : 0, width: Number(v.videoWidth) || 0, height: Number(v.videoHeight) || 0 })
        URL.revokeObjectURL(v.src)
      }
      v.onerror = () => resolve({ duration: 0, width: 0, height: 0 })
      v.src = URL.createObjectURL(file)
    } catch { resolve({ duration: 0, width: 0, height: 0 }) }
  })
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1)} MB`
const clock = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '')
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
/** Liftoff's own "Finish in the background" switch for this browser: Drop
 *  never turns it on behind a creator who turned it off there. */
const bgAllowed = () => { try { return window.localStorage.getItem('mvp_liftoff_bg') !== 'off' } catch { return true } }
const wakeBackground = async (inMinutes?: number) => (bgAllowed() ? setLiftoffAuto(true, inMinutes) : null)

export default function DropBoard() {
  const [pending, setPending] = useState<Pending[]>([])
  const [last, setLast] = useState<(LastBatch & { created_at?: string }) | null>(null)
  const [hasBlogSite, setHasBlogSite] = useState(false)
  const [available, setAvailable] = useState(true)
  const [needs, setNeeds] = useState<string | null>(null)
  const [drops, setDrops] = useState<DropView[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [batches, setBatches] = useState<Record<string, BatchView | 'missing' | undefined>>({})
  const [scout, setScout] = useState<{ installed: boolean; version: string | null } | null>(null)
  const [bgOn, setBgOn] = useState<boolean | null>(null)
  const [brands, setBrands] = useState<MyBrand[] | null>(null)
  const [brandsError, setBrandsError] = useState<string | null>(null)
  const [startChoice, setStartChoice] = useState<'auto' | 'today' | 'tomorrow'>('auto')
  const [launching, setLaunching] = useState(false)
  const [steps, setSteps] = useState<string[]>([])
  const [sending, setSending] = useState<Record<string, string>>({})
  const [dragOver, setDragOver] = useState(false)
  const stepsRunning = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const timezone = useMemo(zone, [])
  const canTrybe = !!scout?.installed && scoutAtLeast(scout.version, SCOUT_TRYBE_SUBMIT_MIN_VERSION)

  const load = useCallback(async () => {
    const r = await browserHttp('/api/drop')
    if (!r.ok) { setLoadError(String(r.json.error || `Drop could not be read (${r.status}).`)); setDrops([]); return }
    setLoadError(null)
    setAvailable(r.json.available !== false)
    setNeeds((r.json.needs as string) || null)
    setLast((r.json.last as LastBatch) ?? null)
    setHasBlogSite(r.json.hasBlogSite === true)
    const list = (r.json.drops ?? []) as DropView[]
    setDrops(list)
    // Each drop's Liftoff batch, as Liftoff reports it.
    const next: Record<string, BatchView | 'missing'> = {}
    await Promise.all(list.filter((d) => d.batch_id).map(async (d) => {
      const b = await browserHttp(`/api/launch/batches/${d.batch_id}`)
      next[d.batch_id!] = b.ok
        ? { state: String((b.json.batch as { state?: string })?.state || ''), send_to_youtube: (b.json.batch as { send_to_youtube?: boolean })?.send_to_youtube, items: (b.json.items ?? []) as BatchView['items'] }
        : 'missing'
    }))
    setBatches(next)
  }, [])

  /** One pass of the steps this page can run: launch, then blog posts. */
  const runSteps = useCallback(async () => {
    if (stepsRunning.current) return
    stepsRunning.current = true
    try {
      const out = await dropSteps(browserHttp)
      if (out.launched) {
        toast.success(`Liftoff launched ${out.launched === 1 ? 'a drop' : `${out.launched} drops`}. SCOUT uploads to YouTube next.`)
        void wakeBackground(1).then((st) => setBgOn(!!st?.on))
      }
      if (out.blogs) toast.success(`${out.blogs} blog post${out.blogs === 1 ? '' : 's'} written and scheduled after ${out.blogs === 1 ? 'its video' : 'their videos'}.`)
      if (out.notes.length) toast.error(out.notes[0], { duration: 12000 })
    } finally {
      stepsRunning.current = false
      void load()
    }
  }, [load])

  useEffect(() => {
    void load().then(() => runSteps())
    getScoutStatus().then((st) => {
      setScout(st)
      if (!st.installed) return
      void wakeBackground().then((s) => setBgOn(s ? !!s.on : false))
      if (scoutAtLeast(st.version, SCOUT_TRYBE_SUBMIT_MIN_VERSION)) {
        requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all').then((r) => {
          if (!r.ok) { setBrandsError(`TRYBE did not answer${r.status ? ` (${r.status})` : ''}. Sign in to TRYBE in this Chrome, then reload.`); return }
          setBrands(readBrandStats(r.json))
        }).catch((e) => setBrandsError(e instanceof Error ? e.message : 'SCOUT did not answer.'))
      }
    }).catch(() => setScout({ installed: false, version: null }))
  }, [load, runSteps])

  // While a drop is still on its way, look again every 30 seconds.
  const open = (drops ?? []).some((d) => !['done', 'failed'].includes(d.state) || d.items.some((i) => i.blog_state === 'writing' || i.trybe_state === 'sending'))
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => void runSteps(), 30_000)
    return () => clearInterval(t)
  }, [open, runSteps])

  // Leaving while a file is going up or a TRYBE send runs loses it: said.
  const busy = launching || pending.some((p) => p.up === 'uploading') || Object.keys(sending).length > 0
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const mark = (key: string, patch: Partial<Pending>) => setPending((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)))

  async function addFiles(files: FileList | File[] | null) {
    if (!files) return
    const room = DROP_MAX - pending.length
    const picked = Array.from(files).filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name))
    if (picked.length < Array.from(files).length) toast.error('Only video files can be dropped.')
    if (picked.length > room) toast(`Taking the first ${Math.max(0, room)}. A drop holds ${DROP_MAX}.`, { duration: 7000 })
    const take = picked.slice(0, Math.max(0, room))
    if (take.length === 0) return
    const supabase = createBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Not signed in.'); return }

    const rows: Pending[] = []
    for (const [i, file] of take.entries()) {
      const p = await probe(file)
      const kind = dropKind(p.width, p.height)
      rows.push({
        key: `${Date.now()}-${i}-${file.name}`, file, name: file.name, size: file.size, type: file.type || 'video/mp4',
        duration: p.duration, width: p.width, height: p.height, kind, up: 'waiting', sent: 0,
        asin: '', asinFrom: null, productName: null, title: '',
        dest: { ...defaultDest(kind, hasBlogSite), trybe: kind === 'vertical' && canTrybe }, trybe: emptyChoice(),
      })
    }
    setPending((list) => [...list, ...rows])

    // The product, from what MVP already knows about the file's name.
    for (const r of rows) {
      if (r.kind !== 'long') continue
      browserHttp(`/api/clip-factory/product-guess?file=${encodeURIComponent(r.name)}`).then((g) => {
        const product = String(g.json.product || '')
        if (!g.ok || !product) return
        setPending((list) => list.map((p) => (p.key === r.key && !p.asin ? { ...p, asin: product, asinFrom: (g.json.from === 'video' ? 'video' : 'file'), productName: (g.json.productName as string) || null } : p)))
      })
    }

    // Three at a time, each with its own bar.
    const upOne = async (r: Pending) => {
      if (r.size > BULK_VIDEO_MAX_BYTES) { mark(r.key, { up: 'failed', error: `${mb(r.size)} is over the ${mb(BULK_VIDEO_MAX_BYTES)} limit.` }); return }
      const ext = r.name.split('.').pop()?.toLowerCase() || 'mp4'
      let path = `${user.id}/drop-${crypto.randomUUID()}.${ext}`
      mark(r.key, { up: 'uploading', sent: 0, error: undefined })
      try {
        try {
          await uploadResumable({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            getAccessToken: (force) => freshAccessToken(supabase, force),
            bucket: 'instagram-videos', path, file: r.file, contentType: r.type,
            onProgress: ({ sent }) => mark(r.key, { sent }),
          })
        } catch (e) {
          if (!(e instanceof ResumableUnavailable)) throw e
          path = `${user.id}/drop-${crypto.randomUUID()}.${ext}`
          const token = await freshAccessToken(supabase, true)
          if (!token) throw new Error('Signed out during the upload. Sign in again and drop this one again.')
          await uploadWithProgress({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, accessToken: token,
            bucket: 'instagram-videos', path, file: r.file, contentType: r.type,
            onProgress: ({ sent }) => mark(r.key, { sent }),
          })
        }
        const { data } = supabase.storage.from('instagram-videos').getPublicUrl(path)
        mark(r.key, { up: 'done', sent: r.size, url: data.publicUrl })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'The upload failed.'
        mark(r.key, { up: 'failed', error: storageSizeRefusal(msg, r.size) || (saysExpired(msg) ? 'Your sign-in ran out during the upload. Refresh the page and drop this one again.' : msg) })
      }
    }
    let next = 0
    await Promise.all(Array.from({ length: Math.min(LANES, rows.length) }, async () => {
      while (next < rows.length) await upOne(rows[next++])
    }))
  }

  // ── the plan ───────────────────────────────────────────────────────────────
  const longs = pending.filter((p) => p.kind === 'long' && p.dest.liftoff)
  const verticals = pending.filter((p) => p.dest.trybe)
  const auto = firstDay(last?.daily_slots, timezone)
  const start = startFor(startChoice, last?.daily_slots, timezone)
  const planned = useMemo(() => scheduleItems(longs.map((p) => ({ id: p.key })), { timezone, slots: last?.daily_slots ?? [], startOn: start.startOn }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [longs.map((p) => p.key).join(','), last?.daily_slots?.join(','), start.startOn, timezone])
  const words = planWords(last)
  const toYouTube = last?.send_to_youtube !== false

  const blocker = (() => {
    if (!available) return needs || 'Drop needs migration 436 first.'
    if (pending.length === 0) return 'Drop your videos first.'
    if (pending.some((p) => p.up === 'uploading' || p.up === 'waiting')) return 'Wait for the uploads to finish.'
    const ok = pending.filter((p) => p.up === 'done')
    if (ok.length === 0) return 'None of the videos uploaded. Remove them and drop them again.'
    if (!ok.some((p) => p.dest.liftoff || p.dest.trybe)) return 'Tick at least one place for a video.'
    const noProduct = ok.filter((p) => p.dest.liftoff && !p.asin.trim())
    if (noProduct.length) return `Add the product for ${noProduct.map((p) => p.name).join(', ')}.`
    const t = ok.find((p) => p.dest.trybe && choiceBlocker(p.trybe))
    if (t) return `${t.name}: ${choiceBlocker(t.trybe)}.`
    if (ok.some((p) => p.dest.trybe) && !canTrybe) return `Sending to TRYBE needs SCOUT ${SCOUT_TRYBE_SUBMIT_MIN_VERSION} in this Chrome.`
    return null
  })()

  async function launch() {
    if (blocker) return
    setLaunching(true)
    setSteps([])
    const say = (t: string) => setSteps((s) => [...s.slice(-12), t])
    try {
      const ok = pending.filter((p) => p.up === 'done' && p.url && (p.dest.liftoff || p.dest.trybe))
      const name = `Drop ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
      say('Saving the drop')
      const made = await browserHttp('/api/drop', { method: 'POST', body: { action: 'create', name, items: ok.map((p) => ({
        fileName: p.name, sourceUrl: p.url, mimeType: p.type, sizeBytes: p.size, durationSeconds: p.duration, width: p.width, height: p.height,
        kind: p.kind, asin: p.asin.trim(), title: p.title.trim(), toLiftoff: p.dest.liftoff, toBlog: p.dest.blog, toTrybe: p.dest.trybe,
        trybe: p.dest.trybe ? p.trybe : undefined,
      })) } })
      if (!made.ok) { toast.error(String(made.json.error || 'The drop was not saved.')); return }
      const dropId = String(made.json.id)
      const ids = (made.json.items ?? []) as Array<{ id: string; position: number }>
      const idOf = (p: Pending) => ids.find((x) => x.position === ok.indexOf(p))?.id ?? ''

      // Long videos: one Liftoff batch with the creator's last choices.
      const long = ok.filter((p) => p.dest.liftoff)
      if (long.length) {
        const built = await buildLiftoff({
          dropId, name, timezone, startOn: start.startOn, last,
          videos: long.map((p) => ({ id: idOf(p), sourceUrl: p.url!, fileName: p.name, title: p.title, asin: p.asin, durationSeconds: p.duration })),
        }, browserHttp, say)
        if (built.state === 'failed') toast.error(built.problems[0] || 'Liftoff did not take the videos.', { duration: 14000 })
        else if (built.problems.length) toast(`${built.added} video${built.added === 1 ? '' : 's'} in Liftoff. ${built.problems.length} thing${built.problems.length === 1 ? '' : 's'} to check on the board.`, { duration: 10000 })
        else toast.success(`${built.added} video${built.added === 1 ? '' : 's'} in Liftoff. It launches on its own once they are prepared.`)
        void wakeBackground(1).then((st) => setBgOn(!!st?.on))
      }
      setPending([])
      await load()

      // Vertical videos: each to its TRYBE brand, one at a time, here.
      for (const p of ok.filter((x) => x.dest.trybe)) {
        const id = idOf(p)
        if (id) await sendOne({
          id, source_url: p.url!, file_name: p.name, mime_type: p.type, size_bytes: p.size,
          trybe_brand_id: p.trybe.brandId, trybe_program_id: p.trybe.programId, trybe_angle_id: p.trybe.angleId,
          trybe_product_ids: p.trybe.productIds, trybe_exclusive: p.trybe.exclusive, trybe_notes: p.trybe.notes,
        }, p.trybe.brandName)
      }
      void runSteps()
    } finally { setLaunching(false) }
  }

  async function sendOne(it: TrybeDropItem, brandName: string, again = false) {
    setSending((s) => ({ ...s, [it.id]: `Sending to ${brandName}` }))
    try {
      const res = await sendDropToTrybe(it, browserHttp, {
        api: requestTrybeApi, put: requestTrybePutFile,
        onStep: (t, done, total) => setSending((s) => ({ ...s, [it.id]: total && total > 1 ? `${t} (${done ?? 0} of ${total})` : t })),
      }, again)
      if (!res) toast('That video is already being sent from another tab.')
      else if (res.state === 'in_review') toast.success(`In ${brandName}'s review on TRYBE.`)
      else if (res.state === 'sent_unconfirmed') toast(`TRYBE took it, but it is not in your ${brandName} submissions yet. Check TRYBE before sending again.`, { duration: 12000 })
      else toast.error(`Not sent to ${brandName}: ${res.error || 'TRYBE did not take it.'}`, { duration: 14000 })
    } finally {
      setSending((s) => { const n = { ...s }; delete n[it.id]; return n })
      void load()
    }
  }

  async function blogAgain(itemId: string) {
    const r = await browserHttp('/api/drop', { method: 'POST', body: { action: 'blog_again', itemId } })
    if (!r.ok || !r.json.queued) { toast.error(String(r.json.error || 'It is still being written. Give it a few minutes.')); return }
    toast('Writing it again on the next pass.')
    void runSteps()
  }

  async function trybeAgain(itemId: string) {
    const d = (drops ?? []).find((x) => x.items.some((i) => i.id === itemId))
    const it = d?.items.find((i) => i.id === itemId) as unknown as (TrybeDropItem & { trybe_brand_name: string | null; trybe_state: string }) | undefined
    if (!it) return
    if (it.trybe_state === 'sent_unconfirmed' && !window.confirm('TRYBE took this video before. Check your TRYBE submissions first: sending again can make a second submission. Send again?')) return
    await sendOne(it, it.trybe_brand_name || 'the brand', it.trybe_state !== 'wanted')
  }

  async function removeDrop(dropId: string) {
    if (!window.confirm('Remove this drop from the list? What it sent stays where it went: the Liftoff batch, blog posts and TRYBE submissions are not touched.')) return
    const r = await browserHttp('/api/drop', { method: 'POST', body: { action: 'delete', dropId } })
    if (!r.ok) toast.error(String(r.json.error || 'Not removed.'))
    void load()
  }

  // ── render ─────────────────────────────────────────────────────────────────
  const card = 'rounded-2xl border p-4 flex flex-col gap-3'
  const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      {loadError && <p className="rounded-lg px-3 py-2 text-[12.5px] text-red-700 bg-red-500/10 dark:text-red-300 dark:bg-red-400/15">{loadError}</p>}
      {!available && (
        <p className="rounded-lg px-3 py-2 text-[12.5px] flex items-start gap-2 text-amber-700 bg-amber-500/15 dark:text-amber-300 dark:bg-amber-400/15">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {needs || 'Drop needs migration 436 in the database first.'}
        </p>
      )}

      {/* ── 1. the drop zone ─────────────────────────────────────────────── */}
      <section
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files) }}
        className="rounded-2xl border-2 border-dashed px-5 py-8 flex flex-col items-center gap-2 text-center"
        style={{ borderColor: dragOver ? TEAL : 'var(--border-2)', background: dragOver ? 'rgba(14,165,164,0.06)' : 'var(--surface)' }}>
        <UploadCloud size={26} style={{ color: TEAL }} />
        <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Drop your finished videos here</p>
        <p className="text-[12.5px] max-w-md" style={{ color: 'var(--text-2)' }}>
          Long videos go to YouTube, Amazon and your blog. Vertical videos go to a TRYBE brand. Up to {DROP_MAX} at a time.
        </p>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={pending.length >= DROP_MAX}
          className="mt-1 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ background: TEAL }}>
          Choose videos
        </button>
        <input ref={inputRef} type="file" accept="video/*" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
      </section>

      {/* ── 2. each video ────────────────────────────────────────────────── */}
      {pending.length > 0 && (
        <section className="flex flex-col gap-3">
          {pending.map((p) => {
            const at = planned.get(p.key)
            const pct = p.size ? Math.round((p.sent / p.size) * 100) : 0
            return (
              <article key={p.key} className={card} style={cardStyle}>
                <header className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 rounded-lg p-1.5" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                    {p.kind === 'vertical' ? <Smartphone size={15} /> : <Film size={15} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }} title={p.name}>{p.name}</p>
                    <p className="text-[11.5px] tabular-nums" style={{ color: 'var(--text-2)' }}>
                      {p.kind === 'vertical' ? 'Vertical' : 'Long'}{p.width && p.height ? ` · ${p.width}×${p.height}` : ' · frame size not read, treated as long'}
                      {p.duration ? ` · ${clock(p.duration)}` : ''} · {mb(p.size)}
                    </p>
                  </div>
                  <button type="button" aria-label={`Remove ${p.name}`} disabled={launching}
                    onClick={() => setPending((list) => list.filter((x) => x.key !== p.key))}
                    className="rounded-lg p-1" style={{ color: 'var(--text-2)' }}><X size={15} /></button>
                </header>

                {p.up !== 'done' && (
                  <div className="flex flex-col gap-1">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div className="h-full rounded-full transition-[width]" style={{ width: `${p.up === 'failed' ? 100 : pct}%`, background: p.up === 'failed' ? '#EF4444' : TEAL }} />
                    </div>
                    <p className={`text-[11.5px] tabular-nums ${p.up === 'failed' ? 'text-red-700 dark:text-red-300' : ''}`} style={p.up === 'failed' ? undefined : { color: 'var(--text-2)' }}>
                      {p.up === 'failed' ? `Not uploaded: ${p.error}` : p.up === 'waiting' ? 'Waiting to upload' : `Uploading ${pct}% · ${mb(p.sent)} of ${mb(p.size)}`}
                    </p>
                  </div>
                )}

                {/* Where it goes. */}
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Where this video goes">
                  {p.kind === 'long' ? (
                    <>
                      <Chip on={p.dest.liftoff} onClick={() => mark(p.key, { dest: { ...p.dest, liftoff: !p.dest.liftoff, blog: !p.dest.liftoff ? p.dest.blog : false } })}
                        label={toYouTube ? 'YouTube and Amazon' : 'Amazon'} />
                      <Chip on={p.dest.blog} disabled={!p.dest.liftoff || !hasBlogSite} onClick={() => mark(p.key, { dest: { ...p.dest, blog: !p.dest.blog } })}
                        label="Blog post" hint={!hasBlogSite ? 'Connect a blog site first' : !p.dest.liftoff ? 'Written from the YouTube video' : undefined} />
                    </>
                  ) : (
                    <Chip on={p.dest.trybe} disabled={!canTrybe} onClick={() => mark(p.key, { dest: { ...p.dest, trybe: !p.dest.trybe } })}
                      label="TRYBE brand" hint={!canTrybe ? `Needs SCOUT ${SCOUT_TRYBE_SUBMIT_MIN_VERSION}${scout?.version ? ` (this Chrome has ${scout.version})` : ''}` : undefined} />
                  )}
                </div>

                {p.kind === 'long' && p.dest.liftoff && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-[11.5px] font-semibold" style={{ color: 'var(--text-2)' }}>
                      Product (ASIN or Amazon link)
                      <input value={p.asin} onChange={(e) => mark(p.key, { asin: e.target.value, asinFrom: null, productName: null })}
                        className="rounded-lg border px-2.5 py-1.5 text-[12.5px] bg-transparent font-normal" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} placeholder="B0..." />
                      {p.asinFrom && <span className="font-normal" style={{ color: 'var(--text-2)' }}>Filled from {p.asinFrom === 'file' ? 'the file name' : 'an earlier video'}{p.productName ? `: ${p.productName}` : ''}. Check it.</span>}
                    </label>
                    <label className="flex flex-col gap-1 text-[11.5px] font-semibold" style={{ color: 'var(--text-2)' }}>
                      YouTube title (optional)
                      <input value={p.title} maxLength={100} onChange={(e) => mark(p.key, { title: e.target.value })}
                        className="rounded-lg border px-2.5 py-1.5 text-[12.5px] bg-transparent font-normal" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} placeholder="Empty: Liftoff writes one from the product" />
                    </label>
                    {toYouTube && at && (
                      <p className="sm:col-span-2 text-[11.5px]" style={{ color: 'var(--text-2)' }}>
                        Planned for YouTube: {at.at.toLocaleString('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        {p.dest.blog ? ', with its blog post ten minutes after it is public.' : '.'}
                      </p>
                    )}
                  </div>
                )}

                {p.kind === 'vertical' && p.dest.trybe && canTrybe && (
                  <DropTrybePicker brands={brands} brandsError={brandsError} value={p.trybe} onChange={(c) => mark(p.key, { trybe: c })} />
                )}
                {p.kind === 'vertical' && !p.dest.trybe && (
                  <p className="text-[11.5px]" style={{ color: 'var(--text-2)' }}>
                    Vertical videos are not sent to YouTube or Amazon from here. Use <Link href="/clip-factory" className="underline">Clip Factory</Link> for Shorts.
                  </p>
                )}
              </article>
            )
          })}
        </section>
      )}

      {/* ── 3. the plan and the one button ───────────────────────────────── */}
      {pending.length > 0 && (
        <section className={card} style={cardStyle}>
          <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>When you press Launch</h2>
          {longs.length > 0 && (
            <div className="flex flex-col gap-1.5 text-[12.5px]" style={{ color: 'var(--text)' }}>
              <p className="font-semibold">{longs.length} long video{longs.length === 1 ? ' goes' : 's go'} into one Liftoff batch{last ? ', with your last Liftoff choices:' : '.'}</p>
              {words.lines.length > 0 && (
                <ul className="list-disc pl-5" style={{ color: 'var(--text-2)' }}>{words.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              )}
              {words.missing.length > 0 && (
                <p className="rounded-lg px-3 py-2 text-amber-700 bg-amber-500/15 dark:text-amber-300 dark:bg-amber-400/15">
                  {last ? 'Not set on your last batch' : 'You have not launched a Liftoff batch yet'}, so Liftoff will ask for {words.missing.join(', ')} before it launches. The board below links to it.
                </p>
              )}
              {toYouTube && (
                <label className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 min-w-0" style={{ color: 'var(--text-2)' }}>
                  First day on YouTube
                  <select value={startChoice} onChange={(e) => setStartChoice(e.target.value as typeof startChoice)}
                    className="w-full sm:w-auto max-w-full min-w-0 rounded-lg border px-2 py-1 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                    <option value="auto">{auto.today ? 'Today (the first time is still ahead)' : 'Tomorrow (today’s first time is too close)'}</option>
                    <option value="today">Today, even if a time has passed</option>
                    <option value="tomorrow">Tomorrow</option>
                  </select>
                </label>
              )}
              {toYouTube && startChoice === 'today' && !auto.today && (
                <p className="text-amber-700 dark:text-amber-300">A time that has already passed today means the first video goes public as soon as it is on YouTube.</p>
              )}
              <p style={{ color: 'var(--text-2)' }}>
                Liftoff prepares them on MVP&apos;s servers and launches on its own once they are ready.
                {bgOn ? ' You can close this page: SCOUT finishes it in a background tab.' : scout?.installed ? ' Keep this page open, or turn on Finish in the background in Liftoff, so SCOUT can launch it.' : ' SCOUT is not in this Chrome, so keep this page open until it says launched.'}
              </p>
            </div>
          )}
          {verticals.length > 0 && (
            <p className="text-[12.5px]" style={{ color: 'var(--text)' }}>
              <span className="font-semibold">{verticals.length} vertical video{verticals.length === 1 ? ' goes' : 's go'} to TRYBE</span>
              <span style={{ color: 'var(--text-2)' }}> through SCOUT, one at a time, right after Launch. Keep this page open until each one says it is in review.</span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="button" onClick={() => void launch()} disabled={!!blocker || launching}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: TEAL }}>
              {launching ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} Launch
            </button>
            {blocker && !launching && <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>{blocker}</span>}
          </div>
          {steps.length > 0 && (
            <ol className="text-[11.5px] flex flex-col gap-0.5 tabular-nums" style={{ color: 'var(--text-2)' }}>
              {steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          )}
        </section>
      )}

      {/* ── 4. what happened ─────────────────────────────────────────────── */}
      {drops === null ? (
        <p className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--text-2)' }}><Loader2 size={13} className="animate-spin" /> Reading your drops</p>
      ) : (
        <DropResults drops={drops} batches={batches} sending={sending} canSendTrybe={canTrybe}
          onBlogAgain={(id) => void blogAgain(id)} onTrybeAgain={(id) => void trybeAgain(id)} onRemove={(id) => void removeDrop(id)} />
      )}
    </div>
  )
}

function Chip({ on, label, onClick, disabled, hint }: { on: boolean; label: string; onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick} title={hint}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold disabled:opacity-50 ${on && !disabled ? 'text-cyan-700 dark:text-cyan-300' : ''}`}
      style={{ borderColor: on && !disabled ? TEAL : 'var(--border)', background: on && !disabled ? 'rgba(14,165,164,0.12)' : 'transparent', ...(on && !disabled ? {} : { color: 'var(--text-2)' }) }}>
      <span aria-hidden className="w-3 h-3 rounded-full border flex items-center justify-center" style={{ borderColor: on && !disabled ? TEAL : 'var(--border-2)' }}>
        {on && !disabled && <span className="w-1.5 h-1.5 rounded-full" style={{ background: TEAL }} />}
      </span>
      {label}{hint && disabled ? <span className="font-normal">· {hint}</span> : null}
    </button>
  )
}
