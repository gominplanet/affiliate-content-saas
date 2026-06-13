/**
 * Helpers for the multi-channel YouTube feature (Pro tier).
 *
 * The youtube_channels table holds one row per connected channel so a Pro user
 * can (a) set a DEFAULT channel per WordPress site, and (b) pull videos from a
 * SECONDARY channel onto the same blog. Mirrors lib/wordpress-sites.ts.
 *
 * READ vs PUSH — important distinction:
 *   - PULLING a channel's uploads (sync) uses the public YOUTUBE_API_KEY + the
 *     channel_id (UC…). No OAuth. So `resolveSyncChannelId` is all most paths
 *     need.
 *   - PUSHING metadata back to YouTube (Co-Pilot apply / update-metadata /
 *     thumbnail) needs that channel's OAuth token → `getChannelOAuthToken`.
 *     A channel may exist with NULL tokens (added pull-only); push returns null
 *     and the caller asks the user to connect that channel.
 *
 * BACKWARDS COMPAT: integrations.youtube_channel_id / youtube_oauth_* stay in
 * place. Every resolver falls back to those legacy columns when youtube_channels
 * is empty for the user, so single-channel users keep working unchanged while
 * Phases 2–4 land.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { maybeDecrypt, maybeEncrypt } from '@/lib/secrets'
import { TIERS, normalizeTier, type Tier } from '@/lib/tier'

// youtube_channels + wordpress_sites.default_youtube_channel_id aren't in the
// generated types yet (Phase 1) — use a loose client so queries compile until
// `supabase gen types` is re-run. Same approach as lib/gsc.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>

/** A connected YouTube channel. Tokens are intentionally NOT exposed here —
 *  use getChannelOAuthToken when you need to push. */
export interface YouTubeChannel {
  /** youtube_channels.id (uuid) — the app-side handle for the connection. */
  id: string
  /** The YouTube channel id (UC…) used to pull uploads. */
  channelId: string
  channelTitle: string
  isDefault: boolean
  /** True when this channel has OAuth tokens stored (can push to YouTube). */
  hasOAuth: boolean
}

interface ChannelRow {
  id: string
  channel_id: string
  channel_title: string | null
  oauth_access_token: string | null
  oauth_refresh_token: string | null
  oauth_token_expiry: number | null
  is_default: boolean
  display_order: number
}

const SELECT = 'id, channel_id, channel_title, oauth_access_token, oauth_refresh_token, oauth_token_expiry, is_default, display_order'

function rowToChannel(r: ChannelRow): YouTubeChannel {
  return {
    id: r.id,
    channelId: r.channel_id,
    channelTitle: r.channel_title || r.channel_id,
    isDefault: r.is_default,
    hasOAuth: !!r.oauth_access_token,
  }
}

/** Per-tier channel cap (Pro = 10, others = 1). Reads from lib/tier.ts. */
export function maxChannelsForTier(tier: Tier): number {
  return TIERS[normalizeTier(tier)].youtubeChannels
}

export async function canAddChannel(
  supabase: Client,
  userId: string,
  tier: Tier,
): Promise<{ allowed: boolean; current: number; cap: number }> {
  const { count } = await supabase
    .from('youtube_channels')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  const current = count ?? 0
  const cap = maxChannelsForTier(tier)
  return { allowed: current < cap, current, cap }
}

/** All connected channels for a user, default first. Falls back to the legacy
 *  integrations.youtube_channel_id as a single synthetic row when the table is
 *  empty (single-channel users pre-migration). */
export async function listYouTubeChannels(
  supabase: Client,
  userId: string,
): Promise<YouTubeChannel[]> {
  const { data } = await supabase
    .from('youtube_channels')
    .select(SELECT)
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (data && data.length) return (data as ChannelRow[]).map(rowToChannel)

  // Legacy bridge — synthesize from integrations.
  const { data: legacy } = await supabase
    .from('integrations')
    .select('youtube_channel_id, youtube_oauth_access_token')
    .eq('user_id', userId)
    .maybeSingle()
  if (legacy?.youtube_channel_id) {
    return [{
      id: 'legacy',
      channelId: legacy.youtube_channel_id,
      channelTitle: legacy.youtube_channel_id,
      isDefault: true,
      hasOAuth: !!legacy.youtube_oauth_access_token,
    }]
  }
  return []
}

/** The user's default channel (or their only one). Null when none connected. */
export async function getDefaultChannel(
  supabase: Client,
  userId: string,
): Promise<YouTubeChannel | null> {
  const { data } = await supabase
    .from('youtube_channels')
    .select(SELECT)
    .eq('user_id', userId)
    .eq('is_default', true)
    .maybeSingle()
  if (data) return rowToChannel(data as ChannelRow)

  const all = await listYouTubeChannels(supabase, userId)
  return all[0] ?? null
}

/** A specific connected channel by its youtube_channels.id (uuid) OR its
 *  YouTube channel_id (UC…). 'default'/'legacy'/null → the default channel. */
export async function getChannel(
  supabase: Client,
  userId: string,
  idOrChannelId?: string | null,
): Promise<YouTubeChannel | null> {
  if (!idOrChannelId || idOrChannelId === 'default' || idOrChannelId === 'legacy') {
    return getDefaultChannel(supabase, userId)
  }
  // Try uuid id first, then the UC… channel_id.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrChannelId)
  const { data } = await supabase
    .from('youtube_channels')
    .select(SELECT)
    .eq('user_id', userId)
    .eq(isUuid ? 'id' : 'channel_id', idOrChannelId)
    .maybeSingle()
  if (data) return rowToChannel(data as ChannelRow)
  // Fall back to the default if the id didn't resolve (e.g. legacy single user).
  return getDefaultChannel(supabase, userId)
}

/** The channel a given WordPress site pulls from by default: the site's
 *  default_youtube_channel_id if set, else the user's default channel. */
export async function getChannelForSite(
  supabase: Client,
  userId: string,
  siteId?: string | null,
): Promise<YouTubeChannel | null> {
  if (siteId && siteId !== 'legacy' && siteId !== 'default') {
    const { data: site } = await supabase
      .from('wordpress_sites')
      .select('default_youtube_channel_id')
      .eq('user_id', userId)
      .eq('id', siteId)
      .maybeSingle()
    const mapped = (site as { default_youtube_channel_id?: string | null } | null)?.default_youtube_channel_id
    if (mapped) {
      const ch = await getChannel(supabase, userId, mapped)
      if (ch) return ch
    }
  }
  return getDefaultChannel(supabase, userId)
}

/** Resolve the YouTube channel_id (UC…) to SYNC for this request.
 *  Precedence: explicit channel pick → the site's default channel → the user's
 *  default channel → legacy integrations.youtube_channel_id. Null = nothing
 *  connected (caller surfaces "connect a channel"). */
export async function resolveSyncChannelId(
  supabase: Client,
  userId: string,
  opts: { channelId?: string | null; siteId?: string | null } = {},
): Promise<string | null> {
  if (opts.channelId) {
    const ch = await getChannel(supabase, userId, opts.channelId)
    if (ch) return ch.channelId
  }
  const forSite = await getChannelForSite(supabase, userId, opts.siteId)
  if (forSite) return forSite.channelId
  // Final legacy fallback.
  const { data: legacy } = await supabase
    .from('integrations')
    .select('youtube_channel_id')
    .eq('user_id', userId)
    .maybeSingle()
  return legacy?.youtube_channel_id || null
}

/** Return a valid OAuth access token for PUSHING to a specific channel,
 *  refreshing if expired. Resolves the channel by uuid id or UC… channel_id.
 *  Null when the channel has no stored OAuth (added pull-only) or refresh
 *  failed — the caller then prompts the user to connect that channel.
 *  Falls back to the legacy integrations.youtube_oauth_* for the default
 *  channel of pre-migration single-channel users. */
export async function getChannelOAuthToken(
  supabase: Client,
  userId: string,
  idOrChannelId?: string | null,
): Promise<string | null> {
  // Resolve the row (with raw tokens) — we need the encrypted columns here, so
  // re-query rather than use the token-free YouTubeChannel shape.
  const isUuid = !!idOrChannelId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrChannelId)
  let row: ChannelRow | null = null

  if (idOrChannelId && idOrChannelId !== 'default' && idOrChannelId !== 'legacy') {
    const { data } = await supabase
      .from('youtube_channels')
      .select(SELECT)
      .eq('user_id', userId)
      .eq(isUuid ? 'id' : 'channel_id', idOrChannelId)
      .maybeSingle()
    row = (data as ChannelRow) ?? null
  }
  if (!row) {
    const { data } = await supabase
      .from('youtube_channels')
      .select(SELECT)
      .eq('user_id', userId)
      .eq('is_default', true)
      .maybeSingle()
    row = (data as ChannelRow) ?? null
  }

  if (row?.oauth_access_token) {
    return refreshGoogleToken(supabase, {
      table: 'youtube_channels',
      idColumn: 'id',
      idValue: row.id,
      access: row.oauth_access_token,
      refresh: row.oauth_refresh_token,
      expiry: row.oauth_token_expiry,
      accessCol: 'oauth_access_token',
      expiryCol: 'oauth_token_expiry',
    })
  }

  // Legacy bridge: single-channel user whose token still lives on integrations.
  const { data: legacy } = await supabase
    .from('integrations')
    .select('youtube_oauth_access_token, youtube_oauth_refresh_token, youtube_oauth_token_expiry')
    .eq('user_id', userId)
    .maybeSingle()
  if (legacy?.youtube_oauth_access_token) {
    return refreshGoogleToken(supabase, {
      table: 'integrations',
      idColumn: 'user_id',
      idValue: userId,
      access: legacy.youtube_oauth_access_token,
      refresh: legacy.youtube_oauth_refresh_token,
      expiry: legacy.youtube_oauth_token_expiry,
      accessCol: 'youtube_oauth_access_token',
      expiryCol: 'youtube_oauth_token_expiry',
    })
  }
  return null
}

/** Set a channel as the user's default (atomic clear-then-set, like sites). */
export async function setDefaultChannel(
  supabase: Client,
  userId: string,
  channelRowId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: clearErr } = await supabase
    .from('youtube_channels')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('is_default', true)
  if (clearErr) return { ok: false, error: clearErr.message }
  const { error } = await supabase
    .from('youtube_channels')
    .update({ is_default: true })
    .eq('user_id', userId)
    .eq('id', channelRowId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ─── internals ───────────────────────────────────────────────────────────────

/** Shared Google OAuth refresh — reuses the same GOOGLE_CLIENT_ID/SECRET app as
 *  GSC + the YouTube connect flow. Decrypts, refreshes if within 60s of expiry,
 *  re-encrypts the new token to the given table/row. Returns a usable token or
 *  null. Generic over table so it serves both youtube_channels and the legacy
 *  integrations row. */
async function refreshGoogleToken(
  supabase: Client,
  o: {
    table: 'youtube_channels' | 'integrations'
    idColumn: 'id' | 'user_id'
    idValue: string
    access: string
    refresh: string | null
    expiry: number | null
    accessCol: string
    expiryCol: string
  },
): Promise<string | null> {
  const accessToken = maybeDecrypt(o.access) || null
  const refreshToken = maybeDecrypt(o.refresh) || null
  if (!accessToken) return null
  if (Date.now() < Number(o.expiry || 0) - 60_000) return accessToken
  if (!refreshToken) return accessToken
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    })
    if (!res.ok) return null
    const t = await res.json() as { access_token: string; expires_in?: number }
    await supabase
      .from(o.table)
      .update({
        [o.accessCol]: maybeEncrypt(t.access_token),
        [o.expiryCol]: Date.now() + (t.expires_in ?? 3600) * 1000,
      })
      .eq(o.idColumn, o.idValue)
    return t.access_token
  } catch {
    return null
  }
}
