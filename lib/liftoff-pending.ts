// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What a launched Liftoff batch is still waiting on, counted from its rows.
//
// ONE COUNT for everything that asks "is it finished": the background tab
// deciding whether SCOUT should look again, and the report deciding whether it
// may say "All done". Two counts would disagree the first time one of them
// learned about a new state.

export interface PendingItem {
  id: string
  state: string
  planned_publish_at?: string | null
  youtube_video_id: string | null
  video_id?: string | null
  studio_finish?: { ok: boolean; error?: string | null } | null
  amazon?: Array<{ domain: string; state: string; waitingOnDub?: boolean }>
}

export interface Pending {
  /** Still on its way to YouTube (queued or uploading). */
  youtube: number
  /** On YouTube and not yet through SCOUT's Studio pass. */
  studio: number
  /** Amazon listings that are not finished: preparing, dubbing, ready to
   *  send, or not handed over yet. Failed, listed and not-sold are finished. */
  amazon: number
  /** A short fingerprint of what is pending, so a caller can tell "nothing
   *  moved" from "still moving". */
  signature: string
}

const AMAZON_FINISHED = new Set(['delivered', 'failed', 'grid:blocked', 'grid:uploaded', 'grid:live'])

export function liftoffPending(
  items: PendingItem[],
  markets: string[],
  opts: { sendToYouTube: boolean; studioPossible: boolean },
): Pending {
  let youtube = 0, studio = 0, amazon = 0
  const parts: string[] = []
  for (const i of items) {
    // Waiting for the uploader. A ready video with no upload time is waiting
    // for the creator (Launch these too), which no background run can do.
    if (i.state === 'prepared' && i.planned_publish_at) { youtube++; parts.push(`${i.id}:yt`) }
    if (opts.sendToYouTube && opts.studioPossible && i.youtube_video_id && (!i.studio_finish || i.studio_finish.error === 'timeout')) {
      studio++; parts.push(`${i.id}:st`)
    }
    // Amazon: only once the video exists for it (on YouTube, or Amazon only).
    const reachable = !!i.youtube_video_id || i.state === 'amazon_only'
    if (!reachable) continue
    for (const d of markets) {
      const a = (i.amazon ?? []).find((x) => x.domain === d)
      if (!a || !AMAZON_FINISHED.has(a.state)) {
        amazon++
        parts.push(`${i.id}:${d}:${a ? a.state : 'none'}${a?.waitingOnDub ? ':dub' : ''}`)
      }
    }
  }
  return { youtube, studio, amazon, signature: parts.sort().join('|').slice(0, 2000) }
}
