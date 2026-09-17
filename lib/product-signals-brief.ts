// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE ONE THING ON THE PAGE THAT IS NOT ALSO ON THE AMAZON LISTING.
//
// Google's answer to an affiliate post is usually: I already have the listing,
// and the listing outranks you. On one MVP site 394 posts sat in "Crawled,
// currently not indexed", which is Google reading a page and deciding it adds
// nothing. That judgement was fair. The writer received the video transcript,
// the listing title and the listing's own marketing bullets, and nothing else.
//
// MVP pays Keepa for price history, sales rank history, demand and product age
// on every product it touches, and none of it reached the writer. Grepping
// services/claude and lib/blog-writer for "keepa", "salesRank", "priceAvg" or
// "monthlySold" returned nothing at all.
//
// That data is the information gain. A reader on the Amazon listing cannot see
// whether today's price is normal or a genuine drop, whether the thing is
// climbing or dying, or how much it moves. We can.
//
// ── The rule this module exists to enforce ──────────────────────────────────
//
// Amazon's Operating Agreement governs displaying prices: they must come from
// the Product Advertising API and be refreshed or removed within 24 hours.
// Keepa is third-party. So NOTHING here ever emits a price, a currency amount,
// or a discount percentage. Every price signal is converted into a RELATIVE,
// historical statement:
//
//   "cheaper than it has been for most of the past three months"
//
// not
//
//   "$79, down from $89".
//
// This is enforced in code, by containsPriceClaim(), and asserted over every
// generated sentence. A prompt instruction would not be enough: the writer
// prompt has forbidden prices for months and this module still would not be
// allowed to hand it one.
//
// Rank and demand are different and are stated plainly. A sales rank and a
// "bought in the past month" count are already displayed publicly on the Amazon
// listing, so repeating them is not a price claim and does not go stale the way
// a price does.
//
// ── Staleness ───────────────────────────────────────────────────────────────
//
// The Keepa cache is up to ten days old. Any sentence containing the word "now"
// is a claim about the present, so the present-tense price comparisons expire
// after a week and are dropped rather than softened. What survives is the pure
// history, which was true when observed and stays true: how much the price has
// moved, and how far below its typical level it has been.
//
// Whatever is dropped is reported, not silently omitted, so a creator wondering
// why a post has no price context gets an answer instead of a gap.

export interface KeepaFacts {
  salesRank?: number | null
  salesRankAvg90?: number | null
  salesRankCategory?: string | null
  monthlySold?: number | null
  priceNowCents?: number | null
  priceAvg90Cents?: number | null
  priceLowestCents?: number | null
}

export interface SignalFact {
  key: string
  /** A sentence the writer may use. Already safe to publish. */
  text: string
}

export interface SignalBrief {
  facts: SignalFact[]
  /** Why a signal is missing: no data, or too old to claim in the present. */
  dropped: Array<{ key: string; reason: string }>
  /** The block handed to the writer, or '' when there is nothing to say. */
  prompt: string
}

/** Present-tense price comparisons expire after this many days. */
const PRICE_CLAIM_MAX_AGE_DAYS = 7

/**
 * Does this sentence make a price claim?
 *
 * The guard that lets the rest of this module be trusted. Catches currency
 * symbols, currency codes, bare decimal amounts, and the "N% off" shape. Used as
 * an assertion over everything generated here, so a future edit that reaches for
 * a dollar figure fails a test rather than shipping into a creator's post.
 */
export function containsPriceClaim(text: string): boolean {
  const s = String(text ?? '')
  if (/[$£€¥₹]/.test(s)) return true
  if (/\b(USD|GBP|EUR|CAD|AUD)\b/i.test(s)) return true
  if (/\b\d+[.,]\d{2}\b/.test(s)) return true
  if (/\b\d+(\.\d+)?\s*%\s*(off|discount|cheaper|less|below|lower)\b/i.test(s)) return true
  if (/\b(dollars?|cents?|quid|euros?)\b/i.test(s)) return true
  return false
}

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Whole days between an ISO timestamp and now, or null when unparseable. */
function ageInDays(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, (now.getTime() - t) / 86_400_000)
}

/**
 * Turn Keepa numbers into sentences a writer may state.
 *
 * `fetchedAt` is when the Keepa row was read. Null means unknown, which is
 * treated as too old for a present-tense claim rather than assumed fresh: an
 * unknown age is not a young one.
 */
export function buildSignalBrief(
  f: KeepaFacts,
  opts?: { fetchedAt?: string | null; now?: Date },
): SignalBrief {
  const now = opts?.now ?? new Date()
  const age = ageInDays(opts?.fetchedAt, now)
  const freshEnoughForPrice = age != null && age <= PRICE_CLAIM_MAX_AGE_DAYS

  const facts: SignalFact[] = []
  const dropped: SignalBrief['dropped'] = []

  const priceNow = num(f.priceNowCents)
  const priceAvg = num(f.priceAvg90Cents)
  const priceLow = num(f.priceLowestCents)
  const rank = num(f.salesRank)
  const rankAvg = num(f.salesRankAvg90)
  const sold = num(f.monthlySold)

  // ── Price against its own recent normal. Relative only, never an amount. ──
  if (priceNow && priceAvg) {
    if (!freshEnoughForPrice) {
      dropped.push({
        key: 'price-vs-usual',
        reason: age == null
          ? 'the price data has no recorded age, and an unknown age is not a young one'
          : `the price data is ${Math.round(age)} days old, too old to say anything about today`,
      })
    } else {
      const ratio = priceNow / priceAvg
      const text =
        ratio <= 0.85 ? 'Today it is well below the price it has usually sat at over the past three months.'
        : ratio <= 0.95 ? 'Today it is a little below its usual price for the past three months.'
        : ratio >= 1.15 ? 'Today it is well above the price it has usually sat at over the past three months.'
        : ratio >= 1.05 ? 'Today it is a little above its usual price for the past three months.'
        : 'Today it is sitting at about its usual price for the past three months.'
      facts.push({ key: 'price-vs-usual', text })
    }
  } else {
    dropped.push({ key: 'price-vs-usual', reason: 'no price history for this product' })
  }

  // ── How close today is to the cheapest it has ever been tracked at. ──
  if (priceNow && priceLow && freshEnoughForPrice) {
    if (priceNow <= priceLow * 1.03) {
      facts.push({ key: 'record-low', text: 'It is close to the cheapest it has ever been tracked at.' })
    } else if (priceNow >= priceLow * 1.5) {
      facts.push({ key: 'record-low', text: 'It has been considerably cheaper than this at points in the past.' })
    }
  }

  // ── Pure history. True when observed, still true later, never expires. ──
  if (priceAvg && priceLow && priceLow <= priceAvg * 0.75) {
    facts.push({
      key: 'volatility',
      text: 'The price on this one moves a lot. It has dropped well under its typical level before, so it is worth checking the live price rather than assuming.',
    })
  }

  // ── Rank and demand. Public on the listing, and not price claims. ──
  if (rank) {
    const cat = String(f.salesRankCategory ?? '').trim()
    facts.push({
      key: 'rank',
      text: cat
        ? `Amazon ranks it #${Math.round(rank).toLocaleString()} in ${cat}.`
        : `Amazon ranks it #${Math.round(rank).toLocaleString()} in its category.`,
    })
  }

  // A LOWER Amazon rank number means MORE sales, so now < avg means climbing.
  // Getting this backwards would tell a reader a dying product is a hit, which
  // is the one factual error in this module a reader could act on.
  if (rank && rankAvg) {
    const move = (rankAvg - rank) / rankAvg
    if (move > 0.1) {
      facts.push({
        key: 'rank-trend',
        text: `It is selling better lately than it has been: #${Math.round(rank).toLocaleString()} now against a 90 day average of #${Math.round(rankAvg).toLocaleString()} (a lower number means more sales).`,
      })
    } else if (move < -0.1) {
      facts.push({
        key: 'rank-trend',
        text: `It is selling less than it was: #${Math.round(rank).toLocaleString()} now against a 90 day average of #${Math.round(rankAvg).toLocaleString()} (a higher number means fewer sales).`,
      })
    }
  }

  if (sold && sold >= 50) {
    facts.push({
      key: 'demand',
      text: `Amazon reports more than ${Math.round(sold).toLocaleString()} bought in the past month.`,
    })
  }

  return { facts, dropped, prompt: briefToPrompt(facts) }
}

/** Render the facts as the block the writer receives. */
function briefToPrompt(facts: SignalFact[]): string {
  if (!facts.length) return ''
  return `PRODUCT SIGNALS (MVP's own data, not on the Amazon listing)

These come from price and sales-rank history MVP tracks. A reader looking at the
Amazon page cannot see any of it, which makes it the most valuable thing you can
put in this post: it is the reason the page deserves to exist next to the listing
itself.

${facts.map(f => `  • ${f.text}`).join('\n')}

HOW TO USE THEM
Work the relevant ones into the body where they help a buying decision, in your
own words. Do not list them, do not give them their own section, and do not use
every one if only two matter for this product.

WHAT YOU MAY NOT DO WITH THEM
Never convert these into a price, a currency amount, a "was and now", or a
discount percentage, and never invent one to go alongside them. They are
deliberately phrased as comparisons for that reason. The live price belongs
behind the affiliate link where it is always correct, and a price written into
the page is wrong the moment it changes.`
}
