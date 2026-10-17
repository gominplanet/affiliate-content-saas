// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DROP: EVERY OTHER PLACE A VIDEO GOES, one handler each, each a call to the
// engine that already does that job, with the creator's own session:
//
//   tiktok     POST /api/tiktok/publish-burned, then its status read back
//   instagram  POST /api/instagram/publish-burned (a Reel)
//   shorts     POST /api/youtube/upload-short
//   facebook   POST /api/clip-factory/facebook-reel (a Reel on the Page)
//   pinterest  POST /api/pinterest/video-pin (a video pin)
//   amazon     a Liftoff batch of its own, Amazon only, for a vertical video
//   clips      Clip Factory: Find Moments (3) and render each, from the
//              YouTube video Liftoff made
//
// (pin and group ride on the blog post as its Pinterest and Facebook socials:
// lib/drop-run.)
//
// A HANDLER ANSWERS WITH A STATE, never by throwing: done, failed, needs_you
// (only the creator can move it on), or wanted (come back on the next pass,
// with what was done so far in `payload`). Captions are composed the way Clip
// Factory composes them (lib/clip-description), with each platform's hashtag
// rule applied last (lib/hashtag-engine fitHashtags). Pure but for the calls
// passed in, so scripts/test-drop.ts runs them without a network.

import { composeClipDescription, CLIP_PLATFORM_RULES, stripHashtags, type ClipPlatform } from '@/lib/clip-description'
import { fitHashtags, TAG_RULES, type TagPlatform } from '@/lib/hashtag-engine'
import { nextForBatch } from '@/lib/drop-plan'
import type { Http, HttpAnswer } from '@/lib/drop-run'

export interface SendJob {
  id: string
  place: string
  state: string
  payload: Record<string, unknown>
}

export interface SendItem {
  id: string
  file_name: string | null
  source_url: string | null
  duration_seconds: number | null
  asin: string | null
  title: string | null
}

/** The YouTube side of a long video, as Liftoff reports it. */
export interface SendLaunchItem { state: string; video_id?: string | null; youtube_video_id?: string | null; publish_at?: string | null }

export interface SendOutcome {
  state: 'done' | 'failed' | 'needs_you' | 'wanted'
  detail: string | null
  url?: string | null
  refId?: string | null
  payload?: Record<string, unknown>
}

export interface PlaceDeps {
  http: Http
  /** The video pin helper (lib/pinterest-video-pin), which waits out Pinterest. */
  videoPin?: (body: Record<string, unknown>) => Promise<{ ok: true; pinId: string | null; board: string | null } | { ok: false; error: string }>
  timezone?: string
  /** Waits between TikTok status reads (ms); 0 in tests. */
  waitMs?: number
}

const err = (a: HttpAnswer, fallback: string) => String(a.json.error || a.json.message || '') || (a.status ? `${fallback} (${a.status})` : fallback)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const TAGS = /(^|\s)(#[\p{L}\p{N}_]+)/gu

/** The words the creator wrote for the video, or MVP's, made once and kept. */
async function writeUpFor(job: SendJob, it: SendItem, http: Http): Promise<{ text: string; payload: Record<string, unknown> }> {
  const typed = str(job.payload.caption).trim()
  if (typed) return { text: typed, payload: {} }
  const kept = str(job.payload.written).trim()
  if (kept) return { text: kept, payload: {} }
  if (it.asin) {
    const r = await http('/api/amazon/social-caption', { method: 'POST', body: { network: 'instagram', asin: it.asin }, timeoutMs: 90_000 })
    const c = r.ok ? str(r.json.caption).trim() : ''
    if (c) return { text: c, payload: { written: c } }
  }
  return { text: '', payload: {} }
}

/** A platform's description, composed the way Clip Factory composes one. */
async function describe(platform: ClipPlatform, writeUp: string, it: SendItem, http: Http): Promise<string> {
  const kit = await http('/api/clip-factory/publish-kit', { method: 'POST', body: { platform, product: it.asin || undefined, writeUp } })
  const k = kit.ok ? kit.json : {}
  const tagPlatform: TagPlatform = platform === 'youtube' ? 'youtube_short' : platform
  // The discovery tags only, as many as the platform rewards: the disclosure
  // (#ad) comes from the kit once, never twice.
  const hashtags = [...new Set([...writeUp.matchAll(TAGS)].map((m) => m[2]))]
    .filter((t) => !/^#(ad|ads|sponsored|affiliate|paid|partner)$/i.test(t)).slice(0, TAG_RULES[tagPlatform].max)
  const text = composeClipDescription({
    platform, writeUp, include: CLIP_PLATFORM_RULES[platform].defaults,
    productLink: str(k.productLink) || null, amazon: k.amazon === true, videoUrl: str(k.videoUrl) || null,
    blogUrl: str(k.blogUrl) || null, linkHub: str(k.linkHub) || null, hashtags, disclosure: str(k.disclosure),
  })
  return fitHashtags(text, tagPlatform)
}

const firstLine = (t: string) => stripHashtags(t).split('\n').map((x) => x.trim()).find(Boolean) || ''
const baseName = (n: string | null) => String(n || 'video').replace(/\.[^.]+$/, '')

// ── one handler per place ────────────────────────────────────────────────────

async function tiktok(job: SendJob, it: SendItem, d: PlaceDeps): Promise<SendOutcome> {
  // Already handed to TikTok: read back what TikTok did with it.
  const publishId = str(job.payload.publishId)
  if (publishId) {
    for (let i = 0; i < 6; i++) {
      const s = await d.http(`/api/tiktok/publish-burned/status?publishId=${encodeURIComponent(publishId)}`)
      const status = str(s.json.status)
      if (status === 'published') return { state: 'done', detail: 'Posted to your TikTok', url: str(s.json.shareUrl) || null, refId: publishId }
      if (status === 'inbox') return { state: 'needs_you', detail: 'In your TikTok inbox. Open TikTok to post it.', refId: publishId }
      if (status === 'failed') return { state: 'failed', detail: str(s.json.errorMessage) || 'TikTok did not post it.', refId: publishId }
      if (i < 5) await new Promise((r) => setTimeout(r, d.waitMs ?? 10_000))
    }
    return { state: 'wanted', detail: 'TikTok is still processing it', refId: publishId }
  }
  const privacyLevel = str(job.payload.privacyLevel)
  if (!privacyLevel) return { state: 'needs_you', detail: 'Pick who can see it on TikTok, then press Try again.' }
  const w = await writeUpFor(job, it, d.http)
  const caption = (await describe('tiktok', w.text, it, d.http)).slice(0, 2200)
  const r = await d.http('/api/tiktok/publish-burned', { method: 'POST', timeoutMs: 300_000, body: {
    videoUrl: it.source_url, caption, privacyLevel,
    disableComment: job.payload.allowComment !== true, disableDuet: job.payload.allowDuet !== true, disableStitch: job.payload.allowStitch !== true,
    brandContentToggle: job.payload.brandedPartnership === true, brandOrganicToggle: job.payload.brandedContent === true,
    product: it.asin || undefined,
  } })
  if (!r.ok) return { state: r.status === 412 ? 'needs_you' : 'failed', detail: err(r, 'TikTok did not take it'), payload: w.payload }
  const id = str(r.json.publishId)
  if (!id) return { state: 'failed', detail: 'TikTok gave no publish id.', payload: w.payload }
  // Read back on the next pass, so this pass is not held.
  return { state: 'wanted', detail: 'Sent to TikTok, waiting for it to post', refId: id, payload: { ...w.payload, publishId: id } }
}

async function instagram(job: SendJob, it: SendItem, d: PlaceDeps): Promise<SendOutcome> {
  const w = await writeUpFor(job, it, d.http)
  const caption = (await describe('instagram', w.text, it, d.http)).slice(0, 2200)
  const r = await d.http('/api/instagram/publish-burned', { method: 'POST', timeoutMs: 300_000, body: {
    videoUrl: it.source_url, caption: caption || undefined, product: it.asin || undefined,
  } })
  if (!r.ok) return { state: 'failed', detail: err(r, 'Instagram did not take it'), payload: w.payload }
  if (r.json.published === false) return { state: 'failed', detail: 'Instagram took the upload but did not publish it.', payload: w.payload }
  return { state: 'done', detail: 'Posted as a Reel', refId: str(r.json.mediaId) || null, payload: w.payload }
}

async function shorts(job: SendJob, it: SendItem, d: PlaceDeps): Promise<SendOutcome> {
  const w = await writeUpFor(job, it, d.http)
  const description = (await describe('youtube', w.text, it, d.http)).slice(0, 4800)
  const title = (str(job.payload.title).trim() || firstLine(w.text) || baseName(it.file_name)).slice(0, 95)
  const r = await d.http('/api/youtube/upload-short', { method: 'POST', timeoutMs: 300_000, body: {
    videoUrl: it.source_url, title, description, privacyStatus: 'public',
  } })
  if (!r.ok) {
    if (r.json.quotaExceeded) return { state: 'needs_you', detail: 'YouTube’s daily upload allowance is used up. Press Try again tomorrow.', payload: w.payload }
    return { state: r.status === 412 ? 'needs_you' : 'failed', detail: err(r, 'YouTube did not take it'), payload: w.payload }
  }
  return { state: 'done', detail: 'Posted as a Short', url: str(r.json.url) || null, refId: str(r.json.videoId) || null, payload: w.payload }
}

async function facebook(job: SendJob, it: SendItem, d: PlaceDeps): Promise<SendOutcome> {
  const w = await writeUpFor(job, it, d.http)
  const description = (await describe('facebook', w.text, it, d.http)).slice(0, 2000)
  const r = await d.http('/api/clip-factory/facebook-reel', { method: 'POST', timeoutMs: 300_000, body: {
    videoUrl: it.source_url, description, product: it.asin || undefined, wait: true, clipSeconds: it.duration_seconds || undefined,
  } })
  if (!r.ok) return { state: 'failed', detail: err(r, 'Facebook did not take it'), payload: w.payload }
  const kind = str(r.json.kind) === 'video' ? 'a video (it is over 90 seconds)' : 'a Reel'
  return { state: 'done', detail: `Posted on ${str(r.json.page) || 'your Page'} as ${kind}`, url: str(r.json.url) || null, refId: str(r.json.videoId) || null, payload: w.payload }
}

async function pinterest(job: SendJob, it: SendItem, d: PlaceDeps): Promise<SendOutcome> {
  const w = await writeUpFor(job, it, d.http)
  const title = (str(job.payload.title).trim() || firstLine(w.text) || baseName(it.file_name)).slice(0, 100)
  const description = fitHashtags(w.text, 'pinterest').slice(0, 500)
  const body = { videoUrl: it.source_url, title, description, linkTarget: 'auto' }
  if (d.videoPin) {
    const r = await d.videoPin(body)
    return r.ok ? { state: 'done', detail: `Pinned${r.board ? ` to ${r.board}` : ''}`, refId: r.pinId, payload: w.payload } : { state: 'failed', detail: r.error, payload: w.payload }
  }
  const r = await d.http('/api/pinterest/video-pin', { method: 'POST', timeoutMs: 300_000, body })
  if (r.status === 202) return { state: 'wanted', detail: 'Pinterest is still taking the video', payload: w.payload }
  if (!r.ok) return { state: 'failed', detail: err(r, 'Pinterest did not take it'), payload: w.payload }
  return { state: 'done', detail: `Pinned${r.json.board ? ` to ${str(r.json.board)}` : ''}`, refId: str(r.json.pinId) || null, payload: w.payload }
}

/** A vertical video to the US Amazon store: a Liftoff batch of its own, set to
 *  Amazon only (Liftoff's own path for a file with no YouTube video), launched
 *  once prepared; SCOUT's background tab uploads it as for any batch. */
async function amazon(job: SendJob, it: SendItem, d: PlaceDeps): Promise<SendOutcome> {
  const batchId = str(job.payload.batchId)
  if (!batchId) {
    if (!it.asin) return { state: 'needs_you', detail: 'Amazon needs the product. Add it in Liftoff, then press Try again.' }
    const made = await d.http('/api/launch/batches', { method: 'POST', body: { name: `Drop (Amazon): ${baseName(it.file_name)}`.slice(0, 120), timezone: d.timezone || 'UTC' } })
    const id = made.ok ? str(made.json.id) : ''
    if (!id) return { state: 'failed', detail: `Liftoff did not start a batch: ${err(made, 'no answer')}.` }
    const set = await d.http(`/api/launch/batches/${id}`, { method: 'PATCH', body: {
      ctaChosen: true, cta: null, thumbnailChosen: true, thumbnail: null, markets: ['amazon.com'], sendToYouTube: false,
    } })
    if (!set.ok) return { state: 'failed', detail: `Liftoff did not take Amazon only: ${err(set, 'no answer')}.`, payload: { batchId: id } }
    const title = str(it.title).trim()
    const add = await d.http(`/api/launch/batches/${id}/items`, { method: 'POST', body: {
      sourceUrl: it.source_url, title: title || baseName(it.file_name), titleSource: title ? 'creator' : 'filename', durationSeconds: it.duration_seconds || 0,
    } })
    const liId = add.ok ? str(add.json.id) : ''
    if (!liId) return { state: 'failed', detail: `Liftoff did not take the video: ${err(add, 'no answer')}.`, payload: { batchId: id } }
    const p = await d.http(`/api/launch/items/${liId}`, { method: 'PATCH', body: { product: it.asin } })
    if (!p.ok) return { state: 'needs_you', detail: `The product was not saved in Liftoff (${err(p, 'no answer')}). Add it there.`, url: `/liftoff?batch=${id}`, payload: { batchId: id, launchItemId: liId } }
    return { state: 'wanted', detail: 'Liftoff is preparing it, Amazon only', url: `/liftoff?batch=${id}`, payload: { batchId: id, launchItemId: liId } }
  }
  const b = await d.http(`/api/launch/batches/${batchId}`)
  if (!b.ok) return b.status === 404 ? { state: 'failed', detail: 'Its Liftoff batch was deleted.' } : { state: 'wanted', detail: 'Liftoff could not be read just now' }
  const batch = (b.json.batch ?? {}) as { state?: string }
  const next = nextForBatch(String(batch.state || ''), (b.json.launchBlocker ?? null) as string | null)
  const url = `/liftoff?batch=${batchId}`
  if (next === 'launch') {
    const l = await d.http(`/api/launch/batches/${batchId}/launch`, { method: 'POST' })
    return l.ok ? { state: 'wanted', detail: 'Launched. SCOUT uploads it to Amazon next.', url } : { state: 'needs_you', detail: `Liftoff did not launch it: ${err(l, 'no answer')}`, url }
  }
  if (next === 'wait') return { state: 'wanted', detail: 'Liftoff is preparing it, Amazon only', url }
  if (next === 'needs_you') return { state: 'needs_you', detail: String(b.json.launchBlocker), url }
  const items = (b.json.items ?? []) as Array<{ id: string; amazon?: Array<{ domain: string; state: string; detail: string | null }> }>
  const li = items.find((x) => x.id === str(job.payload.launchItemId)) ?? items[0]
  const us = (li?.amazon ?? []).find((a) => a.domain === 'amazon.com') ?? (li?.amazon ?? [])[0]
  if (us?.state === 'delivered') return { state: 'done', detail: 'On Amazon', url }
  if (us?.state === 'failed') return { state: 'failed', detail: `Amazon did not take it${us.detail ? `: ${us.detail}` : ''}`, url }
  return { state: 'wanted', detail: 'Waiting for SCOUT to upload it to Amazon', url }
}

/** Three clips from the long video, with Clip Factory: Find Moments once,
 *  then each one rendered. Clips over a minute render in the background, so
 *  this comes back for them. */
async function clips(job: SendJob, it: SendItem, li: SendLaunchItem | null, d: PlaceDeps): Promise<SendOutcome> {
  if (!li?.video_id) return li?.state === 'blocked' ? { state: 'failed', detail: 'The video did not reach YouTube, so there is nothing to cut clips from.' } : { state: 'wanted', detail: 'Starts once YouTube has the video' }
  const videoId = li.video_id
  const url = `/clip-factory?video=${videoId}`
  let ids = Array.isArray(job.payload.shortIds) ? (job.payload.shortIds as unknown[]).map(String) : []
  const tries = (job.payload.tries && typeof job.payload.tries === 'object' ? job.payload.tries : {}) as Record<string, number>
  // The kept original goes to Clip Factory first, so it cuts from the file;
  // and on a later pass this is where each clip's state is read.
  const read = await d.http(`/api/youtube/shorts?videoId=${encodeURIComponent(videoId)}`)
  let list = (read.ok ? (read.json.shorts ?? []) : []) as Array<{ id: string; status: string; renderedUrl: string | null }>
  if (ids.length === 0) {
    const plan = await d.http('/api/youtube/shorts/plan', { method: 'POST', timeoutMs: 300_000, body: { videoId, count: 3 } })
    if (!plan.ok) {
      if (plan.json.limitReached) return { state: 'needs_you', detail: 'Your Find Moments allowance is used up for now. Press Try again once it resets.', url }
      if (plan.json.noTranscript) return { state: 'failed', detail: 'Clip Factory found no words in the video to cut clips from.', url }
      return { state: 'failed', detail: err(plan, 'Clip Factory did not find moments'), url }
    }
    list = (plan.json.shorts ?? []) as typeof list
    ids = list.map((s) => s.id).slice(0, 3)
    if (ids.length === 0) return { state: 'failed', detail: 'Clip Factory found no moments worth a clip.', url }
  }
  const rows = new Map(list.map((s) => [s.id, s]))
  let rendered = 0, failed = 0, working = 0
  for (const id of ids) {
    const row = rows.get(id)
    if (row?.status === 'rendered') { rendered++; continue }
    if (row?.status === 'rendering') { working++; continue }
    if ((tries[id] ?? 0) >= 2) { failed++; continue }
    tries[id] = (tries[id] ?? 0) + 1
    const r = await d.http('/api/youtube/shorts/render', { method: 'POST', timeoutMs: 300_000, body: { shortId: id, captions: true, hook: true } })
    if (r.ok && r.json.pending) { working++; continue }
    if (r.ok && (r.json.short as { status?: string } | undefined)?.status === 'rendered') { rendered++; continue }
    if (r.json.limitReached) return { state: 'needs_you', detail: `Your clip allowance is used up for now. ${rendered} of ${ids.length} made.`, url, payload: { shortIds: ids, tries } }
    failed++
  }
  const payload = { shortIds: ids, tries }
  if (working) return { state: 'wanted', detail: `${rendered} of ${ids.length} clips made, ${working} still rendering`, url, payload }
  if (rendered === 0) return { state: 'failed', detail: 'Clip Factory could not make the clips.', url, payload }
  return { state: 'done', detail: `${rendered} clip${rendered === 1 ? '' : 's'} ready in Clip Factory${failed ? `, ${failed} could not be made` : ''}`, url, payload }
}

/** Run one place for one video. Never throws. */
export async function runSend(job: SendJob, it: SendItem, li: SendLaunchItem | null, d: PlaceDeps): Promise<SendOutcome> {
  try {
    if (job.place !== 'clips' && job.place !== 'amazon' && !/^https:\/\//.test(String(it.source_url || ''))) return { state: 'failed', detail: 'MVP does not have this video file.' }
    switch (job.place) {
      case 'tiktok': return await tiktok(job, it, d)
      case 'instagram': return await instagram(job, it, d)
      case 'shorts': return await shorts(job, it, d)
      case 'facebook': return await facebook(job, it, d)
      case 'pinterest': return await pinterest(job, it, d)
      case 'amazon': return await amazon(job, it, d)
      case 'clips': return await clips(job, it, li, d)
      default: return { state: 'failed', detail: 'Drop does not send there yet.' }
    }
  } catch (e) {
    return { state: 'failed', detail: e instanceof Error ? e.message : 'It stopped.' }
  }
}
