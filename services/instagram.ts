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

const GRAPH_BASE = 'https://graph.instagram.com'
const GRAPH_VERSION = 'v22.0'
const OAUTH_BASE = 'https://api.instagram.com/oauth'
const AUTH_BASE = 'https://www.instagram.com/oauth'

const SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
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
  const shortRes = await fetch(`${OAUTH_BASE}/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody.toString(),
  })
  const shortData = await shortRes.json() as {
    access_token?: string
    user_id?: string | number
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
  const longRes = await fetch(longUrl)
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
  const meRes = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/me?fields=id,username&access_token=${encodeURIComponent(longToken)}`)
  const meData = await meRes.json() as { id?: string; username?: string; error?: { message: string } }
  if (!meRes.ok || !meData.id) {
    throw new Error(`Instagram /me failed: ${meData.error?.message || `HTTP ${meRes.status}`}`)
  }

  return {
    accessToken: longToken,
    userId: meData.id,
    username: meData.username ?? '',
    expiresAt,
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
  const res = await fetch(url)
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
 * Create a media container for a Reel or Story.
 * Returns the container id which we then have to poll until processing
 * finishes, before publishing.
 */
export async function createMediaContainer(opts: {
  userId: string
  accessToken: string
  mediaType: 'REELS' | 'STORIES'
  videoUrl: string
  /** Reels only — caption with hashtags. Ignored for Stories. */
  caption?: string
  /** Reels only — also share to feed (recommended for reach). */
  shareToFeed?: boolean
}): Promise<string> {
  const body = new URLSearchParams({
    media_type: opts.mediaType,
    video_url: opts.videoUrl,
    access_token: opts.accessToken,
  })
  if (opts.mediaType === 'REELS') {
    if (opts.caption) body.set('caption', opts.caption.slice(0, 2200))
    if (opts.shareToFeed !== false) body.set('share_to_feed', 'true')
  }

  const res = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/${opts.userId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const data = await res.json() as { id?: string; error?: { message: string } }
  if (!res.ok || !data.id) {
    throw new Error(`Instagram container create failed: ${data.error?.message || `HTTP ${res.status}`}`)
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
    const res = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/${opts.containerId}?fields=status_code,status&access_token=${encodeURIComponent(opts.accessToken)}`)
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
  const res = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/${opts.userId}/media_publish`, {
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

/**
 * High-level helper: create container → wait → publish in one call.
 * Returns the published media id.
 */
export async function publishMedia(opts: {
  userId: string
  accessToken: string
  mediaType: 'REELS' | 'STORIES'
  videoUrl: string
  caption?: string
  shareToFeed?: boolean
}): Promise<string> {
  const containerId = await createMediaContainer(opts)
  await waitForContainer({ containerId, accessToken: opts.accessToken })
  return publishContainer({
    userId: opts.userId,
    accessToken: opts.accessToken,
    containerId,
  })
}
