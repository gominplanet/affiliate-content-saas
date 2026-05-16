const BASE = 'https://www.googleapis.com/youtube/v3'

/**
 * Probe whether a video is a YouTube Short by checking the /shorts/ URL.
 *
 * YouTube's behavior:
 *   - For actual Shorts: youtube.com/shorts/<id> returns 200
 *   - For regular videos: youtube.com/shorts/<id> returns a 303 redirect
 *     to /watch?v=<id>
 *
 * This is the gold-standard detection — heuristics like duration ≤ 60s
 * or "#Shorts" in the description produce too many false positives
 * (many creators paste #shorts into every video's description for SEO).
 *
 * We use `redirect: 'manual'` so the redirect status is observable
 * instead of being followed silently. Resolves to false on network
 * failure (don't block the sync on this).
 */
export async function probeIsYouTubeShort(videoId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: 'HEAD',
      redirect: 'manual',
      headers: {
        // Some YT edge nodes return different bodies for headless clients
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 MVPAffiliateBot',
      },
    })
    return res.status >= 200 && res.status < 300
  } catch {
    return false
  }
}

/**
 * Classify a batch of videos as Short/not-Short in parallel.
 * Capped concurrency-wise by Promise.all on a small (≤50) array.
 */
export async function probeShortsBatch(videoIds: string[]): Promise<Record<string, boolean>> {
  const results = await Promise.all(
    videoIds.map(async id => [id, await probeIsYouTubeShort(id)] as const),
  )
  const map: Record<string, boolean> = {}
  for (const [id, isShort] of results) map[id] = isShort
  return map
}

export interface YouTubeVideo {
  youtubeVideoId: string
  title: string
  description: string
  thumbnailUrl: string
  channelId: string
  channelTitle: string
  publishedAt: string
  viewCount: number
  /** Total length in seconds (from ISO duration). 0 if unknown. */
  durationSeconds: number
  /**
   * True if this video looks like a vertical Short (≤ 180s OR has #Shorts
   * in title/description). Heuristic; not 100% accurate but good enough
   * for the Content page Vertical / Horizontal split.
   */
  isVertical: boolean
}

export class YouTubeService {
  constructor(private apiKey: string) {}

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${BASE}${path}`)
    url.searchParams.set('key', this.apiKey)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    const res = await fetch(url.toString())
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`YouTube API error ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  private async getUploadsPlaylistId(channelId: string): Promise<string> {
    const data = await this.get<any>('/channels', {
      part: 'contentDetails',
      id: channelId,
    })
    const playlistId = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!playlistId) throw new Error(`Channel not found: ${channelId}`)
    return playlistId
  }

  async getChannelVideos(
    channelId: string,
    maxResults = 50,
    pageToken?: string,
  ): Promise<{ videos: YouTubeVideo[]; nextPageToken?: string }> {
    const uploadsPlaylistId = await this.getUploadsPlaylistId(channelId)

    const params: Record<string, string> = {
      part: 'snippet',
      playlistId: uploadsPlaylistId,
      maxResults: String(Math.min(maxResults, 50)),
    }
    if (pageToken) params.pageToken = pageToken

    const playlistData = await this.get<any>('/playlistItems', params)

    const items = playlistData.items ?? []
    if (items.length === 0) return { videos: [] }

    const videoIds = items.map((i: any) => i.snippet.resourceId.videoId)
    const idsCsv = videoIds.join(',')
    // Pull statistics + contentDetails together — duration is used as the
    // displayed length, NOT for Short detection (we use the URL probe for that)
    const statsData = await this.get<any>('/videos', { part: 'statistics,contentDetails', id: idsCsv })

    const statsMap: Record<string, number> = {}
    const durationMap: Record<string, number> = {}
    for (const v of statsData.items ?? []) {
      statsMap[v.id] = parseInt(v.statistics?.viewCount ?? '0', 10)
      const iso: string = v.contentDetails?.duration ?? 'PT0S'
      const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
      const h = m?.[1] ? parseInt(m[1], 10) : 0
      const min = m?.[2] ? parseInt(m[2], 10) : 0
      const s = m?.[3] ? parseInt(m[3], 10) : 0
      durationMap[v.id] = h * 3600 + min * 60 + s
    }

    // Probe Short status via the /shorts/<id> URL behavior. Skip the probe
    // for videos with duration > 3 minutes — those can't possibly be Shorts
    // (YouTube's max Shorts length is 3 min), so the probe would waste a
    // network call.
    const candidates = videoIds.filter((id: string) => {
      const dur = durationMap[id] ?? 0
      // If duration is unknown (0) we probe anyway; if known and > 180, skip
      return dur === 0 || dur <= 180
    })
    const shortMap = await probeShortsBatch(candidates)

    const videos = items.map((item: any) => {
      const s = item.snippet
      const videoId = s.resourceId.videoId
      const durationSeconds = durationMap[videoId] ?? 0
      return {
        youtubeVideoId: videoId,
        title: s.title ?? '',
        description: s.description ?? '',
        thumbnailUrl:
          s.thumbnails?.maxres?.url ??
          s.thumbnails?.high?.url ??
          s.thumbnails?.default?.url ??
          '',
        channelId: s.channelId,
        channelTitle: s.channelTitle,
        publishedAt: s.publishedAt,
        viewCount: statsMap[videoId] ?? 0,
        durationSeconds,
        isVertical: shortMap[videoId] === true,
      }
    })

    return { videos, nextPageToken: playlistData.nextPageToken }
  }
}

export function createYouTubeService(apiKey: string) {
  return new YouTubeService(apiKey)
}

// ── OAuth-based YouTube service (read private videos + update metadata) ────────

export interface DraftVideo {
  youtubeVideoId: string
  title: string
  description: string
  thumbnailUrl: string
  status: 'private' | 'unlisted' | 'public'
  publishedAt: string
  detectedAsin: string | null
}

export class YouTubeOAuthService {
  constructor(private accessToken: string) {}

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${BASE}${path}`)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`YouTube API error ${res.status}: ${body.slice(0, 300)}`)
    }
    return res.json() as Promise<T>
  }

  // List videos for the authenticated user (includes private/draft), with pagination
  async getDraftVideos(
    maxResults = 25,
    pageToken?: string,
  ): Promise<{ videos: DraftVideo[]; nextPageToken?: string }> {
    // Get the authenticated user's channel
    const channelData = await this.get<any>('/channels', {
      part: 'contentDetails',
      mine: 'true',
    })
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploadsPlaylistId) throw new Error('No uploads playlist found')

    // List videos (includes private), one page at a time
    const params: Record<string, string> = {
      part: 'snippet,status',
      playlistId: uploadsPlaylistId,
      maxResults: String(Math.min(maxResults, 50)),
    }
    if (pageToken) params.pageToken = pageToken
    const playlistData = await this.get<any>('/playlistItems', params)

    const items = playlistData.items ?? []
    if (items.length === 0) return { videos: [], nextPageToken: undefined }

    // Get full video details including status
    const videoIds = items.map((i: any) => i.snippet.resourceId.videoId).join(',')
    const videosData = await this.get<any>('/videos', {
      part: 'snippet,status',
      id: videoIds,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const videos = (videosData.items ?? []).map((v: any) => {
      const asinMatch = v.snippet.title.match(/\b([A-Z0-9]{10})\b/)
      return {
        youtubeVideoId: v.id,
        title: v.snippet.title,
        description: v.snippet.description ?? '',
        thumbnailUrl: v.snippet.thumbnails?.high?.url ?? v.snippet.thumbnails?.default?.url ?? '',
        status: v.status?.privacyStatus ?? 'private',
        publishedAt: v.snippet.publishedAt,
        detectedAsin: asinMatch ? asinMatch[1] : null,
      }
    })

    return { videos, nextPageToken: playlistData.nextPageToken }
  }

  // Update a video's title, description, and tags
  async updateVideoMetadata(
    videoId: string,
    metadata: { title: string; description: string; tags: string[] },
  ): Promise<void> {
    // First fetch the existing snippet to preserve categoryId and other required fields
    const existing = await this.get<any>('/videos', {
      part: 'snippet',
      id: videoId,
    })
    const existingSnippet = existing.items?.[0]?.snippet ?? {}
    const categoryId = existingSnippet.categoryId || '22' // 22 = People & Blogs fallback

    // Sanitize tags — YouTube API is very strict about tag content
    const sanitizedTags = metadata.tags
      // Ensure every element is actually a string
      .map(t => String(t ?? ''))
      // Split on commas in case Claude returned "tag1, tag2" as one string
      .flatMap(t => t.split(','))
      // Strip ALL non-ASCII characters (curly quotes, em-dashes, etc.)
      .map(t => t.replace(/[^\x00-\x7F]/g, ''))
      // Strip characters YouTube explicitly rejects
      .map(t => t.replace(/[<>"#\[\]{}|\\^~`]/g, '').trim())
      // Collapse multiple spaces
      .map(t => t.replace(/\s+/g, ' ').trim())
      // Drop empty or too-long tags
      .filter(t => t.length > 0 && t.length <= 100)
      // Deduplicate
      .filter((t, i, arr) => arr.indexOf(t) === i)

    // Cap at 500 chars total. YouTube counts:
    //   - the tag itself, plus
    //   - a comma separator between tags, plus
    //   - TWO quote chars around any tag that contains a space (YT stores
    //     multi-word tags as "two words" with the quotes baked in).
    // The previous calc only counted commas, so multi-word-heavy tag lists
    // were silently rejected by the API and we'd retry without ANY tags.
    const finalTags: string[] = []
    let total = 0
    for (const tag of sanitizedTags) {
      const quoted = tag.includes(' ') ? tag.length + 2 : tag.length
      const addition = (finalTags.length > 0 ? 1 : 0) + quoted
      if (total + addition > 460) break // stay safely under 500 (was 480, now tighter)
      finalTags.push(tag)
      total += addition
    }

    const putHeaders = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    }

    const baseSnippet = {
      title: metadata.title.slice(0, 100),
      description: metadata.description.slice(0, 5000),
      categoryId,
      ...(existingSnippet.defaultLanguage
        ? { defaultLanguage: existingSnippet.defaultLanguage }
        : {}),
    }

    // Attempt 1: with tags
    const res = await fetch(`${BASE}/videos?part=snippet`, {
      method: 'PUT',
      headers: putHeaders,
      body: JSON.stringify({ id: videoId, snippet: { ...baseSnippet, tags: finalTags } }),
    })

    if (res.ok) return

    const body1 = await res.text()

    // If tags caused the 400, retry without them so title+description still apply
    if (res.status === 400 && body1.includes('invalidTags')) {
      console.warn('[youtube] Tags rejected, retrying without tags. Tags were:', JSON.stringify(finalTags))
      const res2 = await fetch(`${BASE}/videos?part=snippet`, {
        method: 'PUT',
        headers: putHeaders,
        body: JSON.stringify({ id: videoId, snippet: baseSnippet }),
      })
      if (!res2.ok) {
        const body2 = await res2.text()
        throw new Error(`YouTube update failed ${res2.status}: ${body2.slice(0, 500)}`)
      }
      return
    }

    throw new Error(`YouTube update failed ${res.status}: ${body1.slice(0, 500)}`)
  }

  // ── Pro batch-publish module ─────────────────────────────────────────
  // The methods below back the "Apply to YouTube" Pro feature: list the
  // creator's playlists for the dropdown, add a video to a playlist, and
  // push the full set of Studio-side toggles (privacy, schedule, made-for-
  // kids, paid promotion, etc.) in a single videos.update call.

  /** Return the authenticated user's own playlists (id + title). */
  async listMyPlaylists(): Promise<Array<{ id: string; title: string }>> {
    const all: Array<{ id: string; title: string }> = []
    let pageToken: string | undefined
    // YouTube caps maxResults at 50 — page through if the creator has more.
    do {
      const data = await this.get<{
        items?: Array<{ id: string; snippet: { title: string } }>
        nextPageToken?: string
      }>('/playlists', {
        part: 'snippet',
        mine: 'true',
        maxResults: '50',
        ...(pageToken ? { pageToken } : {}),
      })
      for (const p of data.items ?? []) {
        all.push({ id: p.id, title: p.snippet.title })
      }
      pageToken = data.nextPageToken
    } while (pageToken)
    return all
  }

  /** Add a video to a playlist. No-op if it's already there. */
  async addVideoToPlaylist(playlistId: string, videoId: string): Promise<void> {
    const res = await fetch(`${BASE}/playlistItems?part=snippet`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          playlistId,
          resourceId: { kind: 'youtube#video', videoId },
        },
      }),
    })
    // 409 conflict = video already in this playlist; treat as success.
    if (!res.ok && res.status !== 409) {
      const body = await res.text()
      throw new Error(`Add to playlist failed ${res.status}: ${body.slice(0, 300)}`)
    }
  }

  /**
   * Push the writable Studio settings in one videos.update call.
   *
   * Inputs map to YouTube fields like this:
   *   madeForKids -> status.selfDeclaredMadeForKids
   *   publishAt (ISO string) -> status.publishAt (schedules video for later
   *     and sets privacyStatus to 'private' until that time)
   *   privacyStatus -> public/unlisted/private (only used when publishAt
   *     is NOT set)
   *
   * `notifySubscribers` is passed as a URL query param to suppress the
   * "you have a new video" notification YT would otherwise send.
   *
   * NOT supported by YouTube's Data API and therefore not in this signature:
   * paidPromotion, alteredContent, monetization on/off, advertiser-friendly
   * content rating. The Studio panel surfaces those as a "Finish in Studio
   * (3 clicks)" post-apply checklist instead.
   */
  async updateVideoStatus(
    videoId: string,
    args: {
      madeForKids?: boolean
      privacyStatus?: 'public' | 'unlisted' | 'private'
      publishAt?: string | null
      notifySubscribers?: boolean
    },
  ): Promise<void> {
    const status: Record<string, unknown> = {}
    if (typeof args.madeForKids === 'boolean') status.selfDeclaredMadeForKids = args.madeForKids

    if (args.publishAt) {
      // YouTube requires privacyStatus=private to schedule.
      status.privacyStatus = 'private'
      status.publishAt = args.publishAt
    } else if (args.privacyStatus) {
      status.privacyStatus = args.privacyStatus
    }

    if (Object.keys(status).length === 0) return

    const params = new URLSearchParams({ part: 'status' })
    if (args.notifySubscribers === false) params.set('notifySubscribers', 'false')

    const res = await fetch(`${BASE}/videos?${params.toString()}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: videoId, status }),
    })
    if (!res.ok) {
      const body = await res.text()
      // Log the full exchange so we can diagnose what YT rejects — Vercel
      // logs strip nothing, the thrown message is truncated for the user.
      console.error('[youtube] status update rejected', {
        videoId,
        requestStatus: status,
        responseStatus: res.status,
        responseBody: body.slice(0, 1200),
      })
      throw new Error(`YouTube status update failed ${res.status}: ${body.slice(0, 500)}`)
    }

  }

  // Upload a custom thumbnail to YouTube for a video.
  // imageBuffer: raw image bytes; mimeType: 'image/jpeg' or 'image/png'
  async uploadThumbnail(videoId: string, imageBuffer: Buffer, mimeType: string): Promise<void> {
    const res = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': mimeType,
          'Content-Length': String(imageBuffer.length),
        },
        body: imageBuffer.buffer.slice(
          imageBuffer.byteOffset,
          imageBuffer.byteOffset + imageBuffer.byteLength,
        ) as ArrayBuffer,
      },
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`YouTube thumbnail upload failed ${res.status}: ${body.slice(0, 300)}`)
    }
  }
}

// Refresh an expired OAuth access token
export async function refreshYouTubeToken(refreshToken: string): Promise<{
  access_token: string
  expires_in: number
}> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }).toString(),
  })
  if (!res.ok) throw new Error('Failed to refresh YouTube token')
  return res.json()
}

// Get a valid access token, refreshing if needed
export async function getValidYouTubeToken(integration: Record<string, unknown>): Promise<string> {
  const expiry = integration.youtube_oauth_token_expiry as number | null
  const accessToken = integration.youtube_oauth_access_token as string | null
  const refreshToken = integration.youtube_oauth_refresh_token as string | null

  if (!accessToken) throw new Error('YouTube OAuth not connected')

  // Refresh if expired or expiring within 2 minutes
  if (expiry && Date.now() > expiry - 120_000) {
    if (!refreshToken) throw new Error('YouTube token expired and no refresh token available')
    const fresh = await refreshYouTubeToken(refreshToken)
    return fresh.access_token
  }

  return accessToken
}

export function createYouTubeOAuthService(accessToken: string) {
  return new YouTubeOAuthService(accessToken)
}
