import { maybeDecrypt, maybeEncrypt } from '@/lib/secrets'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TikTok client. Wraps:
//   * Token refresh (24h access / 365d refresh)
//   * /v2/post/publish/creator_info/query/  — the LIVE per-creator privacy
//     options + caps the publish UI MUST display fresh on every open
//   * /v2/post/publish/video/init/          — Direct Post (PULL_FROM_URL)
//   * /v2/post/publish/status/fetch/        — poll for processing state
//
// All read/write paths take a Supabase client + userId so they can lazy-
// refresh the access token without the route having to know about expiry.

const TT_BASE = 'https://open.tiktokapis.com'
const TT_TOKEN_URL = `${TT_BASE}/v2/oauth/token/`

/**
 * Direct Post vs Inbox/Draft mode.
 *
 * Direct mode (default): /v2/post/publish/video/init/ — publishes
 * straight to the creator's TikTok feed using the post_info we send.
 * Requires the `video.publish` scope, which TikTok grants only after
 * an explicit audit. We have that audit approved and the scope enabled
 * on the dev-portal app, so direct mode is on.
 *
 * Inbox fallback: /v2/post/publish/inbox/video/init/ — drops the video
 * into the creator's TikTok app drafts, they finalize caption/privacy
 * themselves. Only needs `video.upload`. Flip USE_INBOX_MODE = true if
 * TikTok ever revokes the audit or we need a quick safe-mode.
 */
const USE_INBOX_MODE = false

/** What we mirror back to the dashboard / publish UI from creator_info. */
export interface CreatorInfo {
  username: string
  displayName: string
  avatarUrl: string
  /** Live privacy options TikTok says this creator can pick from. The
   *  publish UI MUST render these as the dropdown options with NO default
   *  selected — that's a TikTok app-review hard requirement. */
  privacyLevelOptions: Array<'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY' | 'FOLLOWER_OF_CREATOR'>
  /** Per-creator caps from TikTok. Used to pre-empt "video too long" errors. */
  maxVideoDurationSec: number
  /** Whether comment/duet/stitch toggles are even available — some
   *  creator accounts have these globally disabled. */
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
}

export interface DirectPostOptions {
  title: string                        // Caption (up to 2200 chars)
  privacyLevel: CreatorInfo['privacyLevelOptions'][number]
  disableComment: boolean
  disableDuet: boolean
  disableStitch: boolean
  brandContentToggle: boolean          // "this post is branded content"
  brandOrganicToggle: boolean          // "promoting your own brand"
  videoUrl: string                     // Public HTTPS URL TikTok will pull from
}

export interface DirectPostResult {
  publishId: string
}

export type PublishStatus =
  | 'PROCESSING_DOWNLOAD'              // TikTok pulling the file from our CDN
  | 'PROCESSING_UPLOAD'                // Internal processing
  | 'PUBLISH_COMPLETE'                 // Video is live
  | 'SEND_TO_USER_INBOX'               // Landed in the creator's TikTok app inbox/drafts; sandbox often routes here
  | 'FAILED'                           // Hard failure
  | 'UNKNOWN'

export interface PublishStatusResult {
  status: PublishStatus
  rawStatus: string                    // Raw TikTok status for debugging
  publicShareUrl: string | null        // Filled on PUBLISH_COMPLETE
  failureReason: string | null
}

/**
 * Return a valid TikTok access token for the user, refreshing it if
 * within 60s of expiry. Null when the user hasn't connected TikTok (or
 * the refresh failed — caller surfaces "Reconnect TikTok").
 */
export async function getValidTikTokToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('integrations')
    .select('tiktok_access_token,tiktok_refresh_token,tiktok_token_expiry')
    .eq('user_id', userId)
    .single()
  if (!data?.tiktok_access_token) return null

  // Decrypt tokens at rest (2026-06-02 rollout). maybeDecrypt is a
  // no-op on legacy plaintext rows.
  const accessToken = maybeDecrypt(data.tiktok_access_token) || null
  const refreshToken = maybeDecrypt(data.tiktok_refresh_token) || null
  if (!accessToken) return null

  const expiry = Number(data.tiktok_token_expiry || 0)
  if (Date.now() < expiry - 60_000) return accessToken // 60s buffer
  if (!refreshToken) return accessToken                  // try as-is

  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET
  if (!clientKey || !clientSecret) return null

  try {
    const res = await fetch(TT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    })
    if (!res.ok) return null
    const t = await res.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      refresh_expires_in?: number
    }
    if (!t.access_token) return null
    const now = Date.now()
    // Encrypt refreshed tokens at rest (2026-06-02).
    await supabase
      .from('integrations')
      .update({
        tiktok_access_token: maybeEncrypt(t.access_token),
        // TikTok rotates refresh tokens — replace if a new one came back.
        tiktok_refresh_token: maybeEncrypt(t.refresh_token ?? refreshToken),
        tiktok_token_expiry: now + (t.expires_in ?? 86400) * 1000,
        tiktok_refresh_expiry: t.refresh_expires_in
          ? now + t.refresh_expires_in * 1000
          : undefined,
      })
      .eq('user_id', userId)
    return t.access_token
  } catch {
    return null
  }
}

/**
 * Fetch the creator's allowed privacy options + duration caps + comment/
 * duet/stitch availability LIVE from TikTok. The publish UI MUST call
 * this every time it opens — TikTok's reviewer will reject apps that
 * hardcode the dropdown values.
 *
 * Endpoint: POST /v2/post/publish/creator_info/query/
 * Empty body. Auth: Bearer token.
 */
export async function queryCreatorInfo(token: string): Promise<CreatorInfo | null> {
  try {
    const res = await fetch(`${TT_BASE}/v2/post/publish/creator_info/query/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await res.json() as any
    const d = json?.data
    if (!d) return null
    return {
      username: d.creator_username ?? '',
      displayName: d.creator_nickname ?? '',
      avatarUrl: d.creator_avatar_url ?? '',
      privacyLevelOptions: Array.isArray(d.privacy_level_options) ? d.privacy_level_options : [],
      maxVideoDurationSec: typeof d.max_video_post_duration_sec === 'number'
        ? d.max_video_post_duration_sec
        : 300,
      commentDisabled: !!d.comment_disabled,
      duetDisabled: !!d.duet_disabled,
      stitchDisabled: !!d.stitch_disabled,
    }
  } catch {
    return null
  }
}

/**
 * Direct Post a video using PULL_FROM_URL. TikTok will GET the videoUrl
 * from our CDN and process it. Returns the publishId for status polling.
 *
 * IMPORTANT: the URL must be HTTPS and the domain must be verified in
 * the TikTok app config (Content Posting API → Verify domains). For MVP
 * that's mvpaffiliate.io — verified in the developer portal.
 *
 * Spec: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 */
export async function directPostVideo(
  token: string,
  opts: DirectPostOptions,
): Promise<DirectPostResult> {
  // Inbox mode (the default until video.publish is approved): TikTok
  // ignores post_info entirely and the creator picks caption + privacy
  // in the TikTok app's drafts inbox. Direct mode: TikTok publishes
  // straight to feed using the post_info we provide.
  const body = USE_INBOX_MODE
    ? {
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: opts.videoUrl,
        },
      }
    : {
        post_info: {
          title: opts.title.slice(0, 2200),
          privacy_level: opts.privacyLevel,
          disable_comment: opts.disableComment,
          disable_duet: opts.disableDuet,
          disable_stitch: opts.disableStitch,
          brand_content_toggle: opts.brandContentToggle,
          brand_organic_toggle: opts.brandOrganicToggle,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: opts.videoUrl,
        },
      }

  const endpoint = USE_INBOX_MODE
    ? `${TT_BASE}/v2/post/publish/inbox/video/init/`
    : `${TT_BASE}/v2/post/publish/video/init/`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await res.json().catch(() => ({})) as any
  if (!res.ok || json?.error?.code !== 'ok') {
    const code = json?.error?.code ?? `http_${res.status}`
    const msg = json?.error?.message ?? `TikTok returned ${res.status}`
    throw new Error(`TikTok publish failed (${code}): ${msg}`)
  }
  const publishId = json?.data?.publish_id as string | undefined
  if (!publishId) throw new Error('TikTok did not return a publish_id.')
  return { publishId }
}

/**
 * Direct Post a video using FILE_UPLOAD. We fetch the bytes from our
 * upstream (Supabase Storage) server-side, ask TikTok for an upload
 * slot, then PUT the bytes to the upload_url TikTok hands back.
 *
 * Why this replaces PULL_FROM_URL as the production path:
 *   - PULL_FROM_URL silently fails with `video_pull_failed` for some
 *     accounts/sandbox states even with a verified domain. TikTok
 *     pre-rejects the URL before our proxy is ever hit.
 *   - FILE_UPLOAD has no URL-side validation surface — TikTok just
 *     receives bytes on a one-time upload URL THEY hand us. No domain
 *     verification, no CDN pull queue, no pre-check failures.
 *
 * Single-chunk upload: TikTok requires chunk_size >= 5MB on multi-chunk
 * uploads BUT permits the final chunk to be smaller, and with
 * total_chunk_count=1 the only chunk is also the final one — so a
 * 4.8MB video uploads fine as one chunk.
 *
 * Spec: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 */
export async function directPostVideoUpload(
  token: string,
  opts: Omit<DirectPostOptions, 'videoUrl'> & { upstreamUrl: string },
): Promise<DirectPostResult> {
  // ── 1. Pull the video bytes from our upstream (Supabase Storage) ────────
  let bytes: ArrayBuffer
  let contentType = 'video/mp4'
  try {
    const upstream = await fetch(opts.upstreamUrl, { signal: AbortSignal.timeout(60_000) })
    if (!upstream.ok) throw new Error(`Upstream returned ${upstream.status}`)
    contentType = upstream.headers.get('content-type') || 'video/mp4'
    bytes = await upstream.arrayBuffer()
  } catch (e) {
    throw new Error(`Could not fetch video bytes from upstream: ${e instanceof Error ? e.message : 'unknown'}`)
  }
  const videoSize = bytes.byteLength
  if (videoSize < 200_000) {
    throw new Error(`Video too small for TikTok (${videoSize} bytes; min is 200 KB).`)
  }
  if (videoSize > 256 * 1024 * 1024) {
    throw new Error(`Video too large for FILE_UPLOAD (${videoSize} bytes; max we support is 256 MB).`)
  }

  // ── 2. Init with FILE_UPLOAD source — get back publish_id + upload_url ─
  // See note above directPostVideo() — inbox mode drops post_info and
  // routes to the inbox endpoint until video.publish audit clears.
  const initBody = USE_INBOX_MODE
    ? {
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: videoSize,
          total_chunk_count: 1,
        },
      }
    : {
        post_info: {
          title: opts.title.slice(0, 2200),
          privacy_level: opts.privacyLevel,
          disable_comment: opts.disableComment,
          disable_duet: opts.disableDuet,
          disable_stitch: opts.disableStitch,
          brand_content_toggle: opts.brandContentToggle,
          brand_organic_toggle: opts.brandOrganicToggle,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: videoSize,
          total_chunk_count: 1,
        },
      }
  const initEndpoint = USE_INBOX_MODE
    ? `${TT_BASE}/v2/post/publish/inbox/video/init/`
    : `${TT_BASE}/v2/post/publish/video/init/`
  const initRes = await fetch(initEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(initBody),
    signal: AbortSignal.timeout(20_000),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initJson = await initRes.json().catch(() => ({})) as any
  if (!initRes.ok || initJson?.error?.code !== 'ok') {
    const code = initJson?.error?.code ?? `http_${initRes.status}`
    const msg = initJson?.error?.message ?? `TikTok returned ${initRes.status}`
    throw new Error(`TikTok upload-init failed (${code}): ${msg}`)
  }
  const publishId = initJson?.data?.publish_id as string | undefined
  const uploadUrl = initJson?.data?.upload_url as string | undefined
  if (!publishId || !uploadUrl) {
    throw new Error('TikTok upload-init did not return publish_id + upload_url.')
  }

  // ── 3. PUT the bytes to the upload_url (single-chunk) ───────────────────
  // TikTok requires Content-Range even for single-chunk uploads.
  // eslint-disable-next-line no-console
  console.log(`[tiktok-upload] PUT ${videoSize} bytes to upload_url (publishId=${publishId})`)
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(videoSize),
      'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
    },
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  })
  if (!uploadRes.ok && uploadRes.status !== 201) {
    const errText = await uploadRes.text().catch(() => '')
    throw new Error(`TikTok upload PUT failed (${uploadRes.status}): ${errText.slice(0, 200)}`)
  }
  // eslint-disable-next-line no-console
  console.log(`[tiktok-upload] PUT done status=${uploadRes.status} publishId=${publishId}`)

  return { publishId }
}

/**
 * Poll the status of a publish_id. TikTok takes minutes to process even
 * after init returns 200 — the publish screen calls this every ~5s until
 * we hit PUBLISH_COMPLETE or FAILED.
 *
 * Endpoint: POST /v2/post/publish/status/fetch/
 */
export async function pollPublishStatus(
  token: string,
  publishId: string,
): Promise<PublishStatusResult> {
  const res = await fetch(`${TT_BASE}/v2/post/publish/status/fetch/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ publish_id: publishId }),
    signal: AbortSignal.timeout(10_000),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await res.json().catch(() => ({})) as any
  const raw = (json?.data?.status as string) || 'UNKNOWN'
  const url = (json?.data?.publicaly_available_post_id?.[0] || json?.data?.public_share_url || null) as string | null
  // TikTok's `fail_reason` field returns a human-ish string on failure.
  const failureReason = (json?.data?.fail_reason as string) || (json?.error?.message as string) || null

  let status: PublishStatus = 'UNKNOWN'
  if (raw === 'PROCESSING_DOWNLOAD' || raw === 'DOWNLOAD_IN_PROGRESS') status = 'PROCESSING_DOWNLOAD'
  else if (raw === 'PROCESSING_UPLOAD' || raw === 'PROCESSING') status = 'PROCESSING_UPLOAD'
  else if (raw === 'PUBLISH_COMPLETE' || raw === 'PUBLISHED') status = 'PUBLISH_COMPLETE'
  else if (raw === 'SEND_TO_USER_INBOX') status = 'SEND_TO_USER_INBOX'
  else if (raw === 'FAILED' || raw === 'PUBLISH_FAILED') status = 'FAILED'

  return {
    status,
    rawStatus: raw,
    publicShareUrl: url,
    failureReason,
  }
}

/** Quick boolean check: does the cached scope string include video.publish?
 *  Used by the publish route to fail-fast with "reconnect to grant the
 *  publish scope" instead of letting TikTok 403. */
export function scopesIncludePublish(scopeStr: string | null | undefined): boolean {
  if (!scopeStr) return false
  return scopeStr.split(/[\s,]+/).some(s => s === 'video.publish')
}
