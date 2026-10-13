// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BACKGROUND RENDER THAT NEVER REPORTS BACK (Seb, 2026-10-13: "it should give
// that slot back"). A long clip is rendered by the render server in its own
// time and the server posts the outcome to render-callback, which gives the
// reserved monthly render back on a failure. When the server never posts at
// all (it restarted, or crashed mid-render), the clip sat on "rendering" for
// good and the reserved render stayed used.
//
// Every ten minutes (cron/reconcile-stuck-images) a clip still rendering after
// STUCK_RENDER_MINUTES is marked failed, in plain words, and one reserved
// render of that creator from when it started is given back. The reservation
// row is not tied to the clip, but the monthly count is only a count of those
// rows, so giving back the one closest in time is exact for the count.
//
// A render that reports back after this: a success still marks the clip
// rendered and takes the render again (it was used after all); a failure gives
// nothing back a second time. Both read STUCK_MARK on the clip.

/** The render server stops a render at 15 minutes and retries its report
 *  three times; the page itself gives up at 25. Thirty is past all of them. */
export const STUCK_RENDER_MINUTES = 30
/** A reservation is made before the clip is marked rendering, while the source
 *  video downloads: at most a few minutes before. */
export const RESERVATION_WINDOW_MS = 8 * 60_000
/** On the clip's reason, so a late report knows the sweep already gave back. */
export const STUCK_MARK = 'The render server never reported back'

export const stuckWords = (gaveBack: boolean) => gaveBack
  ? `${STUCK_MARK}, so MVP stopped waiting after ${STUCK_RENDER_MINUTES} minutes. Nothing was used from your monthly renders. Render it again.`
  : `${STUCK_MARK}, so MVP stopped waiting after ${STUCK_RENDER_MINUTES} minutes. Render it again.`

/** The reservation to give back for a clip marked rendering at `at`: the one
 *  made closest before it, inside the window, not already taken. */
export function pickReservation(
  reservations: Array<{ id: string; created_at: string }>,
  at: string,
  taken: Set<string>,
): string | null {
  const t = Date.parse(at)
  if (!Number.isFinite(t)) return null
  let best: { id: string; gap: number } | null = null
  for (const r of reservations) {
    if (taken.has(r.id)) continue
    const c = Date.parse(r.created_at)
    if (!Number.isFinite(c)) continue
    const gap = t - c
    // Made before the clip went to rendering (a few seconds of clock slack).
    if (gap < -30_000 || gap > RESERVATION_WINDOW_MS) continue
    if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { id: r.id, gap }
  }
  return best ? best.id : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

/** Marks stuck background renders failed and gives their render back. */
export async function sweepStuckRenders(admin: Admin, now = Date.now()): Promise<{ stuck: number; gaveBack: number; notFound: number }> {
  const cutoff = new Date(now - STUCK_RENDER_MINUTES * 60_000).toISOString()
  const { data: rows, error } = await admin.from('youtube_shorts')
    .select('id,user_id,updated_at').eq('status', 'rendering').lt('updated_at', cutoff).limit(200)
  if (error) throw new Error(error.message)
  const list = (rows ?? []) as Array<{ id: string; user_id: string; updated_at: string }>
  let gaveBack = 0, notFound = 0
  const taken = new Set<string>()
  for (const row of list) {
    const from = new Date(Date.parse(row.updated_at) - RESERVATION_WINDOW_MS).toISOString()
    const to = new Date(Date.parse(row.updated_at) + 30_000).toISOString()
    const { data: res } = await admin.from('ai_usage').select('id,created_at')
      .eq('user_id', row.user_id).eq('feature', 'shorts_render').eq('model', 'reserved')
      .gte('created_at', from).lte('created_at', to).limit(20)
    const pick = pickReservation((res ?? []) as Array<{ id: string; created_at: string }>, row.updated_at, taken)
    let back = false
    if (pick) {
      const { error: delErr } = await admin.from('ai_usage').delete().eq('id', pick).eq('user_id', row.user_id)
      if (!delErr) { back = true; taken.add(pick); gaveBack++ }
    }
    if (!back) notFound++
    // Only a clip still rendering: a report that landed meanwhile wins.
    await admin.from('youtube_shorts')
      .update({ status: 'failed', render_error: stuckWords(back), updated_at: new Date(now).toISOString() })
      .eq('id', row.id).eq('status', 'rendering')
  }
  return { stuck: list.length, gaveBack, notFound }
}
