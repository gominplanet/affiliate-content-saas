'use client'

/**
 * Face Training — Pro-only.
 * User drops 10-20 of their own headshots → we train a LoRA so future
 * thumbnails can render their actual face. Polls the status of each
 * training job and reflects state inline.
 */

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/Header'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  UserCircle2,
  Upload,
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  Trash2,
  Sparkles,
  Camera,
} from 'lucide-react'
import Link from 'next/link'

interface FaceModel {
  id: string
  name: string
  trigger_token: string
  status: 'uploading' | 'training' | 'ready' | 'failed'
  lora_url: string | null
  failure_reason: string | null
  source_images: string[]
  created_at: string
}

const MIN_IMAGES = 10
const MAX_IMAGES = 20
const MAX_FILE_BYTES = 10 * 1024 * 1024

export default function FaceTrainingPage() {
  const supabase = createBrowserClient()
  const [tier, setTier] = useState<string>('trial')
  const [models, setModels] = useState<FaceModel[]>([])
  const [loading, setLoading] = useState(true)
  const [newFaceOpen, setNewFaceOpen] = useState(false)
  const [name, setName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [tierRes, modelsRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
          .from('integrations').select('tier').eq('user_id', user.id).single()
        return (data?.tier as string) || 'trial'
      })(),
      fetch('/api/face-models').then(r => r.json()),
    ])
    setTier(tierRes || 'trial')
    setModels((modelsRes.models || []) as FaceModel[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  // Poll any models that are still training every 12s. Slower than typical
  // because LoRA training takes 5-15min — no need to hammer the endpoint.
  useEffect(() => {
    const inFlight = models.filter(m => m.status === 'training' || m.status === 'uploading')
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
      setModels(prev => prev.map(m => updates.find(u => u?.id === m.id) || m))
    }, 12000)
    return () => clearInterval(t)
  }, [models])

  const isPro = tier === 'pro' || tier === 'admin'

  function onPickFiles(picked: FileList | null) {
    if (!picked) return
    const next = [...files]
    for (const f of Array.from(picked)) {
      if (!f.type.startsWith('image/')) {
        setError(`${f.name} isn't an image. Use JPG, PNG, or WebP.`)
        continue
      }
      if (f.size > MAX_FILE_BYTES) {
        setError(`${f.name} is too large (${(f.size / 1024 / 1024).toFixed(1)}MB). Max 10 MB per file.`)
        continue
      }
      if (next.length >= MAX_IMAGES) {
        setError(`Max ${MAX_IMAGES} images.`)
        break
      }
      next.push(f)
    }
    setFiles(next)
  }

  async function submit() {
    setError(null)
    if (!name.trim()) { setError('Give this face a name (e.g. "Me").'); return }
    if (files.length < MIN_IMAGES) { setError(`Add at least ${MIN_IMAGES} images.`); return }
    setUploading(true)
    setUploadProgress({ done: 0, total: files.length })

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')

      // Upload each image to storage. Path starts with the user.id so the
      // bucket's per-user RLS policy ((storage.foldername)[1] = auth.uid())
      // accepts the insert. The face-training/ prefix sits one level deeper
      // so delete-cleanup can still target the whole training set.
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), imagePaths }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to start training')

      // Reset + reload
      setName('')
      setFiles([])
      setNewFaceOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setUploading(false)
      setUploadProgress(null)
    }
  }

  async function deleteModel(id: string) {
    if (!confirm('Delete this trained face? You\'ll need to upload images again to retrain.')) return
    await fetch(`/api/face-models/${id}`, { method: 'DELETE' })
    setModels(prev => prev.filter(m => m.id !== id))
  }

  return (
    <>
      <Header
        title="Face Training"
        subtitle="Train MVP on your own face so generated thumbnails put YOU in the picture — not a stock-photo lookalike."
      />

      {!isPro && (
        <div className="card p-5 mb-6 flex items-start gap-3" style={{ background: 'linear-gradient(180deg, rgba(0,113,227,0.05) 0%, transparent 100%)', borderColor: 'rgba(0,113,227,0.25)' }}>
          <div className="w-9 h-9 rounded-full bg-[#0071e3]/15 flex items-center justify-center flex-shrink-0">
            <Sparkles size={18} className="text-[#0071e3]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Face training is a Pro feature</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 mb-3">
              We train a custom AI model on your face (10-20 photos), so future thumbnails can include the real you — not a generic stock-photo person. One-time training; reusable on every thumbnail forever.
            </p>
            <Link href="/pricing" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0062c4]">
              <Sparkles size={11} /> Upgrade to Pro
            </Link>
          </div>
        </div>
      )}

      <div className={`max-w-3xl ${!isPro ? 'opacity-60 pointer-events-none' : ''}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <UserCircle2 size={18} className="text-[#0071e3]" />
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your trained faces</p>
          </div>
          <button
            onClick={() => { setNewFaceOpen(true); setError(null); setFiles([]); setName('') }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0062c4]"
          >
            <Camera size={11} /> Train new face
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#86868b] py-12 justify-center">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : models.length === 0 ? (
          <div className="card p-8 text-center">
            <UserCircle2 size={32} className="text-[#86868b] mx-auto mb-3" />
            <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">No trained faces yet</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">Click <span className="font-semibold">Train new face</span> to upload 10-20 headshots and train your first model.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {models.map(m => (
              <div key={m.id} className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#0071e3]/10 flex items-center justify-center flex-shrink-0">
                  <UserCircle2 size={20} className="text-[#0071e3]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{m.name}</p>
                    {m.status === 'ready' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#34c759]/10 text-[#34c759]">
                        <CheckCircle size={9} /> Ready
                      </span>
                    )}
                    {m.status === 'training' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#ff9500]/10 text-[#ff9500]">
                        <Loader2 size={9} className="animate-spin" /> Training (5-15 min)
                      </span>
                    )}
                    {m.status === 'failed' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#ff3b30]/10 text-[#ff3b30]">
                        <AlertCircle size={9} /> Failed
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">
                    Trigger word: <span className="font-mono">{m.trigger_token}</span>
                    {' · '}
                    {m.source_images.length} source images
                  </p>
                  {m.failure_reason && (
                    <p className="text-[11px] text-[#ff3b30] mt-1">{m.failure_reason}</p>
                  )}
                </div>
                <button
                  onClick={() => deleteModel(m.id)}
                  className="text-[#86868b] hover:text-[#ff3b30] p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  title="Delete this trained face"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New face modal */}
      {newFaceOpen && isPro && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !uploading && setNewFaceOpen(false)}>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-xl w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Train a new face</h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              Upload 10-20 headshots. Training takes 5-15 minutes — you can leave the page and come back.
            </p>

            <div className="card p-3 mb-4" style={{ background: 'rgba(0,113,227,0.05)', borderColor: 'rgba(0,113,227,0.2)' }}>
              <p className="text-[11px] font-semibold text-[#0071e3] mb-1.5">📸 Tips for better results</p>
              <ul className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] space-y-1">
                <li>• Use clear, front-facing photos with good lighting</li>
                <li>• The face should take up most of the image</li>
                <li>• Avoid group photos — one person per image works best</li>
                <li>• Mix expressions and angles (smiling, neutral, ¾ view)</li>
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

            {error && <p className="text-xs text-[#ff3b30] mb-3">{error}</p>}
            {uploading && uploadProgress && (
              <p className="text-xs text-[#0071e3] mb-3">Uploading {uploadProgress.done}/{uploadProgress.total}…</p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setNewFaceOpen(false)} disabled={uploading} className="px-3 py-2 rounded-lg text-xs font-medium text-[#86868b]">Cancel</button>
              <button
                onClick={submit}
                disabled={uploading || files.length < MIN_IMAGES || !name.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50"
              >
                {uploading
                  ? <><Loader2 size={11} className="animate-spin" /> Uploading…</>
                  : <><Sparkles size={11} /> Start training</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
