// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE REVIEW EDITOR'S BACKGROUND WORK (Seb, 2026-10-30: "if someone batch
// shoots content ... for 10 or 15 different videos, then just let MVP do its
// thing overnight. Even if it takes 2-3 hours, it doesn't matter, as long as
// MVP does the work in the background").
//
// Each video is a review_edits row that moves along by itself:
//   queued → reading      the takes are looked at, the review is written down
//                         (its sound only, a few MB, never the whole file),
//                         the B-roll's shots are seen, the plan is made;
//   ready_to_make → making the video server makes it (one at a time, so a
//                         batch never swamps it) and posts the result back;
//   done or failed        with what happened, in plain words.
// The cron (app/api/cron/review-edits) moves the queue every two minutes, and
// adding a video starts it straight away. Raw uploads are deleted when the
// creator is finished with the video, or two days after it was made.

import { createAdminClient } from '@/lib/supabase/admin'
import { transcribeToCues, transcriptionConfigured } from '@/lib/shorts-transcribe'
import { makeRenderJob } from '@/lib/render-job'
import { drawTextPill } from '@/lib/text-pill'
import { cleanSettings, cleanWords, clock, linesOf, renderSpec, type Plan, type Shot, type Word } from '@/lib/review-edit'
import { planEdit, readShots } from '@/lib/review-edit-plan'
import { driveAccessToken, driveMediaUrl } from '@/lib/google-drive'

export const EDIT_BUCKET = 'instagram-videos'
/** Videos on the video server at once, across everyone. */
export const MAKING_AT_ONCE = 1
export const READ_STALE_MS = 12 * 60_000
export const MAKE_STALE_MS = 90 * 60_000
/** Raw uploads are kept this long after the video is made, for changes. */
export const RAW_KEEP_MS = 48 * 3600_000
export const MAX_ATTEMPTS = 3

// review_edits is newer than the generated database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any
export const editDb = (): Db => createAdminClient()
/** Where a take is: uploaded to MVP (deleted when done), or in the
 *  creator's Google Drive (never copied, never deleted by MVP). */
export type Src =
  | { kind: 'upload'; url: string; path: string; name?: string; bytes?: number }
  | { kind: 'drive'; fileId: string; name?: string; bytes?: number }

/** Any take uploaded to MVP: only those are ever deleted. Pure. */
export const hasUpload = (row: { review_src: Src; broll_src: Src | null }) => [row.review_src, row.broll_src].some((s) => s?.kind === 'upload')

/** Where the video server reads each take from, with a fresh Drive token
 *  when one is from Drive; or why it cannot. */
async function takes(db: Db, row: Pick<EditRow, 'user_id' | 'review_src' | 'broll_src'>): Promise<{ ok: true; review: { url: string; auth?: string }; broll: { url: string; auth?: string } | null } | { ok: false; error: string }> {
  let auth: string | undefined
  if ([row.review_src, row.broll_src].some((s) => s?.kind === 'drive')) {
    const t = await driveAccessToken(db, row.user_id)
    if (!t.ok) return { ok: false, error: t.error }
    auth = `Bearer ${t.token}`
  }
  const one = (s: Src) => (s.kind === 'drive' ? { url: driveMediaUrl(s.fileId), auth } : { url: s.url })
  return { ok: true, review: one(row.review_src), broll: row.broll_src ? one(row.broll_src) : null }
}
export interface EditRow {
  id: string; user_id: string; name: string | null; status: string; note: string | null
  review_src: Src; broll_src: Src | null; product: string | null
  settings: unknown; info: { review?: { duration: number; width: number; height: number; hasAudio: boolean }; broll?: { duration: number } } | null
  words: Word[] | null; shots: Shot[] | null; plan: Plan | null; outputs: Record<string, { url: string; seconds: number }> | null
  attempts: number; made_at: string | null; raw_deleted_at: string | null; created_at: string; updated_at: string
}

const now = () => new Date().toISOString()
const base = () => (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io').replace(/\/+$/, '')

async function videoServer<T>(path: string, body: unknown, timeoutMs: number): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  if (!base()) return { ok: false, status: 0, error: 'MVP’s video server is not set up.' }
  try {
    const r = await fetch(`${base()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.YOUTUBE_INGEST_SECRET ? { 'x-ingest-secret': process.env.YOUTUBE_INGEST_SECRET } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    })
    const data = await r.json().catch(() => ({})) as T & { error?: string }
    if (!r.ok) return { ok: false, status: r.status, error: data?.error || `the video server answered ${r.status}` }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error && /timeout|abort/i.test(e.name + e.message) ? 'the video server took too long' : 'the video server did not answer' }
  }
}

/** A file of this creator's in the bucket, from its public address, or null. */
export function ownPath(url: string, userId: string): string | null {
  const marker = `/storage/v1/object/public/${EDIT_BUCKET}/`
  const i = String(url || '').indexOf(marker)
  if (i < 0) return null
  const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0])
  return path.startsWith(`${userId}/`) && !path.includes('..') ? path : null
}

async function tierOf(db: Db, userId: string): Promise<string> {
  const { data } = await db.from('integrations').select('tier').eq('user_id', userId).maybeSingle()
  return String(data?.tier || 'pro')
}

async function set(db: Db, id: string, patch: Record<string, unknown>) {
  await db.from('review_edits').update({ ...patch, updated_at: now() }).eq('id', id)
}

/** Look at the takes, write the review down, see the B-roll, make the plan.
 *  Claims the row first, so two ticks never read the same video. */
export async function readTakes(db: Db, row: EditRow): Promise<void> {
  const { data: claimed } = await db.from('review_edits')
    .update({ status: 'reading', note: 'Reading your takes', attempts: (row.attempts || 0) + 1, updated_at: now() })
    .eq('id', row.id).eq('status', 'queued').select('id')
  if (!claimed?.length) return
  const fail = (note: string) => set(db, row.id, { status: 'failed', note })
  try {
    if (!transcriptionConfigured()) return await fail('MVP cannot write down what you say right now (no speech service set up).')
    const src = await takes(db, row)
    if (!src.ok) return await fail(src.error)
    const who = { userId: row.user_id, tier: await tierOf(db, row.user_id) }
    const probe = await videoServer<{ duration: number; width: number; height: number; hasAudio: boolean }>('/probe', { ...src.review, frames: 0 }, 90_000)
    if (!probe.ok) return await fail(probe.status === 404 ? 'MVP’s video server is being updated. Press Try again in half an hour.' : `MVP could not open your review take: ${probe.error}.`)
    if (!probe.data.hasAudio) return await fail('Your take has no sound, so MVP cannot hear what to cut.')
    // Filmed the way its kind is made: a review sideways, an ad upright.
    const kindNow = cleanSettings(row.settings).kind
    const upright = probe.data.height > probe.data.width
    if (kindNow === 'review' && upright) return await fail('This take was filmed upright. An Amazon and YouTube review is filmed sideways: film it again sideways, or add it as a TRYBE ad.')
    const sideNote = kindNow === 'trybe' && !upright ? ' It was filmed sideways, so the upright ad is cut from the middle of the picture.' : ''
    // The sound alone, small, for the transcript; deleted straight after.
    const audio = await videoServer<{ url: string }>('/stream-audio', { ...src.review, userId: row.user_id }, 295_000)
    if (!audio.ok) return await fail(`MVP could not take the sound from your review take: ${audio.error}.`)
    const cues = await transcribeToCues(audio.data.url)
    const audioPath = ownPath(audio.data.url, row.user_id)
    if (audioPath) await db.storage.from(EDIT_BUCKET).remove([audioPath])
    const words = cleanWords(cues.map((c) => ({ start: c.start, end: c.end, text: c.text })))
    if (words.length < 8) return await fail('MVP heard almost nothing in your review take. Check that it is the take where you talk.')
    const lines = linesOf(words)
    let shots: Shot[] = []
    let brollInfo: { duration: number } | undefined
    if (src.broll) {
      await set(db, row.id, { note: 'Looking through your B-roll' })
      const bp = await videoServer<{ duration: number; frames: { at: number; jpg: string }[] }>('/probe', { ...src.broll, frames: 36, width: 320 }, 240_000)
      if (bp.ok) {
        brollInfo = { duration: bp.data.duration }
        shots = await readShots(bp.data.frames, bp.data.duration, who)
      }
    }
    await set(db, row.id, { note: 'Deciding the cuts' })
    const plan = await planEdit({ words, lines, shots, product: row.product, kind: kindNow, who })
    const settings = cleanSettings(row.settings)
    if (!settings.title.text && plan.title) settings.title.text = plan.title
    const brollNote = (row.broll_src && !brollInfo ? ' MVP could not open your B-roll take, so this one has none.' : '') + sideNote
    await set(db, row.id, {
      status: 'ready_to_make', attempts: 0,
      note: `Read: ${plan.cuts.length} ${plan.cuts.length === 1 ? 'cut' : 'cuts'}${shots.length ? `, ${plan.placements.length} B-roll ${plan.placements.length === 1 ? 'moment' : 'moments'}` : ''}. Waiting for its turn on the video server.${brollNote}`,
      info: { review: probe.data, ...(brollInfo ? { broll: brollInfo } : {}) }, words, shots, plan, settings,
    })
  } catch (e) {
    await fail(`MVP stopped while reading your takes: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}.`)
  }
}

/** The title as a picture, in the creator's folder, overwritten on each make. */
/** Drawn for a 1920 wide frame: on the wide version it keeps its own size,
 *  on the vertical one it is half as big again, so it reads on a phone. */
async function titleImage(db: Db, row: EditRow, text: string): Promise<{ url: string; widthPct: { wide: number; vertical: number } } | null> {
  try {
    const { png, width } = await drawTextPill(text, { fontPx: 64, color: '#FFFFFF', background: 'rgba(0,0,0,0.62)', radius: 18, padX: 34, padY: 18, maxWidth: 1500, shadow: false })
    const path = `${row.user_id}/edit-title-${row.id}.png`
    const { error } = await db.storage.from(EDIT_BUCKET).upload(path, png, { contentType: 'image/png', upsert: true })
    if (error) return null
    const share = Math.min(0.9, Math.max(0.1, width / 1920))
    return { url: `${db.storage.from(EDIT_BUCKET).getPublicUrl(path).data.publicUrl}?v=${Date.now()}`, widthPct: { wide: share, vertical: Math.min(0.9, share * 1.5) } }
  } catch { return null }
}

/** Send a planned video to the video server. Claims the row first. */
export async function startMaking(db: Db, row: EditRow): Promise<void> {
  const { data: claimed } = await db.from('review_edits')
    .update({ status: 'making', note: 'Being made on MVP’s video server', attempts: (row.attempts || 0) + 1, updated_at: now() })
    .eq('id', row.id).eq('status', 'ready_to_make').select('id')
  if (!claimed?.length) return
  if (row.raw_deleted_at && hasUpload(row)) return set(db, row.id, { status: 'failed', note: 'The raw takes were deleted, so this cannot be made again. Add them again.' })
  const src = await takes(db, row)
  if (!src.ok) return set(db, row.id, { status: 'failed', note: src.error })
  if (!row.words?.length || !row.plan || !row.info?.review) return set(db, row.id, { status: 'queued', note: 'Reading your takes again' })
  const settings = cleanSettings(row.settings)
  const words = row.words
  const spec = renderSpec({ words, lines: linesOf(words), plan: row.plan, shots: row.shots || [], duration: row.info.review.duration, settings, hasBroll: !!row.broll_src })
  if (spec.seconds < 3) return set(db, row.id, { status: 'failed', note: 'Almost everything was cut. Put some cuts back and make it again.' })
  const job = makeRenderJob({ shortId: `edit-${row.id}`, userId: row.user_id, reservationId: null })
  if (!job) return set(db, row.id, { status: 'failed', note: 'MVP’s video server is not set up for background work.' })
  const title = settings.title.on && settings.title.text ? await titleImage(db, row, settings.title.text) : null
  const sent = await videoServer<{ accepted?: boolean }>('/render-edit', {
    mainUrl: src.review.url, mainAuth: src.review.auth,
    brollUrl: spec.inserts.length ? src.broll?.url : undefined, brollAuth: spec.inserts.length ? src.broll?.auth : undefined,
    userId: row.user_id, job, callbackUrl: `${appUrl()}/api/review-edit/callback`,
    segments: spec.segments, inserts: spec.inserts, zooms: spec.zooms, color: settings.color,
    formats: settings.formats, cropX: settings.cropX, words: spec.words,
    logo: spec.logo ? { url: spec.logo.url, position: spec.logo.position, widthPct: { wide: 0.12, vertical: 0.22 } } : undefined,
    title: title ? { url: title.url, position: settings.title.position, startSec: 0.3, endSec: 0.3 + settings.title.seconds, widthPct: title.widthPct } : undefined,
  }, 60_000)
  if (!sent.ok) {
    // Not there yet (the server is updating): back in line, not a failure.
    if (sent.status === 404 || sent.status === 0) return set(db, row.id, { status: 'ready_to_make', note: `Waiting for MVP’s video server (${sent.error}). It is tried again by itself.` })
    return set(db, row.id, { status: 'failed', note: `The video server would not take it: ${sent.error}.` })
  }
}

/** What the video server reported back. */
export async function finishMaking(db: Db, id: string, userId: string, body: Record<string, unknown>): Promise<boolean> {
  const { data: row } = await db.from('review_edits').select('id,user_id,status,outputs').eq('id', id).eq('user_id', userId).maybeSingle()
  if (!row) return false
  if (body.ok !== true) {
    await set(db, id, { status: 'failed', note: `The video server could not make it: ${String(body.error || 'no reason given').slice(0, 300)}` })
    return true
  }
  const outputs = (body.outputs && typeof body.outputs === 'object' ? body.outputs : {}) as Record<string, { url: string; seconds: number }>
  // A video made again replaces the last one, so old copies do not pile up.
  const old = Object.values((row.outputs || {}) as Record<string, { url: string }>).map((o) => ownPath(o.url, userId)).filter((p): p is string => !!p)
  const fresh = new Set(Object.values(outputs).map((o) => ownPath(o.url, userId)))
  const stale = old.filter((p) => !fresh.has(p))
  if (stale.length) await db.storage.from(EDIT_BUCKET).remove(stale)
  const secs = Number(body.seconds) || Object.values(outputs)[0]?.seconds || 0
  const extra = [Number(body.inserts) > 0 && `${body.inserts} B-roll ${Number(body.inserts) === 1 ? 'moment' : 'moments'}`, Number(body.zooms) > 0 && `${body.zooms} slow ${Number(body.zooms) === 1 ? 'zoom' : 'zooms'}`].filter(Boolean).join(', ')
  await set(db, id, { status: 'done', outputs, made_at: now(), note: `Made: ${clock(secs)} long${extra ? `, ${extra}` : ''}.` })
  return true
}

/** Delete a video's raw uploads now. */
export async function deleteRaw(db: Db, row: Pick<EditRow, 'id' | 'user_id' | 'review_src' | 'broll_src' | 'raw_deleted_at'>): Promise<void> {
  if (row.raw_deleted_at) return
  // Only takes uploaded to MVP: a Drive file is the creator's, never touched.
  const paths = [row.review_src, row.broll_src].map((s) => (s?.kind === 'upload' ? ownPath(s.url, row.user_id) : null)).filter((p): p is string => !!p)
  if (paths.length) await db.storage.from(EDIT_BUCKET).remove(paths)
  await set(db, row.id, { raw_deleted_at: now() })
}

const BUSY = ['reading', 'making', 'queued', 'ready_to_make']

/** One turn of the queue: stuck work back in line, the next video made, the
 *  next video read, old raw uploads deleted. userId: that creator's video is
 *  read first (they just added it). */
export async function moveQueue(db: Db, o: { userId?: string; readBudget?: number } = {}): Promise<{ read: number; started: number; cleaned: number }> {
  const t = Date.now()
  // Stuck: a read or a make that never came back.
  const { data: stuck } = await db.from('review_edits').select('id,status,attempts,updated_at')
    .in('status', ['reading', 'making']).lt('updated_at', new Date(t - READ_STALE_MS).toISOString()).limit(20)
  for (const s of stuck || []) {
    const age = t - Date.parse(s.updated_at)
    if (s.status === 'making' && age < MAKE_STALE_MS) continue
    if ((s.attempts || 0) >= MAX_ATTEMPTS) await set(db, s.id, { status: 'failed', note: s.status === 'making' ? 'The video server never finished it. Press Try again.' : 'MVP could not finish reading your takes. Press Try again.' })
    else await set(db, s.id, { status: s.status === 'making' ? 'ready_to_make' : 'queued', note: 'Trying again' })
  }

  // Make: one at a time on the video server.
  let started = 0
  const { count: making } = await db.from('review_edits').select('id', { count: 'exact', head: true }).eq('status', 'making')
  if ((making ?? 0) < MAKING_AT_ONCE) {
    const { data: next } = await db.from('review_edits').select('*').eq('status', 'ready_to_make').order('updated_at', { ascending: true }).limit(1)
    if (next?.[0]) { await startMaking(db, next[0] as EditRow); started++ }
  }

  // Read: the next queued video (this creator's first), as time allows.
  let read = 0
  const budget = o.readBudget ?? 1
  while (read < budget) {
    let q = db.from('review_edits').select('*').eq('status', 'queued').order('created_at', { ascending: true }).limit(1)
    if (o.userId && read === 0) q = q.eq('user_id', o.userId)
    const { data } = await q
    const row = data?.[0] as EditRow | undefined
    if (!row) { if (o.userId && read === 0) { o = { ...o, userId: undefined }; continue } break }
    await readTakes(db, row)
    read++
    // Read and nothing on the server: start it now rather than next tick.
    const { count: busy } = await db.from('review_edits').select('id', { count: 'exact', head: true }).eq('status', 'making')
    if ((busy ?? 0) < MAKING_AT_ONCE) {
      const { data: again } = await db.from('review_edits').select('*').eq('id', row.id).eq('status', 'ready_to_make').maybeSingle()
      if (again) { await startMaking(db, again as EditRow); started++ }
    }
    if (Date.now() - t > 150_000) break
  }

  // Raw uploads: two days after the video was made, or three after it was
  // added when it never was, unless it is still being worked on.
  let cleaned = 0
  const { data: old } = await db.from('review_edits').select('id,user_id,status,review_src,broll_src,raw_deleted_at,made_at,created_at')
    .is('raw_deleted_at', null).lt('created_at', new Date(t - RAW_KEEP_MS).toISOString()).limit(20)
  for (const r of old || []) {
    if (BUSY.includes(r.status)) continue
    const madeAt = r.made_at ? Date.parse(r.made_at) : null
    if (madeAt ? t - madeAt < RAW_KEEP_MS : t - Date.parse(r.created_at) < RAW_KEEP_MS * 1.5) continue
    await deleteRaw(db, r as EditRow)
    cleaned++
  }
  return { read, started, cleaned }
}
