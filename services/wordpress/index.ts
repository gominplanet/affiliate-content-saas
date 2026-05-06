// WordPress REST API service
// Docs: https://developer.wordpress.org/rest-api/

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
  meta?: Record<string, unknown>
}

export interface WPPostResponse extends WPPost {
  id: number
  link: string
  date: string
  modified: string
}

export class WordPressService {
  private baseUrl: string
  private authHeader: string

  constructor(siteUrl: string, username: string, appPassword: string) {
    this.baseUrl = `${siteUrl.replace(/\/$/, '')}/wp-json/wp/v2`
    const encoded = Buffer.from(`${username}:${appPassword}`).toString('base64')
    this.authHeader = `Basic ${encoded}`
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader,
        ...options.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`WordPress API error ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  async createPost(post: WPPost): Promise<WPPostResponse> {
    // TODO: implement
    return this.request<WPPostResponse>('/posts', {
      method: 'POST',
      body: JSON.stringify(post),
    })
  }

  async updatePost(id: number, post: Partial<WPPost>): Promise<WPPostResponse> {
    // TODO: implement
    return this.request<WPPostResponse>(`/posts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(post),
    })
  }

  async publishPost(id: number): Promise<WPPostResponse> {
    return this.updatePost(id, { status: 'publish' })
  }

  async getPost(id: number): Promise<WPPostResponse> {
    return this.request<WPPostResponse>(`/posts/${id}`)
  }

  async checkConnection(): Promise<boolean> {
    try {
      await this.request('/users/me')
      return true
    } catch {
      return false
    }
  }
}

export function createWordPressService(siteUrl: string, username: string, appPassword: string) {
  return new WordPressService(siteUrl, username, appPassword)
}
