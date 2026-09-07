// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// How much of the creator is in the frame, and what their body is.
//
// Every design MVP builds with a person in it has said the same thing since the
// feature existed: head and shoulders to chest-up, and never invent their body.
// That rule was right when the only products in play were things you hold. It
// became a silent hole the day "make me wear it" shipped, because the wearable
// detector already recognises trousers, shoes, socks, dresses and swimwear and
// hands the prompt a correct instruction like "worn on their feet" — which the
// very next sentence then forbids the model from showing. A creator ticking the
// box on a pair of sneakers got a portrait of his face.
//
// So framing becomes a choice. And the moment it does, a second problem opens:
// MVP holds head-and-chest selfies and nothing else, so everything below the
// chest in a full-body render is invented. The obvious fix is to ask for a
// full-body reference photo, and that is exactly wrong. A photograph of the
// creator in their own clothes, sitting in the reference set, is what made
// "make me wear it" return the wrong garment for six rounds: a photo outranks
// any sentence about a different garment. Adding one back to buy body accuracy
// would trade a solved bug for an unsolved one.
//
// A few words do not outrank a photograph, which here is the point. Build and
// height are text, they compete with nothing, and they get most of the accuracy
// for none of the risk.

import type { ApparelKind } from '@/lib/wear-product'

/** What the creator picked, or 'auto' when they have not touched it and the
 *  product category should decide. */
export type Framing = 'auto' | 'bust' | 'full'
/** The two things that actually reach a prompt. */
export type EffectiveFraming = 'bust' | 'full'

export type BuildKey = 'slim' | 'average' | 'athletic' | 'muscular' | 'curvy' | 'broad'
export type HeightKey = 'short' | 'average' | 'tall'

export const BUILDS: { key: BuildKey; label: string; phrase: string }[] = [
  { key: 'slim', label: 'Slim', phrase: 'a slim, lean build' },
  { key: 'average', label: 'Average', phrase: 'an average, everyday build' },
  { key: 'athletic', label: 'Athletic', phrase: 'an athletic, toned build' },
  { key: 'muscular', label: 'Muscular', phrase: 'a muscular, powerfully built frame' },
  { key: 'curvy', label: 'Curvy', phrase: 'a curvy build with fuller hips and bust' },
  { key: 'broad', label: 'Broad', phrase: 'a broad, solidly built frame' },
]

export const HEIGHTS: { key: HeightKey; label: string; phrase: string }[] = [
  { key: 'short', label: 'Short / petite', phrase: 'shorter than average with petite proportions' },
  { key: 'average', label: 'Average', phrase: 'average height' },
  { key: 'tall', label: 'Tall', phrase: 'tall, with long legs relative to the torso' },
]

export function normalizeFraming(v: unknown): Framing {
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'bust' || s === 'full' ? s : 'auto'
}

export function normalizeBuild(v: unknown): BuildKey {
  const s = String(v ?? '').trim().toLowerCase()
  return BUILDS.some(b => b.key === s) ? (s as BuildKey) : 'average'
}

export function normalizeHeight(v: unknown): HeightKey {
  const s = String(v ?? '').trim().toLowerCase()
  return HEIGHTS.some(h => h.key === s) ? (s as HeightKey) : 'average'
}

/**
 * What the product needs when the creator has expressed no preference.
 *
 * Only the categories a bust shot physically cannot show. A jacket, a watch or
 * sunglasses read fine chest-up, and a bust shot puts far more of the face on
 * screen, which is what a thumbnail is actually competing on. So this is a
 * short list on purpose: it exists to stop the impossible cases, not to
 * relitigate framing for products that were already working.
 */
export function autoFraming(kind: ApparelKind | null | undefined): EffectiveFraming {
  switch (kind) {
    case 'bottom':
    case 'shoes':
    case 'socks':
    case 'dress':
    case 'swimwear':
      return 'full'
    default:
      return 'bust'
  }
}

/** The creator's pick wins; 'auto' defers to the product. */
export function resolveFraming(chosen: Framing, kind: ApparelKind | null | undefined): EffectiveFraming {
  return chosen === 'auto' ? autoFraming(kind) : chosen
}

export function buildPhrase(k: BuildKey): string {
  return (BUILDS.find(b => b.key === k) ?? BUILDS[1]).phrase
}

export function heightPhrase(k: HeightKey): string {
  return (HEIGHTS.find(h => h.key === k) ?? HEIGHTS[1]).phrase
}

/**
 * The single source of the framing sentence, for every path that renders a
 * person.
 *
 * There is exactly one of these in a prompt and the two versions must never
 * both appear. "Show them full body, head to feet" sitting anywhere near "do
 * NOT show their full body or legs" is the same class of bug that produced a
 * plain polo and a polite smile: two sentences about one subject, with the
 * later or more concrete one quietly winning. scripts/test-body-framing.ts
 * fails the build if both are ever present.
 */
export function framingLine(opts: {
  framing: EffectiveFraming
  build?: BuildKey
  height?: HeightKey
}): string {
  if (opts.framing === 'full') {
    return `Show them FULL BODY, head to feet, standing in a relaxed natural stance with their feet completely inside the frame and nothing cut off at the bottom. The whole of what they are wearing must be visible, including the part below the waist. The reference photos show only their head and shoulders, so their body below that is not documented anywhere: give them ${buildPhrase(opts.build ?? 'average')}, ${heightPhrase(opts.height ?? 'average')}, in natural human proportion. Their face stays exactly as the references show it and stays sharp enough to recognise at full-body scale.`
  }
  return 'Show them HEAD-AND-SHOULDERS to roughly CHEST-UP only. The references are head-and-chest selfies, so do NOT invent or show their full body, legs, waist-down, or overall body build — keep it an upper-body shot (they can still react, point, or gesture with hands near the frame).'
}

/** What the result card says, so an invented body is never mistaken for a
 *  photographed one. */
export function framingNote(framing: EffectiveFraming, build: BuildKey, height: HeightKey): string | null {
  if (framing !== 'full') return null
  const b = BUILDS.find(x => x.key === build)?.label ?? 'Average'
  const h = HEIGHTS.find(x => x.key === height)?.label ?? 'Average'
  return `Full body, drawn as ${b.toLowerCase()} build and ${h.toLowerCase()} height. MVP only has photos of your face, so your body here is generated from those two settings, not from a photo.`
}
