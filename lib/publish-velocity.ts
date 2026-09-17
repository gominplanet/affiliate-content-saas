// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ARE YOU PUBLISHING FASTER THAN GOOGLE IS ACCEPTING?
//
// There is no daily publishing cap anywhere in MVP and this file does not add
// one. A creator who wants to publish twice a day is allowed to, and telling
// people what they may do with their own site is not MVP's job.
//
// What IS MVP's job is saying the thing they cannot see. One creator was running
// two posts a day. On a different site, 394 posts sat in Google's "Crawled,
// currently not indexed", meaning Google had read them and declined to spend
// index space. Publishing into that is not a strategy, it is adding to a pile
// nobody is reading, and the person doing it has no way to know.
//
// So this refuses to moralise about a rate on its own. Two a day onto a site
// whose posts ARE being indexed is a creator working hard and it gets left
// alone. Two a day onto a site where the last forty posts went nowhere is the
// only case worth raising, because there the rate is the thing making it worse.
//
// The rule: rate is never a problem by itself. Rate plus an index that is not
// keeping up is.

export interface VelocityInput {
  /** ISO dates of published posts, any order. */
  publishedAt: string[]
  /** Distinct pages Google showed at all in the recent window, from
   *  lib/blog-health.ts reach. Null when it could not be measured, which must
   *  stay distinguishable from a measured zero. */
  postsShown?: number | null
  /** How many posts exist. */
  totalPosts: number
  /** Whole months since the first post. Null when nothing is published. */
  ageMonths?: number | null
  now?: Date
}

export type VelocityVerdict = 'quiet' | 'steady' | 'fast-and-landing' | 'fast-and-not-landing' | 'unknown'

export interface VelocityRead {
  /** Posts per week over the last 28 days. */
  perWeek: number
  /** Posts in the last 28 days. */
  recent: number
  verdict: VelocityVerdict
  /** What to say, or null when there is nothing worth saying. Advice only. */
  note: string | null
}

/** Above this, a new site looks like a content farm to a system that has not
 *  yet decided whether to trust it. Below it, nobody would blink. */
const FAST_PER_WEEK = 7

/** Under this share of posts getting shown at all, the index is not keeping up
 *  with what is being published. */
const LANDING_RATIO = 0.35

/** Below this a site has not published enough for a rate to mean anything. */
const MIN_POSTS_FOR_A_RATE = 6

export function readVelocity(input: VelocityInput): VelocityRead {
  const now = input.now ?? new Date()
  const cutoff = now.getTime() - 28 * 86_400_000

  const recent = (input.publishedAt ?? []).filter(d => {
    const t = new Date(d).getTime()
    return Number.isFinite(t) && t >= cutoff && t <= now.getTime()
  }).length

  const perWeek = Math.round((recent / 4) * 10) / 10

  if (input.totalPosts < MIN_POSTS_FOR_A_RATE) {
    return { perWeek, recent, verdict: 'unknown', note: null }
  }

  const fast = perWeek >= FAST_PER_WEEK
  if (!fast) {
    return { perWeek, recent, verdict: recent === 0 ? 'quiet' : 'steady', note: null }
  }

  // Fast. Now the only question that matters: is any of it landing?
  //
  // Unmeasured reach is not a licence to warn. Telling a creator their work is
  // going nowhere on the strength of a failed API call would be the worst thing
  // this function could do.
  if (input.postsShown == null) {
    return { perWeek, recent, verdict: 'unknown', note: null }
  }

  const landing = input.totalPosts > 0 ? input.postsShown / input.totalPosts : 0
  if (landing >= LANDING_RATIO) {
    return {
      perWeek,
      recent,
      verdict: 'fast-and-landing',
      note: null,
    }
  }

  const shown = Math.round(input.postsShown)
  const young = input.ageMonths != null && input.ageMonths < 3
  return {
    perWeek,
    recent,
    verdict: 'fast-and-not-landing',
    note: young
      ? `You published ${recent} posts in the last 28 days, and Google is currently showing ${shown} of your ${input.totalPosts.toLocaleString()} in search. At under three months old that is normal and nothing is wrong, so this is not a warning. It is worth knowing that a new site is usually limited by how much Google trusts it rather than by how much is on it, and that trust builds from posts people link to and stay on. Publishing faster does not speed it up.`
      : `You published ${recent} posts in the last 28 days, which is about ${perWeek} a week, and Google is showing ${shown} of your ${input.totalPosts.toLocaleString()} posts in search. Most of what you publish is not being indexed, so the new ones are going onto a pile rather than into the results. Nothing here is broken and nobody is going to penalise you for it. It does mean more posts is the one lever that will not help: the constraint is what Google thinks of the site, and that moves on depth and links rather than volume. Slowing down and making the next few genuinely better is worth more than twenty more of the same.`,
  }
}
