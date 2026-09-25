// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Choose the thumbnail look once, for all ten videos.
//
// THE SAME CONTROLS AS VIDEO LAUNCHPAD, deliberately. The batch worker used to
// build every thumbnail with no choice at all, which made a batch a worse
// Launchpad rather than a faster one. So this is the same face picker and the
// same ThumbnailBoostPanel the single-video page has, wired to the batch
// instead of to one render, and the panel's remembered preferences carry over:
// a creator who set their style on Launchpad finds it already chosen here.
//
// WHAT IS NOT HERE, AND WHY. There is no preview. A preview would need a
// product, and the products are set one step later, per video. Showing a
// thumbnail for a different video's product would be worse than showing none,
// so this step says what was CHOSEN and the board reports, per video, what was
// actually built.
'use client'

import { useEffect, useState } from 'react'
import ThumbnailBoostPanel, { useThumbnailBoost } from '@/components/thumbnails/ThumbnailBoostPanel'
import {
  defaultThumbnailPreset, presetSummary, LOOKS, DECORATIONS,
  type ThumbnailPreset, type FacePick, type DecorationChoice,
} from '@/lib/thumbnail-preset'
import { Loader2, Shuffle } from 'lucide-react'

const muted = { color: 'var(--text-2)' } as const

interface FaceModel { id: string; name: string }

export default function ThumbnailPicker({ value, chosen, saving, onSave }: {
  value: ThumbnailPreset | null
  chosen: boolean
  saving: boolean
  onSave: (preset: ThumbnailPreset) => void
}) {
  const boost = useThumbnailBoost({ defaultQuestion: true })
  const [faces, setFaces] = useState<FaceModel[]>([])
  const [facePick, setFacePick] = useState<FacePick>(value?.face ?? { kind: 'auto' })
  const [loadingFaces, setLoadingFaces] = useState(true)
  // The looks, the mix toggle and the badge are batch state, not panel state:
  // the panel is shared with Launchpad and these belong to this batch alone.
  const [lookIds, setLookIds] = useState<string[]>(value?.lookIds ?? [])
  const [mixLooks, setMixLooks] = useState(!!value?.mixLooks)
  const [decoration, setDecoration] = useState<DecorationChoice>(value?.decoration ?? 'brand')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await fetch('/api/face-models').then(r => r.json()).catch(() => ({}))
        const models = ((d?.models || []) as Array<{ id: string; name: string; status?: string }>)
          .map(m => ({ id: m.id, name: m.name }))
        if (!cancelled) setFaces(models)
      } catch { /* none saved */ } finally { if (!cancelled) setLoadingFaces(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // THE PANEL'S STATE IS THE TRUTH WHILE THE STEP IS OPEN, and it is read only
  // when Save is pressed. Writing on every keystroke would send a request per
  // character typed into the badge field, and a half-typed badge would be a
  // real stored preset between two of them.
  function save() {
    const f = boost.requestFields()
    const preset: ThumbnailPreset = {
      ...defaultThumbnailPreset(),
      headlineStyle: f.headlineStyle === 'statement' ? 'statement' : 'question',
      energyEffects: f.energyEffects === true,
      autoBadge: f.autoBadge === true,
      autoAccent: f.autoAccent === true,
      pose: (f.pose as ThumbnailPreset['pose']) ?? null,
      wearProduct: f.wearProduct === true,
      expression: (f.expression as ThumbnailPreset['expression']) ?? 'auto',
      badgeText: String(f.badgeText ?? ''),
      accentWord: String(f.accentWord ?? ''),
      styleReferenceUrl: (f.styleReferenceUrl as string | undefined) ?? null,
      scenePrompt: String(f.scenePrompt ?? ''),
      face: facePick,
      lookIds,
      mixLooks,
      decoration,
    }
    onSave(preset)
  }

  const pickedFace = facePick.kind === 'face' ? faces.find(m => m.id === facePick.faceId) ?? null : null
  const chipBase = 'px-3 py-1 rounded-full text-[11px] font-semibold disabled:opacity-60'
  const on = { background: '#FF9500', color: '#fff' }
  const off = { background: 'var(--surface-2)', color: 'var(--text-2)' }

  return (
    <div>
      <p className="text-[12px] mb-3" style={muted}>
        Chosen once and used on every video in this batch. Each one still gets its
        own product and its own hook, so ten thumbnails in one style, not ten
        copies of one thumbnail.
      </p>

      {/* ── who is on it ───────────────────────────────────────────────────── */}
      <div>
        <label className="text-[12px] font-medium" style={muted}>Who&apos;s on the thumbnails?</label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          <button type="button" disabled={saving}
            onClick={() => setFacePick({ kind: 'auto' })}
            className={chipBase} style={facePick.kind === 'auto' ? on : off}>
            My usual face
          </button>
          {faces.map(m => (
            <button key={m.id} type="button" disabled={saving}
              onClick={() => setFacePick({ kind: 'face', faceId: m.id })}
              className={chipBase} style={facePick.kind === 'face' && facePick.faceId === m.id ? on : off}>
              {m.name}
            </button>
          ))}
          <button type="button" disabled={saving}
            onClick={() => setFacePick({ kind: 'none' })}
            className={chipBase} style={facePick.kind === 'none' ? { background: '#3a3a3c', color: '#fff' } : off}>
            No face
          </button>
        </div>
        <p className="text-[11px] mt-1" style={muted}>
          Two presenters? Pick a different face for any one video in its row under Set each product.
        </p>
        {!loadingFaces && faces.length === 0 && (
          <p className="text-[11px] mt-1" style={muted}>
            No saved face yet. <a href="/photobooth" className="underline" style={{ color: '#7C3AED' }}>Add your selfies</a> to put yourself on these.
          </p>
        )}
      </div>

      {/* ── the look, chosen here rather than in Brand Profile ─────────────── */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <label className="text-[12px] font-medium" style={muted}>The look</label>
          {/* SAYS WHAT IT WILL DO, not just that it is on. "Mix it up" with
              nothing ticked and with three ticked are different promises, and
              a toggle that reads the same in both is a toggle nobody trusts. */}
          <button type="button" disabled={saving} onClick={() => setMixLooks(v => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold disabled:opacity-60"
            style={mixLooks ? { background: '#7C3AED', color: '#fff' } : off}>
            <Shuffle size={11} />
            {mixLooks
              ? (lookIds.length > 0 ? `Mixing your ${lookIds.length}` : 'Mixing all of them')
              : 'Mix it up'}
          </button>
        </div>
        <p className="text-[11px] mt-1" style={muted}>
          {mixLooks
            ? (lookIds.length > 0
                ? 'Each video draws one of the looks you ticked, so the ten are related without being identical.'
                : 'Nothing ticked, so each video draws from all of them. Tick a few to narrow it down.')
            : (lookIds.length > 0
                ? 'One look on all ten. Tick another and turn on Mix it up to vary them.'
                : 'Nothing ticked, so these use your brand\u2019s usual look. Changing it here does not change your brand.')}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {LOOKS.map(l => {
            const picked = lookIds.includes(l.id)
            return (
              <button key={l.id} type="button" disabled={saving} title={l.blurb}
                onClick={() => setLookIds(prev => picked ? prev.filter(x => x !== l.id) : [...prev, l.id])}
                className={chipBase} style={picked ? { background: '#7C3AED', color: '#fff' } : off}>
                {l.name}
              </button>
            )
          })}
          {lookIds.length > 0 && (
            <button type="button" disabled={saving} onClick={() => setLookIds([])}
              className={chipBase} style={{ ...off, textDecoration: 'underline' }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── the badge ──────────────────────────────────────────────────────── */}
      <div className="mt-4">
        <label className="text-[12px] font-medium" style={muted}>Badge on the thumbnail</label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {DECORATIONS.map(d => (
            <button key={d} type="button" disabled={saving} onClick={() => setDecoration(d)}
              className={chipBase} style={decoration === d ? { background: '#FF9500', color: '#fff' } : off}>
              {d === 'brand' ? 'Leave my brand setting' : d === 'auto' ? 'Let the design decide' : d === 'none' ? 'No badge' : d}
            </button>
          ))}
        </div>
      </div>

      {/* ── what actually gets built, per country ──────────────────────────── */}
      {/* THE TWO IMAGES, SAID PLAINLY. Every video gets both, and which one a
          storefront receives is decided by its language, not by anything the
          creator sets here. Saying it once at the point of choosing stops the
          text-free copy looking like a thumbnail that failed. */}
      <p className="text-[11.5px] mt-4 px-2.5 py-2 rounded"
        style={{ color: 'var(--text-2)', background: 'var(--surface-2)' }}>
        Every video gets two of these. The English-speaking stores and YouTube
        get the one with the hook written on it. Every other country gets the
        same design with no words at all, because an English hook sitting on a
        German listing is the same mistake as English audio under a translated
        title.
      </p>

      <div className="mt-4">
        <label className="text-[12px] font-medium" style={muted}>Face, pose and wording</label>
        <div className="mt-1.5">
          <ThumbnailBoostPanel boost={boost} face={pickedFace} disabled={saving} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving}
          className="h-9 px-4 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60 inline-flex items-center gap-2"
          style={{ background: '#7C3AED' }}>
          {saving && <Loader2 size={13} className="animate-spin" />}
          {chosen ? 'Update the look' : 'Use this look'}
        </button>
        {/* WHAT WAS SAVED, not what is on screen. The panel's controls show what
            is about to be saved; this line shows what the worker will actually
            replay, and they differ the moment somebody changes a chip without
            pressing the button. */}
        {chosen && value && (
          <p className="text-[12px]" style={muted}>Saved: {presetSummary(value)}</p>
        )}
      </div>
    </div>
  )
}
