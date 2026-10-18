// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/trybe-top-hear — MVP listens to the Top 100 videos TRYBE gave
// no words for, on its own (Seb, 2026-10-18: "could we not do this
// automatically once a day?").
//
// Reading TRYBE's Top 100 needs a signed in TRYBE, so that half happens on the
// team's first TRYBE visit of the day, through SCOUT. Listening needs only the
// video file MVP saved, so it happens here: best placed first, only videos
// filed in the last two days (TRYBE's file links do not last for ever), never
// one that already failed (the team's Collect press retries those), and never
// more than DAILY_CAP a day, counted in ai_usage with the team's own presses.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { transcriptionConfigured } from '@/lib/shorts-transcribe'
import { hearTopVideo, listensToday } from '@/lib/trybe-top-hear'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Listens a day, the team's presses included. A TRYBE video is under a
 *  minute, so this is cents a day. */
const DAILY_CAP = 25
/** Listens a run. Every two hours, so a day's filing is done by the evening. */
const PER_RUN = 10
/** A file link older than this is likely gone. */
const FRESH_MS = 2 * 86_400_000
/** Stop starting new listens this close to the time limit. */
const BUDGET_MS = 240_000

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!transcriptionConfigured()) return NextResponse.json({ ok: false, heard: 0, why: 'Transcription is not configured on this deployment (FAL_KEY).' })

  const started = Date.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const done = await listensToday(sb)
  const room = Math.min(PER_RUN, DAILY_CAP - done)
  if (room <= 0) return NextResponse.json({ ok: true, heard: 0, why: Number.isFinite(done) ? `The daily ${DAILY_CAP} are done.` : 'MVP could not read today’s count, so it listened to none.' })

  const { data, error } = await sb.from('trybe_top_scripts')
    .select('submission_id, video_url, state, detail, best_rank')
    .eq('state', 'waiting').ilike('video_url', 'https://%')
    .gte('updated_at', new Date(Date.now() - FRESH_MS).toISOString())
    .order('best_rank', { ascending: true, nullsFirst: false })
    .limit(80)
  if (error) {
    // Before migration 442 there is nothing to listen to: said, not thrown.
    return NextResponse.json({ ok: false, error: error.message }, { status: /does not exist|schema cache/i.test(error.message) ? 200 : 500 })
  }
  const rows = ((data || []) as Array<{ submission_id: string; video_url: string | null; state: string; detail: string | null }>)
    .filter((r) => !/^MVP could not listen to it/.test(r.detail || ''))
    .slice(0, room)

  let heard = 0, nothing = 0, failed = 0
  const reasons: string[] = []
  for (const r of rows) {
    if (Date.now() - started > BUDGET_MS) break
    const out = await hearTopVideo(sb, r)
    if (out.heard === 1) heard++
    else if ('error' in out) { failed++; reasons.push(out.error.slice(0, 120)) }
    else nothing++
  }
  return NextResponse.json({ ok: true, heard, nothing, failed, tried: heard + nothing + failed, waiting: rows.length, before: done, ...(reasons.length ? { reasons: reasons.slice(0, 3) } : {}) })
}
