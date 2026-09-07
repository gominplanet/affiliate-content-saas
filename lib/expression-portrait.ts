// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The prompt for a portrait of the creator wearing a chosen expression.
//
// This is the image the whole feature now rests on. The design step copies the
// face it is given, faithfully and by design, so if this portrait comes back
// with a polite smile then the thumbnail does too, whatever the creator picked.
//
// WHAT ORDER TEACHES A MODEL. The first version of this opened with a long,
// emphatic "reproduce their facial identity exactly: same bone structure, same
// eye colour, same nose…" and put the expression three paragraphs down. Handed a
// photograph and told first and at length to reproduce it exactly, an
// image-to-image model does the obvious thing and copies the photograph,
// expression included. The expression was arguing uphill against the sentence
// that framed the whole task.
//
// So the task is stated as what it actually is: a portrait of a person MAKING A
// PARTICULAR FACE. Identity comes second, as the constraint it is. Both are
// required, but only one of them can be the subject, and the subject has to be
// the thing we are trying to change.

import { expressionDescription, type ExpressionKey } from '@/lib/face-expression'

/**
 * Returns the prompt, or null when there is nothing to ask for (Auto).
 *
 * Pure and exported so scripts/test-expression-portrait.ts can read the finished
 * string. The bug that produced six identical faces was invisible in the
 * template and obvious in the assembled result.
 */
export function buildExpressionPortraitPrompt(key: ExpressionKey): string | null {
  const description = expressionDescription(key)
  if (!description) return null

  return `A photorealistic close-up portrait of ONE person MAKING A SPECIFIC FACIAL EXPRESSION. The expression is the entire point of this image:

${description.charAt(0).toUpperCase()}${description.slice(1)}.

Make it unmistakable. Someone glancing at this face for a quarter of a second must be able to name the emotion without being told. If it calls for a raised brow, raise it visibly. If it calls for an open mouth, open it. A polite closed-mouth smile is the safe answer this model reaches for whenever an expression is difficult, and it is the WRONG answer for every expression except a warm one.

WHO the person is comes from the reference photos, and only who: their bone structure, eye colour, nose, hair colour and texture and style, skin tone, apparent age, facial hair and distinguishing marks. A viewer who knows them must recognise them instantly.

The reference photos show this person wearing a DIFFERENT expression from the one described above. Do NOT copy the expression, the eyebrow position, the mouth position, the eye openness or the head angle from them. Their eye and lip shape means the proportion of those features at rest, not their current position: eyes widen, brows lift and mouths open, and the person is unmistakably still themselves throughout. That is exactly what this image must show.

FRAMING — HEAD AND NECK ONLY. Crop at the base of the neck, above the collarbone. NO clothing, NO collar, NO shoulders, NO torso may be visible: this image carries a face and nothing else, because the design it feeds may put a specific garment on this person and any clothing invented here would compete with it.

Even, flattering studio lighting. Realistic natural skin texture with visible pores — not smoothed, not beauty-filtered, not de-aged. Plain, evenly lit neutral grey backdrop. No text, no logos, no props, and absolutely no second person anywhere in the frame.`
}
