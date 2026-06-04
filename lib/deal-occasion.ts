// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Deal-occasion helpers for the Deals Hub.
//
// Maps a UI selection (or "auto") into:
//   - a stable slug used by prompts + the WP plugin shortcode (badge color, copy)
//   - a human label that appears in the article + thumbnail badge
//   - a hype phrase the Sonnet prompt can lean on without sounding generic
//
// Auto-detect looks at today's date and picks the closest active US retail
// event (US-centric because that's where Amazon traffic concentrates). Returns
// 'none' when no event is within a reasonable window so the article doesn't
// invent fake hype (e.g. "this Prime Day deal" in March).

export type DealOccasionSlug =
  | 'none'
  | 'lightning_deal'
  | 'lowest_price_ytd'
  | 'prime_day'
  | 'prime_big_deal_days'
  | 'black_friday'
  | 'cyber_monday'
  | 'holiday'
  | 'memorial_day'
  | 'mothers_day'
  | 'fathers_day'
  | 'back_to_school'
  | 'spring_sale'
  | 'valentines_day'
  | 'amazon_spring_deal_days'

export interface DealOccasion {
  slug: DealOccasionSlug
  /** Short label for badges, e.g. "PRIME DAY" — UPPERCASE because it lives on
   *  the thumbnail badge. */
  badgeLabel: string
  /** Long label for body copy, e.g. "Prime Day 2026". */
  longLabel: string
  /** Plain-English hype phrase the writer can use without inventing fake
   *  emotion. Stays grounded in WHAT the event is rather than HOW the writer
   *  feels about it. */
  hypePhrase: string
  /** Tailwind-friendly hex pair used for the badge gradient on the thumbnail
   *  and the WP banner. Background, then text. */
  badgeBg: string
  badgeFg: string
}

const OCCASIONS: Record<DealOccasionSlug, DealOccasion> = {
  none: {
    slug: 'none',
    badgeLabel: 'DEAL',
    longLabel: 'limited-time deal',
    hypePhrase: 'a real price drop on a product worth tracking',
    badgeBg: '#7C3AED',
    badgeFg: '#FFFFFF',
  },
  lightning_deal: {
    slug: 'lightning_deal',
    badgeLabel: 'LIGHTNING DEAL',
    longLabel: 'Amazon Lightning Deal',
    // Lightning deals run on a clock + limited inventory — both create
    // honest urgency the writer can lean on without inventing scarcity.
    hypePhrase: 'an Amazon Lightning Deal with a hard clock + limited inventory, so the window is real not invented',
    // Amazon's own Lightning-Deal palette: vivid orange. Reads as time-
    // sensitive on the thumbnail without using red (red is the savings
    // chip colour, kept separate so they don't visually fight).
    badgeBg: '#FF6900',
    badgeFg: '#FFFFFF',
  },
  lowest_price_ytd: {
    slug: 'lowest_price_ytd',
    badgeLabel: "YEAR'S LOWEST",
    longLabel: 'lowest price of the year',
    // Price-history claim. The writer prompt should anchor on the
    // year-to-date framing without inventing specific historical prices.
    hypePhrase: 'the lowest price this product has hit so far this year, based on the price you\'re seeing right now versus its recent history',
    // Green = "savings" cue, distinct from the orange Lightning chip and
    // the violet "regular deal" default.
    badgeBg: '#0E8C4A',
    badgeFg: '#FFFFFF',
  },
  prime_day: {
    slug: 'prime_day',
    badgeLabel: 'PRIME DAY',
    longLabel: 'Prime Day',
    hypePhrase: "Amazon's biggest member-only sale of the year",
    badgeBg: '#00A8E1',
    badgeFg: '#FFFFFF',
  },
  prime_big_deal_days: {
    slug: 'prime_big_deal_days',
    badgeLabel: 'PRIME BIG DEAL DAYS',
    longLabel: 'Prime Big Deal Days',
    hypePhrase: "Amazon's October Prime member sale, the holiday warm-up",
    badgeBg: '#00A8E1',
    badgeFg: '#FFFFFF',
  },
  black_friday: {
    slug: 'black_friday',
    badgeLabel: 'BLACK FRIDAY',
    longLabel: 'Black Friday',
    hypePhrase: 'the biggest single-day discount window of the year',
    badgeBg: '#1d1d1f',
    badgeFg: '#FFD60A',
  },
  cyber_monday: {
    slug: 'cyber_monday',
    badgeLabel: 'CYBER MONDAY',
    longLabel: 'Cyber Monday',
    hypePhrase: "Black Friday's online-first sequel, often deeper on tech",
    badgeBg: '#0A84FF',
    badgeFg: '#FFFFFF',
  },
  holiday: {
    slug: 'holiday',
    badgeLabel: 'HOLIDAY DEAL',
    longLabel: 'holiday sale',
    hypePhrase: 'a December gift-buying window worth catching early',
    badgeBg: '#FF3B30',
    badgeFg: '#FFFFFF',
  },
  memorial_day: {
    slug: 'memorial_day',
    badgeLabel: 'MEMORIAL DAY',
    longLabel: 'Memorial Day sale',
    hypePhrase: 'the late-May sale that kicks off summer discounting',
    badgeBg: '#1976D2',
    badgeFg: '#FFFFFF',
  },
  mothers_day: {
    slug: 'mothers_day',
    badgeLabel: "MOTHER'S DAY",
    longLabel: "Mother's Day sale",
    hypePhrase: 'a focused gift-buying window the second Sunday of May',
    badgeBg: '#FF2D55',
    badgeFg: '#FFFFFF',
  },
  fathers_day: {
    slug: 'fathers_day',
    badgeLabel: "FATHER'S DAY",
    longLabel: "Father's Day sale",
    hypePhrase: 'a focused gift-buying window the third Sunday of June',
    badgeBg: '#34C759',
    badgeFg: '#FFFFFF',
  },
  back_to_school: {
    slug: 'back_to_school',
    badgeLabel: 'BACK TO SCHOOL',
    longLabel: 'Back to School sale',
    hypePhrase: 'the late-summer window for laptops, tablets, and supplies',
    badgeBg: '#FF9500',
    badgeFg: '#FFFFFF',
  },
  spring_sale: {
    slug: 'spring_sale',
    badgeLabel: 'SPRING SALE',
    longLabel: 'Spring Sale',
    hypePhrase: 'a post-winter reset across home, garden, and fitness',
    badgeBg: '#30D158',
    badgeFg: '#FFFFFF',
  },
  valentines_day: {
    slug: 'valentines_day',
    badgeLabel: "VALENTINE'S",
    longLabel: "Valentine's Day sale",
    hypePhrase: 'a tight early-February gift-buying push',
    badgeBg: '#E91E63',
    badgeFg: '#FFFFFF',
  },
  amazon_spring_deal_days: {
    slug: 'amazon_spring_deal_days',
    badgeLabel: 'SPRING DEAL DAYS',
    longLabel: 'Amazon Spring Deal Days',
    hypePhrase: "Amazon's spring sale event, the Prime Day warm-up",
    badgeBg: '#00A8E1',
    badgeFg: '#FFFFFF',
  },
}

export function getOccasion(slug: DealOccasionSlug): DealOccasion {
  return OCCASIONS[slug] ?? OCCASIONS.none
}

export function listOccasions(): DealOccasion[] {
  // Order tuned for the UI dropdown:
  //   1. Regular (no occasion)
  //   2. Year-round qualifiers (Lightning Deal, Lowest Price YTD) —
  //      not season-bound, so they sit right after Regular instead of
  //      mixed into the chronological seasonal group below.
  //   3. Major Amazon events (Prime Day variants, Black Friday, Cyber
  //      Monday, Holiday)
  //   4. Spring + secondary seasonal events
  return [
    OCCASIONS.none,
    OCCASIONS.lightning_deal,
    OCCASIONS.lowest_price_ytd,
    OCCASIONS.prime_day,
    OCCASIONS.prime_big_deal_days,
    OCCASIONS.black_friday,
    OCCASIONS.cyber_monday,
    OCCASIONS.holiday,
    OCCASIONS.amazon_spring_deal_days,
    OCCASIONS.spring_sale,
    OCCASIONS.memorial_day,
    OCCASIONS.mothers_day,
    OCCASIONS.fathers_day,
    OCCASIONS.back_to_school,
    OCCASIONS.valentines_day,
  ]
}

/**
 * Auto-detect the closest active US retail event for a given date.
 * Returns 'none' when no event is within its window so the article doesn't
 * invent fake "Prime Day" hype in March.
 *
 * Window logic: each event gets a ± window (~5-10 days for major events,
 * ± 2 days for one-day events). If today falls inside ANY window, that
 * event wins. When two windows overlap (rare; e.g. late Nov-early Dec), the
 * one whose center is closer to today wins.
 *
 * Dates are approximate because Amazon doesn't publish exact dates a year
 * out — we use the typical week. Users can always override by picking
 * manually in the dropdown.
 */
export function detectOccasion(now: Date = new Date()): DealOccasionSlug {
  const year = now.getUTCFullYear()
  type Window = { slug: DealOccasionSlug; from: Date; to: Date; centre: Date }

  const mk = (slug: DealOccasionSlug, fromIso: string, toIso: string): Window => {
    const from = new Date(`${fromIso}T00:00:00Z`)
    const to = new Date(`${toIso}T23:59:59Z`)
    return { slug, from, to, centre: new Date((from.getTime() + to.getTime()) / 2) }
  }

  // Approximate windows for each year. We bias generous (a deal post written
  // 5 days before Prime Day should still get the badge).
  const wins: Window[] = [
    mk('valentines_day', `${year}-02-08`, `${year}-02-14`),
    mk('amazon_spring_deal_days', `${year}-03-15`, `${year}-03-30`),
    mk('spring_sale', `${year}-04-01`, `${year}-04-30`),
    mk('mothers_day', `${year}-05-01`, `${year}-05-15`),
    mk('memorial_day', `${year}-05-20`, `${year}-05-31`),
    mk('fathers_day', `${year}-06-08`, `${year}-06-21`),
    mk('prime_day', `${year}-07-08`, `${year}-07-20`),
    mk('back_to_school', `${year}-08-01`, `${year}-09-05`),
    mk('prime_big_deal_days', `${year}-10-05`, `${year}-10-15`),
    mk('black_friday', `${year}-11-20`, `${year}-11-30`),
    mk('cyber_monday', `${year}-12-01`, `${year}-12-04`),
    mk('holiday', `${year}-12-05`, `${year}-12-26`),
  ]

  let best: Window | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const w of wins) {
    if (now >= w.from && now <= w.to) {
      const delta = Math.abs(now.getTime() - w.centre.getTime())
      if (delta < bestDelta) {
        best = w
        bestDelta = delta
      }
    }
  }
  return best?.slug ?? 'none'
}
