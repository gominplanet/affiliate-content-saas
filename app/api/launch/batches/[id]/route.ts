// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET    /api/launch/batches/[id] — the batch, its videos, and which step the
//                                   creator should do next.
// PATCH  /api/launch/batches/[id] — the shared decisions: CTA, countries,
//                                   cadence, name.
// DELETE /api/launch/batches/[id] — bin a batch that has not launched.
//
// THE STEPS COME FROM lib/launch-batch, not from this route and not from the
// page. One place decides what "done" means, so a screen cannot say ready
// about a batch the worker will refuse.

import { launchReadiness } from '@/lib/launch-readiness'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { marketByDomain } from '@/lib/markets'
import { normalizeSlots } from '@/lib/launch-schedule'
import { validateThumbnailPreset } from '@/lib/thumbnail-preset'
import { batchSteps, launchBlocker, validateCtaPreset, withOwnSchedules, MAX_ITEMS, type BatchRow, type ItemRow, BATCH_COLUMNS, ITEM_COLUMNS } from '@/lib/launch-batch'

export const runtime = 'nodejs'


export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: batch, error } = await sb.from('launch_batches')
    .select(BATCH_COLUMNS).eq('id', id).eq('user_id', user.id).maybeSingle()
  if (error) {
    return NextResponse.json({
      error: 'Could not read this batch. Run migrations 357 and 358, then reload.',
      detail: error.message,
    }, { status: 500 })
  }
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })

  const { data: rows } = await sb.from('launch_items')
    .select(ITEM_COLUMNS).eq('batch_id', id).order('position', { ascending: true })
  const { items, available: ownSchedules } = await withOwnSchedules(sb, id, (rows ?? []) as ItemRow[])

  const b = batch as BatchRow
  return NextResponse.json({
    ok: true,
    batch: {
      ...b,
      markets: (b.markets ?? []).map((d) => ({
        domain: d,
        country: marketByDomain(d)?.country ?? d,
        langName: marketByDomain(d)?.langName ?? null,
        needsDub: !!marketByDomain(d)?.needsTranslation,
      })),
    },
    items,
    steps: batchSteps(b, items),
    // THE REASON, not just a boolean. A disabled Launch button with nothing
    // beside it is the dead end this codebase keeps producing.
    // THE SAME ANSWER THE LAUNCH ROUTE WILL GIVE, including the channel check
    // that needs a lookup. A page that enables the button while the route
    // refuses it is the bug this file already produced once.
    launchBlocker: await launchReadiness(sb, user.id, b, items),
    maxItems: MAX_ITEMS,
    // False until migration 364 is run. The page then shows why per-video
    // times are missing instead of an editor whose every save is refused.
    ownSchedules,
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    name?: string
    // `null` is a real answer: no CTA on any of them.
    cta?: Record<string, unknown> | null
    ctaChosen?: boolean
    // `null` is a real answer here too: the house look on all of them.
    thumbnail?: Record<string, unknown> | null
    thumbnailChosen?: boolean
    markets?: string[]
    dailySlots?: string[]
    startOn?: string | null
    timezone?: string
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  // What we refused to store, so the screen can say so. Saving anyway and
  // reporting the difference beats a 400 that loses every other change in the
  // same request.
  let thumbnailRejected: string[] = []
  if (typeof body.name === 'string') patch.name = body.name.trim().slice(0, 120) || 'Untitled batch'

  // THE DECISION IS SEPARATE FROM THE VALUE. "No CTA" and "not asked yet" are
  // both an empty cta column, and a batch would otherwise sit waiting for an
  // answer the creator had already given.
  if (body.ctaChosen !== undefined || body.cta !== undefined) {
    if (body.cta) {
      // VALIDATED BEFORE IT IS STORED. This preset is replayed by a background
      // worker onto ten videos with nobody watching, so an arbitrary image URL
      // here would be a standing instruction to composite whatever it points
      // at. Only our own gallery or a badge we generated.
      const v = validateCtaPreset(body.cta, process.env.NEXT_PUBLIC_SUPABASE_URL)
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
      patch.cta = v.preset
    } else {
      patch.cta = null
    }
    patch.cta_chosen = body.ctaChosen ?? true
  }

  // THE SAME SHAPE AS THE CTA, for the same reason. A creator who opens the
  // thumbnail step, looks at the controls and keeps the house look has ANSWERED
  // it, and a batch that cannot tell that from silence waits forever.
  if (body.thumbnailChosen !== undefined || body.thumbnail !== undefined) {
    if (body.thumbnail) {
      // Never refuses, so one odd control cannot block the save. What it drops,
      // it names, and the answer goes back to the screen rather than being
      // applied silently to ten videos.
      const { preset, rejected } = validateThumbnailPreset(body.thumbnail, process.env.NEXT_PUBLIC_SUPABASE_URL)
      patch.thumbnail = preset
      if (rejected.length > 0) thumbnailRejected = rejected
    } else {
      patch.thumbnail = null
    }
    patch.thumbnail_chosen = body.thumbnailChosen ?? true
  }

  if (Array.isArray(body.markets)) {
    // Only storefronts MVP actually supports, so a typo cannot create a column
    // the pipeline has no idea what to do with.
    patch.markets = [...new Set(body.markets.filter((d) => !!marketByDomain(d)))]
  }
  if (Array.isArray(body.dailySlots)) {
    // Cleaned and sorted here as well as on screen, because the cadence is what
    // the schedule is built from and the order of the slots IS the order of the
    // day.
    patch.daily_slots = normalizeSlots(body.dailySlots)
  }
  if (body.startOn !== undefined) {
    const s = (body.startOn || '').trim()
    patch.start_on = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
  }
  if (typeof body.timezone === 'string' && body.timezone.trim()) {
    const tz = body.timezone.trim()
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); patch.timezone = tz }
    catch { /* an unknown zone is ignored rather than stored, so the old one stands */ }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb.from('launch_batches')
    .update(patch).eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, rejected: thumbnailRejected })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // `?confirm=1`, which a launched batch needs and a draft does not.
  const confirmed = new URL(req.url).searchParams.get('confirm') === '1'
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: batch } = await sb.from('launch_batches')
    .select('state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
  // ── A LAUNCHED BATCH CAN BE CLEARED AWAY, WITH THE TRUTH SAID FIRST ──────
  //
  // It used to be refused outright, on the grounds that deleting the row does
  // not unschedule anything. That reasoning is right and the conclusion was
  // wrong: the result was a list of finished batches nobody could tidy, and a
  // page that fills up with rows you cannot act on teaches people to ignore it.
  //
  // So it is allowed, and the caller must say it meant it. The videos stay on
  // YouTube and the storefront listings stay up; what goes is MVP's record of
  // the batch. The screen says exactly that before the confirm, because this is
  // the one place somebody could reasonably expect a delete to take something
  // down.
  const launched = batch.state === 'launched' || batch.state === 'launching'
  if (launched && !confirmed) {
    return NextResponse.json({
      needsConfirm: true,
      error: 'This batch has already gone out. Deleting it here removes MVP\u2019s record of it and leaves the videos on YouTube and the listings on Amazon exactly where they are.',
    }, { status: 409 })
  }

  const { error } = await sb.from('launch_batches').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
