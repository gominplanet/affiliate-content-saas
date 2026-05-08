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
