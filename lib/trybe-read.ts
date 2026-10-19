// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// READ ON MVP WHEN TRYBE WILL NOT KEEP IT (Seb, 2026-10-19). A TRYBE
// announcement ("Quick heads-up: 4:5 Safe Zones...") stayed unread on MVP and
// on TRYBE's own phone app after it was opened in both: TRYBE takes the read
// and then counts the conversation unread again. MVP already tells TRYBE when
// a conversation is opened (TrybeInbox markRead), so the 1 it kept showing
// was TRYBE's own count, stuck.
//
// So opening a conversation on MVP also remembers, in this browser, the time
// of the latest message it showed. While that is still the latest message,
// MVP counts the conversation read whatever TRYBE says, and says so beside it,
// so a quiet badge is never mistaken for TRYBE agreeing. A newer message makes
// it unread again straight away.

const KEY = 'mvp.trybe.seenUpTo'
const KEEP = 300

/** True when TRYBE's unread count covers only messages already seen here:
 *  the conversation's latest message is no newer than the one last opened. */
export function seenCovers(trybeUnread: number, lastAt: number, seenAt: number): boolean {
  return trybeUnread > 0 && lastAt > 0 && seenAt > 0 && seenAt >= lastAt
}

/** Conversation id to the time of the latest message seen in it here. Empty
 *  on the server, in a private window, or when storage is blocked. */
export function seenUpTo(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {}
  } catch { return {} }
}

/** Remember that this conversation was read up to `at`. Never moves back, and
 *  keeps the latest 300 conversations. */
export function rememberSeen(id: string, at: number): void {
  if (typeof window === 'undefined' || !id || !(at > 0)) return
  try {
    const all = seenUpTo()
    if ((all[id] ?? 0) >= at) return
    delete all[id]
    all[id] = at
    const keys = Object.keys(all)
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete all[k]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* storage blocked: TRYBE's own count shows, as before */ }
}
