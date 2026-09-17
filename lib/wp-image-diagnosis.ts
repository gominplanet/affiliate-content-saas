// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "MY PICTURES DON'T COME UP" IS THREE DIFFERENT PROBLEMS.
//
// A creator running a site he had converted from his therapy practice to
// product reviews asked where to even start: posts publish, pictures do not
// appear, and a second site he built from scratch works perfectly. He is on
// Pro, with 231 posts.
//
// Nothing in the product could answer him, and nothing could answer the next
// person either. There was no way to ask his site a question. The only evidence
// was blog_posts.images_status, which a creator cannot see and which says
// `failed` for every cause alike.
//
// There are three failures behind that one sentence, and they need opposite
// fixes:
//
//   REFUSED    his site rejects the upload. A security plugin, mod_security, a
//              disallowed file type, or an application password whose user
//              lacks upload_files. The picture never reaches the site.
//   ORPHANED   his site accepts the upload and then will not serve the file.
//              Wrong uploads directory permissions, a CDN or hotlink rule, or a
//              plugin rewriting media URLs. The picture is on the site and the
//              web cannot fetch it.
//   INVISIBLE  the upload works and the file serves. The picture is fine and
//              the THEME is not drawing it, which a theme built for something
//              other than product reviews often does not. It is the one case
//              where hunting through security plugins wastes a week.
//
// The whole value is in telling those apart, so this module's only job is to
// turn what the site actually did into the right one of them. Pure, so the
// wording is pinned by tests rather than by having a broken site to hand.
//
// WORTH RECORDING HOW THIS WAS FIRST GOT WRONG, because the wrong answer was
// the plausible one. His converted site made INVISIBLE the obvious guess, and
// his stored rows appeared to confirm it: 0 failed, 23 ready. Both pointed the
// same way and both were wrong. His live site, which is public and took one
// request to read, showed 45 pictures on his own domain in July and none after,
// with featured images going 73/83 to 0/25 over the same stretch. He was
// REFUSED, and had been for a month.
//
// Two things follow. A stored status is evidence about what the code believed,
// never about what the site did, and this one was counting a fallback as a
// success. And this module must only ever return INVISIBLE off a probe that
// actually uploaded and actually fetched the file back, never off a guess about
// the kind of site somebody has.

export type ImageVerdict = 'refused' | 'orphaned' | 'invisible' | 'unknown'

export interface ImageProbe {
  /** Did the site accept the upload? */
  uploaded: boolean
  /** HTTP status from the upload, when there was one. */
  uploadStatus?: number | null
  /** Whatever the site said when it refused. */
  uploadError?: string | null
  /** The URL WordPress handed back for the file it stored. */
  mediaUrl?: string | null
  /** Was that URL actually fetchable from the open web? */
  mediaFetched?: boolean | null
  /** HTTP status from fetching it. */
  mediaStatus?: number | null
  /** Content type the fetch returned, to catch an HTML error page served as an image. */
  mediaContentType?: string | null
}

export interface ImageDiagnosis {
  verdict: ImageVerdict
  /** One line, safe to render. Says which of the three it is. */
  headline: string
  /** What to do next, in the creator's own terms. */
  detail: string
  /** True when the site is fine and the problem is elsewhere. */
  siteAcceptsImages: boolean
}

/** Refusals whose cause is knowable from what WordPress said. */
function refusalDetail(status: number | null | undefined, error: string | null | undefined): string {
  const e = (error ?? '').toLowerCase()

  if (status === 401 || status === 403 || /rest_cannot_create|not allowed|unauthor|forbidden/.test(e)) {
    return 'Your site refused the upload as not permitted. The usual cause is the WordPress user behind your application password not having the upload_files capability, which an Editor or Author role can be missing. A security plugin blocking the REST media endpoint does the same thing. Check the role on that user first, then any firewall or security plugin.'
  }
  if (status === 413 || /too large|entity too large|exceeds the maximum/.test(e)) {
    return 'Your site refused the upload for being too big. That is a host limit (upload_max_filesize or post_max_size in PHP, or a proxy limit). Your host can raise it.'
  }
  if (/file type|not permitted for security|mime/.test(e)) {
    return 'Your site refused the file type. Something is restricting which file types may be uploaded, usually a security plugin or an ALLOW_UNFILTERED_UPLOADS setting.'
  }
  if (status === 404 || /rest_no_route|no route/.test(e)) {
    return 'Your site does not expose the WordPress media endpoint at all. That is usually a plugin or a security rule disabling the REST API. Re-enabling it for media is what unblocks this.'
  }
  if (status != null && status >= 500) {
    return 'Your site errored while storing the file. That points at the server rather than at permissions: a full disk, an uploads folder that is not writable, or a PHP error in a plugin that hooks uploads. Your host can read the error log and see it immediately.'
  }
  return 'Your site refused the upload and the reason it gave is below. The three common causes are a security plugin blocking the REST media endpoint, the application password belonging to a user without upload permission, and a server rule blocking uploads.'
}

export function diagnoseImages(probe: ImageProbe): ImageDiagnosis {
  if (!probe.uploaded) {
    return {
      verdict: 'refused',
      headline: 'Your site would not accept the picture.',
      detail: refusalDetail(probe.uploadStatus, probe.uploadError),
      siteAcceptsImages: false,
    }
  }

  // Accepted, but we could not confirm the file is reachable. Reported as its
  // own thing rather than folded into either neighbour, because "we did not
  // check" and "we checked and it failed" are different answers.
  if (probe.mediaFetched == null) {
    return {
      verdict: 'unknown',
      headline: 'Your site accepted the picture, and we could not check whether it serves.',
      detail: 'The upload itself worked, so permissions and security rules are not the problem. We could not fetch the file back to confirm it is visible on the open web, so this is half an answer rather than a clean bill of health.',
      siteAcceptsImages: true,
    }
  }

  if (!probe.mediaFetched) {
    const ct = probe.mediaContentType ?? ''
    const servedHtml = /text\/html/i.test(ct)
    return {
      verdict: 'orphaned',
      headline: 'Your site stored the picture but will not serve it.',
      detail: servedHtml
        ? 'Asking for the image gave back a web page instead of a picture, which usually means a security plugin, a hotlink rule or a redirect is standing in front of your uploads folder. Whatever sits in front of /wp-content/uploads/ is what to look at.'
        : `Your site accepted the file and then would not hand it back${probe.mediaStatus ? ` (it answered ${probe.mediaStatus})` : ''}. The usual causes are permissions on the uploads folder, a CDN or caching layer serving stale or blocked paths, or a plugin rewriting media URLs to somewhere the file is not.`,
      siteAcceptsImages: true,
    }
  }

  // THE ONE NOBODY COULD SAY BEFORE. Everything about the picture worked, so
  // the site is not the problem and the theme is.
  return {
    verdict: 'invisible',
    headline: 'Your site takes pictures fine, so the problem is your theme.',
    detail: 'We uploaded a picture to your site and fetched it back successfully, which rules out permissions, security plugins and your uploads folder. That means the images on your posts are already on your site, and your theme is not drawing them. This is common on a site converted from another purpose: a theme built for something other than product reviews often has no featured image in its post template. Open one of your posts in the WordPress editor and look at the Featured image box in the sidebar. If a picture is sitting there but does not show on the live page, it is the theme template, and switching to the MVP theme or enabling featured images in your current one fixes it.',
    siteAcceptsImages: true,
  }
}
