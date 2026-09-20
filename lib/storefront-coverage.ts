// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Storefront coverage: the rules, in one place.
//
// The model is a standing GRID, not a run. One row per (video, marketplace),
// created once and advanced forever. A run is not a thing in a creator's world;
// "is this video earning in Germany, and if not why" is, and it has an answer
// on every day of the year.
//
// This file holds the two decisions that would otherwise get copied: what order
// to work in, and what each state means. Everything else is I/O.

/** Every state a (video, market) cell can be in.
 *
 *  UPLOADED IS NOT LIVE, and they are deliberately separate. `uploaded` means
 *  SCOUT finished the upload; `live` means the video was afterwards found on
 *  the storefront. Collapsing them turned the whole map into a claim about what
 *  was attempted rather than a record of what is earning. */
export type CoverageState =
  | 'unknown'    // nothing checked yet
  | 'preparing'  // the drain is working on it
  | 'ready'      // prepared, waiting for SCOUT
  | 'uploading'  // handed to SCOUT in this session
  | 'uploaded'   // SCOUT finished
  | 'live'       // found on the storefront afterwards
  | 'blocked'    // cannot go, and `reason` says why

/** The states the drain still has work to do on. */
export const OPEN_STATES: CoverageState[] = ['unknown', 'preparing']

/**
 * Whether the product is actually on sale in that country.
 *
 * THIS IS THE FIRST PASS, before anything is translated or dubbed. Dubbing a
 * video into Japanese for a product Amazon Japan has never sold spends minutes
 * of render on a listing that cannot exist, and the creator finds out at the
 * upload, which is the most expensive possible moment.
 *
 * FOUR ANSWERS, not a boolean, because the two failure shapes are opposites and
 * a boolean forces them into the same bucket:
 *
 *   in_stock      listed there and something is buyable right now.
 *   out_of_stock  listed there, nothing buyable at this moment. NOT blocked:
 *                 stock comes back, and a video prepared today is ready when it
 *                 does.
 *   not_listed    Keepa answered, and the ASIN is not sold in that country.
 *                 This one blocks, and it is the whole saving.
 *   no_answer     nobody could look from a server. Australia has no Keepa
 *                 domain at all, and a request can also simply fail. The cell
 *                 goes on: refusing to ever process Australia would be a worse
 *                 lie than proceeding without the answer.
 *
 * A column left NULL means it has not been checked yet, which is different
 * again from `no_answer`, and is why this is text and not two booleans.
 */
export type StockAnswer = 'in_stock' | 'out_of_stock' | 'not_listed' | 'no_answer'

/** The one answer that stops a cell. Everything else keeps moving. */
export function stockBlocks(answer: StockAnswer): boolean {
  return answer === 'not_listed'
}

/** Plain words for a stock answer, so no screen invents its own. */
export function stockLabel(answer: StockAnswer | null | undefined, country: string): string {
  switch (answer) {
    case 'in_stock':     return `On sale in ${country}`
    case 'out_of_stock': return `Listed in ${country}, out of stock today`
    case 'not_listed':   return `Not sold on ${country}’s Amazon store`
    case 'no_answer':    return `Could not check ${country} from here, going ahead anyway`
    default:             return 'Not checked yet'
  }
}

/** The states that count as "this video is earning here, or about to be". */
export const DELIVERED_STATES: CoverageState[] = ['uploaded', 'live']

/**
 * Drain order, highest first.
 *
 * RECENCY AND STOCK, which is what the creator asked for and also the only
 * pair that is cheap to know. Neither needs the Amazon reports, and both change
 * on their own, so the queue re-sorts itself without anyone maintaining a list.
 *
 * A recent video is worth more because the product is more likely still sold,
 * the thumbnail still matches the listing, and the creator still remembers it.
 * A product confirmed in stock in THAT market is worth more than one that is
 * merely listed somewhere, because a listing pointing at something nobody can
 * buy earns nothing.
 *
 * The recency term decays to zero over roughly three years and the stock bonus
 * is half of a brand new video, so a two year old video that is definitely
 * buyable outranks a fresh one that might not be. That ordering is the point:
 * this should always be working on the most valuable thing not yet done.
 *
 * There was a third term, `alreadyDubbed`, worth less than stock, for a video
 * YouTube had already dubbed and which therefore cost nothing to deliver. That
 * shortcut is gone: pulling YouTube's track meant a full video download per
 * market, so every market is dubbed the same way now and there is no cheap
 * case left to reward. It was also the term that had been standing in for
 * stock, which is the mistake this comment originally existed to record.
 */
export function coveragePriority(opts: {
  publishedAt?: string | Date | null
  inStock?: boolean | null
}): number {
  const { publishedAt, inStock } = opts
  let score = 0

  if (publishedAt) {
    const t = publishedAt instanceof Date ? publishedAt.getTime() : Date.parse(String(publishedAt))
    if (Number.isFinite(t)) {
      const days = Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
      // 1000 today, nothing left after about three years.
      score += Math.max(0, 1000 - days)
    }
  }
  // Confirmed buyable in this marketplace. Worth half a brand new video, so it
  // lifts an older but sellable product above a newer unverified one.
  if (inStock) score += 500
  return score
}

/** True when this cell needs the creator's browser rather than the server. */
export function needsScout(state: CoverageState): boolean {
  return state === 'ready' || state === 'uploading'
}

/**
 * What a market's sign-in state means for delivery.
 *
 * SEPARATE FROM WHETHER IT IS TICKED. Ticking a market is a decision the
 * creator makes; being signed in to it is a fact SCOUT reports from their own
 * browser. A screen that conflates them promises listings in a country the
 * creator cannot reach, and the promise only fails at the last step, after
 * everything has been translated and dubbed for it.
 */
export function canDeliver(signinState: string | null | undefined): boolean {
  return signinState === 'ready'
}

/** Plain words for a sign-in state, so no screen invents its own. */
export function signinLabel(state: string | null | undefined): string {
  switch (state) {
    case 'ready':          return 'Signed in'
    case 'not_signed_in':  return 'Not signed in'
    case 'not_enrolled':   return 'No Creator account in this country'
    default:               return 'Not checked yet'
  }
}
