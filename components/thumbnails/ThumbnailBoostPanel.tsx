// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The thumbnail styling controls, shared by every surface that makes a thumbnail
// (Co-Pilot, Video Launchpad) so a creator gets the SAME options everywhere and the
// same remembered preferences:
//
//   Quick style  — one-tap chips, zero typing: Question hook · Energy · Badge ·
//                  Red accent. The AI writes the badge and picks the accent word.
//   Match a look — saved looks as chips + "upload a thumbnail you love"; MVP copies
//                  its palette, lighting and typography energy.
//   Fine-tune    — collapsed: pose with the product, outfit (saved to the face),
//                  custom badge text, custom red word, describe the scene.
//
// `useThumbnailBoost()` owns the state + localStorage persistence (same keys Co-Pilot
// uses, so a preference set on one page is the default on the other) and returns
// `requestFields()` — spread it into the /api/youtube/generate-thumbnail body.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Loader2 } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'

export type ThumbPose = 'auto' | 'hold' | 'wear' | 'use' | 'point' | 'thumbs'

const LS = {
  question: 'mvp_thumb_question',
  pose: 'mvp_thumb_pose',
  effects: 'mvp_thumb_effects',
  autoBadge: 'mvp_thumb_auto_badge',
  autoAccent: 'mvp_thumb_auto_accent',
} as const

function lsGet(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

interface SavedStyle { id: string; name: string; reference_url: string }

export interface ThumbnailBoost {
  // Quick style
  question: boolean; setQuestion: (on: boolean) => void
  effects: boolean; setEffects: (on: boolean) => void
  autoBadge: boolean; setAutoBadge: (on: boolean) => void
  autoAccent: boolean; setAutoAccent: (on: boolean) => void
  // Match a look
  savedStyles: SavedStyle[]
  styleReferenceUrl: string | null
  loadedPresetId: string | null
  styleRefUploading: boolean
  savingPreset: boolean
  applyPreset: (id: string, url: string) => void
  clearStyle: () => void
  uploadStyleRef: (file: File) => Promise<void>
  saveCurrentAsPreset: () => Promise<void>
  deletePreset: (id: string) => Promise<void>
  // Fine-tune
  pose: ThumbPose; setPose: (p: ThumbPose) => void
  badgeText: string; setBadgeText: (s: string) => void
  accentWord: string; setAccentWord: (s: string) => void
  scenePrompt: string; setScenePrompt: (s: string) => void
  /** Spread into the generate-thumbnail request body. */
  requestFields: () => Record<string, unknown>
}

/** State + persistence for the panel. `defaultQuestion` seeds the Question hook
 *  toggle when the creator has never set it (Launchpad wants questions on). */
export function useThumbnailBoost(opts: { defaultQuestion?: boolean } = {}): ThumbnailBoost {
  const [question, setQuestionState] = useState(!!opts.defaultQuestion)
  const [effects, setEffectsState] = useState(false)
  const [autoBadge, setAutoBadgeState] = useState(false)
  const [autoAccent, setAutoAccentState] = useState(false)
  const [pose, setPoseState] = useState<ThumbPose>('auto')
  const [badgeText, setBadgeText] = useState('')
  const [accentWord, setAccentWord] = useState('')
  const [scenePrompt, setScenePrompt] = useState('')

  const [savedStyles, setSavedStyles] = useState<SavedStyle[]>([])
  const [styleReferenceUrl, setStyleReferenceUrl] = useState<string | null>(null)
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(null)
  const [styleRefUploading, setStyleRefUploading] = useState(false)
  const [savingPreset, setSavingPreset] = useState(false)

  // Load remembered preferences + saved looks once.
  useEffect(() => {
    const q = lsGet(LS.question)
    if (q !== null) setQuestionState(q === '1')
    setEffectsState(lsGet(LS.effects) === '1')
    setAutoBadgeState(lsGet(LS.autoBadge) === '1')
    setAutoAccentState(lsGet(LS.autoAccent) === '1')
    const p = lsGet(LS.pose) as ThumbPose | null
    if (p && ['auto', 'hold', 'wear', 'use', 'point', 'thumbs'].includes(p)) setPoseState(p)
    ;(async () => {
      try {
        const d = await fetch('/api/thumbnail-styles').then(r => r.json()).catch(() => ({}))
        if (Array.isArray(d?.styles)) setSavedStyles(d.styles)
      } catch { /* none */ }
    })()
  }, [])

  const setQuestion = useCallback((on: boolean) => { setQuestionState(on); lsSet(LS.question, on ? '1' : '0') }, [])
  const setEffects = useCallback((on: boolean) => { setEffectsState(on); lsSet(LS.effects, on ? '1' : '0') }, [])
  const setAutoBadge = useCallback((on: boolean) => { setAutoBadgeState(on); lsSet(LS.autoBadge, on ? '1' : '0') }, [])
  const setAutoAccent = useCallback((on: boolean) => { setAutoAccentState(on); lsSet(LS.autoAccent, on ? '1' : '0') }, [])
  const setPose = useCallback((p: ThumbPose) => { setPoseState(p); lsSet(LS.pose, p) }, [])

  const applyPreset = useCallback((id: string, url: string) => { setStyleReferenceUrl(url); setLoadedPresetId(id) }, [])
  const clearStyle = useCallback(() => { setStyleReferenceUrl(null); setLoadedPresetId(null) }, [])

  const uploadStyleRef = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('The look must be an image (JPG, PNG, or WebP).'); return }
    if (file.size > 5 * 1024 * 1024) { toast.error(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Keep it under 5 MB.`); return }
    setStyleRefUploading(true)
    try {
      const sb = createBrowserClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      // user.id first so the bucket's per-user RLS lets the insert through.
      const path = `${user.id}/style-references/${crypto.randomUUID()}.${ext}`
      const { error } = await sb.storage.from('headshots').upload(path, file, { upsert: false, cacheControl: '31536000' })
      if (error) throw new Error(error.message)
      setStyleReferenceUrl(sb.storage.from('headshots').getPublicUrl(path).data.publicUrl)
      setLoadedPresetId(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally { setStyleRefUploading(false) }
  }, [])

  const saveCurrentAsPreset = useCallback(async () => {
    if (!styleReferenceUrl) return
    const name = typeof window !== 'undefined' ? window.prompt('Name this look (e.g. "Reviews — dark", "Product close-up")', '')?.trim() : ''
    if (!name) return
    setSavingPreset(true)
    try {
      const r = await fetch('/api/thumbnail-styles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, referenceUrl: styleReferenceUrl }),
      })
      const d = await r.json().catch(() => ({})) as { ok?: boolean; style?: SavedStyle; error?: string }
      if (!r.ok || !d.ok || !d.style) { toast.error(d.error || 'Could not save the look.'); return }
      setSavedStyles(prev => [d.style!, ...prev])
      setLoadedPresetId(d.style.id)
      toast.success('Look saved.')
    } finally { setSavingPreset(false) }
  }, [styleReferenceUrl])

  const deletePreset = useCallback(async (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this look? Existing thumbnails are unaffected.')) return
    try {
      const r = await fetch(`/api/thumbnail-styles/${id}`, { method: 'DELETE' })
      if (!r.ok) return
      setSavedStyles(prev => prev.filter(s => s.id !== id))
      if (loadedPresetId === id) { setLoadedPresetId(null); setStyleReferenceUrl(null) }
    } catch { /* no-op */ }
  }, [loadedPresetId])

  const requestFields = useCallback((): Record<string, unknown> => ({
    headlineStyle: question ? 'question' : 'statement',
    energyEffects: effects || undefined,
    autoBadge: autoBadge || undefined,
    autoAccent: autoAccent || undefined,
    pose: pose !== 'auto' ? pose : undefined,
    badgeText: badgeText.trim() || undefined,
    accentWord: accentWord.trim() || undefined,
    ...((accentWord.trim() || autoAccent) ? { accentColor: '#FF2D2D' } : {}),
    styleReferenceUrl: styleReferenceUrl || undefined,
    scenePrompt: scenePrompt.trim() || undefined,
  }), [question, effects, autoBadge, autoAccent, pose, badgeText, accentWord, styleReferenceUrl, scenePrompt])

  return {
    question, setQuestion, effects, setEffects, autoBadge, setAutoBadge, autoAccent, setAutoAccent,
    savedStyles, styleReferenceUrl, loadedPresetId, styleRefUploading, savingPreset,
    applyPreset, clearStyle, uploadStyleRef, saveCurrentAsPreset, deletePreset,
    pose, setPose, badgeText, setBadgeText, accentWord, setAccentWord, scenePrompt, setScenePrompt,
    requestFields,
  }
}

const muted = { color: 'var(--text-2)' } as const
const label = { color: 'var(--text)' } as const

/**
 * The panel. Pass the face whose outfit should be editable (or null for
 * product-only); the outfit is saved to that face and applies everywhere.
 */
export default function ThumbnailBoostPanel({ boost, face, disabled, showQuestionToggle = true }: {
  boost: ThumbnailBoost
  face?: { id: string; name: string } | null
  disabled?: boolean
  /** Hide the Question hook chip when the host page forces it. */
  showQuestionToggle?: boolean
}) {
  // Outfit — per face, saved to the face record.
  const [outfit, setOutfit] = useState('')
  const [savedOutfit, setSavedOutfit] = useState('')
  const [savingOutfit, setSavingOutfit] = useState(false)
  useEffect(() => {
    if (!face?.id) { setOutfit(''); setSavedOutfit(''); return }
    let cancelled = false
    ;(async () => {
      try {
        const d = await fetch('/api/face-models').then(r => r.json()).catch(() => ({}))
        const m = ((d?.models || []) as Array<{ id: string; outfit_pref?: string | null }>).find(x => x.id === face.id)
        if (!cancelled) { setOutfit(m?.outfit_pref || ''); setSavedOutfit(m?.outfit_pref || '') }
      } catch { /* leave blank */ }
    })()
    return () => { cancelled = true }
  }, [face?.id])
  const saveOutfit = useCallback(async () => {
    if (!face?.id) return
    const next = outfit.trim()
    if (next === savedOutfit.trim()) return
    setSavingOutfit(true)
    try {
      await fetch(`/api/face-models/${face.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outfitPref: next }) })
      setSavedOutfit(next)
    } catch { /* best-effort */ } finally { setSavingOutfit(false) }
  }, [face?.id, outfit, savedOutfit])

  const chip = (on: boolean) => `px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all disabled:opacity-60 ${on ? 'bg-[#7C3AED] text-white shadow-sm' : 'bg-gray-100 dark:bg-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:bg-gray-200 dark:hover:bg-white/20'}`
  const input = 'h-8 px-2.5 text-[12px] rounded-lg border bg-white dark:bg-[#1c1c1e] border-[#d2d2d7] dark:border-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#7C3AED] disabled:opacity-60'

  return (
    <div className="flex flex-col gap-3">
      {/* Quick style */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={muted}>Quick style</span>
        <div className="flex flex-wrap gap-1.5">
          {showQuestionToggle && (
            <button type="button" disabled={disabled} onClick={() => boost.setQuestion(!boost.question)} title="Headline becomes a curiosity question, with a matching expression" className={chip(boost.question)}>
              {boost.question ? '✓ ' : ''}Question hook
            </button>
          )}
          <button type="button" disabled={disabled} onClick={() => boost.setEffects(!boost.effects)} title="Speed lines, a streak on the product, a burst behind the title" className={chip(boost.effects)}>
            {boost.effects ? '✓ ' : ''}Energy
          </button>
          <button type="button" disabled={disabled} onClick={() => boost.setAutoBadge(!boost.autoBadge)} title="A starburst badge with a real benefit, written for you" className={chip(boost.autoBadge)}>
            {boost.autoBadge ? '✓ ' : ''}Badge
          </button>
          <button type="button" disabled={disabled} onClick={() => boost.setAutoAccent(!boost.autoAccent)} title="One headline word pops in red" className={chip(boost.autoAccent)}>
            {boost.autoAccent ? '✓ ' : ''}Red accent
          </button>
        </div>
      </div>

      {/* Match a look */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={muted}>Match a look</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {boost.savedStyles.map(s => (
            <span key={s.id} className="inline-flex items-center">
              <button type="button" disabled={disabled} onClick={() => boost.applyPreset(s.id, s.reference_url)} title={`Use the "${s.name}" look`}
                className={`px-3 py-1.5 rounded-l-full text-[12px] font-semibold transition-all disabled:opacity-60 ${boost.loadedPresetId === s.id ? 'bg-[#7C3AED] text-white shadow-sm' : 'bg-gray-100 dark:bg-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:bg-gray-200 dark:hover:bg-white/20'}`}>
                {boost.loadedPresetId === s.id ? '✓ ' : ''}{s.name}
              </button>
              <button type="button" disabled={disabled} onClick={() => void boost.deletePreset(s.id)} title="Delete this look"
                className={`px-2 py-1.5 rounded-r-full text-[12px] leading-none transition-all disabled:opacity-60 ${boost.loadedPresetId === s.id ? 'bg-[#7C3AED]/80 text-white' : 'bg-gray-100 dark:bg-white/10 text-[#86868b] hover:text-[#ff3b30]'}`}>×</button>
            </span>
          ))}
          <label title="Upload a thumbnail you love and MVP copies its style"
            className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full border border-dashed border-[#7C3AED] text-[#7C3AED] transition ${(boost.styleRefUploading || disabled) ? 'opacity-60' : 'hover:bg-[#7C3AED] hover:text-white cursor-pointer'}`}>
            {boost.styleRefUploading ? <><Loader2 size={12} className="animate-spin" /> Uploading…</> : '+ Upload a look'}
            <input type="file" accept="image/*" className="hidden" disabled={boost.styleRefUploading || disabled}
              onChange={e => { const f = e.target.files?.[0]; if (f) void boost.uploadStyleRef(f); e.currentTarget.value = '' }} />
          </label>
          {boost.styleReferenceUrl && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={boost.styleReferenceUrl} alt="Style reference" className="h-8 w-14 object-cover rounded-md border border-gray-200 dark:border-white/10" />
              {!boost.loadedPresetId && (
                <button type="button" disabled={boost.savingPreset || disabled} onClick={() => void boost.saveCurrentAsPreset()}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-full text-white disabled:opacity-60" style={{ background: '#7C3AED' }}>
                  {boost.savingPreset ? 'Saving…' : 'Save look'}
                </button>
              )}
              <button type="button" disabled={disabled} onClick={boost.clearStyle} className="text-[12px] text-[#86868b] hover:text-[#ff3b30] disabled:opacity-60">Remove</button>
            </>
          )}
        </div>
      </div>

      {/* Fine-tune */}
      <details className="rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2 group">
        <summary className="flex items-center gap-1.5 cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide" style={muted}>
          Fine-tune <span className="normal-case font-normal tracking-normal text-[#a1a1a6]">(optional)</span>
          <ChevronDown size={12} className="ml-auto text-[#86868b] transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          {face && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold" style={muted}>You with the product</span>
              <div className="flex flex-wrap gap-1.5">
                {([['auto', 'Auto'], ['hold', 'Hold it'], ['wear', 'Wear it'], ['use', 'Use it'], ['point', 'Point at it'], ['thumbs', 'Thumbs up']] as Array<[ThumbPose, string]>).map(([v, l]) => (
                  <button key={v} type="button" disabled={disabled} onClick={() => boost.setPose(v)}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all disabled:opacity-60 ${boost.pose === v ? 'bg-[#FF9500] text-white shadow-sm' : 'bg-gray-100 dark:bg-white/10 text-[#86868b] dark:text-[#8e8e93] hover:bg-gray-200 dark:hover:bg-white/20'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {face && (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold" style={muted}>Outfit <span className="font-normal text-[#a1a1a6]">— saved to {face.name}</span></span>
              <div className="flex items-center gap-2">
                <input value={outfit} onChange={e => setOutfit(e.target.value)} onBlur={() => { void saveOutfit() }} placeholder="e.g. a white lab coat" maxLength={120} disabled={disabled}
                  className={`flex-1 ${input} focus:border-[#FF9500]`} />
                {savingOutfit && <Loader2 size={13} className="animate-spin text-[#86868b]" />}
              </div>
            </label>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold" style={muted}>Badge text <span className="font-normal text-[#a1a1a6]">— overrides auto</span></span>
              <input value={boost.badgeText} onChange={e => boost.setBadgeText(e.target.value)} maxLength={18} disabled={disabled} placeholder="e.g. MAX POWER!" className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold" style={muted}>Red word <span className="font-normal text-[#a1a1a6]">— overrides auto</span></span>
              <input value={boost.accentWord} onChange={e => boost.setAccentWord(e.target.value)} maxLength={24} disabled={disabled} placeholder="e.g. STRONG" className={input} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold" style={muted}>Describe the scene <span className="font-normal text-[#a1a1a6]">— pose, mood, background</span></span>
            <textarea value={boost.scenePrompt} onChange={e => boost.setScenePrompt(e.target.value.slice(0, 400))} disabled={disabled} rows={2}
              placeholder="e.g. me holding the bottle, shocked face, bright kitchen, big arrow at the stain"
              className="w-full text-xs px-3 py-2 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#a1a1a6] focus:outline-none focus:border-[#7C3AED] transition resize-none disabled:opacity-60" />
          </label>
          <p className="text-[10px]" style={muted}>Your face and the real product always stay accurate. Quick style and pose are remembered for next time, on every page.</p>
        </div>
      </details>
    </div>
  )
}
