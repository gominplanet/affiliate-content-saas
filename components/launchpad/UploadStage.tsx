// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// UploadStage — the "MVP as origin" upload path. Upload a finished horizontal
// video, burn a branded call-to-action onto it (lower third or end card),
// preview it, download it, and publish it straight to YouTube. Used inside
// Launchpad (as the "start from a file" entry) and on the standalone page.
'use client'

import { useMemo, useRef, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { Upload, Loader2, Download, Youtube, Check } from 'lucide-react'
import { toast } from 'sonner'

type Style = 'lowerthird' | 'endcard'

// Measure a video file client-side (dimensions + duration) so we can size the
// CTA window and warn on portrait uploads without a round trip.
function probe(file: File): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'; v.muted = true
    let settled = false
    const done = (r: { width: number; height: number; duration: number }) => {
      if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(r)
    }
    v.onloadedmetadata = () => done({
      width: v.videoWidth || 0, height: v.videoHeight || 0,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
    })
    v.onerror = () => done({ width: 0, height: 0, duration: 0 })
    v.src = url
  })
}

const label = { color: 'var(--fg)' } as const
const muted = { color: 'var(--fg-muted)' } as const

export default function UploadStage() {
  const supabase = useMemo(() => createBrowserClient(), [])
  const fileRef = useRef<HTMLInputElement>(null)

  const [uploading, setUploading] = useState(false)
  const [source, setSource] = useState<{ url: string; durationSec: number; name: string } | null>(null)
  const [text, setText] = useState('')
  const [subtext, setSubtext] = useState('')
  const [style, setStyle] = useState<Style>('lowerthird')

  const [rendering, setRendering] = useState(false)
  const [rendered, setRendered] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState<string | null>(null)

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
      toast.success('Uploaded. Add your CTA and render.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally { setUploading(false) }
  }

  async function render() {
    if (!source) { toast.error('Upload a video first'); return }
    if (!text.trim()) { toast.error('Add your CTA text'); return }
    setRendering(true); setRendered(null); setPublished(null)
    try {
      const r = await fetch('/api/youtube-studio/cta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: source.url, durationSec: source.durationSec, text: text.trim(), subtext: subtext.trim(), style }),
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
        <h2 className="text-sm font-semibold mb-3" style={label}>Design the CTA</h2>
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-medium" style={muted}>Main line</label>
            <input value={text} onChange={e => setText(e.target.value)} maxLength={60}
              placeholder="Shop my Amazon storefront"
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }} />
          </div>
          <div>
            <label className="text-[12px] font-medium" style={muted}>Subtext (optional)</label>
            <input value={subtext} onChange={e => setSubtext(e.target.value)} maxLength={80}
              placeholder="Link in the description"
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }} />
          </div>
          <div className="flex gap-2">
            {(['lowerthird', 'endcard'] as Style[]).map(s => (
              <button key={s} type="button" onClick={() => setStyle(s)}
                className="flex-1 px-3 py-2 rounded-lg border text-sm font-medium"
                style={{ borderColor: style === s ? '#7C3AED' : 'var(--border)', borderWidth: style === s ? 2 : 1, color: 'var(--fg)' }}>
                {s === 'lowerthird' ? 'Lower third (early)' : 'End card (last 8s)'}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => void render()} disabled={rendering || !source || !text.trim()}
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
