// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MVP LISTENS TO ONE TOP 100 VIDEO, for the words TRYBE did not share.
//
// One implementation for the two callers: the team's Collect press (the
// top_script_hear action in app/api/labs/trybe) and the daily job that does it
// on its own (app/api/cron/trybe-top-hear, Seb 2026-10-18: "could we not do
// this automatically once a day?"). Listening is the part that costs, so it
// is counted in ai_usage on every attempt, and the job reads that count to
// stay under its daily cap.
//
// Server only.

import { transcribeToCues } from '@/lib/shorts-transcribe'
import { assertPublicHttpUrl } from '@/lib/ssrf-guard'
import { cleanScript } from '@/lib/trybe-scripts'

/** The ledger line for one listen. Model is the service, so the count can be
 *  read back; nothing else in it is priced. */
export const LISTEN_FEATURE = 'trybe_top100_listen'
export const LISTEN_MODEL = 'fal-ai/whisper'

export type HearResult =
  | { heard: 1 }
  | { heard: 0; already: true }
  | { heard: 0; why: string }
  | { heard: 0; error: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function countListen(sb: Db): Promise<void> {
  try {
    await sb.from('ai_usage').insert({
      user_id: null, tier: 'team', feature: LISTEN_FEATURE, model: LISTEN_MODEL,
      input_tokens: 0, output_tokens: 0, web_searches: 0, images: 0,
    })
  } catch { /* the count is a brake, never a reason to fail */ }
}

/** Listens done in the last 24 hours, by the team's press and the job alike.
 *  Fails closed: no answer reads as the cap reached, so a broken count never
 *  turns into unlimited spending. */
export async function listensToday(sb: Db): Promise<number> {
  try {
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { count, error } = await sb.from('ai_usage').select('id', { count: 'exact', head: true })
      .eq('feature', LISTEN_FEATURE).gte('created_at', since)
    if (error) return Number.POSITIVE_INFINITY
    return count ?? 0
  } catch { return Number.POSITIVE_INFINITY }
}

export async function hearTopVideo(sb: Db, row: { submission_id: string; video_url: string | null; state: string }): Promise<HearResult> {
  const now = new Date().toISOString()
  const id = row.submission_id
  if (row.state === 'ready') return { heard: 0, already: true }
  const url = String(row.video_url || '')
  if (!/^https:\/\//i.test(url)) {
    await sb.from('trybe_top_scripts').update({ state: 'none', detail: 'TRYBE gave no video file for this one.', updated_at: now }).eq('submission_id', id)
    return { heard: 0, why: 'no video file' }
  }
  try {
    await assertPublicHttpUrl(url)
    await countListen(sb)
    const cues = await transcribeToCues(url)
    const cleaned = cleanScript(cues.map((c) => c.text).join(' '))
    if (!cleaned.ok) {
      await sb.from('trybe_top_scripts').update({ state: 'none', source: 'none', detail: `MVP listened to it and heard ${cleaned.why}.`, updated_at: now }).eq('submission_id', id)
      return { heard: 0, why: cleaned.why }
    }
    await sb.from('trybe_top_scripts').update({
      script: cleaned.script, hook: cleaned.hook, source: 'transcribed', state: 'ready', detail: null, updated_at: now,
    }).eq('submission_id', id)
    return { heard: 1 }
  } catch (e) {
    const why = e instanceof Error ? e.message : 'the transcription did not finish'
    // LEFT WAITING, NOT MARKED DONE. A transcription that fell over is not
    // a video with no words, and the next pass should try it again.
    await sb.from('trybe_top_scripts').update({ detail: `MVP could not listen to it: ${why}`.slice(0, 400), updated_at: now }).eq('submission_id', id)
    return { heard: 0, error: why }
  }
}
