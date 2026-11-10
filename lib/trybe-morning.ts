// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE MORNING RUN'S WORDS (Seb, 2026-11-06: "even if it's once a day ... Scout
// could do it automatically"). SCOUT 1.56.0 runs the team's Daily refresh by
// itself at the hour set; the switch on MVP's TRYBE page says what SCOUT
// answered: on or off, the next run, and how the last morning went, never a
// plan presented as a result.

export interface MorningState {
  on: boolean
  hour: number
  minute: number
  next: number | null
  lastAt: number | null
  lastResult: 'opened' | 'signed-out' | 'could-not-open' | null
}

/** What the morning switch says, from what SCOUT answered. Pure. */
export function morningWords(m: MorningState | null): string {
  if (!m) return 'SCOUT did not answer, so MVP cannot tell whether the morning run is on. Reload this page.'
  const when = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  const last = !m.lastAt ? '' : m.lastResult === 'signed-out' ? ` The last morning (${when(m.lastAt)}) found this Chrome signed out of MVP, so nothing ran.`
    : m.lastResult === 'could-not-open' ? ` The last morning (${when(m.lastAt)}) SCOUT could not open MVP's page.`
    : ` Last opened by SCOUT ${when(m.lastAt)}.`
  if (!m.on) return `Off. Press Refresh everything yourself, or turn this on.${last}`
  return `On. Next run ${m.next ? when(m.next) : 'not set'}: SCOUT opens this page behind your tabs and runs every step. Chrome needs to be open and signed in to MVP and TRYBE; a computer asleep at that hour runs it when it wakes.${last}`
}


// ── DID IT RUN? (Seb, 2026-11-07: "I watched it just go by and nothing
// happened. I just want to make sure that this feature ... actually runs").
// SCOUT opens the page in a tab behind the others, so nothing shows on the
// screen; and the card only said when SCOUT opened it. The page now records
// when a run by itself starts and when it finishes, and the card says which
// happened, never a plan presented as a result.

export interface AutoRunRecord {
  startedAt: string | null
  finishedAt: string | null
  steps?: Array<{ state: string }>
  /** Why a morning run could not start, as the page SCOUT opened said it (2026-11-10). */
  blockedAt?: string | null
  blockedWhy?: string | null
}

/** Done, skipped, partly, failed, counted from the steps. */
function stepCounts(steps: Array<{ state: string }>): string {
  const n = (s: string) => steps.filter((x) => x.state === s).length
  const parts = [[n('done'), 'done'], [n('warn'), 'partly'], [n('skipped'), 'skipped'], [n('failed'), 'failed']] as Array<[number, string]>
  return parts.filter(([c]) => c > 0).map(([c, w]) => `${c} ${w}`).join(', ')
}

/** Whether the last run by itself started and finished, in words. Pure. */
export function autoRunWords(rec: AutoRunRecord | null, scoutOpenedAt: number | null, now = Date.now()): { tone: 'ok' | 'warn' | 'info'; text: string } {
  const when = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const started = rec?.startedAt ? Date.parse(rec.startedAt) : NaN
  const finished = rec?.finishedAt ? Date.parse(rec.finishedAt) : NaN
  // SCOUT opened the page well after the last start MVP heard of: it did not
  // start there. (With no start recorded at all, nothing is claimed: starts
  // are recorded only since 2026-11-07.)
  if (scoutOpenedAt && Number.isFinite(started) && scoutOpenedAt - started > 5 * 60_000) {
    // The page said why (2026-11-10): shown instead of "open the tab".
    const blockedAt = rec?.blockedAt ? Date.parse(rec.blockedAt) : NaN
    if (rec?.blockedWhy && Number.isFinite(blockedAt) && blockedAt >= scoutOpenedAt - 60_000) {
      return { tone: 'warn', text: `SCOUT opened this page ${when(scoutOpenedAt)}, but the run could not start: ${rec.blockedWhy.replace(/\.?$/, '.')} The page tried again every minute for 20 minutes. Press Refresh everything to run it now.` }
    }
    return { tone: 'warn', text: `SCOUT opened this page ${when(scoutOpenedAt)}, but the run did not start in it. Open the MVP tab SCOUT left behind your others to see why, or press Refresh everything.` }
  }
  if (!Number.isFinite(started)) return { tone: 'info', text: 'No run by itself is recorded yet. The next one says here when it started and when it finished.' }
  if (!Number.isFinite(finished) || finished < started) {
    return now - started < 3 * 3600_000
      ? { tone: 'info', text: `Running by itself since ${when(started)}, in a tab behind your others. Chrome slows a tab you are not looking at, so it can take a while.` }
      : { tone: 'warn', text: `Started by itself ${when(started)} and did not finish: its tab was closed or the computer went to sleep. The next run picks up where it stopped.` }
  }
  const counts = stepCounts(rec?.steps || [])
  return { tone: 'ok', text: `Last ran by itself: started ${when(started)}, finished ${time(finished)}${counts ? `: ${counts}` : ''}.` }
}
