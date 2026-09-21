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
import { defaultThumbnailPreset, presetSummary, type ThumbnailPreset, type FacePick } from '@/lib/thumbnail-preset'
import { Loader2 } from 'lucide-react'

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
        {!loadingFaces && faces.length === 0 && (
          <p className="text-[11px] mt-1" style={muted}>
            No saved face yet. <a href="/photobooth" className="underline" style={{ color: '#7C3AED' }}>Add your selfies</a> to put yourself on these.
          </p>
        )}
      </div>

      {/* ── the look ───────────────────────────────────────────────────────── */}
      <div className="mt-4">
        <label className="text-[12px] font-medium" style={muted}>Thumbnail style</label>
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
