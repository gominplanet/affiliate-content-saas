// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The thumbnail look a launch batch uses, chosen once and replayed on all ten.
//
// WHY THIS EXISTS. The batch worker built every thumbnail with no choice at
// all: no style, no face, no badge, no look to match. Video Launchpad has had
// those controls for months (components/thumbnails/ThumbnailBoostPanel), and a
// batch that ignores them is not a faster Launchpad, it is a different and
// worse one. So the batch stores the SAME fields the panel already produces and
// hands them to the SAME generator, and the only difference between one video
// and ten is how many times it runs.
//
// VALIDATED HARD, because of what a preset is. A CTA is chosen and burned in
// while somebody watches. This is stored once and replayed by a background
// worker onto ten videos with nobody present, so anything that survives this
// file is an instruction we will follow ten times without being asked again.
// Every field is an enum, a clamped string, or a URL in our own storage.

import { normalizeExpression, type ExpressionKey } from '@/lib/face-expression'

/** How the creator holds, wears or uses the product. Mirrors ThumbPose in the
 *  panel; 'auto' means the art director decides and is not stored. */
export const THUMB_POSES = ['hold', 'wear', 'use', 'point', 'thumbs'] as const
export type ThumbPoseChoice = (typeof THUMB_POSES)[number]

/** Who is in the frame.
 *
 *  Three real answers, not two. 'auto' takes the creator's first ready face,
 *  'none' is product only, and an id is one specific saved face. Stored as a
 *  choice so the worker can tell "they picked nobody" from "they never said". */
export type FacePick = { kind: 'auto' } | { kind: 'none' } | { kind: 'face'; faceId: string }

export interface ThumbnailPreset {
  /** Question hook or plain statement, the panel's first chip. */
  headlineStyle: 'question' | 'statement'
  energyEffects: boolean
  autoBadge: boolean
  autoAccent: boolean
  pose: ThumbPoseChoice | null
  /** Apparel goes ON the creator rather than in their hand. */
  wearProduct: boolean
  expression: ExpressionKey
  badgeText: string
  accentWord: string
  /** A thumbnail whose palette, lighting and type energy we copy. Ours only. */
  styleReferenceUrl: string | null
  scenePrompt: string
  face: FacePick
}

/** What a batch gets before anybody touches the controls: the house look, the
 *  creator's own face, and no words we were not asked for. */
export function defaultThumbnailPreset(): ThumbnailPreset {
  return {
    headlineStyle: 'question',
    energyEffects: false,
    autoBadge: false,
    autoAccent: false,
    pose: null,
    wearProduct: false,
    expression: 'auto',
    badgeText: '',
    accentWord: '',
    styleReferenceUrl: null,
    scenePrompt: '',
    face: { kind: 'auto' },
  }
}

/**
 * Is this a look we are willing to feed an image model as a reference.
 *
 * ONLY OUR OWN STORAGE. The panel uploads a creator's reference into the
 * `headshots` bucket, so that is the one shape we accept. An arbitrary URL here
 * would be a stored instruction to fetch and composite whatever it points at,
 * ten times, with nobody watching. Same reasoning as ctaStickerAllowed, and the
 * same answer.
 */
export function styleReferenceAllowed(url: string, supabaseUrl: string | undefined | null): boolean {
  const u = (url || '').trim()
  if (!u) return false
  const base = (supabaseUrl || '').replace(/\/+$/, '')
  if (!base) return false
  return u.startsWith(`${base}/storage/v1/object/public/headshots/`)
    && /\.(png|jpe?g|webp)(\?|$)/i.test(u)
}

/** A uuid, which is the only shape a face_models id takes. Anything else is not
 *  a face we could look up, so it becomes 'auto' rather than a failed query. */
function asFaceId(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null
}

/**
 * A preset we are prepared to store.
 *
 * NEVER THROWS AND NEVER REFUSES. Every field falls back to the default, so a
 * creator cannot end up with a batch that will not save because one control
 * sent something odd. The one field that could do harm, the style reference, is
 * simply dropped when it is not ours, and `rejected` says so, so the screen can
 * tell them rather than silently ignoring the look they picked.
 */
export function validateThumbnailPreset(
  raw: unknown, supabaseUrl: string | undefined | null,
): { preset: ThumbnailPreset; rejected: string[] } {
  const d = defaultThumbnailPreset()
  const p = (raw ?? {}) as Record<string, unknown>
  const rejected: string[] = []

  const bool = (v: unknown) => v === true
  // Clamped, not trusted. These land inside an image prompt, and a thousand
  // words of "badge text" is a second prompt riding along on every render.
  const text = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

  const poseRaw = String(p.pose ?? '')
  const pose = (THUMB_POSES as readonly string[]).includes(poseRaw) ? (poseRaw as ThumbPoseChoice) : null

  let styleReferenceUrl: string | null = null
  const rawStyle = String(p.styleReferenceUrl ?? '').trim()
  if (rawStyle) {
    if (styleReferenceAllowed(rawStyle, supabaseUrl)) styleReferenceUrl = rawStyle
    else rejected.push('That look is not one of your uploads, so it was left off.')
  }

  const faceRaw = (p.face ?? {}) as Record<string, unknown>
  const faceKind = String(faceRaw.kind ?? 'auto')
  let face: FacePick = d.face
  if (faceKind === 'none') face = { kind: 'none' }
  else if (faceKind === 'face') {
    const id = asFaceId(faceRaw.faceId)
    if (id) face = { kind: 'face', faceId: id }
    else rejected.push('That face is not one of yours, so your usual face is being used.')
  }

  return {
    preset: {
      headlineStyle: p.headlineStyle === 'statement' ? 'statement' : 'question',
      energyEffects: bool(p.energyEffects),
      autoBadge: bool(p.autoBadge),
      autoAccent: bool(p.autoAccent),
      pose,
      wearProduct: bool(p.wearProduct),
      expression: normalizeExpression(p.expression),
      badgeText: text(p.badgeText, 40),
      accentWord: text(p.accentWord, 24),
      styleReferenceUrl,
      scenePrompt: text(p.scenePrompt, 300),
      face,
    },
    rejected,
  }
}

/**
 * The preset as the generate-thumbnail route's body wants it.
 *
 * THE SAME FIELD NAMES THE PANEL SENDS. Video Launchpad spreads
 * `boost.requestFields()` into this exact request, so the batch producing a
 * different set of names would be a second contract to the same generator and
 * the first one to change would break quietly on whichever side was not
 * updated. Anything falsy is left out rather than sent as false, because the
 * route reads several of these as "present at all".
 */
export function presetToRequestFields(preset: ThumbnailPreset): Record<string, unknown> {
  const accent = preset.accentWord.trim()
  return {
    headlineStyle: preset.headlineStyle,
    energyEffects: preset.energyEffects || undefined,
    autoBadge: preset.autoBadge || undefined,
    autoAccent: preset.autoAccent || undefined,
    pose: preset.pose ?? undefined,
    wearProduct: preset.wearProduct || undefined,
    ...(preset.expression !== 'auto' ? { expression: preset.expression } : {}),
    badgeText: preset.badgeText || undefined,
    accentWord: accent || undefined,
    ...((accent || preset.autoAccent) ? { accentColor: '#FF2D2D' } : {}),
    styleReferenceUrl: preset.styleReferenceUrl ?? undefined,
    scenePrompt: preset.scenePrompt || undefined,
    // The creator's pick, in the two shapes the route understands.
    ...(preset.face.kind === 'none'
      ? { noHuman: true }
      : preset.face.kind === 'face'
        ? { faceModelId: preset.face.faceId }
        : {}),
  }
}

/** One line describing the chosen look, for the step card. It says what was
 *  CHOSEN, never "a thumbnail will be made", because every screen in this
 *  codebase that reported the plan rather than the result hid a bug. */
export function presetSummary(preset: ThumbnailPreset): string {
  const bits: string[] = []
  bits.push(preset.headlineStyle === 'question' ? 'Question hook' : 'Statement hook')
  if (preset.face.kind === 'none') bits.push('product only')
  else if (preset.face.kind === 'face') bits.push('your chosen face')
  else bits.push('your face')
  if (preset.styleReferenceUrl) bits.push('matching a look you saved')
  if (preset.pose) bits.push(`${preset.pose === 'thumbs' ? 'thumbs up' : preset.pose} the product`)
  if (preset.wearProduct) bits.push('worn, not held')
  if (preset.autoBadge || preset.badgeText) bits.push('with a badge')
  if (preset.energyEffects) bits.push('with energy effects')
  return `${bits.join(', ')}. The same on all of them.`
}
