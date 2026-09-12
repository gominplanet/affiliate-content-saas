// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What actually happened to a scheduled Amazon post, in one word.
//
// The queue has to answer a question the database schema cannot: a row can be
// `status: 'completed'` and still be something the creator needs to read. The
// cron publishes, and then the affiliate link may have been substituted — the
// Passport link did not mint, or Geniuslink did not answer — and the post went
// out with a plain Amazon URL. Technically a success. Financially not the thing
// they set up.
//
// So there are FOUR outcomes over five statuses, and the extra one is the whole
// reason this file exists:
//
//   waiting    not sent yet, still cancellable
//   sent       published, nothing to say
//   sent-note  published, and the link is not the one they configured
//   failed     did not publish, here is why
//   cancelled  they stopped it
//
// Kept out of the component so it is decided once and can be asserted, rather
// than being three ternaries in JSX that nobody can test.

export type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
export type QueueOutcome = 'waiting' | 'sending' | 'sent' | 'sent-note' | 'failed' | 'cancelled'

/** 'good' gets the green treatment. 'warn' must NOT: a substituted link inside a
 *  green box is the same as not mentioning it. */
export type QueueTone = 'neutral' | 'good' | 'warn' | 'bad'

export interface QueueRowLike {
  status: QueueStatus
  /** Set on a completed row when the post went out with a caveat. */
  note?: string | null
  /** Set on a failed row. */
  error?: string | null
}

export function queueOutcome(r: QueueRowLike): QueueOutcome {
  switch (r.status) {
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    case 'processing': return 'sending'
    case 'completed': return r.note ? 'sent-note' : 'sent'
    default: return 'waiting'
  }
}

export function queueTone(o: QueueOutcome): QueueTone {
  switch (o) {
    case 'sent': return 'good'
    case 'sent-note': return 'warn'
    case 'failed': return 'bad'
    default: return 'neutral'
  }
}

/**
 * Only a pending row can be stopped. A row the cron has already claimed
 * ('processing') is mid-publish: offering Cancel there promises something we
 * cannot deliver, and the post appears on their Page a second later.
 */
export function queueCancellable(r: QueueRowLike): boolean {
  return r.status === 'pending'
}

/**
 * The sentence under the row, or null.
 *
 * A failed row shows its error. A completed row shows its note. They are never
 * the same field: before migration 329 the cron wrote soft notes into
 * error_message, so a published post with a substituted link was stored exactly
 * like a post that never went out.
 */
export function queueDetail(r: QueueRowLike): { text: string; kind: 'error' | 'note' } | null {
  if (r.status === 'failed' && r.error) return { text: r.error, kind: 'error' }
  if (r.status === 'completed' && r.note) return { text: r.note, kind: 'note' }
  return null
}
