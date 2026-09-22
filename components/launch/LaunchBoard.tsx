// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Ten videos, set up together, launched once.
//
// THE PAGE LEADS. Five numbered steps, exactly one of them open, and the open
// one is whichever the server says is first incomplete. A creator should never
// have to work out what to do next: the step that is their turn is the one that
// is expanded, tinted and labelled "Do this next".
//
// EVERY STATE COMES FROM THE SERVER. `steps`, `launchBlocker` and every item
// state are computed in lib/launch-batch and read here. This screen does not
// decide whether anything is done, because a screen that decides for itself can
// tick a step the worker will refuse, which is the failure this whole codebase
// keeps producing in different costumes.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import {
  Loader2, Plus, Trash2, Upload, Rocket, Clock, X, Check, AlertTriangle, LogIn, Wand2, ChevronUp, ChevronDown,
} from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { deliverPreparedStorefronts, deliverySummary } from '@/lib/storefront-delivery'
import { MARKETS } from '@/lib/markets'
import { cadenceLabel, planSchedule } from '@/lib/launch-schedule'
import { itemStateLabel, itemStateTone, prepEta, type CtaPreset, type StepStatus, type ItemRow } from '@/lib/launch-batch'
import { requestStorefrontPreflight } from '@/lib/extension-frame'
import StepCard from './StepCard'
import CtaPicker from './CtaPicker'
import ThumbnailPicker from './ThumbnailPicker'
import type { ThumbnailPreset } from '@/lib/thumbnail-preset'

const text = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

interface Item {
  id: string
  position: number
  source_url: string | null
  rendered_url: string | null
  asin: string | null
  title: string | null
  description: string | null
  thumbnail_url: string | null
  /** 'styled' (the batch look applied) or 'plain' (it did not). */
  thumbnail_source: string | null
  /** Attempts so far, so a screen can tell working from stuck. */
  render_tries: number | null
  thumb_tries: number | null
  updated_at: string | null
  state: string
  reason: string | null
  publish_at: string | null
  youtube_video_id: string | null
}
interface Market { domain: string; country: string; langName: string | null; needsDub: boolean }
/** A batch in the switcher: enough to choose between them, nothing more. */
interface BatchSummary {
  id: string; name: string; state: string; videos: number
  start_on: string | null; created_at: string
}
interface Batch {
  id: string; name: string; state: string
  cta: CtaPreset | null; cta_chosen: boolean | null
  thumbnail: ThumbnailPreset | null; thumbnail_chosen: boolean | null
  markets: Market[]
  daily_slots: string[]; start_on: string | null; timezone: string
}

const TONE: Record<string, string> = {
  good: '#10B981', busy: '#0EA5A4', warn: '#d97706', idle: 'var(--text-2)',
}

/** Tomorrow in the creator's own zone, which is the earliest sensible first day:
 *  a batch still has to upload before it can publish. */
/** Today in the creator's own zone, which is the earliest first day.
 *
 *  IT USED TO BE TOMORROW, and that made the feature wait a day for no reason:
 *  finish a batch at nine in the morning and the earliest anything could go out
 *  was the next one. A time that has already gone today means now. */
function earliestDay(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export default function LaunchBoard() {
  const [batchId, setBatchId] = useState<string | null>(null)
  const [batch, setBatch] = useState<Batch | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [steps, setSteps] = useState<StepStatus[]>([])
  const [blocker, setBlocker] = useState<string | null>(null)
  const [maxItems, setMaxItems] = useState(10)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  /**
   * THE PAGE OPENS THE RIGHT STEP ONCE, AND THEN LEAVES IT ALONE.
   *
   * It used to re-open whatever the server called current after every save,
   * which is fine in theory and awful in practice: the countries step is a
   * multi-select, so ticking France completed it, the reload decided the
   * current step was now the products one, and the box the creator was working
   * in folded shut under their hand. Every save became a navigation.
   *
   * So the auto-open happens on the first load and never again. After that the
   * open step is the creator's choice alone, and the one they should do next is
   * still marked "Do this next" for them to click when they are ready.
   */
  const autoOpened = useRef(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState(0)
  const [signin, setSignin] = useState<Record<string, string>>({})
  // ROOM LEFT TODAY, per storefront, from the same counting the upload queue
  // enforces. Reported while the creator is still choosing countries rather
  // than only at the moment an upload is refused.
  const [room, setRoom] = useState<Record<string, number>>({})
  // EVERY BATCH, not just the open one. The page used to find the first
  // unlaunched batch and show that, so the moment one finished it vanished:
  // ten videos scheduled over ten days and no record of them on the page that
  // scheduled them.
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [launched, setLaunched] = useState<{ scheduled: number; firstAt: string | null; lastAt: string | null; note: string } | null>(null)

  // ── load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/launch/batches/${id}`)
      const j = await r.json()
      if (!r.ok || !j?.ok) { setError(j?.error || 'Could not load this batch.'); return }
      setError(null)
      setBatch(j.batch)
      setItems(j.items ?? [])
      setSteps(j.steps ?? [])
      setBlocker(j.launchBlocker ?? null)
      setMaxItems(j.maxItems ?? 10)
      // ONCE. See autoOpened: after this the creator drives.
      if (!autoOpened.current) {
        const current = (j.steps ?? []).find((s: StepStatus) => s.current)
        if (current) { setOpen(current.id); autoOpened.current = true }
      }
    } catch {
      setError('Could not reach the server.')
    } finally { setLoading(false) }
  }, [])

  // Find or start a batch on first paint, so the page is never an empty screen
  // with a button on it.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/launch/batches')
        const j = await r.json()
        if (!r.ok) { setError(j?.error || 'Could not read your batches.'); setLoading(false); return }
        const all = (j.batches ?? []) as BatchSummary[]
        setBatches(all)
        // The one still being worked on, or failing that the most recent, so a
        // finished batch is still what you see when you come back to the page.
        const openBatch = all.find((b) => b.state !== 'launched') ?? all[0]
        if (openBatch) { setBatchId(openBatch.id); void load(openBatch.id); return }
        setLoading(false)
      } catch { setError('Could not reach the server.'); setLoading(false) }
    })()
  }, [load])

  // THE WORK HAPPENS ELSEWHERE, so the page watches rather than drives. Slow
  // enough not to hammer the API, fast enough that a finished render shows up
  // while the creator is still looking at the screen.
  useEffect(() => {
    if (!batchId) return
    const t = setInterval(() => void load(batchId), 12_000)
    return () => clearInterval(t)
  }, [batchId, load])

  /** The switcher's own list, re-read whenever it could have changed. */
  async function refreshBatches() {
    try {
      const r = await fetch('/api/launch/batches')
      const j = await r.json()
      if (r.ok && Array.isArray(j?.batches)) setBatches(j.batches as BatchSummary[])
    } catch { /* the current batch still works without the list */ }
  }

  function openBatch(id: string) {
    if (id === batchId) return
    // A DIFFERENT BATCH IS A DIFFERENT PAGE, so it gets to point at its own
    // current step rather than inheriting whichever one was open here.
    autoOpened.current = false
    setBatchId(id)
    void load(id)
  }

  async function startBatch() {
    setBusy('new')
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const r = await fetch('/api/launch/batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // THEIR OWN ZONE, from their own browser. Everything about when a video
        // goes public depends on it.
        body: JSON.stringify({ timezone: tz }),
      })
      const j = await r.json()
      if (!r.ok || !j?.ok) { toast.error(j?.error || 'Could not start a batch.'); return }
      setBatchId(j.id)
      // A NEW BATCH IS A NEW PAGE, so it may point at step one.
      autoOpened.current = false
      await refreshBatches()
      await load(j.id)
    } finally { setBusy(null) }
  }

  // Refreshed whenever the board is, so a batch launched in another tab does
  // not leave this number describing an hour ago.
  useEffect(() => {
    let cancelled = false
    const pull = async () => {
      try {
        const d = await fetch('/api/global-sync/daily-room').then(r => r.json()).catch(() => ({}))
        if (cancelled || !Array.isArray(d?.dailyRoom)) return
        const next: Record<string, number> = {}
        for (const r of d.dailyRoom as Array<{ domain: string; left: number }>) next[r.domain] = r.left
        setRoom(next)
      } catch { /* the countries still tick without it */ }
    }
    void pull()
    const t = setInterval(pull, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  // THE SAME DELIVERY THE STOREFRONT BOARD USES, not a copy. The dub check and
  // the daily cap live in lib/storefront-delivery, because two uploaders agree
  // only until one of them learns something.
  async function uploadToAmazon() {
    setBusy('amazon')
    try {
      const out = await deliverPreparedStorefronts()
      const lines = deliverySummary(out)
      if (out.error) { toast.error(lines.join(' '), { duration: 12000 }); return }
      if (out.nothingReady) { toast(lines.join(' '), { duration: 9000 }); return }
      toast.success(lines[0])
      for (const l of lines.slice(1)) toast(l, { duration: 12000 })
      await load(batchId!)
    } catch {
      toast.error('Could not reach SCOUT. Is the extension installed?', { duration: 9000 })
    } finally { setBusy(null) }
  }

  async function moveItem(id: string, direction: 'up' | 'down') {
    setBusy('batch')
    try {
      const r = await fetch(`/api/launch/items/${id}/move`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not move that one.'); return }
      await load(batchId!)
    } finally { setBusy(null) }
  }

  async function retryItem(id: string) {
    setBusy('batch')
    try {
      const r = await fetch(`/api/launch/items/${id}/retry`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not try that again.'); return }
      toast.success(j.message || 'Trying again.')
      await load(batchId!)
    } finally { setBusy(null) }
  }

  async function patchBatch(body: Record<string, unknown>) {
    if (!batchId) return
    setBusy('batch')
    try {
      const r = await fetch(`/api/launch/batches/${batchId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not save that.'); return }
      // WHAT WAS REFUSED, SAID OUT LOUD. The save succeeds with the bad field
      // dropped, so without this a creator picks a look, sees a green tick, and
      // gets ten thumbnails that never used it.
      if (Array.isArray(j?.rejected) && j.rejected.length > 0) {
        toast(j.rejected.join(' '), { duration: 10000 })
      }
      // NOT autoOpened = false. Saving is not navigating: resetting it here is
      // what folded the countries step shut on the first country ticked.
      await load(batchId)
    } finally { setBusy(null) }
  }

  // ── videos ────────────────────────────────────────────────────────────────
  async function addFiles(files: FileList | null) {
    if (!files || !batchId) return
    const room = maxItems - items.length
    const picked = Array.from(files).slice(0, Math.max(0, room))
    if (picked.length === 0) {
      toast.error(`A batch holds ${maxItems} videos. Launch this one, or start another.`)
      return
    }
    if (files.length > picked.length) {
      // SAID, not silently trimmed. Dropping twelve files and getting ten with
      // no explanation is how somebody launches without two of their videos.
      toast(`Taking the first ${picked.length}. A batch holds ${maxItems}.`, { duration: 7000 })
    }
    const supabase = createBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Not signed in.'); return }

    setUploading(picked.length)
    for (const file of picked) {
      try {
        if (!file.type.startsWith('video/')) { toast.error(`${file.name} is not a video.`); continue }
        if (file.size > 500 * 1024 * 1024) {
          toast.error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(0)}MB. Keep them under 500MB.`)
          continue
        }
        const probed = await probeVideo(file)
        // THE SAME RULE AS VIDEO LAUNCHPAD. That path refuses vertical and
        // points at Clip Factory; a batch that quietly accepted it would burn a
        // CTA positioned against a 16:9 preview onto a 9:16 frame, and the
        // creator would find out ten renders later.
        if (probed.width > 0 && probed.height > 0 && probed.height > probed.width) {
          toast.error(`${file.name} looks vertical. This path is for horizontal videos, so use Clip Factory for Shorts.`)
          continue
        }
        const durationSec = probed.duration
        const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
        const path = `${user.id}/batch-${crypto.randomUUID()}.${ext}`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: upErr } = await (supabase.storage as any)
          .from('instagram-videos')
          .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'video/mp4' })
        if (upErr) throw new Error(upErr.message || 'Upload failed')
        const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
        const r = await fetch(`/api/launch/batches/${batchId}/items`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceUrl: urlData.publicUrl,
            title: file.name.replace(/\.[^.]+$/, ''),
            durationSeconds: durationSec,
          }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j?.error || 'Could not add that video.')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not add ${file.name}.`)
      } finally {
        setUploading((n) => Math.max(0, n - 1))
      }
    }
    await load(batchId)
  }

  async function removeItem(id: string) {
    setBusy(id)
    try {
      const r = await fetch(`/api/launch/items/${id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not remove that.'); return }
      if (batchId) await load(batchId)
    } finally { setBusy(null) }
  }

  async function patchItem(id: string, body: Record<string, unknown>) {
    setBusy(id)
    try {
      const r = await fetch(`/api/launch/items/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not save that.'); return }
      if (j?.resolvedFromLink) toast.success(`Found ${j.resolvedFromLink} behind that link.`)
      if (batchId) await load(batchId)
    } finally { setBusy(null) }
  }

  // ── countries ─────────────────────────────────────────────────────────────
  async function checkSignin(domains: string[]) {
    if (domains.length === 0) return
    setBusy('signin')
    try {
      const res = await requestStorefrontPreflight(domains)
      if (!res?.ok || !Array.isArray(res.results)) {
        toast.error(res?.error || 'SCOUT could not check your stores. Is the extension installed?')
        return
      }
      const next: Record<string, string> = {}
      for (const r of res.results) next[r.domain] = String(r.status)
      setSignin(next)
      const ready = res.results.filter((r) => r.status === 'ready').length
      toast.success(`Signed in on ${ready} of ${res.results.length}.`)
    } catch {
      toast.error('Could not reach SCOUT.')
    } finally { setBusy(null) }
  }

  // ── launch ────────────────────────────────────────────────────────────────
  async function launch() {
    if (!batchId) return
    setBusy('launch')
    try {
      const r = await fetch(`/api/launch/batches/${batchId}/launch`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not launch.', { duration: 14000 }); return }
      setLaunched({ scheduled: j.scheduled, firstAt: j.firstAt, lastAt: j.lastAt, note: j.note })
      if (Array.isArray(j.leftBehind) && j.leftBehind.length > 0) {
        // NAMED. Launching nine of ten and saying nothing is the silence this
        // codebase keeps producing.
        toast.error(
          `${j.leftBehind.length} ${j.leftBehind.length === 1 ? 'video was' : 'videos were'} left behind: `
          + j.leftBehind.map((x: { title: string; reason: string }) => `${x.title || 'untitled'} (${x.reason || 'not ready'})`).join('; '),
          { duration: 18000 },
        )
      }
      await load(batchId)
    } finally { setBusy(null) }
  }

  // ── render ────────────────────────────────────────────────────────────────
  if (loading) {
    return <p className="text-[13px] inline-flex items-center gap-2" style={muted}><Loader2 size={14} className="animate-spin" /> Loading…</p>
  }
  if (error) {
    return <p className="text-[13px]" style={{ color: '#dc2626' }}>{error}</p>
  }
  if (!batchId || !batch) {
    return (
      <div className="max-w-xl">
        <p className="text-[13.5px] mb-4" style={muted}>
          Set up to ten videos in one sitting. You choose the CTA and the countries once, give each
          video its own product, then press Launch and leave it.
        </p>
        <button
          onClick={() => void startBatch()} disabled={busy === 'new'}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}
        >
          {busy === 'new' ? <><Loader2 size={15} className="animate-spin" /> Starting…</> : <><Plus size={15} /> Start a batch</>}
        </button>
      </div>
    )
  }

  const step = (id: string) => steps.find((s) => s.id === id)
  const toggle = (id: string) => { autoOpened.current = true; setOpen(open === id ? null : id) }
  const slots = batch.daily_slots ?? []
  const preview = planSchedule(items.length, {
    timezone: batch.timezone, slots, startOn: batch.start_on ?? '',
  })

  const stateWord = (st: string) =>
    st === 'launched' ? 'Launched' : st === 'launching' ? 'Going out' : st === 'ready' ? 'Ready' : 'Being set up'

  return (
    <div className="max-w-3xl flex flex-col gap-3">
      {/* ── EVERY BATCH, NOT JUST THIS ONE ──────────────────────────────────
          A launched batch used to disappear the moment it finished: ten
          videos scheduled across ten days, and the page that scheduled them
          showed an empty "start a batch" screen. */}
      {batches.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {batches.map((b) => {
            const on = b.id === batchId
            return (
              <button key={b.id} type="button" onClick={() => openBatch(b.id)}
                className="px-3 py-1.5 rounded-lg border text-[12px] text-left disabled:opacity-60"
                style={{
                  borderColor: on ? '#0EA5A4' : 'var(--border)',
                  background: on ? 'rgba(14,165,164,0.08)' : 'transparent',
                  ...text,
                }}>
                <span className="font-medium">{b.name}</span>
                <span style={muted}>{' \u00b7 '}{b.videos} {b.videos === 1 ? 'video' : 'videos'}{' \u00b7 '}{stateWord(b.state)}</span>
              </button>
            )
          })}
          {/* ALWAYS AVAILABLE. Somebody who posts three a day wants the next
              batch set up while the last one is still going out. */}
          <button type="button" onClick={() => void startBatch()} disabled={busy === 'new'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] disabled:opacity-60"
            style={{ borderColor: 'var(--border)', ...muted }}>
            {busy === 'new' ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            New batch
          </button>
        </div>
      )}

      {/* ── what happens, in one sentence, before any of the steps ─────────── */}
      <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <p className="text-[13px]" style={text}>
          <strong>{items.length}</strong> of {maxItems} videos in <strong>{batch.name}</strong>.
        </p>
        {/* HOW LONG, because "press Launch and walk away" is the whole promise
            and nobody walks away from a screen that will not say. */}
        {prepEta(items as unknown as ItemRow[]) && (
          <p className="text-[12.5px] mt-1 inline-flex items-center gap-1.5" style={{ color: '#0EA5A4' }}>
            <Clock size={12} /> {prepEta(items as unknown as ItemRow[])}
          </p>
        )}
        <p className="text-[12.5px] mt-1" style={muted}>
          MVP burns your CTA into each one, builds the thumbnails, writes each country&apos;s title and
          dubs the audio. All of that runs on our servers with this tab shut. The one part that needs
          your browser is the Amazon upload, because it goes through your own logged-in Creator account.
        </p>
      </div>

      {/* ── 1. videos ──────────────────────────────────────────────────────── */}
      <StepCard
        n={1} title={step('videos')?.title ?? 'Add your videos'}
        detail={step('videos')?.detail ?? ''} done={!!step('videos')?.done}
        current={!!step('videos')?.current} open={open === 'videos'} onToggle={() => toggle('videos')}
      >
        <div className="flex flex-col gap-3">
          <label
            className="rounded-xl border border-dashed px-4 py-6 text-center cursor-pointer"
            style={{ borderColor: 'var(--border)' }}
          >
            <input
              type="file" accept="video/*" multiple className="hidden"
              onChange={(e) => { void addFiles(e.target.files); e.currentTarget.value = '' }}
            />
            <Upload size={18} style={{ color: '#0EA5A4', margin: '0 auto 6px' }} />
            <span className="block text-[13px] font-medium" style={text}>
              {uploading > 0 ? `Uploading ${uploading}…` : 'Choose videos'}
            </span>
            <span className="block text-[11.5px] mt-0.5" style={muted}>
              Pick several at once. Up to {maxItems} per batch, under 500MB each.
            </span>
          </label>

          {items.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-2 rounded-lg border px-3 py-2"
                  style={{ borderColor: 'var(--border)' }}>
                  <span className="text-[11px] tabular-nums w-5" style={muted}>{it.position + 1}</span>
                  <span className="flex-1 min-w-0 truncate text-[12.5px]" style={text}>
                    {it.title || 'Untitled'}
                  </span>
                  <span className="text-[11px]" style={{ color: TONE[itemStateTone(it.state as never)] }}>
                    {itemStateLabel(it.state as never)}
                  </span>
                  <button onClick={() => void removeItem(it.id)} disabled={busy === it.id}
                    className="p-1 rounded disabled:opacity-50" title="Remove">
                    <Trash2 size={13} style={muted} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </StepCard>

      {/* ── 2. the CTA ─────────────────────────────────────────────────────── */}
      <StepCard
        n={2} title={step('cta')?.title ?? 'Choose your CTA'}
        detail={step('cta')?.detail ?? ''} done={!!step('cta')?.done}
        current={!!step('cta')?.current} open={open === 'cta'} onToggle={() => toggle('cta')}
      >
        <CtaPicker
          value={batch.cta}
          saving={busy === 'batch'}
          onSave={(preset) => void patchBatch({ cta: preset, ctaChosen: true })}
        />
      </StepCard>

      {/* ── 3. the thumbnail look ──────────────────────────────────────────── */}
      <StepCard
        n={3} title={step('thumbnail')?.title ?? 'Choose your thumbnail look'}
        detail={step('thumbnail')?.detail ?? ''} done={!!step('thumbnail')?.done}
        current={!!step('thumbnail')?.current} open={open === 'thumbnail'} onToggle={() => toggle('thumbnail')}
      >
        <ThumbnailPicker
          value={batch.thumbnail}
          chosen={!!batch.thumbnail_chosen}
          saving={busy === 'batch'}
          onSave={(preset) => void patchBatch({ thumbnail: preset, thumbnailChosen: true })}
        />
      </StepCard>

      {/* ── 4. countries ───────────────────────────────────────────────────── */}
      <StepCard
        n={4} title={step('countries')?.title ?? 'Pick your Amazon countries'}
        detail={step('countries')?.detail ?? ''} done={!!step('countries')?.done}
        current={!!step('countries')?.current} open={open === 'countries'} onToggle={() => toggle('countries')}
      >
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px]" style={muted}>
            Chosen once for the whole batch. A country that does not speak English gets its own title,
            its own dubbed audio and the thumbnail with no words on it, all made by MVP.
          </p>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            {MARKETS.map((m) => {
              const on = batch.markets.some((x) => x.domain === m.domain)
              const state = signin[m.domain]
              return (
                <button
                  key={m.domain} type="button" disabled={busy === 'batch'}
                  onClick={() => {
                    const next = on
                      ? batch.markets.filter((x) => x.domain !== m.domain).map((x) => x.domain)
                      : [...batch.markets.map((x) => x.domain), m.domain]
                    void patchBatch({ markets: next })
                  }}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left disabled:opacity-60"
                  style={{
                    borderColor: on ? '#0EA5A4' : 'var(--border)',
                    background: on ? 'rgba(14,165,164,0.07)' : 'transparent',
                  }}
                >
                  <span className="shrink-0 rounded flex items-center justify-center"
                    style={{ width: 16, height: 16, border: `1.5px solid ${on ? '#0EA5A4' : 'var(--border)'}`, background: on ? '#0EA5A4' : 'transparent' }}>
                    {on && <Check size={11} color="#fff" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium truncate" style={text}>{m.country}</span>
                    <span className="block text-[11px]" style={muted}>
                      {/* WHAT THIS COUNTRY ACTUALLY RECEIVES, including which
                          of the two thumbnails. The text-free copy is a
                          deliberate choice, not a thumbnail that failed, and
                          the only place it was ever said was the step above. */}
                      {m.needsTranslation
                        ? `${m.langName}, dubbed \u00b7 thumbnail with no words`
                        : 'English \u00b7 thumbnail with the hook'}
                    </span>
                    {/* ROOM LEFT TODAY, before the wall rather than at it.
                        Amazon takes twenty a day on the US store and ten
                        everywhere else, and a number that stops moving with no
                        explanation reads as something broken. */}
                    {on && room[m.domain] !== undefined && (
                      <span className="block text-[11px]"
                        style={{ color: room[m.domain] === 0 ? '#d97706' : 'var(--text-2)' }}>
                        {room[m.domain] === 0
                          ? 'full for today, the rest go tomorrow'
                          : `${room[m.domain]} more today`}
                      </span>
                    )}
                  </span>
                  {/* THE FACT, not the tick. Being signed in is something SCOUT
                      reports; ticking is a decision. A screen that conflates
                      them promises listings in a country nobody can reach. */}
                  {state === 'ready' && <Check size={13} style={{ color: '#10B981' }} />}
                  {state && state !== 'ready' && <AlertTriangle size={13} style={{ color: '#d97706' }} />}
                </button>
              )
            })}
          </div>
          {batch.markets.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => void checkSignin(batch.markets.map((m) => m.domain))}
                disabled={busy === 'signin'}
                className="inline-flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-lg border disabled:opacity-50"
                style={{ borderColor: 'var(--border)', ...text }}
              >
                {busy === 'signin' ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
                Check I am signed in
              </button>
              <span className="text-[11.5px]" style={muted}>
                MVP uploads through your own Amazon Creator account, so you need to be signed in to each.
              </span>
            </div>
          )}
        </div>
      </StepCard>

      {/* ── 5. products, the only per-video step ───────────────────────────── */}
      <StepCard
        n={5} title={step('products')?.title ?? 'Set each product'}
        detail={step('products')?.detail ?? ''} done={!!step('products')?.done}
        current={!!step('products')?.current} open={open === 'products'} onToggle={() => toggle('products')}
      >
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px]" style={muted}>
            The one thing that cannot be shared: every video sells its own product. Paste the ASIN or
            the Amazon link, and MVP will follow a shortened one to the end.
          </p>
          {items.length === 0 && <p className="text-[12.5px]" style={muted}>Add some videos first.</p>}
          {items.map((it, i) => (
            <ItemRowEditor key={it.id} item={it} busy={busy === it.id} onSave={patchItem}
              onMove={moveItem} first={i === 0} last={i === items.length - 1} />
          ))}
        </div>
      </StepCard>

      {/* ── 5. cadence and launch ──────────────────────────────────────────── */}
      <StepCard
        n={6} title={step('schedule')?.title ?? 'Schedule your YouTube posts'}
        detail={step('schedule')?.detail ?? ''} done={!!step('schedule')?.done}
        current={!!step('schedule')?.current} open={open === 'schedule'} onToggle={() => toggle('schedule')}
      >
        <div className="flex flex-col gap-4">
          {/* WHICH PLATFORM THIS IS, up front. The step used to say "cadence"
              and nothing else, and the first person to read it asked where
              YouTube was. The two halves behave completely differently and the
              screen has to say so rather than let a creator assume. */}
          <p className="text-[12.5px] px-3 py-2 rounded-lg" style={{ ...muted, background: 'var(--surface-hover)' }}>
            This is the <strong style={text}>YouTube</strong> schedule. Each video goes up private and
            YouTube makes it public at the time you pick.
            {batch.markets.length > 0 && (
              <> Your <strong style={text}>Amazon</strong> storefronts are not on a schedule: each listing
                goes up as soon as its translation and dub are done.</>
            )}
          </p>

          <div>
            <p className="text-[12.5px] font-medium mb-1" style={text}>How many YouTube posts a day, and when</p>
            <p className="text-[12px] mb-2" style={muted}>
              One time per video per day. Three times means three a day. Times are yours: {batch.timezone}.
            </p>
            <SlotEditor
              slots={slots}
              disabled={busy === 'batch'}
              onChange={(next) => void patchBatch({ dailySlots: next })}
            />
          </div>

          <label className="text-[12.5px] font-medium" style={text}>
            First day
            <input
              type="date"
              value={batch.start_on ?? ''}
              min={earliestDay(batch.timezone)}
              onChange={(e) => void patchBatch({ startOn: e.target.value })}
              className="block mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent"
              style={{ borderColor: 'var(--border)', ...text }}
            />
          </label>

          {/* WHEN EACH ONE ACTUALLY GOES OUT, worked out with the same function
              the server uses. A cadence described in words is a promise; this
              is the list. */}
          {preview.length > 0 && (
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
              <p className="text-[12px] font-medium mb-1.5" style={text}>
                <Clock size={12} style={{ display: 'inline', marginRight: 4 }} />
                {cadenceLabel(slots)}
              </p>
              <ul className="flex flex-col gap-0.5">
                {preview.map((p) => (
                  <li key={p.position} className="text-[11.5px] flex gap-2" style={muted}>
                    <span className="tabular-nums w-5">{p.position + 1}</span>
                    <span className="flex-1 truncate" style={text}>
                      {items[p.position]?.title || 'Untitled'}
                    </span>
                    {/* NOW IS NOT A TIME, and printing this morning's slot
                        beside a video that is about to go out would be the
                        plan reported as the result. */}
                    {p.at.getTime() <= Date.now() ? (
                      <span style={{ color: '#10B981' }}>as soon as it is uploaded</span>
                    ) : (
                      <span className="tabular-nums">
                        {new Intl.DateTimeFormat('en-GB', {
                          timeZone: batch.timezone, weekday: 'short', day: '2-digit', month: 'short',
                          hour: '2-digit', minute: '2-digit', hour12: false,
                        }).format(p.at)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {/* AND WHAT AMAZON DOES, which is not on this schedule at all.
                  The list above is YouTube only, and reading it as the whole
                  plan is what made a creator ask whether Amazon was waiting
                  for the same date. */}
              {batch.markets.length > 0 && (
                <p className="text-[11.5px] mt-2 pt-2" style={{ ...muted, borderTop: '1px solid var(--border)' }}>
                  Amazon is not on this schedule. Each of your {batch.markets.length} {batch.markets.length === 1 ? 'storefront' : 'storefronts'} gets
                  its listing as soon as that country&apos;s translation and dub are done, up to {' '}
                  {batch.markets.map((m) => `${m.country} ${room[m.domain] ?? (m.domain === 'amazon.com' ? 20 : 10)}`).join(', ')} more today.
                </p>
              )}
            </div>
          )}

          {/* SAID BEFORE THE BUTTON, not after. Going public is the one thing
              on this page that cannot be undone, so a creator about to do it
              immediately should read that first. */}
          {preview.some((p) => p.at.getTime() <= Date.now()) && (
            <p className="text-[12.5px] px-3 py-2 rounded-lg" style={{ color: '#10B981', background: 'rgba(16,185,129,0.08)' }}>
              {preview.filter((p) => p.at.getTime() <= Date.now()).length === preview.length
                ? 'Those times have gone today, so these go public as soon as they are uploaded.'
                : `${preview.filter((p) => p.at.getTime() <= Date.now()).length} of these go public as soon as they are uploaded, because those times have gone today. The rest wait for theirs.`}
            </p>
          )}

          {/* THE REASON, always. A disabled button with nothing beside it is the
              dead end this codebase keeps producing. */}
          {blocker && (
            <p className="text-[12.5px] px-3 py-2 rounded-lg" style={{ color: '#d97706', background: 'rgba(217,119,6,0.08)' }}>
              {blocker}
            </p>
          )}

          <button
            onClick={() => void launch()}
            disabled={!!blocker || busy === 'launch' || batch.state === 'launching' || batch.state === 'launched'}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}
          >
            {busy === 'launch'
              ? <><Loader2 size={16} className="animate-spin" /> Launching…</>
              : batch.state === 'launched' || batch.state === 'launching'
                ? <><Check size={16} /> Launched</>
                : <><Rocket size={16} /> Launch {items.length} {items.length === 1 ? 'video' : 'videos'}</>}
          </button>
        </div>
      </StepCard>

      {/* ── after the launch ───────────────────────────────────────────────── */}
      {launched && (
        <div className="rounded-2xl border p-4" style={{ borderColor: '#10B981', background: 'rgba(16,185,129,0.07)' }}>
          <p className="text-[13.5px] font-semibold" style={text}>
            {launched.scheduled} {launched.scheduled === 1 ? 'video' : 'videos'} scheduled.
          </p>
          {launched.firstAt && launched.lastAt && (
            <p className="text-[12.5px] mt-1" style={muted}>
              First on {new Intl.DateTimeFormat('en-GB', { timeZone: batch.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(launched.firstAt))},
              last on {new Intl.DateTimeFormat('en-GB', { timeZone: batch.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(launched.lastAt))}.
            </p>
          )}

          {/* ── THE TWO SIDES ARE NOT ON THE SAME CLOCK ──────────────────────
              This box named the YouTube schedule and then said Amazon needed
              this tab open, which read as "everything happens on the 23rd".
              It does not: the file reaches YouTube within a minute of Launch
              and Amazon starts from that moment. Only YouTube GOING PUBLIC
              waits for the time. Two headings, because one paragraph covering
              both is what made them look like one thing. */}
          <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <p className="text-[12px] font-semibold" style={text}>YouTube: on your schedule</p>
              <p className="text-[11.5px] mt-1" style={muted}>
                Each video is uploaded now and kept private, and YouTube makes it public at the time you picked.
              </p>
            </div>
            <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <p className="text-[12px] font-semibold" style={text}>Amazon: straight away</p>
              <p className="text-[11.5px] mt-1" style={muted}>
                Not on the schedule at all. Each storefront gets its listing as soon as its translation and dub are done. Amazon takes 20 a day on the US store and 10 a day on each other one, which is its rule, not ours.
              </p>
            </div>
          </div>

          {/* THE UPLOAD ITSELF, from here. This box used to say your Amazon
              stores needed this tab open, and that was not true of this page:
              it used SCOUT to check your sign-in and never uploaded anything.
              Making the sentence true was the better of the two fixes. */}
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button
              onClick={() => void uploadToAmazon()}
              disabled={busy === 'amazon'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-60"
              style={{ background: '#0EA5A4' }}>
              {busy === 'amazon' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Upload to Amazon now
            </button>
            <span className="text-[11.5px]" style={muted}>
              Through SCOUT, in your own logged-in Creator account, so this one needs the tab open.
            </span>
          </div>
        </div>
      )}

      {/* ── the board: what is actually happening to each video ────────────── */}
      {items.length > 0 && (
        <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <h2 className="text-[13px] font-semibold mb-2.5" style={text}>Where each video is</h2>
          <ul className="flex flex-col gap-1.5">
            {items.map((it) => (
              <li key={it.id} className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
                style={{ borderColor: 'var(--border)' }}>
                {it.thumbnail_url
                  ? <Image src={it.thumbnail_url} alt="" width={64} height={36} unoptimized
                      style={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 4 }} />
                  : <span className="shrink-0 rounded" style={{ width: 64, height: 36, background: 'var(--surface-hover)' }} />}
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] truncate" style={text}>{it.title || 'Untitled'}</span>
                  <span className="block text-[11.5px]" style={{ color: TONE[itemStateTone(it.state as never)] }}>
                    {itemStateLabel(it.state as never)}
                    {/* THE LOOK THAT WAS ACTUALLY USED, at a glance. The reason
                        below says it in a sentence, but a creator scanning ten
                        rows reads the colours, and a thumbnail built the wrong
                        way looked identical to one built the right way. */}
                    {it.thumbnail_source === 'plain' && (
                      <> · <span style={{ color: '#d97706' }}>plain look</span></>
                    )}
                    {/* NO DESCRIPTION MEANS NO AFFILIATE LINK, and the CTA
                        burned into the frame says there is one. A video that
                        earns nothing must not look identical to one that
                        does. */}
                    {!it.description && (it.state === 'prepared' || it.state === 'scheduled' || it.state === 'published') && (
                      <> · <span style={{ color: '#d97706' }}>no link in the description</span></>
                    )}
                    {/* WORKING AND STUCK MUST NOT READ THE SAME.
                        "Building the thumbnail" said the same thing one second
                        in and forty minutes in, which is the failure this
                        codebase keeps producing in new shapes. The attempt
                        count and the time since anything last happened are the
                        two facts that separate them. */}
                    {(it.state === 'rendering' || it.state === 'preparing') && (
                      <> · {progressNote(it)}</>
                    )}
                    {it.publish_at && (
                      <> · goes live {new Intl.DateTimeFormat('en-GB', {
                        timeZone: batch.timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
                      }).format(new Date(it.publish_at))}</>
                    )}
                  </span>
                  {/* THE REASON STAYS. A video that could not go looks exactly
                      like one nobody picked unless the row says otherwise. */}
                  {it.reason && (
                    <span className="block text-[11.5px] mt-1 px-2 py-1 rounded"
                      style={{ color: '#d97706', background: 'rgba(217,119,6,0.08)' }}>
                      {it.reason}
                    </span>
                  )}
                </span>
                {/* A WAY BACK. Every cause "Cannot go" names is something a
                    creator can fix, and until now the only way to act on that
                    was deleting the video and starting again, which throws
                    away a finished render and two thumbnails. */}
                {it.state === 'blocked' && (
                  <button onClick={() => void retryItem(it.id)} disabled={busy === 'batch'}
                    className="text-[11.5px] px-2.5 py-1 rounded-lg border shrink-0 disabled:opacity-50"
                    style={{ borderColor: '#d97706', color: '#d97706' }}>
                    Try again
                  </button>
                )}
                {it.youtube_video_id && (
                  <a href={`https://studio.youtube.com/video/${it.youtube_video_id}/edit`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-[11.5px] underline shrink-0" style={{ color: '#0EA5A4' }}>
                    Open
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** One video's own product and title. */
/**
 * How a video that is still working is doing, in facts rather than reassurance.
 *
 * TRIES AND MINUTES. A step that is running says which attempt it is on, so a
 * creator can see it moving. A step that has not touched its row in a while
 * says how long, because that is the only difference on screen between a slow
 * image model and a worker that is not running at all, and the second one
 * needs somebody to look at it.
 */
function progressNote(it: Item): string {
  const tries = Number((it.state === 'rendering' ? it.render_tries : it.thumb_tries) ?? 0)
  const mins = it.updated_at
    ? Math.floor((Date.now() - new Date(it.updated_at).getTime()) / 60_000)
    : 0
  const attempt = tries > 1 ? `try ${tries} of 3` : 'first try'
  // Ten minutes is comfortably past a slow image model, and the drain runs
  // every minute, so nothing moving for that long is worth saying out loud.
  if (mins >= 10) return `${attempt}, nothing for ${mins} minutes`
  return attempt
}

function ItemRowEditor({
  item, busy, onSave, onMove, first, last,
}: {
  item: Item
  busy: boolean
  onSave: (id: string, body: Record<string, unknown>) => Promise<void>
  onMove: (id: string, direction: 'up' | 'down') => Promise<void>
  first: boolean
  last: boolean
}) {
  const [title, setTitle] = useState(item.title ?? '')
  const [product, setProduct] = useState(item.asin ?? '')
  const [options, setOptions] = useState<string[]>([])
  const [writing, setWriting] = useState(false)
  // THE DESCRIPTION IS WHERE THE AFFILIATE LINK GOES. MVP writes it during
  // prepare, and this is the only place it can be read or changed before it
  // reaches YouTube. Collapsed, because most people will never touch it.
  const [showDesc, setShowDesc] = useState(false)
  const [desc, setDesc] = useState(item.description ?? '')

  // THE TITLE MVP WROTE IS OFFERED, NOT APPLIED. This is the line that goes on
  // YouTube and gets translated into every other country, so it is the last
  // thing that should be changed without being read.
  async function writeTitle() {
    setWriting(true)
    try {
      const r = await fetch(`/api/launch/items/${item.id}/title`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !Array.isArray(j?.titles)) { toast.error(j?.error || 'Could not write a title.'); return }
      setOptions(j.titles as string[])
    } finally { setWriting(false) }
  }

  // AN ASIN IS NOT A TITLE, and nothing used to stop one becoming the YouTube
  // title of ten videos and the source text for every translation.
  const titleIsAsin = !!title.trim() && !!product.trim()
    && title.trim().toUpperCase() === product.trim().toUpperCase()
  // Only adopt server values the creator has not overwritten, or a poll landing
  // mid-sentence would wipe what they are typing.
  const dirty = useRef(false)
  useEffect(() => {
    if (dirty.current) return
    setTitle(item.title ?? '')
    setProduct(item.asin ?? '')
    setDesc(item.description ?? '')
  }, [item.title, item.asin, item.description])

  const changed = title !== (item.title ?? '')
    || product !== (item.asin ?? '')
    || desc !== (item.description ?? '')
  // ONE FIELD'S SAVE MUST NOT WIPE THE OTHER. Both were always sent together,
  // so emptying one box and pressing Save deleted whatever was in it even when
  // the creator was only editing its neighbour. An empty product field is sent
  // ONLY when it was not empty to begin with, which is a deliberate clear.
  function save() {
    const body: Record<string, unknown> = {}
    if (title !== (item.title ?? '')) body.title = title
    if (product !== (item.asin ?? '')) body.product = product
    if (desc !== (item.description ?? '')) body.description = desc
    dirty.current = false
    void onSave(item.id, body)
  }

  const lab = { color: 'var(--text-2)', fontSize: 11, fontWeight: 600 } as const

  return (
    <div className="rounded-lg border p-3 flex flex-col gap-2.5" style={{ borderColor: 'var(--border)' }}>
      {/* LABELLED, NOT JUST PLACEHELD. A placeholder disappears the moment a
          box has anything in it, and both boxes held the same ASIN, so there
          was nothing on screen saying which was which. The warning about the
          title was also sitting under the product box, so the box it pointed
          at was the wrong one and the product got cleared instead. */}
      <div className="flex items-start gap-2">
        {/* THE NUMBER IS THE PUBLISHING ORDER, not a label. With one post a
            day, number one goes out first and number ten goes out next week,
            and until now that was decided by the order a file dialog happened
            to return. */}
        <span className="flex flex-col items-center w-5 pt-4 shrink-0">
          <button type="button" onClick={() => void onMove(item.id, 'up')}
            disabled={busy || first} title="Send this one out earlier"
            className="leading-none disabled:opacity-25" style={muted}>
            <ChevronUp size={12} />
          </button>
          <span className="text-[11px] tabular-nums" style={muted}>{item.position + 1}</span>
          <button type="button" onClick={() => void onMove(item.id, 'down')}
            disabled={busy || last} title="Send this one out later"
            className="leading-none disabled:opacity-25" style={muted}>
            <ChevronDown size={12} />
          </button>
        </span>
        <label className="flex-1 min-w-0">
          <span className="block mb-1" style={lab}>Title, for YouTube and the English stores</span>
          <input
            value={title}
            onChange={(e) => { dirty.current = true; setTitle(e.target.value) }}
            placeholder="What this video is about"
            className="w-full px-2.5 py-1.5 rounded-lg border text-[12.5px] bg-transparent"
            style={{ borderColor: titleIsAsin ? '#d97706' : 'var(--border)', ...text }}
          />
          {/* BESIDE THE BOX IT IS ABOUT. */}
          {titleIsAsin && (
            <span className="block text-[11.5px] mt-1" style={{ color: '#d97706' }}>
              That is the ASIN, not a title. It would go on YouTube exactly as it reads and be translated into every country.
            </span>
          )}
          <button type="button" onClick={() => void writeTitle()} disabled={writing || !product.trim()}
            title={!product.trim() ? 'Set the product first, the title is written from what it is.' : undefined}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 mt-1.5 rounded-lg border text-[11.5px] disabled:opacity-40"
            style={{ borderColor: 'var(--border)', ...text }}>
            {writing ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
            Write it for me
          </button>
        </label>
      </div>

      {/* ── the description, where the affiliate link lives ──────────────── */}
      <div className="flex items-start gap-2">
        <span className="w-5" />
        <div className="flex-1 min-w-0">
          <button type="button" onClick={() => setShowDesc((v) => !v)}
            className="text-[11px] font-semibold underline" style={{ color: 'var(--text-2)' }}>
            {showDesc ? 'Hide the description' : item.description ? 'See the description' : 'Description (MVP writes it)'}
          </button>
          {showDesc && (
            <>
              <textarea
                value={desc} rows={5}
                onChange={(e) => { dirty.current = true; setDesc(e.target.value) }}
                placeholder="MVP writes this when it prepares the video, with your affiliate link in it."
                className="w-full mt-1 px-2.5 py-1.5 rounded-lg border text-[12px] bg-transparent"
                style={{ borderColor: 'var(--border)', ...text }}
              />
              <span className="block text-[11px] mt-1" style={muted}>
                This goes on YouTube as written. Your affiliate link lives in here, so the CTA burned into the video has somewhere to point.
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <span className="w-5" />
        <label className="flex-1 min-w-0">
          <span className="block mb-1" style={lab}>Product</span>
          <input
            value={product}
            onChange={(e) => { dirty.current = true; setProduct(e.target.value) }}
            placeholder="ASIN or Amazon link"
            className="w-full px-2.5 py-1.5 rounded-lg border text-[12.5px] font-mono bg-transparent"
            style={{ borderColor: 'var(--border)', ...text }}
          />
        </label>
        <button
          onClick={save}
          disabled={busy || !changed}
          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40 shrink-0"
          style={{ background: '#0EA5A4' }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
        </button>
      </div>

      {options.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px]" style={muted}>Pick one, then Save. You can edit it after.</span>
          {options.map((o) => (
            <button key={o} type="button"
              onClick={() => { dirty.current = true; setTitle(o); setOptions([]) }}
              className="text-left text-[12px] px-2.5 py-1.5 rounded-lg border"
              style={{ borderColor: 'var(--border)', ...text }}>
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The publishing times. The number of them IS the videos-per-day. */
function SlotEditor({
  slots, disabled, onChange,
}: {
  slots: string[]
  disabled: boolean
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('09:00')
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {slots.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px]"
            style={{ background: 'rgba(14,165,164,0.12)', color: '#0EA5A4' }}>
            {s}
            <button type="button" disabled={disabled}
              onClick={() => onChange(slots.filter((x) => x !== s))} title="Remove">
              <X size={11} />
            </button>
          </span>
        ))}
        {slots.length === 0 && <span className="text-[12px]" style={muted}>No times yet.</span>}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="time" value={draft} onChange={(e) => setDraft(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border text-[12.5px] bg-transparent"
          style={{ borderColor: 'var(--border)', ...text }}
        />
        <button
          type="button" disabled={disabled || !draft}
          onClick={() => onChange([...slots, draft])}
          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-40"
          style={{ border: '1px solid var(--border)', ...text }}
        >
          Add a time
        </button>
      </div>
    </div>
  )
}

/** A video's length and shape, read in the browser so the server never
 *  downloads it just to measure it.
 *
 *  Zeroes mean the browser could not read the metadata, and the caller treats
 *  that as "cannot tell" rather than as "not vertical": refusing a video
 *  because a probe failed would be blaming the creator for our own blind spot. */
function probeVideo(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    try {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => {
        const d = Number(v.duration)
        const out = {
          duration: Number.isFinite(d) ? Math.round(d) : 0,
          width: Number(v.videoWidth) || 0,
          height: Number(v.videoHeight) || 0,
        }
        URL.revokeObjectURL(v.src)
        resolve(out)
      }
      v.onerror = () => resolve({ duration: 0, width: 0, height: 0 })
      v.src = URL.createObjectURL(file)
    } catch { resolve({ duration: 0, width: 0, height: 0 }) }
  })
}
