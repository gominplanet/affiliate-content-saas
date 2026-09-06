// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// How much time is left, and what that time is actually good for.
//
// "Days left" on its own is a number, not advice. The same 20 days is generous
// for one kind of content and useless for another, because the three things a
// creator can make have completely different shapes:
//
//   An Amazon video is SLOW TO START and FAST TO BE SEEN. The sample has to be
//   agreed and shipped before anything can be filmed, which is a fortnight gone
//   before day one. Once it is up it sits on the product page, in front of
//   people already deciding to buy, so it works immediately.
//
//   A blog post is the exact reverse. It can be written today, and then search
//   takes weeks to find it. On a young site it takes months.
//
//   A social post is fast at both ends and short lived. Minutes to publish,
//   minutes to reach people, and mostly finished within a day or two.
//
// So a campaign with 40 days left is a video opportunity, and the same campaign
// with 12 days left is not, because the sample would arrive with a week to
// spare and nothing filmed. That same 12 days is also no good for a blog post,
// not because the post is bad but because Google will not have found it before
// the boost ends. What is left is social, which is the one thing that can still
// reach a buyer inside the window.
//
// That is the whole judgement, and it belongs in one place because three
// different screens need to agree about it: deciding whether to join, deciding
// what to make for something already joined, and deciding what to do with a
// window that is nearly shut.

/** A brand has to agree to the sample and then ship it. Two weeks is the fair
 *  case, not the fast one, and it is not guaranteed to happen at all. */
export const SAMPLE_ARRIVAL_DAYS = 14
/** Film, edit, upload, and Amazon's own review before it appears. */
export const FILM_DAYS = 2
/** Roughly when a new post on an established site starts appearing in search.
 *  A new site takes months; this is the optimistic end, deliberately, so the
 *  advice errs towards "there is still time" rather than towards discouraging
 *  someone. */
export const SEARCH_DISCOVERY_DAYS = 21
/** Below this there is no point starting: the content would go live just as the
 *  boost expires, and the work would earn at the ordinary rate. */
export const MIN_EARNING_DAYS = 14

/** 30 days. Long enough to ask, receive, film, and still be earning. */
export const VIDEO_MIN_DAYS = SAMPLE_ARRIVAL_DAYS + FILM_DAYS + MIN_EARNING_DAYS
/** 16 days. No waiting on the post when the product is already in the room. */
export const OWNED_VIDEO_MIN_DAYS = FILM_DAYS + MIN_EARNING_DAYS
/** 35 days. Written today, found in three weeks, earning for a fortnight. */
export const BLOG_MIN_DAYS = SEARCH_DISCOVERY_DAYS + MIN_EARNING_DAYS
/** Under a week, nothing that has to be discovered can be discovered in time. */
export const SOCIAL_ONLY_DAYS = 7

export type BestRoute = 'video' | 'social-first' | 'social-now' | 'unknown'

/** Viability is three-valued on purpose. False means the window rules it out.
 *  Null means Amazon gave no end date, and guessing at that is how a live
 *  campaign gets written off or a dead one gets recommended. */
export interface RouteView {
  viable: boolean | null
  note: string
}

export interface Runway {
  daysLeft: number | null
  best: BestRoute
  video: RouteView
  blog: RouteView
  social: RouteView
  headline: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * What the time left on a campaign is good for.
 *
 * `ownsProduct` collapses the sample wait, which is most of what rules a video
 * out. A creator who already has the thing on their desk can film a campaign
 * that would be hopeless for anyone waiting on the post.
 */
export function campaignRunway(daysLeft: number | null, opts: { ownsProduct?: boolean } = {}): Runway {
  const owns = !!opts.ownsProduct

  if (daysLeft == null) {
    const unknown = 'Amazon gave no end date for this one, so there is no way to work out what it has time for.'
    return {
      daysLeft: null, best: 'unknown',
      video: { viable: null, note: unknown },
      blog: { viable: null, note: unknown },
      social: { viable: null, note: unknown },
      headline: 'No end date from Amazon. A sample takes about two weeks to arrive and a new post takes weeks to be found in search, so check the window on Amazon before planning around it.',
    }
  }

  const closed = daysLeft < 0
  const left = plural(Math.max(0, daysLeft), 'day')
  const videoMin = owns ? OWNED_VIDEO_MIN_DAYS : VIDEO_MIN_DAYS
  const videoOk = !closed && daysLeft >= videoMin
  const blogOk = !closed && daysLeft >= BLOG_MIN_DAYS
  const socialOk = !closed

  const video: RouteView = {
    viable: videoOk,
    note: closed
      ? 'The window has closed.'
      : videoOk
        ? owns
          ? `You already have the product, so this is filming time plus ${plural(MIN_EARNING_DAYS, 'day')} of earning.`
          : `Room for a sample to arrive (about ${plural(SAMPLE_ARRIVAL_DAYS, 'day')}), be filmed, and still earn for a fortnight.`
        : owns
          ? `Under ${plural(OWNED_VIDEO_MIN_DAYS, 'day')} left, so a video would go up just as the boost expires.`
          : `A sample takes about ${plural(SAMPLE_ARRIVAL_DAYS, 'day')} to arrive. With ${left} left it would land with nothing worth filming for.`,
  }
  const blog: RouteView = {
    viable: blogOk,
    note: closed
      ? 'The window has closed.'
      : blogOk
        ? `Written now, found by search in about ${plural(SEARCH_DISCOVERY_DAYS, 'day')}, still earning after that.`
        : `Search takes about ${plural(SEARCH_DISCOVERY_DAYS, 'day')} to find a new post. With ${left} left this campaign ends before anyone arrives from Google.`,
  }
  const social: RouteView = {
    viable: socialOk,
    note: closed ? 'The window has closed.' : 'A social post reaches people the same day, which is the only thing that still does inside a short window.',
  }

  let best: BestRoute
  if (closed) best = 'unknown'
  else if (videoOk) best = 'video'
  else if (daysLeft >= SOCIAL_ONLY_DAYS) best = 'social-first'
  else best = 'social-now'

  let headline: string
  if (closed) {
    headline = 'The window has closed, so nothing made now earns the boosted rate.'
  } else if (best === 'video') {
    headline = `${left} left. Long enough to ask for a sample, film it, and still have the boost running when the video goes up. The longer the window, the more that video earns.`
  } else if (best === 'social-first') {
    headline = blogOk
      ? `${left} left. Enough for a post to be found in search, not enough for a sample to arrive and be filmed.`
      : `${left} left. Too short for a sample to arrive and be filmed, and too short for search to find a new post. Write the post if you want it long term, but the money inside this window comes from the social push.`
  } else {
    headline = `${left} left. Nothing that has to be discovered will be discovered in time. Worth it only if you can post to social today.`
  }

  return { daysLeft, best, video, blog, social, headline }
}

/** Why the three routes behave differently. Said once, on the page, rather than
 *  re-explained on every row. */
export const ROUTE_EXPLAINER =
  'An Amazon video is slow to start and fast to be seen: the sample has to arrive, and then it sits on the product page in front of people already deciding to buy. A blog post is the reverse, written today and found by search weeks later. A social post is fast at both ends and short lived. That is why the time left on a campaign decides what is worth making, not just whether it is worth joining.'
