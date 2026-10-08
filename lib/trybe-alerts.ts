// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE REPLY ALERTS (Seb, 2026-10-08 upgrade 4): a brand that answers on
// TRYBE shows on MVP without opening TRYBE Outreach, as a count on the menu
// item and an item in the Today list.
//
// MVP's server cannot reach TRYBE: only SCOUT can, from the creator's own
// Chrome. So whenever SCOUT reads the TRYBE inbox (the TRYBE Outreach page,
// or the light check the dashboard makes every half hour), the page tells
// MVP how many messages are unread and from whom. The menu and Today read
// that note, with the time it was taken, so an old count is never shown as
// a current one.

/** A count older than this is not shown: it may have been read on TRYBE. */
export const TRYBE_ALERT_FRESH_MS = 48 * 3600_000
/** How often the dashboard asks SCOUT for the inbox, at most. */
export const TRYBE_SHELL_CHECK_MS = 30 * 60_000
/** Set once the TRYBE inbox has been read in this browser: the dashboard
 *  only checks for a creator who uses it, so nobody else gets a TRYBE tab. */
export const TRYBE_INBOX_ON_KEY = 'mvp.trybe.inboxOn'
export const TRYBE_LAST_CHECK_KEY = 'mvp.trybe.lastCheck'
/** Fired on window with the snapshot, so the menu follows straight away. */
export const TRYBE_ALERT_EVENT = 'mvp:trybe-alerts'

export interface InboxSnapshot { unread: number; names: string[] }

/** Unread messages across the inbox, and the conversations they are in. */
export function inboxSnapshot(convos: Array<{ name: string; unread: number; at: number }>): InboxSnapshot {
  const waiting = convos.filter(c => c.unread > 0).sort((a, b) => b.at - a.at)
  return {
    unread: waiting.reduce((n, c) => n + c.unread, 0),
    names: waiting.map(c => String(c.name || '').slice(0, 80)).filter(Boolean).slice(0, 10),
  }
}

/** Shown only while fresh. Null when there is nothing current to show. */
export function freshUnread(row: { unread: number | null; checkedAt: string | null }, now = Date.now()): number | null {
  if (row.unread == null || !row.checkedAt) return null
  const t = Date.parse(row.checkedAt)
  if (!Number.isFinite(t) || now - t > TRYBE_ALERT_FRESH_MS) return null
  return Math.max(0, row.unread)
}

/** "Acme", "Acme and Oros", "Acme, Oros and 2 more". */
export function whoWrote(names: string[]): string {
  if (!names.length) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

/** "just now", "20 minutes ago", "3 hours ago". */
export function checkedAgo(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (m < 2) return 'just now'
  if (m < 60) return `${m} minutes ago`
  const h = Math.round(m / 60)
  return h === 1 ? '1 hour ago' : `${h} hours ago`
}

let lastSent: { key: string; at: number } | null = null

/** Tell MVP what the inbox holds now. The same answer is sent again only
 *  after ten minutes, so the page's two minute polling stays one write. */
export async function reportTrybeInbox(convos: Array<{ name: string; unread: number; at: number }>): Promise<void> {
  if (typeof window === 'undefined') return
  const snap = inboxSnapshot(convos)
  try { localStorage.setItem(TRYBE_INBOX_ON_KEY, '1'); localStorage.setItem(TRYBE_LAST_CHECK_KEY, String(Date.now())) } catch { /* this browser only */ }
  try { window.dispatchEvent(new CustomEvent(TRYBE_ALERT_EVENT, { detail: snap })) } catch { /* old browser */ }
  const key = `${snap.unread}|${snap.names.join('|')}`
  if (lastSent && lastSent.key === key && Date.now() - lastSent.at < 10 * 60_000) return
  lastSent = { key, at: Date.now() }
  try {
    const r = await fetch('/api/labs/trybe/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snap) })
    if (!r.ok) lastSent = null // tried again on the next read
  } catch { lastSent = null }
}
