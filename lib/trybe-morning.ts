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
  if (!m.on) return `Off. Press Daily refresh yourself, or turn this on.${last}`
  return `On. Next run ${m.next ? when(m.next) : 'not set'}: SCOUT opens this page behind your tabs and runs every step. Chrome needs to be open and signed in to MVP and TRYBE; a computer asleep at that hour runs it when it wakes.${last}`
}

