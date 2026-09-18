// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW THE PIN WAS ACTUALLY MADE, as a value the callers can act on.
//
// A scheduled pin went live looking nothing like the three before it: the
// account's designed Art Director look was gone and it was back to the old
// photo-scene with a Satori badge over it. Nothing was broken, nothing errored,
// and nothing anywhere said so. buildPinAssets returned an imageBase64 and
// every caller treated that as success, because an imageBase64 is all it
// returned. The designed pin and the fallback are the same shape.
//
// FOUR PLACES DOWNGRADE THE PIN, and before this only one of them logged:
//
//   1. referenceImageUrl never resolves. No real product photo means the Art
//      Director branch is skipped by its own `if`, so there is no error to
//      catch and no line to log. This is the most common one and was
//      completely invisible.
//   2. generateArtDirectorPin returns null. It is best-effort by design: ANY
//      internal failure returns null so the flow never breaks. The caller then
//      falls through without comment.
//   3. prerender-pins stores whatever imageBase64 it gets. A fallback composite
//      gets written to the row as the finished pin, and the publish cron's
//      fast path posts it without ever running the art-director code.
//   4. the fire-time 30s budget race in process-scheduled. This one warns.
//
// Any of the four produces a pin that is off-brand and indistinguishable from
// success everywhere a human looks.
//
// So buildPinAssets now says which path made the image. That is the whole idea:
// the caller can decide (prerender refuses to bank a fallback, so fire-time
// retries), and the outcome is written to the row, so "how often do pins go out
// off-brand" becomes a query instead of a scroll through Vercel logs.

/** How the pin image was produced, most wanted first. */
export type PinDesign =
  /** The designed Art Director pin: product hero, baked headline, callouts. */
  | 'art-director'
  /** The designed multi-product comparison grid, for roundups and guides. */
  | 'art-director-collage'
  /** Name-grounded collage. Older roundup path, no real product photos. */
  | 'collage-fallback'
  /** Fresh Gemini scene plus a Satori text overlay. The old single-pin look. */
  | 'scene-overlay'
  /** The post's own hero image composited into 2:3, plus the Satori overlay.
   *  The cheapest path and the one in the pin that started this. */
  | 'composite-thumbnail'
  /** No image at all; the caller pins fallbackImageUrl. */
  | 'none'

/** Why the designed path did not run. Null when it did. */
export type PinDowngrade =
  /** A finished image was thrown away because it carried a retailer logo.
   *  The HARD RULE, and the only downgrade that means we refused a render we
   *  already paid for. Outranks every other reason when both apply. */
  | 'brand-leak'
  | 'no-product-reference'
  | 'art-director-returned-null'
  | 'roundup-needs-two-photos'
  | 'not-requested'
  | null

export interface PinDesignOutcome {
  design: PinDesign
  downgrade: PinDowngrade
}

const DESIGNED: PinDesign[] = ['art-director', 'art-director-collage']

/** True when the pin carries the account's designed look. */
export function isDesignedPin(design: PinDesign): boolean {
  return DESIGNED.includes(design)
}

/**
 * True when the caller ASKED for the designed pin and did not get it.
 *
 * Separate from isDesignedPin, because the cheap path is a legitimate choice:
 * a bulk push that never requested the Art Director is not a downgrade, it is
 * the product working as configured. Only a request that quietly returned
 * something lesser counts, and only that should raise an eyebrow.
 */
export function pinWasDowngraded(o: PinDesignOutcome, requested: boolean): boolean {
  if (!requested) return false
  return !isDesignedPin(o.design)
}

/**
 * One line a human can act on, or null when nothing went wrong.
 *
 * Says what shipped AND what to do, because "art-director-returned-null" in a
 * log is a fact about our code, and the person reading it wants to know why
 * their pin looks wrong and whether it will happen again.
 */
export function describePinDowngrade(o: PinDesignOutcome, requested: boolean): string | null {
  if (!pinWasDowngraded(o, requested)) return null
  // NO IMAGE AT ALL is its own answer, and it has to come first. A roundup pin
  // came back blank and the modal explained it with the roundup message, which
  // says a simpler collage was used instead. There was no collage and no
  // picture; describing a fallback that did not happen is the reporting bug
  // this whole file exists to stop.
  if (o.design === 'none') {
    return 'No pin image could be produced for this post. Nothing will be pinned until it has a usable image. Check that the post has a featured image and links to a product that still resolves.'
  }
  switch (o.downgrade) {
    case 'brand-leak':
      return 'The designed pin came back with a retailer logo rendered into it, which we never publish, so it was thrown away and the post hero was used instead. Try again; if it keeps happening, tell support which product it is.'
    case 'no-product-reference':
      return 'No real product photo could be resolved for this post, so the pin used the post hero instead of the designed layout. Check that the post links to a product page that still resolves.'
    case 'art-director-returned-null':
      return 'The designed pin failed to render and the pin fell back to the post hero. Usually transient; a regenerate normally fixes it.'
    case 'roundup-needs-two-photos':
      return 'A comparison pin needs at least two real product photos and fewer resolved, so it used the older name-only collage.'
    case 'not-requested':
      return null
    default:
      return 'The pin did not use the designed layout.'
  }
}

/**
 * True when retrying could plausibly produce the designed pin.
 *
 * MATTERS BECAUSE A RETRY COSTS MONEY. The prerender cron releases its claim on
 * a downgrade so a later tick tries again, and that re-runs image generation.
 * Doing that for a deterministic failure is a loop that bills us every minute
 * until the post is due and still ships the same fallback.
 *
 *   art-director-returned-null   transient. A model call failed or a QC retry
 *                                ran out. The next attempt often works.
 *   no-product-reference         deterministic. No product photo resolves from
 *                                this post, and it will not resolve in sixty
 *                                seconds either. Bank the fallback, record it,
 *                                and let somebody fix the post's links.
 *   roundup-needs-two-photos     deterministic, same reasoning.
 */
export function isTransientPinDowngrade(d: PinDowngrade): boolean {
  // brand-leak is transient in the same sense: the model rendered a logo this
  // time and usually does not the next. It has already been retried once
  // inside the build, so a later tick is a genuinely fresh roll.
  return d === 'art-director-returned-null' || d === 'brand-leak'
}

/** Short token stored on the row, so a SQL query can count these. */
export function pinDesignTag(o: PinDesignOutcome): string {
  return o.downgrade ? `${o.design}:${o.downgrade}` : o.design
}
