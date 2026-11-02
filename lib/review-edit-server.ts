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
import { drawTitle } from '@/lib/title-looks'
import { cleanSettings, cleanWords, clock, linesOf, renderSpec, thumbTimes, LOGO_WIDTH, PICTURE_WIDTH, type EditSettings, type PictureTime, type Plan, type Shot, type Word } from '@/lib/review-edit'
import { brollFits, cleanThumbWords, pickThumbFrames, planEdit, readShots, thumbWords } from '@/lib/review-edit-plan'
import { composeThumb } from '@/lib/creator-thumb'
import { removeBackground } from '@/lib/thumbnail-generators'
import { recordUsage } from '@/lib/ai-usage'
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
  settings: unknown; info: { review?: { duration: number; width: number; height: number; hasAudio: boolean; silences?: [number, number][] }; broll?: { duration: number }; placed?: Placed; brollCheck?: { fits: boolean; talk: string; shows: string }; thumb?: Thumb } | null
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
    // The sound, and where it is quiet (the dead air, lib/review-edit PACE).
    const audio = await videoServer<{ url: string; silences?: [number, number][] }>('/stream-audio', { ...src.review, userId: row.user_id, silences: true }, 295_000)
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
    // A B-roll of another product (a batch paired wrong) is caught here, not
    // put over the talk: its moments are planned but left off, and said.
    const check = shots.length ? await brollFits({ words, shots, product: row.product, who }) : null
    await set(db, row.id, { note: 'Deciding the cuts' })
    const plan = await planEdit({ words, lines, shots, product: row.product, kind: kindNow, who })
    if (check && !check.fits) plan.placements = plan.placements.map((p) => ({ ...p, off: true }))
    const settings = cleanSettings(row.settings)
    if (!settings.title.text && plan.title) settings.title.text = plan.title
    const brollNote = (row.broll_src && !brollInfo ? ' MVP could not open your B-roll take, so this one has none.' : '')
      + (check && !check.fits ? ' The B-roll looks like a different product, so it was left out: see below.' : '') + sideNote
    await set(db, row.id, {
      status: 'ready_to_make', attempts: 0,
      note: `Read: ${plan.cuts.length} ${plan.cuts.length === 1 ? 'cut' : 'cuts'}${shots.length ? `, ${plan.placements.length} B-roll ${plan.placements.length === 1 ? 'moment' : 'moments'}` : ''}. Waiting for its turn on the video server.${brollNote}`,
      info: { review: { ...probe.data, silences: Array.isArray(audio.data.silences) ? audio.data.silences : undefined }, ...(brollInfo ? { broll: brollInfo } : {}), ...(check ? { brollCheck: check } : {}) }, words, shots, plan, settings,
    })
  } catch (e) {
    await fail(`MVP stopped while reading your takes: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}.`)
  }
}

/** When each Drive file was filmed, read from the file itself by the video
 *  server (for pairing a batch). Null for a file it could not read; all null
 *  when the server could not be asked, and `read` says so. */
export async function filmedTimes(token: string, fileIds: string[]): Promise<{ read: boolean; times: (string | null)[] }> {
  if (!fileIds.length) return { read: true, times: [] }
  const r = await videoServer<{ times?: unknown[] }>('/filmed', { items: fileIds.map((id) => ({ url: driveMediaUrl(id), auth: `Bearer ${token}` })) }, 110_000)
  if (!r.ok || !Array.isArray(r.data.times)) return { read: false, times: fileIds.map(() => null) }
  return { read: true, times: fileIds.map((_, i) => (typeof r.data.times![i] === 'string' && !Number.isNaN(Date.parse(r.data.times![i] as string)) ? r.data.times![i] as string : null)) }
}

/** THE CREATOR THUMBNAIL (Seb, 2026-11-02, lib/creator-thumb): a still of
 *  the creator from the parts the edit kept, the words, and the result.
 *  state says what happened: making, done, or failed with why. depth false
 *  means the words went in front of the head (no cut-out, or it hid too much). */
export interface Thumb {
  state: 'making' | 'done' | 'failed'
  error?: string
  url?: string
  words?: string
  accent?: string
  /** The candidate moments, best first, and which one is used. */
  picks?: number[]
  pick?: number
  depth?: boolean
  layout?: 'top' | 'side' | 'front'
  stillUrl?: string
  cutUrl?: string | null
  at?: string
}

/**
 * Make (or make again) a review's creator thumbnail. o.words alone redraws
 * with new words on the same frame and cut-out (no AI, nothing new to pay
 * for); o.next moves to the next best frame. Saves info.thumb either way,
 * failure included, so the card shows what happened.
 */
export async function makeCreatorThumb(db: Db, row: EditRow, o: { words?: string; accent?: string; next?: boolean } = {}): Promise<Thumb> {
  const prev = row.info?.thumb
  const save = async (thumb: Thumb) => {
    // The latest info, so nothing written since (a finished make) is lost.
    const { data } = await db.from('review_edits').select('info').eq('id', row.id).maybeSingle()
    await db.from('review_edits').update({ info: { ...(data?.info ?? row.info ?? {}), thumb } }).eq('id', row.id)
    return thumb
  }
  const fail = (error: string) => save({ ...(prev ?? {}), state: 'failed', error, at: new Date().toISOString() })
  try {
    const settings = cleanSettings(row.settings)
    if (settings.kind !== 'review') return await fail('A TRYBE ad has no YouTube thumbnail.')
    if (!row.words?.length || !row.plan || !row.info?.review) return await fail('This video has not been read yet.')
    const who = { userId: row.user_id, tier: await tierOf(db, row.user_id) }
    const fetchBuf = async (url: string) => { const r = await fetch(url, { signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw new Error(`could not read ${url.split('/').pop()}`); return Buffer.from(await r.arrayBuffer()) }

    // The words: the ones asked for, the last ones, or written now.
    const chosen = o.words != null ? cleanThumbWords(o.words, o.accent ?? '') : null
    if (o.words != null && !chosen) return await fail('Those words cannot go on a thumbnail. Use 2 to 4 plain words.')
    const sameFrame = !o.next && !!prev?.stillUrl && prev.state === 'done'
    let words = chosen ?? (sameFrame && prev?.words ? { words: prev.words, accent: prev.accent ?? '' } : null)
    if (!words) words = await thumbWords({ words: row.words, product: row.product, title: settings.title.text || row.plan.title, who })
    if (!words) return await fail('MVP could not write the words for this thumbnail. Type your own.')

    let still: Buffer, cut: Buffer | null, picks = prev?.picks ?? [], pick = prev?.pick ?? 0, stillUrl = prev?.stillUrl, cutUrl = prev?.cutUrl ?? null
    if (sameFrame && stillUrl) {
      still = await fetchBuf(stillUrl)
      cut = cutUrl ? await fetchBuf(cutUrl) : null
    } else {
      const src = await takes(db, row)
      if (!src.ok) return await fail(`MVP cannot open your talking take any more (${src.error}), so it cannot take a frame from it.`)
      if (o.next && picks.length) pick = (pick + 1) % picks.length
      else {
        // The candidates: small frames from the parts the edit kept, the AI's
        // best first. Asked again only when there are none yet.
        const spec = renderSpec({ words: row.words, lines: linesOf(row.words), plan: row.plan, shots: row.shots || [], duration: row.info.review.duration, settings, hasBroll: false, silences: row.info.review.silences ?? [] })
        const times = thumbTimes(spec.segments, 16)
        const pr = await videoServer<{ frames: { at: number; jpg: string }[] }>('/probe', { ...src.review, frames: 0, width: 360, at: times }, 180_000)
        if (!pr.ok || !pr.data.frames?.length) return await fail(`MVP could not take frames from your talking take: ${pr.ok ? 'none came' : pr.error}.`)
        const best = await pickThumbFrames(pr.data.frames, who)
        picks = (best.length ? best : [1]).map((n) => pr.data.frames[n - 1].at)
        pick = 0
      }
      const at = picks[pick] ?? picks[0]
      const sp = await videoServer<{ jpg: string }>('/still', { ...src.review, at, width: 1920 }, 120_000)
      if (!sp.ok || !sp.data.jpg) return await fail(`MVP could not take the frame from your talking take: ${sp.ok ? 'none came' : sp.error}.`)
      still = Buffer.from(sp.data.jpg, 'base64')
      const stillPath = `${row.user_id}/edit-thumbsrc-${row.id}.jpg`
      await db.storage.from(EDIT_BUCKET).upload(stillPath, still, { contentType: 'image/jpeg', upsert: true })
      stillUrl = `${db.storage.from(EDIT_BUCKET).getPublicUrl(stillPath).data.publicUrl}?v=${Date.now()}`
      // The creator cut out of the frame, to put their head in front of the words.
      cut = null; cutUrl = null
      const cutOut = await removeBackground(stillUrl)
      recordUsage({ userId: row.user_id, tier: who.tier, feature: 'review_edit_thumb_cutout', model: 'fal-rembg', images: 1 })
      if (cutOut) {
        try {
          cut = await fetchBuf(cutOut)
          const cutPath = `${row.user_id}/edit-thumbcut-${row.id}.png`
          await db.storage.from(EDIT_BUCKET).upload(cutPath, cut, { contentType: 'image/png', upsert: true })
          cutUrl = `${db.storage.from(EDIT_BUCKET).getPublicUrl(cutPath).data.publicUrl}?v=${Date.now()}`
        } catch { cut = null }
      }
    }

    const made = await composeThumb({ still, cutout: cut, words: words.words, accent: words.accent })
    const path = `${row.user_id}/edit-thumb-${row.id}-${Date.now()}.jpg`
    const { error } = await db.storage.from(EDIT_BUCKET).upload(path, made.jpg, { contentType: 'image/jpeg', upsert: false })
    if (error) return await fail(`The thumbnail could not be saved: ${error.message}`)
    // The last one goes, so remakes do not pile up.
    const old = prev?.url ? ownPath(prev.url, row.user_id) : null
    if (old && old !== path) await db.storage.from(EDIT_BUCKET).remove([old])
    return await save({
      state: 'done', url: db.storage.from(EDIT_BUCKET).getPublicUrl(path).data.publicUrl, words: words.words, accent: words.accent,
      picks, pick, depth: made.depth, layout: made.layout, stillUrl, cutUrl, at: new Date().toISOString(),
    })
  } catch (e) {
    return await fail(`MVP stopped while making the thumbnail: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}.`)
  }
}

/** What was put on the video when it was last sent to be made, in finished
 *  video seconds, and what was left out and why: the card shows this, not
 *  the settings, so a title that could not be drawn or a picture waiting for
 *  words never said is seen as missing (Seb's rule: report what happened). */
export interface Placed { title: { from: number; to: number } | { missed: string } | null; pictures: PictureTime[] }

/** The title as a picture, in the creator's folder, overwritten on each make. */
/** Drawn for a 1920 wide frame: on the wide version it keeps its own size,
 *  on the vertical one it is half as big again, so it reads on a phone. */
async function titleImage(db: Db, row: EditRow, t: EditSettings['title']): Promise<{ url: string; widthPct: { wide: number; vertical: number } } | null> {
  try {
    const { png, width } = await drawTitle(t.text, { look: t.look, color: t.color, size: t.size, position: t.position })
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
  let info = row.info
  // A video read before the dead air was found from the sound: found now.
  let silences = row.info.review.silences
  if (!Array.isArray(silences)) {
    const a = await videoServer<{ url: string; silences?: [number, number][] }>('/stream-audio', { ...src.review, userId: row.user_id, silences: true }, 240_000)
    if (a.ok) {
      const p = ownPath(a.data.url, row.user_id)
      if (p) await db.storage.from(EDIT_BUCKET).remove([p])
      if (Array.isArray(a.data.silences)) {
        silences = a.data.silences
        info = { ...info, review: { ...row.info.review, silences } }
        await set(db, row.id, { info })
      }
    }
  }
  const spec = renderSpec({ words, lines: linesOf(words), plan: row.plan, shots: row.shots || [], duration: row.info.review.duration, settings, hasBroll: !!row.broll_src, silences: silences ?? [] })
  if (spec.seconds < 3) return set(db, row.id, { status: 'failed', note: 'Almost everything was cut. Put some cuts back and make it again.' })
  const job = makeRenderJob({ shortId: `edit-${row.id}`, userId: row.user_id, reservationId: null })
  if (!job) return set(db, row.id, { status: 'failed', note: 'MVP’s video server is not set up for background work.' })
  const title = settings.title.on && settings.title.text ? await titleImage(db, row, settings.title) : null
  // A title on for the whole video (a disclosure) stays to the last frame.
  const titleTo = settings.title.seconds === 0 ? spec.seconds + 1 : 0.3 + settings.title.seconds
  const shown = spec.pictures.filter((p): p is Extract<PictureTime, { from: number }> => 'from' in p)
  const placed: Placed = {
    title: !settings.title.on || !settings.title.text ? null
      : title ? { from: settings.title.seconds === 0 ? 0 : 0.3, to: Math.min(spec.seconds, titleTo) }
      : { missed: 'The title could not be drawn, so it is not on this video. Make it again to try once more.' },
    pictures: spec.pictures,
  }
  await set(db, row.id, { info: { ...info, placed } })
  const sent = await videoServer<{ accepted?: boolean }>('/render-edit', {
    mainUrl: src.review.url, mainAuth: src.review.auth,
    brollUrl: spec.inserts.length ? src.broll?.url : undefined, brollAuth: spec.inserts.length ? src.broll?.auth : undefined,
    userId: row.user_id, job, callbackUrl: `${appUrl()}/api/review-edit/callback`,
    segments: spec.segments, inserts: spec.inserts, zooms: spec.zooms, color: settings.color,
    formats: settings.formats, cropX: settings.cropX, words: spec.words,
    logo: spec.logo ? {
      url: spec.logo.url, position: spec.logo.position, widthPct: LOGO_WIDTH[spec.logo.size], opacity: spec.logo.opacity,
      // The first or the last seconds; on the whole video it has no timing.
      ...(spec.logo.when === 'start' ? { startSec: 0, endSec: Math.min(spec.seconds, spec.logo.seconds) }
        : spec.logo.when === 'end' ? { startSec: Math.max(0, spec.seconds - spec.logo.seconds), endSec: spec.seconds + 1 } : {}),
    } : undefined,
    title: title ? { url: title.url, position: settings.title.position, startSec: settings.title.seconds === 0 ? 0 : 0.3, endSec: titleTo, widthPct: title.widthPct } : undefined,
    pictures: shown.map((p) => {
      const pic = settings.pictures[p.k]
      // On for the whole video: no timing, so it is there from the first frame to the last.
      return { url: p.url, position: pic.position, widthPct: PICTURE_WIDTH[pic.size], opacity: pic.opacity, ...(pic.when === 'whole' ? {} : { startSec: p.from, endSec: p.to }) }
    }),
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

/** A make sent this long ago is checked against what the video server says
 *  it is working on. */
export const LOST_CHECK_MS = 4 * 60_000

export type ServerStage = 'wait' | 'download' | 'broll' | 'cut' | 'make' | 'save'
export interface ServerJob { stage: ServerStage; pct: number | null; since: string; ahead: number }
/** A result the server kept: what it posted back, and whether MVP got it. */
export interface ServerDone { ok: boolean; error?: string; outputs?: Record<string, { url: string; seconds: number }>; seconds?: number; inserts?: number; zooms?: number; at: string; delivered: boolean; callback: string }
export interface ServerView { edits: Set<string>; others: number; progress: Record<string, ServerJob>; done: Record<string, ServerDone>; bootAt: string | null }

/** What the video server is working on (its in-memory queue), each video's
 *  step and how far along, or null when it cannot say (not answering, or a
 *  build before /jobs). */
export async function serverJobs(): Promise<ServerView | null> {
  if (!base()) return null
  try {
    const r = await fetch(`${base()}/jobs`, { headers: process.env.YOUTUBE_INGEST_SECRET ? { 'x-ingest-secret': process.env.YOUTUBE_INGEST_SECRET } : {}, signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return null
    const d = await r.json() as { edits?: string[]; others?: number; progress?: Record<string, ServerJob>; done?: Record<string, ServerDone>; bootAt?: string }
    return Array.isArray(d.edits) ? {
      edits: new Set(d.edits), others: Number(d.others) || 0,
      progress: d.progress && typeof d.progress === 'object' ? d.progress : {},
      done: d.done && typeof d.done === 'object' ? d.done : {}, bootAt: d.bootAt ?? null,
    } : null
  } catch { return null }
}

/** One turn of the queue: stuck work back in line, the next video made, the
 *  next video read, old raw uploads deleted. userId: that creator's video is
 *  read first (they just added it). */
export async function moveQueue(db: Db, o: { userId?: string; readBudget?: number } = {}): Promise<{ read: number; started: number; cleaned: number }> {
  const t = Date.now()
  // LOST IN A RESTART (Seb, 2026-10-30: half an hour "being made"). Every
  // deploy restarts the video server and empties its queue. A make it no
  // longer has is sent again now, not after MAKE_STALE_MS, and the restart
  // does not count as a try.
  const { data: making0 } = await db.from('review_edits').select('id,user_id,attempts,updated_at').eq('status', 'making').limit(20)
  if (making0?.length) {
    const jobs = await serverJobs()
    if (jobs) for (const m of making0) {
      // A result the server kept that never reached MVP: taken now.
      const done = jobs.done[`edit-${m.id}`]
      if (done && Date.parse(done.at) >= Date.parse(m.updated_at)) { await finishMaking(db, m.id, m.user_id, { ...done }); continue }
      if (jobs.edits.has(`edit-${m.id}`) || t - Date.parse(m.updated_at) < LOST_CHECK_MS) continue
      // Lost: counted as a try, so a video that keeps stopping the server
      // stops with a reason instead of going round for ever.
      if ((m.attempts || 0) >= MAX_ATTEMPTS) await set(db, m.id, { status: 'failed', note: `The video server stopped while making this video ${m.attempts} times, so MVP stopped trying. It may be too long or too big for the server; tell Seb which video it was.` })
      else await set(db, m.id, { status: 'ready_to_make', note: 'MVP\u2019s video server stopped before finishing this one, so it is being made again.' })
    }
  }
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

  // Thumbnails: a review just made gets its creator thumbnail, one a tick,
  // claimed first (info.thumb set) so two ticks never make the same one.
  if (Date.now() - t < 200_000) {
    let q = db.from('review_edits').select('*').eq('status', 'done').eq('settings->>kind', 'review').is('info->thumb', null)
      .gt('made_at', new Date(t - 3 * 86400_000).toISOString()).order('made_at', { ascending: true }).limit(1)
    if (o.userId) q = q.eq('user_id', o.userId)
    const { data: due } = await q
    const row = due?.[0] as EditRow | undefined
    if (row) {
      const { data: claimed } = await db.from('review_edits').update({ info: { ...(row.info ?? {}), thumb: { state: 'making', at: new Date().toISOString() } } })
        .eq('id', row.id).is('info->thumb', null).select('id')
      if (claimed?.length) await makeCreatorThumb(db, { ...row, info: { ...(row.info ?? {}), thumb: undefined } })
    }
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
