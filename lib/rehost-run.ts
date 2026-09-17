// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE REPAIR LOOP, USED BY THE BUTTON AND BY THE SWEEP.
//
// 186 published posts across 6 creators point at pictures living on fal.media
// rather than on the sites that publish them. They render today. fal's
// documentation says expired files are deleted and cannot be recovered, so the
// day one is collected the article has a gap and there is no copy to put back.
//
// The repair already existed behind a button, which meant it only ran for a
// creator who opened MVP and pressed it. It now also runs as a cron.
//
// This module exists because of what happened earlier the same day: the
// images_status rule was fixed in /api/blog/generate and not in
// /api/blog/refresh-images, so one route was honest and the other overwrote it
// on every re-roll. Two callers doing the same job from two copies of the
// logic is how that happens. So the loop lives here once and both call it.
//
// ALL IO IS INJECTED. Not for purity's sake: it is so the test can drive the
// branches that matter without a WordPress site, and those branches are the
// whole point. A repair that quietly does nothing looks exactly like a repair
// that worked, and this runs unattended across other people's published posts.
//
// THE THREE OUTCOMES THAT MUST STAY APART:
//
//   moved      the picture is now on the creator's own site. Done, permanently.
//   refused    the site would not take it. Their WordPress is the problem and
//              the pictures are still ours to lose. Retrying later may work.
//   gone       the source no longer exists. No upload can fix this and no
//              retry will. The only remedy is regenerating the picture, which
//              costs money and gives them one they never chose, so it is the
//              creator's decision and not something a cron should do.
//
// Collapsing `gone` into `refused` would send somebody to their host to fix an
// upload path that is working fine, for a file that is not coming back.
import { findRehostable, replaceImageUrl, type RehostCandidate } from '@/lib/rehost-images'
import { imagesStatusOf } from '@/lib/images-status'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

/**
 * Is the original still there?
 *
 * A one-byte range request, so confirming a live file costs almost nothing.
 * Only an explicit refusal counts as gone. The point of this probe is to
 * recognise a DELETED file, and a timeout or a proxy hiccup is not evidence
 * that a creator's picture has been collected. Guessing wrong in that
 * direction tells somebody their picture is unrecoverable when it is fine.
 */
export async function defaultSourceAlive(url: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, { headers: { Range: 'bytes=0-0' }, timeoutMs: 15_000 })
    if (res.status === 404 || res.status === 410 || res.status === 403) return false
    return true
  } catch {
    return true
  }
}

export interface RehostTarget {
  id: string
  title: string | null
  content: string | null
  wordpress_post_id: number | null
  wordpress_url: string | null
}

export interface PostOutcome {
  id: string
  title: string
  /** Pictures now on the creator's own site. */
  moved: number
  /** Pictures the site would not take. Worth retrying once WordPress is fixed. */
  refused: number
  /** Sources that no longer exist. Only regeneration can fix these. */
  gone: number
  /** Set when the post was not attempted at all, saying why in plain words. */
  skipped?: string
}

export interface RehostRunResult {
  moved: number
  refused: number
  gone: number
  attempted: number
  failures: { url: string; reason: string }[]
  posts: PostOutcome[]
  /** True when every picture we tried to move was refused by the site. */
  siteRefusedEverything: boolean
}

export interface RehostIO {
  /** Upload a picture from its current URL, returning where it now lives. */
  uploadFromUrl(url: string, filename: string): Promise<string | null>
  /** Write the repaired body back to the live post. */
  updatePost(wordpressPostId: number, content: string): Promise<void>
  /** Persist our copy. Never allowed to fail the repair. */
  saveContent(postId: string, content: string, hostedCount: number, status: string): Promise<void>
  /**
   * Is the source picture still there? Optional: when absent every candidate is
   * attempted, and a dead source simply shows up as a refusal. Supplying it is
   * what lets "your site said no" and "the picture is gone" be told apart.
   */
  sourceAlive?(url: string): Promise<boolean>

  /**
   * Called after a post's body has been repaired, with every picture that
   * moved. Optional.
   *
   * It exists for `mvp_og_image`: the URL the plugin renders as og:image and
   * twitter:image lives in post meta, written separately from the body. Repair
   * the body alone and the article is safe while its social card still points
   * at a file that is going to be deleted. Failing here must never undo the
   * repair, so implementations swallow their own errors.
   */
  afterMoved?(wordpressPostId: number, moves: Array<{ from: string; to: string }>): Promise<void>
}

function outcomeFor(post: RehostTarget, skipped: string): PostOutcome {
  return { id: post.id, title: post.title ?? '', moved: 0, refused: 0, gone: 0, skipped }
}

/** Same blog, ignoring a leading www and the scheme. */
export function sameSiteHost(a: string | null | undefined, b: string | null | undefined): boolean {
  const host = (u: string | null | undefined): string | null => {
    try { return new URL(String(u)).hostname.replace(/^www\./i, '').toLowerCase() } catch { return null }
  }
  const x = host(a)
  const y = host(b)
  return !!x && !!y && x === y
}

/**
 * Repair a batch of posts against one site.
 *
 * Order matters and is deliberate: the LIVE post is updated before our own
 * copy. If the site update fails, our row keeps describing what is actually
 * published. The other order would record a repair the creator's readers never
 * see, which is the same class of lie that made this repair necessary.
 */
export async function rehostPosts(
  posts: RehostTarget[],
  siteUrl: string,
  io: RehostIO,
): Promise<RehostRunResult> {
  let moved = 0
  let refused = 0
  let gone = 0
  let attempted = 0
  const failures: { url: string; reason: string }[] = []
  const outcomes: PostOutcome[] = []

  for (const post of posts) {
    const html = post.content ?? ''
    const candidates: RehostCandidate[] = findRehostable(html, siteUrl)

    if (candidates.length === 0) {
      outcomes.push(outcomeFor(post, 'nothing to move'))
      continue
    }
    if (!post.wordpress_post_id) {
      // Without the WordPress id there is nothing to update, and rewriting only
      // our copy would leave the live post pointing at the old URL while our
      // records claimed it was repaired.
      outcomes.push(outcomeFor(post, 'no WordPress post id on record, so the live post cannot be updated'))
      continue
    }

    // NEVER write to a site the post does not live on.
    //
    // A creator can have up to ten blogs, and a WordPress post id is only
    // meaningful within one of them. Post 42 on the wrong site is a completely
    // different article, so running this with the wrong credentials would
    // overwrite somebody's unrelated published post with this one's body. The
    // recorded URL is the cheapest possible check and it does not depend on
    // site ids being right in our own tables.
    if (post.wordpress_url && !sameSiteHost(post.wordpress_url, siteUrl)) {
      outcomes.push(outcomeFor(post, 'it is published on a different site from the one these credentials open, so it was left alone'))
      continue
    }

    let updated = html
    let postMoved = 0
    let postRefused = 0
    let postGone = 0
    const moves: Array<{ from: string; to: string }> = []

    for (const c of candidates) {
      if (io.sourceAlive) {
        let alive: boolean
        try {
          alive = await io.sourceAlive(c.url)
        } catch {
          // A probe that threw proves nothing. Treat it as alive and let the
          // upload be the judge, rather than reporting a picture as lost on the
          // strength of a check that did not complete.
          alive = true
        }
        if (!alive) {
          postGone++
          gone++
          failures.push({ url: c.url, reason: 'the original picture is no longer there, so it has to be made again' })
          continue
        }
      }

      attempted++
      try {
        const newUrl = await io.uploadFromUrl(c.url, `rehost-${post.id.slice(0, 8)}-${postMoved + postRefused + 1}.jpg`)
        if (!newUrl) {
          postRefused++
          refused++
          failures.push({ url: c.url, reason: 'the site accepted the upload but returned no URL' })
          continue
        }
        updated = replaceImageUrl(updated, c.url, newUrl)
        moves.push({ from: c.url, to: newUrl })
        postMoved++
        moved++
      } catch (e) {
        postRefused++
        refused++
        failures.push({ url: c.url, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
      }
    }

    if (postMoved === 0) {
      outcomes.push({ id: post.id, title: post.title ?? '', moved: 0, refused: postRefused, gone: postGone })
      continue
    }

    try {
      await io.updatePost(post.wordpress_post_id, updated)
    } catch (e) {
      failures.push({
        url: post.wordpress_url ?? post.id,
        reason: `pictures uploaded, but the post could not be updated: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`,
      })
      // The upload happened and the live post did not change, so nothing was
      // repaired from a reader's point of view. Counted as refused, not moved.
      moved -= postMoved
      refused += postMoved
      outcomes.push({ id: post.id, title: post.title ?? '', moved: 0, refused: postRefused + postMoved, gone: postGone })
      continue
    }

    // The body is repaired. Anything else on the post that named the old URL
    // has to follow it, or the article is safe while its social card still
    // points at a picture that is going to be deleted.
    if (io.afterMoved) {
      try { await io.afterMoved(post.wordpress_post_id, moves) }
      catch { /* a social preview is never worth undoing a repair over */ }
    }

    // What is left over after the rewrite decides the status, not what we
    // intended to do. A post with one picture still on fal is still hot-linked.
    const leftover = findRehostable(updated, siteUrl).length
    const total = postMoved + leftover
    try {
      await io.saveContent(post.id, updated, postMoved, imagesStatusOf(total, postMoved))
    } catch { /* the live post is already correct; our copy catches up later */ }

    outcomes.push({ id: post.id, title: post.title ?? '', moved: postMoved, refused: postRefused, gone: postGone })
  }

  return {
    moved,
    refused,
    gone,
    attempted,
    failures,
    posts: outcomes,
    siteRefusedEverything: attempted > 0 && moved === 0 && refused > 0,
  }
}

/**
 * The sentence a person reads. Never "done": a run that moved nothing has to
 * read differently from one that moved everything, and a run that found the
 * originals deleted has to read differently from both.
 */
export function describeRun(r: RehostRunResult, postCount: number): string {
  if (postCount === 0) return 'No posts needed repairing.'

  const parts: string[] = []
  if (r.moved > 0) {
    parts.push(`Moved ${r.moved} picture${r.moved === 1 ? '' : 's'} onto the site.`)
  }
  if (r.siteRefusedEverything) {
    parts.push(`Nothing moved. The site refused all ${r.refused} upload${r.refused === 1 ? '' : 's'}, so these posts still point at pictures that are not theirs. Run Test pictures in Setup, WordPress Doctor to find out why.`)
  } else if (r.refused > 0) {
    parts.push(`${r.refused} picture${r.refused === 1 ? '' : 's'} could not be uploaded and ${r.refused === 1 ? 'is' : 'are'} still on our server.`)
  }
  if (r.gone > 0) {
    parts.push(`${r.gone} original${r.gone === 1 ? '' : 's'} ${r.gone === 1 ? 'is' : 'are'} gone for good and ${r.gone === 1 ? 'has' : 'have'} to be made again.`)
  }
  if (parts.length === 0) {
    return `Looked at ${postCount} post${postCount === 1 ? '' : 's'} and found nothing to move.`
  }
  return parts.join(' ')
}

/** The shape of the WordPress service this repair needs, so the helper below
 *  can be handed the real one without importing it here. */
export interface WpForRehost {
  getPostMetaValue(id: number, key: string): Promise<string | null>
  updatePost(id: number, patch: { meta?: Record<string, unknown> }): Promise<unknown>
}

/**
 * Follow the pictures that moved into `mvp_og_image`.
 *
 * The plugin renders that meta value as og:image AND twitter:image, and it is
 * written separately from the article body. A post whose body we repaired while
 * its meta still names the old URL is an article that survives with a social
 * card that does not, which is the same failure in a place nobody looks.
 *
 * Only ever repointed when the meta names a picture this run actually moved.
 * Overwriting it with "the first thing we moved" would replace a deliberate
 * social image, often the YouTube thumbnail, with a random in-body picture.
 *
 * Shared by the sweep and the button so the two cannot drift, which is the
 * mistake this whole area is built around avoiding.
 */
export function makeOgImageFollower(wp: WpForRehost) {
  return async function afterMoved(postId: number, moves: Array<{ from: string; to: string }>): Promise<void> {
    if (moves.length === 0) return
    const current = await wp.getPostMetaValue(postId, 'mvp_og_image')
    if (!current) return
    const hit = moves.find(m => m.from === current)
    if (!hit) return
    await wp.updatePost(postId, { meta: { mvp_og_image: hit.to } })
  }
}
