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

  const expiry = Number(data.tiktok_token_expiry || 0)
  if (Date.now() < expiry - 60_000) return data.tiktok_access_token // 60s buffer
  if (!data.tiktok_refresh_token) return data.tiktok_access_token   // try as-is

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
        refresh_token: data.tiktok_refresh_token,
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
    await supabase
      .from('integrations')
      .update({
        tiktok_access_token: t.access_token,
        // TikTok rotates refresh tokens — replace if a new one came back.
        tiktok_refresh_token: t.refresh_token ?? data.tiktok_refresh_token,
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
  const body = {
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

  const res = await fetch(`${TT_BASE}/v2/post/publish/video/init/`, {
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
