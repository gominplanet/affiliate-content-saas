'use client'

/**
 * Instagram Burner — upload a vertical video and burn a caption (e.g.
 * "LINK IN BIO") into the lower third via Cloudinary, then preview the result.
 * From there the user can explicitly publish it as a Reel to their connected
 * Instagram (separate action — never auto-posted) or download it for Reels /
 * Stories / TikTok. Pro-only.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase/client'
import Header from '@/components/layout/Header'
import { effectiveTier } from '@/lib/view-as'
import { Flame, Loader2, Sparkles, Download, AlertCircle, UploadCloud, Video, CheckCircle, Copy, Instagram, Plus, Trash2, Clock } from 'lucide-react'

const CAPTION_PRESETS = ['LINK IN BIO', 'LINK IN BIO 👆', 'FULL REVIEW ON YOUTUBE', 'WATCH THE FULL VIDEO', 'FOLLOW FOR MORE']
const POSITIONS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'lower-third', label: 'Lower third', desc: 'Recommended — clears IG’s buttons' },
  { key: 'center', label: 'Middle', desc: 'Center of the screen' },
]
const STYLES: Array<{ key: string; label: string; desc: string }> = [
  { key: 'white-pill', label: 'White on dark', desc: 'White text, dark pill' },
  { key: 'yellow-pill', label: 'Yellow on dark', desc: 'Yellow text, dark pill' },
  { key: 'black-pill', label: 'Black on white', desc: 'Black text, white pill' },
  { key: 'white-shadow', label: 'White + shadow', desc: 'White text, soft shadow, no pill' },
]

export default function InstagramBurnerPage() {
  const supabase = createBrowserClient()
  const [tier, setTier] = useState('trial')
  const [igUsername, setIgUsername] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [caption, setCaption] = useState('LINK IN BIO')
  const [position, setPosition] = useState('lower-third')
  const [style, setStyle] = useState('white-pill')
  const [product, setProduct] = useState('')

  const [uploading, setUploading] = useState(false)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [burning, setBurning] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [igCaption, setIgCaption] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [igError, setIgError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    let resolvedTier = 'trial'
    if (user) {
      // Select only non-sensitive columns — never the access token.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from('integrations').select('tier,instagram_username').eq('user_id', user.id).single()
      resolvedTier = (data?.tier as string) || 'trial'
      setIgUsername((data?.instagram_username as string) || null)
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
    setBurning(true); setError(null); setResultUrl(null); setIgCaption(null); setPublished(false); setIgError(null)
    try {
      const res = await fetch('/api/instagram/burn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: sourceUrl,
          caption: caption.trim() || 'LINK IN BIO',
          position,
          style,
          product: product.trim() || undefined,
        }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) throw new Error((d.error as string) || `Failed (HTTP ${res.status})`)
      setResultUrl(d.url as string)
      setIgCaption((d.caption as string) || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Burn failed')
    } finally {
      setBurning(false)
    }
  }

  // Explicit, user-initiated publish — kept separate from burn() so we never
  // auto-post (Meta content-publishing policy requires an explicit action).
  async function publishToIg() {
    if (!resultUrl) return
    setPublishing(true); setIgError(null)
    try {
      const res = await fetch('/api/instagram/publish-burned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: resultUrl, caption: igCaption ?? caption.trim() ?? 'LINK IN BIO' }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok || d.published !== true) throw new Error((d.error as string) || `Failed (HTTP ${res.status})`)
      setPublished(true)
    } catch (e) {
      setIgError(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  function copyCaption() {
    if (!igCaption) return
    navigator.clipboard.writeText(igCaption).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
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
          <>
            {/* Connected Instagram account (profile info read via instagram_business_basic) */}
            {igUsername ? (
              <div className="flex items-center gap-2 mb-4 rounded-lg border border-[#E1306C]/25 bg-[#E1306C]/5 px-3 py-2 w-fit">
                <Instagram size={15} className="text-[#E1306C] flex-shrink-0" />
                <span className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">Connected as <span className="font-semibold">@{igUsername}</span></span>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-4 rounded-lg border border-gray-200 dark:border-white/10 px-3 py-2 w-fit">
                <Instagram size={15} className="text-[#86868b] flex-shrink-0" />
                <span className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0]">No Instagram connected — <Link href="/setup?tab=integrations" className="text-[#0071e3] font-semibold hover:underline">connect under Setup → Integrations</Link> to publish.</span>
              </div>
            )}

            <div className="flex gap-2 mb-4">
              <button onClick={() => setMode('single')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${mode === 'single' ? 'border-[#0071e3] bg-[#0071e3]/5 text-[#0071e3]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0]'}`}>Single video</button>
              <button onClick={() => setMode('batch')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${mode === 'batch' ? 'border-[#0071e3] bg-[#0071e3]/5 text-[#0071e3]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0]'}`}>Batch &amp; schedule · up to 5</button>
            </div>
            {mode === 'batch' ? (
              <BatchBurner supabase={supabase} />
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
                {/* Style */}
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {STYLES.map(s => (
                    <button key={s.key} onClick={() => setStyle(s.key)} className={`text-left p-2 rounded-lg border transition-colors ${style === s.key ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}>
                      <span className="block text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{s.label}</span>
                      <span className="block text-[10px] text-[#86868b] dark:text-[#8e8e93]">{s.desc}</span>
                    </button>
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

              {/* Product (optional) */}
              <div>
                <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">4. Product <span className="font-normal text-[#86868b]">(optional)</span></label>
                <input
                  type="text"
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  className="input-field text-sm"
                  placeholder="Amazon ASIN or product URL"
                />
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">If set, we research it and write a Reel caption (3 hashtags + #ad disclosure) to post with the video.</p>
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
                <div className="card p-3 space-y-3">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video src={resultUrl} controls playsInline className="w-full rounded-lg bg-black max-h-[60vh]" />

                  {/* Composed Reel caption — review before publishing */}
                  {igCaption && (
                    <div className="rounded-lg border border-gray-200 dark:border-white/10 p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Reel caption</span>
                        <button onClick={copyCaption} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0071e3] hover:underline">
                          {copied ? <><CheckCircle size={11} /> Copied!</> : <><Copy size={11} /> Copy</>}
                        </button>
                      </div>
                      <pre className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-wrap font-sans leading-relaxed max-h-40 overflow-y-auto">{igCaption}</pre>
                    </div>
                  )}

                  {/* Publish status / explicit publish action */}
                  {published ? (
                    <div className="flex items-center gap-1.5 rounded-lg bg-[#34c759]/10 border border-[#34c759]/25 px-3 py-2 text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                      <Instagram size={13} className="text-[#E1306C] flex-shrink-0" /> Posted to your Instagram as a Reel.
                    </div>
                  ) : (
                    <>
                      {igError && (
                        <div className="flex items-start gap-1.5 rounded-lg bg-[#ff9500]/10 border border-[#ff9500]/25 px-3 py-2 text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                          <AlertCircle size={13} className="text-[#ff9500] flex-shrink-0 mt-0.5" /> Couldn’t publish ({igError}). You can download below and post it manually.
                        </div>
                      )}
                      <button
                        onClick={publishToIg}
                        disabled={publishing}
                        className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        style={{ background: 'linear-gradient(90deg, #F58529, #DD2A7B, #8134AF)' }}
                      >
                        {publishing ? <><Loader2 size={13} className="animate-spin" /> Publishing to Instagram…</> : <><Instagram size={13} /> Publish to Instagram</>}
                      </button>
                      <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] text-center -mt-1">Review the video and caption above, then publish when you’re ready. Nothing is posted automatically.</p>
                    </>
                  )}

                  <button onClick={download} className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold bg-[#34c759] text-white hover:opacity-90">
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
          </>
        )}
      </div>
    </>
  )
}

// ── Batch & schedule ─────────────────────────────────────────────────────────
interface BatchItem { id: string; url: string | null; uploading: boolean; caption: string; product: string }
interface Job { id: string; caption_text: string; status: string; scheduled_at: string; result_url: string | null; ig_published: boolean; error_message: string | null }

function defaultStartLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'text-[#0071e3] bg-[#0071e3]/10',
  processing: 'text-[#ff9500] bg-[#ff9500]/10',
  completed: 'text-[#34c759] bg-[#34c759]/10',
  failed: 'text-[#ff3b30] bg-[#ff3b30]/10',
}

function BatchBurner({ supabase }: { supabase: ReturnType<typeof createBrowserClient> }) {
  const [items, setItems] = useState<BatchItem[]>([{ id: crypto.randomUUID(), url: null, uploading: false, caption: 'LINK IN BIO', product: '' }])
  const [bStyle, setBStyle] = useState('white-pill')
  const [bPos, setBPos] = useState('lower-third')
  const [startAt, setStartAt] = useState(defaultStartLocal())
  const [intervalHours, setIntervalHours] = useState(24)
  const [submitting, setSubmitting] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])

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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Controls */}
      <div className="card p-5 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">1. Videos <span className="font-normal text-[#86868b]">({items.length}/5)</span></label>
            <button onClick={addItem} disabled={items.length >= 5} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0071e3] hover:underline disabled:opacity-40"><Plus size={11} /> Add video</button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={it.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-[#86868b] w-4">{i + 1}.</span>
                  <label className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-dashed text-[12px] cursor-pointer ${it.url ? 'border-[#34c759]/40 text-[#34c759]' : 'border-gray-300 dark:border-white/15 text-[#6e6e73] dark:text-[#ebebf0] hover:border-[#0071e3]'}`}>
                    <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadItem(it.id, f); e.currentTarget.value = '' }} />
                    {it.uploading ? <><Loader2 size={12} className="animate-spin" /> Uploading…</> : it.url ? <><Video size={12} /> Ready</> : <><UploadCloud size={12} /> Upload</>}
                  </label>
                  {items.length > 1 && <button onClick={() => removeItem(it.id)} className="text-[#86868b] hover:text-[#ff3b30] p-1"><Trash2 size={13} /></button>}
                </div>
                <input type="text" value={it.caption} onChange={(e) => setField(it.id, 'caption', e.target.value)} maxLength={60} placeholder="Caption text (e.g. LINK IN BIO)" className="input-field text-[12px]" />
                <input type="text" value={it.product} onChange={(e) => setField(it.id, 'product', e.target.value)} placeholder="Product ASIN or URL (optional)" className="input-field text-[12px]" />
              </div>
            ))}
          </div>
        </div>

        {/* Shared style */}
        <div>
          <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">2. Style (all videos)</label>
          <div className="grid grid-cols-2 gap-2">
            {STYLES.map(s => (
              <button key={s.key} onClick={() => setBStyle(s.key)} className={`text-left p-2 rounded-lg border transition-colors ${bStyle === s.key ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}>
                <span className="block text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Shared position */}
        <div>
          <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">3. Position (all videos)</label>
          <div className="grid grid-cols-2 gap-2">
            {POSITIONS.map(p => (
              <button key={p.key} onClick={() => setBPos(p.key)} className={`text-left p-2.5 rounded-lg border transition-colors ${bPos === p.key ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}>
                <span className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Schedule */}
        <div>
          <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">4. Schedule</label>
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

        <button onClick={openReview} disabled={submitting || !items.some(it => it.url)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50 transition-colors w-full justify-center">
          <Clock size={14} /> Review &amp; schedule
        </button>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] text-center">You’ll review every post before anything is scheduled. Each video is then burned, captioned, and posted to Instagram at its scheduled time.</p>
      </div>

      {/* Queue */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Queue</h3>
          <button onClick={loadJobs} className="text-[11px] text-[#0071e3] hover:underline">Refresh</button>
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
                    <span className="text-[10px] font-medium text-[#0071e3] flex-shrink-0">{scheduledAt(i).toLocaleString()}</span>
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
              Style: {STYLES.find(s => s.key === bStyle)?.label} · Position: {POSITIONS.find(p => p.key === bPos)?.label}
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
