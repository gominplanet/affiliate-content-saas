// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Did the render put the RIGHT garment on the creator?
//
// "Make me wear it" came back correct, wrong, correct, correct, wrong across a
// single afternoon on the same product. Not a bug with a line number: an image
// model handed a navy cable-knit polo will sometimes render a plain pale one,
// and rewording the instruction moved it twice and regressed it twice. At that
// point more wording is superstition.
//
// The cheap fix is not to generate more and hope. Three variants is three times
// the image bill on every apparel thumbnail to fix something already right half
// the time. It is to LOOK at what came back, for a fraction of a cent, and pay
// for a second render only on the ones that were actually wrong.
//
// Two rules make this safe to put in a generation path:
//
// IT FAILS OPEN. Unsure, malformed, timed out, model unavailable — all mean
// "keep the render". A check that can reject a good thumbnail because a vision
// model hedged is worse than no check, and this runs on every apparel design.
//
// IT ONLY JUDGES THE GARMENT. Not the design, not the face, not whether the
// thumbnail is any good. One question, answerable from two pictures, so a
// wrong answer costs one extra render and never a wrong opinion about taste.

export interface GarmentVerdict {
  /** true = same garment, false = clearly a different one, null = cannot tell.
   *  null and false are NOT the same: only false is worth paying to re-render. */
  match: boolean | null
  /** What differed, in the model's words. For logs and the result card. */
  reason: string
}

/**
 * Read the judge's answer.
 *
 * Kept pure and separate from the API call so the parsing has tests: this
 * decides whether a creator's generation gets billed twice, and "the model said
 * something unexpected" must land on keep-it rather than spend-again.
 */
export function parseGarmentVerdict(raw: string | null | undefined): GarmentVerdict {
  const text = String(raw ?? '').trim()
  if (!text) return { match: null, reason: 'no answer' }

  // The model is asked for MATCH / DIFFERENT / UNSURE on the first line. Accept
  // it anywhere in the first stretch of the reply, since a small model likes to
  // open with "Looking at these images...".
  const head = text.slice(0, 400).toUpperCase()
  const iMatch = head.indexOf('MATCH')
  const iDiff = head.indexOf('DIFFERENT')
  const iUnsure = head.indexOf('UNSURE')

  const reason = text.replace(/^[^:]{0,40}:\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 200)

  // Whichever verdict it stated FIRST is the answer, so a reason that mentions
  // another word later ("...different lighting, but they MATCH") cannot flip it.
  const found = [
    { at: iDiff, v: false as const },
    { at: iMatch, v: true as const },
    { at: iUnsure, v: null },
  ].filter(x => x.at >= 0).sort((a, b) => a.at - b.at)

  if (!found.length) return { match: null, reason }
  return { match: found[0].v, reason }
}

/** The one question, and the rules that keep the answer usable. */
export const GARMENT_CHECK_PROMPT = `Image 1 is a product photo of a piece of clothing. Image 2 is a thumbnail design in which a person is supposed to be wearing THAT SAME item.

Answer with ONE word on the first line: MATCH, DIFFERENT, or UNSURE. Then one short sentence saying why.

Judge ONLY the garment. Ignore the person, the background, the text, the colours of the design, the lighting and the photo quality.

Say DIFFERENT only for a change a shopper would notice as the wrong product: the wrong colour, a pattern or texture that is missing or invented, a missing contrast collar, trim or panel, or plainly the wrong kind of garment.

Say MATCH when it is the same item. Small differences in shade from lighting, fabric folds, fit, crop, or a partly hidden garment are all a MATCH.

Say UNSURE when the garment is too obscured to judge. Do not guess.`

/** The same MATCH / DIFFERENT / UNSURE parser, under a name that does not claim
 *  to be about garments. The face check uses the identical answer shape, and two
 *  copies of this logic would drift the moment one of them was tightened. */
export const parseVerdict = parseGarmentVerdict

/** Does the generated portrait actually show the expression that was asked for?
 *
 *  The portrait is the single image the whole feature rests on: the design step
 *  copies the face it is handed, so a portrait that came back with a polite
 *  smile makes a thumbnail with a polite smile whatever the creator picked. It
 *  costs a fraction of a cent to look, against $0.06 to render the portrait
 *  again, so this is the cheapest check in the pipeline and guards the most.
 *
 *  Same two rules as the garment check: it fails open, and it judges one thing. */
export function expressionCheckPrompt(label: string, description: string): string {
  return `This is a portrait generated to show one specific facial expression.

THE EXPRESSION IT WAS SUPPOSED TO SHOW — "${label}": ${description}.

Answer with ONE word on the first line: MATCH, DIFFERENT, or UNSURE. Then one short sentence saying why.

Judge ONLY the expression. Ignore who the person is, the lighting, the background and the image quality.

Say DIFFERENT when the face shows a clearly different emotion from the one described, or when it shows the neutral, polite closed-mouth smile that these models fall back to instead of committing to an expression.

Say MATCH when the emotion described is the one a viewer would name looking at this face, even if it is less exaggerated than the description.

Say UNSURE only when the face is obscured or cropped so you cannot judge it.`
}
