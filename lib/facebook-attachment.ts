// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What Facebook shows under the words: the thumbnail, or the video.
//
// A Page post can carry exactly ONE attachment. Either it is a photo (the
// /photos endpoint, which is what MVP has always sent: the YouTube thumbnail as
// a still hero image), or it is a link (the /feed endpoint, where Facebook
// scrapes whatever URL you give it and builds the card itself). There is no
// third option that gives you both, and no way to attach a playable video while
// the card points somewhere else.
//
// That constraint is the whole decision. Handing Facebook the YouTube watch URL
// makes the card a video card: a large still with a play control, which plays in
// place on desktop and opens YouTube on mobile. The trade is where a tap on the
// card goes — YouTube, not the blog. The blog URL is still in the caption text,
// which Facebook makes clickable, so the post keeps both destinations; only the
// big one changes.
//
// Native upload (posting the video file to Facebook itself) is the only way to
// get true in-feed playback everywhere, and it needs the video FILE. Pulling
// that out of YouTube is against YouTube's terms, so it is not an option here
// and this module does not pretend otherwise.

/** What the creator asked for in the preview modal. */
export type FacebookMediaChoice = 'thumbnail' | 'video'

export interface FacebookAttachment {
  /** Which Graph endpoint to use: /photos or /feed. */
  kind: 'photo' | 'link'
  /** Set when kind === 'photo'. */
  imageUrl?: string
  /** Set when kind === 'link' — the URL Facebook builds the card from. */
  link?: string
  /** What the creator asked for. */
  requested: FacebookMediaChoice
  /** What is actually going out. Differs from `requested` only when the post
   *  cannot supply it. */
  used: FacebookMediaChoice | 'link-only'
  /** Null when the creator got what they asked for. Otherwise a sentence
   *  explaining the substitution, to be SHOWN, not logged.
   *
   *  A post whose video option silently fell back to the thumbnail looks
   *  identical to one that never offered the choice, which is how a creator
   *  spends a month believing their videos are on Facebook. */
  note: string | null
}

export function chooseFacebookAttachment(input: {
  requested: FacebookMediaChoice
  /** The YouTube watch URL for this post's source video, when it has one. */
  videoUrl?: string | null
  /** The thumbnail MVP would post as a photo. */
  imageUrl?: string | null
  /** Where the card should point when there is neither a video nor a usable
   *  image — normally the blog post. */
  fallbackLink?: string | null
}): FacebookAttachment {
  const requested: FacebookMediaChoice = input.requested === 'video' ? 'video' : 'thumbnail'
  const video = (input.videoUrl || '').trim()
  const image = (input.imageUrl || '').trim()
  const fallback = (input.fallbackLink || '').trim()

  if (requested === 'video') {
    if (video) return { kind: 'link', link: video, requested, used: 'video', note: null }
    if (image) {
      return {
        kind: 'photo', imageUrl: image, requested, used: 'thumbnail',
        note: 'This post has no YouTube video behind it, so Facebook got the thumbnail image instead of a playable video.',
      }
    }
    return {
      kind: 'link', link: fallback, requested, used: 'link-only',
      note: 'This post has no YouTube video and no thumbnail, so Facebook built the card from the blog post itself.',
    }
  }

  if (image) return { kind: 'photo', imageUrl: image, requested, used: 'thumbnail', note: null }
  return {
    kind: 'link', link: fallback, requested, used: 'link-only',
    note: 'This post has no thumbnail image, so Facebook built the card from the blog post itself.',
  }
}

/** Normalize whatever arrived on the request body or the scheduled row's
 *  options. Anything unrecognised means the long-standing behaviour. */
export function parseFacebookMediaChoice(v: unknown): FacebookMediaChoice {
  return v === 'video' ? 'video' : 'thumbnail'
}
