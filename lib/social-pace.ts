// Posting-pace guardrails. Platforms (Instagram especially) restrict accounts
// that post in fast bursts via the API — an approved app does NOT exempt its
// users from that per-account spam/integrity enforcement. So before an API
// publish we check the recent post history and enforce:
//   1. a minimum gap between posts,
//   2. a per-hour cap,
//   3. a per-day cap (well under Instagram's hard 100/24h — the detector trips
//      far lower for young/low-trust accounts).
// Backed by social_post_log (migration 237). Everything FAILS OPEN: any read
// error or a not-yet-applied migration means "allowed", so pacing can never
// block real posting.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const IG_PACE = {
  minGapMinutes: 5,   // don't publish within 5 min of the last IG publish
  hourlyCap: 6,       // max IG publishes per rolling hour
  dailyCap: 25,       // max IG publishes per rolling 24h (IG hard cap is 100)
}

export interface PaceVerdict {
  allowed: boolean
  reason?: string        // user-facing, when blocked
  retryAfterMinutes?: number
  warning?: string       // non-blocking advice (e.g. brand-new account)
}

/** Recent successful publish timestamps for one user+platform, newest first. */
async function recentPublishTimes(sb: any, userId: string, platform: string, sinceMs: number): Promise<number[]> {
  try {
    const sinceIso = new Date(sinceMs).toISOString()
    const { data, error } = await sb
      .from('social_post_log')
      .select('created_at')
      .eq('user_id', userId)
      .eq('platform', platform)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error || !Array.isArray(data)) return [] // fail open (table missing, etc.)
    return data
      .map((r: { created_at: string }) => new Date(r.created_at).getTime())
      .filter((t: number) => Number.isFinite(t))
  } catch {
    return []
  }
}

/** Enforce Instagram posting pace. Fails open on any error. `now` injectable for tests. */
export async function checkInstagramPace(sb: any, userId: string, now = Date.now()): Promise<PaceVerdict> {
  const dayAgo = now - 24 * 60 * 60 * 1000
  const times = await recentPublishTimes(sb, userId, 'instagram', dayAgo)
  if (times.length === 0) return { allowed: true }

  const hourAgo = now - 60 * 60 * 1000
  const inHour = times.filter(t => t >= hourAgo).length
  const inDay = times.length
  const last = times[0] // newest

  // 1. Minimum gap since the last post.
  const gapMs = now - last
  const minGapMs = IG_PACE.minGapMinutes * 60 * 1000
  if (gapMs < minGapMs) {
    const wait = Math.max(1, Math.ceil((minGapMs - gapMs) / 60000))
    return {
      allowed: false,
      retryAfterMinutes: wait,
      reason: `You just posted to Instagram. To avoid Instagram flagging your account for automated posting, MVP spaces posts at least ${IG_PACE.minGapMinutes} minutes apart. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`,
    }
  }
  // 2. Per-hour cap.
  if (inHour >= IG_PACE.hourlyCap) {
    const oldestInHour = Math.min(...times.filter(t => t >= hourAgo))
    const wait = Math.max(1, Math.ceil((oldestInHour + 60 * 60 * 1000 - now) / 60000))
    return {
      allowed: false,
      retryAfterMinutes: wait,
      reason: `You've posted to Instagram ${inHour} times in the last hour — that's MVP's safety cap (${IG_PACE.hourlyCap}/hour) to keep Instagram from restricting your account. Try again in about ${wait} minute${wait === 1 ? '' : 's'}.`,
    }
  }
  // 3. Per-day cap.
  if (inDay >= IG_PACE.dailyCap) {
    return {
      allowed: false,
      retryAfterMinutes: 60,
      reason: `You've hit MVP's daily Instagram safety cap (${IG_PACE.dailyCap} posts/24h). Posting more today risks a restriction. Spread the rest over the next day.`,
    }
  }
  return { allowed: true }
}

/** Record a successful publish for pacing. Best-effort — never throws. */
export async function logSocialPublish(sb: any, userId: string, platform: string, externalId?: string | null): Promise<void> {
  try {
    await sb.from('social_post_log').insert({ user_id: userId, platform, external_id: externalId || null })
  } catch { /* fail open — pacing is advisory, never block a real publish */ }
}
