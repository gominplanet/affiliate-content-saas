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
// A SLOT IN THE PAST IS REFUSED, not shifted. YouTube rejects a publishAt that
// has already gone, and a batch prepared yesterday is launched today. Silently
// moving it would publish somebody's video at an hour they never chose, so the
// run stops and says which ones and what to change.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { planSchedule, slotsAlreadyPast, cadenceLabel } from '@/lib/launch-schedule'
import { launchBlocker, type BatchRow, type ItemRow, BATCH_COLUMNS, ITEM_COLUMNS } from '@/lib/launch-batch'

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
  const items: ItemRow[] = rows ?? []

  // THE SAME RULE THE PAGE SHOWED. One function decides what ready means, so a
  // creator cannot be told ready by one screen and refused by this route.
  const blocker = launchBlocker(batch as BatchRow, items)
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
  const planned = planSchedule(ready.length, plan)
  if (planned.length !== ready.length) {
    // NOTHING PARTIAL. A schedule that could only be worked out for some of them
    // means the plan itself is unusable, and publishing half a batch at hours
    // nobody chose is worse than publishing none.
    return NextResponse.json({
      error: 'That schedule could not be worked out. Check the publishing times, the start date and your timezone.',
    }, { status: 400 })
  }

  const past = slotsAlreadyPast(planned)
  if (past.length > 0) {
    return NextResponse.json({
      error: past.length === planned.length
        ? `That start date has already passed, so YouTube would refuse every one. Pick a later first day.`
        : `The first ${past.length} ${past.length === 1 ? 'slot has' : 'slots have'} already gone today, and YouTube refuses a publish time in the past. Move the first day forward, or use later times.`,
      pastSlots: past.map((p) => ({ position: p.position, slot: p.slot, at: p.at.toISOString() })),
    }, { status: 409 })
  }

  // ── write the plan onto the rows ─────────────────────────────────────────
  const now = new Date().toISOString()
  for (let i = 0; i < ready.length; i++) {
    await sb.from('launch_items').update({
      planned_publish_at: planned[i].at.toISOString(),
      // THE STATE DOES NOT MOVE. It is still 'prepared' until YouTube has the
      // file, because 'scheduled' is a fact about YouTube and this route has
      // not spoken to YouTube.
      reason: null,
      updated_at: now,
    }).eq('id', ready[i].id).eq('user_id', user.id)
  }

  await sb.from('launch_batches')
    .update({ state: 'launching', updated_at: now }).eq('id', id).eq('user_id', user.id)

  return NextResponse.json({
    ok: true,
    scheduled: ready.length,
    leftBehind: leftBehind.map((i) => ({ position: i.position, title: i.title, reason: i.reason })),
    cadence: cadenceLabel(batch.daily_slots),
    firstAt: planned[0]?.at.toISOString() ?? null,
    lastAt: planned[planned.length - 1]?.at.toISOString() ?? null,
    // SAID PLAINLY, because it is the one thing that is not automatic and the
    // creator is about to walk away from the screen.
    note: (batch.markets ?? []).length > 0
      ? 'YouTube is handled from here. Your Amazon stores need this tab open, because MVP uploads through your own logged-in Creator account.'
      : 'YouTube is handled from here. No Amazon countries were picked, so nothing goes to a storefront.',
  })
}
