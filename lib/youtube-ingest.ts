// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Server-side video ingestion — the piece that lets Shorts Studio work WITHOUT
 * an upload (the vidIQ "select a video → Get clips" flow).
 *
 * YouTube's ToS-respecting reality: we can't pull the video from a Vercel
 * serverless function (blocked IPs, no yt-dlp binary, no long-running process).
 * So we call out to a small, always-on downloader service the operator deploys
 * (see ingest-service/). It fetches the creator's own video, uploads the MP4 to
 * our Supabase storage, and returns the public URL — which then feeds Whisper
 * (transcript) and Cloudinary (render), exactly like a manual upload would.
 *
 * ENTIRELY env-gated: with YOUTUBE_INGEST_URL unset this is a no-op and the
 * feature falls back to the manual upload. Nothing changes until it's wired.
 *
 * Contract (POST `${YOUTUBE_INGEST_URL}/ingest`, header x-ingest-secret):
 *   req:  { videoId: "<11-char youtube id>" }
 *   res:  { url: "https://…/source.mp4", durationSeconds: number }
 */

export function ingestConfigured(): boolean {
  return !!process.env.YOUTUBE_INGEST_URL
}

export interface IngestResult {
  url: string
  durationSeconds: number | null
}

/**
 * Ask the downloader service to fetch a YouTube video and return a hosted MP4
 * URL. Returns null when unconfigured or on any failure — the caller then falls
 * back to prompting the creator to upload the file.
 */
export async function ingestYouTubeVideo(youtubeVideoId: string, userId?: string): Promise<IngestResult | null> {
  const base = (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
  if (!base || !youtubeVideoId) return null
  try {
    const res = await fetch(`${base}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.YOUTUBE_INGEST_SECRET ? { 'x-ingest-secret': process.env.YOUTUBE_INGEST_SECRET } : {}),
      },
      body: JSON.stringify({ videoId: youtubeVideoId, ...(userId ? { userId } : {}) }),
      // Downloading + uploading a long video takes a while; give the service room.
      signal: AbortSignal.timeout(280_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { url?: string; durationSeconds?: number }
    if (!data?.url || !/^https:\/\//i.test(data.url)) return null
    return { url: data.url, durationSeconds: Number.isFinite(Number(data.durationSeconds)) ? Number(data.durationSeconds) : null }
  } catch {
    return null
  }
}
