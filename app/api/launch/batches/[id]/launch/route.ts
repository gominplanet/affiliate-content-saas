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
import { withOwnSchedules, withYouTubeChoice, type BatchRow, type ItemRow, BATCH_COLUMNS, ITEM_COLUMNS } from '@/lib/launch-batch'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!['pro', 'admin'].includes(normalizeTier(integ?.tier))) {
    return NextResponse.json({ error: 'Liftoff is a Pro feature.', code: 'tier_not_allowed' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: raw } = await sb.from('launch_batches')
    .select(BATCH_COLUMNS)
    .eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!raw) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
  // YouTube and Amazon, or Amazon only (migration 369; absent reads as both).
  const { batch } = await withYouTubeChoice(sb, raw as BatchRow)
  const amazonOnly = batch.send_to_youtube === false

  // ── A LAUNCHED BATCH CAN STILL LAUNCH ITS LATECOMERS ─────────────────────
  //
  // Only this route gives a video its upload time, and it used to refuse any
  // second press. So a video that was blocked when the batch launched, and was
  // then fixed (a product added, Try again), finished preparing and sat on
  // "ready" for good: nothing would ever give it a time, and nothing would ever
  // upload it. The same was true of a video kept private after a missed slot
  // and then given a new time.
  //
  // A second press now launches exactly those: ready, with no upload time yet.
  // Everything already handed to the uploader is left alone.
  const late = batch.state === 'launching' || batch.state === 'launched'

  const { data: rows, error: rowsErr } = await sb.from('launch_items')
    .select(ITEM_COLUMNS)
    .eq('batch_id', id).order('position', { ascending: true })
  if (rowsErr) {
    return NextResponse.json({ error: `Could not read this batch's videos: ${rowsErr.message}` }, { status: 500 })
  }
  // Each video's own time, if the columns exist yet. Before migration 364
  // they do not, and every video follows the pattern exactly as it used to.
  const { items } = await withOwnSchedules(sb, id, (rows ?? []) as ItemRow[])

  // THE SAME RULE THE PAGE SHOWED. One function decides what ready means, so a
  // creator cannot be told ready by one screen and refused by this route.
  const blocker = await launchReadiness(sb, user.id, batch as BatchRow, items)
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 })

  // Only the ones that actually finished preparing, and on a second press
  // only the ones the uploader does not already have. A blocked video is left
  // where it is: the batch goes without it rather than waiting forever, and
  // the response says how many were left behind.
  const ready = items.filter((i) => i.state === 'prepared' && (!late || !i.planned_publish_at))
  const leftBehind = late ? [] : items.filter((i) => i.state !== 'prepared')
  if (late && ready.length === 0) {
    return NextResponse.json({
      error: 'This batch has already been launched. Its videos are going out on the schedule you set.',
    }, { status: 409 })
  }

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
  // AMAZON ONLY: no YouTube slot to wait for, so every video's "time" is
  // now, which is simply when the worker hands it to the Amazon side.
  const nowAt = new Date()
  const schedule = amazonOnly
    ? new Map(ready.map((i) => [i.id, { id: i.id, at: nowAt, own: false, date: '', time: '' }]))
    : scheduleItems(items.map((i) => ({
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
  // A FIRST DAY BEFORE TODAY IS STILL REFUSED, per video: a slot that went by
  // this morning is one video going out now, a date that has gone is a
  // mistake, and a published video cannot be unpublished. (launchReadiness
  // above says the same thing first, so the page could not have offered it.)
  const stale = amazonOnly ? [] : datesBeforeToday(planned, plan.timezone)
  if (stale.length > 0) {
    const which = ready.filter((i) => stale.some((x) => x.id === i.id)).map((i) => `Video ${i.position + 1}`)
    return NextResponse.json({
      error: `${which.join(', ')} ${which.length === 1 ? 'is' : 'are'} set for a day that has already been and gone. Pick today to send ${which.length === 1 ? 'it' : 'them'} out now, or a day ahead to schedule ${which.length === 1 ? 'it' : 'them'}.`,
    }, { status: 409 })
  }
  // Nothing goes public on YouTube for an Amazon-only batch, so nothing is
  // recorded as agreed to go out now.
  const immediate = amazonOnly ? [] : planned.filter((p) => p.at.getTime() <= Date.now())
  const now = new Date().toISOString()

  // ── ONE PRESS WINS ───────────────────────────────────────────────────────
  //
  // The state used to be checked at the top and set at the bottom, so two
  // presses could both get through. The batch is now claimed in one
  // conditional write before anything else is written: the second press finds
  // it already claimed and stops.
  if (!late) {
    const { data: claimed, error: claimErr } = await sb.from('launch_batches')
      .update({ state: 'launching', updated_at: now })
      .eq('id', id).eq('user_id', user.id).not('state', 'in', '("launching","launched")')
      .select('id')
    if (claimErr) return NextResponse.json({ error: `Could not start the launch: ${claimErr.message}` }, { status: 500 })
    if (!claimed || claimed.length === 0) {
      return NextResponse.json({
        error: 'This batch has already been launched. Its videos are going out on the schedule you set.',
      }, { status: 409 })
    }
  }

  // ── WHICH ONES YOU AGREED TO SEND NOW, written FIRST ─────────────────────
  //
  // Recorded at the moment of the press, because that is the only moment it
  // is true, and BEFORE the upload times below: the uploader claims a row the
  // instant it has a time, and a row it claimed before this flag landed would
  // be treated as a missed slot and kept private.
  //
  // Allowed to fail: before migration 365 the column does not exist, and the
  // failure mode is the safe one. Nothing is marked, so nothing goes public
  // unasked; such a video is kept private and its row says why.
  const nowIds = immediate.map((p) => p.id)
  let publishNowRecorded = true
  if (nowIds.length > 0) {
    const { error: nowErr } = await sb.from('launch_items')
      .update({ publish_now: true }).in('id', nowIds).eq('user_id', user.id)
    if (nowErr) publishNowRecorded = false
  }

  // ── write the plan onto the rows, and CHECK each write ───────────────────
  //
  // These used to be fire and forget, and the batch was marked launching
  // regardless. A failed write left a video with no time, the worker then
  // settled the batch as launched with that video never uploaded, and the
  // screen said it had gone. Now a failure undoes what was written and says
  // so, and the batch is back where it was.
  const written: string[] = []
  for (let i = 0; i < ready.length; i++) {
    const { error: wErr } = await sb.from('launch_items').update({
      planned_publish_at: schedule.get(ready[i].id)!.at.toISOString(),
      // THE STATE DOES NOT MOVE. It is still 'prepared' until YouTube has the
      // file, because 'scheduled' is a fact about YouTube and this route has
      // not spoken to YouTube.
      reason: null,
      updated_at: now,
    }).eq('id', ready[i].id).eq('user_id', user.id)
    if (wErr) {
      if (written.length) {
        await sb.from('launch_items').update({ planned_publish_at: null }).in('id', written).eq('user_id', user.id)
      }
      if (nowIds.length) {
        await sb.from('launch_items').update({ publish_now: false }).in('id', nowIds).eq('user_id', user.id)
      }
      if (!late) {
        await sb.from('launch_batches').update({ state: batch.state, updated_at: now }).eq('id', id).eq('user_id', user.id)
      }
      return NextResponse.json({
        error: `Nothing was launched: Video ${ready[i].position + 1} could not be given its time (${wErr.message}). Try again.`,
      }, { status: 500 })
    }
    written.push(ready[i].id)
  }

  return NextResponse.json({
    ok: true,
    late,
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
      ? 'YouTube is handled from here. Amazon goes from this page, through your own logged-in Creator account, while it is open.'
      : 'YouTube is handled from here. No Amazon countries were picked, so nothing goes to a storefront.',
  })
}
