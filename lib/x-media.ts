// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying,
// redistribution, reverse-engineering, or reuse. See LICENSE.
//
// PUT THE PICTURE IN THE TWEET.
//
// Until now MVP posted a bare link to X and let X build the card, which means
// the picture came from the destination's og:image and from nowhere else. A
// creator reported his X posts showing a title, a description and a blank grey
// rectangle. He was right, and the cause turned out to be two separate things
// stacked:
//
//   the post had no featured image, so there was no og:image to read. That is
//   fixed separately (thumbnail_blocked + hero_source_url + the heal).
//
//   and even on a post WITH a featured image, a link card is X's rendering of
//   someone else's page. It is small, it is not guaranteed, and it disappears
//   entirely if the destination is slow or behind a bot wall. An attached image
//   is ours: X stores it, and it renders whatever the blog does.
//
// THE SCOPE PROBLEM, which is the part that decides how this has to behave.
//
// Uploading media under OAuth 2.0 needs the `media.write` scope, and a scope is
// fixed at authorization time. Refreshing a token does NOT add one. So every X
// connection made before today has a token that cannot upload, and there is no
// server-side fix: those creators have to reconnect X.
//
// That makes "post the text, skip the image" the common case for a while, and
// the one thing it must never be is silent. A tweet that went out without its
// picture looks exactly like a tweet that went out with one, from our side, so
// every caller gets a `note` back and is expected to show it. Reporting the
// artifact, not the intent.
import { assertPublicHttpUrlResolved, SsrfBlocked } from '@/lib/ssrf-guard'
import { fetchWithTimeout, UPLOAD_TIMEOUT_MS } from '@/lib/fetch-timeout'
import { uploadMedia } from '@/services/twitter'
import { mediaCapability, MEDIA_SCOPE } from '@/lib/x-scopes'

/** X's ceiling for a still image on a post. Bigger uploads are rejected. */
export const X_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** What X accepts as a post image. Anything else is not worth the round trip. */
export const X_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

/**
 * The sentence a creator sees when their connection is too old to carry images.
 *
 * Deliberately says what happened, what it means and what to do, because it is
 * the only place they will ever learn that reconnecting buys them anything. A
 * generic "image failed" would read as a transient blip and be ignored forever.
 */
export const RECONNECT_FOR_IMAGES =
  'Posted to X, but without the image. Your X connection was made before MVP could upload pictures, so X will not accept one on this token. Reconnect X in Settings and your next post carries the image.'

export interface XMediaOutcome {
  /** Media ids to hand to the tweet. Empty when nothing was attached. */
  mediaIds: string[]
  /** True only when X accepted the upload and returned an id. */
  attached: boolean
  /**
   * Why there is no image, in a creator's words. Null when one is attached AND
   * null when none was ever asked for: a text-only post by choice is not a
   * degraded post and should not carry a warning.
   */
  note: string | null
}

const NOTHING: XMediaOutcome = { mediaIds: [], attached: false, note: null }

/** Downloaded image bytes, ready to upload. */
export interface XImageBytes { bytes: Uint8Array; contentType: string }

/**
 * Fetch an image we intend to attach, with the checks X would apply anyway.
 *
 * Throws with a readable reason rather than returning null, because every
 * reason here is worth putting on screen: "the image is 9 MB" and "the image
 * URL 404s" need different fixes and the creator is the only one who can make
 * either.
 */
export async function fetchImageForX(imageUrl: string): Promise<XImageBytes> {
  // The URL reaches us from a blog post row, a deal row or an og:image tag, so
  // it is not typed by the poster — but every one of those is ultimately
  // writable by a user, which is exactly the shape lib/ssrf-guard exists for.
  // Resolved variant: a hostname whose A record points inside the VPC is the
  // gap the sync check documents.
  try {
    await assertPublicHttpUrlResolved(imageUrl)
  } catch (e) {
    throw new Error(e instanceof SsrfBlocked ? e.message : 'That image URL cannot be reached.')
  }

  const res = await fetchWithTimeout(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MVPAffiliate/1.0)' },
  })
  if (!res.ok) throw new Error(`The image could not be downloaded (${res.status}).`)

  // Content-Length first: a 60 MB file should not be pulled into memory just to
  // measure it. It is advisory, so the real length is checked again below.
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > X_IMAGE_MAX_BYTES) {
    throw new Error(`The image is ${(declared / 1048576).toFixed(1)} MB and X's limit is 5 MB.`)
  }

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (contentType && !X_IMAGE_TYPES.has(contentType)) {
    throw new Error(`X does not accept ${contentType} images.`)
  }

  const bytes = new Uint8Array(await res.arrayBuffer())
  if (!bytes.byteLength) throw new Error('The image came back empty.')
  if (bytes.byteLength > X_IMAGE_MAX_BYTES) {
    throw new Error(`The image is ${(bytes.byteLength / 1048576).toFixed(1)} MB and X's limit is 5 MB.`)
  }

  // A server that sends no content-type still has to be given one, and sniffing
  // the magic bytes beats defaulting to jpeg and having X reject the upload
  // with a message about the thing we guessed.
  return { bytes, contentType: contentType || sniffImageType(bytes) }
}

/** Identify an image from its first bytes, for servers that send no type. */
export function sniffImageType(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  // RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return 'image/jpeg'
}

/**
 * Get an image onto X, or explain why there is none.
 *
 * THIS NEVER THROWS. Attaching an image is an improvement to a post, and a
 * failed improvement must not cost the creator the post itself — nor, on the X
 * tier, the cap unit the post was going to spend. Every failure comes back as a
 * note instead, and the caller posts the text and shows it.
 *
 * The one asymmetry worth naming: a token with no `media.write` is not tried at
 * all. We know it will 403, and spending a 5 MB download plus a round trip to
 * find out is a worse experience than reporting it immediately.
 */
export async function resolveXMedia(opts: {
  accessToken: string
  /** The image to attach, or null for a text-only post. */
  imageUrl: string | null | undefined
  /** The space-separated scopes recorded at connect time, when we have them. */
  grantedScopes: string | null | undefined
}): Promise<XMediaOutcome> {
  const { accessToken, imageUrl, grantedScopes } = opts
  if (!imageUrl) return NOTHING

  const capability = mediaCapability(grantedScopes)
  if (capability === 'no') {
    return { mediaIds: [], attached: false, note: RECONNECT_FOR_IMAGES }
  }

  try {
    const image = await fetchImageForX(imageUrl)
    const id = await uploadMedia(accessToken, image.bytes, image.contentType)
    return { mediaIds: [id], attached: true, note: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 'unknown' means the connection predates us recording scopes, so a refusal
    // here is the same fact the 'no' branch reports, learned the slow way. Say
    // the same sentence: a creator should not get two different explanations
    // for one cause depending on when they happened to connect.
    if (looksLikeMissingMediaScope(msg)) {
      return { mediaIds: [], attached: false, note: RECONNECT_FOR_IMAGES }
    }
    return { mediaIds: [], attached: false, note: `Posted to X, but the image did not attach: ${msg}` }
  }
}

/** Whether an upload failure is X refusing the token rather than the file. */
export function looksLikeMissingMediaScope(message: string): boolean {
  return /\b(401|403)\b/.test(message)
    || /oauth2|unsupported[- ]authentication|not permitted/i.test(message)
    || new RegExp(MEDIA_SCOPE.replace('.', '\\.'), 'i').test(message)
}

/**
 * Record the scopes X granted, so the next post knows before it tries.
 *
 * Written on its OWN update, after the token write, and its error is swallowed.
 * The connect callback already carries a comment earned the hard way: PostgREST
 * rejects an entire write over one unknown column, so folding this into the
 * token upsert would mean a database that has not run migration 337 silently
 * saves no tokens at all while every screen still says Connected. A column that
 * can only cost us the capability HINT is the right trade; resolveXMedia treats
 * a missing hint as "try it and see".
 */
export async function rememberXScopes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  scope: string | null | undefined,
): Promise<void> {
  if (!scope || !userId) return
  try {
    const { error } = await supabase.from('integrations').update({ twitter_scopes: scope }).eq('user_id', userId)
    if (error) console.warn('[x-media] could not record X scopes:', error.message)
  } catch (e) {
    console.warn('[x-media] could not record X scopes:', e instanceof Error ? e.message : String(e))
  }
}

/** The upload timeout, named so the service and its test agree on one number. */
export const X_UPLOAD_TIMEOUT_MS = UPLOAD_TIMEOUT_MS
