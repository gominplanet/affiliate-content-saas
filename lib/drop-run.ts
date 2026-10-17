// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE DROP'S STEPS, run by the creator's own browser: the Drop page while it
// is open, and SCOUT's background Liftoff tab (components/launch/
// LiftoffRunner) once it is closed. Every step is a call to a route that
// already does the job, with the creator's own session, so Liftoff's checks,
// the blog's checks and their answers are the ones that count.
//
//   buildLiftoff  a Liftoff batch with the drop's long videos, their products
//                 and the creator's last Liftoff choices, channel confirmed
//   dropSteps     launch each drop's batch once Liftoff has prepared it; then
//                 each blog post once YouTube has the video and its time
//   sendDropToTrybe  a vertical video to its TRYBE brand through SCOUT
//
// The calls are passed in, so scripts/test-drop.ts runs these without a
// network. Never throws: what went wrong is written on the drop.

import { copiedSettings, nextForBatch, blogReady, blogTimeFor, isStale, settingsBody, type LastBatch, type DropSettings } from '@/lib/drop-plan'
import { sendToTrybe, type SendDeps, type SendResult } from '@/lib/trybe-submit'
import { runSend, type PlaceDeps } from '@/lib/drop-places'

export interface HttpAnswer { ok: boolean; status: number; json: Record<string, unknown> }
export type Http = (url: string, init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; timeoutMs?: number }) => Promise<HttpAnswer>

/** fetch, as the steps want it: JSON in and out, never a throw. */
export const browserHttp: Http = async (url, init) => {
  try {
    const r = await fetch(url, {
      method: init?.method || 'GET',
      ...(init?.body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(init?.timeoutMs ?? 60_000),
    })
    const json = await r.json().catch(() => ({}))
    return { ok: r.ok, status: r.status, json: (json && typeof json === 'object' ? json : {}) as Record<string, unknown> }
  } catch (e) {
    return { ok: false, status: 0, json: { error: e instanceof Error && e.name === 'TimeoutError' ? 'No answer in time.' : (e instanceof Error ? e.message : 'No connection.') } }
  }
}

const err = (a: HttpAnswer, fallback: string) => String(a.json.error || '') || (a.status ? `${fallback} (${a.status})` : fallback)
const dropApi = (http: Http, body: Record<string, unknown>) => http('/api/drop', { method: 'POST', body })

// ── Build the Liftoff batch ──────────────────────────────────────────────────

export interface LongVideo {
  /** The drop_items row. */
  id: string
  sourceUrl: string
  fileName: string
  /** Typed by the creator; empty means Liftoff writes one from the product. */
  title: string
  asin: string
  durationSeconds: number
}

export interface BuildResult { batchId: string | null; added: number; problems: string[]; state: 'preparing' | 'needs_you' | 'failed' }

export async function buildLiftoff(o: {
  dropId: string; name: string; videos: LongVideo[]; last: LastBatch | null; timezone: string; startOn: string
}, http: Http, say: (t: string) => void = () => {}): Promise<BuildResult> {
  const problems: string[] = []
  say('Starting a Liftoff batch')
  const made = await http('/api/launch/batches', { method: 'POST', body: { name: o.name, timezone: o.timezone } })
  const batchId = made.ok ? String(made.json.id || '') : ''
  if (!batchId) {
    const note = `Liftoff did not start a batch: ${err(made, 'no answer')}.`
    await dropApi(http, { action: 'state', dropId: o.dropId, state: 'failed', note })
    return { batchId: null, added: 0, problems: [note], state: 'failed' }
  }

  // THE CREATOR'S OWN CHOICES, through Liftoff's own checks. A choice the last
  // batch never made stays open and Liftoff asks for it.
  say(o.last ? 'Copying your last Liftoff choices' : 'Setting the first day')
  const settings = o.last ? copiedSettings(o.last, o.timezone, o.startOn) : { timezone: o.timezone, startOn: o.startOn }
  const set = await http(`/api/launch/batches/${batchId}`, { method: 'PATCH', body: settings })
  if (!set.ok) problems.push(`Your Liftoff choices were not copied: ${err(set, 'no answer')}. Set them in Liftoff.`)
  else if (Array.isArray(set.json.thumbnailRejected) && set.json.thumbnailRejected.length) problems.push(`Part of your thumbnail look was not kept: ${(set.json.thumbnailRejected as string[]).join(', ')}.`)

  // IN THE ORDER DROPPED, which is the publishing order.
  const links: Array<{ id: string; launchItemId: string }> = []
  for (const v of o.videos) {
    say(`Adding ${v.fileName}`)
    const add = await http(`/api/launch/batches/${batchId}/items`, { method: 'POST', body: {
      sourceUrl: v.sourceUrl,
      // A typed title is the creator's; the file name is a placeholder Liftoff
      // replaces with one written from the product.
      title: v.title.trim() || v.fileName.replace(/\.[^.]+$/, ''),
      titleSource: v.title.trim() ? 'creator' : 'filename',
      durationSeconds: v.durationSeconds,
    } })
    const liId = add.ok ? String(add.json.id || '') : ''
    if (!liId) { problems.push(`${v.fileName} was not added to Liftoff: ${err(add, 'no answer')}.`); continue }
    links.push({ id: v.id, launchItemId: liId })
    if (v.asin.trim()) {
      const p = await http(`/api/launch/items/${liId}`, { method: 'PATCH', body: { product: v.asin.trim() } })
      if (!p.ok) problems.push(`${v.fileName}: the product was not saved (${err(p, 'no answer')}). Add it in Liftoff.`)
    } else problems.push(`${v.fileName} has no product yet. Add it in Liftoff.`)
  }

  // THE CHANNEL, confirmed with YouTube as Liftoff does it: saved only when
  // YouTube says this login uploads there.
  const channelId = o.last?.youtube_channel_id || ''
  if (o.last?.send_to_youtube !== false) {
    if (channelId) {
      say('Confirming your YouTube channel')
      const c = await http(`/api/launch/batches/${batchId}/channel`, { method: 'POST', body: { channelId } })
      if (!c.ok) problems.push(`Your YouTube channel was not confirmed: ${err(c, 'no answer')}`)
    } else problems.push('Confirm your YouTube channel in Liftoff.')
  }

  const state: BuildResult['state'] = links.length === 0 ? 'failed' : 'preparing'
  const note = problems.length ? problems.join(' ') : null
  const saved = await dropApi(http, { action: 'link', dropId: o.dropId, batchId, settingsFrom: o.last?.id ?? null, links, state, note })
  if (!saved.ok) problems.push(`The drop could not record its Liftoff batch: ${err(saved, 'no answer')}.`)
  return { batchId, added: links.length, problems, state }
}

// ── The drop on the page: its Liftoff batch from the setup, made at the first
// long video, so each video is prepared while the creator is still there ────

export async function startDraftBatch(o: { dropId: string; name: string; settings: DropSettings; timezone: string; startOn: string },
  http: Http): Promise<{ batchId: string | null; problems: string[] }> {
  const problems: string[] = []
  const made = await http('/api/launch/batches', { method: 'POST', body: { name: o.name, timezone: o.timezone } })
  const batchId = made.ok ? String(made.json.id || '') : ''
  if (!batchId) return { batchId: null, problems: [`Liftoff did not start a batch: ${err(made, 'no answer')}.`] }
  const set = await http(`/api/launch/batches/${batchId}`, { method: 'PATCH', body: settingsBody(o.settings, o.timezone, o.startOn) })
  if (!set.ok) problems.push(`Your setup was not applied: ${err(set, 'no answer')}.`)
  if (o.settings.sendToYouTube && o.settings.channelId) {
    const c = await http(`/api/launch/batches/${batchId}/channel`, { method: 'POST', body: { channelId: o.settings.channelId } })
    if (!c.ok) problems.push(`Your YouTube channel was not confirmed: ${err(c, 'no answer')}`)
  }
  const saved = await dropApi(http, { action: 'link', dropId: o.dropId, batchId, keepDraft: true })
  if (!saved.ok) problems.push(`The drop could not keep its Liftoff batch: ${err(saved, 'no answer')}.`)
  return { batchId, problems }
}

export async function addDraftVideo(batchId: string, v: { itemId: string; sourceUrl: string; fileName: string; title: string; asin: string; durationSeconds: number },
  http: Http): Promise<{ launchItemId: string | null; problem: string | null }> {
  const add = await http(`/api/launch/batches/${batchId}/items`, { method: 'POST', body: {
    sourceUrl: v.sourceUrl, title: v.title.trim() || v.fileName.replace(/\.[^.]+$/, ''), titleSource: v.title.trim() ? 'creator' : 'filename', durationSeconds: v.durationSeconds,
  } })
  const id = add.ok ? String(add.json.id || '') : ''
  if (!id) return { launchItemId: null, problem: `${v.fileName} was not added to Liftoff: ${err(add, 'no answer')}.` }
  let problem: string | null = null
  if (v.asin.trim()) {
    const p = await http(`/api/launch/items/${id}`, { method: 'PATCH', body: { product: v.asin.trim() } })
    if (!p.ok) problem = `${v.fileName}: the product was not saved (${err(p, 'no answer')}).`
  }
  const link = await dropApi(http, { action: 'draft_item', itemId: v.itemId, launchItemId: id })
  if (!link.ok) problem = problem || `The drop could not keep ${v.fileName}'s Liftoff video: ${err(link, 'no answer')}.`
  return { launchItemId: id, problem }
}

// ── Launch when prepared, the blog posts, then every other place ─────────────

interface SendRowFull { id: string; place: string; state: string; payload?: Record<string, unknown> | null; updated_at?: string | null }
interface DropItemFull {
  id: string; to_blog: boolean; blog_state: string; launch_item_id: string | null; to_trybe: boolean; trybe_state: string; updated_at?: string | null
  file_name?: string | null; source_url?: string | null; duration_seconds?: number | null; asin?: string | null; title?: string | null
  sends?: SendRowFull[]
}
interface DropRow { id: string; state: string; note: string | null; batch_id: string | null; items: DropItemFull[] }
interface BatchItem { id: string; state: string; video_id?: string | null; youtube_video_id?: string | null; publish_at?: string | null; title?: string | null }

export interface StepsResult { more: boolean; signature: string; launched: number; blogs: number; sent: number; failed: number; notes: string[] }

/** The places that go out with the blog post, as its socials. */
const WITH_BLOG: Record<string, 'pinterest' | 'facebook'> = { pin: 'pinterest', group: 'facebook' }
/** A place's state that needs nothing more from a pass. */
const SETTLED = new Set(['done', 'failed', 'needs_you'])

/** One pass over the creator's open drops. Safe to run from two places at
 *  once: Launch twice is Liftoff's own "latecomers only", and each blog post
 *  and each other place is claimed before it runs. */
export async function dropSteps(http: Http, say: (t: string) => void = () => {}, now: () => Date = () => new Date(),
  placeDeps: Omit<PlaceDeps, 'http'> = {}): Promise<StepsResult> {
  const out: StepsResult = { more: false, signature: '', launched: 0, blogs: 0, sent: 0, failed: 0, notes: [] }
  const list = await http('/api/drop')
  // Not open to this account, or migration 436 not run: nothing to do here.
  if (!list.ok || list.json.available === false) return out
  const sig: string[] = []
  const nowMs = () => now().getTime()
  const sendDone = (sendId: string, o: { state: string; detail?: string | null; url?: string | null; refId?: string | null; payload?: Record<string, unknown> }) =>
    dropApi(http, { action: 'send_done', sendId, ...o })

  for (const d of (list.json.drops ?? []) as DropRow[]) {
    // A DRAFT IS THE PAGE'S: nothing runs for it until Launch.
    if (d.state === 'draft' || d.state === 'done' || d.state === 'failed' || d.state === 'building') continue
    let items: BatchItem[] = []
    let launchedNow = false

    // ── the Liftoff half: launch once prepared ──────────────────────────────
    if (d.batch_id) {
      const b = await http(`/api/launch/batches/${d.batch_id}`)
      if (!b.ok) {
        // A batch deleted in Liftoff ends the drop; any other miss comes round again.
        if (b.status === 404) await dropApi(http, { action: 'state', dropId: d.id, state: 'failed', note: 'The Liftoff batch for this drop was deleted.' })
        else { out.more = true; sig.push(`${d.id}:unread`) }
        continue
      }
      const batch = (b.json.batch ?? {}) as { state?: string }
      const blocker = (b.json.launchBlocker ?? null) as string | null
      items = (b.json.items ?? []) as BatchItem[]
      if (d.state === 'preparing' || d.state === 'needs_you') {
        const next = nextForBatch(String(batch.state || ''), blocker)
        if (next === 'launch') {
          say(`Launching ${d.id.slice(0, 8)} in Liftoff`)
          const l = await http(`/api/launch/batches/${d.batch_id}/launch`, { method: 'POST' })
          if (l.ok) { await dropApi(http, { action: 'state', dropId: d.id, state: 'launched' }); out.launched++; out.more = true; sig.push(`${d.id}:launched`); launchedNow = true }
          else { await dropApi(http, { action: 'state', dropId: d.id, state: 'needs_you', note: `Liftoff did not launch it: ${err(l, 'no answer')}` }); out.more = true; sig.push(`${d.id}:refused`) }
        } else if (next === 'launched') { await dropApi(http, { action: 'state', dropId: d.id, state: 'launched' }); sig.push(`${d.id}:launched`) }
        else {
          const state = next === 'wait' ? 'preparing' : 'needs_you'
          if (state !== d.state || (state === 'needs_you' && blocker !== d.note)) await dropApi(http, { action: 'state', dropId: d.id, state, note: state === 'needs_you' ? blocker : null })
          // Preparing finishes on its own; a choice in Liftoff may be made at
          // any time, so both come round again (SCOUT waits longer while the
          // signature stays the same).
          out.more = true
          sig.push(`${d.id}:${state}:${items.map((i) => i.state).join(',')}`)
        }
      }
    }
    const youtubeGoing = !d.batch_id || d.state === 'launched' || launchedNow

    let open = 0
    for (const it of d.items) {
      const li = items.find((x) => x.id === it.launch_item_id) ?? null
      const sends = it.sends ?? []
      const blogSends = sends.filter((x) => WITH_BLOG[x.place])

      // ── the blog post, once YouTube has its video and time ──────────────
      // A post still being written is waited for; one quiet past STALE_MS
      // stopped with its page, and the board offers to write it again.
      if (it.to_blog && it.blog_state === 'writing' && !isStale(it.updated_at, nowMs())) open++
      if (it.to_blog && it.blog_state === 'wanted' && youtubeGoing) {
        if (li?.state === 'blocked') {
          if ((await dropApi(http, { action: 'blog_claim', itemId: it.id })).json.claimed) {
            await dropApi(http, { action: 'blog_done', itemId: it.id, ok: false, detail: 'The video did not reach YouTube, so there is nothing to write the post from.' })
            for (const x of blogSends) if ((await dropApi(http, { action: 'send_claim', sendId: x.id })).json.claimed) await sendDone(x.id, { state: 'failed', detail: 'It goes out with the blog post, and there is no post: the video did not reach YouTube.' })
            out.failed++
          }
        } else if (!blogReady(li)) open++
        else if ((await dropApi(http, { action: 'blog_claim', itemId: it.id })).json.claimed) {
          const at = blogTimeFor(li!.publish_at, now())!
          // The pin and the Facebook post go out with the post: claimed first.
          const riding: Array<{ id: string; platform: 'pinterest' | 'facebook' }> = []
          for (const x of blogSends) if (x.state === 'wanted' && (await dropApi(http, { action: 'send_claim', sendId: x.id })).json.claimed) riding.push({ id: x.id, platform: WITH_BLOG[x.place] })
          const socials = riding.map((x) => ({ platform: x.platform, offsetMinutes: 5, bodyText: String(li!.title || it.title || '').slice(0, 280) || 'New review' }))
          say(`Writing the blog post for ${li!.title || 'a video'}`)
          // About four minutes: the post is written now and goes live at `at`.
          const r = await http('/api/blog/schedule-publish', { method: 'POST', timeoutMs: 330_000, body: {
            videoId: li!.video_id, siteId: null, scheduleMode: 'wp-native', scheduledFor: at, socials, includeImages: true,
          } })
          const ok = r.ok && r.json.ok !== false && !!r.json.postId
          await dropApi(http, { action: 'blog_done', itemId: it.id, ok, at, postId: r.json.postId ?? null, url: r.json.wordpressUrl ?? null,
            detail: ok ? null : err(r, 'The blog did not answer') })
          const skipped = new Set(((r.json.skippedPlatforms ?? []) as unknown[]).map(String))
          for (const x of riding) {
            if (!ok) await sendDone(x.id, { state: 'failed', detail: 'It goes out with the blog post, and the post was not scheduled.' })
            else if (skipped.has(x.platform)) await sendDone(x.id, { state: 'failed', detail: `${x.platform === 'pinterest' ? 'Pinterest' : 'Facebook'} is not connected, so the blog post went without it.` })
            else await sendDone(x.id, { state: 'done', detail: x.platform === 'pinterest'
              ? 'Pinned when the blog post goes live'
              : 'Goes out with the blog post. With a Group saved in Meta Hub it waits there for you to post; without one it goes on your Page.', url: (r.json.wordpressUrl as string) || null })
          }
          if (ok) out.blogs++
          else { out.failed++; out.notes.push(err(r, 'The blog did not answer')) }
        }
      }

      // ── every other place ───────────────────────────────────────────────
      for (const x of sends) {
        if (WITH_BLOG[x.place]) { if (!SETTLED.has(x.state)) open++; continue }
        if (x.state === 'sending') { if (!isStale(x.updated_at, nowMs())) open++; continue }
        if (x.state !== 'wanted') continue
        // Clips work from the YouTube video: nothing to claim until it exists.
        if (x.place === 'clips' && !li?.video_id && li?.state !== 'blocked') { open++; continue }
        const claim = await dropApi(http, { action: 'send_claim', sendId: x.id })
        if (!claim.json.claimed) continue
        say(`${x.place}: ${it.file_name || 'a video'}`)
        const res = await runSend({ id: x.id, place: x.place, state: 'sending', payload: (x.payload ?? {}) as Record<string, unknown> }, {
          id: it.id, file_name: it.file_name ?? null, source_url: it.source_url ?? null, duration_seconds: it.duration_seconds ?? null, asin: it.asin ?? null, title: it.title ?? null,
        }, li, { http, ...placeDeps })
        await sendDone(x.id, { state: res.state, detail: res.detail, url: res.url ?? null, refId: res.refId ?? null,
          payload: res.payload ? { ...(x.payload ?? {}), ...res.payload } : undefined })
        if (res.state === 'done') out.sent++
        else if (res.state === 'failed') { out.failed++; out.notes.push(`${x.place}: ${res.detail || 'not done'}`) }
        else if (res.state === 'wanted') open++
      }
    }

    // DONE when YouTube has settled every video and nothing is still owed.
    const settled = items.every((i) => ['scheduled', 'published', 'blocked', 'amazon_only'].includes(i.state))
    const owed = d.items.some((i) => i.to_blog && (i.blog_state === 'wanted' || (i.blog_state === 'writing' && !isStale(i.updated_at, nowMs()))))
    const trybeOwed = d.items.some((i) => i.to_trybe && i.trybe_state === 'sending' && !isStale(i.updated_at, nowMs()))
    if (youtubeGoing && settled && !owed && !trybeOwed && open === 0) await dropApi(http, { action: 'state', dropId: d.id, state: 'done' })
    else if (youtubeGoing) { out.more = true; sig.push(`${d.id}:${items.map((i) => i.state).join(',')}:${open}`) }
  }
  out.signature = sig.length ? `drop#${sig.join('#')}` : ''
  return out
}

// ── A vertical video to its TRYBE brand (SCOUT 1.52.0) ───────────────────────

export interface TrybeDropItem {
  id: string
  source_url: string | null
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  trybe_brand_id: string | null
  trybe_program_id: string | null
  trybe_angle_id: string | null
  trybe_product_ids: string[] | null
  trybe_exclusive: boolean | null
  trybe_notes: string | null
}

/** Claim the video, send it through SCOUT (lib/trybe-submit), and write what
 *  TRYBE actually did. Null when another page or tab is already sending it.
 *  `again` sends one that stopped or that TRYBE took without listing it. */
export async function sendDropToTrybe(it: TrybeDropItem, http: Http, deps: SendDeps, again = false): Promise<SendResult | null> {
  const claim = await dropApi(http, { action: 'trybe_claim', itemId: it.id, again })
  if (!claim.ok) return { state: 'failed', submissionId: null, steps: [], error: err(claim, 'The drop could not start the send') }
  if (!claim.json.claimed) return null
  // The board follows along, without a write for every part.
  let lastSaved = 0
  const res = await sendToTrybe({
    brandId: it.trybe_brand_id || '', programId: it.trybe_program_id, angleId: it.trybe_angle_id,
    productIds: it.trybe_product_ids ?? [], exclusive: it.trybe_exclusive === true, notes: it.trybe_notes || '',
    file: { url: it.source_url || '', name: it.file_name || 'video.mp4', type: it.mime_type || 'video/mp4', size: Number(it.size_bytes) || 0 },
  }, {
    ...deps,
    onStep: (t, done, total) => {
      deps.onStep?.(t, done, total)
      if (Date.now() - lastSaved > 5000) { lastSaved = Date.now(); void dropApi(http, { action: 'trybe_step', itemId: it.id, detail: t }) }
    },
  })
  const saved = await dropApi(http, { action: 'trybe_done', itemId: it.id, state: res.state, submissionId: res.submissionId, detail: res.error ?? res.status ?? null, steps: res.steps })
  // What TRYBE did stands even when the record of it did not save; said, not hidden.
  return saved.ok ? res : { ...res, error: [res.error, `The drop could not record this: ${err(saved, 'no answer')}`].filter(Boolean).join(' ') }
}
