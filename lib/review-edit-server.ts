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
import { cleanSettings, cleanWords, clock, edgeMoments, linesOf, renderSpec, tidyWordTimes, LOGO_WIDTH, PICTURE_WIDTH, type CalloutLook, type CalloutTime, type EditSettings, type PictureTime, type Plan, type Shot, type Spot, type Word } from '@/lib/review-edit'
import { brollFits, framesPerFile, planEdit, readShots } from '@/lib/review-edit-plan'
import { driveAccessToken, driveMediaUrl } from '@/lib/google-drive'
import { recordUsage } from '@/lib/ai-usage'
import { fairOrder, lastServedBy } from '@/lib/review-edit-queue'
import { checkUsageCap, PRIMARY_FEATURE, reviewEditCapFor } from '@/lib/usage-cap'
import { introCap, introNote } from '@/lib/intro-allowance'
import { normalizeTier } from '@/lib/tier'

export const EDIT_BUCKET = 'instagram-videos'
/** Videos on the video server at once, across everyone. */
export const MAKING_AT_ONCE = 1
/** Videos being read at once, across everyone (2026-11-03): a batch of twenty
 *  added at once used to start twenty reads on the video server together. */
export const READ_AT_ONCE = 3
/** How far back a member counts as served, for taking turns (review-edit-queue). */
const SERVED_WINDOW_MS = 6 * 3600_000
export const READ_STALE_MS = 12 * 60_000
export const MAKE_STALE_MS = 90 * 60_000
/** Raw uploads are kept this long after the video is made, for changes. */
export const RAW_KEEP_MS = 48 * 3600_000
export const MAX_ATTEMPTS = 3

// review_edits is newer than the generated database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any
export const editDb = (): Db => createAdminClient()
/** One file of a take: uploaded to MVP (deleted when done), or in the
 *  creator's Google Drive (never copied, never deleted by MVP). */
export type TakeFile =
  | { kind: 'upload'; url: string; path: string; name?: string; bytes?: number }
  | { kind: 'drive'; fileId: string; name?: string; bytes?: number }
/** Where a take is: one file, or several joined into one video in this order
 *  (`more` after the first; Seb, 2026-11-02: "these files are for video #1").
 *  The video server joins them (ingest-service join-takes). */
export type Src = TakeFile & { more?: TakeFile[] }
/** The most files one take is joined from (ingest-service MAX_PARTS). */
export const MAX_TAKE_FILES = 6

/** Every file of a take, in order. Pure. */
export const takeFiles = (s: Src | null | undefined): TakeFile[] => (s ? [s, ...(Array.isArray(s.more) ? s.more : [])] : [])

/** Any take uploaded to MVP: only those are ever deleted. Pure. */
export const hasUpload = (row: { review_src: Src; broll_src: Src | null }) => [...takeFiles(row.review_src), ...takeFiles(row.broll_src)].some((s) => s?.kind === 'upload')

/** What the video server reads a take from: its one address, or the
 *  addresses of the files it joins (`parts`; an older server refuses those
 *  rather than reading only the first). */
type Readable = { url: string; auth?: string } | { parts: { url: string; auth?: string }[] }
const joined = (r: Readable): r is { parts: { url: string; auth?: string }[] } => 'parts' in r

/** Where the video server reads each take from, with a fresh Drive token
 *  when one is from Drive; or why it cannot. */
async function takes(db: Db, row: Pick<EditRow, 'user_id' | 'review_src' | 'broll_src'>): Promise<{ ok: true; review: Readable; broll: Readable | null } | { ok: false; error: string }> {
  let auth: string | undefined
  if ([...takeFiles(row.review_src), ...takeFiles(row.broll_src)].some((s) => s?.kind === 'drive')) {
    const t = await driveAccessToken(db, row.user_id)
    if (!t.ok) return { ok: false, error: t.error }
    auth = `Bearer ${t.token}`
  }
  const one = (s: TakeFile) => (s.kind === 'drive' ? { url: driveMediaUrl(s.fileId), auth } : { url: s.url })
  const read = (s: Src): Readable => {
    const all = takeFiles(s).map(one)
    return all.length === 1 ? all[0] : { parts: all }
  }
  return { ok: true, review: read(row.review_src), broll: row.broll_src ? read(row.broll_src) : null }
}

/** Two files of one video filmed one upright and one sideways cannot be one
 *  video: the names of the first pair that differ, or null. Pure. */
export function mixedShapes(files: { name?: string }[], parts: { width: number; height: number }[]): string | null {
  const up = (p: { width: number; height: number }) => p.height > p.width
  const k = parts.findIndex((p) => up(p) !== up(parts[0]))
  if (k < 1) return null
  const name = (i: number) => files[i]?.name || `file ${i + 1}`
  return `${name(0)} was filmed ${up(parts[0]) ? 'upright' : 'sideways'} and ${name(k)} ${up(parts[k]) ? 'upright' : 'sideways'}, so they cannot be one video. Add them as separate videos.`
}
export interface EditRow {
  id: string; user_id: string; name: string | null; status: string; note: string | null
  review_src: Src; broll_src: Src | null; product: string | null
  settings: unknown; info: { review?: { duration: number; width: number; height: number; hasAudio: boolean; silences?: [number, number][] }; broll?: { duration: number; unseen?: number[] }; placed?: Placed; brollCheck?: { fits: boolean; talk: string; shows: string }
    /** Counted as one of the member's edited videos (the first time it was read). */
    counted?: boolean } | null
  words: Word[] | null; shots: Shot[] | null; plan: Plan | null; outputs: Record<string, { url: string; seconds: number }> | null
  attempts: number; made_at: string | null; raw_deleted_at: string | null; created_at: string; updated_at: string
}

const now = () => new Date().toISOString()
const base = () => (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io').replace(/\/+$/, '')

/** WHICH B-ROLL FILES ARE IN THE VIDEO, and why any are not, when there
 *  were several: "" for one file. Pure. */
export function brollFilesLine(names: string[], shots: Shot[], plan: Pick<Plan, 'placements'>, unseen: number[] = []): string {
  if (names.length < 2) return ''
  const used = new Set(plan.placements.filter((p) => !p.off).map((p) => shots.find((s) => s.n === p.shot)?.clip).filter((c): c is number => c !== undefined))
  const seen = new Set(shots.map((s) => s.clip))
  const left = names.map((n, i) => ({ n: n || `file ${i + 1}`, i })).filter(({ i }) => !used.has(i))
  const why = (i: number) => (unseen.includes(i) ? 'MVP could not open it' : !seen.has(i) ? 'no clear shots in it' : 'nothing in it fitted what you said')
  return ` B-roll from ${used.size} of ${names.length} files.${left.length ? ` Not used: ${left.map(({ n, i }) => `${n} (${why(i)})`).join(', ')}.` : ''}`
}

/** A reason from the video server inside a sentence of ours: its own full
 *  stop dropped, so the card never ends on "video..". Pure. */
export function oneStop(s: unknown): string {
  return String(s ?? '').replace(/[\s.]+$/, '')
}

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
    const many = joined(src.review)
    const probe = await videoServer<{ duration: number; width: number; height: number; hasAudio: boolean; parts?: { duration: number; width: number; height: number; hasAudio: boolean }[] }>('/probe', { ...src.review, frames: 0 }, 90_000)
    // A server from before takes could be joined refuses the files, or reads one.
    const updating = 'MVP’s video server is being updated. Press Try again in half an hour.'
    if (!probe.ok) return await fail(probe.status === 404 || (many && probe.status === 400) ? updating : `MVP could not open your review take: ${oneStop(probe.error)}.`)
    if (many && !Array.isArray(probe.data.parts)) return await fail(updating)
    const files = takeFiles(row.review_src)
    if (many && probe.data.parts) {
      const mixed = mixedShapes(files, probe.data.parts)
      if (mixed) return await fail(mixed)
      const quiet = probe.data.parts.findIndex((p) => !p.hasAudio)
      if (quiet >= 0) return await fail(`${files[quiet]?.name || `File ${quiet + 1}`} has no sound, so MVP cannot hear what to cut. Take it out of this video, or film it again.`)
    }
    if (!probe.data.hasAudio) return await fail('Your take has no sound, so MVP cannot hear what to cut.')
    // Filmed the way its kind is made: a review sideways, an ad upright.
    const kindNow = cleanSettings(row.settings).kind
    const upright = probe.data.height > probe.data.width
    if (kindNow === 'review' && upright) return await fail('This take was filmed upright. An Amazon and YouTube review is filmed sideways: film it again sideways, or add it as a TRYBE ad.')
    const sideNote = kindNow === 'trybe' && !upright ? ' It was filmed sideways, so the upright ad is cut from the middle of the picture.' : ''
    // The sound alone, small, for the transcript; deleted straight after.
    // The sound, and where it is quiet (the dead air, lib/review-edit PACE).
    const audio = await videoServer<{ url: string; silences?: [number, number][] }>('/stream-audio', { ...src.review, userId: row.user_id, silences: true }, 295_000)
    if (!audio.ok) return await fail(many && audio.status === 400 ? updating : `MVP could not take the sound from your review take: ${oneStop(audio.error)}.`)
    const cues = await transcribeToCues(audio.data.url)
    // What it cost, every time it is written down (Whisper, lib/ai-usage).
    recordUsage({ userId: row.user_id, tier: who.tier, feature: 'review_edit_transcribe', model: 'fal-whisper', images: 1 })
    const audioPath = ownPath(audio.data.url, row.user_id)
    if (audioPath) await db.storage.from(EDIT_BUCKET).remove([audioPath])
    // Words stretched over a walk-in or a walk-off are put back to their size.
    const words = tidyWordTimes(cleanWords(cues.map((c) => ({ start: c.start, end: c.end, text: c.text }))))
    if (words.length < 8) return await fail('MVP heard almost nothing in your review take. Check that it is the take where you talk.')
    const lines = linesOf(words)
    // ── PICTURES OF THE START AND THE END ───────────────────────────────────
    // Where a creator walks in and gets ready, and where they walk to the
    // camera to stop it. Taken while the B-roll is looked at, so the reading
    // takes no longer for it. A video server from before it could take
    // pictures at chosen moments sends evenly spread ones instead: those are
    // not used, and the plan is made from the words, as before.
    const moments = edgeMoments(words, probe.data.duration)
    const edgeFrames: Promise<{ at: number; jpg: string }[]> = moments.length
      ? videoServer<{ frames: { at: number; jpg: string }[] }>('/probe', { ...src.review, frames: moments.length, at: moments, width: 320 }, 120_000)
        .then((fp) => (fp.ok && Array.isArray(fp.data.frames) && fp.data.frames.every((f) => moments.some((m) => Math.abs(m - f.at) < 0.05)) ? fp.data.frames : []))
        .catch(() => [])
      : Promise.resolve([])
    let shots: Shot[] = []
    let brollInfo: { duration: number } | undefined
    // B-roll files MVP could not take pictures of (several files only).
    const brollUnseen: number[] = []
    if (src.broll) {
      await set(db, row.id, { note: 'Looking through your B-roll' })
      if (!joined(src.broll)) {
        const bp = await videoServer<{ duration: number; frames: { at: number; jpg: string }[] }>('/probe', { ...src.broll, frames: 36, width: 320 }, 240_000)
        if (bp.ok) {
          brollInfo = { duration: bp.data.duration }
          shots = await readShots(bp.data.frames, bp.data.duration, who)
        }
      } else {
        // SEVERAL B-ROLL FILES, EACH LOOKED AT ON ITS OWN (Seb, 2026-11-04:
        // "MVP is going to use snippets of each in context"). Pictures spread
        // over all of them together could miss a short clip next to long
        // ones, so each file gets its own share (framesPerFile), two files at
        // a time. Their lengths first, from the files joined as they are made.
        const lp = await videoServer<{ duration: number; parts?: { duration: number }[] }>('/probe', { ...src.broll, frames: 0 }, 120_000)
        // Several B-roll files are only used when the server read them all.
        if (lp.ok && Array.isArray(lp.data.parts)) {
          const lengths = lp.data.parts.map((p) => Number(p.duration) || 0)
          const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((t, d) => t + d, 0))
          const counts = framesPerFile(lengths)
          const parts = (src.broll as { parts: { url: string; auth?: string }[] }).parts
          const frames: { at: number; jpg: string }[] = []
          for (let i = 0; i < parts.length; i += 2) {
            await Promise.all(parts.slice(i, i + 2).map(async (p, j) => {
              const k = i + j
              const fp = counts[k] ? await videoServer<{ frames: { at: number; jpg: string }[] }>('/probe', { ...p, frames: counts[k], width: 320 }, 150_000) : null
              if (fp?.ok && Array.isArray(fp.data.frames) && fp.data.frames.length) {
                for (const f of fp.data.frames) frames.push({ at: Math.round((starts[k] + Math.min(f.at, Math.max(0, lengths[k] - 0.05))) * 100) / 100, jpg: f.jpg })
              } else brollUnseen.push(k)
            }))
          }
          frames.sort((a, b) => a.at - b.at)
          brollInfo = { duration: lp.data.duration }
          shots = await readShots(frames, lp.data.duration, who, starts)
        }
      }
    }
    // A B-roll of another product (a batch paired wrong) is caught here, not
    // put over the talk: its moments are planned but left off, and said.
    const check = shots.length ? await brollFits({ words, shots, product: row.product, who }) : null
    await set(db, row.id, { note: 'Watching how your take starts and ends' })
    const frames = await edgeFrames
    await set(db, row.id, { note: 'Deciding the cuts' })
    const plan = await planEdit({ words, lines, shots, product: row.product, kind: kindNow, frames, who })
    if (check && !check.fits) plan.placements = plan.placements.map((p) => ({ ...p, off: true }))
    const settings = cleanSettings(row.settings)
    if (!settings.title.text && plan.title) settings.title.text = plan.title
    const brollNote = (files.length > 1 ? ` ${files.length} files joined into one video.` : '')
      + (row.broll_src && !brollInfo ? ' MVP could not open your B-roll take, so this one has none.' : '')
      + (check && !check.fits ? ' The B-roll looks like a different product, so it was left out: see below.' : '') + sideNote
      // SAID EITHER WAY, so a plan made without the pictures never looks like one made with them.
      + (plan.read === 'pictures' ? ' MVP watched how it starts and ends.' : ' MVP could not watch how it starts and ends this time, so it cut from your words alone.')
      // WHICH B-ROLL FILES WENT IN, and why any did not.
      + brollFilesLine(takeFiles(row.broll_src).map((f) => f.name || ''), shots, plan, brollUnseen)
    await set(db, row.id, {
      status: 'ready_to_make', attempts: 0,
      note: `Read: ${plan.cuts.length} ${plan.cuts.length === 1 ? 'cut' : 'cuts'}${shots.length ? `, ${plan.placements.length} B-roll ${plan.placements.length === 1 ? 'moment' : 'moments'}` : ''}. Waiting for its turn on the video server.${brollNote}`,
      info: { review: { ...probe.data, silences: Array.isArray(audio.data.silences) ? audio.data.silences : undefined }, ...(brollInfo ? { broll: { ...brollInfo, ...(brollUnseen.length ? { unseen: brollUnseen } : {}) } } : {}), ...(check ? { brollCheck: check } : {}), counted: true }, words, shots, plan, settings,
    })
    // ONE OF THE MONTH'S EDITED VIDEOS, counted once: the first time it is
    // read. Try again and Make it again never count it twice; removing it
    // does not give it back (editAllowance).
    if (!row.info?.counted) recordUsage({ userId: row.user_id, tier: who.tier, feature: PRIMARY_FEATURE.reviewEdit[0], model: 'counter', images: 0 })
  } catch (e) {
    await fail(`MVP stopped while reading your takes: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}.`)
  }
}

// ── THE MONTH'S EDITED VIDEOS (Seb, 2026-11-03: "go with 100 and 25 for free
// week"). Counted on the member's real billing month (lib/usage-cap), a
// quarter in their first 7 days (lib/intro-allowance). Used: the videos
// counted this month, plus the ones added and not read yet, so a batch never
// adds more than is left. ────────────────────────────────────────────────────
export interface EditAllowance { used: number; limit: number | null; left: number | null; resetLabel: string; introNote: string | null }
export async function editAllowance(db: Db, userId: string, tier: unknown): Promise<EditAllowance> {
  const { data: ig } = await db.from('integrations').select('*').eq('user_id', userId).maybeSingle()
  const t = normalizeTier(tier)
  const subscribedAt = (ig?.subscribed_at as string | null | undefined) ?? null
  const limit = t === 'admin' ? null : introCap(reviewEditCapFor(t), subscribedAt)
  const cap = await checkUsageCap(db, userId, PRIMARY_FEATURE.reviewEdit, limit, (ig?.subscription_period_start as string | null) ?? null, (ig?.subscription_period_end as string | null) ?? null)
  const { count: pending } = await db.from('review_edits').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).in('status', ['queued', 'reading']).is('info->counted', null)
  const used = (cap?.used ?? 0) + (pending ?? 0)
  return { used, limit, left: limit === null ? null : Math.max(0, limit - used), resetLabel: cap?.resetLabel ?? '', introNote: limit === null ? null : introNote(subscribedAt) }
}
/** The words when the month's edited videos are used up. Pure. */
export function allowanceFullWords(a: EditAllowance): string {
  return `You have used all ${a.limit} edited videos for this month${a.resetLabel ? `. More on ${a.resetLabel}` : ''}.${a.introNote ? ` ${a.introNote}` : ''}`
}

/** The order a line is worked through: turns between members (lib/review-edit-queue). */
export async function lineOrder(db: Db, line: 'make' | 'read'): Promise<string[]> {
  const status = line === 'make' ? 'ready_to_make' : 'queued'
  const { data: rows } = await db.from('review_edits').select('id,user_id,created_at,updated_at').eq('status', status)
    .order(line === 'make' ? 'updated_at' : 'created_at', { ascending: true }).limit(300)
  if (!rows?.length) return []
  const since = new Date(Date.now() - SERVED_WINDOW_MS).toISOString()
  const { data: served } = await db.from('review_edits').select('user_id,status,updated_at,made_at')
    .in('status', line === 'make' ? ['making', 'done'] : ['reading', 'ready_to_make', 'making', 'done']).gte('updated_at', since).limit(2000)
  const last = lastServedBy(((served ?? []) as { user_id: string; status: string; updated_at: string; made_at: string | null }[])
    .map((x) => ({ user_id: x.user_id, at: line === 'make' && x.status === 'done' ? x.made_at : x.updated_at })))
  return fairOrder((rows as { id: string; user_id: string; created_at: string; updated_at: string }[])
    .map((r) => ({ id: r.id, user_id: r.user_id, at: line === 'make' ? r.updated_at : r.created_at })), last)
}
async function nextInLine(db: Db, line: 'make' | 'read'): Promise<EditRow | null> {
  for (const id of (await lineOrder(db, line)).slice(0, 3)) {
    const { data } = await db.from('review_edits').select('*').eq('id', id).eq('status', line === 'make' ? 'ready_to_make' : 'queued').maybeSingle()
    if (data) return data as EditRow
  }
  return null
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

/** What was put on the video when it was last sent to be made, in finished
 *  video seconds, and what was left out and why: the card shows this, not
 *  the settings, so a title that could not be drawn or a picture waiting for
 *  words never said is seen as missing (Seb's rule: report what happened). */
export interface Placed { title: { from: number; to: number } | { missed: string } | null; pictures: PictureTime[]; callouts?: CalloutTime[] }

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

/** A product title as a picture (calloutTimes), in its own look (the look,
 *  colour and size chosen under Product titles), in the creator's folder,
 *  overwritten on each make. Null when it could not be drawn. */
async function calloutImage(db: Db, row: EditRow, text: string, k: number, cl: CalloutLook, spot: Spot): Promise<{ url: string; widthPct: { wide: number; vertical: number } } | null> {
  try {
    const { png, width } = await drawTitle(text, { look: cl.look, color: cl.color, size: cl.size, position: spot === 'center' ? 'top' : spot })
    const path = `${row.user_id}/edit-callout-${row.id}-${k}.png`
    const { error } = await db.storage.from(EDIT_BUCKET).upload(path, png, { contentType: 'image/png', upsert: true })
    if (error) return null
    const share = Math.min(0.85, Math.max(0.08, width / 1920))
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
  // The product's titles, each drawn; one that could not be drawn is said, not dropped.
  const callouts: CalloutTime[] = []
  const calloutPics: { url: string; position: Spot; widthPct: { wide: number; vertical: number }; opacity: number; startSec: number; endSec: number }[] = []
  const calloutKs: number[] = []
  for (const c of spec.callouts) {
    if (!('from' in c)) { callouts.push(c); continue }
    const img = await calloutImage(db, row, c.text, c.k, settings.calloutLook, spec.calloutSpot)
    if (!img) { callouts.push({ k: c.k, text: c.text, missed: 'It could not be drawn, so it is not on this video. Make it again to try once more.' }); continue }
    callouts.push(c)
    calloutPics.push({ url: img.url, position: spec.calloutSpot, widthPct: img.widthPct, opacity: 1, startSec: c.from, endSec: c.to })
    calloutKs.push(c.k)
  }
  const placed: Placed = {
    title: !settings.title.on || !settings.title.text ? null
      : title ? { from: settings.title.seconds === 0 ? 0 : 0.3, to: Math.min(spec.seconds, titleTo) }
      : { missed: 'The title could not be drawn, so it is not on this video. Make it again to try once more.' },
    pictures: spec.pictures,
    callouts,
  }
  await set(db, row.id, { info: { ...info, placed } })
  const broll = spec.inserts.length ? src.broll : null
  const sent = await videoServer<{ accepted?: boolean; pictures?: number }>('/render-edit', {
    // One file each, or the files the video server joins first.
    ...(joined(src.review) ? { mainParts: src.review.parts } : { mainUrl: src.review.url, mainAuth: src.review.auth }),
    ...(broll ? (joined(broll) ? { brollParts: broll.parts } : { brollUrl: broll.url, brollAuth: broll.auth }) : {}),
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
    }).concat(calloutPics),
  }, 60_000)
  // A video server older than the product titles draws four pictures and
  // says nothing: a title past what it draws is said to be left out.
  if (sent.ok && calloutPics.length) {
    const room = typeof sent.data.pictures === 'number' ? sent.data.pictures : 4
    const over = shown.length + calloutPics.length - room
    if (over > 0) {
      const cut = new Set(calloutKs.slice(-over))
      placed.callouts = callouts.map((c) => (cut.has(c.k) ? { k: c.k, text: c.text, missed: 'MVP’s video server was being updated and drew fewer titles. Make it again to add this one.' } : c))
      await set(db, row.id, { info: { ...info, placed } })
    }
  }
  if (!sent.ok) {
    // Not there yet (the server is updating): back in line, not a failure.
    if (sent.status === 404 || sent.status === 0) return set(db, row.id, { status: 'ready_to_make', note: `Waiting for MVP’s video server (${sent.error}). It is tried again by itself.` })
    return set(db, row.id, { status: 'failed', note: `The video server would not take it: ${oneStop(sent.error)}.` })
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
  const paths = [...takeFiles(row.review_src), ...takeFiles(row.broll_src)].map((s) => (s?.kind === 'upload' ? ownPath(s.url, row.user_id) : null)).filter((p): p is string => !!p)
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
    // In turns between members (lib/review-edit-queue), not in arrival order.
    const next = await nextInLine(db, 'make')
    if (next) { await startMaking(db, next); started++ }
  }

  // Read: the next queued video (this creator's first), as time allows.
  let read = 0
  const budget = o.readBudget ?? 1
  while (read < budget) {
    // At most READ_AT_ONCE across everyone; the rest wait for the cron.
    const { count: reading } = await db.from('review_edits').select('id', { count: 'exact', head: true }).eq('status', 'reading')
    if ((reading ?? 0) >= READ_AT_ONCE) break
    let row: EditRow | undefined
    if (o.userId && read === 0) {
      const { data } = await db.from('review_edits').select('*').eq('status', 'queued').eq('user_id', o.userId).order('created_at', { ascending: true }).limit(1)
      row = data?.[0] as EditRow | undefined
    }
    // Then in turns between members.
    if (!row) row = (await nextInLine(db, 'read')) ?? undefined
    if (!row) break
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
