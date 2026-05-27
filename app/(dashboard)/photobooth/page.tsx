'use client'

/**
 * Photobooth — the home of everything "your likeness" (Pro).
 *
 * One place to (1) teach the AI your face by uploading photos, and (2) generate
 * studio-quality headshots from them in any look + expression. The SAME photos
 * power your thumbnails, social posts, and the in-product identity anchor — so
 * setting a face up here is the highest-leverage thing a creator can do.
 *
 * (Merged from the old /face-training + /photobooth pages; /face-training now
 * redirects here.)
 */
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase/client'
import Header from '@/components/layout/Header'
import { effectiveTier } from '@/lib/view-as'
import {
  Camera, Loader2, Sparkles, Download, AlertCircle, UserCircle2, Trash2,
  Upload, X, CheckCircle,
} from 'lucide-react'

interface FaceModel {
  id: string
  name: string
  status: 'uploading' | 'training' | 'ready' | 'failed'
  source_images: string[]
  failure_reason?: string | null
}

const MIN_IMAGES = 4
const MAX_IMAGES = 20
const MAX_FILE_BYTES = 10 * 1024 * 1024

const STYLE_OPTS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'studio',    label: 'Studio',    desc: 'Clean neutral backdrop' },
  { key: 'office',    label: 'Office',    desc: 'Desk / computer behind' },
  { key: 'linkedin',  label: 'LinkedIn',  desc: 'Business, neutral bg' },
  { key: 'magazine',  label: 'Magazine',  desc: 'Bright editorial' },
  { key: 'cinematic', label: 'Cinematic', desc: 'Moody, filmic' },
  { key: 'outdoor',   label: 'Outdoor',   desc: 'Natural daylight' },
]

const EXPRESSION_OPTS: Array<{ key: string; label: string }> = [
  { key: 'neutral',   label: 'Neutral' },
  { key: 'happy',     label: 'Happy' },
  { key: 'excited',   label: 'Excited' },
  { key: 'surprised', label: 'Surprised' },
  { key: 'laughing',  label: 'Laughing' },
  { key: 'focused',   label: 'Focused' },
  { key: 'serious',   label: 'Serious' },
  { key: 'angry',     label: 'Angry' },
]

const SIZE_OPTS: Array<{ key: '1024x1024' | '1024x1536' | '1536x1024'; label: string }> = [
  { key: '1024x1024', label: 'Square (profiles, avatars)' },
  { key: '1024x1536', label: 'Portrait (bios, posters)' },
  { key: '1536x1024', label: 'Landscape (banners)' },
]

interface Shot { id: string; url: string; style: string; path?: string }
interface UsageInfo { used: number; limit: number | null; remaining: number | null; resetLabel: string }

export default function PhotoboothPage() {
  const supabase = createBrowserClient()
  const [tier, setTier] = useState('trial')
  const [faces, setFaces] = useState<FaceModel[]>([])
  const [loading, setLoading] = useState(true)

  // ── Face creation/management ──────────────────────────────────────────────
  const [newFaceOpen, setNewFaceOpen] = useState(false)
  const [name, setName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [faceError, setFaceError] = useState<string | null>(null)

  // ── Generator ───────────────────────────────────────────────────────────--
  const [faceId, setFaceId] = useState<string>('')
  const [style, setStyle] = useState('studio')
  const [expression, setExpression] = useState('neutral')
  const [customPrompt, setCustomPrompt] = useState('')
  const [size, setSize] = useState<'1024x1024' | '1024x1536' | '1536x1024'>('1024x1024')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [usage, setUsage] = useState<UsageInfo | null>(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    let resolvedTier = 'trial'
    if (user) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).single()
      resolvedTier = (data?.tier as string) || 'trial'
    }
    setTier(effectiveTier(resolvedTier))
    try {
      const r = await fetch('/api/face-models')
      const d = await r.json()
      const models = (d.models || []) as FaceModel[]
      setFaces(models)
      setFaceId(prev => prev && models.some(m => m.id === prev) ? prev : (models[0]?.id || ''))
    } catch { /* ignore */ }
    try {
      const ur = await fetch('/api/photobooth')
      const ud = await ur.json()
      if (ud?.usage) setUsage(ud.usage as UsageInfo)
      if (Array.isArray(ud?.shots)) {
        setShots((ud.shots as Array<{ path: string; url: string; style: string }>).map(s => ({
          id: s.path, url: s.url, style: s.style, path: s.path,
        })))
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  // Poll any face still settling (rare — instant faces are ready immediately).
  useEffect(() => {
    const inFlight = faces.filter(m => m.status === 'training' || m.status === 'uploading')
    if (inFlight.length === 0) return
    const t = setInterval(async () => {
      const updates = await Promise.all(inFlight.map(async m => {
        try {
          const r = await fetch(`/api/face-models/${m.id}`)
          if (!r.ok) return null
          const d = await r.json()
          return d.model as FaceModel
        } catch { return null }
      }))
      setFaces(prev => prev.map(m => updates.find(u => u?.id === m.id) || m))
    }, 12000)
    return () => clearInterval(t)
  }, [faces])

  const isPaid = tier === 'creator' || tier === 'pro' || tier === 'admin'
  const isAdmin = tier === 'admin'
  const MAX_FACES = 2
  const atFaceCap = !isAdmin && faces.length >= MAX_FACES
  const noneLeft = !!usage && usage.remaining === 0
  const hasFace = faces.length > 0

  function onPickFiles(picked: FileList | null) {
    if (!picked) return
    const next = [...files]
    for (const f of Array.from(picked)) {
      if (!f.type.startsWith('image/')) { setFaceError(`${f.name} isn't an image. Use JPG, PNG, or WebP.`); continue }
      if (f.size > MAX_FILE_BYTES) { setFaceError(`${f.name} is too large (${(f.size / 1024 / 1024).toFixed(1)}MB). Max 10 MB per file.`); continue }
      if (next.length >= MAX_IMAGES) { setFaceError(`Max ${MAX_IMAGES} images.`); break }
      next.push(f)
    }
    setFiles(next)
  }

  async function submitFace() {
    setFaceError(null)
    if (!name.trim()) { setFaceError('Give this face a name (e.g. "Me").'); return }
    if (files.length < MIN_IMAGES) { setFaceError(`Add at least ${MIN_IMAGES} images.`); return }
    setUploading(true)
    setUploadProgress({ done: 0, total: files.length })
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const folder = `${user.id}/face-training/${crypto.randomUUID()}`
      const imagePaths: string[] = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `${folder}/${String(i + 1).padStart(2, '0')}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('headshots').upload(path, f, { upsert: false, cacheControl: '31536000' })
        if (upErr) throw new Error(`Upload failed on image ${i + 1}: ${upErr.message}`)
        imagePaths.push(path)
        setUploadProgress({ done: i + 1, total: files.length })
      }
      const res = await fetch('/api/face-models', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), imagePaths }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to save face')
      setName(''); setFiles([]); setNewFaceOpen(false)
      await load()
    } catch (e) {
      setFaceError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setUploading(false); setUploadProgress(null)
    }
  }

  async function deleteModel(id: string) {
    if (!confirm('Delete this face? You\'ll need to re-upload the photos to use it again — and any thumbnails/posts that rely on it will lose your likeness.')) return
    await fetch(`/api/face-models/${id}`, { method: 'DELETE' })
    setFaces(prev => prev.filter(m => m.id !== id))
  }

  async function generate() {
    if (!faceId) { setGenError('Pick a face first.'); return }
    setGenerating(true); setGenError(null)
    try {
      const res = await fetch('/api/photobooth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faceModelId: faceId, style, expression, customPrompt: customPrompt.trim() || undefined, size }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (d && d.usage) setUsage(d.usage as UsageInfo)
      if (!res.ok) {
        throw new Error((d.error as string) || (
          res.status === 504 || res.status === 502
            ? 'That took too long and timed out. Please try again — high-quality headshots can take 1–3 minutes.'
            : `Generation failed (HTTP ${res.status}). Please try again.`
        ))
      }
      const newShot: Shot = {
        id: (d.path as string) || crypto.randomUUID(),
        url: d.image as string,
        style: d.style as string,
        path: (d.path as string) || undefined,
      }
      setShots(prev => [newShot, ...prev].slice(0, 20))
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function downloadShot(s: Shot) {
    try {
      const res = await fetch(s.url)
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href; a.download = `headshot-${s.style}-${s.id.slice(-6)}.png`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(href)
    } catch {
      window.open(s.url, '_blank')
    }
  }

  function removeShot(shot: Shot) {
    setShots(prev => prev.filter(s => s.id !== shot.id))
    if (shot.path) {
      fetch('/api/photobooth', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: shot.path }),
      }).catch(() => { /* ignore */ })
    }
  }

  return (
    <>
      <Header
        title="Photobooth"
        subtitle="Teach the AI your face once — then put the real you in every thumbnail, post, and studio-quality headshot."
      />

      {!isPaid && (
        <div className="card p-5 mb-6 flex items-start gap-3" style={{ background: 'linear-gradient(180deg, rgba(0,113,227,0.05) 0%, transparent 100%)', borderColor: 'rgba(0,113,227,0.25)' }}>
          <div className="w-9 h-9 rounded-full bg-[#0071e3]/15 flex items-center justify-center flex-shrink-0">
            <Sparkles size={18} className="text-[#0071e3]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Putting your face in thumbnails, posts &amp; headshots is a paid feature</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 mb-3">
              Add a few photos of yourself once, and every generated thumbnail, social image, and headshot can include the real you — not a generic stock-photo person. No training wait; ready the moment you save.
            </p>
            <Link href="/pricing" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0062c4]">
              <Sparkles size={11} /> Upgrade to Pro
            </Link>
          </div>
        </div>
      )}

      <div className={`max-w-4xl flex flex-col gap-6 ${!isPaid ? 'opacity-60 pointer-events-none' : ''}`}>

        {/* ── Explainer ─────────────────────────────────────────────────────── */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Start here: teach the AI your face</h2>
          <p className="text-[13px] leading-relaxed text-[#3a3a3c] dark:text-[#ebebf0] mb-3">
            Before MVP can put <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">you</strong> in your thumbnails and posts, it has to learn what you look like. Set this up once and the AI will cast the real you everywhere — thumbnails, Instagram images, and the headshots below — instead of a stock-photo stranger.
          </p>
          <ul className="text-[13px] leading-relaxed text-[#3a3a3c] dark:text-[#ebebf0] flex flex-col gap-1.5 list-disc pl-5">
            <li>Click <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Add a face</strong> and upload <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">{MIN_IMAGES}–{MAX_IMAGES} clear photos</strong> of yourself. More is better — mix angles, expressions, and lighting.</li>
            <li>It&apos;s ready <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">instantly</strong> — no training wait.</li>
            <li>From then on it&apos;s the reference for your face everywhere the AI casts you. More (and clearer) photos = stronger likeness.</li>
          </ul>
          <p className="text-[12px] text-[#86868b] dark:text-[#8e8e93] mt-3">
            This is the highest-leverage thing you can set up — a real, recognizable face dramatically out-clicks a generic one.
          </p>
        </div>

        {/* ── Your faces (create/manage) ────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <UserCircle2 size={18} className="text-[#0071e3]" />
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your faces{!isAdmin && <span className="font-normal text-[#86868b]"> ({faces.length}/{MAX_FACES})</span>}</p>
            </div>
            <button
              onClick={() => { if (atFaceCap) return; setNewFaceOpen(true); setFaceError(null); setFiles([]); setName('') }}
              disabled={atFaceCap}
              title={atFaceCap ? `Maximum ${MAX_FACES} faces — delete one to add another` : 'Add a face'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0062c4] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Camera size={11} /> Add a face
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[#86868b] py-10 justify-center">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : !hasFace ? (
            <div className="card p-8 text-center">
              <UserCircle2 size={32} className="text-[#86868b] mx-auto mb-3" />
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">No faces yet</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">Click <span className="font-semibold">Add a face</span> to upload {MIN_IMAGES}–{MAX_IMAGES} photos of yourself — ready to use instantly.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {faces.map(m => (
                <div key={m.id} className="card p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#0071e3]/10 flex items-center justify-center flex-shrink-0">
                    <UserCircle2 size={20} className="text-[#0071e3]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{m.name}</p>
                      {m.status === 'ready' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#34c759]/10 text-[#34c759]"><CheckCircle size={9} /> Ready</span>
                      )}
                      {m.status === 'training' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#ff9500]/10 text-[#ff9500]"><Loader2 size={9} className="animate-spin" /> Settling</span>
                      )}
                      {m.status === 'failed' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#ff3b30]/10 text-[#ff3b30]"><AlertCircle size={9} /> Failed</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">
                      {m.source_images.length} reference photo{m.source_images.length !== 1 ? 's' : ''} · used in thumbnails, posts &amp; headshots
                    </p>
                    {m.failure_reason && <p className="text-[11px] text-[#ff3b30] mt-1">{m.failure_reason}</p>}
                  </div>
                  <button
                    onClick={() => deleteModel(m.id)}
                    className="text-[#86868b] hover:text-[#ff3b30] p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Delete this face"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Photobooth generator ──────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Camera size={18} className="text-[#0071e3]" />
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Photobooth — generate headshots</p>
          </div>

          {!hasFace ? (
            <div className="card p-6 text-center">
              <Camera size={26} className="text-[#86868b] mx-auto mb-2" />
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">Create a face above first — then generate studio-quality headshots in any look + expression.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Controls */}
              <div className="card p-5 space-y-4">
                {faces.length > 1 && (
                  <div>
                    <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Whose face</label>
                    <select value={faceId} onChange={e => setFaceId(e.target.value)} className="input-field text-sm">
                      {faces.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Look</label>
                  <div className="grid grid-cols-2 gap-2">
                    {STYLE_OPTS.map(s => (
                      <button
                        key={s.key}
                        onClick={() => setStyle(s.key)}
                        className={`text-left p-2.5 rounded-lg border transition-colors ${style === s.key ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}
                      >
                        <span className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{s.label}</span>
                        <span className="block text-[11px] text-[#86868b] dark:text-[#8e8e93]">{s.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Expression</label>
                  <div className="flex flex-wrap gap-2">
                    {EXPRESSION_OPTS.map(e => (
                      <button
                        key={e.key}
                        onClick={() => setExpression(e.key)}
                        className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${expression === e.key ? 'border-[#0071e3] text-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}
                      >
                        {e.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Add your own direction <span className="font-normal text-[#86868b]">(optional)</span></label>
                  <textarea
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    rows={2}
                    maxLength={400}
                    placeholder="e.g. wearing a navy blazer, soft window light, plant in the background"
                    className="input-field text-sm resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Shape</label>
                  <select value={size} onChange={e => setSize(e.target.value as typeof size)} className="input-field text-sm">
                    {SIZE_OPTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>

                {genError && <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {genError}</p>}

                <button
                  onClick={generate}
                  disabled={generating || !faceId || noneLeft}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50 transition-colors w-full justify-center"
                >
                  {generating ? <><Loader2 size={14} className="animate-spin" /> Generating… (up to ~3 min)</> : <><Camera size={14} /> Generate headshot</>}
                </button>

                <p className="text-[11px] text-center text-[#86868b] dark:text-[#8e8e93] -mt-1">Rendered at high quality — allow <span className="font-medium">1–3 minutes</span> per headshot.</p>

                {usage && usage.limit !== null ? (
                  <p className="text-[11px] text-center text-[#86868b] dark:text-[#8e8e93]">
                    {noneLeft ? (
                      <span className="text-[#ff3b30]">You&apos;ve used all {usage.limit} headshots this month. Resets {usage.resetLabel}.</span>
                    ) : (
                      <><span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{usage.remaining} of {usage.limit}</span> headshots left this month{usage.resetLabel ? ` · resets ${usage.resetLabel}` : ''}. Each generation creates one shot.</>
                    )}
                  </p>
                ) : (
                  <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] text-center">Each generation creates one shot. Generate again for variations.</p>
                )}
              </div>

              {/* Results */}
              <div>
                {shots.length === 0 ? (
                  <div className="card p-8 text-center h-full flex flex-col items-center justify-center">
                    <Camera size={28} className="text-[#86868b] mx-auto mb-3" />
                    <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">Your headshots will appear here.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {shots.map(s => (
                      <div key={s.id} className="card p-2 relative">
                        <button
                          onClick={() => removeShot(s)}
                          aria-label="Delete headshot"
                          title="Delete"
                          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/55 hover:bg-[#ff3b30] text-white flex items-center justify-center backdrop-blur-sm transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.url} alt={`Headshot — ${s.style}`} className="w-full rounded-lg" />
                        <button
                          onClick={() => downloadShot(s)}
                          className="mt-2 inline-flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#34c759] text-white hover:opacity-90"
                        >
                          <Download size={12} /> Download
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add-face modal */}
      {newFaceOpen && isPaid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !uploading && setNewFaceOpen(false)}>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-xl w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Add your face</h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              Upload {MIN_IMAGES}–{MAX_IMAGES} clear photos of yourself — the more the better. No training wait; it&apos;s ready to use the moment you save.
            </p>

            <div className="card p-3 mb-4" style={{ background: 'rgba(0,113,227,0.05)', borderColor: 'rgba(0,113,227,0.2)' }}>
              <p className="text-[11px] font-semibold text-[#0071e3] mb-1.5">📸 Tips for better results</p>
              <ul className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] space-y-1">
                <li>• Use clear, front-facing photos with good lighting</li>
                <li>• The face should take up most of the image</li>
                <li>• Avoid group photos — one person per image works best</li>
                <li>• Mix expressions and angles (smiling, neutral, ¾ view)</li>
                <li>• More photos = stronger likeness — aim for 10+ if you can</li>
                <li>• JPG or PNG, at least 512×512 px, max 10 MB each</li>
              </ul>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. "Me", "My partner"'
                disabled={uploading}
                className="w-full text-sm px-3 py-1.5 rounded-md bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#0071e3] focus:outline-none"
              />
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
                Images <span className={`font-normal ${files.length < MIN_IMAGES ? 'text-[#ff9500]' : 'text-[#34c759]'}`}>({files.length}/{MAX_IMAGES} — minimum {MIN_IMAGES})</span>
              </label>
              <label className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-lg border-2 border-dashed border-gray-300 dark:border-white/15 text-xs text-[#86868b] hover:border-[#0071e3] hover:text-[#0071e3] cursor-pointer transition-colors">
                <Upload size={18} />
                <span>Click to add images (or drop here)</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => { onPickFiles(e.target.files); e.target.value = '' }}
                />
              </label>
              {files.length > 0 && (
                <div className="grid grid-cols-5 gap-2 mt-3">
                  {files.map((f, i) => (
                    <div key={i} className="relative aspect-square rounded-md overflow-hidden bg-gray-100 dark:bg-[#2c2c2e]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                      <button
                        onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}
                        disabled={uploading}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white text-xs flex items-center justify-center hover:bg-[#ff3b30]"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {faceError && <p className="text-xs text-[#ff3b30] mb-3">{faceError}</p>}
            {uploading && uploadProgress && (
              <p className="text-xs text-[#0071e3] mb-3">Uploading {uploadProgress.done}/{uploadProgress.total}…</p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setNewFaceOpen(false)} disabled={uploading} className="px-3 py-2 rounded-lg text-xs font-medium text-[#86868b]">Cancel</button>
              <button
                onClick={submitFace}
                disabled={uploading || files.length < MIN_IMAGES || !name.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50"
              >
                {uploading ? <><Loader2 size={11} className="animate-spin" /> Uploading…</> : <><Sparkles size={11} /> Save face</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
