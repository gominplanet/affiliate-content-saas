// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One Auto-DM log row in plain words, for the Recent comments list. Pure.
//
// A DM that went out, one that failed, one still waiting on Meta and a comment
// that was skipped must never look alike: the old log showed a bare status
// word, and "sent" was written before the DM had even left.

export type DmLogRow = { status?: string | null; error?: string | null; link_sent?: string | null; created_at?: string | null }
export type DmLogWords = { tone: 'good' | 'bad' | 'wait' | 'muted'; title: string; detail: string | null }

/** How long Meta gets to answer before a "sending" row reads as unconfirmed. */
export const SENDING_STALE_MS = 5 * 60_000

export function dmLogWords(r: DmLogRow, now = Date.now()): DmLogWords {
  const err = String(r.error ?? '').trim() || null
  switch (r.status) {
    case 'sent':
      return { tone: 'good', title: 'DM sent', detail: r.link_sent ? `Sent ${r.link_sent}${err ? `. ${err}` : ''}` : err }
    case 'failed':
      return { tone: 'bad', title: 'DM failed', detail: err || 'Meta refused it without a reason.' }
    case 'sending': {
      const at = r.created_at ? Date.parse(r.created_at) : NaN
      const stale = Number.isFinite(at) && now - at > SENDING_STALE_MS
      return stale
        ? { tone: 'bad', title: 'Never confirmed', detail: 'MVP started sending but Meta never answered, so it may not have arrived.' }
        : { tone: 'wait', title: 'Sending', detail: 'Waiting for Meta to confirm.' }
    }
    // WAITING ITS TURN (lib/ig-pace): spaced from the account's last DM, or
    // past the hour's cap; the ig-dm-queue job sends it.
    case 'queued':
      return { tone: 'wait', title: 'Waiting its turn', detail: 'MVP spaces auto-DMs out so Instagram does not read them as a bot. This one goes within a few minutes.' }
    default:
      return { tone: 'muted', title: 'No DM', detail: err || 'Skipped.' }
  }
}
