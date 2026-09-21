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
import { VISUAL_PRESETS, parsePresetIds } from '@/lib/visual-presets'

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

/** The badge on the thumbnail. 'brand' keeps whatever the creator set on their
 *  brand, so a batch that never touches this leaves it exactly as it was. */
export const DECORATIONS = ['brand', 'auto', 'check', 'stars', 'arrow', 'none'] as const
export type DecorationChoice = (typeof DECORATIONS)[number]

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
  /** The looks these thumbnails are designed in, from lib/visual-presets.
   *
   *  EMPTY MEANS THE BRAND'S OWN, which is the only honest default: a batch
   *  that says nothing about looks must not quietly restyle a creator who has
   *  already chosen one on their brand.
   *
   *  Chosen HERE rather than in Brand Profile on purpose. A look picked for one
   *  batch is not a change to the brand, and storing it there would restyle the
   *  blog heroes and the pins too. */
  lookIds: string[]
  /** Roll a different look for each video instead of using one for all ten.
   *
   *  THE TOGGLE IS SEPARATE FROM THE SELECTION so "mix it up" can mean two
   *  different things and the creator can tell which they asked for: with looks
   *  ticked it rolls among those, with none ticked it rolls among all of them,
   *  which is the surprise-me case. Off, the first ticked look is used on every
   *  video and the batch stays one consistent set. */
  mixLooks: boolean
  /** The badge, or the brand's own setting left alone. */
  decoration: DecorationChoice
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
    lookIds: [],
    mixLooks: false,
    decoration: 'brand',
  }
}

/** Every look a creator can pick, for the picker. One list, the same twenty the
 *  rest of the product uses, so a batch can never offer a look nothing renders. */
export const LOOKS = VISUAL_PRESETS.map(p => ({
  id: p.id, name: p.name, blurb: p.blurb, family: p.family,
}))

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
      // FILTERED AGAINST THE REAL LIST. An id nothing renders would be stored,
      // replayed ten times, and silently produce the default look, which is
      // indistinguishable from the creator's choice having worked.
      lookIds: parsePresetIds(Array.isArray(p.lookIds) ? p.lookIds.join(',') : ''),
      mixLooks: bool(p.mixLooks),
      decoration: (DECORATIONS as readonly string[]).includes(String(p.decoration ?? ''))
        ? (p.decoration as DecorationChoice)
        : 'brand',
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
  const looks = looksForRequest(preset)
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
    // Left OUT rather than sent empty when the creator said nothing about
    // looks. An empty array would read as "no look", and the route would fall
    // back to the default instead of to the brand's own choice.
    visualPresetIds: looks.length > 0 ? looks : undefined,
    decoration: preset.decoration === 'brand' ? undefined : preset.decoration,
    // The creator's pick, in the two shapes the route understands.
    ...(preset.face.kind === 'none'
      ? { noHuman: true }
      : preset.face.kind === 'face'
        ? { faceModelId: preset.face.faceId }
        : {}),
  }
}

/**
 * The look ids to send for one image.
 *
 * The route rolls per image when it is given more than one, so this decides
 * what the pool is rather than doing any rolling itself:
 *
 *   mix off, looks picked   one look on all ten, the consistent case
 *   mix off, none picked    nothing: the brand's own look, untouched
 *   mix on,  looks picked   roll among the ones they picked
 *   mix on,  none picked    roll among all of them, which is surprise me
 */
export function looksForRequest(preset: ThumbnailPreset): string[] {
  if (!preset.mixLooks) return preset.lookIds.slice(0, 1)
  if (preset.lookIds.length > 0) return preset.lookIds
  return LOOKS.map(l => l.id)
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
  // THE LOOKS, NAMED. "Mixed" on its own does not tell somebody whether their
  // three ticks took effect or whether it is rolling all twenty.
  if (preset.mixLooks && preset.lookIds.length === 0) bits.push('a different look on each, from all of them')
  else if (preset.mixLooks && preset.lookIds.length > 1) bits.push(`a different look on each, from ${preset.lookIds.length} you picked`)
  else if (preset.lookIds.length > 0) {
    const name = LOOKS.find(l => l.id === preset.lookIds[0])?.name
    bits.push(name ? `the ${name} look on all of them` : 'one look on all of them')
  } else bits.push('your brand\u2019s usual look')
  if (preset.decoration === 'none') bits.push('no badge')
  else if (preset.decoration !== 'brand') bits.push(`a ${preset.decoration} badge`)
  if (preset.styleReferenceUrl) bits.push('matching a look you saved')
  if (preset.pose) bits.push(`${preset.pose === 'thumbs' ? 'thumbs up' : preset.pose} the product`)
  if (preset.wearProduct) bits.push('worn, not held')
  if (preset.autoBadge || preset.badgeText) bits.push('with a badge')
  if (preset.energyEffects) bits.push('with energy effects')
  return `${bits.join(', ')}. The same on all of them.`
}
