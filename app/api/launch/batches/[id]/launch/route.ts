// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/launch/batches/[id]/launch — commit the batch to a schedule.
//
// IT PLANS, IT DOES NOT UPLOAD. Ten videos is ten whole files pushed to
// YouTube, which is minutes each and far past any one request. So this works
// out when each video should go public, writes that on the row, and hands the
// batch to the worker. The creator can close the tab the moment it returns.
//
// THE PLAN AND THE FACT ARE DIFFERENT COLUMNS. `planned_publish_at` is what we
// intend; `publish_at` is what YouTube confirmed. Keeping them apart is what
// stops a screen promising a publication that was never scheduled, which is the
// exact failure shape this codebase has produced over and over.
//
// A DAY IN THE PAST IS REFUSED, not shifted. A time that went by earlier today
// means now, which is what somebody who picks today and presses Launch is
// asking for. A date that has gone is a mistake, and silently moving it would
// publish somebody's video at a time they never chose, so the run stops and
// says which videos and what to change.
//
// EACH VIDEO CAN HAVE ITS OWN DATE AND TIME. The batch pattern is the default
// a video falls back to, not the only way one can be scheduled.

import { launchReadiness } from '@/lib/launch-readiness'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { scheduleItems, datesBeforeToday, cadenceLabel } from '@/lib/launch-schedule'
import { launchBlocker, withOwnSchedules, type BatchRow, type ItemRow, BATCH_COLUMNS, ITEM_COLUMNS } from '@/lib/launch-batch'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!['pro', 'admin'].includes(normalizeTier(integ?.tier))) {
    return NextResponse.json({ error: 'Launch batches are a Pro feature.', code: 'tier_not_allowed' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: batch } = await sb.from('launch_batches')
    .select(BATCH_COLUMNS)
    .eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
  if (batch.state === 'launching' || batch.state === 'launched') {
    return NextResponse.json({
      error: 'This batch has already been launched. Its videos are going out on the schedule you set.',
    }, { status: 409 })
  }

  const { data: rows } = await sb.from('launch_items')
    .select(ITEM_COLUMNS)
    .eq('batch_id', id).order('position', { ascending: true })
  // Each video's own time, if the columns exist yet. Before migration 364
  // they do not, and every video follows the pattern exactly as it used to.
  const { items } = await withOwnSchedules(sb, id, (rows ?? []) as ItemRow[])

  // THE SAME RULE THE PAGE SHOWED. One function decides what ready means, so a
  // creator cannot be told ready by one screen and refused by this route.
  const blocker = await launchReadiness(sb, user.id, batch as BatchRow, items)
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 })

  // Only the ones that actually finished preparing. A blocked video is left
  // where it is: the batch goes without it rather than waiting forever, and the
  // response says how many were left behind.
  const ready = items.filter((i) => i.state === 'prepared')
  const leftBehind = items.filter((i) => i.state !== 'prepared')

  const plan = {
    timezone: batch.timezone || 'UTC',
    slots: batch.daily_slots ?? [],
    startOn: batch.start_on ?? '',
  }
  // EVERY VIDEO, NOT ONLY THE READY ONES, and keyed by id. This used to lay
  // the pattern over `ready` alone while the page laid it over the whole
  // batch, so one blocked video shifted every later one by a slot and the
  // time on screen was not the time YouTube was given. Resolved once, from
  // the full list, the same way the page does it; the ready ones are then
  // simply looked up. A video with its own date and time keeps it.
  const schedule = scheduleItems(items.map((i) => ({
    id: i.id, customDate: i.custom_publish_date, customTime: i.custom_publish_time,
  })), plan)
  const unresolved = ready.filter((i) => !schedule.has(i.id))
  if (unresolved.length > 0) {
    // NOTHING PARTIAL. Publishing half a batch at hours nobody chose is worse
    // than publishing none, and the message names the videos so it can be
    // fixed without guessing which one.
    return NextResponse.json({
      error: unresolved.length === ready.length
        ? 'None of these videos has a time yet. Give each one a date and time, or set a daily pattern.'
        : `${unresolved.map((i) => `Video ${i.position + 1}`).join(', ')} ${unresolved.length === 1 ? 'has' : 'have'} no time yet. Give ${unresolved.length === 1 ? 'it' : 'them'} a date and time, or set a daily pattern.`,
    }, { status: 400 })
  }
  const planned = ready.map((i) => schedule.get(i.id)!)

  // ── A TIME THAT HAS GONE TODAY MEANS NOW ─────────────────────────────────
  //
  // This used to refuse, which made tomorrow the earliest a batch could put
  // anything out: finish at nine in the morning and wait a day. Picking today
  // and pressing Launch is a creator asking for it to go now, and the times
  // already say so.
  //
  // A FIRST DAY BEFORE TODAY IS STILL REFUSED, and that is the whole line: a
  // slot that went by this morning is one video going out now, a batch whose
  // first day was last Tuesday is ten going public at once, and a published
  // video cannot be unpublished.
  //
  // PER VIDEO NOW. The check used to be on the pattern's first day alone,
  // which a video with its own date never went near: a creator could set one
  // video to last Tuesday and it would have gone public the moment it
  // uploaded. The same line is drawn for every video, whichever way it got
  // its date.
  const stale = datesBeforeToday(planned, plan.timezone)
  if (stale.length > 0) {
    const which = ready.filter((i) => stale.some((x) => x.id === i.id)).map((i) => `Video ${i.position + 1}`)
    return NextResponse.json({
      error: `${which.join(', ')} ${which.length === 1 ? 'is' : 'are'} set for a day that has already been and gone. Pick today to send ${which.length === 1 ? 'it' : 'them'} out now, or a day ahead to schedule ${which.length === 1 ? 'it' : 'them'}.`,
    }, { status: 409 })
  }
  const immediate = planned.filter((p) => p.at.getTime() <= Date.now())

  // ── write the plan onto the rows ─────────────────────────────────────────
  const now = new Date().toISOString()
  for (let i = 0; i < ready.length; i++) {
    await sb.from('launch_items').update({
      planned_publish_at: schedule.get(ready[i].id)!.at.toISOString(),
      // THE STATE DOES NOT MOVE. It is still 'prepared' until YouTube has the
      // file, because 'scheduled' is a fact about YouTube and this route has
      // not spoken to YouTube.
      reason: null,
      updated_at: now,
    }).eq('id', ready[i].id).eq('user_id', user.id)
  }

  // ── WHICH ONES YOU AGREED TO SEND NOW ─────────────────────────────────────
  //
  // Recorded at the moment of the press, because that is the only moment it
  // is true. A time that has gone NOW is one the page warned about before the
  // button; a time that goes by later, while the video waits in the queue,
  // is a slot the uploader missed, and the uploader used to publish those too.
  //
  // A separate write that is allowed to fail: before migration 365 the column
  // does not exist, and the failure mode is the safe one. Nothing is marked,
  // so nothing goes public unasked; a video in this list is kept private and
  // its row says why.
  const nowIds = immediate.map((p) => p.id)
  let publishNowRecorded = true
  if (nowIds.length > 0) {
    const { error: nowErr } = await sb.from('launch_items')
      .update({ publish_now: true }).in('id', nowIds).eq('user_id', user.id)
    if (nowErr) publishNowRecorded = false
  }

  await sb.from('launch_batches')
    .update({ state: 'launching', updated_at: now }).eq('id', id).eq('user_id', user.id)

  return NextResponse.json({
    ok: true,
    scheduled: ready.length,
    leftBehind: leftBehind.map((i) => ({ position: i.position, title: i.title, reason: i.reason })),
    cadence: cadenceLabel(batch.daily_slots),
    // SAID BACK, not assumed. A creator who picked today should be told which
    // of their videos is going out this minute rather than discovering it.
    // Only a promise when it was recorded. Otherwise these are kept private,
    // and saying "going out now" would be the plan reported as the result.
    goingOutNow: publishNowRecorded ? immediate.length : 0,
    // Earliest and latest by TIME, not by batch position: with each video on
    // its own date, video 1 is not necessarily the first to go out.
    firstAt: planned.length ? new Date(Math.min(...planned.map((p) => p.at.getTime()))).toISOString() : null,
    lastAt: planned.length ? new Date(Math.max(...planned.map((p) => p.at.getTime()))).toISOString() : null,
    // SAID PLAINLY, because it is the one thing that is not automatic and the
    // creator is about to walk away from the screen.
    note: (batch.markets ?? []).length > 0
      ? 'YouTube is handled from here. Your Amazon stores need this tab open, because MVP uploads through your own logged-in Creator account.'
      : 'YouTube is handled from here. No Amazon countries were picked, so nothing goes to a storefront.',
  })
}
