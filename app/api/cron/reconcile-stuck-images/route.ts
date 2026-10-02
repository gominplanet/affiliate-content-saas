/**
 * GET /api/cron/reconcile-stuck-images
 *
 * Vercel cron worker. Flips blog_posts stuck in images_status='pending' to a
 * terminal 'failed' so the dashboard stops showing an eternal "Images…" spinner.
 *
 * Why this exists: /api/blog/generate sets images_status='pending' before its
 * image pass, which on an interactive request runs inside Vercel's after()
 * callback. Vercel can truncate that callback once the response is sent, killing
 * the process before it writes a terminal 'ready'/'failed'. The row then sits on
 * 'pending' forever. In-code failure paths now write terminal statuses
 * themselves; this cron only catches the process-was-killed case that no
 * in-request code can handle.
 *
 * 20-minute threshold: a healthy image pass finishes in 1-3 minutes; 20 gives
 * wide headroom so we never flip a row whose pass is still legitimately running.
 * The row carries images_status_at (migration 250) stamped when it went pending,
 * so a fresh in-flight row is never mistaken for a stuck one. Rows written before
 * that column exists have a null timestamp and are, by definition, old → flipped.
 *
 * The client renders 'failed' as an actionable "Images failed" state, so this
 * clears the spinner and points the user at the re-roll.
 *
 * ALSO: posts wait for their videos (lib/video-hold). A post live on the blog
 * whose YouTube video is scheduled or private becomes a draft, and comes back,
 * dated that day, when the video is live. It runs here, every ten minutes,
 * rather than on a schedule of its own: every deploy that added or changed a
 * cron in vercel.json failed on Vercel, and the one that put it back went
 * through. Its own try, so a problem there never stops the images reconcile.
 *
 * Auth: Vercel cron requests carry `Authorization: Bearer ${CRON_SECRET}`.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { holdAndRelease } from '@/lib/video-hold'
import { fixProvenanceLines } from '@/lib/provenance-fix'
import { sweepPublishedPrices, sweepSchemaPrices } from '@/lib/published-price-sweep'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const STUCK_MINUTES = 20

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  // ONE BUDGET FOR EVERY STEP, inside the 300 seconds this function gets. Each
  // sweep used to take its own time from when it started (two had none), so
  // one unreachable site could run the clock out before the later sweeps ran,
  // every ten minutes, for good. Each step gets a share, and stops between
  // posts when its share is spent.
  const started = Date.now()
  const share = (endAtSec: number) => started + endAtSec * 1000
  // Millisecond-free ISO so the value has no internal '.' that PostgREST's
  // dot-delimited .or() parser could mis-split.
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

  // Flip pending rows that went pending >20 min ago (or, for legacy rows written
  // before migration 250, have no timestamp at all and are therefore old).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error, count } = await (admin as any)
    .from('blog_posts')
    .update({ images_status: 'failed' }, { count: 'exact' })
    .eq('images_status', 'pending')
    .or(`images_status_at.lt.${cutoff},images_status_at.is.null`)
    .select('id')

  // Posts waiting for their videos.
  let videoHold: unknown = null
  // Every half hour, not every ten minutes: each run asks YouTube about up to
  // 800 videos from the one daily quota every account shares.
  if (new Date().getUTCMinutes() % 30 >= 10) videoHold = { skipped: 'Checked on the hour and half hour.' }
  else try {
    const r = await holdAndRelease(admin, share(60))
    videoHold = r.missingColumn
      ? { skipped: 'Posts cannot wait for their videos until migration 388 is run.' }
      : { held: r.held, released: r.released, letGo: r.letGo, failed: r.failed }
  } catch (e) {
    videoHold = { error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }
  }

  // Posts from a creator's own video that still say "we have not tested this
  // product ourselves" (lib/provenance-fix), a few a run until none are left.
  let provenance: unknown = null
  try {
    provenance = await fixProvenanceLines(admin, undefined, share(130))
  } catch (e) {
    provenance = { error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }
  }

  // Prices and discounts printed on older posts (lib/published-price-sweep),
  // a few a run until none are left. Amazon policy 2(b).
  let prices: unknown = null
  try {
    prices = await sweepPublishedPrices(admin, undefined, share(200))
  } catch (e) {
    prices = { error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }
  }

  // And the price in every post's review data (JSON-LD), every account.
  let schemaPrices: unknown = null
  try {
    schemaPrices = await sweepSchemaPrices(admin, undefined, share(260))
  } catch (e) {
    schemaPrices = { error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }
  }

  if (error) {
    return NextResponse.json({ error: error.message, videoHold, provenance, prices, schemaPrices }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    videoHold,
    provenance,
    prices,
    schemaPrices,
    reconciled: count ?? 0,
    ids: (data ?? []).map((r: { id: string }) => r.id),
    cutoff,
  })
}
