// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A vertical clip published as a Reel on the creator's Facebook Page, with
// Meta's Reels Publishing API: start an upload, hand Meta the clip's URL
// (it fetches the file itself, so nothing large passes through us), then
// finish with the caption and ask for it to be published.
//
// WHAT CAME BACK, NOT WHAT WAS ASKED. "Finish" only means Meta accepted the
// request; the Reel is then processed and can still fail (too long, wrong
// shape). So the status is read back for up to a minute and the answer says
// which it is: published, still processing (it will appear shortly), or
// failed with Meta's reason.
//
// Meta's limits for a Page Reel: 9:16, 3 to 90 seconds, at least 540x960.

import { discloseSocialPost } from '@/lib/social-disclaimer'

const GRAPH = 'https://graph.facebook.com/v21.0'

export type ReelResult =
  | { ok: true; videoId: string; state: 'published' | 'processing'; url: string }
  | { ok: false; error: string; step: 'start' | 'upload' | 'finish' | 'processing' }

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}
const metaError = (j: Record<string, unknown>, fallback: string) => {
  const e = j.error as { message?: string; error_user_msg?: string } | undefined
  return String(e?.error_user_msg || e?.message || fallback).slice(0, 300)
}

export async function publishPageReel(opts: { pageId: string; token: string; videoUrl: string; description: string }): Promise<ReelResult> {
  const { pageId, token } = opts
  const began = Date.now()
  // 1. Start: Meta gives a video id to upload into.
  const start = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}/video_reels`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_phase: 'start', access_token: token }),
    signal: AbortSignal.timeout(30_000),
  })
  const sj = await json(start)
  const videoId = String(sj.video_id || '')
  if (!start.ok || !videoId) return { ok: false, step: 'start', error: metaError(sj, `Facebook would not start the Reel upload (HTTP ${start.status}).`) }

  // 2. Upload by URL: Meta downloads the clip from where MVP stored it.
  const up = await fetch(`https://rupload.facebook.com/video-upload/v21.0/${encodeURIComponent(videoId)}`, {
    method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: opts.videoUrl },
    signal: AbortSignal.timeout(120_000),
  })
  const uj = await json(up)
  if (!up.ok || uj.success === false) return { ok: false, step: 'upload', error: metaError(uj, `Facebook could not fetch the clip (HTTP ${up.status}).`) }

  // 3. Finish and publish, with the caption.
  const fin = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}/video_reels`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', description: discloseSocialPost(opts.description, 'facebook').slice(0, 2000), access_token: token }),
    signal: AbortSignal.timeout(60_000),
  })
  const fj = await json(fin)
  if (!fin.ok || fj.success === false) return { ok: false, step: 'finish', error: metaError(fj, `Facebook did not accept the Reel (HTTP ${fin.status}).`) }

  // 4. Read back what happened to it, ON A DEADLINE. Twelve looks after the
  // three steps above could take the whole request past its time limit, after
  // the Reel was already published, so the creator saw an error and posted it
  // again. Past four minutes from the start it reports "processing", which is
  // true, and the Reel stays the one that was posted.
  const url = `https://www.facebook.com/reel/${videoId}`
  for (let i = 0; i < 12 && Date.now() - began < 240_000; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    try {
      const s = await fetch(`${GRAPH}/${encodeURIComponent(videoId)}?fields=status&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15_000) })
      const st = await json(s)
      const status = st.status as { video_status?: string; processing_phase?: { status?: string; error?: { message?: string } }; publishing_phase?: { status?: string; error?: { message?: string } } } | undefined
      const failed = status?.video_status === 'error' || status?.processing_phase?.status === 'error' || status?.publishing_phase?.status === 'error'
      if (failed) {
        const why = status?.processing_phase?.error?.message || status?.publishing_phase?.error?.message || 'Facebook could not process the clip.'
        return { ok: false, step: 'processing', error: why.slice(0, 300) }
      }
      if (status?.publishing_phase?.status === 'complete' || status?.video_status === 'ready') return { ok: true, videoId, state: 'published', url }
    } catch { /* read again */ }
  }
  return { ok: true, videoId, state: 'processing', url }
}
