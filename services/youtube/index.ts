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
    const statsData = await this.get<any>('/videos', { part: 'statistics', id: videoIds })

    const statsMap: Record<string, number> = {}
    for (const v of statsData.items ?? []) {
      statsMap[v.id] = parseInt(v.statistics?.viewCount ?? '0', 10)
    }

    const videos = items.map((item: any) => {
      const s = item.snippet
      const videoId = s.resourceId.videoId
      return {
        youtubeVideoId: videoId,
        title: s.title,
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

  // List all videos for the authenticated user (includes private/draft)
  async getDraftVideos(maxResults = 50): Promise<DraftVideo[]> {
    // Get the authenticated user's channel
    const channelData = await this.get<any>('/channels', {
      part: 'contentDetails',
      mine: 'true',
    })
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploadsPlaylistId) throw new Error('No uploads playlist found')

    // List all videos (includes private)
    const playlistData = await this.get<any>('/playlistItems', {
      part: 'snippet,status',
      playlistId: uploadsPlaylistId,
      maxResults: String(Math.min(maxResults, 50)),
    })

    const items = playlistData.items ?? []
    if (items.length === 0) return []

    // Get full video details including status
    const videoIds = items.map((i: any) => i.snippet.resourceId.videoId).join(',')
    const videosData = await this.get<any>('/videos', {
      part: 'snippet,status',
      id: videoIds,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (videosData.items ?? []).map((v: any) => {
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
  }

  // Update a video's title, description, and tags
  async updateVideoMetadata(
    videoId: string,
    metadata: { title: string; description: string; tags: string[]; categoryId?: string },
  ): Promise<void> {
    const res = await fetch(`${BASE}/videos?part=snippet`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: videoId,
        snippet: {
          title: metadata.title.slice(0, 100),
          description: metadata.description.slice(0, 5000),
          tags: metadata.tags.slice(0, 500),
          categoryId: metadata.categoryId || '26', // 26 = Howto & Style
        },
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`YouTube update failed ${res.status}: ${body.slice(0, 300)}`)
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
