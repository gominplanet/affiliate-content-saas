'use client'

/**
 * Instagram Burner — upload a vertical video and burn a caption (e.g.
 * "LINK IN BIO") into the lower third via Cloudinary, then preview + download
 * the captioned video to post on Reels / Stories / TikTok. Pro-only.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase/client'
import Header from '@/components/layout/Header'
import { effectiveTier } from '@/lib/view-as'
import { Flame, Loader2, Sparkles, Download, AlertCircle, UploadCloud, Video } from 'lucide-react'

const CAPTION_PRESETS = ['LINK IN BIO', 'LINK IN BIO 👆', 'FULL REVIEW ON YOUTUBE', 'WATCH THE FULL VIDEO', 'FOLLOW FOR MORE']
const POSITIONS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'lower-third', label: 'Lower third', desc: 'Recommended — clears IG’s buttons' },
  { key: 'bottom', label: 'Bottom', desc: 'Near the bottom edge' },
  { key: 'center', label: 'Center', desc: 'Middle of the screen' },
  { key: 'top', label: 'Top', desc: 'Upper area' },
]

export default function InstagramBurnerPage() {
  const supabase = createBrowserClient()
  const [tier, setTier] = useState('trial')
  const [loading, setLoading] = useState(true)

  const [caption, setCaption] = useState('LINK IN BIO')
  const [position, setPosition] = useState('lower-third')

  const [uploading, setUploading] = useState(false)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [burning, setBurning] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    let resolvedTier = 'trial'
    if (user) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).single()
      resolvedTier = (data?.tier as string) || 'trial'
    }
    setTier(effectiveTier(resolvedTier))
    setLoading(false)
  }, [supabase])
  useEffect(() => { load() }, [load])

  const isPro = tier === 'pro' || tier === 'admin'

  async function handleUpload(file: File) {
    setError(null)
    setResultUrl(null)
    if (!file.type.startsWith('video/')) { setError('Please select a video file (MP4 recommended).'); return }
    if (file.size > 300 * 1024 * 1024) { setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — keep it under 300MB.`); return }
    setUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      // Match the proven IG-upload path shape ({uid}/{file}) — the bucket's RLS
      // policy only accepts the user id as the first folder, no extra subfolder.
      const path = `${user.id}/burner-${crypto.randomUUID()}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('instagram-videos').upload(path, file, {
        cacheControl: '3600', upsert: false, contentType: file.type || 'video/mp4',
      })
      if (upErr) throw new Error(upErr.message || 'Upload failed')
      const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
      setSourceUrl(urlData.publicUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function burn() {
    if (!sourceUrl) { setError('Upload a video first.'); return }
    setBurning(true); setError(null); setResultUrl(null)
    try {
      const res = await fetch('/api/instagram/burn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: sourceUrl, caption: caption.trim() || 'LINK IN BIO', position }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) throw new Error((d.error as string) || `Failed (HTTP ${res.status})`)
      setResultUrl(d.url as string)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Burn failed')
    } finally {
      setBurning(false)
    }
  }

  async function download() {
    if (!resultUrl) return
    try {
      const res = await fetch(resultUrl)
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `captioned-${Date.now()}.mp4`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(href)
    } catch { window.open(resultUrl, '_blank') }
  }

  return (
    <>
      <Header
        title="Instagram Burner"
        subtitle="Upload a vertical video and burn a caption (like “LINK IN BIO”) into it — then download it for Reels, Stories, or TikTok."
      />

      {!isPro && (
        <div className="card p-5 mb-6 flex items-start gap-3" style={{ background: 'linear-gradient(180deg, rgba(0,113,227,0.05) 0%, transparent 100%)', borderColor: 'rgba(0,113,227,0.25)' }}>
          <div className="w-9 h-9 rounded-full bg-[#0071e3]/15 flex items-center justify-center flex-shrink-0">
            <Sparkles size={18} className="text-[#0071e3]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Instagram Burner is a Pro feature</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 mb-3">Add an on-screen “Link in bio” caption to your videos and download them ready to post.</p>
            <Link href="/pricing" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0062c4]"><Sparkles size={11} /> Upgrade to Pro</Link>
          </div>
        </div>
      )}

      <div className={`max-w-4xl ${!isPro ? 'opacity-60 pointer-events-none' : ''}`}>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#86868b] py-12 justify-center"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Controls */}
            <div className="card p-5 space-y-4">
              {/* Upload */}
              <div>
                <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">1. Your video <span className="font-normal text-[#86868b]">(vertical, under 300MB)</span></label>
                <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-gray-300 dark:border-white/15 text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#0071e3] transition-colors disabled:opacity-60"
                >
                  {uploading ? <><Loader2 size={14} className="animate-spin" /> Uploading…</> : sourceUrl ? <><Video size={14} className="text-[#34c759]" /> Video ready — pick another</> : <><UploadCloud size={14} /> Upload video</>}
                </button>
              </div>

              {/* Caption */}
              <div>
                <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">2. Caption text</label>
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={60}
                  className="input-field text-sm"
                  placeholder="LINK IN BIO"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {CAPTION_PRESETS.map(p => (
                    <button key={p} onClick={() => setCaption(p)} className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${caption === p ? 'border-[#0071e3] bg-[#0071e3]/5 text-[#0071e3]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}>{p}</button>
                  ))}
                </div>
              </div>

              {/* Position */}
              <div>
                <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">3. Position</label>
                <div className="grid grid-cols-2 gap-2">
                  {POSITIONS.map(p => (
                    <button key={p.key} onClick={() => setPosition(p.key)} className={`text-left p-2.5 rounded-lg border transition-colors ${position === p.key ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}>
                      <span className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{p.label}</span>
                      <span className="block text-[11px] text-[#86868b] dark:text-[#8e8e93]">{p.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {error}</p>}

              <button
                onClick={burn}
                disabled={burning || uploading || !sourceUrl}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50 transition-colors w-full justify-center"
              >
                {burning ? <><Loader2 size={14} className="animate-spin" /> Burning… (~20–40s)</> : <><Flame size={14} /> Burn caption</>}
              </button>
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] text-center">The caption is rendered into the video itself, so it shows on-screen anywhere you post it.</p>
            </div>

            {/* Result */}
            <div>
              {resultUrl ? (
                <div className="card p-3">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video src={resultUrl} controls playsInline className="w-full rounded-lg bg-black max-h-[70vh]" />
                  <button onClick={download} className="mt-3 inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold bg-[#34c759] text-white hover:opacity-90">
                    <Download size={13} /> Download captioned video
                  </button>
                </div>
              ) : (
                <div className="card p-8 text-center h-full flex flex-col items-center justify-center">
                  <Flame size={28} className="text-[#86868b] mx-auto mb-3" />
                  <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">Your captioned video will appear here.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
