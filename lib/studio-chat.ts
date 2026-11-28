// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT THE BRAND SENT IN CHAT, READ FROM THE CHAT ITSELF (Seb, 2026-11-28:
// "When I'm asking to add what they sent in chat, it gives me this error.
// I've opened the chat, I've read the chat, it just doesn't want to
// automatically add it"). "Add what they sent in chat" took only the links
// Messages had already read and kept (msglinks), so a brand that wrote its
// rules as messages, or whose links nobody had pressed "read" on, gave
// "nothing read". Now the Video Builder finds the chat with the brand on
// TRYBE through SCOUT, takes the brand's own messages, and the server reads
// every link in them. Pure, so it is tested (scripts/test-edit-studio.ts).

import { brandIdFromChat, matchBrand } from './trybe-brand-page'
import { messageLinks, type MessageLink } from './trybe-message-links'

/** A message as the Video Builder sends it to MVP's server. */
export interface ChatLine { at: number; who: string; text: string }

/** The most of the chat that is kept: the brand's latest messages. */
export const CHAT_MAX_MESSAGES = 80
export const CHAT_MAX_TEXT = 30000
/** Links read from the chat in one press. */
export const CHAT_MAX_LINKS = 6

/** The chat with this brand: the one TRYBE ties to its id, else the one
 *  named like it. Pure. */
export function findBrandChat<C extends { id: string; name: string; raw: unknown }>(chats: C[], brand: { id: string; name: string }): C | null {
  const byId = chats.find((c) => brandIdFromChat(c.raw) === brand.id)
  if (byId) return byId
  return chats.find((c) => matchBrand(c.name, [{ id: brand.id, name: brand.name }], []) != null) ?? null
}

/** The brand's own messages, oldest first: never yours. When MVP cannot tell
 *  whose a message is, it is kept, with its sender's name. Pure. */
export function brandLines(msgs: Array<{ text: string; who: string; at: number; mine: boolean | null }>): ChatLine[] {
  return msgs
    .filter((m) => m.mine !== true && m.text.trim())
    .sort((a, b) => a.at - b.at)
    .slice(-CHAT_MAX_MESSAGES)
    .map((m) => ({ at: Number(m.at) || 0, who: String(m.who || 'Brand').slice(0, 80), text: m.text.trim().slice(0, 4000) }))
}

/** What the browser sent, made safe to keep: messages only, capped. Pure. */
export function cleanLines(raw: unknown): ChatLine[] {
  const list = Array.isArray(raw) ? raw.slice(-CHAT_MAX_MESSAGES) : []
  const out: ChatLine[] = []
  for (const x of list) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const text = typeof o.text === 'string' ? o.text.trim().slice(0, 4000) : ''
    if (!text) continue
    out.push({ at: Number(o.at) || 0, who: typeof o.who === 'string' ? o.who.slice(0, 80) : 'Brand', text })
  }
  return out
}

const day = (ms: number) => (ms > 0 ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'Undated')

/** The messages as words for the rules reader: each with its day and who
 *  sent it, newest kept when there is too much. Pure. */
export function chatText(lines: ChatLine[]): string {
  const rows = lines.map((l) => `${day(l.at)}, ${l.who}: ${l.text}`)
  let total = 0
  const kept: string[] = []
  for (let i = rows.length - 1; i >= 0; i--) {
    if (total + rows[i].length + 1 > CHAT_MAX_TEXT) break
    kept.unshift(rows[i])
    total += rows[i].length + 1
  }
  return kept.join('\n')
}

/** Every link the brand sent, each once, up to CHAT_MAX_LINKS. Pure. */
export function chatLinks(lines: ChatLine[]): MessageLink[] {
  const seen = new Set<string>()
  const out: MessageLink[] = []
  for (const l of lines) for (const k of messageLinks(l.text, 20)) {
    if (seen.has(k.url)) continue
    seen.add(k.url)
    out.push(k)
  }
  return out.slice(0, CHAT_MAX_LINKS)
}
