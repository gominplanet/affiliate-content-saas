/**
 * Instagram service module — Instagram API (with Instagram Login)
 *
 * Architecture
 * ============
 * - Each user connects their own Instagram Business/Creator account via
 *   the Instagram OAuth flow (NOT Facebook Login). We store a long-lived
 *   access token (~60 days) + their IG user ID + handle.
 * - Publishing happens via Instagram Graph API: create media container →
 *   poll until processing finishes → publish.
 *
 * Required Meta app config (one-time per app):
 *   - INSTAGRAM_APP_ID                 (public, fine in env)
 *   - INSTAGRAM_APP_SECRET             (server-only)
 *   - OAuth redirect URI registered in Meta dashboard:
 *     https://<your-domain>/api/auth/instagram/callback
 *
 * Permissions used (Standard Access works for testers; Advanced Access
 * via App Review needed for non-tester production users):
 *   - instagram_business_basic         (read profile, list IG account)
 *   - instagram_business_content_publish (publish reels + stories)
 *
 * API limitations we have to work around:
 *   - Reels caption: max 2200 chars, max 30 hashtags
 *   - Story link stickers: NOT supported via API — user adds manually
 *     in the IG app after we publish the Story
 *   - Reel captions: URLs are not clickable (IG-wide)
 *   - 100 published items per 24h per IG account (combined feed+reels;
 *     stories don't count)
 *
 * Docs:
 *   https://developers.facebook.com/docs/instagram-platform/content-publishing
 */
import { describeMetaError } from '@/lib/meta-error'
import { feedVerdict, IgTooSoonError, IgRepeatError, IG_FEED_GAP_MS } from '@/lib/ig-pace'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { discloseSocialPost } from '@/lib/social-disclaimer'

const GRAPH_BASE = 'https://graph.instagram.com'
const GRAPH_VERSION = 'v22.0'
const OAUTH_BASE = 'https://api.instagram.com/oauth'
const AUTH_BASE = 'https://www.instagram.com/oauth'

const SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  // Comment→DM automation scopes. Meta approved both on 2026-10-23, so they
  // are asked for on every connect; IG_DM_SCOPES=false in Vercel stops that.
  ...(process.env.IG_DM_SCOPES !== 'false'
    ? ['instagram_business_manage_comments', 'instagram_business_manage_messages']
    : []),
].join(',')

export interface InstagramTokens {
  /** Long-lived (60-day) access token */
  accessToken: string
  /** IG user/account ID */
  userId: string
  /** IG username (handle) */
  username: string
  /** Unix ms when the token expires */
  expiresAt: number
  /** The permissions the creator granted, as Instagram listed them when the
   *  code was exchanged, or null when it listed none. */
  permissions: string[] | null
}

/** The granted permissions in a token exchange answer: a list or a comma
 *  string, flat or inside data[0] (Meta's docs show both). Pure. */
export function grantedPermissions(answer: unknown): string[] | null {
  const a = answer as { permissions?: unknown; data?: { permissions?: unknown }[] } | null
  const raw = a?.permissions ?? (Array.isArray(a?.data) ? a?.data?.[0]?.permissions : undefined)
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(',') : null
  const out = list?.map((p) => p.trim()).filter(Boolean) ?? []
  return out.length ? out : null
}

/** Build the OAuth URL the user visits to authorize MVP Affiliate. */
export function buildAuthUrl(opts: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state: opts.state,
  })
  return `${AUTH_BASE}/authorize?${params.toString()}`
}

/**
 * Exchange the authorization code for tokens. Does the two-step
 * Instagram dance: code → short-lived token → long-lived token.
 * Also fetches username via /me so we can display it in the UI.
 */
export async function exchangeCodeForTokens(opts: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<InstagramTokens> {
  // Step 1: code → short-lived token (form-encoded body, per IG docs)
  const formBody = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: opts.redirectUri,
    code: opts.code,
  })
  const shortRes = await fetchWithTimeout(`${OAUTH_BASE}/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody.toString(),
  })
  const shortData = await shortRes.json() as {
    access_token?: string
    user_id?: string | number
    permissions?: string[] | string
    error_type?: string
    error_message?: string
    error?: { message: string }
  }
  if (!shortRes.ok || !shortData.access_token) {
    const errMsg = shortData.error_message || shortData.error?.message || `HTTP ${shortRes.status}`
    throw new Error(`Instagram token exchange failed: ${errMsg}`)
  }

  // Step 2: short-lived → long-lived token (60 days)
  const longUrl = `${GRAPH_BASE}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(opts.clientSecret)}&access_token=${encodeURIComponent(shortData.access_token)}`
  const longRes = await fetchWithTimeout(longUrl)
  const longData = await longRes.json() as {
    access_token?: string
    token_type?: string
    expires_in?: number
    error?: { message: string }
  }
  if (!longRes.ok || !longData.access_token) {
    throw new Error(`Instagram long-lived token exchange failed: ${longData.error?.message || `HTTP ${longRes.status}`}`)
  }

  const longToken = longData.access_token
  const expiresAt = Date.now() + (longData.expires_in ?? 60 * 24 * 60 * 60) * 1000

  // Step 3: fetch username for display
  const meRes = await fetchWithTimeout(`${GRAPH_BASE}/${GRAPH_VERSION}/me?fields=id,username&access_token=${encodeURIComponent(longToken)}`)
  const meData = await meRes.json() as { id?: string; username?: string; error?: { message: string } }
  if (!meRes.ok || !meData.id) {
    throw new Error(`Instagram /me failed: ${meData.error?.message || `HTTP ${meRes.status}`}`)
  }

  return {
    accessToken: longToken,
    userId: meData.id,
    username: meData.username ?? '',
    expiresAt,
    permissions: grantedPermissions(shortData),
  }
}

/**
 * Refresh a long-lived token to extend its life by another 60 days.
 * Should be called when the existing token is at least 24h old but
 * before expiry. We call it lazily on each publish if expiry is < 7 days
 * away to avoid storing stale tokens.
 */
export async function refreshLongLivedToken(currentToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const url = `${GRAPH_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(currentToken)}`
  const res = await fetchWithTimeout(url)
  const data = await res.json() as { access_token?: string; expires_in?: number; error?: { message: string } }
  if (!res.ok || !data.access_token) {
    throw new Error(`Instagram token refresh failed: ${data.error?.message || `HTTP ${res.status}`}`)
  }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 60 * 24 * 60 * 60) * 1000,
  }
}

/**
 * Best-effort media_count for the connected account. A very low count means a
 * brand-new / low-trust account, which is the profile most likely to get
 * restricted for posting via an API. Used only to WARN the user, never to block.
 * Returns null on any failure.
 */
export interface MediaInsights {
  reach: number | null
  plays: number | null
  likes: number | null
  comments: number | null
  saves: number | null
  shares: number | null
}

/**
 * Pull a published Reel's performance metrics. Powers Pulse (reach-based
 * hashtag learning). Returns null when the media is gone (deleted) or the token
 * lacks insights permission; returns partial (some fields null) when Instagram
 * omits a metric. `views` replaced `plays` in the Graph API — we request both
 * and take whichever comes back.
 */
export async function getMediaInsights(opts: { mediaId: string; accessToken: string }): Promise<MediaInsights | null> {
  try {
    const metrics = 'reach,likes,comments,saved,shares,views'
    const res = await fetchWithTimeout(
      `${GRAPH_BASE}/${GRAPH_VERSION}/${encodeURIComponent(opts.mediaId)}/insights?metric=${metrics}&access_token=${encodeURIComponent(opts.accessToken)}`,
    )
    const data = await res.json() as { data?: Array<{ name: string; values?: Array<{ value: number }> }>; error?: { message?: string } }
    if (!res.ok || !Array.isArray(data.data)) return null
    const val = (name: string): number | null => {
      const row = data.data!.find(d => d.name === name)
      const v = row?.values?.[0]?.value
      return typeof v === 'number' ? v : null
    }
    return {
      reach: val('reach'),
      plays: val('views'),
      likes: val('likes'),
      comments: val('comments'),
      saves: val('saved'),
      shares: val('shares'),
    }
  } catch {
    return null
  }
}

export async function getMediaCount(opts: { userId: string; accessToken: string }): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(`${GRAPH_BASE}/${GRAPH_VERSION}/${opts.userId}?fields=media_count&access_token=${encodeURIComponent(opts.accessToken)}`)
    const data = await res.json() as { media_count?: number }
    if (!res.ok || typeof data.media_count !== 'number') return null
    return data.media_count
  } catch {
    return null
  }
}

/** The container's fields, without the token: the same post whichever way
 *  it goes out (Instagram Login, or Facebook Login for the Paid partnership
 *  label, lib/ig-paid-label). */
export type ContainerOpts = Omit<Parameters<typeof createMediaContainer>[0], 'userId' | 'accessToken'>
export function containerParams(opts: ContainerOpts): URLSearchParams {
  const body = new URLSearchParams({ media_type: opts.mediaType })
  if (opts.imageUrl) {
    body.set('image_url', opts.imageUrl)
  } else if (opts.videoUrl) {
    body.set('video_url', opts.videoUrl)
  } else {
    throw new Error('createMediaContainer: must provide imageUrl or videoUrl')
  }
  if (opts.mediaType === 'REELS') {
    if (opts.caption) body.set('caption', discloseSocialPost(opts.caption, 'instagram'))
    if (opts.shareToFeed !== false) body.set('share_to_feed', 'true')
    // Cover frame chosen in MVP → IG uses this frame as the Reel thumbnail.
    if (typeof opts.thumbOffsetMs === 'number' && opts.thumbOffsetMs >= 0) {
      body.set('thumb_offset', String(Math.round(opts.thumbOffsetMs)))
    }
  } else if (opts.mediaType === 'IMAGE') {
    if (opts.caption) body.set('caption', discloseSocialPost(opts.caption, 'instagram'))
  }

  return body
}

/**
 * Create a media container for a Reel or Story.
 * Returns the container id which we then have to poll until processing
 * finishes, before publishing.
 */
export async function createMediaContainer(opts: {
  userId: string
  accessToken: string
  /**
   * REELS = vertical video feed/reel post
   * STORIES = 24h story (image or video)
   * IMAGE = standard feed image post (single image, not carousel)
   */
  mediaType: 'REELS' | 'STORIES' | 'IMAGE'
  /** Required for REELS and video-Stories. */
  videoUrl?: string
  /** Required for IMAGE and image-Stories. */
  imageUrl?: string
  /** Feed posts (REELS / IMAGE) — caption with hashtags. Ignored for Stories. */
  caption?: string
  /** Reels only — also share to feed (recommended for reach). */
  shareToFeed?: boolean
  /** Reels only — the frame to use as the COVER, in milliseconds into the video.
   *  Lets the creator pick the still in MVP instead of fixing it in the IG app. */
  thumbOffsetMs?: number
  /** Instagram's Paid partnership label (lib/ig-paid-label). */
  paidPartnership?: boolean
}): Promise<string> {
  const body = containerParams(opts)
  if (opts.paidPartnership) body.set('is_paid_partnership', 'true')
  body.set('access_token', opts.accessToken)
  const res = await fetchWithTimeout(`${GRAPH_BASE}/${GRAPH_VERSION}/${opts.userId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const data = await res.json().catch(() => ({})) as { id?: string }
  if (!res.ok || !data.id) {
    // Same reasoning as Threads: Meta's `code` is what separates a dead token
    // from a rate limit from a media Instagram will not take, and reading only
    // `error.message` threw all three away.
    throw new Error(describeMetaError('Instagram', 'container create', data, res.status))
  }
  return data.id
}

/**
 * Poll a media container until it's FINISHED (or fail on ERROR/EXPIRED).
 *
 * Video processing typically takes 30s–2min. We poll every 5s up to
 * the timeout. Returns when status_code === 'FINISHED'.
 */
export async function waitForContainer(opts: {
  containerId: string
  accessToken: string
  timeoutMs?: number
}): Promise<void> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60 * 1000)
  let attempt = 0
  while (Date.now() < deadline) {
    attempt += 1
    const res = await fetchWithTimeout(`${GRAPH_BASE}/${GRAPH_VERSION}/${opts.containerId}?fields=status_code,status&access_token=${encodeURIComponent(opts.accessToken)}`)
    const data = await res.json() as { status_code?: string; status?: string; error?: { message: string } }
    if (!res.ok) {
      throw new Error(`Instagram status check failed: ${data.error?.message || `HTTP ${res.status}`}`)
    }
    if (data.status_code === 'FINISHED') return
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new Error(`Instagram container failed: status=${data.status_code} ${data.status ?? ''}`)
    }
    // Backoff: 3s, then every 5s
    await new Promise(r => setTimeout(r, attempt === 1 ? 3000 : 5000))
  }
  throw new Error('Instagram container processing timed out after 5 minutes')
}

/**
 * Publish a previously-FINISHED media container. Returns the published
 * media id, which we save to the blog_post row for tracking.
 */
export async function publishContainer(opts: {
  userId: string
  accessToken: string
  containerId: string
}): Promise<string> {
  const body = new URLSearchParams({
    creation_id: opts.containerId,
    access_token: opts.accessToken,
  })
  const res = await fetchWithTimeout(`${GRAPH_BASE}/${GRAPH_VERSION}/${opts.userId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const data = await res.json() as { id?: string; error?: { message: string } }
  if (!res.ok || !data.id) {
    throw new Error(`Instagram publish failed: ${data.error?.message || `HTTP ${res.status}`}`)
  }
  return data.id
}

// AT A HUMAN PACE (lib/ig-pace; Seb, 2026-10-26, Alejandro's account was
// flagged). Every Reel and feed post MVP makes comes through publishMedia, so
// the spacing lives here once: held for this account in this process before
// anything is awaited (two posts in one run cannot both go), then checked
// against Instagram's own list of the account's posts. Stories are left alone.
const feedSlots = new Map<string, number>()
async function claimFeedSlot(igUserId: string, accessToken: string, caption: string | undefined): Promise<void> {
  const now = Date.now()
  const held = feedSlots.get(igUserId)
  if (held && now - held < IG_FEED_GAP_MS) throw new IgTooSoonError(held, now)
  feedSlots.set(igUserId, now)
  // A list Instagram did not send is no reason not to post: the hold above
  // still spaces MVP's own posts.
  const { media } = await listRecentMedia({ igUserId, accessToken, limit: 10 })
  const v = feedVerdict(media, caption, now)
  if (v.ok) return
  feedSlots.delete(igUserId)
  if ('tooSoon' in v) throw new IgTooSoonError(v.tooSoon, now)
  throw new IgRepeatError(v.repeatAt, now)
}

/** When this account may next take a Reel or feed post, or null for now.
 *  Holds nothing: for a job deciding whether to start its work (a burn is
 *  paid for before it posts). */
export async function feedWaitUntil(igUserId: string, accessToken: string): Promise<number | null> {
  const now = Date.now()
  const held = feedSlots.get(igUserId)
  if (held && now - held < IG_FEED_GAP_MS) return held + IG_FEED_GAP_MS
  const { media } = await listRecentMedia({ igUserId, accessToken, limit: 3 })
  const v = feedVerdict(media, null, now)
  return !v.ok && 'tooSoon' in v ? v.tooSoon + IG_FEED_GAP_MS : null
}

/**
 * High-level helper: create container → wait → publish in one call.
 * Returns the published media id.
 */
export async function publishMedia(opts: {
  userId: string
  accessToken: string
  mediaType: 'REELS' | 'STORIES' | 'IMAGE'
  videoUrl?: string
  imageUrl?: string
  caption?: string
  shareToFeed?: boolean
  thumbOffsetMs?: number
}): Promise<string> {
  const feed = opts.mediaType !== 'STORIES'
  if (feed) await claimFeedSlot(opts.userId, opts.accessToken, opts.caption)
  try {
    // THE PAID PARTNERSHIP LABEL (lib/ig-paid-label). 1: the switch on the
    // usual post. 2: when Instagram refuses it, through the linked Facebook
    // Page. 3: the usual post without it. Each step is taken only when
    // nothing was published before it, and what happened is kept.
    const label = await import('@/lib/ig-paid-label')
    const want = await label.paidLabelWanted(opts.userId).catch(() => ({ on: false, direct: false, owner: null }))
    // Kept only once the same post goes out another way: then the media was
    // fine and it was the switch Instagram refused.
    let directRefusal: string | null = null
    if (want.direct) {
      let labelledContainer: string | null = null
      try {
        labelledContainer = await createMediaContainer({ ...opts, paidPartnership: true })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // Only a refusal of the switch itself is kept; a media problem fails
        // the usual post below too, and is said there.
        if (label.refusedTheSwitch(msg)) directRefusal = msg
      }
      if (labelledContainer) {
        await waitForContainer({ containerId: labelledContainer, accessToken: opts.accessToken })
        const id = await publishContainer({ userId: opts.userId, accessToken: opts.accessToken, containerId: labelledContainer })
        const shown = await label.readBackLabel(id, opts.accessToken)
        await label.remember(want.owner, {
          at: new Date().toISOString(), on: shown !== false, mediaId: id, kind: opts.mediaType,
          ...(shown === true ? { detail: 'Instagram confirms it.' } : shown === false ? { why: 'refused' as const, detail: 'Instagram took the post but says the label is not on' } : { detail: 'Instagram took the switch. Check the post shows Paid partnership.' }),
        })
        return id
      }
    }
    if (want.on) {
      const labelled = await label.publishWithPaidLabel({ userId: opts.userId, accessToken: opts.accessToken, params: containerParams(opts), kind: opts.mediaType })
      if (labelled) {
        if (directRefusal) await label.noteDirectRefusal(want.owner, directRefusal)
        return labelled
      }
    }
    const containerId = await createMediaContainer(opts)
    if (directRefusal) await label.noteDirectRefusal(want.owner, directRefusal)
    await waitForContainer({ containerId, accessToken: opts.accessToken })
    return await publishContainer({
      userId: opts.userId,
      accessToken: opts.accessToken,
      containerId,
    })
  } catch (e) {
    // Nothing went up: the hold is let go, so a retry is not refused. A post
    // that may be live (lib/ig-paid-label) keeps its hold.
    if (feed && !(e instanceof Error && e.name === 'PaidLabelUncertainError')) feedSlots.delete(opts.userId)
    throw e
  }
}

/**
 * The post's REAL public address, read from Meta after publishing.
 *
 * NEVER BUILD IT FROM THE MEDIA ID. instagram.com/p/ takes the post's
 * shortcode, not the numeric Graph id, so instagram.com/p/<mediaId> was a dead
 * link on every post. Meta hands back the right one (feed post or Reel) as
 * `permalink`. Null when the read fails: the caller keeps the media id and
 * shows "Posted" with no link, rather than a guessed address that 404s.
 */
export async function getMediaPermalink(opts: { mediaId: string; accessToken: string }): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${GRAPH_BASE}/${GRAPH_VERSION}/${encodeURIComponent(opts.mediaId)}?fields=permalink&access_token=${encodeURIComponent(opts.accessToken)}`)
    const data = await res.json().catch(() => ({})) as { permalink?: string }
    if (!res.ok || typeof data.permalink !== 'string' || !/^https:\/\/(www\.)?instagram\.com\//i.test(data.permalink)) return null
    return data.permalink
  } catch {
    return null
  }
}

// ─── Messaging: comment → DM (Private Replies) ───────────────────────────────
// The comment→DM mechanic. `recipient.comment_id` is the ONLY way to initiate a
// DM to someone who hasn't messaged first, and you get exactly ONE per comment
// (Meta rule). Requires the instagram_business_manage_messages/_comments
// permissions (Advanced Access via App Review) — see project_ig_comment_to_dm.
// Docs: https://developers.facebook.com/docs/instagram-platform/private-replies/

/** Send a one-time private-reply DM to the author of a comment. Returns Meta's
 *  message/recipient ids. Throws with the raw error on failure so the caller can
 *  log it. `message` is hard-capped to keep well under IG's limit. */
export async function sendPrivateReply(opts: {
  igUserId: string
  commentId: string
  message: string
  accessToken: string
}): Promise<{ recipientId?: string; messageId?: string }> {
  const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${opts.igUserId}/messages?access_token=${encodeURIComponent(opts.accessToken)}`
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { comment_id: opts.commentId },
      message: { text: opts.message.slice(0, 900) },
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`IG private reply failed (${res.status}): ${text.slice(0, 300)}`)
  let data: { recipient_id?: string; message_id?: string } = {}
  try { data = JSON.parse(text) } catch { /* non-JSON success is fine */ }
  return { recipientId: data.recipient_id, messageId: data.message_id }
}

/** Subscribe the connected IG account to the app's `comments` webhook. Required
 *  for comment→DM events to actually fire — and it's the piece a user can't do
 *  manually, so we call it on connect. Best-effort; returns whether it stuck. */
export async function subscribeToComments(opts: { igUserId: string; accessToken: string }): Promise<boolean> {
  return (await subscribeToCommentsWhy(opts)).ok
}

/** The same, with Meta's own words when it refuses. Instagram stopped sending
 *  comments to MVP after Aug 13 and nothing on screen said so: a refused
 *  subscription was a console line nobody read. */
export async function subscribeToCommentsWhy(opts: { igUserId: string; accessToken: string }): Promise<{ ok: boolean; error: string | null }> {
  try {
    const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${opts.igUserId}/subscribed_apps?subscribed_fields=comments&access_token=${encodeURIComponent(opts.accessToken)}`
    const res = await fetchWithTimeout(url, { method: 'POST' })
    const data = await res.json().catch(() => ({})) as { success?: boolean; error?: { message: string } }
    if (!res.ok) {
      console.warn('[instagram] subscribe_apps failed:', data?.error?.message || res.status)
      return { ok: false, error: data?.error?.message || `Instagram said ${res.status}.` }
    }
    return data.success === false ? { ok: false, error: 'Instagram did not confirm the subscription.' } : { ok: true, error: null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Which webhook fields this account is subscribed to for MVP's app, or the
 *  error Instagram gave instead. */
export async function commentSubscription(opts: { igUserId: string; accessToken: string }): Promise<{ fields: string[] | null; error: string | null }> {
  try {
    const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${opts.igUserId}/subscribed_apps?access_token=${encodeURIComponent(opts.accessToken)}`
    const res = await fetchWithTimeout(url)
    const data = await res.json().catch(() => ({})) as { data?: { subscribed_fields?: string[] }[]; error?: { message: string } }
    if (!res.ok || !Array.isArray(data.data)) return { fields: null, error: data?.error?.message || `Instagram said ${res.status}.` }
    return { fields: Array.from(new Set(data.data.flatMap((a) => a.subscribed_fields ?? []))), error: null }
  } catch (e) {
    return { fields: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** The account's professional id (17841...), the one comment webhooks carry,
 *  which is not the app-scoped id the login returns (migration 170). */
export async function fetchIgProfessionalId(accessToken: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${GRAPH_BASE}/${GRAPH_VERSION}/me?fields=user_id,username&access_token=${encodeURIComponent(accessToken)}`)
    const data = await res.json().catch(() => ({})) as { user_id?: string | number }
    const id = String(data?.user_id ?? '').replace(/[^0-9]/g, '')
    return res.ok && id ? id : null
  } catch {
    return null
  }
}

/** The account's recent posts, for picking one to give its own keyword + link. */
export async function listRecentMedia(opts: { igUserId: string; accessToken: string; limit?: number }): Promise<{
  media: { id: string; caption: string; mediaType: string; productType: string; thumb: string | null; permalink: string | null; timestamp: string | null }[]
  error: string | null
}> {
  try {
    const fields = 'id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp'
    // `me`, not the stored id: the account the token belongs to, whichever of
    // its two ids MVP saved (migration 170). An empty list came back on the
    // Auto-DM page with no error, so an empty answer now says how many posts
    // Instagram itself counts, and is never shown as an empty success.
    const limit = Math.min(50, opts.limit ?? 30)
    const res = await fetchWithTimeout(`${GRAPH_BASE}/${GRAPH_VERSION}/me/media?fields=${fields}&limit=${limit}&access_token=${encodeURIComponent(opts.accessToken)}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json().catch(() => ({})) as { data?: any[]; error?: { message: string } }
    if (!res.ok || !Array.isArray(data.data)) return { media: [], error: data?.error?.message || `Instagram said ${res.status}.` }
    if (!data.data.length) {
      const count = await fetchWithTimeout(`${GRAPH_BASE}/${GRAPH_VERSION}/me?fields=username,media_count&access_token=${encodeURIComponent(opts.accessToken)}`)
        .then((r) => r.json()).catch(() => ({})) as { username?: string; media_count?: number }
      const n = typeof count.media_count === 'number' ? count.media_count : null
      return {
        media: [],
        error: n
          ? `Instagram says @${count.username || 'this account'} has ${n} posts but sent back none. Reconnect Instagram and try again.`
          : `Instagram sent back no posts for @${count.username || 'this account'}${n === 0 ? ', and counts none on the account' : ''}.`,
      }
    }
    return {
      media: data.data.map((m) => ({
        id: String(m.id),
        caption: String(m.caption ?? '').slice(0, 300),
        mediaType: String(m.media_type ?? ''),
        productType: String(m.media_product_type ?? ''),
        thumb: (m.thumbnail_url || (m.media_type === 'VIDEO' ? null : m.media_url) || null) as string | null,
        permalink: (m.permalink ?? null) as string | null,
        timestamp: (m.timestamp ?? null) as string | null,
      })),
      error: null,
    }
  } catch (e) {
    return { media: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/** Does this account own the post? A media read with its own token answers it. */
export async function ownsMedia(opts: { mediaId: string; accessToken: string }): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${GRAPH_BASE}/${GRAPH_VERSION}/${encodeURIComponent(opts.mediaId)}?fields=id&access_token=${encodeURIComponent(opts.accessToken)}`)
    return res.ok
  } catch {
    return false
  }
}

/** Post a PUBLIC reply on a comment (e.g. "Sent you a DM! 📩") — what ManyChat
 *  does so other viewers see the automation is live. Best-effort; never throws. */
export async function replyToComment(opts: {
  commentId: string
  message: string
  accessToken: string
}): Promise<boolean> {
  try {
    const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${opts.commentId}/replies?access_token=${encodeURIComponent(opts.accessToken)}`
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: opts.message.slice(0, 280) }),
    })
    return res.ok
  } catch {
    return false
  }
}
