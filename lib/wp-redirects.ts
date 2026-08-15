// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared writer for the MVP plugin's 301 redirect store (v1.0.65+). The plugin
// serves a stored 301 whenever WordPress would otherwise 404, so old URLs never
// die. Used by the manual Fix-404s tool AND the automatic permalink-change
// healer (resync-permalinks), so a changed URL never becomes a dead 404.

/** Normalize any URL or path to a trailing-slashed lowercase path ("/old-slug/"). */
export function normRedirectPath(u: string): string {
  let p = (u || '').trim()
  try { p = new URL(p).pathname } catch { /* already a path */ }
  p = '/' + p.replace(/[?#].*$/, '').trim().replace(/^\/+|\/+$/g, '')
  if (p !== '/') p += '/'
  return p.toLowerCase()
}

export interface WpCredsForRedirect {
  wordpress_url: string
  wordpress_username: string
  wordpress_app_password: string | null
  wordpress_api_token: string | null
}

/**
 * Persist 301s to the plugin. Returns { ok, count } or { ok:false, error }.
 * Silently drops invalid pairs (missing sides, non-http target, from===to).
 */
export async function applyWpRedirects(
  creds: WpCredsForRedirect,
  pairs: Array<{ from: string; to: string }>,
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; count?: number; error?: string; needsPlugin?: boolean }> {
  const redirects = pairs
    .map(r => ({ from: normRedirectPath(r.from), to: (r.to || '').trim() }))
    .filter(r => r.from && r.from !== '/' && /^https?:\/\//i.test(r.to) && normRedirectPath(r.to) !== r.from)
    .slice(0, 1000)
  if (redirects.length === 0) return { ok: true, count: 0 }

  const wpBase = creds.wordpress_url.replace(/\/$/, '')
  const authHeader = `Basic ${Buffer.from(`${creds.wordpress_username}:${(creds.wordpress_app_password || '').replace(/\s+/g, '')}`).toString('base64')}`
  try {
    const res = await fetch(`${wpBase}/wp-json/affiliateos/v1/redirects`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: creds.wordpress_api_token || '', redirects }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    })
    if (res.status === 404) return { ok: false, needsPlugin: true, error: 'Redirects need the MVP plugin v1.0.65+.' }
    const data = await res.json().catch(() => ({})) as { ok?: boolean; count?: number; error?: string }
    if (!res.ok || !data?.ok) return { ok: false, error: data?.error || `WordPress returned ${res.status}.` }
    return { ok: true, count: data.count ?? redirects.length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'WordPress unreachable' }
  }
}
