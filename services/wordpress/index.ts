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
  private authHeader: string

  constructor(siteUrl: string, username: string, appPassword: string) {
    this.baseUrl = `${siteUrl.replace(/\/$/, '')}/wp-json/wp/v2`
    const cleanPassword = appPassword.replace(/\s+/g, '')
    const encoded = Buffer.from(`${username}:${cleanPassword}`).toString('base64')
    this.authHeader = `Basic ${encoded}`
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        ...options.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`WordPress ${res.status}: ${body.slice(0, 300)}`)
    }
    return res.json() as Promise<T>
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

  async uploadImageFromBase64(
    b64: string,
    filename: string,
    mimeType = 'image/png',
  ): Promise<WPMediaResponse> {
    const buffer = Buffer.from(b64, 'base64')
    const res = await fetch(`${this.baseUrl}/media`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body: buffer,
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`WP media upload ${res.status}: ${body.slice(0, 300)}`)
    }
    return res.json() as Promise<WPMediaResponse>
  }

  async uploadImageFromUrl(imageUrl: string, filename: string): Promise<WPMediaResponse> {
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error(`Failed to fetch image from URL: ${imageUrl}`)
    const buffer = Buffer.from(await imgRes.arrayBuffer())
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
    const res = await fetch(`${this.baseUrl}/media`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body: buffer,
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`WP media upload ${res.status}: ${body.slice(0, 300)}`)
    }
    return res.json() as Promise<WPMediaResponse>
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

  async checkConnection(): Promise<boolean> {
    try {
      await this.request('/users/me')
      return true
    } catch { return false }
  }
}

export function createWordPressService(
  siteUrl: string,
  username: string,
  appPassword: string,
) {
  return new WordPressService(siteUrl, username, appPassword)
}
