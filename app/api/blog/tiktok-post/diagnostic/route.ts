/**
 * GET /api/blog/tiktok-post/diagnostic?videoId=<optional>
 *
 * "Sure-fire" TikTok publishing diagnostic. Returns the RAW JSON from
 * every relevant TikTok API plus the local DB state for this user's
 * TikTok integration — so we can finally see what TikTok is actually
 * saying instead of guessing through our normalizers.
 *
 * Pulls:
 *   1. DB: integrations row (tokens, scopes, expiry, open_id, username)
 *   2. TikTok: GET /v2/user/info/  — confirms the token still works
 *   3. TikTok: POST /v2/post/publish/creator_info/query/ — raw creator caps
 *   4. DB: every youtube_videos row this user has with a tiktok_publish_id
 *   5. TikTok: POST /v2/post/publish/status/fetch/ on every stuck publish_id
 *      (with the full raw response — no normalization)
 *
 * Designed to be the first thing I look at when TikTok publishes get stuck.
 * Returns no secrets (we redact access/refresh tokens; just show prefix +
 * suffix so we know it's the right one).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getValidTikTokToken } from '@/services/tiktok'

const TT_BASE = 'https://open.tiktokapis.com'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) {
    return NextResponse.json({
      ok: false,
      stage: 'auth',
      error: userErr?.message || 'Not logged in.',
    }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const requestedVideoId = (searchParams.get('videoId') || '').trim() || null

  // ── 1. Pull the integrations row (tokens, scopes, ids) ───────────────────
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await (admin as any)
    .from('integrations')
    .select('tiktok_open_id, tiktok_username, tiktok_display_name, tiktok_access_token, tiktok_refresh_token, tiktok_token_expiry, tiktok_refresh_expiry, tiktok_scopes')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!integ?.tiktok_access_token) {
    return NextResponse.json({
      ok: false,
      stage: 'connection',
      error: 'No TikTok connection on this account. Connect TikTok in Integrations first.',
    })
  }

  const integration = {
    openId: integ.tiktok_open_id,
    username: integ.tiktok_username,
    displayName: integ.tiktok_display_name,
    scopesGranted: integ.tiktok_scopes,
    scopesIncludePublish: /video\.publish/.test(integ.tiktok_scopes || ''),
    accessTokenPreview: redact(integ.tiktok_access_token),
    refreshTokenPreview: redact(integ.tiktok_refresh_token),
    accessTokenExpiry: integ.tiktok_token_expiry
      ? new Date(Number(integ.tiktok_token_expiry)).toISOString()
      : null,
    accessTokenExpired: integ.tiktok_token_expiry
      ? Date.now() > Number(integ.tiktok_token_expiry)
      : true,
    refreshTokenExpiry: integ.tiktok_refresh_expiry
      ? new Date(Number(integ.tiktok_refresh_expiry)).toISOString()
      : null,
  }

  // Refresh if needed via existing helper (handles 60s buffer, rotation).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = await getValidTikTokToken(admin as any, user.id)
  if (!token) {
    return NextResponse.json({
      ok: false,
      stage: 'token_refresh',
      error: 'Token refresh failed — refresh_token likely expired. Disconnect + reconnect TikTok.',
      integration,
    })
  }

  // ── 2. Hit TikTok /v2/user/info/ to confirm the token actually works ────
  const userInfoFields = 'open_id,union_id,avatar_url,display_name,username,is_verified,follower_count'
  const userInfoRes = await safeFetch(
    `${TT_BASE}/v2/user/info/?fields=${encodeURIComponent(userInfoFields)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  // ── 3. Raw creator_info — privacy options + caps + comment/duet/stitch ──
  const creatorInfoRes = await safeFetch(
    `${TT_BASE}/v2/post/publish/creator_info/query/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
    },
  )

  // ── 4. Pull every youtube_videos with a tiktok_publish_id ───────────────
  let videosQuery = (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (k: string, v: string) => {
          not: (k: string, op: string, v: null) => { order: (k: string, opts: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null }> } }
          order: (k: string, opts: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null }> }
        }
      }
    }
  })
    .from('youtube_videos')
    .select('id, title, tiktok_publish_id, tiktok_publish_status, tiktok_share_url, tiktok_error_message, tiktok_posted_at, instagram_video_url')
    .eq('user_id', user.id)

  let stuckVideos: Array<{ id: string; title?: string; tiktok_publish_id?: string; tiktok_publish_status?: string; tiktok_share_url?: string | null; tiktok_error_message?: string | null; tiktok_posted_at?: string; instagram_video_url?: string }>
  if (requestedVideoId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('youtube_videos')
      .select('id, title, tiktok_publish_id, tiktok_publish_status, tiktok_share_url, tiktok_error_message, tiktok_posted_at, instagram_video_url')
      .eq('user_id', user.id)
      .eq('id', requestedVideoId)
      .limit(1)
    stuckVideos = (data || []) as typeof stuckVideos
  } else {
    const { data } = await videosQuery
      .not('tiktok_publish_id', 'is', null)
      .order('tiktok_posted_at', { ascending: false })
      .limit(5) as { data: typeof stuckVideos | null }
    stuckVideos = data || []
  }

  // ── 5. For each publish_id, hit /v2/post/publish/status/fetch/ raw ──────
  const liveStatuses = await Promise.all(
    stuckVideos
      .filter(v => v.tiktok_publish_id)
      .map(async v => {
        const res = await safeFetch(
          `${TT_BASE}/v2/post/publish/status/fetch/`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json; charset=UTF-8',
            },
            body: JSON.stringify({ publish_id: v.tiktok_publish_id }),
          },
        )
        return {
          videoId: v.id,
          videoTitle: v.title,
          publish_id: v.tiktok_publish_id,
          db: {
            status: v.tiktok_publish_status,
            error: v.tiktok_error_message,
            posted_at: v.tiktok_posted_at,
            share_url: v.tiktok_share_url,
            video_url_on_supabase: v.instagram_video_url,
          },
          tiktok_live: res,
        }
      }),
  )

  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email },
    integration,
    tiktok_user_info_raw: userInfoRes,
    creator_info_raw: creatorInfoRes,
    stuck_publishes: liveStatuses,
    interpretation: interpret(integration, userInfoRes, creatorInfoRes, liveStatuses),
  })
}

interface FetchResult {
  http_status: number
  json: unknown
  text_snippet?: string
  fetch_error?: string
}

async function safeFetch(url: string, init?: RequestInit): Promise<FetchResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) })
    const text = await res.text()
    let json: unknown
    try { json = JSON.parse(text) } catch { json = null }
    return {
      http_status: res.status,
      json,
      text_snippet: json ? undefined : text.slice(0, 300),
    }
  } catch (e) {
    return {
      http_status: 0,
      json: null,
      fetch_error: e instanceof Error ? e.message : 'unknown fetch error',
    }
  }
}

function redact(s: string | null | undefined): string {
  if (!s) return ''
  if (s.length < 12) return '<short>'
  return `${s.slice(0, 6)}…${s.slice(-4)} (len ${s.length})`
}

function interpret(
  integration: { scopesIncludePublish: boolean; accessTokenExpired: boolean },
  userInfo: FetchResult,
  creatorInfo: FetchResult,
  publishes: Array<{ db: { status?: string }; tiktok_live: FetchResult }>,
): string[] {
  const notes: string[] = []

  if (!integration.scopesIncludePublish) {
    notes.push('🚨 video.publish scope NOT in granted scopes — disconnect + reconnect TikTok to re-authorize with publish permission.')
  }
  if (integration.accessTokenExpired) {
    notes.push('⚠️ access_token shows as expired in our DB; the diagnostic refreshed automatically. If the refresh succeeded, this is fine.')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uiJson = userInfo.json as any
  if (userInfo.http_status === 401 || uiJson?.error?.code === 'access_token_invalid') {
    notes.push('🚨 TikTok rejected our access token (401 / access_token_invalid). Refresh probably failed. Reconnect required.')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ciJson = creatorInfo.json as any
  if (creatorInfo.http_status !== 200 || ciJson?.error?.code !== 'ok') {
    notes.push(`🚨 creator_info call failed: code=${ciJson?.error?.code || 'http_' + creatorInfo.http_status} msg=${ciJson?.error?.message || '?'}`)
  } else {
    const privacyOptions = ciJson?.data?.privacy_level_options
    if (Array.isArray(privacyOptions) && privacyOptions.length === 1 && privacyOptions[0] === 'SELF_ONLY') {
      notes.push('ℹ️ Sandbox-only privacy detected: privacy_level_options = [SELF_ONLY]. Posts will land on the user\'s TikTok app as private/inbox only — not on the public TikTok feed. This is expected for unaudited apps.')
    }
    if (ciJson?.data?.max_video_post_duration_sec) {
      notes.push(`ℹ️ Max video duration allowed for this creator: ${ciJson.data.max_video_post_duration_sec}s`)
    }
  }

  for (const p of publishes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const live = p.tiktok_live.json as any
    const status = live?.data?.status
    const failReason = live?.data?.fail_reason
    const uploadedBytes = live?.data?.uploaded_bytes
    if (status === 'PROCESSING_DOWNLOAD' && (uploadedBytes === 0 || uploadedBytes === undefined)) {
      notes.push(`🚨 Publish ${p.tiktok_live ? '(see raw)' : ''}: status=PROCESSING_DOWNLOAD with uploaded_bytes=${uploadedBytes ?? 'undefined'}. TikTok\'s downloader is not pulling our URL. Switch this publish to FILE_UPLOAD (we push bytes to TikTok directly) — PULL_FROM_URL is silently broken for this account.`)
    }
    if (status === 'FAILED' && failReason) {
      notes.push(`🚨 Publish FAILED: fail_reason="${failReason}"`)
    }
  }

  if (notes.length === 0) {
    notes.push('✅ Nothing obviously wrong. Connection healthy, scopes good, creator_info OK, no stuck publishes flagged.')
  }
  return notes
}
