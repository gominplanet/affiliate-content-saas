// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SEARCH YOUR TRYBE CHATS (Seb, 2026-11-10: "just like tribe has inside of
// their own system, we should have a search bar to search for the brand that
// we want to talk to. A lot of users are going to have hundreds of brands or
// even dozens of brands"). Typing "nobl" finds NOBL, NOBL Q&A and NOBL Air
// Tracker Group: every word typed is in the chat's name, or failing that in
// its last message. Names first, then by newest. Pure.

/** Lowercase, accents and punctuation dropped, "&" kept as "and". */
export function chatWords(s: string): string {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** The chats a search finds: every word in the name first, then every word in
 *  the last message, each newest first. An empty search finds all, as they were. */
export function searchChats<T extends { name: string; last: string; at: number }>(list: T[], query: string): T[] {
  const words = chatWords(query).split(' ').filter(Boolean)
  if (!words.length) return list
  const has = (s: string) => { const w = chatWords(s); return words.every((x) => w.includes(x)) }
  const byName = list.filter((c) => has(c.name))
  const byLast = list.filter((c) => !byName.includes(c) && has(c.last))
  const newest = (a: T, b: T) => b.at - a.at
  return [...byName.sort(newest), ...byLast.sort(newest)]
}

/** TRYBE's chat list is read 100 at a time; a search reads on to at most this many pages. */
export const CHAT_PAGE = 100
export const CHAT_PAGES_MAX = 10
