// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Cutting the creator's own clothes out of the reference photo.
//
// "Make me wear it" kept coming back with a plain pale polo instead of the navy
// cable-knit one from the product photo. Six rounds of rewording the prompt
// moved it twice and regressed it twice, and the reason it could never be
// argued away is that it was never a wording problem:
//
//   THE PLAIN POLO WAS IN THE CREATOR'S SELFIE.
//
// The design step is handed selfies and told they are the identity lock, the
// highest priority thing in the brief. Those photos show a real person wearing
// real clothes. Nothing in a photograph marks which parts are "who this person
// is" and which parts are "what they happened to have on that day", so a model
// told to reproduce the person reproduces the shirt too. It is the same
// mechanism that made every expression come back as the selfie's expression,
// and it has the same answer: you do not out-argue a photograph, you change it.
//
// So when the product is worn, every creator reference is cropped to head and
// neck before it reaches the renderer. No collar, no shoulders, no torso, no
// garment to copy. The only clothing left anywhere in the reference set is the
// product photo itself.
//
// This module is the pure half: where to cut, and how to read the face box.
// Kept separate from the vision call and from sharp so the geometry has tests,
// because a crop rectangle that is wrong by a little takes the creator's chin
// off and the identity lock goes with it.

export interface FaceBox {
  /** Normalized 0..1, x/y = top-left corner of the face. */
  x: number
  y: number
  w: number
  h: number
}

export interface CropRect {
  left: number
  top: number
  width: number
  height: number
}

/** The one question, asked of the selfie. Deliberately not "describe this
 *  person": we want a rectangle, not an opinion, and a small model gives a
 *  better rectangle when that is the only thing it is asked for. */
export const FACE_BOX_PROMPT = `Find the single most prominent human face in this photo.

Return ONLY JSON, no other words: {"face":{"x":N,"y":N,"w":N,"h":N}}

x and y are the top-left corner of the face, w and h its size, each as a fraction of the image width or height between 0 and 1. Bound the FACE itself, from the hairline to the bottom of the chin and from ear to ear. Do not include the hair above the hairline, the neck, or the shoulders.

If there is no clear human face, return {"face":null}.`

/**
 * Read the face box out of whatever the model actually replied.
 *
 * Returns null for anything doubtful. Null means "keep the photo uncropped",
 * which risks the creator's own shirt showing up in the render. A bad box means
 * cropping the middle of someone's forehead and feeding that in as the identity
 * reference, which is worse and much harder to see afterwards.
 */
export function parseFaceBox(raw: string | null | undefined): FaceBox | null {
  const text = String(raw ?? '')
  const start = text.indexOf('{')
  if (start < 0) return null
  // Scan to the matching close brace rather than regexing, so a nested object
  // does not truncate the JSON halfway.
  let depth = 0
  let end = -1
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) return null

  let parsed: unknown
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null

  const face = (parsed as Record<string, unknown>).face
  if (!face || typeof face !== 'object') return null

  const f = face as Record<string, unknown>
  const n = (v: unknown): number | null => {
    const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
    return Number.isFinite(x) ? x : null
  }
  const x = n(f.x), y = n(f.y), w = n(f.w), h = n(f.h)
  if (x === null || y === null || w === null || h === null) return null

  // A face smaller than 3% of the frame is either a mistake or a face too small
  // to crop to usefully. A box that runs outside the image is a mistake too.
  if (w < 0.03 || h < 0.03 || w > 1 || h > 1) return null
  if (x < -0.02 || y < -0.02 || x + w > 1.02 || y + h > 1.02) return null

  return { x: Math.max(0, x), y: Math.max(0, y), w, h }
}

/**
 * Head and neck, and nothing below it.
 *
 * The padding is expressed in multiples of the FACE height rather than of the
 * image, so it holds for a tight headshot and for a half-body shot alike. The
 * face box is hairline to chin, so:
 *
 *   above  0.75× — the skull and hair above the hairline, plus air
 *   below  0.30× — chin to about the base of the neck, stopping short of where
 *                  a collar sits. This is the number that matters: too generous
 *                  and the shirt is back in the frame, which is the whole bug.
 *   sides  0.70× — ears, hair and jaw at any head angle
 *
 * Returns null when there is no face to work from, which the caller must read
 * as "use the photo as it is", never as "crop something".
 */
export function headCropRect(face: FaceBox | null, imgW: number, imgH: number): CropRect | null {
  if (!face) return null
  if (!(imgW > 0) || !(imgH > 0)) return null

  const fx = face.x * imgW
  const fy = face.y * imgH
  const fw = face.w * imgW
  const fh = face.h * imgH

  let left = Math.round(fx - fw * 0.70)
  let right = Math.round(fx + fw + fw * 0.70)
  let top = Math.round(fy - fh * 0.75)
  let bottom = Math.round(fy + fh + fh * 0.30)

  left = Math.max(0, Math.min(left, imgW - 1))
  top = Math.max(0, Math.min(top, imgH - 1))
  right = Math.min(imgW, Math.max(right, left + 1))
  bottom = Math.min(imgH, Math.max(bottom, top + 1))

  const width = right - left
  const height = bottom - top

  // Too small to be a usable identity reference. Better the original photo,
  // clothes and all, than a 20-pixel face the renderer cannot lock onto.
  if (width < 64 || height < 64) return null

  return { left, top, width, height }
}

/**
 * What the result card is told, for a set of references.
 *
 * Deliberately counts rather than judging. "How much of the frame came off" is
 * a threshold I would be picking out of the air, and it would report a tight
 * headshot and a half-body shot as the same thing. What actually needs to reach
 * the card is the case where a face box could not be found: no crop ran, the
 * creator's own clothing is still in front of the renderer, and a wrong garment
 * in that render has a known cause rather than being a mystery again.
 */
export function headCropNote(headOnly: number, withClothing: number, dropped = 0): string | null {
  if (headOnly + withClothing + dropped === 0) return null
  // The only bad state: a photograph of the creator in their own clothes is
  // still in front of the renderer, which is precisely when the wrong garment
  // comes back. Everything else is a working outcome and reads as one.
  if (withClothing > 0) {
    return withClothing === 1
      ? 'a reference photo could not be cropped, so what you are wearing in it may appear instead of the product'
      : `${withClothing} reference photos could not be cropped, so what you are wearing in them may appear instead of the product`
  }
  return dropped > 0
    ? 'reference photos cropped to head and neck (one that could not be cropped was left out)'
    : 'reference photos cropped to head and neck'
}
