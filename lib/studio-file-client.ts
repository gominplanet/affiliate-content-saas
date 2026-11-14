// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE CREATOR'S OWN VIDEO, FROM YOUTUBE STUDIO, THROUGH SCOUT (Seb, 2026-11-14,
// a screenshot of Clip Factory's Shorts: "We couldn't fetch this video
// automatically: YouTube is refusing MVP's downloader right now (it asks it to
// sign in). Upload the MP4 instead").
//
// YouTube refuses downloads from MVP's server. Studio offers every channel
// owner a Download of their own videos, so SCOUT asks Studio for that file in
// the creator's own signed-in Chrome and uploads it straight to MVP
// (MVP_STUDIO_VIDEO_FILE, app/api/youtube/shorts/studio-file). Only the find
// moments panel used it; the Shorts cards and Shorts Studio told the creator
// to upload the MP4 by hand. All three now go through this. Browser only.

import { requestStudioVideoFile } from '@/lib/extension-frame'

/** Where the file goes: a long video's clip source, or a Short's own file. */
export type StudioFileTarget = 'source' | 'short'

export type StudioFileResult =
  | { ok: true; url: string | null }
  | { ok: false; code: string; why: string }

/** SCOUT's reason in a creator's words, ending with what to do instead
 *  (`instead`, e.g. "drop the file in the box"). Pure. */
export function studioFileWords(e: string, instead = 'upload the file instead'): string {
  const Instead = instead.charAt(0).toUpperCase() + instead.slice(1)
  if (e === 'not-installed') return `SCOUT is not installed in this browser. With it, MVP brings your own videos in from YouTube Studio. Or ${instead}.`
  if (e === 'needs-update') return `Update SCOUT to 1.21.22 or later, then try again. Or ${instead}.`
  if (e === 'signed-out') return 'YouTube Studio is signed out in this browser. Sign in at studio.youtube.com, then try again.'
  if (e === 'not-your-video') return 'YouTube Studio does not list this video for the account signed in here. Sign in to the channel that owns it, then try again.'
  if (e === 'no-download-url') return `YouTube Studio did not offer a download for this video. Download it in Studio (the ⋮ menu, then Download) and ${instead.replace(/ instead$/, '')}.`
  if (e === 'too-large') return 'The video is over 2 GB, too big for Clip Factory. Upload a smaller export of it.'
  if (e === 'timeout') return `It took too long. A long video can; try again, or ${instead}.`
  return `SCOUT could not bring the file in (${e || 'unknown'}). ${Instead}.`
}

const json = async (r: Response): Promise<Record<string, unknown>> => r.json().catch(() => ({}))

/** Ask SCOUT for this video's file from Studio and attach it in MVP. `videoId`
 *  is MVP's youtube_videos id. The url is the file MVP now holds. */
export async function fileFromStudio(videoId: string, target: StudioFileTarget, instead?: string): Promise<StudioFileResult> {
  try {
    const a = await fetch('/api/youtube/shorts/studio-file', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId, target }), signal: AbortSignal.timeout(30_000),
    })
    const aj = await json(a)
    if (!a.ok || !aj.uploadUrl) return { ok: false, code: 'no-upload', why: String(aj.error || 'MVP could not open an upload for the file.') }
    const r = await requestStudioVideoFile(String(aj.youtubeVideoId || ''), String(aj.uploadUrl), Number(aj.maxBytes) || 0)
    if (!r.ok) return { ok: false, code: r.error || 'unknown', why: studioFileWords(r.error || '', instead) }
    const at = await fetch('/api/youtube/shorts/studio-file', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId, path: aj.path, target }), signal: AbortSignal.timeout(60_000),
    })
    const atj = await json(at)
    if (!at.ok || !atj.ok) return { ok: false, code: 'attach', why: String(atj.error || 'The file did not attach.') }
    return { ok: true, url: typeof atj.url === 'string' ? atj.url : null }
  } catch (e) {
    return { ok: false, code: 'error', why: `MVP could not finish bringing it in from YouTube Studio (${e instanceof Error ? e.message : 'error'}).` }
  }
}
