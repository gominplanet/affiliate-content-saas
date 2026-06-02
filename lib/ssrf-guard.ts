/**
 * SSRF guard for routes that fetch user-supplied URLs.
 *
 * Why: any route that does `fetch(userProvidedUrl)` is a textbook
 * SSRF target. Attackers point the URL at:
 *   - Cloud metadata endpoints (169.254.169.254 — AWS/GCP/Azure)
 *     to steal IAM creds
 *   - Internal services (localhost:*, RFC1918) to probe networks
 *     or hit unauthenticated admin endpoints inside the VPC
 *   - File-system / process URIs (file://, gopher://, ftp://) on
 *     hosts that allow non-http fetchers
 *
 * This module provides one assertion: `assertPublicHttpUrl(url)`. It
 * either returns the parsed URL object or throws a SsrfBlocked error
 * with a user-safe message.
 *
 * Discovered during 2026-06-02 audit — found four routes (wordpress/test,
 * wordpress/setup-site, blog/attach-video, blog/refresh-images) that
 * read a WP base URL from request body or from the user's own
 * integrations row and `fetch(siteUrl/wp-json/...)` without any
 * validation. Attacker-controlled URLs from the integrations row are
 * particularly nasty because the attacker writes the URL once, then
 * triggers the fetch on any subsequent route. Hence this guard runs
 * on EVERY fetch of a user-controlled URL, not just at write time.
 *
 * Performance: validation is sync + DNS-free (no resolution required —
 * we only reject by IP literal pattern). Resolving hostnames at every
 * call would add ~50ms; we instead document that hostnames that point
 * at private IPs still slip through. To close that gap, callers
 * should ALSO `getaddrinfo` and re-check before the actual fetch.
 * That's a follow-up; this guard catches the 99% case (URL is a raw
 * private IP literal or non-http scheme).
 */

/** Thrown when a URL is rejected. Catch this distinctly so the API
 *  route can return a clear 400 instead of a confused 500. */
export class SsrfBlocked extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfBlocked'
  }
}

/**
 * Assert that a URL is safe to fetch server-side.
 *
 * Allows: https://public-hostname/...
 *
 * Rejects:
 *   - Non-http(s) schemes (file:, gopher:, ftp:, javascript:, data:...)
 *   - http:// in production (https only)
 *   - Hostnames that ARE raw IP literals in RFC1918 / loopback /
 *     link-local / multicast / reserved space
 *   - Common shorthand for the cloud metadata endpoints
 *
 * @param raw — the URL string to validate. May or may not have a
 *              scheme; we'll normalize.
 * @param opts.allowHttp — bypass the "https only" check (only for
 *              local dev / tests). Default false.
 */
export function assertPublicHttpUrl(raw: string, opts: { allowHttp?: boolean } = {}): URL {
  if (!raw || typeof raw !== 'string') {
    throw new SsrfBlocked('URL is required.')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SsrfBlocked('That doesn\'t look like a valid URL.')
  }

  // 1. Scheme: only http(s) — and https in prod.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SsrfBlocked(`URL scheme "${url.protocol}" is not allowed. Use https://`)
  }
  if (url.protocol === 'http:' && !opts.allowHttp && process.env.NODE_ENV === 'production') {
    throw new SsrfBlocked('http:// URLs are not allowed in production. Use https://')
  }

  // 2. Reject raw IP literals in the host part.
  const host = url.hostname.toLowerCase()
  if (isPrivateIpLiteral(host)) {
    throw new SsrfBlocked(`URL host "${host}" points to a private/reserved network and cannot be reached from MVP.`)
  }

  // 3. Reject known cloud metadata hostnames (some clouds expose them
  //    by hostname, not just IP).
  if (METADATA_HOSTS.has(host)) {
    throw new SsrfBlocked(`URL host "${host}" is blocked.`)
  }

  // 4. Reject empty host (e.g., `https:///path`).
  if (!host) {
    throw new SsrfBlocked('URL is missing a hostname.')
  }

  return url
}

const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.azure.com',
  'metadata',
])

/** Recognize raw IP literals that resolve to private/reserved space.
 *  IPv4 and basic IPv6 forms covered. */
function isPrivateIpLiteral(host: string): boolean {
  // IPv6 loopback / link-local / unique-local
  // (Bracket-stripped at URL parse time by URL constructor.)
  if (host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc00:') || host.startsWith('fd00:')) {
    return true
  }

  // IPv4 patterns
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b, c, d] = m.slice(1).map(n => parseInt(n, 10))
  if ([a, b, c, d].some(n => isNaN(n) || n < 0 || n > 255)) return false

  // 10.0.0.0/8 — RFC1918
  if (a === 10) return true
  // 172.16.0.0/12 — RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16 — RFC1918
  if (a === 192 && b === 168) return true
  // 127.0.0.0/8 — loopback
  if (a === 127) return true
  // 169.254.0.0/16 — link-local INCLUDING 169.254.169.254 (cloud metadata)
  if (a === 169 && b === 254) return true
  // 0.0.0.0/8 — current network / unspecified
  if (a === 0) return true
  // 100.64.0.0/10 — carrier-grade NAT (RFC6598)
  if (a === 100 && b >= 64 && b <= 127) return true
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return true
  // 240.0.0.0/4 — reserved
  if (a >= 240) return true

  return false
}
