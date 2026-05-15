const BASE = 'https://www.googleapis.com/youtube/v3'

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

    const videoIds = items.map((i: any) => i.snippet.resourceId.videoId).join(',')
    // Pull statistics + contentDetails together — contentDetails gives us
    // ISO-8601 duration which we use to classify Shorts (vertical) vs.
    // long-form. One batched call per page.
    const statsData = await this.get<any>('/videos', { part: 'statistics,contentDetails', id: videoIds })

    const statsMap: Record<string, number> = {}
    const durationMap: Record<string, number> = {}
    const SHORTS_TAG_RE = /#shorts\b/i
    for (const v of statsData.items ?? []) {
      statsMap[v.id] = parseInt(v.statistics?.viewCount ?? '0', 10)
      // Parse ISO duration like "PT1H2M3S" → seconds
      const iso: string = v.contentDetails?.duration ?? 'PT0S'
      const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
      const h = m?.[1] ? parseInt(m[1], 10) : 0
      const min = m?.[2] ? parseInt(m[2], 10) : 0
      const s = m?.[3] ? parseInt(m[3], 10) : 0
      durationMap[v.id] = h * 3600 + min * 60 + s
    }

    const videos = items.map((item: any) => {
      const s = item.snippet
      const videoId = s.resourceId.videoId
      const durationSeconds = durationMap[videoId] ?? 0
      const title: string = s.title ?? ''
      const description: string = s.description ?? ''
      const taggedAsShort = SHORTS_TAG_RE.test(title) || SHORTS_TAG_RE.test(description)
      const isVertical = (durationSeconds > 0 && durationSeconds <= 180) || taggedAsShort
      return {
        youtubeVideoId: videoId,
        title,
        description,
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
        isVertical,
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

    // Cap at 500 chars total (YouTube counts comma separators)
    const finalTags: string[] = []
    let total = 0
    for (const tag of sanitizedTags) {
      const addition = (finalTags.length > 0 ? 1 : 0) + tag.length
      if (total + addition > 480) break // stay safely under 500
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

  /**
   * List the authenticated user's recent vertical/Short videos.
   *
   * Heuristic: a video is treated as a Short candidate if duration ≤ 180s
   * (covers the newer YouTube Shorts duration cap) OR its title/description
   * contains "#Shorts" (creator convention). Many creators don't tag their
   * Shorts so we lean on duration as the primary signal. Long-form review
   * channels rarely produce <3-minute non-Short videos, so false positives
   * are minimal in practice. We pull the most recent N uploads, fetch
   * contentDetails (duration) in a single batched videos.list, and filter.
   *
   * If `asin` is provided, the matching Short (with that ASIN in the title)
   * is moved to the front of the returned list so the UI can highlight it
   * as the auto-suggested choice.
   */
  async getMyShorts(opts: { limit?: number; asin?: string | null } = {}): Promise<Array<{
    youtubeVideoId: string
    title: string
    thumbnailUrl: string
    durationSeconds: number
    publishedAt: string
    detectedAsin: string | null
    isAsinMatch: boolean
  }>> {
    const limit = opts.limit ?? 50
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channelData = await this.get<any>('/channels', { part: 'contentDetails', mine: 'true' })
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploadsPlaylistId) return []

    // Pull the most recent N uploads (1 page = max 50)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playlistData = await this.get<any>('/playlistItems', {
      part: 'snippet',
      playlistId: uploadsPlaylistId,
      maxResults: String(Math.min(limit, 50)),
    })
    const items = playlistData.items ?? []
    if (items.length === 0) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const videoIds = items.map((i: any) => i.snippet.resourceId.videoId).join(',')

    // Get contentDetails (duration) + snippet for each
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const videosData = await this.get<any>('/videos', {
      part: 'snippet,contentDetails',
      id: videoIds,
    })

    const asinRe = /\b([A-Z0-9]{10})\b/
    const SHORTS_TAG_RE = /#shorts\b/i
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shorts = (videosData.items ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((v: any) => {
        const isoDuration = v.contentDetails?.duration ?? 'PT0S'
        // Parse ISO 8601 duration → seconds (only seconds + minutes since
        // Shorts are < 60s but #Shorts-tagged videos might be longer)
        const m = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
        const hours = m?.[1] ? parseInt(m[1], 10) : 0
        const minutes = m?.[2] ? parseInt(m[2], 10) : 0
        const seconds = m?.[3] ? parseInt(m[3], 10) : 0
        const durationSeconds = hours * 3600 + minutes * 60 + seconds

        const title = v.snippet.title ?? ''
        const description = v.snippet.description ?? ''
        const taggedAsShort = SHORTS_TAG_RE.test(title) || SHORTS_TAG_RE.test(description)
        // Bumped from 60s → 180s to cover YouTube's expanded Shorts limit
        // (3 minutes) introduced in 2024. Long-form review channels rarely
        // produce <3min non-Short videos, so false positives are minimal.
        const looksLikeShort = durationSeconds > 0 && durationSeconds <= 180
        if (!looksLikeShort && !taggedAsShort) return null

        const asinMatch = title.match(asinRe)
        const detectedAsin = asinMatch ? asinMatch[1] : null
        const isAsinMatch = opts.asin ? detectedAsin === opts.asin : false

        return {
          youtubeVideoId: v.id,
          title,
          thumbnailUrl: v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url ?? '',
          durationSeconds,
          publishedAt: v.snippet.publishedAt,
          detectedAsin,
          isAsinMatch,
        }
      })
      .filter((v: unknown): v is NonNullable<typeof v> => v !== null)

    // Sort: ASIN match first, then by newest
    shorts.sort((a: { isAsinMatch: boolean; publishedAt: string }, b: { isAsinMatch: boolean; publishedAt: string }) => {
      if (a.isAsinMatch && !b.isAsinMatch) return -1
      if (!a.isAsinMatch && b.isAsinMatch) return 1
      return b.publishedAt.localeCompare(a.publishedAt)
    })

    return shorts
  }

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
   * Push the full Studio settings panel in one videos.update call.
   *
   * Inputs map to YouTube fields like this:
   *   madeForKids -> status.selfDeclaredMadeForKids
   *   paidPromotion -> status.containsPaidPromotion (paid disclosure)
   *   alteredContent -> status.containsSyntheticMedia (altered content)
   *   publishAt (ISO string) -> status.publishAt (schedules video for later
   *     and sets privacyStatus to 'private' until that time)
   *   privacyStatus -> public/unlisted/private (only used when publishAt
   *     is NOT set)
   *
   * `notifySubscribers` is passed as a URL query param to suppress the
   * "you have a new video" notification YT would otherwise send.
   */
  async updateVideoStatus(
    videoId: string,
    args: {
      madeForKids?: boolean
      paidPromotion?: boolean
      alteredContent?: boolean
      privacyStatus?: 'public' | 'unlisted' | 'private'
      publishAt?: string | null
      notifySubscribers?: boolean
    },
  ): Promise<void> {
    const status: Record<string, unknown> = {}
    if (typeof args.madeForKids === 'boolean') status.selfDeclaredMadeForKids = args.madeForKids
    if (typeof args.paidPromotion === 'boolean') status.containsPaidPromotion = args.paidPromotion
    if (typeof args.alteredContent === 'boolean') status.containsSyntheticMedia = args.alteredContent

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
