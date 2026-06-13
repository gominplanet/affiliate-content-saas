/**
 * GET /api/auth/tiktok/callback
 *
 * TikTok redirects here after the creator authorizes (or denies) MVP.
 *
 * Successful flow:
 *   1. Validate state matches the current Supabase session user
 *   2. Exchange the authorization `code` for access + refresh tokens via
 *      POST https://open.tiktokapis.com/v2/oauth/token/
 *   3. Pull the creator's basic profile (open_id, username, display name,
 *      avatar) so the settings UI can show "Connected as @handle"
 *   4. Persist tokens + identity on integrations
 *   5. Redirect back to /connect-socials?tiktok_connected=1
 *
 * Failure modes surface as `?tiktok_error=` query params; the Settings
 * page renders human-readable banners for each.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

interface TikTokTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number          // seconds (24h normally)
  refresh_expires_in?: number  // seconds (365d normally)
  scope?: string
  open_id?: string
  token_type?: string
  error?: string
  error_description?: string
  log_id?: string
}

interface TikTokUserInfoResponse {
  data?: {
    user?: {
      open_id?: string
      union_id?: string
      avatar_url?: string
      display_name?: string
      username?: string
    }
  }
  error?: { code?: string; message?: string; log_id?: string }
}

export async function GET(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const redirect = (params: string) =>
    NextResponse.redirect(`${appUrl}/connect-socials?${params}`)

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')
  const errorDesc = searchParams.get('error_description')

  // ── Creator cancelled / TikTok declined ─────────────────────────────────
  if (errorParam) {
    const msg = errorDesc || errorParam
    return redirect(`tiktok_error=${encodeURIComponent(msg)}`)
  }
  if (!code || !state) {
    return redirect(`tiktok_error=${encodeURIComponent('Missing code or state from TikTok.')}`)
  }

  // ── CSRF: state must match current session user ─────────────────────────
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)
  if (state !== user.id) {
    return redirect(`tiktok_error=${encodeURIComponent('Session changed mid-OAuth. Try again.')}`)
  }

  // ── Exchange code for tokens ────────────────────────────────────────────
  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET
  if (!clientKey || !clientSecret) {
    return redirect(`tiktok_error=${encodeURIComponent('Server not configured.')}`)
  }

  let tokens: TikTokTokenResponse
  try {
    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${appUrl}/api/auth/tiktok/callback`,
      }).toString(),
    })
    tokens = await res.json() as TikTokTokenResponse
    if (!res.ok || tokens.error || !tokens.access_token) {
      const msg = tokens.error_description || tokens.error || `TikTok returned ${res.status}`
      return redirect(`tiktok_error=${encodeURIComponent(msg)}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Token exchange failed.'
    return redirect(`tiktok_error=${encodeURIComponent(msg)}`)
  }

  // ── Pull the creator's basic profile ────────────────────────────────────
  // open_id ships back in the token response, but username + avatar live
  // on /v2/user/info/. We fetch both so the dashboard can render a nice
  // "Connected as @handle" pill with the creator's avatar.
  let username = ''
  let displayName = ''
  let avatarUrl = ''
  try {
    const infoRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,display_name,avatar_url',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    )
    const info = await infoRes.json() as TikTokUserInfoResponse
    const u = info?.data?.user
    if (u) {
      username = u.username || ''
      displayName = u.display_name || ''
      avatarUrl = u.avatar_url || ''
    }
  } catch { /* non-fatal — we still have the token and open_id */ }

  // ── Persist on integrations ─────────────────────────────────────────────
  const now = Date.now()
  const tokenExpiry = now + (tokens.expires_in ?? 86400) * 1000          // 24h fallback
  const refreshExpiry = now + (tokens.refresh_expires_in ?? 31536000) * 1000 // 365d fallback

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upsertErr } = await supabase
    .from('integrations')
    .upsert(
      {
        user_id: user.id,
        tiktok_open_id: tokens.open_id ?? null,
        tiktok_username: username || null,
        tiktok_display_name: displayName || null,
        tiktok_avatar_url: avatarUrl || null,
        tiktok_access_token: tokens.access_token,
        tiktok_refresh_token: tokens.refresh_token ?? null,
        tiktok_token_expiry: tokenExpiry,
        tiktok_refresh_expiry: refreshExpiry,
        tiktok_scopes: tokens.scope ?? null,
      },
      { onConflict: 'user_id' },
    )

  if (upsertErr) {
    return redirect(`tiktok_error=${encodeURIComponent(`Couldn't save TikTok tokens: ${upsertErr.message}`)}`)
  }

  return redirect(`tiktok_connected=1`)
}
