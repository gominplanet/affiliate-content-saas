const BASE = 'https://api.pinterest.com/v5'

export class PinterestService {
  constructor(private accessToken: string) {}

  async getBoards(): Promise<{ id: string; name: string }[]> {
    const res = await fetch(`${BASE}/boards?page_size=100`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    })
    if (!res.ok) throw new Error(`Pinterest boards error: ${res.status}`)
    const data = await res.json() as { items: { id: string; name: string }[] }
    return data.items ?? []
  }

  /** Find a board by name (case-insensitive) or create it. Used so each
   *  blog-post category gets its own board automatically. */
  async findOrCreateBoard(name: string): Promise<{ id: string; name: string }> {
    const wanted = name.trim()
    const boards = await this.getBoards()
    const match = boards.find(b => b.name.trim().toLowerCase() === wanted.toLowerCase())
    if (match) return match
    const res = await fetch(`${BASE}/boards`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: wanted, privacy: 'PUBLIC' }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || `Pinterest board create error: ${res.status}`)
    }
    return res.json() as Promise<{ id: string; name: string }>
  }

  async createPin(opts: {
    boardId: string
    title: string
    description: string
    imageUrl: string
    link: string
  }): Promise<{ id: string }> {
    const res = await fetch(`${BASE}/pins`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        board_id: opts.boardId,
        title: opts.title,
        description: opts.description,
        link: opts.link,
        media_source: {
          source_type: 'image_url',
          url: opts.imageUrl,
        },
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || `Pinterest pin error: ${res.status}`)
    }
    return res.json() as Promise<{ id: string }>
  }
  async createPinWithBase64(opts: {
    boardId: string
    title: string
    description: string
    imageBase64: string
    mediaType: string
    link: string
  }): Promise<{ id: string }> {
    const res = await fetch(`${BASE}/pins`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        board_id: opts.boardId,
        title: opts.title,
        description: opts.description,
        link: opts.link,
        media_source: {
          source_type: 'image_base64',
          data: opts.imageBase64,
          content_type: opts.mediaType,
        },
      }),
      signal: AbortSignal.timeout(50_000),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || `Pinterest pin error: ${res.status}`)
    }
    return res.json() as Promise<{ id: string }>
  }
}

export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const appId = process.env.PINTEREST_APP_ID!
  const appSecret = process.env.PINTEREST_APP_SECRET!
  const credentials = Buffer.from(`${appId}:${appSecret}`).toString('base64')

  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.message || 'Token exchange failed')
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>
}
