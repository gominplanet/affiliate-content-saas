// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// INSTAGRAM AT A HUMAN PACE (Seb, 2026-10-26, after Alejandro's account was
// flagged: "could MVP posting automatically get flagged by instagram for
// automatic posting.. how do we get rid of this issue"). MVP posts through
// Instagram's own publishing API, which Instagram allows; what reads as a bot
// is the pattern: posts seconds apart, the same caption again, a burst of
// identical DMs. So:
//   - a Reel or feed post goes at least IG_FEED_GAP_MS after the account's
//     last one (any post, MVP's or not; Stories are left alone, a Reel shared
//     to Stories right after is what people do), checked against Instagram's
//     own list right before publishing;
//   - a caption word for word the same as one the account posted in the last
//     day is not posted;
//   - auto-DMs go at least DM_GAP_MS apart per account and at most
//     DM_HOURLY_CAP an hour; the rest wait their turn (lib/ig-dm, the
//     ig-dm-queue job), inside Instagram's 7 days for a reply to a comment.
// Scheduled posts that come up too soon are moved, and say when; a post made
// now that is too soon says how long to wait. Pure.

export const IG_FEED_GAP_MS = 15 * 60_000
export const IG_REPEAT_WINDOW_MS = 24 * 3_600_000
export const DM_GAP_MS = 20_000
export const DM_HOURLY_CAP = 60
/** Instagram takes a private reply to a comment for 7 days; MVP stops a little before. */
export const DM_REPLY_WINDOW_MS = 6.5 * 86_400_000

/** A post that would go too soon after the account's last one. */
export class IgTooSoonError extends Error {
  readonly waitUntil: number
  readonly lastAt: number
  constructor(lastAt: number, now = Date.now()) {
    const mins = Math.max(1, Math.round((now - lastAt) / 60_000))
    const wait = Math.max(1, Math.ceil((lastAt + IG_FEED_GAP_MS - now) / 60_000))
    super(`Not posted yet: MVP keeps Instagram posts at least ${Math.round(IG_FEED_GAP_MS / 60_000)} minutes apart, so Instagram does not read your account as automated. Your last post went up ${mins} minute${mins === 1 ? '' : 's'} ago; this one can go in about ${wait} minute${wait === 1 ? '' : 's'}, or schedule it.`)
    this.name = 'IgTooSoonError'
    this.lastAt = lastAt
    this.waitUntil = lastAt + IG_FEED_GAP_MS
  }
}

/** A caption the account already posted in the last day, word for word. */
export class IgRepeatError extends Error {
  constructor(postedAt: number, now = Date.now()) {
    const h = Math.max(1, Math.round((now - postedAt) / 3_600_000))
    super(`Not posted: the same caption went up on this Instagram account ${h} hour${h === 1 ? '' : 's'} ago, and Instagram reads a repeated post as spam. Change the caption to post it again.`)
    this.name = 'IgRepeatError'
  }
}

/** A caption as Instagram would judge it repeated: its words, without the
 *  hashtags, links and the "Comment X and I'll DM you" line. Pure. */
export function captionKey(caption: string | null | undefined): string {
  return String(caption || '').toLowerCase()
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/comment\s+\S+\s+and\s+i[’']?ll\s+dm\s+you[^\n.]*[.!]?/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** What the account's recent posts say about posting now. Pure. */
export function feedVerdict(recent: Array<{ caption?: string | null; timestamp?: string | null }>, caption: string | null | undefined, now = Date.now()): { ok: true } | { ok: false; tooSoon: number } | { ok: false; repeatAt: number } {
  const times = recent.map((m) => ({ at: Date.parse(String(m.timestamp || '')), key: captionKey(m.caption) })).filter((m) => Number.isFinite(m.at))
  const last = times.reduce((a, m) => Math.max(a, m.at), 0)
  if (last && now - last < IG_FEED_GAP_MS) return { ok: false, tooSoon: last }
  const key = captionKey(caption)
  const same = key.length >= 40 ? times.find((m) => m.key === key && now - m.at < IG_REPEAT_WINDOW_MS) : undefined
  if (same) return { ok: false, repeatAt: same.at }
  return { ok: true }
}

/** When this account's next auto-DM may go: now, or later behind the ones
 *  already waiting, DM_GAP_MS after the last one sent, and within
 *  DM_HOURLY_CAP an hour. A few seconds of chance so the gaps are not even. Pure. */
export function nextDmAt(o: { now: number; lastSentAt: number | null; sentInHour: number[]; lastQueuedAt: number | null; jitterMs?: number }): number {
  const jitter = o.jitterMs ?? Math.round(Math.random() * 10_000)
  let at = o.now
  if (o.lastSentAt) at = Math.max(at, o.lastSentAt + DM_GAP_MS + jitter)
  if (o.lastQueuedAt) at = Math.max(at, o.lastQueuedAt + DM_GAP_MS + jitter)
  const hour = [...o.sentInHour].filter((t) => o.now - t < 3_600_000).sort((a, b) => a - b)
  if (hour.length >= DM_HOURLY_CAP) at = Math.max(at, hour[hour.length - DM_HOURLY_CAP] + 3_600_000 + jitter)
  return at
}

/** The public reply under a comment, said a few ways: the same words under
 *  every comment read as a bot. Pure but for the pick. */
export const PUBLIC_REPLIES = ['Sent you a DM!', 'Check your DMs 📩', 'Just sent it to you!', 'Sent! Check your messages.', 'DM sent 🙌']
export function publicReply(pick = Math.random()): string {
  return PUBLIC_REPLIES[Math.min(PUBLIC_REPLIES.length - 1, Math.floor(pick * PUBLIC_REPLIES.length))]
}

// NEVER ON THE SAME MINUTE (Seb, 2026-10-26: "yes add time variation", after
// Alejandro's posts went up at nearly the same time every day). A scheduled
// Instagram post goes a set 0 to 30 minutes AFTER the time picked: never
// before it, since a post can be timed to a deal going live. The delay comes
// from the post's own id, so it is the same on every run and a post is never
// pushed later and later.
export const IG_SCHEDULE_SPREAD_MS = 30 * 60_000
/** The delay for this post. Pure. */
export function scheduleSpreadMs(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) % IG_SCHEDULE_SPREAD_MS
}
/** Whether a scheduled Instagram post is due, its delay included. Pure. */
export function igDueNow(id: string, scheduledAt: string | null | undefined, now = Date.now()): boolean {
  const at = Date.parse(String(scheduledAt || ''))
  return !Number.isFinite(at) || at + scheduleSpreadMs(id) <= now
}
/** Said where an Instagram post is scheduled. */
export const IG_SPREAD_WORDS = 'Instagram posts go up to 30 minutes after the time picked, never on the same minute, so a daily schedule does not look automated.'
