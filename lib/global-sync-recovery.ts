// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Deciding what to do with a Storefront Sync job nobody is driving.
//
// /api/global-sync/start localizes each market in a `void (async () => …)()`
// that runs AFTER the response is returned. On Vercel the function can be frozen
// the moment the response goes out, so that loop is not guaranteed to run at
// all. Nothing reconciled the result: no cron touched these tables, the failure
// path recorded no reason, and a job that died mid-localize simply stayed
// `localizing`.
//
// Production had four of them, the oldest sitting since 1 September, against 27
// that finished. Roughly one run in eight left a creator on a spinner that was
// never going to resolve, and MVP had no idea.
//
// Three outcomes, and the whole point is that they are different:
//   resume  the job is recent and has work left, so finish it
//   fail    it is too old or has been retried too often to be worth resuming
//   wait    it is being worked on right now, leave it alone
//
// Pure so the rules are pinned by tests rather than by reading a cron.

/** A job is only considered stalled once nothing has touched it for this long.
 *  Comfortably longer than a real localize pass (a few seconds per market) so
 *  the cron never races the request that is still doing the work. */
export const STALL_AFTER_MS = 5 * 60_000

/** Past this age a stalled job is not resumed. Localized copy for a video the
 *  creator moved on from a week ago is not worth spending model calls on, and
 *  delivering it would be worse than not: stale titles into live storefronts. */
export const ABANDON_AFTER_MS = 24 * 60 * 60_000

/** How many times the cron will pick a job up before giving up on it. Without
 *  this a job that fails for its own reasons is retried every minute forever,
 *  spending model calls on each pass. */
export const MAX_RECOVERY_ATTEMPTS = 3

export type RecoveryAction = 'resume' | 'fail' | 'wait'

export interface RecoveryDecision {
  action: RecoveryAction
  /** Stored on the job when the action is 'fail'. Written so a creator reading
   *  the page learns why, which the original failure path never did. */
  reason: string | null
}

export interface JobSnapshot {
  status: string
  createdAt: string | Date
  updatedAt: string | Date
  /** Targets still to localize. Zero means the work is done even if the status
   *  never got updated, which is its own bug worth handling rather than
   *  re-running the model over markets that already have copy. */
  pendingTargets: number
  attempts?: number
}

function ms(v: string | Date): number {
  const d = v instanceof Date ? v : new Date(v)
  const t = d.getTime()
  return Number.isFinite(t) ? t : 0
}

export function decideRecovery(job: JobSnapshot, now: Date = new Date()): RecoveryDecision {
  // Finished states are finished. The cron must never reopen a job a creator
  // has already seen complete.
  if (job.status === 'done' || job.status === 'failed') return { action: 'wait', reason: null }

  const updated = ms(job.updatedAt)
  const created = ms(job.createdAt)
  // An unreadable timestamp must not read as "epoch, therefore ancient", which
  // would fail every job it touched. Treat it as just-updated and look again
  // next tick.
  if (!updated || !created) return { action: 'wait', reason: null }

  const idleFor = now.getTime() - updated
  if (idleFor < STALL_AFTER_MS) return { action: 'wait', reason: null }

  // Nothing left to localize: the work finished and only the status update was
  // lost. Closing it out is right, and re-running the markets would not be.
  if (job.pendingTargets <= 0) return { action: 'resume', reason: null }

  if ((job.attempts ?? 0) >= MAX_RECOVERY_ATTEMPTS) {
    return {
      action: 'fail',
      reason: `Gave up after ${MAX_RECOVERY_ATTEMPTS} attempts. Start the sync again, and if it stalls once more the markets themselves are worth checking.`,
    }
  }

  const age = now.getTime() - created
  if (age >= ABANDON_AFTER_MS) {
    return {
      action: 'fail',
      reason: 'This sync stalled and was left more than a day. Rather than deliver day-old titles to your storefronts, MVP stopped it. Start it again when you want the video out.',
    }
  }

  return { action: 'resume', reason: null }
}

/** What the creator is told while a job is mid-flight. Separated from the
 *  decision so the page can say something true about a job the cron has not
 *  reached yet, rather than an indefinite spinner. */
export function describeJobState(job: JobSnapshot, now: Date = new Date()): string {
  if (job.status === 'done') return 'Done. Every market has its localized title and description.'
  if (job.status === 'failed') return 'This sync stopped before it finished.'
  const idleFor = now.getTime() - ms(job.updatedAt)
  if (idleFor < STALL_AFTER_MS) {
    return job.pendingTargets > 0
      ? `Localizing ${job.pendingTargets} ${job.pendingTargets === 1 ? 'market' : 'markets'}.`
      : 'Finishing up.'
  }
  return 'This sync stalled. MVP checks every minute and will pick it back up on its own.'
}
