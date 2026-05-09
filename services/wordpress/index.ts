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

  private async loginAndGetNonce(): Promise<{ cookies: string; nonce: string }> {
    if (this.nonceCache && Date.now() < this.nonceCache.expiry) {
      return this.nonceCache
    }
    // apiToken holds the real WP password when set by connect-and-setup.
    // For gominreviews.com it holds an API token but we never reach this path there.
    const loginPassword = this.apiToken || this.password
    const loginBody = new URLSearchParams({
      log: this.username,
      pwd: loginPassword,
      'wp-submit': 'Log In',
      redirect_to: '/wp-admin/',
      testcookie: '1',
    })
    const loginRes = await fetch(`${this.siteUrl}/wp-login.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: 'wordpress_test_cookie=WP+Cookie+check',
      },
      body: loginBody.toString(),
      redirect: 'manual',
    })
    const rawCookies: string[] = []
    loginRes.headers.forEach((val, key) => {
      if (key.toLowerCase() === 'set-cookie') rawCookies.push(val)
    })
    if (!rawCookies.some(c => c.includes('wordpress_logged_in_'))) {
      throw new Error('WordPress login failed — credentials may have changed')
    }
    const seen = new Set<string>()
    const cookieParts: string[] = []
    for (const raw of rawCookies) {
      const kv = raw.split(';')[0].trim()
      const key = kv.split('=')[0]
      if (!seen.has(key)) { seen.add(key); cookieParts.push(kv) }
    }
    const cookies = cookieParts.join('; ')
    const adminRes = await fetch(`${this.siteUrl}/wp-admin/index.php`, {
      headers: { Cookie: cookies },
    })
    const html = await adminRes.text()
    let m = html.match(/createNonceMiddleware\("([^"]+)"\)/)
    if (!m) m = html.match(/"nonce"\s*:\s*"([^"]+)"/)
    if (!m) throw new Error('Could not extract REST API nonce from WP admin')
    this.nonceCache = { cookies, nonce: m[1], expiry: Date.now() + 20 * 60 * 1000 }
    return this.nonceCache
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const method = (options.method || 'GET').toUpperCase()
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

    const buildHeaders = (nonce?: { cookies: string; nonce: string }): Record<string, string> => {
      if (nonce) return { Cookie: nonce.cookies, 'X-WP-Nonce': nonce.nonce }
      return { Authorization: this.authHeader }
    }

    const run = (authHeaders: Record<string, string>) =>
      fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: { ...authHeaders, ...(options.headers as Record<string, string> || {}) },
      })

    let res = await run(buildHeaders())

    // On write 401/403, retry with login+nonce (server strips Authorization on POST)
    if ((res.status === 401 || res.status === 403) && isWrite) {
      const nonce = await this.loginAndGetNonce()
      res = await run(buildHeaders(nonce))
    }

    if (!res.ok) {
      const body = await res.text()
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
        ? { Cookie: nonce.cookies, 'X-WP-Nonce': nonce.nonce }
        : { Authorization: this.authHeader }),
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    })

    const run = (h: Record<string, string>) =>
      fetch(`${this.baseUrl}/media`, { method: 'POST', headers: h, body: buffer as BodyInit })

    let res = await run(buildHeaders())
    if (res.status === 401 || res.status === 403) {
      const nonce = await this.loginAndGetNonce()
      res = await run(buildHeaders(nonce))
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
    // Check if already exists
    try {
      const existing = await this.request<{ id: number; slug: string }[]>(
        `/categories?search=${encodeURIComponent(name)}&per_page=5`,
      )
      const match = existing.find(c => c.slug === slug)
      if (match) return match.id
    } catch { /* proceed to create */ }
    const created = await this.request<{ id: number }>('/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug }),
    })
    return created.id
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
