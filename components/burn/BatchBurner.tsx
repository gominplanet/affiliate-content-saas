// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BatchBurner — burn a CTA + product link onto up to 5 vertical clips and
// schedule them to Instagram over a time spread. Extracted from Shop Burner so
// Clip Factory (the merged Create → Enhance → Publish tool) can host it. Uses
// the existing /api/instagram/burn-batch engine — no new backend.
'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, CheckCircle, Clock, Instagram, Loader2, Plus, Search, Sparkles, Trash2, UploadCloud, Video } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'

interface ShortItem {
  id: string
  title: string
  thumbnailUrl: string | null
  views: number | null
  productUrl: string | null
  hasVideo: boolean
  youtubeVideoId: string | null
  posted: boolean
}

const POSITIONS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'lower-left', label: 'Lower third', desc: 'Bottom-left — clears Instagram & TikTok UI' },
  { key: 'upper-left', label: 'Upper third', desc: 'Top-left of the screen' },
]
const STYLES: Array<{ key: string; label: string; desc: string }> = [
  { key: 'white-pill', label: 'White on dark', desc: 'White text, dark pill' },
  { key: 'yellow-pill', label: 'Yellow on dark', desc: 'Yellow text, dark pill' },
  { key: 'black-pill', label: 'Black on white', desc: 'Black text, white pill' },
  { key: 'white-shadow', label: 'White + shadow', desc: 'White text, soft shadow, no pill' },
]

// ── Batch & schedule ─────────────────────────────────────────────────────────
interface BatchItem { id: string; url: string | null; uploading: boolean; caption: string; product: string; videoId?: string; label?: string }
interface Job { id: string; caption_text: string; status: string; scheduled_at: string; result_url: string | null; ig_published: boolean; error_message: string | null }

function defaultStartLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'text-[#7C3AED] bg-[#7C3AED]/10',
  processing: 'text-[#ff9500] bg-[#ff9500]/10',
  completed: 'text-[#34c759] bg-[#34c759]/10',
  failed: 'text-[#ff3b30] bg-[#ff3b30]/10',
}

export default function BatchBurner() {
  const supabase = createBrowserClient()
  const [items, setItems] = useState<BatchItem[]>([{ id: crypto.randomUUID(), url: null, uploading: false, caption: 'LINK IN BIO', product: '' }])
  const [bStyle, setBStyle] = useState('white-pill')
  const [bPos, setBPos] = useState('lower-left')
  // CTA on-screen duration for every video in the batch (0 = whole video).
  const [bBurnDuration, setBBurnDuration] = useState<0 | 5 | 10 | 30>(0)
  // Overlay (all videos): a pre-designed CTA box (PNG) or plain caption text —
  // mirrors the single-video burner. Default to the CTA box.
  const [bOverlay, setBOverlay] = useState<'sticker' | 'text'>('sticker')
  const [bBoxUrl, setBBoxUrl] = useState<string | null>(null)       // selected CTA box URL (all videos)
  const [boxes, setBoxes] = useState<Array<{ id: string | null; url: string; tag: string }>>([])
  const [genTag, setGenTag] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [genErr, setGenErr] = useState<string | null>(null)
  // Source: pick from the creator's own Shorts (resolves the stored MP4) or
  // upload files — same options as single-video mode.
  const [bSource, setBSource] = useState<'shorts' | 'upload'>('upload')
  const [shorts, setShorts] = useState<ShortItem[] | null>(null)
  const [shortsQuery, setShortsQuery] = useState('')
  const [hidePosted, setHidePosted] = useState(true) // hide already-posted Shorts from the batch picker by default
  const [addingId, setAddingId] = useState<string | null>(null)
  const [startAt, setStartAt] = useState(defaultStartLocal())
  const [intervalHours, setIntervalHours] = useState(24)
  const [submitting, setSubmitting] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])

  // Load the creator's saved CTA boxes (shared with the single-video burner).
  useEffect(() => {
    let cancelled = false
    fetch('/api/instagram/burn/my-stickers')
      .then(r => r.json())
      .then((d: { stickers?: Array<{ id: string; url: string; tag: string }> }) => {
        if (!cancelled && Array.isArray(d.stickers)) setBoxes(d.stickers)
      })
      .catch(() => { /* non-fatal */ })
    return () => { cancelled = true }
  }, [])

  // Make a CTA box from a typed tag → becomes the active box (all videos).
  async function generateBox() {
    const t = genTag.trim()
    if (!t) { setGenErr('Type a short tag first.'); return }
    setGenLoading(true); setGenErr(null)
    try {
      const res = await fetch('/api/instagram/burn/generate-sticker', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: t }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) throw new Error((d.error as string) || `Failed (HTTP ${res.status})`)
      const url = d.stickerUrl as string
      setBBoxUrl(url)
      setBoxes(prev => [{ id: (d.id as string) ?? null, url, tag: (d.tag as string) || t }, ...prev])
      setGenTag('')
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : 'Could not generate the box')
    } finally { setGenLoading(false) }
  }

  // Discover the creator's own Shorts so they can add them without uploading.
  useEffect(() => {
    let cancelled = false
    fetch('/api/instagram/burn/shorts')
      .then(r => r.json())
      .then((d: { shorts?: ShortItem[] }) => {
        if (cancelled) return
        const list = Array.isArray(d.shorts) ? d.shorts : []
        setShorts(list)
        if (list.some(s => s.hasVideo)) setBSource('shorts') // default to Shorts when any are ready
      })
      .catch(() => { if (!cancelled) setShorts([]) })
    return () => { cancelled = true }
  }, [])

  // Add a Short as a batch item — resolves its stored 9:16 MP4. Capped at 5,
  // de-duped, and a Short with no render shows a clear error.
  async function addShort(s: ShortItem) {
    if (items.filter(it => it.url).length >= 5) { setErr('Up to 5 videos per batch.'); return }
    if (items.some(it => it.videoId === s.id)) return
    setAddingId(s.id); setErr(null)
    try {
      const r = await fetch(`/api/instagram/burn/source?videoId=${encodeURIComponent(s.id)}`)
      const d = await r.json() as { videoUrl?: string | null; noVideo?: boolean }
      if (!d.videoUrl) { setErr(`“${s.title.slice(0, 40)}” has no MP4 yet — download it from YouTube or upload the file.`); return }
      const newItem: BatchItem = { id: crypto.randomUUID(), url: d.videoUrl, uploading: false, caption: 'LINK IN BIO', product: s.productUrl || '', videoId: s.id, label: s.title }
      setItems(prev => {
        // Replace a blank placeholder row if there is one, else append (cap 5).
        const blank = prev.findIndex(it => !it.url && !it.uploading && !it.videoId)
        if (blank >= 0) { const next = [...prev]; next[blank] = newItem; return next }
        return prev.length >= 5 ? prev : [...prev, newItem]
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add that Short')
    } finally { setAddingId(null) }
  }

  const loadJobs = useCallback(async () => {
    try {
      const r = await fetch('/api/instagram/burn-batch')
      const d = await r.json()
      if (Array.isArray(d?.jobs)) setJobs(d.jobs as Job[])
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { loadJobs() }, [loadJobs])

  async function uploadItem(id: string, file: File) {
    if (!file.type.startsWith('video/')) { setErr('Pick a video file.'); return }
    if (file.size > 300 * 1024 * 1024) { setErr('Each video must be under 300MB.'); return }
    setErr(null)
    setItems(prev => prev.map(it => it.id === id ? { ...it, uploading: true } : it))
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      const path = `${user.id}/burner-${crypto.randomUUID()}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('instagram-videos').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'video/mp4' })
      if (upErr) throw new Error(upErr.message)
      const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
      setItems(prev => prev.map(it => it.id === id ? { ...it, url: urlData.publicUrl, uploading: false } : it))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
      setItems(prev => prev.map(it => it.id === id ? { ...it, uploading: false } : it))
    }
  }

  function setField(id: string, field: 'caption' | 'product', value: string) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
  }
  function addItem() { setItems(prev => prev.length >= 5 ? prev : [...prev, { id: crypto.randomUUID(), url: null, uploading: false, caption: 'LINK IN BIO', product: '' }]) }
  function removeItem(id: string) { setItems(prev => prev.length <= 1 ? prev : prev.filter(it => it.id !== id)) }

  const readyItems = items.filter(it => it.url)

  // Exact scheduled time per post — mirrors the server's spread
  // (startMs + i * intervalHours). Shown in the review step so the user
  // confirms exactly what posts and when before anything is queued.
  function scheduledAt(index: number): Date {
    const startMs = startAt && !isNaN(Date.parse(startAt)) ? Date.parse(startAt) : Date.now()
    return new Date(startMs + index * intervalHours * 3600_000)
  }

  // Step 1: open the review panel (no posting happens yet).
  function openReview() {
    if (readyItems.length === 0) { setErr('Upload at least one video.'); return }
    if (bOverlay === 'sticker' && !bBoxUrl) { setErr('Pick a CTA box or make one from text, or switch to caption text.'); return }
    setErr(null); setMsg(null); setReviewing(true)
  }

  // Step 2: explicit confirm — only now do we queue the batch.
  async function confirmSchedule() {
    const ready = items.filter(it => it.url)
    if (ready.length === 0) { setErr('Upload at least one video.'); setReviewing(false); return }
    setSubmitting(true); setErr(null); setMsg(null)
    try {
      const res = await fetch('/api/instagram/burn-batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videos: ready.map(it => ({ videoUrl: it.url, caption: it.caption, product: it.product.trim() || undefined })),
          style: bStyle, position: bPos,
          // CTA box (all videos) when in sticker mode; omit for caption-text mode.
          stickerUrl: bOverlay === 'sticker' ? (bBoxUrl || undefined) : undefined,
          stickerDurationSec: bBurnDuration,
          startAt: new Date(startAt).toISOString(),
          intervalHours,
        }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) throw new Error((d.error as string) || `Failed (HTTP ${res.status})`)
      setMsg(`Scheduled ${d.queued} video${(d.queued as number) > 1 ? 's' : ''}. First posts ${new Date(d.firstAt as string).toLocaleString()}.`)
      setItems([{ id: crypto.randomUUID(), url: null, uploading: false, caption: 'LINK IN BIO', product: '' }])
      setReviewing(false)
      loadJobs()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to queue')
    } finally { setSubmitting(false) }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* Controls — one card per step */}
      <div className="space-y-3">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">1 · Videos <span className="font-normal text-[11px] text-[#86868b]">({items.filter(it => it.url).length}/5)</span></label>
            {bSource === 'upload' && <button onClick={addItem} disabled={items.length >= 5} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C3AED] hover:underline disabled:opacity-40"><Plus size={11} /> Add video</button>}
          </div>

          {/* Source toggle — From my Shorts | Upload (same as single video) */}
          {shorts && shorts.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={() => setBSource('shorts')} className={`text-center px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors ${bSource === 'shorts' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}>From my Shorts</button>
              <button onClick={() => setBSource('upload')} className={`text-center px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors ${bSource === 'upload' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}>Upload</button>
            </div>
          )}

          {/* Shorts picker — click to add (up to 5) */}
          {bSource === 'shorts' && shorts && shorts.length > 0 && (
            <div className="mb-2">
              <div className="relative mb-1.5">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#86868b]" />
                <input type="text" value={shortsQuery} onChange={(e) => setShortsQuery(e.target.value)} placeholder="Search your Shorts…" className="input-field text-[12px] pl-8" />
              </div>
              {shorts.some(s => s.posted) && (
                <label className="flex items-center gap-1.5 mb-1.5 text-[11px] text-[#6e6e73] dark:text-[#ebebf0] cursor-pointer select-none">
                  <input type="checkbox" checked={hidePosted} onChange={e => setHidePosted(e.target.checked)} className="w-3.5 h-3.5 rounded accent-[#7C3AED]" />
                  Hide already-posted
                </label>
              )}
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {shorts.filter(s => (!hidePosted || !s.posted) && (!shortsQuery || s.title.toLowerCase().includes(shortsQuery.toLowerCase()))).slice(0, 40).map(s => {
                  const added = items.some(it => it.videoId === s.id)
                  return (
                    <button key={s.id} onClick={() => addShort(s)} disabled={added || addingId === s.id} className={`w-full flex items-center gap-2 rounded-lg border p-1.5 text-left transition-colors ${added ? 'border-[#34c759]/40 bg-[#34c759]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#7C3AED]'} disabled:opacity-70`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {s.thumbnailUrl ? <img src={s.thumbnailUrl} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" /> : <div className="w-10 h-10 rounded bg-[#1d1d1f]/5 flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{s.title}</p>
                        <p className="text-[10px] text-[#86868b]">{s.hasVideo ? 'Ready to burn' : 'Needs download from YouTube'}{s.posted ? ' · already posted' : ''}</p>
                      </div>
                      <span className="text-[11px] font-semibold flex-shrink-0 pr-1">{addingId === s.id ? <Loader2 size={12} className="animate-spin" /> : added ? <CheckCircle size={13} className="text-[#34c759]" /> : <Plus size={13} className="text-[#7C3AED]" />}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* The chosen videos — caption + product + remove. Upload control only
              in upload mode; shorts-added rows show their title. */}
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={it.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-[#86868b] w-4">{i + 1}.</span>
                  {bSource === 'shorts' || it.videoId ? (
                    <span className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-[12px] ${it.url ? 'border-[#34c759]/40 text-[#34c759]' : 'border-dashed border-gray-300 dark:border-white/15 text-[#86868b]'}`}>
                      {it.url ? <><Video size={12} /> {it.label ? it.label.slice(0, 32) : 'Ready'}</> : 'Pick a Short above'}
                    </span>
                  ) : (
                    <label className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-dashed text-[12px] cursor-pointer ${it.url ? 'border-[#34c759]/40 text-[#34c759]' : 'border-gray-300 dark:border-white/15 text-[#6e6e73] dark:text-[#ebebf0] hover:border-[#7C3AED]'}`}>
                      <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadItem(it.id, f); e.currentTarget.value = '' }} />
                      {it.uploading ? <><Loader2 size={12} className="animate-spin" /> Uploading…</> : it.url ? <><Video size={12} /> Ready</> : <><UploadCloud size={12} /> Upload</>}
                    </label>
                  )}
                  {items.length > 1 && <button onClick={() => removeItem(it.id)} className="text-[#86868b] hover:text-[#ff3b30] p-1"><Trash2 size={13} /></button>}
                </div>
                <input type="text" value={it.caption} onChange={(e) => setField(it.id, 'caption', e.target.value)} maxLength={60} placeholder="Caption text (e.g. LINK IN BIO)" className="input-field text-[12px]" />
                <input type="text" value={it.product} onChange={(e) => setField(it.id, 'product', e.target.value)} placeholder="Product ASIN or URL (optional)" className="input-field text-[12px]" />
              </div>
            ))}
          </div>
          {bSource === 'shorts' && items.filter(it => it.url).length === 0 && (
            <p className="text-[11px] text-[#86868b] mt-1.5">Pick a Short above to add it (up to 5).</p>
          )}
        </div>

        {/* Overlay (all videos) — CTA box or caption text, same as single video */}
        <div className="card p-4">
          <label className="block text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">2 · Overlay (all videos)</label>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button onClick={() => setBOverlay('sticker')} className={`text-center px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors ${bOverlay === 'sticker' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}>CTA box</button>
            <button onClick={() => setBOverlay('text')} className={`text-center px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors ${bOverlay === 'text' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}>Caption text</button>
          </div>
          {bOverlay === 'text' ? (
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Each video burns its own caption from the “Caption text” field above.</p>
          ) : (
            <div className="rounded-lg border border-[#7C3AED]/15 bg-[#7C3AED]/[0.03] p-2.5">
              {/* Make a CTA box from a typed tag */}
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5"><Sparkles size={11} className="text-[#7C3AED]" /> Make one from text</span>
              <div className="flex gap-1.5">
                <input type="text" value={genTag} onChange={(e) => setGenTag(e.target.value)} maxLength={40} placeholder="e.g. BUY BEFORE IT'S GONE" className="input-field text-[12px] flex-1" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void generateBox() } }} />
                <button onClick={() => void generateBox()} disabled={genLoading || !genTag.trim()} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50">
                  {genLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Make
                </button>
              </div>
              {genErr && <p className="text-[10px] text-[#ff3b30] mt-1">{genErr}</p>}
              <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5">1–6 words. Burned onto every video in this batch. Saved to “My boxes” to reuse anytime.</p>

              {boxes.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">My boxes</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {boxes.map(b => (
                      <button
                        key={b.url}
                        onClick={() => setBBoxUrl(b.url)}
                        title={b.tag || 'CTA box'}
                        className={`p-1.5 rounded-lg border transition-colors ${bBoxUrl === b.url ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={b.url} alt={b.tag || 'CTA box'} className="w-full h-auto max-h-16 object-contain rounded bg-[#1d1d1f]/5" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Shared style */}
        <div className="card p-4">
          <label className="block text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">3 · Style (all videos)</label>
          <div className="grid grid-cols-2 gap-2">
            {STYLES.map(s => (
              <button key={s.key} onClick={() => setBStyle(s.key)} className={`text-left p-2 rounded-lg border transition-colors ${bStyle === s.key ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}>
                <span className="block text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Shared position */}
        <div className="card p-4">
          <label className="block text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">4 · Position (all videos)</label>
          <div className="grid grid-cols-2 gap-2">
            {POSITIONS.map(p => (
              <button key={p.key} onClick={() => setBPos(p.key)} className={`text-left p-2.5 rounded-lg border transition-colors ${bPos === p.key ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}>
                <span className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{p.label}</span>
              </button>
            ))}
          </div>
          {/* How long the CTA box shows on every video in the batch. */}
          <label className="block text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mt-3 mb-1.5">How long it shows</label>
          <div className="grid grid-cols-4 gap-1.5">
            {([[5, '5s'], [10, '10s'], [30, '30s'], [0, 'Whole video']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setBBurnDuration(val)}
                className={`px-1.5 py-2 rounded-lg border text-[12px] font-medium transition-colors ${bBurnDuration === val ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Schedule */}
        <div className="card p-4">
          <label className="block text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">5 · Schedule</label>
          <div className="flex flex-col gap-2">
            <div>
              <span className="block text-[11px] text-[#86868b] mb-1">First post at</span>
              <input type="datetime-local" value={startAt} min={defaultStartLocal()} onChange={(e) => setStartAt(e.target.value)} className="input-field text-sm w-full" />
            </div>
            <div>
              <span className="block text-[11px] text-[#86868b] mb-1">Then one every…</span>
              <select value={intervalHours} onChange={(e) => setIntervalHours(Number(e.target.value))} className="input-field text-sm">
                <option value={0}>Post all now (as ready)</option>
                <option value={6}>6 hours</option>
                <option value={12}>12 hours</option>
                <option value={24}>1 day</option>
                <option value={48}>2 days</option>
                <option value={72}>3 days</option>
                <option value={168}>1 week</option>
              </select>
            </div>
          </div>
        </div>

        {err && <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {err}</p>}
        {msg && <p className="text-xs text-[#34c759] flex items-center gap-1.5"><CheckCircle size={12} /> {msg}</p>}

        <button onClick={openReview} disabled={submitting || !items.some(it => it.url)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50 transition-colors w-full justify-center">
          <Clock size={14} /> Review &amp; schedule
        </button>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] text-center">You’ll review every post before anything is scheduled. Each video is then burned, captioned, and posted to Instagram at its scheduled time.</p>
      </div>

      {/* Queue */}
      <div className="card p-5 lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Queue</h3>
          <button onClick={loadJobs} className="text-[11px] text-[#7C3AED] hover:underline">Refresh</button>
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">No scheduled videos yet.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map(j => (
              <div key={j.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-white/10 p-2.5">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{j.caption_text}</p>
                  <p className="text-[10px] text-[#86868b]">{new Date(j.scheduled_at).toLocaleString()}{j.error_message ? ` · ${j.error_message.slice(0, 60)}` : ''}</p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_STYLE[j.status] || 'text-[#86868b] bg-gray-100'}`}>{j.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review & confirm — explicit approval before anything is scheduled */}
      {reviewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !submitting && setReviewing(false)}>
          <div className="card max-w-lg w-full max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Review before scheduling</h3>
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-3">
              These {readyItems.length} post{readyItems.length > 1 ? 's' : ''} will be burned and published to your connected Instagram at the times below. Nothing is posted until you confirm.
            </p>
            <div className="space-y-2 mb-4">
              {readyItems.map((it, i) => (
                <div key={it.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Post {i + 1} · “{it.caption.trim() || 'LINK IN BIO'}”</span>
                    <span className="text-[10px] font-medium text-[#7C3AED] flex-shrink-0">{scheduledAt(i).toLocaleString()}</span>
                  </div>
                  <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                    {it.product.trim()
                      ? <>Reel caption auto-written from <span className="font-medium">{it.product.trim().slice(0, 60)}</span> (3 hashtags + #ad).</>
                      : <>No product set — the on-screen caption is used as the Reel caption.</>}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mb-4">
              Overlay: {bOverlay === 'sticker' ? 'CTA box' : 'Caption text'}{bOverlay === 'text' ? ` · Style: ${STYLES.find(s => s.key === bStyle)?.label}` : ''} · Position: {POSITIONS.find(p => p.key === bPos)?.label}
            </p>
            {err && <p className="text-xs text-[#ff3b30] flex items-center gap-1.5 mb-3"><AlertCircle size={12} /> {err}</p>}
            <div className="flex gap-2">
              <button onClick={() => setReviewing(false)} disabled={submitting} className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">
                Back
              </button>
              <button onClick={confirmSchedule} disabled={submitting} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ background: 'linear-gradient(90deg, #F58529, #DD2A7B, #8134AF)' }}>
                {submitting ? <><Loader2 size={14} className="animate-spin" /> Scheduling…</> : <><Instagram size={14} /> Confirm &amp; schedule {readyItems.length} post{readyItems.length > 1 ? 's' : ''}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
