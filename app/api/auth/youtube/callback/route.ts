import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'
import { maybeEncrypt } from '@/lib/secrets'
import { normalizeTier } from '@/lib/tier'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  // Decode state up front so BOTH the error and success paths can route back to
  // wherever the flow began (e.g. the onboarding funnel) instead of always
  // dumping the user on /setup. New format is JSON { uid, rt }; legacy callers
  // sent the bare uid string.
  let userId: string | null = null
  let returnTo = ''
  if (state) {
    try {
      const decoded = Buffer.from(state, 'base64url').toString('utf-8')
      if (decoded.startsWith('{')) {
        const parsed = JSON.parse(decoded) as { uid?: string; rt?: string }
        userId = typeof parsed.uid === 'string' ? parsed.uid : null
        // Re-validate the return path on the way out too (defence in depth
        // against a tampered state): same-origin relative only.
        if (typeof parsed.rt === 'string' && /^\/(?!\/)/.test(parsed.rt)) returnTo = parsed.rt
      } else {
        userId = decoded
      }
    } catch { /* ignore — fall back to session below */ }
  }

  // Build a redirect that returns to the funnel (returnTo) when present, else
  // the existing /setup destination. Appends the marker query param correctly
  // whether or not the path already has a query string.
  const dest = (params: string) =>
    returnTo
      ? `${appUrl}${returnTo}${returnTo.includes('?') ? '&' : '?'}${params}`
      : `${appUrl}/connect-youtube?${params}`

  if (error || !code) {
    return NextResponse.redirect(dest(`youtube_error=${encodeURIComponent(error || 'no_code')}`))
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
    let channelTitle: string | null = null
    try {
      const chRes = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      )
      if (chRes.ok) {
        const data = await chRes.json() as { items?: Array<{ id?: string; snippet?: { title?: string } }> }
        channelId = data.items?.[0]?.id ?? null
        channelTitle = data.items?.[0]?.snippet?.title ?? null
      }
    } catch { /* leave channelId null — manual field remains the fallback */ }

    step = 'save_token'
    const supabase = await createServerClient()
    const expiry = Date.now() + tokens.expires_in * 1000

    // Helper: write the OAuth tokens (and channel id when resolved) to the
    // legacy integrations singleton. This stays the source of truth for the
    // DEFAULT channel until Phase 3 reads everything via youtube_channels.
    const writeIntegrations = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: saveErr } = await supabase.from('integrations').upsert(
        encryptIntegrationWrite({
          user_id: userId,
          youtube_oauth_access_token: tokens.access_token,
          ...(tokens.refresh_token && { youtube_oauth_refresh_token: tokens.refresh_token }),
          youtube_oauth_token_expiry: expiry,
          ...(channelId && { youtube_channel_id: channelId }),
        }),
        { onConflict: 'user_id' },
      )
      if (saveErr) throw new Error(saveErr.message || 'token save failed')
    }

    if (!channelId) {
      // Couldn't identify the channel — legacy save only (the manual
      // channel-ID field on /connect-youtube remains the fallback).
      await writeIntegrations()
      return NextResponse.redirect(dest('youtube_oauth_connected=1'))
    }

    // ── Multi-channel (migration 127) ──────────────────────────────────────
    // Record this channel in youtube_channels so a Pro user can run several
    // channels (a default per WP site + pull from others). Re-connecting an
    // existing channel just refreshes its tokens; a brand-new channel beyond
    // the first is gated to Pro.
    step = 'save_channel'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: existing } = await sb
      .from('youtube_channels')
      .select('id, is_default')
      .eq('user_id', userId)
      .eq('channel_id', channelId)
      .maybeSingle()
    const { count } = await sb
      .from('youtube_channels')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    const total = (count as number | null) ?? 0

    if (existing) {
      // Re-connect / token refresh — update tokens + title, keep is_default.
      await sb.from('youtube_channels').update({
        oauth_access_token: maybeEncrypt(tokens.access_token),
        ...(tokens.refresh_token ? { oauth_refresh_token: maybeEncrypt(tokens.refresh_token) } : {}),
        oauth_token_expiry: expiry,
        ...(channelTitle ? { channel_title: channelTitle } : {}),
      }).eq('id', existing.id)
    } else {
      // New channel. The FIRST channel is free for everyone (it's their main
      // account); additional channels are a Pro feature.
      if (total >= 1) {
        const { data: intRow } = await sb.from('integrations').select('tier').eq('user_id', userId).maybeSingle()
        const tier = normalizeTier((intRow as { tier?: string } | null)?.tier)
        if (tier !== 'pro' && tier !== 'admin') {
          return NextResponse.redirect(dest('youtube_error=multi_channel_is_pro'))
        }
      }
      await sb.from('youtube_channels').insert({
        user_id: userId,
        channel_id: channelId,
        channel_title: channelTitle,
        oauth_access_token: maybeEncrypt(tokens.access_token),
        oauth_refresh_token: tokens.refresh_token ? maybeEncrypt(tokens.refresh_token) : null,
        oauth_token_expiry: expiry,
        is_default: total === 0, // the first channel becomes the default
        display_order: total,
      })
    }

    // Keep the legacy integrations singleton in sync ONLY for the DEFAULT
    // channel, so connecting an ADDITIONAL channel never hijacks the existing
    // default (or its push token) before the Phase-3 picker lands.
    const isDefaultChannel = existing ? existing.is_default : total === 0
    if (isDefaultChannel) await writeIntegrations()

    return NextResponse.redirect(dest('youtube_oauth_connected=1'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error(`[youtube callback] ${step} failed:`, msg)
    const detail = encodeURIComponent(`${step}: ${msg}`.slice(0, 300))
    return NextResponse.redirect(dest(`youtube_error=${detail}`))
  }
}
