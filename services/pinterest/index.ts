const BASE = 'https://api.pinterest.com/v5'

export class PinterestService {
  constructor(private accessToken: string) {}

  async getBoards(): Promise<{ id: string; name: string }[]> {
    const res = await fetch(`${BASE}/boards?page_size=50`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    })
    if (!res.ok) throw new Error(`Pinterest boards error: ${res.status}`)
    const data = await res.json() as { items: { id: string; name: string }[] }
    return data.items ?? []
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
    })
    if (!res.ok) {
      const err = await res.json()
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
    })
    if (!res.ok) {
      const err = await res.json()
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
