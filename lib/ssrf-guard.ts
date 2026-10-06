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

/**
 * Stronger async guard: the sync checks PLUS DNS resolution — resolve the
 * hostname and re-run the private-range check against EVERY resolved address,
 * closing the "hostname whose A record points at 169.254.169.254 / RFC1918"
 * gap the sync guard documents. Use this on paths that fetch a fully
 * user-supplied URL (a pasted product/article link).
 *
 * Fail-open ONLY on DNS resolution error: if the host can't be resolved the
 * real fetch would fail anyway, and blocking here would break transient-DNS
 * cases. A host that resolves to a private/reserved IP is a hard block.
 */
export async function assertPublicHttpUrlResolved(raw: string, opts: { allowHttp?: boolean } = {}): Promise<URL> {
  const url = assertPublicHttpUrl(raw, opts) // scheme + IP-literal + metadata-host checks
  const host = url.hostname.toLowerCase()
  // Already an IP literal → the sync check settled it; nothing to resolve.
  if (host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return url
  let addrs: Array<{ address: string }>
  try {
    const { lookup } = await import('dns/promises')
    addrs = await lookup(host, { all: true })
  } catch {
    return url // DNS failure → don't block; the fetch will fail on its own.
  }
  for (const a of addrs) {
    const ip = (a.address || '').toLowerCase().replace(/^::ffff:/, '') // unwrap IPv4-mapped IPv6
    if (isPrivateIpLiteral(ip)) {
      throw new SsrfBlocked(`URL host "${host}" resolves to a private/reserved address and cannot be reached from MVP.`)
    }
  }
  return url
}

const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.azure.com',
  'metadata',
])

/** Recognize hosts that are, or resolve by name to, private/reserved space.
 *  IPv4, IPv6 (bracketed or not, including IPv4-mapped) and "localhost". */
function isPrivateIpLiteral(rawHost: string): boolean {
  // URL keeps the brackets on an IPv6 hostname ("[::1]"), so the checks
  // below never matched one: [::1] and [::ffff:7f00:1] reached loopback.
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.includes(':')) return isPrivateIpv6(host)
  return isPrivateIpv4(host)
}

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b, c, d] = m.slice(1).map(n => parseInt(n, 10))
  if ([a, b, c, d].some(n => isNaN(n) || n < 0 || n > 255)) return false
  if (a === 10) return true                          // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12
  if (a === 192 && b === 168) return true            // 192.168.0.0/16
  if (a === 127) return true                         // loopback
  if (a === 169 && b === 254) return true            // link-local, incl. cloud metadata
  if (a === 0) return true                           // this network
  if (a === 100 && b >= 64 && b <= 127) return true  // carrier-grade NAT
  if (a === 192 && b === 0 && c === 0) return true   // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true                          // multicast + reserved
  return false
}

/** Expand an IPv6 literal to its eight 16-bit groups, or null. */
function ipv6Groups(host: string): number[] | null {
  let h = host
  // A trailing dotted IPv4 (::ffff:127.0.0.1) becomes two groups.
  const v4 = h.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const n = v4.slice(1).map(x => parseInt(x, 10))
    if (n.some(x => x > 255)) return null
    h = h.slice(0, h.length - v4[0].length) + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16)
  }
  const halves = h.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => part ? part.split(':').map(x => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN)) : []
  const head = parse(halves[0]), tail = halves.length === 2 ? parse(halves[1]) : []
  if ([...head, ...tail].some(x => isNaN(x))) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const zeros = 8 - head.length - tail.length
  if (zeros < 1) return null
  return [...head, ...Array(zeros).fill(0), ...tail]
}

function isPrivateIpv6(host: string): boolean {
  const g = ipv6Groups(host)
  if (!g) return true // not a host we can read: refuse rather than guess
  if (g.every(x => x === 0)) return true                                   // ::
  if (g.slice(0, 7).every(x => x === 0) && g[7] === 1) return true          // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): the IPv4 rules.
  if (g.slice(0, 5).every(x => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPrivateIpv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`)
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) {                                    // NAT64
    return isPrivateIpv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`)
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true   // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true   // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true   // multicast
  return false
}

/**
 * fetch a user-supplied URL with every redirect hop checked. `redirect:
 * 'follow'` checked only the first address, so a public page that answered
 * 302 to an internal one was fetched anyway. Each hop is resolved and checked
 * (assertPublicHttpUrlResolved) before it is requested; at most five hops.
 * Throws SsrfBlocked on a refused hop.
 */
export async function safeFetch(raw: string, init: RequestInit = {}, opts: { allowHttp?: boolean } = {}): Promise<Response> {
  let url = raw
  for (let hop = 0; hop < 6; hop++) {
    await assertPublicHttpUrlResolved(url, opts)
    const res = await fetch(url, { ...init, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(15_000) })
    if (res.status < 300 || res.status >= 400 || !res.headers.get('location')) return res
    url = new URL(res.headers.get('location') as string, url).toString()
  }
  throw new SsrfBlocked('Too many redirects.')
}
