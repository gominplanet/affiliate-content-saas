// WordPress REST API service

export interface WPPost {
  id?: number
  title: string
  content: string
  excerpt?: string
  slug: string
  status: 'draft' | 'publish' | 'pending' | 'private'
  categories?: number[]
  tags?: number[]
  featured_media?: number
  comment_status?: 'open' | 'closed'
  ping_status?: 'open' | 'closed'
  /**
   * Registered post meta forwarded to the WP REST API. The MVP plugin
   * registers `mvp_jsonld` / `mvp_meta_description` / `mvp_og_image`
   * (show_in_rest) and the theme renders them in <head>. Only registered
   * keys are accepted by WordPress.
   */
  meta?: Record<string, string>
}

export interface WPPostResponse extends WPPost {
  id: number
  link: string
  date: string
  modified: string
}

export interface WPMediaResponse {
  id: number
  source_url: string
  link: string
}

export interface WPTagResponse {
  id: number
  name: string
  slug: string
}

// Shared across all service instances in a warm process so we don't
// re-POST /wp-login.php on every request (that pattern looks like a
// brute-force attack to WP security plugins and gets the account
// locked → "blog disconnected"). Keyed by siteUrl|username.
const SHARED_NONCE = new Map<string, { cookies: string; nonce: string; expiry: number }>()
// Circuit breaker: after a failed/blocked login we stop hitting
// wp-login.php for this site for a cooldown window and fail fast with
// an actionable message — never hammer the login form.
const LOGIN_BREAKER = new Map<string, number>() // key → cooldown-until ms
const LOGIN_COOLDOWN_MS = 15 * 60 * 1000

export class WordPressService {
  private baseUrl: string
  private siteUrl: string
  private authHeader: string
  private apiToken: string
  private username: string
  private password: string
  private nonceCache: { cookies: string; nonce: string; expiry: number } | null = null

  constructor(siteUrl: string, username: string, appPassword: string, apiToken?: string) {
    this.siteUrl = siteUrl.replace(/\/$/, '')
    this.baseUrl = `${this.siteUrl}/wp-json/wp/v2`
    const cleanPassword = appPassword.replace(/\s+/g, '')
    const encoded = Buffer.from(`${username}:${cleanPassword}`).toString('base64')
    this.authHeader = `Basic ${encoded}`
    this.apiToken = apiToken || ''
    this.username = username
    this.password = cleanPassword
  }

  // ── Nonce-based auth fallback (for hosts that strip Authorization headers) ──

  private get breakerKey(): string {
    return `${this.siteUrl}|${this.username}`
  }

  private async loginAndGetNonce(): Promise<{ cookies: string; nonce: string }> {
    const key = this.breakerKey
    // 1. Instance cache, then process-shared cache (warm Lambda reuse).
    if (this.nonceCache && Date.now() < this.nonceCache.expiry) {
      return this.nonceCache
    }
    const shared = SHARED_NONCE.get(key)
    if (shared && Date.now() < shared.expiry) {
      this.nonceCache = shared
      return shared
    }
    // 2. Circuit breaker — never hammer wp-login.php. If a recent login
    //    failed/was blocked, fail fast with an actionable message so the
    //    user's brute-force protection can stay ON.
    const cooldownUntil = LOGIN_BREAKER.get(key)
    if (cooldownUntil && Date.now() < cooldownUntil) {
      throw new Error(
        'WordPress writes are failing — your site is rejecting our requests. ' +
        'Run the connection doctor at /setup/wp-doctor — it identifies the exact plugin or firewall blocking us ' +
        '(Wordfence, SG Security, Cloudflare WAF, etc.) and gives you the click-by-click fix. ' +
        'Login attempts paused for 15 minutes to protect your account.',
      )
    }
    // wp-login.php expects the user's actual WP password (or Application
    // Password — both work via the form login). Previous versions of this
    // code fell back to this.apiToken when set; that field has been
    // re-purposed for the v1.0.25+ body-auth proxy secret and is no longer
    // a valid login password, so we always use this.password here.
    const loginPassword = this.password
    const loginBody = new URLSearchParams({
      log: this.username,
      pwd: loginPassword,
      'wp-submit': 'Log In',
      redirect_to: '/wp-admin/',
      testcookie: '1',
    })
    let loginRes: Response
    try {
      loginRes = await fetch(`${this.siteUrl}/wp-login.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: 'wordpress_test_cookie=WP+Cookie+check',
        },
        body: loginBody.toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      LOGIN_BREAKER.set(key, Date.now() + LOGIN_COOLDOWN_MS)
      throw new Error(`Could not reach WordPress sign-in (${e instanceof Error ? e.message : 'network error'}). Login attempts paused to protect your account.`)
    }

    // Use getSetCookie() if available (Node 18.14+) — forEach may merge multiple
    // Set-Cookie headers into one string on some runtimes, losing cookies like
    // wordpress_sec_* which are required for nonce validation.
    let rawCookies: string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (loginRes.headers as any).getSetCookie === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawCookies = (loginRes.headers as any).getSetCookie()
    } else {
      rawCookies = []
      loginRes.headers.forEach((val, key) => {
        if (key.toLowerCase() === 'set-cookie') {
          // val may be a comma-joined string of multiple cookies on some runtimes
          rawCookies.push(...val.split(/,(?=\s*\w[^=,]*=)/))
        }
      })
    }

    if (!rawCookies.some(c => c.includes('wordpress_logged_in_'))) {
      // Failed/blocked login — trip the breaker so we don't retry into a
      // brute-force lockout. Surface an actionable message.
      LOGIN_BREAKER.set(key, Date.now() + LOGIN_COOLDOWN_MS)
      throw new Error(
        'WordPress did not accept the connection — your security/brute-force plugin blocked the sign-in OR the saved Application Password is no longer valid. ' +
        'Two paths to fix: 1) Install/update the MVP Affiliate plugin v1.0.20+ on your site (it patches the most common Authorization-header issues). ' +
        '2) Disconnect WordPress in Site & Integrations and reconnect (the one-click flow mints a fresh Application Password). ' +
        'Visit /api/wordpress/debug-write to see exactly which layer is failing. Further attempts paused for 15 minutes.',
      )
    }
    const seen = new Set<string>()
    const cookieParts: string[] = []
    for (const raw of rawCookies) {
      const kv = raw.split(';')[0].trim()
      const key = kv.split('=')[0]
      if (!seen.has(key)) { seen.add(key); cookieParts.push(kv) }
    }
    const cookies = cookieParts.join('; ')

    // Try dedicated nonce endpoint first; fall back to scraping WP admin HTML
    // (the custom endpoint only exists on sites that ran the full setup wizard)
    let nonce = ''
    const nonceRes = await fetch(`${this.siteUrl}/wp-json/affiliateos/v1/nonce`, {
      headers: { Cookie: cookies },
    })
    if (nonceRes.ok) {
      const body = await nonceRes.json() as { nonce?: string }
      nonce = body.nonce ?? ''
    }
    if (!nonce) {
      const adminRes = await fetch(`${this.siteUrl}/wp-admin/index.php`, {
        headers: {
          Cookie: cookies,
          // Mimic a real browser so caching proxies don't serve a stripped page
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Referer: `${this.siteUrl}/wp-login.php`,
        },
      })
      const html = await adminRes.text()
      // Priority order: Gutenberg nonce middleware > wpApiSettings object > generic "nonce" key
      // The wp_rest nonce in wpApiSettings is always 10 alphanumeric chars
      const m = html.match(/createNonceMiddleware\(\s*["']([^"']+)["']\s*\)/)
        || html.match(/wpApiSettings\s*=\s*\{[^}]*?"nonce"\s*:\s*"([^"']{8,12})"/)
        || html.match(/"nonce"\s*:\s*"([a-zA-Z0-9]{8,12})"/)
      if (!m) throw new Error('Could not extract WP nonce. Make sure your credentials have admin access.')
      nonce = m[1]
    }

    // Success — clear any breaker and share the session process-wide so
    // subsequent requests reuse it instead of re-logging in.
    LOGIN_BREAKER.delete(key)
    const entry = { cookies, nonce, expiry: Date.now() + 10 * 60 * 1000 }
    this.nonceCache = entry
    SHARED_NONCE.set(key, entry)
    return entry
  }

  /** Body-auth proxy: POST to /affiliateos/v1/proxy with a JSON envelope
   *  carrying the auth token in the BODY (not the Authorization header).
   *  Plugin v1.0.25+ dispatches the inner request via rest_do_request()
   *  as the site's primary administrator.
   *
   *  Why this exists: some hosts (LiteSpeed on Hostinger, certain shared
   *  Apache configs) strip the Authorization header on POST requests
   *  before PHP sees it, breaking Basic Auth writes. Body-auth sidesteps
   *  that entirely.
   *
   *  Returns null when the proxy is unavailable (plugin <1.0.25 or token
   *  wrong) — caller falls back to the legacy Basic-Auth + nonce path. */
  private async tryProxyRequest<T>(path: string, options: RequestInit): Promise<T | null> {
    if (!this.apiToken) return null
    const method = (options.method || 'GET').toUpperCase()
    let bodyParsed: Record<string, unknown> | undefined
    if (options.body) {
      if (typeof options.body === 'string') {
        try { bodyParsed = JSON.parse(options.body) as Record<string, unknown> } catch { bodyParsed = undefined }
      } else if (
        typeof options.body === 'object' &&
        !(options.body instanceof FormData) &&
        !(options.body instanceof URLSearchParams) &&
        !(options.body instanceof Blob) &&
        !(options.body instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(options.body)
      ) {
        // Narrow via unknown — fetch's BodyInit is a union of binary types
        // we've already excluded above, but TS doesn't track the narrowing
        // across runtime guards.
        bodyParsed = options.body as unknown as Record<string, unknown>
      } else {
        // Binary body (image upload, etc.) — proxy doesn't support these
        // yet. Skip the proxy and fall through to legacy auth.
        return null
      }
    }
    // The proxy expects /wp/v2/* paths (the inner REST path). request()'s
    // `path` is already the relative form starting with /; combine with
    // the /wp/v2 prefix the WordPressService manages.
    const innerPath = `/wp/v2${path}`
    try {
      const res = await fetch(`${this.siteUrl}/wp-json/affiliateos/v1/proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({
          token: this.apiToken,
          method,
          path: innerPath,
          body: bodyParsed,
        }),
      })
      // Treat any non-2xx as "proxy unavailable, fall through to legacy auth":
      //   - 404 → plugin too old (no /proxy route)
      //   - 401 → bad token (secret stale)
      //   - 403 → host WAF (Wordfence, Sucuri, Hostinger, Cloudflare, etc.)
      //     blocking the request before it reaches WordPress
      //   - 429 → proxy's own brute-force cooldown
      //   - 5xx → transient server error
      // Surfacing these directly to the user as "WordPress proxy 4XX: <html…"
      // is unhelpful — the legacy chain's breaker + /setup/wp-doctor give a
      // far better error UX. If a body-content check reveals HTML (a WAF
      // page), we KNOW the underlying issue is a firewall block and the
      // legacy fallback will fail with the same root cause, so we still
      // surrender to the breaker path which carries the doctor link.
      if (!res.ok) return null
      // Some hosts return 200 with an HTML challenge page (Cloudflare's
      // "I'm Under Attack" mode) — treat that as a proxy miss too.
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) return null
      return await res.json() as T
    } catch {
      // Network errors / timeouts / DNS issues → fall through to the
      // legacy auth chain. The legacy path's own error handling + the
      // LOGIN_BREAKER message will carry the user to /setup/wp-doctor.
      return null
    }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const method = (options.method || 'GET').toUpperCase()
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

    // Multi-host header-strip workaround (Hostinger LiteSpeed, etc.): when
    // we have a body-auth proxy secret AND this is a write request, route
    // through /affiliateos/v1/proxy first. The proxy uses a JSON body field
    // for auth instead of the Authorization header, so it's immune to hosts
    // that strip the header on POST.
    //
    // Falls through to the legacy Basic-Auth + nonce chain when the proxy
    // isn't available (plugin <1.0.25, network error, etc.) so existing
    // installations keep working unchanged until they update the plugin.
    if (isWrite && this.apiToken) {
      const proxied = await this.tryProxyRequest<T>(path, options)
      if (proxied !== null) return proxied
    }

    const buildHeaders = (nonce?: { cookies: string; nonce: string }): Record<string, string> => {
      if (nonce) {
        return {
          Cookie: nonce.cookies,
          'X-WP-Nonce': nonce.nonce,
          // Referer makes the request look like it originates from the admin — some
          // security plugins reject REST calls without a recognisable referer.
          Referer: `${this.siteUrl}/wp-admin/`,
          Origin: this.siteUrl,
        }
      }
      return { Authorization: this.authHeader }
    }

    // When using nonce auth, also append _wpnonce as a query param — some hosts
    // (e.g. LiteSpeed on Hostinger) strip the X-WP-Nonce header before PHP sees it.
    const buildUrl = (nonce?: { nonce: string }) => {
      const url = `${this.baseUrl}${path}`
      return nonce ? `${url}${url.includes('?') ? '&' : '?'}_wpnonce=${nonce.nonce}` : url
    }

    const run = (authHeaders: Record<string, string>, nonce?: { cookies: string; nonce: string }) =>
      fetch(buildUrl(nonce), {
        ...options,
        headers: {
          // Browser-like UA so host WAFs / security plugins (Hostinger,
          // Wordfence, mod_security) don't intermittently 403 our REST writes —
          // they challenge no-UA / "node"-style agents. This is why a post can
          // publish (one write got through) yet a later meta write silently fails.
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          ...authHeaders,
          ...(options.headers as Record<string, string> || {}),
        },
      })

    let res = await run(buildHeaders())

    // On write 401/403, retry with login+nonce (server strips Authorization on POST)
    if ((res.status === 401 || res.status === 403) && isWrite) {
      const nonce = await this.loginAndGetNonce()
      res = await run(buildHeaders(nonce), nonce)

      // If nonce was rejected, clear cache and try one more time with a completely
      // fresh login — the nonce may have been stale or extracted incorrectly.
      if (res.status === 403) {
        const bodyText = await res.clone().text()
        if (bodyText.includes('rest_cookie_invalid_nonce') || bodyText.includes('cookie_invalid')) {
          // Stale nonce: force exactly one fresh login (the breaker still
          // guards against any runaway that could lock the account).
          this.nonceCache = null
          SHARED_NONCE.delete(this.breakerKey)
          const freshNonce = await this.loginAndGetNonce()
          res = await run(buildHeaders(freshNonce), freshNonce)
        }
      }
    }

    if (!res.ok) {
      const body = await res.text()
      // WAF / CDN block detection: a 403 with an HTML body (instead of WP's
      // usual JSON error) means a firewall in front of WordPress is blocking
      // us — Wordfence, Sucuri, Cloudflare, Hostinger WAF, etc. Pasting the
      // raw HTML into the user's error toast is unhelpful; point them at the
      // doctor which names the exact plugin/firewall and gives fix steps.
      const isHtml = body.trim().startsWith('<') || body.toLowerCase().includes('<html')
      if (res.status === 403 && isHtml) {
        throw new Error(
          'Your WordPress firewall (Wordfence, SG Security, Cloudflare, or similar) is blocking MVP from publishing. ' +
          'Run the Connection Doctor at /setup/wp-doctor — it identifies the exact plugin and gives click-by-click fix steps.',
        )
      }
      throw new Error(`WordPress ${res.status}: ${body.slice(0, 300)}`)
    }
    return res.json() as Promise<T>
  }

  // ── Custom endpoint (nonce fallback for non-/wp/v2 paths) ────────────────

  async postCustomEndpoint(fullPath: string, body: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: this.authHeader,
    }
    let res = await fetch(`${this.siteUrl}${fullPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (res.status === 401 || res.status === 403) {
      const nonce = await this.loginAndGetNonce()
      res = await fetch(`${this.siteUrl}${fullPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: nonce.cookies,
          'X-WP-Nonce': nonce.nonce,
        },
        body: JSON.stringify(body),
      })
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`WordPress ${res.status}: ${text.slice(0, 300)}`)
    }
    return res.json()
  }

  async getCustomEndpoint(fullPath: string): Promise<unknown> {
    const res = await fetch(`${this.siteUrl}${fullPath}`, {
      headers: { Authorization: this.authHeader },
    })
    if (!res.ok) return {}
    return res.json()
  }

  /**
   * IDs of every published post on the site. Used to reconcile our catalog
   * against what's ACTUALLY live — a post deleted/trashed in WordPress lingers
   * in our DB and would otherwise show as a phantom (404 link, "not on Google",
   * source video stuck on "published"). Goes through `request()` so it inherits
   * the browser-like UA + auth (+ nonce) path that survives Hostinger/SiteGround
   * WAFs — a plain bot-UA fetch gets challenged and silently returns garbage.
   * Returns null if the first page can't be read, so callers skip reconciliation
   * (a transient error must never hide real posts).
   */
  async getPublishedPostIds(): Promise<Set<number> | null> {
    const ids = new Set<number>()
    for (let page = 1; page <= 10; page++) {   // up to 1000 published posts
      let batch: Array<{ id?: number }>
      try {
        batch = await this.request<Array<{ id?: number }>>(
          `/posts?per_page=100&page=${page}&status=publish&_fields=id`,
        )
      } catch {
        // First page failing → can't read the site; a later page → past the end.
        return page === 1 ? null : (ids.size ? ids : null)
      }
      if (!Array.isArray(batch) || batch.length === 0) break
      for (const p of batch) { if (typeof p.id === 'number') ids.add(p.id) }
      if (batch.length < 100) break
    }
    return ids.size ? ids : null
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  async findOrCreateTag(name: string): Promise<number> {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const existing = await this.request<WPTagResponse[]>(
      `/tags?search=${encodeURIComponent(name)}&per_page=5`,
    )
    const match = existing.find(
      (t) => t.slug === slug || t.name.toLowerCase() === name.toLowerCase(),
    )
    if (match) return match.id
    const created = await this.request<WPTagResponse>('/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug }),
    })
    return created.id
  }

  async resolveTagIds(tagNames: string[]): Promise<number[]> {
    const ids = await Promise.all(tagNames.map((n) => this.findOrCreateTag(n)))
    return ids
  }

  // ── Media ─────────────────────────────────────────────────────────────────

  private async mediaUpload(
    buffer: Buffer,
    filename: string,
    contentType: string,
  ): Promise<WPMediaResponse> {
    const buildHeaders = (nonce?: { cookies: string; nonce: string }): Record<string, string> => ({
      ...(nonce
        ? { Cookie: nonce.cookies, 'X-WP-Nonce': nonce.nonce, Referer: `${this.siteUrl}/wp-admin/`, Origin: this.siteUrl }
        : { Authorization: this.authHeader }),
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Browser-like UA — same as request(). Without this, Node/undici's
      // default UA ("node" / "undici/x.y.z") trips Hostinger / Wordfence /
      // mod_security WAFs and the media upload silently 403s while regular
      // post writes (which DO set this UA via request()) sail through. This
      // is why in-article images were getting dropped on Hostinger sites.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    })

    const buildUrl = (nonce?: { nonce: string }) => {
      const url = `${this.baseUrl}/media`
      return nonce ? `${url}?_wpnonce=${nonce.nonce}` : url
    }

    const run = (h: Record<string, string>, nonce?: { nonce: string }) =>
      fetch(buildUrl(nonce), { method: 'POST', headers: h, body: buffer as BodyInit })

    let res = await run(buildHeaders())
    if (res.status === 401 || res.status === 403) {
      const nonce = await this.loginAndGetNonce()
      res = await run(buildHeaders(nonce), nonce)
      if (res.status === 403) {
        const bodyText = await res.clone().text()
        if (bodyText.includes('rest_cookie_invalid_nonce') || bodyText.includes('cookie_invalid')) {
          // Stale nonce: force exactly one fresh login (the breaker still
          // guards against any runaway that could lock the account).
          this.nonceCache = null
          SHARED_NONCE.delete(this.breakerKey)
          const freshNonce = await this.loginAndGetNonce()
          res = await run(buildHeaders(freshNonce), freshNonce)
        }
      }
    }
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`WP media upload ${res.status}: ${body.slice(0, 300)}`)
    }
    return res.json() as Promise<WPMediaResponse>
  }

  async uploadImageFromBase64(b64: string, filename: string, mimeType = 'image/png'): Promise<WPMediaResponse> {
    return this.mediaUpload(Buffer.from(b64, 'base64'), filename, mimeType)
  }

  async uploadImageFromUrl(imageUrl: string, filename: string): Promise<WPMediaResponse> {
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error(`Failed to fetch image from URL: ${imageUrl}`)
    const buffer = Buffer.from(await imgRes.arrayBuffer())
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
    return this.mediaUpload(buffer, filename, contentType)
  }

  // ── Posts ─────────────────────────────────────────────────────────────────

  async createPost(post: WPPost): Promise<WPPostResponse> {
    return this.request<WPPostResponse>('/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(post),
    })
  }

  async updatePost(id: number, post: Partial<WPPost>): Promise<WPPostResponse> {
    return this.request<WPPostResponse>(`/posts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(post),
    })
  }

  async deletePost(id: number): Promise<void> {
    await this.request(`/posts/${id}?force=true`, { method: 'DELETE' })
  }

  /** Best-effort site cache purge — re-POSTs the current customizations to the
   *  plugin, whose save handler runs litespeed_purge_all() + wp_cache_flush().
   *  Same proven path as the dashboard "Purge All" button.
   *
   *  CLOBBER-SAFE: we only POST `{}` when the GET *succeeded* and confirmed the
   *  site truly has no customizations. If the GET fails (timeout / WAF 403), we
   *  must NOT POST `{}` — that would persist empty and wipe live customizations
   *  (header banner, colors, etc.). In that case we POST the non-empty fallback
   *  if we have one, otherwise we skip the purge entirely. Non-fatal. */
  async purgeCache(fallbackCustomizations: unknown = {}): Promise<void> {
    try {
      const base = `${this.siteUrl}/wp-json/affiliateos/v1/customizations`
      const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      const headers = { 'Content-Type': 'application/json', 'Authorization': this.authHeader, 'User-Agent': UA }

      const hasData = (o: unknown): o is Record<string, unknown> =>
        !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o as object).length > 0

      let existing: unknown = {}
      let getOk = false
      try {
        const getRes = await fetch(base, { headers: { 'Authorization': this.authHeader, 'User-Agent': UA } })
        if (getRes.ok) { existing = await getRes.json(); getOk = true }
      } catch { /* GET failed — getOk stays false */ }

      let payload: unknown
      if (hasData(existing)) payload = existing               // live data → re-save (safe)
      else if (hasData(fallbackCustomizations)) payload = fallbackCustomizations // restore from DB
      else if (getOk) payload = {}                            // GET confirmed site is empty → {} is safe
      else return                                             // GET failed + no fallback → skip (never clobber)

      await fetch(base, { method: 'POST', headers, body: JSON.stringify(payload) })
    } catch { /* non-fatal — page refreshes on cache expiry */ }
  }

  /** Resolve a post id from its slug (for cleaning up posts whose
   *  blog_posts row never linked — e.g. campaign rows that errored). */
  async getPostIdBySlug(slug: string): Promise<number | null> {
    try {
      const posts = await this.request<{ id: number }[]>(
        `/posts?slug=${encodeURIComponent(slug)}&status=publish,future,draft,pending,private&per_page=1`,
      )
      return Array.isArray(posts) && posts[0]?.id ? posts[0].id : null
    } catch {
      return null
    }
  }

  /** Category names actually assigned to a published post (source of
   *  truth for "what niche is this post in"). */
  async getPostCategoryNames(postId: number): Promise<string[]> {
    try {
      const cats = await this.request<{ name: string }[]>(
        `/categories?post=${postId}&per_page=10&_fields=name`,
      )
      return Array.isArray(cats) ? cats.map(c => c.name).filter(Boolean) : []
    } catch {
      return []
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      await this.request('/users/me')
      return true
    } catch { return false }
  }

  async updateCurrentUserDisplayName(displayName: string): Promise<void> {
    await this.request('/users/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: displayName, nickname: displayName }),
    })
  }

  /**
   * Sync the author profile to WordPress so the (theme-default, byline-linked)
   * author archive page reads as a real author-authority page — bio +
   * website. Author-authority is a 2026 E-E-A-T ranking signal. Only fields
   * that are provided are written (we never fabricate / blank an existing bio).
   */
  async updateCurrentUserProfile(opts: { displayName?: string | null; bio?: string | null; url?: string | null }): Promise<void> {
    const body: Record<string, string> = {}
    if (opts.displayName && opts.displayName.trim()) {
      body.name = opts.displayName.trim()
      body.nickname = opts.displayName.trim()
    }
    if (opts.bio && opts.bio.trim()) body.description = opts.bio.trim()
    if (opts.url && /^https?:\/\//.test(opts.url.trim())) body.url = opts.url.trim()
    if (Object.keys(body).length === 0) return
    await this.request('/users/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  // ── Site setup ────────────────────────────────────────────────────────────

  async setSiteSettings(settings: Record<string, unknown>): Promise<void> {
    await this.request('/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
  }

  async createCategory(name: string): Promise<number> {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const wantName = name.trim().toLowerCase()

    // Look it up first. Match by slug OR name (case-insensitive) — niches
    // with an "&" (e.g. "Home & Kitchen") often have a WP slug that
    // doesn't equal our computed slug, so a slug-only check missed them
    // and we'd fall through to a create that 400s with `term_exists`.
    const findExisting = async (): Promise<number | null> => {
      for (const q of [`/categories?slug=${slug}&per_page=5`,
                        `/categories?search=${encodeURIComponent(name)}&per_page=20`]) {
        try {
          const rows = await this.request<{ id: number; slug: string; name: string }[]>(q)
          const hit = rows.find(c =>
            c.slug === slug || (c.name || '').trim().toLowerCase() === wantName)
          if (hit) return hit.id
        } catch { /* try next */ }
      }
      return null
    }

    const pre = await findExisting()
    if (pre) return pre

    try {
      const created = await this.request<{ id: number }>('/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug }),
      })
      return created.id
    } catch (err) {
      // Race or stale-search: another path already created it (WP returns
      // `term_exists`, sometimes with the id in the body). Recover instead
      // of failing the whole re-categorize.
      const m = String(err instanceof Error ? err.message : err).match(/"term_id"\s*:\s*(\d+)/)
      if (m) return parseInt(m[1], 10)
      const found = await findExisting()
      if (found) return found
      throw err
    }
  }

  async createPage(title: string, content: string): Promise<{ id: number; link: string }> {
    return this.request<{ id: number; link: string }>('/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, status: 'publish' }),
    })
  }

  async createNavMenu(name: string, items: { title: string; url: string }[]): Promise<void> {
    try {
      const menu = await this.request<{ id: number }>('/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, locations: ['primary', 'primary-menu', 'main-menu'] }),
      })
      await Promise.all(
        items.map((item, i) =>
          this.request('/menu-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: item.title, url: item.url, menus: menu.id, menu_order: i + 1, type: 'custom', status: 'publish' }),
          }),
        ),
      )
    } catch { /* non-fatal — user can assign menu manually */ }
  }

  // Inject CSS into WordPress Global Styles (block themes, WP 5.9+).
  // Falls back to Customizer additional_css for classic themes.
  // Idempotent — checks for a marker comment before writing.
  async injectGlobalCss(css: string, marker: string): Promise<boolean> {
    const marked = `/* ${marker} */\n${css}`
    // ── Try Global Styles API (block/FSE themes) ──────────────────────────
    try {
      const list = await this.request<{ id: number; styles?: { css?: string } }[]>(
        '/global-styles?per_page=1',
      )
      if (list.length) {
        const { id, styles } = list[0]
        const existing = styles?.css || ''
        if (existing.includes(marker)) return true // already injected
        await this.request(`/global-styles/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ styles: { ...styles, css: existing + '\n' + marked } }),
        })
        return true
      }
    } catch { /* not a block theme or no global styles — try next */ }

    // Classic theme fallback removed — was using wrong endpoint (/posts?type=custom_css)
    // which matched regular posts and corrupted their content. CSS is managed via
    // Customizer Additional CSS instead.
    return false
  }
}

export function createWordPressService(
  siteUrl: string,
  username: string,
  appPassword: string,
  apiToken?: string,
) {
  return new WordPressService(siteUrl, username, appPassword, apiToken)
}
