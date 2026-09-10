// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Saying what the last auto-pilot run did with the socials.
//
// Auto-pilot published a blog post and posted to none of the five channels that
// were toggled ON in its settings. Nothing anywhere said so. The modal showed
// the channels ON, the blog showed the post live, and there were at least five
// different reasons the cascade could have produced silence: none selected, the
// job returned no post id, the channel was never connected, the plan does not
// include it, or the insert failed. Each needs a different fix and all five
// looked exactly the same from the outside.
//
// So the runner records what it did and this turns that record into one line a
// creator can act on. Pure, so the wording is pinned by tests rather than by
// whoever reads the modal next.

export interface AutoSocialReport {
  requested?: string[]
  scheduled?: string[]
  notConnected?: string[]
  notInTier?: string[]
  unsupported?: string[]
  alreadyQueued?: string[]
  skipped?: string
  error?: string
}

export interface AutoPilotLastRun {
  at?: string | null
  status?: string | null
  error?: string | null
  report?: AutoSocialReport | null
}

const LABELS: Record<string, string> = {
  facebook: 'Facebook', twitter: 'X', threads: 'Threads', linkedin: 'LinkedIn',
  bluesky: 'Bluesky', telegram: 'Telegram', pinterest: 'Pinterest',
}
const label = (p: string) => LABELS[p] ?? p
const list = (ps: string[]) => {
  const named = ps.map(label)
  if (named.length <= 1) return named.join('')
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
}

export type AutoPilotTone = 'ok' | 'warn' | 'none'

/** One line about the last run, plus a tone so the UI can colour it.
 *  Returns null when there is genuinely nothing to report yet. */
export function describeAutoPilotRun(run: AutoPilotLastRun | null | undefined): { tone: AutoPilotTone; text: string } | null {
  if (!run) return null

  // The job itself failed. That is a bigger fact than anything about socials,
  // and it explains the silence completely.
  if (run.status === 'failed') {
    return { tone: 'warn', text: `The last auto-pilot run failed${run.error ? `: ${run.error.slice(0, 160)}` : '.'}` }
  }

  const r = run.report
  if (!r) {
    // A run from before the reporting existed. Say that plainly instead of
    // inventing a result for it.
    return { tone: 'none', text: 'The last run finished before MVP started recording which socials went out. The next one will show here.' }
  }

  if (r.error) {
    return { tone: 'warn', text: `The post published, but queueing the socials failed: ${r.error.slice(0, 160)}` }
  }
  if (r.skipped === 'no-socials-selected') {
    return { tone: 'none', text: 'Last run published the blog post. No socials were selected, so none were queued.' }
  }
  if (r.skipped === 'no-post-id') {
    // The shape of a generation that published and then timed out: the post is
    // live, the worker never got its id back, so the cascade had nothing to
    // attach to. Worth naming exactly, because "retry" is the fix and it is not
    // obvious from a silent set of channels.
    return {
      tone: 'warn',
      text: 'The blog post published but the run did not report back in time, so the socials were never queued. Publish this one to socials by hand from its card.',
    }
  }

  const scheduled = r.scheduled ?? []
  const problems: string[] = []
  if (r.notConnected?.length) problems.push(`${list(r.notConnected)} ${r.notConnected.length === 1 ? 'is' : 'are'} not connected`)
  if (r.notInTier?.length) problems.push(`${list(r.notInTier)} ${r.notInTier.length === 1 ? 'is' : 'are'} not on your plan`)
  if (r.unsupported?.length) problems.push(`${list(r.unsupported)} cannot be auto-posted`)
  if (r.alreadyQueued?.length) problems.push(`${list(r.alreadyQueued)} ${r.alreadyQueued.length === 1 ? 'was' : 'were'} already queued`)

  if (!scheduled.length) {
    return {
      tone: 'warn',
      text: problems.length
        ? `Last run published the blog post but queued no socials: ${problems.join('; ')}.`
        : 'Last run published the blog post but queued no socials.',
    }
  }
  return {
    tone: problems.length ? 'warn' : 'ok',
    text: problems.length
      ? `Last run queued ${list(scheduled)}. Skipped: ${problems.join('; ')}.`
      : `Last run queued ${list(scheduled)}.`,
  }
}
