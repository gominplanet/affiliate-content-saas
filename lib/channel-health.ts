// Social channel health — detects "dead" connections (expired token, never
// connected, repeatedly failing) so we can BOTH stop hammering them on every
// scheduled post AND tell the user to reconnect.
//
// Why: one creator's stale X token + an unconnected Telegram accounted for 39
// of 43 scheduled-post failures in a week — retrying every single day, silently.
//
// Health is computed from scheduled_posts history (no extra table): walk a
// platform's outcomes newest-first and count the CONSECUTIVE failures before
// the first success. A success anywhere resets it, so this self-heals with
// zero bookkeeping.
//
// Deadlock guard: auto-skipped rows are tagged with AUTO_SKIP_PREFIX and are
// NOT counted toward the streak — otherwise skipping would manufacture the very
// failures that keep the channel "dead" forever. Combined with the once-a-day
// probe (shouldSkipChannel), a reconnect heals on the next attempt.

export const DEAD_CHANNEL_THRESHOLD = 3
/** Let ONE real attempt through per day per dead channel, so a reconnect is
 *  noticed promptly without retrying on every single scheduled post. */
export const PROBE_INTERVAL_MS = 24 * 60 * 60 * 1000
export const AUTO_SKIP_PREFIX = '[auto-skipped]'

export type DeadReason = 'not_connected' | 'expired' | 'failing'

export interface DeadChannel {
  platform: string
  label: string
  consecutiveFailures: number
  lastError: string
  lastFailedAt: string | null
  reason: DeadReason
  /** User-facing sentence, safe to render directly. */
  message: string
}

const PLATFORM_LABEL: Record<string, string> = {
  twitter: 'X (Twitter)',
  telegram: 'Telegram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  pinterest: 'Pinterest',
  threads: 'Threads',
  bluesky: 'Bluesky',
  tiktok: 'TikTok',
  youtube: 'YouTube',
}

export const platformLabel = (p: string): string => PLATFORM_LABEL[p] ?? (p.charAt(0).toUpperCase() + p.slice(1))

function classify(platform: string, err: string): { reason: DeadReason; message: string } {
  const e = (err || '').toLowerCase()
  const name = platformLabel(platform)
  if (/not connected|no .*account|account not found|missing .*(token|account)/.test(e)) {
    return {
      reason: 'not_connected',
      message: `${name} isn't connected, but it's still part of your publishing schedule. Connect it — or remove it from your schedule — so your posts stop failing.`,
    }
  }
  if (/token|expired|invalid_request|invalid_grant|refresh|unauthorized|revoked|401|403/.test(e)) {
    return {
      reason: 'expired',
      message: `Your ${name} connection expired, so recent posts didn't go out. Reconnect it to start publishing again.`,
    }
  }
  return {
    reason: 'failing',
    message: `${name} failed on your last few scheduled posts. Reconnecting usually clears it.`,
  }
}

/** The field on `integrations` that means "this platform is connected". */
const CONNECTION_FIELD: Record<string, string> = {
  telegram: 'telegram_channel_id',
  linkedin: 'linkedin_access_token',
  twitter: 'twitter_access_token',
  bluesky: 'bluesky_app_password',
  pinterest: 'pinterest_access_token',
  threads: 'threads_access_token',
  facebook: 'facebook_page_access_token',
  instagram: 'instagram_access_token',
  tiktok: 'tiktok_access_token',
}

/** Platforms this user has actually connected (legacy integrations columns OR a
 *  multi-account social_accounts row). Used to keep "reconnect" nagging off
 *  platforms the creator never set up — most people only wire up a few. */
export async function getConnectedPlatforms(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<Set<string>> {
  const connected = new Set<string>()
  try {
    const { data } = await supabase
      .from('integrations')
      .select(Object.values(CONNECTION_FIELD).join(','))
      .eq('user_id', userId)
      .maybeSingle()
    if (data) {
      for (const [platform, field] of Object.entries(CONNECTION_FIELD)) {
        const v = (data as Record<string, unknown>)[field]
        if (typeof v === 'string' ? v.trim() !== '' : v != null) connected.add(platform)
      }
    }
  } catch { /* ignore */ }
  try {
    const { data } = await supabase.from('social_accounts').select('platform').eq('user_id', userId)
    for (const r of (data || []) as Array<{ platform: string | null }>) {
      if (r.platform) connected.add(r.platform)
    }
  } catch { /* table may not exist on older DBs */ }
  return connected
}

/** Dead channels for one user, newest-failure-first. Safe + cheap: one indexed
 *  read of recent finished rows. Returns [] on any error (never blocks a flow).
 *
 *  `requireConnected` (default TRUE) drops platforms the user never connected —
 *  telling someone to "reconnect Telegram" they never set up is pure noise. The
 *  CRON passes false, so it still silently pauses those rows (stopping the daily
 *  failures) without nagging anyone about a channel they don't use. */
export async function getDeadChannels(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  opts: { threshold?: number; lookback?: number; requireConnected?: boolean } = {},
): Promise<DeadChannel[]> {
  const threshold = opts.threshold ?? DEAD_CHANNEL_THRESHOLD
  const lookback = opts.lookback ?? 150
  const requireConnected = opts.requireConnected !== false
  try {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('platform,status,error_message,updated_at')
      .eq('user_id', userId)
      .in('status', ['completed', 'failed'])
      .order('updated_at', { ascending: false })
      .limit(lookback)
    if (error || !Array.isArray(data)) return []

    const byPlatform = new Map<string, Array<{ status: string; error_message: string | null; updated_at: string }>>()
    for (const r of data as Array<{ platform: string | null; status: string; error_message: string | null; updated_at: string }>) {
      if (!r.platform) continue
      // Don't let our own auto-skips count as evidence (see deadlock guard).
      if ((r.error_message || '').startsWith(AUTO_SKIP_PREFIX)) continue
      if (!byPlatform.has(r.platform)) byPlatform.set(r.platform, [])
      byPlatform.get(r.platform)!.push(r)
    }

    const dead: DeadChannel[] = []
    for (const [platform, rows] of byPlatform) {
      let streak = 0
      let lastError = ''
      let lastFailedAt: string | null = null
      for (const r of rows) { // already newest-first
        if (r.status !== 'failed') break // a success resets the streak → healthy
        if (streak === 0) { lastError = r.error_message || ''; lastFailedAt = r.updated_at }
        streak++
      }
      if (streak >= threshold) {
        dead.push({
          platform,
          label: platformLabel(platform),
          consecutiveFailures: streak,
          lastError: lastError.slice(0, 300),
          lastFailedAt,
          ...classify(platform, lastError),
        })
      }
    }
    const ordered = dead.sort((a, b) => b.consecutiveFailures - a.consecutiveFailures)
    if (!requireConnected || ordered.length === 0) return ordered
    // Only surface channels the creator actually connected. A platform that was
    // never set up isn't something they can "reconnect" — the cron still pauses
    // it silently (requireConnected: false) so the failures stop either way.
    const connected = await getConnectedPlatforms(supabase, userId)
    return ordered.filter(d => connected.has(d.platform))
  } catch {
    return []
  }
}

/** True when we should NOT attempt this channel right now — it's dead AND we
 *  already made a real attempt within the probe window. Outside the window we
 *  let one through so a reconnect is picked up automatically. */
export function shouldSkipChannel(dead: DeadChannel, now = Date.now()): boolean {
  if (!dead.lastFailedAt) return false
  const t = new Date(dead.lastFailedAt).getTime()
  if (!Number.isFinite(t)) return false
  return now - t < PROBE_INTERVAL_MS
}

/** Message stored on an auto-skipped row (prefixed so it's excluded from the
 *  streak and obvious in the failures list). */
export function autoSkipMessage(platform: string): string {
  return `${AUTO_SKIP_PREFIX} ${platformLabel(platform)} needs reconnecting — we paused repeat attempts. Reconnect it in Connect Socials and it resumes automatically.`
}
