// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A PICTURE ON OUR SERVER IS NOT A PICTURE ON THE CREATOR'S SITE.
//
// When WordPress refuses a media upload the generator embeds the URL it
// generated the picture from, so the article still reads properly. That is the
// right fallback. What was wrong is that nothing anywhere could tell the two
// apart, and so:
//
//   186 posts across 6 creators are published with their pictures living on
//   fal.media. The oldest is from May. The newest was published YESTERDAY.
//
// Four months, and nobody noticed, because on screen a hot-linked post is
// indistinguishable from a good one: the same green image count, the same
// silence. fal's documentation says expired files are deleted and cannot be
// recovered, so the day one of those is collected the picture is gone from a
// published article and there is no copy to put back.
//
// WHY THIS IS A MODULE AND NOT TWO IF STATEMENTS.
//
// The count-versus-hosted rule was fixed once already, in /api/blog/generate.
// It was not fixed in /api/blog/refresh-images, which writes images_status
// 'ready' unconditionally in both of its paths. So every press of "Retry
// images" or "Re-roll images" overwrote the truth with a lie, including on the
// posts the first fix had correctly marked. One route was honest, the other
// undid it, and the database agreed with whichever ran last.
//
// Two routes cannot hold the same rule in their heads. It lives here, and the
// guard requires both to call it.
export type ImagesStatus = 'ready' | 'hotlinked' | 'failed' | 'pending' | 'skipped'

/**
 * The status a finished image pass earns, from what actually landed.
 *
 * `hosted` is how many of `total` reached the creator's own site. Anything
 * short of all of them is `hotlinked`, not a partial success: one picture
 * pointing at a URL that can be collected is enough to leave a gap in a
 * published article.
 */
export function imagesStatusOf(total: number, hosted: number): ImagesStatus {
  const t = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0
  const h = Number.isFinite(hosted) ? Math.max(0, Math.trunc(hosted)) : 0
  if (t === 0) return 'failed'
  return h >= t ? 'ready' : 'hotlinked'
}

export interface ImagesVerdict {
  status: ImagesStatus
  /** Short enough for a badge beside a post row. */
  label: string
  /** What happened, what it costs, and what to do. Never a bare state name. */
  detail: string
  /** Whether this should read as a problem. Drives colour, never the count. */
  needsAttention: boolean
}

/**
 * What the creator reads.
 *
 * `hosted` may be null for rows written before the count existed. Unknown is
 * its own answer: the row is not claimed as hot-linked, and not claimed as
 * clean either.
 */
export function describeImages(
  status: ImagesStatus | null | undefined,
  total: number,
  hosted: number | null | undefined,
  siteHost?: string | null,
): ImagesVerdict {
  const t = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0
  const where = siteHost ? `on ${siteHost}` : 'on your own site'

  if (status === 'pending') {
    return {
      status: 'pending',
      label: 'Images…',
      detail: 'The in-article pictures are still being made. This usually takes one to three minutes.',
      needsAttention: false,
    }
  }

  if (status === 'skipped') {
    return {
      status: 'skipped',
      label: 'No images',
      detail: 'This post was written without in-article pictures, which is what was asked for.',
      needsAttention: false,
    }
  }

  if (status === 'failed' || t === 0) {
    return {
      status: 'failed',
      label: 'Images failed',
      detail: 'You asked for in-article pictures and none made it in. Press Retry images. If it keeps failing, your site is refusing media uploads, and Test pictures in Setup, WordPress Doctor will say which way it is refusing them.',
      needsAttention: true,
    }
  }

  if (status === 'hotlinked') {
    const h = typeof hosted === 'number' && Number.isFinite(hosted) ? Math.max(0, Math.trunc(hosted)) : null
    // Say the number when we have it. "Some of your pictures" is the kind of
    // sentence somebody reads twice and still cannot act on.
    const which = h === null
      ? `The pictures in this post are not ${where}.`
      : h === 0
        ? `None of the ${t} picture${t === 1 ? '' : 's'} in this post ${t === 1 ? 'is' : 'are'} ${where}.`
        : `${t - h} of the ${t} pictures in this post ${t - h === 1 ? 'is' : 'are'} not ${where}.`
    return {
      status: 'hotlinked',
      label: 'Pictures not on your site',
      detail: `${which} Your site refused the upload, so they are being served from MVP's image server instead. They look right today and they are not yours: if that file is ever cleared, the article is left with a gap and there is no copy to put back. Run Test pictures in Setup, WordPress Doctor to find out why the upload is being refused, then use Move pictures to my site.`,
      needsAttention: true,
    }
  }

  return {
    status: 'ready',
    label: `${t} image${t === 1 ? '' : 's'}`,
    detail: `${t} picture${t === 1 ? '' : 's'} added to this post and stored ${where}.`,
    needsAttention: false,
  }
}
