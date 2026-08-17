// Proactive connection-health probing for the two platforms that die SILENTLY
// with a false "connected" green: Facebook (page token Meta invalidates) and
// YouTube (OAuth token Google revokes). The reactive dead-channel system
// (lib/channel-health) only trips after N failed scheduled posts; this probes
// the REAL tokens so a dead connection is flagged the moment it dies — before it
// costs the creator posts (or the subscription).
//
// A connection is only ever marked `dead` on a genuine AUTH failure (FB code 190
// / OAuthException; YT invalid_grant). Transient/network failures are NEVER a
// reconnect signal — telling a creator to reconnect over a blip is worse than
// staying quiet.

import { maybeDecrypt } from '@/lib/secrets'
import { verifyPageToken } from '@/services/facebook'
import { classifyYouTubeRefresh } from '@/services/youtube'

export interface HealthEntry {
  ok: boolean
  dead: boolean
  reason?: string
  checkedAt: number
}
export type ConnectionHealth = Partial<Record<'facebook' | 'youtube', HealthEntry>>

// Re-probe at most this often on the lazy (dashboard) path — the daily cron
// keeps everyone fresh regardless; this just avoids a Graph/Google round-trip on
// every single dashboard load.
export const PROBE_FRESH_MS = 6 * 60 * 60 * 1000 // 6h

// The integrations columns a probe needs (encrypted token columns + plaintext
// page id). Kept loose so both the server client and the admin client can pass
// a raw row.
export interface ProbeRow {
  facebook_page_id?: string | null
  facebook_page_access_token?: string | null
  youtube_oauth_refresh_token?: string | null
  youtube_oauth_access_token?: string | null
  connection_health?: ConnectionHealth | null
  connection_health_at?: string | null
}

/** True when a stored probe is recent enough to reuse instead of re-hitting the API. */
export function isHealthFresh(checkedAt: string | null | undefined, now = Date.now()): boolean {
  if (!checkedAt) return false
  const t = new Date(checkedAt).getTime()
  return Number.isFinite(t) && now - t < PROBE_FRESH_MS
}

async function probeFacebook(row: ProbeRow): Promise<HealthEntry | null> {
  const pageId = (row.facebook_page_id || '').trim()
  const token = maybeDecrypt(row.facebook_page_access_token || undefined) || ''
  if (!pageId || !token) return null // not connected — nothing to probe
  const v = await verifyPageToken(token, pageId)
  // Only an auth/expiry failure counts as dead; a transient one leaves the last
  // known state alone (return ok:true-ish so we don't flip a working conn).
  if (v.ok) return { ok: true, dead: false, checkedAt: Date.now() }
  if (v.expired) return { ok: false, dead: true, reason: v.error || 'token invalidated', checkedAt: Date.now() }
  return { ok: false, dead: false, reason: v.error || 'transient', checkedAt: Date.now() }
}

async function probeYouTube(row: ProbeRow): Promise<HealthEntry | null> {
  const refresh = maybeDecrypt(row.youtube_oauth_refresh_token || undefined) || ''
  const access = maybeDecrypt(row.youtube_oauth_access_token || undefined) || ''
  if (!access && !refresh) return null // not connected
  // Connected but no refresh token → it can't self-heal; but don't hard-fail on
  // that alone (some legacy connects lack it yet still work until expiry).
  if (!refresh) return { ok: true, dead: false, checkedAt: Date.now() }
  const r = await classifyYouTubeRefresh(refresh)
  if (r.ok) return { ok: true, dead: false, checkedAt: Date.now() }
  if (r.dead) return { ok: false, dead: true, reason: r.reason || 'token revoked', checkedAt: Date.now() }
  return { ok: false, dead: false, reason: r.reason || 'transient', checkedAt: Date.now() }
}

/**
 * Probe FB + YT for one user and persist the result onto integrations. Returns
 * the health map (also returned in-memory even if persistence fails, so the
 * caller can render without a round-trip). `sb` is any Supabase client scoped to
 * write this user's integrations row.
 */
export async function probeAndStoreConnections(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  userId: string,
  row: ProbeRow,
): Promise<ConnectionHealth> {
  const [fb, yt] = await Promise.all([
    probeFacebook(row).catch(() => null),
    probeYouTube(row).catch(() => null),
  ])
  // Merge onto any prior health so a platform we didn't probe this pass (e.g. not
  // connected) keeps its last state rather than vanishing.
  const prior: ConnectionHealth = { ...(row.connection_health || {}) }
  const health: ConnectionHealth = { ...prior }
  // A TRANSIENT result (ok:false, dead:false — a rate-limit/network blip, not an
  // auth verdict) must NOT overwrite a prior definitive state. Without this, one
  // rate-limited probe run clears a genuine `dead:true` back to `dead:false` and
  // re-hides the reconnect banner (false green) — the exact failure this system
  // exists to prevent. On a transient result we keep whatever we last knew.
  const isTransient = (e: HealthEntry) => !e.ok && !e.dead
  const merge = (next: HealthEntry | null, previous: HealthEntry | undefined) =>
    next ? (isTransient(next) && previous ? previous : next) : undefined
  const fbMerged = merge(fb, prior.facebook)
  const ytMerged = merge(yt, prior.youtube)
  if (fbMerged) health.facebook = fbMerged; else delete health.facebook
  if (ytMerged) health.youtube = ytMerged; else delete health.youtube
  try {
    await sb.from('integrations')
      .update({ connection_health: health, connection_health_at: new Date().toISOString() })
      .eq('user_id', userId)
  } catch { /* column may not exist pre-migration — health still returned in-memory */ }
  return health
}

/** Clear one platform's health after a successful (re)connect, so the banner
 *  drops immediately instead of waiting for the next probe. Best-effort. */
export async function clearConnectionHealth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  userId: string,
  platform: 'facebook' | 'youtube',
): Promise<void> {
  try {
    const { data } = await sb.from('integrations').select('connection_health').eq('user_id', userId).maybeSingle()
    const health: ConnectionHealth = { ...((data?.connection_health as ConnectionHealth) || {}) }
    if (!health[platform]) return
    health[platform] = { ok: true, dead: false, checkedAt: Date.now() }
    await sb.from('integrations').update({ connection_health: health }).eq('user_id', userId)
  } catch { /* non-fatal — never block a connect */ }
}

/** Extract the platforms a stored health map reports as dead. */
export function deadPlatforms(health: ConnectionHealth | null | undefined): Array<'facebook' | 'youtube'> {
  if (!health) return []
  const out: Array<'facebook' | 'youtube'> = []
  if (health.facebook?.dead) out.push('facebook')
  if (health.youtube?.dead) out.push('youtube')
  return out
}
