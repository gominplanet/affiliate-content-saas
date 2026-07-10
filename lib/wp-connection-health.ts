// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared "is this owner's WordPress connection currently broken?" signal, used
// by BOTH the topbar "Fix connection" button (/api/wordpress/connection-health)
// and the generation pre-flight (/api/blog/enqueue). Reading recent
// generation_jobs is cheap (indexed, owner-scoped) and needs no live probe.

/** Phrases our WordPress client throws when the SITE (not our code) refused the
 *  write — firewall/WAF block, deactivated plugin, header-stripping, bad app
 *  password. Kept broad on purpose: a false positive just nudges toward the
 *  Connection Doctor (harmless); a false negative leaves a stuck user with no
 *  hint. Includes the pre-fix raw HTML-as-JSON parse error. */
export const WP_CONNECTION_ERROR_PATTERNS = [
  'wordpress firewall',
  'connection doctor',
  'did not accept the connection',
  'could not reach wordpress',
  'is not valid json',        // legacy "Unexpected token '<'" — HTML parsed as JSON
  'non-json',
  'rest_cannot_create',
  'rest_no_route',
]

export function isWpConnectionError(error: string | null | undefined): boolean {
  const e = (error || '').toLowerCase()
  return WP_CONNECTION_ERROR_PATTERNS.some(p => e.includes(p))
}

const LOOKBACK_DAYS = 4

interface JobRow { status: string; error: string | null; updated_at: string }

/** Current connection state for `ownerId`, derived from recent blog jobs.
 *  `needsAttention` is true only when a connection-error failure is MORE RECENT
 *  than the last successful publish — so it self-clears once the user publishes
 *  again, and re-arms if it breaks later. Fails safe (healthy) on any read error.
 *  Pass a service-role or user-scoped client; the owner_id filter scopes it. */
export async function getWpConnectionHealth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  ownerId: string,
): Promise<{ needsAttention: boolean; lastFailedAt?: string }> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await client
    .from('generation_jobs')
    .select('status, error, updated_at')
    .eq('owner_id', ownerId)
    .eq('kind', 'blog')
    .in('status', ['failed', 'done'])
    .gte('created_at', since)
    .order('updated_at', { ascending: false })
    .limit(40)

  if (error) return { needsAttention: false }

  const rows = (data ?? []) as JobRow[]
  const lastConnFail = rows.find(r => r.status === 'failed' && isWpConnectionError(r.error))
  const lastSuccess = rows.find(r => r.status === 'done')
  const needsAttention = !!lastConnFail
    && (!lastSuccess || lastConnFail.updated_at > lastSuccess.updated_at)

  return needsAttention ? { needsAttention, lastFailedAt: lastConnFail!.updated_at } : { needsAttention: false }
}
