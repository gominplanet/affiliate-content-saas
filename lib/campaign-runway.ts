// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// How much time is left, and what that time is actually good for.
//
// "Days left" on its own is a number, not advice. The same 20 days is generous
// for one kind of content and useless for another, because the three things a
// creator can make have completely different shapes:
//
//   An Amazon video is FAST TO START and FAST TO BE SEEN. In the US the sample
//   ships through Amazon and lands in a day or three, and the finished video
//   sits on the product page, in front of people already deciding to buy. Both
//   ends are quick, which makes it the only route that works on a short window.
//
//   A blog post is fast to start and SLOW TO BE SEEN. It can be written today,
//   and then search takes weeks to find it. On a young site it takes months.
//   Discovery, not writing, is what a blog post needs a long window for.
//
//   A social post is fast at both ends and short lived. Minutes to publish,
//   minutes to reach people, and mostly finished within a day or two.
//
// So the bottleneck is different for each one, and that is the whole judgement.
// A campaign with 20 days left is a perfectly good video window and a hopeless
// blog window: the sample arrives on day three, the video is up on day five and
// earns for a fortnight, while a post published today would still be waiting on
// Google when the boost expired.
//
// The one thing that scales with a long window is how much that video earns.
// Filming is a fixed cost, the video keeps selling for as long as the campaign
// runs, so 60 days is not twice as viable as 30, it is twice as paid.
//
// This lives in one place because three screens have to agree about it:
// deciding whether to join, deciding what to make for something already joined,
// and deciding what to do with a window that is nearly shut.

/** In the US the brand approves and Amazon ships, so a sample is usually on the
 *  doorstep within a day to three. This is the number that used to be set at a
 *  fortnight, which ruled out the video route on every campaign under a month
 *  and pointed creators at blog posts that could not be found in time. Outside
 *  the US it can be slower, which is why the copy says "usually" and why the
 *  advice never treats a short window as impossible, only as tight. */
export const SAMPLE_ARRIVAL_DAYS = 3
/** Film, edit, upload, and Amazon's own review before it appears. */
export const FILM_DAYS = 2
/** Roughly when a new post on an established site starts appearing in search.
 *  A new site takes months; this is the optimistic end, deliberately, so the
 *  advice errs towards "there is still time" rather than towards discouraging
 *  someone. */
export const SEARCH_DISCOVERY_DAYS = 21
/** The floor of worth starting at all: below this the content goes live just as
 *  the boost expires and the work earns the ordinary rate. */
export const MIN_EARNING_DAYS = 7

/** 12 days. Sample, filming, and a week of the boost still running. */
export const VIDEO_MIN_DAYS = SAMPLE_ARRIVAL_DAYS + FILM_DAYS + MIN_EARNING_DAYS
/** 9 days. Nothing to wait for when the product is already in the room. */
export const OWNED_VIDEO_MIN_DAYS = FILM_DAYS + MIN_EARNING_DAYS
/** 28 days. Written today, found in three weeks, earning for a week after. */
export const BLOG_MIN_DAYS = SEARCH_DISCOVERY_DAYS + MIN_EARNING_DAYS
/** Where a video stops being merely worth filming and starts being worth
 *  filming FIRST, because the same day's work then earns for a month or more. */
export const VIDEO_STRONG_DAYS = 30

export type BestRoute = 'video-long' | 'video' | 'social-now' | 'unknown' | 'closed'

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
 * `ownsProduct` removes the short wait for the sample, which matters most on the
 * windows that are nearly shut: a creator with the thing already on their desk
 * can film a campaign with nine days left that would be tight for anyone waiting
 * on a delivery.
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
      headline: 'No end date from Amazon. A sample usually arrives in a few days, but a new post takes weeks to be found in search, so check the window on Amazon before planning a post around it.',
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
          ? 'You already have the product, so this is filming time and then it earns for the rest of the window.'
          : `A sample usually arrives in a few days, which leaves time to film it and still have most of the window to earn in.`
        : owns
          ? `Under ${plural(OWNED_VIDEO_MIN_DAYS, 'day')} left, so a video would go up just as the boost expires.`
          : `Even with a sample arriving in a few days, filming would finish as the boost expires. Only worth it if you already have the product.`,
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
  if (closed) best = 'closed'
  else if (videoOk && daysLeft >= VIDEO_STRONG_DAYS) best = 'video-long'
  else if (videoOk) best = 'video'
  else best = 'social-now'

  let headline: string
  if (closed) {
    headline = 'The window has closed, so nothing made now earns the boosted rate.'
  } else if (best === 'video-long') {
    headline = blogOk
      ? `${left} left, which is long enough for anything. A video is the strongest use of it: one day's filming that keeps selling for the whole window, and the longer the window the more it makes.`
      : `${left} left. Long enough to get the sample, film it, and have that video earning for weeks. A new blog post would still be waiting on Google.`
  } else if (best === 'video') {
    headline = `${left} left. A sample usually arrives in a few days, so there is still time to film and earn. Search will not find a new post in this window, so the video and the social push are what pay here.`
  } else {
    headline = `${left} left. Not enough to get the product, film it, and still earn from it. A social post is the only thing that reaches a buyer in time.`
  }

  return { daysLeft, best, video, blog, social, headline }
}

/** Why the three routes behave differently. Said once, on the page, rather than
 *  re-explained on every row. */
export const ROUTE_EXPLAINER =
  'An Amazon video is quick at both ends: the sample usually arrives in a few days, and the video then sits on the product page in front of people already deciding to buy. A blog post is quick to write and slow to be found, because search takes weeks, so it needs a long window to be worth it. A social post reaches people the same day and is over almost as fast. That is why the time left decides what is worth making, not just whether the campaign is worth joining.'
