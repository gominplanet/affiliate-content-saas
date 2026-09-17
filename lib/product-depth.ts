// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW MANY PRODUCTS A POST CAN CARRY IS DECIDED BY HOW MUCH IT CAN SAY ABOUT EACH.
//
// Roundups were capped at twelve. Not twelve because twelve products deserved
// covering, but because twelve was the number in the slice:
//
//   const unique = [...new Set(asins)].slice(0, 12)
//
// Nothing anywhere asked whether there was enough to say about twelve things.
// Pair that cap with a nine hundred word post and each product gets about
// seventy words, which is a caption. A reader deciding between twelve options
// learns nothing from seventy words each, and Google, looking at a page that
// lists twelve products and explains none of them, has an easy call to make.
// That call is "Crawled, currently not indexed", and on one MVP site 394 posts
// had received it.
//
// So the count is now an OUTPUT, not an input. Decide what a product needs in
// order to be genuinely covered, divide the post's word budget by it, and that
// is how many products the post gets. Fewer picks, each actually explained,
// beats a list nobody can act on.
//
// The dropped picks are reported rather than silently trimmed. A creator who
// selected twelve deals and sees five in the finished post is owed the reason,
// or MVP looks broken in exactly the way a silently truncated list always does.

/** What kind of post this is. The two need genuinely different depth. */
export type ContentKind = 'review' | 'deal'

/**
 * What one product needs before it has been covered rather than mentioned.
 *
 * Two numbers, because a deal entry and a review entry are not the same job and
 * pretending otherwise would make one of them wrong.
 *
 * A REVIEW entry is roughly three paragraphs: what it is, how it performs at the
 * thing it is for, and who should pick it over the others here. Below two
 * hundred words it cannot contain a reason, and a recommendation without a
 * reason is what readers skim past and search engines discount.
 *
 * A DEAL entry is a smaller job and forcing it to review length would turn a
 * useful weekly list into something nobody finishes. It still has to say what
 * the thing is, why this price is worth acting on, and who it suits. The old
 * instruction asked for "2 short sentences each", about thirty words, which
 * covers none of those three, and twelve of them made a four hundred word page
 * listing twelve products and explaining none.
 *
 * Neither floor can be lowered by a caller. A caller who wants shallower entries
 * is asking for the thing this module exists to prevent.
 */
export const MIN_WORDS: Record<ContentKind, number> = {
  review: 200,
  deal: 120,
}

/** Back-compatible alias for the review floor. */
export const MIN_WORDS_PER_PRODUCT = MIN_WORDS.review

/**
 * Words the post spends on everything that is not a product: the opening, how
 * the picks were chosen, and the close. Held back before the division so the
 * framing does not get eaten by an extra entry.
 */
export const FRAMING_WORDS = 250

export type PostKind = 'roundup' | 'comparison' | 'single'

export interface DepthPlan {
  /** How many products this post can carry at real depth. Always at least 1. */
  count: number
  /** The floor each one gets. */
  minWordsEach: number
  /** Roughly how many words each will actually have. */
  wordsEach: number
  /** How many candidates did not make the cut. */
  dropped: number
  /** What this post honestly is, once the count is known. Three products is a
   *  comparison, not a roundup, and calling it one in the title would promise
   *  a breadth the page does not have. */
  kind: PostKind
  /** What to tell the creator. Null when nothing was cut. */
  note: string | null
}

export interface DepthInput {
  /** How many products are available to write about. */
  candidates: number
  /** The post's word ceiling, from lib/source-budget.ts. */
  maxWords: number
  /** What the caller wanted, if it asked for a specific number. */
  requested?: number | null
  /** Override the per-product floor. Raising it is always allowed; lowering it
   *  below the kind's floor is not, because that is the thing this module exists
   *  to stop. */
  minWordsEach?: number
  /** Which floor applies. Defaults to 'review', the stricter of the two, so a
   *  caller that forgets to say gets the safer answer rather than the looser
   *  one. */
  contentKind?: ContentKind
}

/**
 * Decide how many products this post covers.
 */
export function planProductDepth(input: DepthInput): DepthPlan {
  const floor = MIN_WORDS[input.contentKind ?? 'review'] ?? MIN_WORDS.review
  const minWordsEach = Math.max(floor, Number(input.minWordsEach) || 0)
  const candidates = Math.max(0, Math.floor(Number(input.candidates) || 0))
  const maxWords = Math.max(0, Math.floor(Number(input.maxWords) || 0))
  const requested = input.requested != null && Number.isFinite(Number(input.requested))
    ? Math.max(0, Math.floor(Number(input.requested)))
    : null

  const forProducts = Math.max(0, maxWords - FRAMING_WORDS)
  const capacity = Math.floor(forProducts / minWordsEach)

  // A post has to cover something. Where the budget genuinely cannot carry one
  // product at depth, the answer is one product written short, not zero, but
  // the shortfall is reported rather than presented as a plan.
  const wanted = Math.min(
    candidates > 0 ? candidates : 1,
    requested != null && requested > 0 ? requested : Number.MAX_SAFE_INTEGER,
  )
  const count = Math.max(1, Math.min(wanted, Math.max(1, capacity)))
  const dropped = Math.max(0, wanted - count)
  const wordsEach = count > 0 ? Math.floor(forProducts / count) : 0

  const kind: PostKind = count === 1 ? 'single' : count <= 3 ? 'comparison' : 'roundup'

  let note: string | null = null
  if (dropped > 0) {
    const wouldBe = Math.floor(forProducts / wanted)
    note = `You picked ${wanted.toLocaleString()} products but this post covers ${count.toLocaleString()}. At ${wanted.toLocaleString()} each one would get about ${wouldBe.toLocaleString()} words, which is a caption rather than a recommendation, and a list that explains nothing is the kind of page Google declines to index. The ${count.toLocaleString()} that made the cut get room to say why they are worth buying. A longer video, or a longer post setting, raises the number.`
  } else if (capacity < 1) {
    note = `There is only room for one product in this post, because the video and product details do not stretch far enough to cover more than one properly.`
  }

  return { count, minWordsEach, wordsEach, dropped, kind, note }
}

/**
 * The instruction the writer receives.
 *
 * States the floor rather than a target, and says what to do when a product has
 * nothing behind it, which is to cut it rather than pad it. Padding a weak pick
 * to reach a word count is the exact failure the floor exists to prevent, so the
 * floor must never become a reason to invent.
 */
export function depthToPrompt(plan: DepthPlan): string {
  if (plan.kind === 'single') {
    return `PRODUCTS: this post covers ONE product. Do not introduce alternatives as
if they were picks of their own. A named competitor may be mentioned in passing
for comparison, but it does not get its own section or its own link.`
  }
  return `PRODUCTS: this post covers EXACTLY ${plan.count}, and each one gets at least
${plan.minWordsEach} words.

That floor is the point of the post. Anything less cannot hold a reason, and a
recommendation without a reason is what readers skim and search engines discount.
Each entry needs what it is, how it does the thing it is for, and who should pick
it over the others here.

The floor is not a quota to pad toward. If one of these products has nothing
behind it in the source, say so briefly and move on, or leave it out. A padded
entry is worse than a missing one.

This is a ${plan.kind === 'comparison' ? 'COMPARISON of a small number of options, so compare them against each other directly rather than reviewing each in isolation' : 'ROUNDUP, so make clear what separates the picks from one another'}.`
}
