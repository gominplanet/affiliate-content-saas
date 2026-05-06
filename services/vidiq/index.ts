// VidIQ API service
// Docs: https://developers.vidiq.com
// Users connect via VidIQ account — API key found in VidIQ dashboard → Settings → API

const BASE = 'https://api.vidiq.com'

export interface VidIQChannelStats {
  channelId: string
  title: string
  thumbnail: string
  currentStats: {
    subscribers: number
    views: number
    videos: number
  }
  growth: {
    subscribersGained: number
    viewsGained: number
    videosPublished: number
  }
  dailyStats: Array<{
    date: string
    subscribers: number
    views: number
    videos: number
  }>
  syncedAt: string
}

export interface VidIQKeywordResult {
  keyword: string
  score: number
  volume: number
  competition: number
  related: Array<{
    keyword: string
    score: number
    volume: number
    competition: number
  }>
}

export interface VidIQTranscript {
  videoId: string
  language: string
  text: string
  segments: Array<{ text: string; start: number; duration: number }>
}

export class VidIQService {
  constructor(private apiKey: string) {}

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${BASE}${path}`)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`VidIQ API error ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  async getChannelStats(channelId: string): Promise<VidIQChannelStats> {
    // TODO: wire to real VidIQ API endpoint when API key is available
    throw new Error('VidIQ API key required')
  }

  async getVideoTranscript(videoId: string, language = 'en'): Promise<VidIQTranscript> {
    // VidIQ transcript endpoint — key for blog generation pipeline
    throw new Error('VidIQ API key required')
  }

  async keywordResearch(keyword: string): Promise<VidIQKeywordResult> {
    throw new Error('VidIQ API key required')
  }
}

export function createVidIQService(apiKey: string) {
  return new VidIQService(apiKey)
}
