/**
 * Robust WordPress login helper.
 *
 * Why not just POST to wp-login.php directly?
 * Hostinger (and other hosts) run LiteSpeed + ModSecurity WAF rules that
 * block login POSTs that don't look like real browser requests:
 *  - missing Referer header
 *  - missing User-Agent
 *  - no prior GET session (missing test cookie or hidden nonces)
 *
 * This helper mimics what a real browser does:
 * 1. GET the login page → collect cookies + any hidden nonce fields
 * 2. POST with those cookies, Referer, User-Agent, and hidden fields included
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function buildCookieHeader(rawSetCookie: string[]): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const raw of rawSetCookie) {
    const kv = raw.split(';')[0].trim()
    const key = kv.split('=')[0]
    if (!seen.has(key)) { seen.add(key); parts.push(kv) }
  }
  return parts.join('; ')
}

function collectCookies(headers: Headers): string[] {
  const cookies: string[] = []
  // Node 18+ / fetch: headers.getSetCookie() is available
  if (typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function') {
    cookies.push(...(headers as unknown as { getSetCookie: () => string[] }).getSetCookie())
  } else {
    headers.forEach((val, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        // fallback split on comma-separated cookies (imperfect but covers most cases)
        cookies.push(...val.split(/,(?=\s*[a-zA-Z0-9_-]+=)/))
      }
    })
  }
  return cookies
}

/** Extract all <input type="hidden"> name/value pairs from an HTML string */
function extractHiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const re = /<input[^>]+type=["']hidden["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const nm = /name=["']([^"']+)["']/.exec(m[0])
    const vm = /value=["']([^"']*)["']/.exec(m[0])
    if (nm) fields[nm[1]] = vm ? vm[1] : ''
  }
  return fields
}

export interface WpLoginResult {
  cookies: string
  ok: boolean
  /** Error detail when ok === false */
  reason?: 'wrong_password' | 'unreachable' | 'waf_blocked' | 'unknown'
}

export async function wpLogin(
  siteUrl: string,
  username: string,
  password: string,
): Promise<WpLoginResult> {
  const loginUrl = `${siteUrl}/wp-login.php`

  // ── 1. GET the login page ────────────────────────────────────────────────
  let getHtml = ''
  let getSetCookies: string[] = []
  try {
    const getRes = await fetch(loginUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })
    getHtml = await getRes.text()
    getSetCookies = collectCookies(getRes.headers)
  } catch {
    return { cookies: '', ok: false, reason: 'unreachable' }
  }

  // ── 2. Build the login POST body (include hidden fields for security plugins) ──
  const hiddenFields = extractHiddenFields(getHtml)
  // Remove fields we're supplying ourselves so we don't double-set them
  delete hiddenFields['log']
  delete hiddenFields['pwd']
  delete hiddenFields['testcookie']

  const body = new URLSearchParams({
    log: username,
    pwd: password,
    'wp-submit': 'Log In',
    redirect_to: `${siteUrl}/wp-admin/`,
    testcookie: '1',
    ...hiddenFields,
  })

  // Combine GET cookies + test cookie
  const sessionCookies = buildCookieHeader([
    ...getSetCookies,
    'wordpress_test_cookie=WP Cookie check',
  ])

  // ── 3. POST to wp-login.php ───────────────────────────────────────────────
  let loginRes: Response
  try {
    loginRes = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: sessionCookies,
        Referer: loginUrl,
        Origin: siteUrl,
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      body: body.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    return { cookies: '', ok: false, reason: 'unreachable' }
  }

  const postSetCookies = collectCookies(loginRes.headers)
  const allCookies = buildCookieHeader([...getSetCookies, ...postSetCookies])

  // WordPress sets wordpress_logged_in_* on successful login (in 302 redirect)
  const ok = postSetCookies.some(c => c.includes('wordpress_logged_in_'))

  if (!ok) {
    // 302 but no login cookie → wrong password
    // 200 → login page shown again (wrong password or WAF block)
    const reason = loginRes.status === 302 ? 'unknown' : 'wrong_password'
    return { cookies: allCookies, ok: false, reason }
  }

  return { cookies: allCookies, ok: true }
}

export async function getNonce(siteUrl: string, cookies: string): Promise<string> {
  const res = await fetch(`${siteUrl}/wp-admin/index.php`, {
    headers: {
      Cookie: cookies,
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,*/*',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  })
  const html = await res.text()
  let m = html.match(/createNonceMiddleware\("([^"]+)"\)/)
  if (m) return m[1]
  m = html.match(/"nonce"\s*:\s*"([a-zA-Z0-9]{8,12})"/)
  if (m) return m[1]
  m = html.match(/wpApiSettings\s*=\s*\{[^}]*?"nonce"\s*:\s*"([^"]+)"/)
  if (m) return m[1]
  throw new Error('Could not extract WP nonce. Make sure your credentials have administrator access.')
}
