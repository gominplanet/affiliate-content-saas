// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// UploadStage — the "MVP as origin" upload path. Upload a finished horizontal
// video, add a call-to-action (a designed box from the gallery, or your own
// words), drag it exactly where you want it on the frame, then publish straight
// to YouTube. Used inside Launchpad and on the standalone CTA Studio page.
'use client'

import { useMemo, useRef, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { Upload, Loader2, Download, Youtube, Check, Type, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { CTA_STICKERS, ctaStickerUrl } from '@/lib/cta-stickers'

type Style = 'lowerthird' | 'endcard'
type Source = 'design' | 'words'

// Colorways for a "your words" badge.
const WORD_STYLES: { key: string; label: string; bg: string; fg: string }[] = [
  { key: 'dark', label: 'White on dark', bg: '#111318', fg: '#FFFFFF' },
  { key: 'gold', label: 'Gold', bg: '#F4B400', fg: '#111318' },
  { key: 'red', label: 'Red', bg: '#E0554B', fg: '#FFFFFF' },
  { key: 'purple', label: 'Purple', bg: '#7C3AED', fg: '#FFFFFF' },
]

// Render a rounded-pill badge PNG (transparent background) from words, so it can
// be overlaid on the video like any designed sticker.
function renderWordBadge(textUp: string, bg: string, fg: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const scale = 3
    const fontPx = 64
    const padX = 48, padY = 28
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')
    if (!ctx) return resolve(null)
    const font = `800 ${fontPx}px Arial, sans-serif`
    ctx.font = font
    const w = Math.ceil(ctx.measureText(textUp).width) + padX * 2
    const h = fontPx + padY * 2
    c.width = w * scale; c.height = h * scale
    const g = c.getContext('2d')
    if (!g) return resolve(null)
    g.scale(scale, scale)
    const r = h / 2
    g.fillStyle = bg
    g.beginPath()
    g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.closePath()
    g.fill()
    g.font = font; g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(textUp, w / 2, h / 2 + 2)
    c.toBlob(b => resolve(b), 'image/png')
  })
}

function probe(file: File): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'; v.muted = true
    let settled = false
    const done = (r: { width: number; height: number; duration: number }) => {
      if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(r)
    }
    v.onloadedmetadata = () => done({ width: v.videoWidth || 0, height: v.videoHeight || 0, duration: Number.isFinite(v.duration) ? v.duration : 0 })
    v.onerror = () => done({ width: 0, height: 0, duration: 0 })
    v.src = url
  })
}

const label = { color: 'var(--fg)' } as const
const muted = { color: 'var(--fg-muted)' } as const

export default function UploadStage() {
  const supabase = useMemo(() => createBrowserClient(), [])
  const fileRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null)

  const [uploading, setUploading] = useState(false)
  const [source, setSource] = useState<{ url: string; durationSec: number; name: string } | null>(null)

  const [ctaSource, setCtaSource] = useState<Source>('design')
  const [stickerId, setStickerId] = useState<string>(CTA_STICKERS[0]?.id || '')
  const [words, setWords] = useState('')
  const [wordStyle, setWordStyle] = useState(WORD_STYLES[0].key)
  const [wordBadgeUrl, setWordBadgeUrl] = useState<string | null>(null)
  const [making, setMaking] = useState(false)

  const [widthPct, setWidthPct] = useState<number>(0.4)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0.55, y: 0.74 })
  const [style, setStyle] = useState<Style>('lowerthird')

  const [rendering, setRendering] = useState(false)
  const [rendered, setRendered] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState<string | null>(null)

  const gallerySticker = CTA_STICKERS.find(s => s.id === stickerId)
  const activeBadgeUrl = ctaSource === 'words'
    ? wordBadgeUrl
    : (gallerySticker ? ctaStickerUrl(gallerySticker.file) : null)

  async function onPick(file: File) {
    if (!file.type.startsWith('video/')) { toast.error('Please pick a video file (MP4 works best).'); return }
    if (file.size > 300 * 1024 * 1024) { toast.error(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — keep it under 300MB.`); return }
    setUploading(true); setRendered(null); setPublished(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const dims = await probe(file)
      if (dims.width > 0 && dims.height > 0 && dims.height > dims.width) {
        toast.error('This looks vertical. This path is for horizontal videos — use Clip Factory for Shorts.')
        setUploading(false); return
      }
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      const path = `${user.id}/cta-${crypto.randomUUID()}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('instagram-videos').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'video/mp4' })
      if (upErr) throw new Error(upErr.message || 'Upload failed')
      const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
      setSource({ url: urlData.publicUrl, durationSec: Math.round(dims.duration), name: file.name })
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''))
      toast.success('Uploaded. Add your CTA and drag it into place.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally { setUploading(false) }
  }

  async function makeWordBadge() {
    const t = words.trim().toUpperCase()
    if (!t) { toast.error('Type your CTA words first'); return }
    setMaking(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const st = WORD_STYLES.find(s => s.key === wordStyle) || WORD_STYLES[0]
      const blob = await renderWordBadge(t, st.bg, st.fg)
      if (!blob) throw new Error('Could not build the badge')
      const path = `${user.id}/cta-word-${crypto.randomUUID()}.png`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('instagram-videos').upload(path, blob, { cacheControl: '3600', upsert: false, contentType: 'image/png' })
      if (upErr) throw new Error(upErr.message || 'Upload failed')
      const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
      setWordBadgeUrl(urlData.publicUrl)
      toast.success('Badge ready. Drag it into place.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not make the badge')
    } finally { setMaking(false) }
  }

  // Drag the badge around the preview. Position is stored as a top-left fraction.
  function onBadgeDown(e: React.PointerEvent) {
    const stage = stageRef.current; if (!stage) return
    const rect = stage.getBoundingClientRect()
    dragOffset.current = { dx: e.clientX - (rect.left + pos.x * rect.width), dy: e.clientY - (rect.top + pos.y * rect.height) }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onBadgeMove(e: React.PointerEvent) {
    if (!dragOffset.current) return
    const stage = stageRef.current; if (!stage) return
    const rect = stage.getBoundingClientRect()
    const x = (e.clientX - dragOffset.current.dx - rect.left) / rect.width
    const y = (e.clientY - dragOffset.current.dy - rect.top) / rect.height
    setPos({ x: Math.max(0, Math.min(0.98, x)), y: Math.max(0, Math.min(0.98, y)) })
  }
  function onBadgeUp() { dragOffset.current = null }

  async function render() {
    if (!source) { toast.error('Upload a video first'); return }
    if (!activeBadgeUrl) { toast.error(ctaSource === 'words' ? 'Create your badge first' : 'Pick a CTA design'); return }
    setRendering(true); setRendered(null); setPublished(null)
    try {
      const r = await fetch('/api/youtube-studio/cta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: source.url, durationSec: source.durationSec, style, stickerUrl: activeBadgeUrl, widthPct, xPct: pos.x, yPct: pos.y }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error || 'Render failed')
      setRendered(j.url)
      toast.success('CTA burned in. Preview it below.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Render failed')
    } finally { setRendering(false) }
  }

  async function publish() {
    if (!rendered) return
    if (!title.trim()) { toast.error('Add a title first'); return }
    setPublishing(true)
    try {
      const r = await fetch('/api/youtube/upload-video', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: rendered, title: title.trim(), privacyStatus: 'private' }),
      })
      const j = await r.json().catch(() => ({}))
      if (j.notEnabled) { toast.error("Publishing to YouTube isn't switched on yet — it's coming soon."); return }
      if (j.reconnectRequired) { toast.error('Reconnect YouTube to grant upload permission, then try again.'); return }
      if (!r.ok || !j.url) throw new Error(j.error || 'Publish failed')
      setPublished(j.url)
      toast.success('Published to YouTube as private. Review it, then make it public.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publish failed')
    } finally { setPublishing(false) }
  }

  return (
    <div className="space-y-5">
      {/* 1. Upload */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold mb-3" style={label}>Upload your video</h2>
        <input ref={fileRef} type="file" accept="video/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) void onPick(f); e.currentTarget.value = '' }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border disabled:opacity-60"
          style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}>
          {uploading ? <><Loader2 size={15} className="animate-spin" /> Uploading…</> : <><Upload size={15} /> Choose a file</>}
        </button>
        {source && <p className="text-[12px] mt-2" style={muted}>{source.name} · {source.durationSec}s</p>}
      </div>

      {/* 2. CTA */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-sm font-semibold" style={label}>Design the CTA</h2>
          <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            {(['design', 'words'] as Source[]).map(o => (
              <button key={o} type="button" onClick={() => setCtaSource(o)}
                className="px-3 py-1.5 text-[12px] font-medium inline-flex items-center gap-1.5"
                style={{ background: ctaSource === o ? 'rgba(124,58,237,0.10)' : 'transparent', color: ctaSource === o ? '#7C3AED' : 'var(--fg-muted)' }}>
                {o === 'design' ? <><Wand2 size={13} /> CTA designs</> : <><Type size={13} /> Your words</>}
              </button>
            ))}
          </div>
        </div>

        {/* Live preview with a draggable badge */}
        {source && (
          <div ref={stageRef} className="relative w-full rounded-xl overflow-hidden border mb-3 select-none" style={{ borderColor: 'var(--border)', aspectRatio: '16 / 9', background: '#000', touchAction: 'none' }}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={source.url} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-contain" />
            {activeBadgeUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeBadgeUrl} alt="CTA" draggable={false}
                onPointerDown={onBadgeDown} onPointerMove={onBadgeMove} onPointerUp={onBadgeUp}
                className="absolute cursor-move"
                style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, width: `${widthPct * 100}%`, touchAction: 'none' }} />
            )}
            <span className="absolute left-2 bottom-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>Drag the CTA to place it</span>
          </div>
        )}

        {ctaSource === 'design' ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-60 overflow-y-auto pr-1">
            {CTA_STICKERS.map(s => {
              const on = stickerId === s.id
              return (
                <button key={s.id} type="button" onClick={() => setStickerId(s.id)} title={s.label}
                  className="rounded-lg border p-1.5 flex items-center justify-center"
                  style={{ borderColor: on ? '#7C3AED' : 'var(--border)', borderWidth: on ? 2 : 1, background: 'var(--bg)', aspectRatio: '1 / 1' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ctaStickerUrl(s.file)} alt={s.label} className="max-w-full max-h-full object-contain" />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-[12px] font-medium" style={muted}>What should it say?</label>
              <input value={words} onChange={e => setWords(e.target.value)} maxLength={40}
                placeholder="SHOP MY STOREFRONT"
                className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }} />
            </div>
            <div className="flex flex-wrap gap-2">
              {WORD_STYLES.map(s => (
                <button key={s.key} type="button" onClick={() => setWordStyle(s.key)}
                  className="px-2.5 py-1.5 rounded-lg border text-[12px] font-semibold"
                  style={{ background: s.bg, color: s.fg, outline: wordStyle === s.key ? '2px solid #7C3AED' : 'none', outlineOffset: 1, borderColor: 'transparent' }}>
                  {s.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void makeWordBadge()} disabled={making || !words.trim()}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-2 rounded-lg border disabled:opacity-60"
              style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}>
              {making ? <><Loader2 size={14} className="animate-spin" /> Building…</> : <><Type size={14} /> {wordBadgeUrl ? 'Update badge' : 'Create badge'}</>}
            </button>
          </div>
        )}

        {/* Size + timing */}
        <div className="flex items-center gap-3 mt-3">
          <span className="text-[12px]" style={muted}>Size</span>
          <input type="range" min={0.2} max={0.8} step={0.05} value={widthPct}
            onChange={e => setWidthPct(Number(e.target.value))} className="flex-1 accent-[#7C3AED]" />
          <span className="text-[12px] tabular-nums" style={muted}>{Math.round(widthPct * 100)}%</span>
        </div>
        <div className="flex gap-2 mt-3">
          {(['lowerthird', 'endcard'] as Style[]).map(s => (
            <button key={s} type="button" onClick={() => setStyle(s)}
              className="flex-1 px-3 py-2 rounded-lg border text-sm font-medium"
              style={{ borderColor: style === s ? '#7C3AED' : 'var(--border)', borderWidth: style === s ? 2 : 1, color: 'var(--fg)' }}>
              {s === 'lowerthird' ? 'Show early (~10s)' : 'End card (last 8s)'}
            </button>
          ))}
        </div>

        <button onClick={() => void render()} disabled={rendering || !source || !activeBadgeUrl}
          className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#7C3AED,#C026D3)' }}>
          {rendering ? <><Loader2 size={15} className="animate-spin" /> Burning in…</> : <>Render CTA</>}
        </button>
      </div>

      {/* 3. Result */}
      {rendered && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-3" style={label}>Preview & publish</h2>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={rendered} controls className="w-full rounded-xl border" style={{ borderColor: 'var(--border)' }} />
          <div className="mt-3">
            <label className="text-[12px] font-medium" style={muted}>Video title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={100}
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }} />
          </div>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <a href={rendered} download
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border"
              style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}>
              <Download size={15} /> Download
            </a>
            <button onClick={() => void publish()} disabled={publishing || !title.trim()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: '#FF0000' }}>
              {publishing ? <><Loader2 size={15} className="animate-spin" /> Publishing…</> : <><Youtube size={15} /> Publish to YouTube</>}
            </button>
          </div>
          {published && (
            <p className="text-[13px] mt-3 inline-flex items-center gap-1.5" style={{ color: '#10B981' }}>
              <Check size={14} /> Published as private. <a href={published} target="_blank" rel="noreferrer" className="underline">Open on YouTube</a>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
