// Pinterest API host. Trial-access apps may NOT create pins against
// production (api.pinterest.com) — Pinterest requires the Sandbox host
// for that until Standard access is granted. Flip this via env to
// record the approval demo against sandbox, then remove it (back to
// production) once Standard access is approved. Both the API calls and
// the OAuth token exchange below use BASE, so one switch moves the
// whole flow consistently.
//   Production (default): https://api.pinterest.com/v5
//   Sandbox (for demo):   set PINTEREST_API_BASE=https://api-sandbox.pinterest.com/v5
const BASE = (process.env.PINTEREST_API_BASE || 'https://api.pinterest.com/v5').replace(/\/+$/, '')

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

  /**
   * Create a VIDEO pin. Pinterest's v5 video flow is 4 steps:
   *   1. Register media (POST /media, media_type=video) → media_id + S3 upload form.
   *   2. Upload the bytes to the returned bucket (multipart form, fields + file).
   *   3. Poll GET /media/{id} until status='succeeded' (processing takes seconds).
   *   4. Create the pin with media_source.source_type='video_id' + a cover image
   *      (Pinterest requires a cover for video pins).
   */
  async createVideoPin(opts: {
    boardId: string
    title: string
    description: string
    link: string
    videoBytes: Uint8Array
    contentType?: string
    coverImageUrl: string
  }): Promise<{ id: string }> {
    const auth = { Authorization: `Bearer ${this.accessToken}` }

    // 1. Register the media upload.
    const reg = await fetch(`${BASE}/media`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: 'video' }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!reg.ok) {
      const err = await reg.json().catch(() => ({}))
      throw new Error(err.message || `Pinterest media register error: ${reg.status}`)
    }
    const media = await reg.json() as { media_id: string; upload_url: string; upload_parameters: Record<string, string> }

    // 2. Upload the bytes to the (S3) bucket — fields first, file LAST.
    const form = new FormData()
    for (const [k, v] of Object.entries(media.upload_parameters || {})) form.append(k, String(v))
    form.append('file', new Blob([opts.videoBytes as unknown as BlobPart], { type: opts.contentType || 'video/mp4' }))
    const up = await fetch(media.upload_url, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
    if (!up.ok && up.status !== 204) {
      throw new Error(`Pinterest media upload failed: ${up.status}`)
    }

    // 3. Poll until the video finishes processing.
    let status = 'registered'
    for (let i = 0; i < 30 && status !== 'succeeded'; i++) {
      await new Promise(r => setTimeout(r, 2500))
      const st = await fetch(`${BASE}/media/${media.media_id}`, { headers: auth })
      if (!st.ok) continue
      const j = await st.json() as { status?: string }
      status = j.status || status
      if (status === 'failed') throw new Error('Pinterest could not process the video.')
    }
    if (status !== 'succeeded') throw new Error('Pinterest is still processing the video — try again shortly.')

    // 4. Create the pin from the processed media + a cover image.
    const res = await fetch(`${BASE}/pins`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board_id: opts.boardId,
        title: opts.title,
        description: opts.description,
        link: opts.link,
        media_source: {
          source_type: 'video_id',
          media_id: media.media_id,
          cover_image_url: opts.coverImageUrl,
        },
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || `Pinterest video pin error: ${res.status}`)
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
    // Surface the real reason — body may be JSON or text (sandbox can
    // return non-JSON). Include status + host so a sandbox/prod mismatch
    // is obvious instead of a generic "callback_failed".
    const raw = await res.text().catch(() => '')
    let detail = raw
    try { const j = JSON.parse(raw); detail = j.message || j.error_description || j.error || raw } catch { /* keep raw */ }
    const host = BASE.replace(/^https?:\/\//, '').split('/')[0]
    throw new Error(`Token exchange ${res.status} @ ${host}: ${String(detail).slice(0, 200)}`)
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>
}

/**
 * Refresh a Pinterest access token using the stored refresh token. Pinterest
 * access tokens are short-lived (~30 days) while the refresh token lasts ~1
 * year, so the daily token-refresh cron calls this to keep the access token
 * alive without the creator ever reconnecting. Pinterest's refresh token is
 * NOT rotated on refresh (continuous refresh), so the caller keeps the same
 * refresh_token unless one is returned. Returns the new access token + expiry.
 */
export async function refreshPinterestToken(refreshToken: string): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
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
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    let detail = raw
    try { const j = JSON.parse(raw); detail = j.message || j.error_description || j.error || raw } catch { /* keep raw */ }
    throw new Error(`Pinterest token refresh ${res.status}: ${String(detail).slice(0, 200)}`)
  }
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>
}
