// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A Storefront Sync nobody is driving has to end up somewhere.
//
// /api/global-sync/start localizes each market in work scheduled AFTER the
// response is returned. On Vercel the function can be frozen the moment the
// response goes out, so that work is not guaranteed to run at all. Nothing
// reconciled the outcome: no cron touched these tables, the failure path stored
// no reason, and a job that died mid-localize simply stayed 'localizing'.
//
// Production had four of them against 27 finished, the oldest sitting since
// 1 September. About one run in eight left a creator on a spinner that was never
// going to resolve.
//
// The rules below are what the recovery cron acts on, so the dangerous mistakes
// are all in here: reopening a job the creator already saw finish, racing a
// request that is still working, retrying a doomed job forever, and delivering
// week-old titles into live storefronts.
import {
  decideRecovery, describeJobState,
  STALL_AFTER_MS, ABANDON_AFTER_MS, MAX_RECOVERY_ATTEMPTS,
  type JobSnapshot,
} from '../lib/global-sync-recovery'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const NOW = new Date('2026-09-10T12:00:00Z')
const ago = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString()
const job = (over: Partial<JobSnapshot> = {}): JobSnapshot => ({
  status: 'localizing',
  createdAt: ago(10 * 60_000),
  updatedAt: ago(10 * 60_000),
  pendingTargets: 3,
  attempts: 0,
  ...over,
})

// ── never touch a job someone else owns ─────────────────────────────────────
{
  check('a finished job is left alone', decideRecovery(job({ status: 'done' }), NOW).action === 'wait',
    'reopening a job the creator already saw complete is the worst thing this cron could do')
  check('a failed job is left alone', decideRecovery(job({ status: 'failed' }), NOW).action === 'wait')

  // The request path localizes in seconds. Claiming a job mid-flight would run
  // the model over markets that are already being written.
  check('a job touched seconds ago is left alone',
    decideRecovery(job({ updatedAt: ago(5_000) }), NOW).action === 'wait')
  check('a job just inside the stall window is left alone',
    decideRecovery(job({ updatedAt: ago(STALL_AFTER_MS - 1_000) }), NOW).action === 'wait')
}

// ── the case this exists for ────────────────────────────────────────────────
{
  const d = decideRecovery(job({ updatedAt: ago(STALL_AFTER_MS + 1_000) }), NOW)
  check('a stalled job with work left is resumed', d.action === 'resume', JSON.stringify(d))

  // Work finished, only the status update was lost. Closing it out is right;
  // re-running the markets would spend model calls overwriting good copy.
  check('a stalled job with nothing pending is closed, not re-localized',
    decideRecovery(job({ updatedAt: ago(STALL_AFTER_MS + 1_000), pendingTargets: 0 }), NOW).action === 'resume')
}

// ── stop retrying what will not work ────────────────────────────────────────
{
  const d = decideRecovery(job({ updatedAt: ago(STALL_AFTER_MS + 1_000), attempts: MAX_RECOVERY_ATTEMPTS }), NOW)
  check('a job retried to the cap is failed', d.action === 'fail', JSON.stringify(d))
  check('and it says why', !!d.reason && d.reason.length > 20, String(d.reason))

  check('one attempt below the cap still resumes',
    decideRecovery(job({ updatedAt: ago(STALL_AFTER_MS + 1_000), attempts: MAX_RECOVERY_ATTEMPTS - 1 }), NOW).action === 'resume')
}

// ── do not deliver stale titles ─────────────────────────────────────────────
{
  // The four real ones: stuck since 1 September, found on the 10th.
  const d = decideRecovery(job({ createdAt: ago(9 * 24 * 60 * 60_000), updatedAt: ago(9 * 24 * 60 * 60_000) }), NOW)
  check('a job abandoned for days is failed, not resumed', d.action === 'fail', JSON.stringify(d))
  check('and the reason explains the storefront risk', /out of date|day-old|stopped/i.test(d.reason ?? ''), String(d.reason))

  check('a job just under the abandon age still resumes',
    decideRecovery(job({ createdAt: ago(ABANDON_AFTER_MS - 60_000), updatedAt: ago(STALL_AFTER_MS + 1_000) }), NOW).action === 'resume')
}

// ── bad data must not fail every job it touches ─────────────────────────────
{
  // An unreadable timestamp parses to NaN. Treating that as epoch would make
  // every affected job look ancient and fail them all in one tick.
  check('an unreadable updated_at waits rather than failing',
    decideRecovery(job({ updatedAt: 'not a date' }), NOW).action === 'wait')
  check('an unreadable created_at waits rather than failing',
    decideRecovery(job({ createdAt: 'not a date', updatedAt: ago(STALL_AFTER_MS + 1_000) }), NOW).action === 'wait')
}

// ── what the creator is told ────────────────────────────────────────────────
{
  const working = describeJobState(job({ updatedAt: ago(5_000) }), NOW)
  const stalled = describeJobState(job({ updatedAt: ago(STALL_AFTER_MS + 60_000) }), NOW)
  check('working and stalled read differently', working !== stalled, `${working} / ${stalled}`)
  check('working names the markets', /3 markets/.test(working), working)
  check('stalled says MVP will handle it', /pick it back up/i.test(stalled), stalled)
  check('done reads as done', /Done\./.test(describeJobState(job({ status: 'done' }), NOW)))

  for (const s of [working, stalled, describeJobState(job({ status: 'failed' }), NOW)]) {
    check('no em-dash or en-dash in creator-facing copy', !/[—–]/.test(s), s)
    check('no spaced-hyphen sentence break', !/ - /.test(s), s)
  }
}

if (failures.length) {
  console.error(`\n❌ global-sync-recovery: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ global-sync-recovery: a stalled sync is resumed, an abandoned one is failed with a reason, and a live one is left alone')
