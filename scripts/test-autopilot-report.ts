// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Auto-pilot has to say what it did with the socials, not what it was set to do.
//
// A run published the blog post and posted to none of the five channels toggled
// ON in its own settings, and nothing anywhere said so. The channels still read
// ON, the post was live, and at least five different causes produce exactly that
// silence: none selected, the job never returned the post id, the channel is not
// connected, the plan excludes it, or the insert failed. Each has a different
// fix and all five looked identical.
//
// So these pin the thing that matters: every distinct cause produces a distinct
// sentence, and a run that queued nothing never reads like a success.
import { describeAutoPilotRun } from '../lib/autopilot-report'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const empty = { requested: [], scheduled: [], notConnected: [], notInTier: [], unsupported: [], alreadyQueued: [] }

// ── the reported success ────────────────────────────────────────────────────
{
  const d = describeAutoPilotRun({ status: 'done', report: { ...empty, requested: ['facebook', 'threads'], scheduled: ['facebook', 'threads'] } })
  check('a clean run reads as ok', d?.tone === 'ok', JSON.stringify(d))
  check('it names the channels', /Facebook and Threads/.test(d?.text ?? ''), d?.text)
}

// ── every way it can produce silence, and they must all differ ──────────────
{
  const cases = {
    noneSelected: describeAutoPilotRun({ status: 'done', report: { ...empty, skipped: 'no-socials-selected' } }),
    noPostId: describeAutoPilotRun({ status: 'done', report: { ...empty, requested: ['facebook'], skipped: 'no-post-id' } }),
    notConnected: describeAutoPilotRun({ status: 'done', report: { ...empty, requested: ['linkedin'], notConnected: ['linkedin'] } }),
    notInTier: describeAutoPilotRun({ status: 'done', report: { ...empty, requested: ['pinterest'], notInTier: ['pinterest'] } }),
    insertFailed: describeAutoPilotRun({ status: 'done', report: { ...empty, requested: ['facebook'], error: 'permission denied for table scheduled_posts' } }),
    jobFailed: describeAutoPilotRun({ status: 'failed', error: 'blog generation returned 500' }),
  }

  const texts = Object.values(cases).map(c => c?.text ?? '')
  check('every cause of silence reads differently', new Set(texts).size === texts.length,
    'two identical sentences means the creator still cannot tell which fix applies')

  // A run that queued nothing is never green. That is the whole failure mode:
  // "published the blog" reading as overall success while the channels were
  // silent.
  for (const [name, c] of Object.entries(cases)) {
    if (name === 'noneSelected') continue // nothing was asked for, so nothing is wrong
    check(`${name} is not reported as success`, c?.tone === 'warn', `${name} → ${c?.tone}`)
  }

  check('none-selected is neutral, not a warning', cases.noneSelected?.tone === 'none')
  check('no-post-id tells the creator what to do', /by hand/i.test(cases.noPostId?.text ?? ''), cases.noPostId?.text)
  check('not-connected names the channel', /LinkedIn/.test(cases.notConnected?.text ?? ''), cases.notConnected?.text)
  check('a failed job leads with the job, not the socials', /run failed/i.test(cases.jobFailed?.text ?? ''), cases.jobFailed?.text)
}

// ── partial success still surfaces what was skipped ─────────────────────────
{
  const d = describeAutoPilotRun({ status: 'done', report: {
    ...empty, requested: ['facebook', 'linkedin', 'pinterest'], scheduled: ['facebook'],
    notConnected: ['linkedin'], notInTier: ['pinterest'],
  } })
  check('a partial run warns rather than celebrating', d?.tone === 'warn', JSON.stringify(d))
  check('it says what went out', /Facebook/.test(d?.text ?? ''), d?.text)
  check('it says what did not, and why',
    /LinkedIn[\s\S]*not connected/.test(d?.text ?? '') && /Pinterest[\s\S]*not on your plan/.test(d?.text ?? ''), d?.text)
}

// ── nothing to report ───────────────────────────────────────────────────────
{
  check('no run yet prints nothing', describeAutoPilotRun(null) === null && describeAutoPilotRun(undefined) === null)
  const old = describeAutoPilotRun({ status: 'done', report: null })
  check('a run predating the report says so rather than inventing a result',
    old?.tone === 'none' && /before MVP started recording/i.test(old?.text ?? ''), old?.text)
}

// ── house style ─────────────────────────────────────────────────────────────
{
  const all = [
    describeAutoPilotRun({ status: 'done', report: { ...empty, scheduled: ['facebook'] } }),
    describeAutoPilotRun({ status: 'done', report: { ...empty, requested: ['facebook'], skipped: 'no-post-id' } }),
    describeAutoPilotRun({ status: 'failed', error: 'boom' }),
  ]
  for (const d of all) {
    check('no em-dash or en-dash in creator-facing copy', !/[—–]/.test(d?.text ?? ''), d?.text)
    check('no spaced-hyphen sentence break', !/ - /.test(d?.text ?? ''), d?.text)
  }
}

if (failures.length) {
  console.error(`\n❌ autopilot-report: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ autopilot-report: every cause of a silent cascade reads differently, and none of them reads as success')
