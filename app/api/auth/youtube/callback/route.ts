import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&youtube_error=${error || 'no_code'}`)
  }

  // Decode user ID from state
  let userId: string | null = null
  if (state) {
    try { userId = Buffer.from(state, 'base64url').toString('utf-8') } catch { /* ignore */ }
  }
  if (!userId) {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  }
  if (!userId) return NextResponse.redirect(`${appUrl}/login`)

  let step = 'token_exchange'
  try {
    const redirectUri = `${appUrl}/api/auth/youtube/callback`
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
    if (!tokenRes.ok) {
      // Surface Google's real reason (redirect_uri_mismatch,
      // invalid_client, invalid_grant…) instead of a generic failure.
      const raw = await tokenRes.text().catch(() => '')
      let detail = raw
      try { const j = JSON.parse(raw); detail = j.error_description || j.error || raw } catch { /* keep raw */ }
      throw new Error(`Token exchange ${tokenRes.status}: ${String(detail).slice(0, 200)} (redirect_uri=${redirectUri})`)
    }
    const tokens = await tokenRes.json() as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    // Auto-derive the channel ID from the authorized account so the user
    // never has to paste it (2026-06-12 onboarding simplification). The
    // OAuth'd account already knows its own channel — one channels.list
    // call with mine=true returns it. Best-effort: if it fails we still
    // save the tokens (the manual channel-ID field stays as a fallback),
    // so a transient YouTube API hiccup never blocks the connect.
    step = 'fetch_channel_id'
    let channelId: string | null = null
    try {
      const chRes = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      )
      if (chRes.ok) {
        const data = await chRes.json() as { items?: Array<{ id?: string }> }
        channelId = data.items?.[0]?.id ?? null
      }
    } catch { /* leave channelId null — manual field remains the fallback */ }

    step = 'save_token'
    const supabase = await createServerClient()
    // Encrypt OAuth tokens at rest (2026-06-02).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: saveErr } = await supabase.from('integrations').upsert(
      encryptIntegrationWrite({
        user_id: userId,
        youtube_oauth_access_token: tokens.access_token,
        ...(tokens.refresh_token && { youtube_oauth_refresh_token: tokens.refresh_token }),
        youtube_oauth_token_expiry: Date.now() + tokens.expires_in * 1000,
        // Only overwrite the stored channel ID when we actually resolved one,
        // so a failed lookup doesn't clobber a value the user set manually.
        ...(channelId && { youtube_channel_id: channelId }),
      }),
      { onConflict: 'user_id' },
    )
    // Don't report false success — a failed save would leave the
    // "Connect YouTube" banner up with no explanation.
    if (saveErr) throw new Error(saveErr.message || 'token save failed')

    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&youtube_oauth_connected=1`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error(`[youtube callback] ${step} failed:`, msg)
    const detail = encodeURIComponent(`${step}: ${msg}`.slice(0, 300))
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&youtube_error=${detail}`)
  }
}
