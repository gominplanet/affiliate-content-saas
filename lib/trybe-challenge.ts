// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BRAND CHALLENGE, TRACKED (Seb, 2026-11-20: "build the challenge
// tracker"). He was chasing a NOBL bounty: 300 approved videos by November 30
// for $10,000, which is $33.33 a video and makes NOBL the best paying brand
// if hit. The hidden risk is the brand's approval queue, not the creator's
// output: when the brand takes 3 days to decide, the real cutoff for sending
// is 3 days before the stated deadline. So the tracker reads the brand's
// submissions through SCOUT and says, in their own numbers: approved so far,
// what is waiting and how much of it will likely count, how long the brand
// takes to decide (from past decisions, else the age of what is waiting), the
// real last day to send, the videos a day that reaches the target, the pace
// of the last 7 days, and what the reward pays per video. A number it could
// not read stays unknown and never becomes "on track". Pure, so it is tested
// (scripts/test-trybe-challenge.ts).

export interface Challenge {
  id: string
  brandId: string
  brand: string
  /** Approved videos the brand asks for. */
  target: number
  /** The last day, YYYY-MM-DD, counted to the end of that day. */
  deadline: string
  /** Videos sent on or after this day count, YYYY-MM-DD. */
  startsOn: string
  /** The reward in dollars, when there is one. */
  reward: number | null
}

export interface ChallengeSub { status: 'pending' | 'approved' | 'rejected' | 'other'; rawStatus?: string; at: number | null; decidedAt?: number | null }

export type ChallengeState = 'done' | 'on_track' | 'behind' | 'out_of_time' | 'unknown'

export interface ChallengeRead {
  approved: number
  pending: number
  revision: number
  rejected: number
  sent: number
  /** Approved out of everything the brand has answered (approved, revision,
   *  rejected); null under 5 answers. */
  approvalRate: number | null
  /** Days the brand takes to decide, whole days up; null when not known. */
  lagDays: number | null
  lagFrom: 'decisions' | 'queue' | 'both' | null
  /** The last day to send so a video can still be approved in time. */
  cutoff: string
  daysToCutoff: number
  daysLeft: number
  /** Of what is waiting, how many will likely be approved. */
  likelyFromQueue: number
  /** More videos to send by the cutoff to reach the target; null when the
   *  approval rate is not known. */
  toSend: number | null
  perDay: number | null
  /** Videos sent a day over the last 7 days. */
  pace7: number
  perVideoIfHit: number | null
  state: ChallengeState
  says: string[]
}

const DAY = 86_400_000
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
/** The end of a YYYY-MM-DD day, in the viewer's time. */
const endOf = (day: string) => new Date(`${day}T23:59:59`).getTime()
const startOf = (day: string) => new Date(`${day}T00:00:00`).getTime()
/** A time as its YYYY-MM-DD day, in the viewer's time. Pure. */
export const dayOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }
const isRevision = (x: ChallengeSub) => x.status === 'other' && /revis|change|edit/i.test(x.rawStatus || '')
/** "Nov 30". Pure. */
export const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const money = (n: number) => `$${n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)}`
const whole = (n: number) => Math.round(n).toLocaleString('en-US')

/** Whole days from now to the end of a day, counting today; 0 once it is past. Pure. */
export function daysUntil(day: string, now: number): number {
  const end = endOf(day)
  if (end < now) return 0
  return Math.floor((startOf(day) - startOf(dayOf(now))) / DAY) + 1
}

/** Where the challenge stands, from the brand's submissions. Pure. */
export function readChallenge(c: Challenge, subs: ChallengeSub[], now = Date.now()): ChallengeRead {
  const from = isDay(c.startsOn) ? startOf(c.startsOn) : 0
  const until = isDay(c.deadline) ? endOf(c.deadline) : Infinity
  const mine = subs.filter((x) => x.at != null && x.at >= from && x.at <= until)
  const approved = mine.filter((x) => x.status === 'approved').length
  const rejected = mine.filter((x) => x.status === 'rejected').length
  const revision = mine.filter(isRevision).length
  const pending = mine.filter((x) => x.status === 'pending').length
  const answered = approved + rejected + revision
  // The brand's own answers decide the rate; this challenge's when there are
  // enough, else everything it ever answered for this creator.
  const allAnswered = subs.filter((x) => x.status === 'approved' || x.status === 'rejected' || isRevision(x))
  const rateBase = answered >= 5 ? { a: approved, n: answered } : allAnswered.length >= 5 ? { a: subs.filter((x) => x.status === 'approved').length, n: allAnswered.length } : null
  const approvalRate = rateBase ? rateBase.a / rateBase.n : null
  // HOW LONG IT TAKES TO DECIDE: past decisions (sent to decided), and the age
  // of what waits now, which is how long the queue is at least. The longer.
  const decided = subs.filter((x) => x.at != null && x.decidedAt != null && (x.decidedAt as number) >= (x.at as number)).map((x) => ((x.decidedAt as number) - (x.at as number)) / DAY)
  // What waits from this challenge, when any does: a video stuck for months
  // from before it started says little about how fast the brand decides now.
  const pendingIn = mine.filter((x) => x.status === 'pending')
  const waiting = (pendingIn.length ? pendingIn : subs.filter((x) => x.status === 'pending' && x.at != null)).map((x) => (now - (x.at as number)) / DAY)
  const fromDecisions = decided.length >= 3 ? median(decided) : null
  const fromQueue = waiting.length ? median(waiting) : null
  const lagRaw = fromDecisions != null && fromQueue != null ? Math.max(fromDecisions, fromQueue) : fromDecisions ?? fromQueue
  const lagDays = lagRaw == null ? null : Math.max(0, Math.ceil(lagRaw))
  const lagFrom: ChallengeRead['lagFrom'] = fromDecisions != null && fromQueue != null ? 'both' : fromDecisions != null ? 'decisions' : fromQueue != null ? 'queue' : null
  const cutoff = isDay(c.deadline) ? dayOf(endOf(c.deadline) - (lagDays ?? 0) * DAY) : c.deadline
  const daysToCutoff = isDay(cutoff) ? daysUntil(cutoff, now) : 0
  const daysLeft = isDay(c.deadline) ? daysUntil(c.deadline, now) : 0
  const queue = pending + revision
  const likelyFromQueue = approvalRate == null ? 0 : queue * approvalRate
  const need = Math.max(0, c.target - approved)
  const toSend = need === 0 ? 0 : approvalRate == null || approvalRate <= 0 ? null : Math.max(0, Math.ceil((need - likelyFromQueue) / approvalRate))
  const perDay = toSend == null ? null : toSend === 0 ? 0 : daysToCutoff > 0 ? toSend / daysToCutoff : null
  const sent7 = subs.filter((x) => x.at != null && (x.at as number) >= now - 7 * DAY && (x.at as number) <= now).length
  const pace7 = sent7 / 7
  const perVideoIfHit = c.reward != null && c.reward > 0 && c.target > 0 ? c.reward / c.target : null

  let state: ChallengeState = 'unknown'
  if (approved >= c.target) state = 'done'
  else if (toSend === 0) state = 'on_track'
  else if (toSend != null && daysToCutoff === 0) state = 'out_of_time'
  else if (perDay != null && lagDays != null) state = pace7 >= perDay ? 'on_track' : 'behind'

  const says: string[] = []
  says.push(`${whole(approved)} of ${whole(c.target)} approved.${queue ? ` ${whole(pending)} waiting${revision ? ` and ${whole(revision)} in revision` : ''}${approvalRate != null ? `; at your approval rate of ${Math.round(approvalRate * 100)}%, about ${whole(likelyFromQueue)} of those will count` : ''}.` : ''}`)
  if (state === 'done') says.push(`Target reached: ${whole(approved)} approved.${perVideoIfHit != null ? ` ${money(c.reward as number)} for ${whole(c.target)}, ${money(perVideoIfHit)} a video.` : ''}`)
  else {
    if (lagDays == null) says.push(`MVP cannot tell yet how long ${c.brand} takes to decide: no decision dates and nothing waiting. Leave a few days before ${shortDay(c.deadline)} to be safe.`)
    else if (lagDays > 0) says.push(`${c.brand} takes about ${lagDays} day${lagDays === 1 ? '' : 's'} to decide (${lagFrom === 'queue' ? `the ${whole(waiting.length)} waiting now are that old` : lagFrom === 'both' ? 'from its past decisions and what waits now' : 'from its past decisions'}). Send by ${shortDay(cutoff)}, not ${shortDay(c.deadline)}: a video sent later may not be approved in time.`)
    else says.push(`${c.brand} decides within the day, so you can send until ${shortDay(c.deadline)}.`)
    if (toSend == null) says.push('Your approval rate with it is not known yet (fewer than 5 answers), so MVP cannot say how many more to send.')
    else if (state === 'out_of_time') says.push(`The last day to send was ${shortDay(cutoff)}. About ${whole(toSend)} more would have been needed.`)
    else if (toSend === 0) says.push('What is waiting should be enough to reach it, if it is approved at your usual rate.')
    else if (perDay != null) says.push(`To reach ${whole(c.target)} you need about ${whole(toSend)} more videos by ${shortDay(cutoff)}: ${Math.ceil(perDay)} a day. Your last 7 days: ${pace7 >= 10 ? Math.round(pace7) : pace7.toFixed(1).replace(/\.0$/, '')} a day.`)
    if (perVideoIfHit != null) says.push(`If you hit it: ${money(c.reward as number)} for ${whole(c.target)} approved, ${money(perVideoIfHit)} a video on top of what each one earns.`)
  }
  return { approved, pending, revision, rejected, sent: mine.length, approvalRate, lagDays, lagFrom, cutoff, daysToCutoff, daysLeft, likelyFromQueue, toSend, perDay, pace7, perVideoIfHit, state, says }
}

export const STATE_WORDS: Record<ChallengeState, string> = { done: 'Reached', on_track: 'On track', behind: 'Behind', out_of_time: 'Out of time', unknown: 'Not known yet' }

/** The challenges a member saved, each checked; anything else is dropped. Pure. */
export function readChallenges(raw: unknown): Challenge[] {
  if (!Array.isArray(raw)) return []
  const out: Challenge[] = []
  for (const r of raw.slice(0, 12)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const target = typeof o.target === 'number' ? Math.round(o.target) : NaN
    const brand = typeof o.brand === 'string' ? o.brand.trim().slice(0, 120) : ''
    const brandId = typeof o.brandId === 'string' ? o.brandId.trim().slice(0, 80) : ''
    const deadline = typeof o.deadline === 'string' && isDay(o.deadline) ? o.deadline : ''
    const startsOn = typeof o.startsOn === 'string' && isDay(o.startsOn) ? o.startsOn : ''
    if (!brand || !brandId || !deadline || !startsOn || !(target >= 1 && target <= 100_000) || startsOn > deadline) continue
    const reward = typeof o.reward === 'number' && Number.isFinite(o.reward) && o.reward > 0 ? Math.round(o.reward * 100) / 100 : null
    const id = typeof o.id === 'string' && /^[a-z0-9-]{4,40}$/i.test(o.id) ? o.id : `${brandId}-${deadline}`
    out.push({ id, brandId, brand, target, deadline, startsOn, reward })
  }
  return out
}
