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
//
// ANSWER FAST, THEN WATCH (Seb, 2026-10-13: "the reel posted on my group
// just never reached the page"). The read-back below used to run inside the
// one request, up to four minutes after an upload that can take two, so the
// page showed a spinner and nothing else, and Vercel could cut it off at five.
// With wait: false the request answers as soon as Meta accepts the Reel, and
// the page reads its state with reelState(), saying each time what it is.
//
// LONGER THAN A REEL: a clip over REEL_MAX_SEC can never be a Page Reel, so
// publishPageVideo() posts it as an ordinary Page video, with the same words.

/** Meta takes Page Reels of 3 to 90 seconds. */
export const REEL_MAX_SEC = 90

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

export async function publishPageReel(opts: { pageId: string; token: string; videoUrl: string; description: string; wait?: boolean }): Promise<ReelResult> {
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
  if (!start.ok || sj.error || !videoId) return { ok: false, step: 'start', error: metaError(sj, `Facebook would not start the Reel upload (HTTP ${start.status}).`) }

  // 2. Upload by URL: Meta downloads the clip from where MVP stored it.
  const up = await fetch(`https://rupload.facebook.com/video-upload/v21.0/${encodeURIComponent(videoId)}`, {
    method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: opts.videoUrl },
    signal: AbortSignal.timeout(120_000),
  })
  const uj = await json(up)
  if (!up.ok || uj.error || uj.success === false) return { ok: false, step: 'upload', error: metaError(uj, `Facebook could not fetch the clip (HTTP ${up.status}).`) }

  // 3. Finish and publish, with the caption.
  const fin = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}/video_reels`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', description: discloseSocialPost(opts.description, 'facebook').slice(0, 2000), access_token: token }),
    signal: AbortSignal.timeout(60_000),
  })
  const fj = await json(fin)
  // A 200 CAN STILL BE A REFUSAL. Meta sometimes answers 200 with an `error`
  // object in the body; that is a failure with Meta's words, never "published".
  if (!fin.ok || fj.error || fj.success === false) return { ok: false, step: 'finish', error: metaError(fj, `Facebook did not accept the Reel (HTTP ${fin.status}).`) }

  // 4. Read back what happened to it, ON A DEADLINE. Twelve looks after the
  // three steps above could take the whole request past its time limit, after
  // the Reel was already published, so the creator saw an error and posted it
  // again. Past four minutes from the start it reports "processing", which is
  // true, and the Reel stays the one that was posted.
  const url = `https://www.facebook.com/reel/${videoId}`
  // The page watches it from here (reelState), so this request ends now.
  if (opts.wait === false) return { ok: true, videoId, state: 'processing', url }
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

/** Where a Reel or Page video stands now, in Meta's words. Pure of side
 *  effects: one read. */
export async function reelState(videoId: string, token: string): Promise<{ state: 'published' | 'processing' | 'failed' | 'unknown'; error?: string; phase?: string }> {
  try {
    const s = await fetch(`${GRAPH}/${encodeURIComponent(videoId)}?fields=status&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15_000) })
    const st = await json(s)
    if (!s.ok || st.error) return { state: 'unknown', error: metaError(st, `Facebook did not answer (HTTP ${s.status}).`) }
    const status = st.status as { video_status?: string; uploading_phase?: { status?: string }; processing_phase?: { status?: string; error?: { message?: string } }; publishing_phase?: { status?: string; error?: { message?: string } } } | undefined
    const failed = status?.video_status === 'error' || status?.processing_phase?.status === 'error' || status?.publishing_phase?.status === 'error'
    if (failed) return { state: 'failed', error: (status?.processing_phase?.error?.message || status?.publishing_phase?.error?.message || 'Facebook could not process the clip.').slice(0, 300) }
    if (status?.publishing_phase?.status === 'complete' || status?.video_status === 'ready') return { state: 'published' }
    const phase = status?.processing_phase?.status === 'in_progress' ? 'processing the video'
      : status?.uploading_phase?.status === 'in_progress' ? 'fetching the clip'
      : status?.publishing_phase?.status === 'in_progress' ? 'publishing' : 'processing'
    return { state: 'processing', phase }
  } catch (e) {
    return { state: 'unknown', error: e instanceof Error ? e.message : 'Facebook did not answer.' }
  }
}

/** A clip too long for a Reel, posted as an ordinary video on the Page, with
 *  the same words. Meta fetches the file from its address. */
export async function publishPageVideo(opts: { pageId: string; token: string; videoUrl: string; description: string }): Promise<ReelResult> {
  const res = await fetch(`${GRAPH}/${encodeURIComponent(opts.pageId)}/videos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_url: opts.videoUrl, description: discloseSocialPost(opts.description, 'facebook').slice(0, 5000), published: true, access_token: opts.token }),
    signal: AbortSignal.timeout(240_000),
  })
  const j = await json(res)
  const id = String(j.id || '')
  if (!res.ok || j.error || !id) return { ok: false, step: 'upload', error: metaError(j, `Facebook did not take the video (HTTP ${res.status}).`) }
  return { ok: true, videoId: id, state: 'processing', url: `https://www.facebook.com/watch/?v=${id}` }
}
