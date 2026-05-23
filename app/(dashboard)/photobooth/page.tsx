'use client'

/**
 * Photobooth — professional headshot generator (Pro).
 *
 * Reuses the photos the user uploaded under "Your Face" as identity
 * references and gpt-image to produce polished headshots for logos, email,
 * profiles, speaker bios, etc. Pick a face, choose a look (or write your own),
 * generate, download. No training — same photos that power thumbnails.
 */
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase/client'
import Header from '@/components/layout/Header'
import { effectiveTier } from '@/lib/view-as'
import { Camera, Loader2, Sparkles, Download, AlertCircle, UserCircle2 } from 'lucide-react'

interface FaceModel { id: string; name: string; source_images: string[] }

const STYLE_OPTS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'studio',    label: 'Studio',    desc: 'Clean neutral backdrop' },
  { key: 'office',    label: 'Office',    desc: 'Desk / computer behind' },
  { key: 'linkedin',  label: 'LinkedIn',  desc: 'Business, neutral bg' },
  { key: 'magazine',  label: 'Magazine',  desc: 'Bright editorial' },
  { key: 'cinematic', label: 'Cinematic', desc: 'Moody, filmic' },
  { key: 'outdoor',   label: 'Outdoor',   desc: 'Natural daylight' },
]

const SIZE_OPTS: Array<{ key: '1024x1024' | '1024x1536' | '1536x1024'; label: string }> = [
  { key: '1024x1024', label: 'Square (profiles, avatars)' },
  { key: '1024x1536', label: 'Portrait (bios, posters)' },
  { key: '1536x1024', label: 'Landscape (banners)' },
]

interface Shot { id: string; url: string; style: string }

export default function PhotoboothPage() {
  const supabase = createBrowserClient()
  const [tier, setTier] = useState('trial')
  const [faces, setFaces] = useState<FaceModel[]>([])
  const [loading, setLoading] = useState(true)
  const [faceId, setFaceId] = useState<string>('')
  const [style, setStyle] = useState('studio')
  const [customPrompt, setCustomPrompt] = useState('')
  const [size, setSize] = useState<'1024x1024' | '1024x1536' | '1536x1024'>('1024x1024')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shots, setShots] = useState<Shot[]>([])

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
      if (models.length > 0) setFaceId(models[0].id)
    } catch { /* ignore */ }
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const isPro = tier === 'pro' || tier === 'admin'

  async function generate() {
    if (!faceId) { setError('Pick a face first.'); return }
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/photobooth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faceModelId: faceId, style, customPrompt: customPrompt.trim() || undefined, size }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) {
        const msg = (d.error as string) || (
          res.status === 504 || res.status === 502
            ? 'That took too long and timed out. Please try again — generation can take ~30–60s.'
            : `Generation failed (HTTP ${res.status}). Please try again.`
        )
        throw new Error(msg)
      }
      setShots(prev => [{ id: crypto.randomUUID(), url: d.image as string, style: d.style as string }, ...prev])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <>
      <Header
        title="Photobooth"
        subtitle="Studio-quality headshots of YOU — for logos, email, profiles, speaker bios. Built from the photos under Your Face."
      />

      {!isPro && (
        <div className="card p-5 mb-6 flex items-start gap-3" style={{ background: 'linear-gradient(180deg, rgba(0,113,227,0.05) 0%, transparent 100%)', borderColor: 'rgba(0,113,227,0.25)' }}>
          <div className="w-9 h-9 rounded-full bg-[#0071e3]/15 flex items-center justify-center flex-shrink-0">
            <Sparkles size={18} className="text-[#0071e3]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Photobooth is a Pro feature</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 mb-3">
              Turn your uploaded photos into polished professional headshots — different settings and styles, ready to download.
            </p>
            <Link href="/pricing" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0062c4]">
              <Sparkles size={11} /> Upgrade to Pro
            </Link>
          </div>
        </div>
      )}

      <div className={`max-w-4xl ${!isPro ? 'opacity-60 pointer-events-none' : ''}`}>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#86868b] py-12 justify-center">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : faces.length === 0 ? (
          <div className="card p-8 text-center">
            <UserCircle2 size={32} className="text-[#86868b] mx-auto mb-3" />
            <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Add your face first</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">Photobooth uses the photos you save under <span className="font-semibold">Your Face</span>.</p>
            <Link href="/face-training" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0062c4]">
              <Camera size={11} /> Add your face
            </Link>
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

              {error && <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {error}</p>}

              <button
                onClick={generate}
                disabled={generating || !faceId}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50 transition-colors w-full justify-center"
              >
                {generating ? <><Loader2 size={14} className="animate-spin" /> Generating… (~20s)</> : <><Camera size={14} /> Generate headshot</>}
              </button>
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] text-center">Each generation creates one shot. Generate again for variations.</p>
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
                    <div key={s.id} className="card p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url} alt={`Headshot — ${s.style}`} className="w-full rounded-lg" />
                      <a
                        href={s.url}
                        download={`headshot-${s.style}-${s.id.slice(0, 6)}.png`}
                        className="mt-2 inline-flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#34c759] text-white hover:opacity-90"
                      >
                        <Download size={12} /> Download
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
