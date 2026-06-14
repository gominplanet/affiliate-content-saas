/**
 * Body-auth WordPress proxy helper.
 *
 * When a site has a proxy_secret stored (from plugin v1.0.25+), POSTs go
 * through /wp-json/affiliateos/v1/proxy with the token in the JSON BODY
 * instead of the Authorization header. This sidesteps hosts that strip
 * the Authorization header on POST (Hostinger LiteSpeed, certain shared
 * Apache configs) — no .htaccess editing required.
 *
 * Callers should ALWAYS handle null returns gracefully and fall back to
 * the legacy Basic-Auth fetch:
 *
 *   const proxied = await tryWpProxy({
 *     siteUrl, proxySecret: site.wordpress_api_token,
 *     innerPath: '/affiliateos/v1/self-update', method: 'POST'
 *   })
 *   if (proxied) {
 *     // proxy worked, use it
 *   } else {
 *     // fall through to existing Basic-Auth fetch
 *   }
 *
 * Returns null when:
 *   - No proxySecret on file (plugin <1.0.25 or new connect without /status sync yet)
 *   - Plugin returns 404 (proxy route doesn't exist on this install)
 *   - Plugin returns 401 (stale token — wp-status will refresh on next poll)
 *   - Network error reaching the proxy endpoint
 *
 * Returns a result object when the proxy succeeded OR returned an
 * application-level error (4xx/5xx from the dispatched inner call).
 * The caller decides what to do with non-ok statuses (most should
 * surface to the user as the proxied call's failure).
 */

interface ProxyResult {
  ok: boolean
  status: number
  data: unknown
}

/**
 * Fetch the live body-auth proxy secret from a site's /affiliateos/v1/status
 * (plugin v1.0.25+). Uses Basic-Auth GET, which hosts that strip Authorization
 * on POST still pass on GET — so this works even where direct writes don't.
 *
 * Why this exists: the connect-token flow stores the Application Password in
 * wordpress_api_token, NOT the proxy secret. If a /status sync never ran (or
 * ran before the column existed), the dashboard ends up sending the app
 * password as the proxy token → the plugin rejects it (bad_token) → every
 * write falls through to the legacy cookie-login path, which fails on hosts
 * with a WAF / Application-Password-only setup. Fetching the real secret here
 * lets a write path self-heal: get the secret, publish through the proxy
 * (dispatched server-side via rest_do_request, bypassing the external WAF).
 *
 * Returns null when the plugin is too old (404), creds are rejected (401/403),
 * the response lacks a secret, or the host is unreachable — caller falls back
 * to whatever token it already had.
 */
export async function fetchWpProxySecret(args: {
  siteUrl: string
  username: string
  appPassword: string
  timeoutMs?: number
}): Promise<string | null> {
  const base = args.siteUrl.replace(/\/$/, '')
  const pw = args.appPassword.replace(/\s+/g, '')
  const auth = `Basic ${Buffer.from(`${args.username}:${pw}`).toString('base64')}`
  try {
    const res = await fetch(`${base}/wp-json/affiliateos/v1/status`, {
      headers: {
        Authorization: auth,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(args.timeoutMs ?? 10_000),
    })
    if (!res.ok) return null
    const json = await res.json() as { proxy_secret?: string | null }
    const secret = (json?.proxy_secret || '').trim()
    return secret || null
  } catch {
    return null
  }
}

export async function tryWpProxy(args: {
  /** WP site root URL (no trailing slash, no /wp-json). */
  siteUrl: string
  /** The body-auth secret persisted from /affiliateos/v1/status. Null = no proxy. */
  proxySecret: string | null | undefined
  /** Inner REST path to dispatch via rest_do_request, e.g.
   *  '/affiliateos/v1/self-update' or '/wp/v2/posts'. */
  innerPath: string
  /** HTTP method for the inner call. Default 'POST'. */
  method?: string
  /** Inner body (JSON-serializable). The proxy sends it as both body_params
   *  and the request body so routes using get_json_params() see it too. */
  body?: unknown
  /** Inner query params, if any. */
  query?: Record<string, string | number | boolean | null | undefined>
  /** Per-call timeout in ms. Default 30s — long enough for self-update. */
  timeoutMs?: number
}): Promise<ProxyResult | null> {
  if (!args.proxySecret) return null

  const base = args.siteUrl.replace(/\/$/, '')
  const url = `${base}/wp-json/affiliateos/v1/proxy`
  const payload = {
    token: args.proxySecret,
    method: (args.method || 'POST').toUpperCase(),
    path: args.innerPath,
    body: args.body ?? undefined,
    query: args.query ?? undefined,
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
    })

    // 404 = proxy route doesn't exist (plugin <1.0.25). 401 = bad token
    // (stale secret — wp-status poll will refresh it). 429 = brute-force
    // cooldown (5+ bad attempts; back off + retry later). In all three
    // cases, return null so the caller falls back to legacy Basic Auth.
    if (res.status === 404 || res.status === 401 || res.status === 429) {
      return null
    }

    let data: unknown
    try { data = await res.json() } catch { data = await res.text() }
    return { ok: res.ok, status: res.status, data }
  } catch {
    // Network errors / timeouts → null so the caller can try legacy auth.
    return null
  }
}
