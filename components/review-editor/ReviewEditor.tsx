'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE REVIEW EDITOR (Labs). Two takes in: the review in one go, the B-roll in
// another. MVP cuts the mistakes, puts the B-roll where it is talked about,
// adds the logo, title, zooms and colour, and makes it wide (Amazon and
// YouTube) and or vertical (TRYBE, TikTok). Add a batch and leave it: each
// video moves through the queue by itself (lib/review-edit-server), and
// every card says where it is and what MVP did, so a video still being read
// never looks like one that failed, and a cut is never silent.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, UploadCloud, Check, AlertTriangle, Film, Scissors, Clapperboard, Download, Send, Trash2, RotateCcw, Wand2, ImagePlus } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { uploadResumable, ResumableUnavailable } from '@/lib/upload-resumable'
import { uploadWithProgress } from '@/lib/upload-progress'
import { freshAccessToken, saysExpired } from '@/lib/fresh-token'
import { storageSizeRefusal, BULK_VIDEO_MAX_BYTES } from '@/lib/clip-source-limits'
import { DEFAULT_SETTINGS, FORMAT_WORDS, KIND_WORDS, POSITIONS, POSITION_WORDS, cleanSettings, type EditSettings, type Format, type Position, type VideoKind } from '@/lib/review-edit'

const PURPLE = '#7C3AED'
const GREEN = '#15803D'
const AMBER = '#B45309'
const RED = '#B91C1C'
const soft = { color: 'var(--text-3)' }
const card = 'rounded-2xl border p-4'
const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
const mb = (n: number) => `${Math.round(n / 1048576)} MB`

interface Upl { name: string; bytes: number; sent: number; url: string | null; error: string | null }
interface EditView {
  id: string; name: string | null; status: string; note: string | null; product: string | null
  createdAt: string; madeAt: string | null; rawDeleted: boolean; hasBroll: boolean
  settings: EditSettings
  review: { duration: number; width: number; height: number } | null
  outputs: Partial<Record<Format, { url: string; seconds: number }>> | null
  cuts: { k: number; kind: string; why: string; restored: boolean; at: string; text: string }[]
  broll: { k: number; off: boolean; why: string; shot: string; line: string; at: string }[]
  zooms: number
}

const STATUS: Record<string, { words: string; color: string; busy?: boolean }> = {
  queued: { words: 'In line', color: 'var(--text-3)', busy: true },
  reading: { words: 'Reading your takes', color: PURPLE, busy: true },
  ready_to_make: { words: 'Waiting to be made', color: PURPLE, busy: true },
  making: { words: 'Being made', color: PURPLE, busy: true },
  done: { words: 'Ready', color: GREEN },
  failed: { words: 'Stopped', color: RED },
}

async function api(body: Record<string, unknown>) {
  const r = await fetch('/api/review-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'That did not work.')
  return d
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className="rounded-full border px-3 py-1 text-[12.5px] font-semibold"
      style={on ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border)', color: 'var(--text-2)' }}>{children}</button>
  )
}

function Toggle({ on, set, label, hint }: { on: boolean; set: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-[13px] cursor-pointer">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="mt-0.5" />
      <span><b className="font-semibold">{label}</b>{hint && <span className="block text-[12px]" style={soft}>{hint}</span>}</span>
    </label>
  )
}

/** The choices for a video, new or made. */
function Choices({ s, set, onLogo, logoBusy }: { s: EditSettings; set: (s: EditSettings) => void; onLogo: (f: File) => void; logoBusy: boolean }) {
  const ad = s.kind === 'trybe'
  const pos = (cur: Position, pick: (p: Position) => void) => (
    <div className="flex flex-wrap gap-1.5 mt-1">{POSITIONS.map((p) => <Chip key={p} on={cur === p} onClick={() => pick(p)}>{POSITION_WORDS[p]}</Chip>)}</div>
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="grid sm:grid-cols-2 gap-2">
        <Toggle on={s.broll} set={(v) => set({ ...s, broll: v })} label="B-roll over the talk" hint="Your B-roll shots where you talk about what they show." />
        <Toggle on={s.zooms} set={(v) => set({ ...s, zooms: v })} label="Slow zooms" hint="A slow push in on your strongest points." />
        <Toggle on={s.color} set={(v) => set({ ...s, color: v })} label="Colour boost" hint="A little more colour and contrast." />
        {ad && <Toggle on={s.captions} set={(v) => set({ ...s, captions: v })} label="Captions" hint="Word by word, the way ads are watched with the sound off." />}
      </div>
      {!ad && <div>
        <p className="text-[12px] font-bold uppercase tracking-wider" style={soft}>Logo</p>
        {s.logo ? (
          <div className="mt-1">
            <div className="flex items-center gap-2">
              <img src={s.logo.url} alt="Your logo" className="h-8 w-auto rounded" style={{ background: 'repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 12px 12px' }} />
              <Toggle on={s.logo.on} set={(v) => set({ ...s, logo: { ...s.logo!, on: v } })} label="Show my logo" />
            </div>
            {s.logo.on && pos(s.logo.position, (p) => set({ ...s, logo: { ...s.logo!, position: p } }))}
          </div>
        ) : null}
        <label className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] font-semibold underline cursor-pointer" style={{ color: PURPLE }}>
          {logoBusy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} {s.logo ? 'Use another logo' : 'Add your logo (a PNG)'}
          <input type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogo(f); e.target.value = '' }} />
        </label>
      </div>}
      {ad && <p className="text-[12px]" style={soft}>No logo on a TRYBE ad: the brand runs it as its own ad.</p>}
      <div>
        <p className="text-[12px] font-bold uppercase tracking-wider" style={soft}>{ad ? 'Hook on screen' : 'Title'}</p>
        <Toggle on={s.title.on} set={(v) => set({ ...s, title: { ...s.title, on: v } })} label={ad ? 'Show the hook as text at the start' : 'Show a title at the start'} />
        {s.title.on && (
          <>
            <input value={s.title.text} onChange={(e) => set({ ...s, title: { ...s.title, text: e.target.value.slice(0, 60) } })} placeholder={ad ? 'Leave empty and MVP writes the hook from what you say' : 'Leave empty and MVP writes it from the product'}
              className="mt-1 w-full max-w-md rounded-lg border px-3 py-1.5 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            {pos(s.title.position, (p) => set({ ...s, title: { ...s.title, position: p } }))}
            <label className="text-[12.5px] mt-1 inline-flex items-center gap-2" style={soft}>For
              <select value={s.title.seconds} onChange={(e) => set({ ...s, title: { ...s.title, seconds: Number(e.target.value) } })} className="rounded border px-1 py-0.5 bg-transparent" style={{ borderColor: 'var(--border)' }}>
                {[3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} seconds</option>)}
              </select>
            </label>
          </>
        )}
      </div>
    </div>
  )
}

export default function ReviewEditor() {
  const supabase = createBrowserClient()
  const [edits, setEdits] = useState<EditView[] | null>(null)
  const [needsSql, setNeedsSql] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settings, setSettings] = useState<EditSettings>(DEFAULT_SETTINGS)
  const [review, setReview] = useState<Upl | null>(null)
  const [broll, setBroll] = useState<Upl | null>(null)
  const [product, setProduct] = useState('')
  const [adding, setAdding] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const seeded = useRef(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/review-edit', { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setNeedsSql(!!d.needsSql); setLoadError(d.error || 'Your videos could not be read.'); return }
      setLoadError(null); setNeedsSql(false)
      setEdits(d.edits || [])
      if (!seeded.current && d.defaults) { setSettings(d.defaults); seeded.current = true }
    } catch { setLoadError('Your videos could not be read. Check your connection.') }
  }, [])
  useEffect(() => { void load() }, [load])
  // While anything is moving, look again every ten seconds.
  const busy = (edits || []).some((e) => STATUS[e.status]?.busy)
  useEffect(() => { if (!busy) return; const t = setInterval(() => void load(), 10_000); return () => clearInterval(t) }, [busy, load])

  const upload = async (file: File, kind: 'review' | 'broll') => {
    const setU = kind === 'review' ? setReview : setBroll
    if (!file.type.startsWith('video/')) { toast.error('That is not a video file.'); return }
    if (file.size > BULK_VIDEO_MAX_BYTES) { setU({ name: file.name, bytes: file.size, sent: 0, url: null, error: `${mb(file.size)} is over the ${mb(BULK_VIDEO_MAX_BYTES)} limit. Film at 1080p, or keep the take shorter.` }); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Sign in again, then add the take.'); return }
    setU({ name: file.name, bytes: file.size, sent: 0, url: null, error: null })
    const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
    let path = `${user.id}/source-edit-${crypto.randomUUID()}.${ext}`
    const type = file.type || 'video/mp4'
    try {
      try {
        await uploadResumable({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          getAccessToken: (force) => freshAccessToken(supabase, force), bucket: 'instagram-videos', path, file, contentType: type,
          onProgress: ({ sent }) => setU((u) => (u ? { ...u, sent } : u)),
        })
      } catch (e) {
        if (!(e instanceof ResumableUnavailable)) throw e
        path = `${user.id}/source-edit-${crypto.randomUUID()}.${ext}`
        const token = await freshAccessToken(supabase, true)
        if (!token) throw new Error('Signed out during the upload. Sign in again and add it again.')
        await uploadWithProgress({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, accessToken: token,
          bucket: 'instagram-videos', path, file, contentType: type, onProgress: ({ sent }) => setU((u) => (u ? { ...u, sent } : u)),
        })
      }
      const url = supabase.storage.from('instagram-videos').getPublicUrl(path).data.publicUrl
      setU((u) => (u ? { ...u, sent: file.size, url } : u))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'The upload failed.'
      setU((u) => (u ? { ...u, error: storageSizeRefusal(msg, file.size) || (saysExpired(msg) ? 'Your sign-in ran out during the upload. Refresh the page and add it again.' : msg) } : u))
    }
  }

  const uploadLogo = async (file: File, then: (url: string) => void) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Sign in again, then add the logo.'); return }
    if (file.size > 5 * 1048576) { toast.error('That logo is over 5 MB.'); return }
    setLogoBusy(true)
    try {
      const path = `${user.id}/logo-${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'}`
      const { error } = await supabase.storage.from('instagram-videos').upload(path, file, { contentType: file.type, upsert: false })
      if (error) throw new Error(error.message)
      then(supabase.storage.from('instagram-videos').getPublicUrl(path).data.publicUrl)
    } catch (e) { toast.error(`The logo was not saved: ${e instanceof Error ? e.message : 'upload failed'}`) } finally { setLogoBusy(false) }
  }

  const add = async () => {
    if (!review?.url) return
    setAdding(true)
    try {
      await api({ action: 'add', name: review.name.replace(/\.[^.]+$/, ''), review: { url: review.url, name: review.name, bytes: review.bytes }, broll: broll?.url ? { url: broll.url, name: broll.name, bytes: broll.bytes } : undefined, product, settings })
      toast.success('Added. MVP works on it in the background; you can add the next one now.')
      setReview(null); setBroll(null); setProduct('')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Not added.') } finally { setAdding(false) }
  }

  const progress = (u: Upl | null) => !u ? null : u.error
    ? <p className="text-[12.5px] mt-1" style={{ color: RED }}>{u.name}: {u.error}</p>
    : u.url ? <p className="text-[12.5px] mt-1 inline-flex items-center gap-1" style={{ color: GREEN }}><Check size={13} /> {u.name} is up ({mb(u.bytes)})</p>
    : <p className="text-[12.5px] mt-1 inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Uploading {u.name}: {Math.round((u.sent / Math.max(1, u.bytes)) * 100)}%</p>
  const uploading = (review && !review.url && !review.error) || (broll && !broll.url && !broll.error)

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-bold flex items-center gap-2"><Clapperboard size={20} /> Review editor
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'var(--border)', color: 'var(--text-3)' }}>Labs</span></h1>
        <p className="text-[13.5px] mt-1" style={{ color: 'var(--text-2)' }}>
          Film your talking in one take and your B-roll in another, then add them here. MVP cuts the mistakes and long pauses, puts your B-roll where you talk about it, and makes the video. Add a whole batch tonight and they are ready in the morning.
        </p>
      </div>

      <details className={card} style={cardStyle}>
        <summary className="text-[13.5px] font-semibold cursor-pointer">How to shoot it</summary>
        <ul className="text-[13px] mt-2 flex flex-col gap-1.5 list-disc pl-5" style={{ color: 'var(--text-2)' }}>
          <li><b>Talk it through in one go.</b> Prop up your phone or camera. Made a mistake? Pause, and say the sentence again. MVP keeps the last good try.</li>
          <li><b>The B-roll:</b> a second take of just the product, without stopping. Hold each shot three to five seconds: the front, the details, it in use.</li>
          <li><b>An Amazon and YouTube review</b> is filmed sideways (landscape), at a talking pace. Its Shorts, TikTok and Reels come from the finished review later, through Drop.</li>
          <li><b>A TRYBE ad</b> is filmed upright (portrait). It is an ad the brand runs, not a review: open on the hook, keep it tight, and film the B-roll upright too.</li>
          <li>1080p is plenty. Each file can be up to {mb(BULK_VIDEO_MAX_BYTES)}.</li>
        </ul>
      </details>

      {needsSql && <p className="text-[13px] rounded-xl border p-3" style={{ borderColor: AMBER, color: AMBER }}>{loadError}</p>}

      <section className={card} style={cardStyle} aria-label="Add a video">
        <p className="text-[15px] font-bold mb-2">Add a video</p>
        <p className="text-[13px] font-semibold">1. What is this video for?</p>
        <div className="grid sm:grid-cols-2 gap-2 mt-1 mb-3" role="group" aria-label="What this video is for">
          {(['review', 'trybe'] as VideoKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setSettings((s) => cleanSettings({ ...s, kind: k, captions: k === 'trybe' ? true : s.captions }, s))} aria-pressed={settings.kind === k}
              className="text-left rounded-xl border p-3" style={settings.kind === k ? { borderColor: PURPLE, background: 'rgba(124,58,237,0.08)' } : { borderColor: 'var(--border)' }}>
              <p className="text-[13.5px] font-bold" style={settings.kind === k ? { color: PURPLE } : undefined}>{KIND_WORDS[k].name}</p>
              <p className="text-[12px] mt-0.5" style={soft}>{KIND_WORDS[k].line}</p>
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[13px] font-semibold">2. Your talking take <span className="font-normal" style={soft}>({settings.kind === 'trybe' ? 'filmed upright' : 'filmed sideways'})</span></p>
            <label className="mt-1 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-semibold cursor-pointer" style={{ borderColor: 'var(--border)' }}>
              <UploadCloud size={14} /> {review ? 'Choose another' : 'Choose the file'}
              <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, 'review'); e.target.value = '' }} />
            </label>
            {progress(review)}
          </div>
          <div>
            <p className="text-[13px] font-semibold">3. Your B-roll take <span className="font-normal" style={soft}>(optional)</span></p>
            <label className="mt-1 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-semibold cursor-pointer" style={{ borderColor: 'var(--border)' }}>
              <Film size={14} /> {broll ? 'Choose another' : 'Choose the file'}
              <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, 'broll'); e.target.value = '' }} />
            </label>
            {progress(broll)}
          </div>
        </div>
        <div className="mt-3">
          <p className="text-[13px] font-semibold">4. The product <span className="font-normal" style={soft}>(optional: {settings.kind === 'trybe' ? 'the brand and product' : 'its name or Amazon link'})</span></p>
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Bassdash UPF 50 hoodie" className="mt-1 w-full max-w-md rounded-lg border px-3 py-1.5 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
        </div>
        <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <Choices s={settings} set={setSettings} logoBusy={logoBusy} onLogo={(f) => void uploadLogo(f, (url) => setSettings((s) => ({ ...s, logo: { url, position: s.logo?.position ?? 'upper-left', on: true } })))} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void add()} disabled={!review?.url || !!uploading || adding}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />} Add to the queue
          </button>
          {!review?.url && <span className="text-[12.5px]" style={soft}>Add your review take first.</span>}
          {uploading && <span className="text-[12.5px]" style={soft}>Waiting for the upload to finish.</span>}
        </div>
      </section>

      <section aria-label="Your videos" className="flex flex-col gap-3">
        <p className="text-[15px] font-bold">Your videos</p>
        {loadError && !needsSql && <p className="text-[13px]" style={{ color: RED }}>{loadError}</p>}
        {edits === null && !loadError && <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading your videos</p>}
        {edits?.length === 0 && <p className="text-[13px]" style={soft}>None yet. Add your first one above.</p>}
        {(edits || []).map((e) => <EditCard key={e.id} e={e} reload={load} uploadLogo={uploadLogo} logoBusy={logoBusy} />)}
      </section>
    </div>
  )
}

function EditCard({ e, reload, uploadLogo, logoBusy }: { e: EditView; reload: () => Promise<void>; uploadLogo: (f: File, then: (url: string) => void) => Promise<void>; logoBusy: boolean }) {
  const st = STATUS[e.status] || { words: e.status, color: 'var(--text-3)' }
  const [s, setS] = useState<EditSettings>(e.settings)
  const [changed, setChanged] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [work, setWork] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => { if (!changed) setS(e.settings) }, [e.settings, changed])

  const act = async (what: string, body: Record<string, unknown>, ok?: string) => {
    setWork(what)
    try {
      const d = await api(body)
      if (d.said) setSaid(d.said)
      if (ok) toast.success(ok)
      await reload()
      return d
    } catch (err) { toast.error(err instanceof Error ? err.message : 'That did not work.'); return null } finally { setWork(null) }
  }
  const save = async () => { const d = await act('save', { action: 'change', id: e.id, settings: s }); if (d) setChanged(false); return !!d }
  const makeAgain = async () => { if (changed && !(await save())) return; await act('make', { action: 'make', id: e.id }, 'In line to be made again.') }
  const sendToDrop = async () => {
    if (!e.outputs) return
    setWork('drop')
    try {
      const r = await fetch('/api/drop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'draft_start', name: 'Drop' }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.id) throw new Error(d.error || 'Drop did not open.')
      for (const f of Object.keys(e.outputs) as Format[]) {
        const o = e.outputs[f]!
        const ar = await fetch('/api/drop', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'draft_add', dropId: d.id, item: { fileName: `${e.name || 'Review'} (${f}).mp4`, sourceUrl: o.url, mimeType: 'video/mp4', durationSeconds: o.seconds, width: f === 'wide' ? 1920 : 1080, height: f === 'wide' ? 1080 : 1920, kind: f === 'wide' ? 'long' : 'vertical', asin: e.product || undefined, title: e.name || undefined } }),
        })
        const ad = await ar.json().catch(() => ({}))
        if (!ar.ok) throw new Error(ad.error || 'Drop did not take it.')
      }
      toast.success(e.settings.kind === 'trybe'
        ? <span>In your Drop. <a href="/drop" className="underline font-semibold">Open Drop</a> and pick the TRYBE brand it is for.</span>
        : <span>In your Drop. <a href="/drop" className="underline font-semibold">Open Drop</a> to send it to Amazon and YouTube, and to make its Shorts, TikTok and Reels.</span>, { duration: 12000 })
    } catch (err) { toast.error(`Not sent to Drop: ${err instanceof Error ? err.message : 'unknown'}`) } finally { setWork(null) }
  }
  const outs = (Object.entries(e.outputs || {}) as [Format, { url: string; seconds: number }][])

  return (
    <article className={card} style={cardStyle}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[14.5px] font-bold">{e.name || 'Review'}</p>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>{KIND_WORDS[e.settings.kind].name}</span>
        <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ color: st.color, background: 'var(--surface-2)' }}>
          {st.busy && <Loader2 size={11} className="animate-spin" />}{e.status === 'done' && <Check size={11} />}{e.status === 'failed' && <AlertTriangle size={11} />} {st.words}
        </span>
        <span className="text-[11.5px]" style={soft}>added {new Date(e.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      {e.note && <p className="text-[12.5px] mt-1" style={{ color: e.status === 'failed' ? RED : 'var(--text-2)' }}>{e.note}</p>}

      {e.status === 'done' && outs.length > 0 && (
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          {outs.map(([f, o]) => (
            <div key={f}>
              <p className="text-[12px] font-semibold mb-1" style={soft}>{FORMAT_WORDS[f]}</p>
              <video src={o.url} controls preload="metadata" className="w-full rounded-lg bg-black" style={{ maxHeight: 360 }} />
              <a href={o.url} download className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold underline" style={{ color: PURPLE }}><Download size={12} /> Download</a>
            </div>
          ))}
        </div>
      )}
      {e.status === 'done' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void sendToDrop()} disabled={!!work} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
            {work === 'drop' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send to Drop
          </button>
          {!e.rawDeleted && <button type="button" onClick={() => void act('finish', { action: 'finish', id: e.id }, 'Your raw takes are deleted. The finished video stays.')} disabled={!!work} className="rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border)' }}>I am happy with it: delete the raw takes</button>}
        </div>
      )}
      {e.status === 'failed' && (
        <button type="button" onClick={() => void act('retry', { action: 'retry', id: e.id }, 'Trying again.')} disabled={!!work || e.rawDeleted} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border)' }}><RotateCcw size={13} /> Try again</button>
      )}

      {(e.cuts.length > 0 || e.broll.length > 0) && (
        <details className="mt-3">
          <summary className="text-[13px] font-semibold cursor-pointer">What MVP cut ({e.cuts.filter((c) => !c.restored).length}){e.hasBroll ? ` and where the B-roll went (${e.broll.filter((b) => !b.off).length})` : ''}</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {e.cuts.map((c) => (
              <li key={`c${c.k}`} className="rounded-lg border p-2 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
                <span className="font-semibold">{c.at}</span> <span style={{ textDecoration: c.restored ? 'none' : 'line-through', color: 'var(--text-2)' }}>&ldquo;{c.text}&rdquo;</span>
                <span className="block" style={soft}>{c.restored ? 'You put this back.' : c.why}</span>
                <button type="button" disabled={!!work || e.rawDeleted} onClick={() => void act('cut', { action: 'change', id: e.id, ...(c.restored ? { cut: [c.k] } : { restore: [c.k] }) })} className="mt-0.5 underline font-semibold" style={{ color: PURPLE }}>{c.restored ? 'Cut it again' : 'Put it back'}</button>
              </li>
            ))}
            {e.broll.map((b) => (
              <li key={`b${b.k}`} className="rounded-lg border p-2 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
                <span className="font-semibold">{b.at}</span> B-roll: <b>{b.shot}</b>{b.line && <span style={soft}> over &ldquo;{b.line}&rdquo;</span>}
                <button type="button" disabled={!!work || e.rawDeleted} onClick={() => void act('broll', { action: 'change', id: e.id, ...(b.off ? { placementOn: [b.k] } : { placementOff: [b.k] }) })} className="ml-2 underline font-semibold" style={{ color: PURPLE }}>{b.off ? 'Use it' : 'Take it out'}</button>
              </li>
            ))}
          </ul>
          <p className="text-[12px] mt-1" style={soft}>Changes here show once you press Make it again.</p>
        </details>
      )}

      {['done', 'failed', 'ready_to_make'].includes(e.status) && e.cuts !== undefined && (
        <details className="mt-3">
          <summary className="text-[13px] font-semibold cursor-pointer">Change the look</summary>
          <div className="mt-2">
            <Choices s={s} set={(v) => { setS(v); setChanged(true) }} logoBusy={logoBusy} onLogo={(f) => void uploadLogo(f, (url) => { setS((x) => ({ ...x, logo: { url, position: x.logo?.position ?? 'upper-left', on: true } })); setChanged(true) })} />
          </div>
        </details>
      )}

      {e.status !== 'queued' && e.status !== 'reading' && !e.rawDeleted && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input value={prompt} onChange={(ev) => setPrompt(ev.target.value)} placeholder={'Tell MVP what to change: "logo top left", "keep the part about the price"'}
              className="flex-1 min-w-[14rem] rounded-lg border px-3 py-1.5 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            <button type="button" disabled={!prompt.trim() || !!work} onClick={() => void act('prompt', { action: 'change', id: e.id, prompt }).then((d) => { if (d) { setPrompt(''); setChanged(false) } })}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>
              {work === 'prompt' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Change it
            </button>
          </div>
          {said && <p className="text-[12.5px]" style={{ color: 'var(--text-2)' }}>MVP: {said}</p>}
          {e.status !== 'making' && (
            <button type="button" onClick={() => void makeAgain()} disabled={!!work} className="self-start inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
              {work === 'make' || work === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />} Make it again{changed ? ' with your changes' : ''}
            </button>
          )}
        </div>
      )}
      {e.rawDeleted && e.status === 'done' && <p className="text-[12px] mt-2" style={soft}>The raw takes are deleted, so this one cannot be changed now. The finished video stays for 30 days.</p>}
      <button type="button" onClick={() => { if (confirm('Remove this video, its takes and its finished files?')) void act('remove', { action: 'remove', id: e.id }, 'Removed.') }} disabled={!!work || e.status === 'making'} className="mt-3 inline-flex items-center gap-1 text-[12px] underline" style={soft}><Trash2 size={12} /> Remove</button>
    </article>
  )
}
