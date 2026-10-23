// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE WORDS OF AN AUTO-DM, built in one place for the webhook that sends it
// and for the preview a creator reads before posting (Seb, 2026-10-23: "showing
// the users the actual link, the actual affiliate link that will be sent out
// if someone says the word"). A preview built by other code would drift from
// what goes out, and a preview that differs from the DM is worse than none.
// Pure, so the browser can use it. Re-exported by lib/ig-dm.

import { ensureDisclaimer } from '@/lib/social-disclaimer'
import { storeOf } from '@/lib/store-name'

/** The message when the creator has not written one. */
export const DEFAULT_DM_TEMPLATE = 'Here you go \u{1F517} {link}'

/** The keyword as it is saved and matched: one word, no spaces, at most 30
 *  characters, LINK when empty. A multi-word trigger is fragile to match, and
 *  the box used to take "SEND ME" while only "SEND" was saved. Pure. */
export function oneWordKeyword(raw: unknown, fallback = 'LINK'): string {
  return String(raw ?? '').trim().split(/\s+/)[0].slice(0, 30) || fallback
}

/** The words on a link to the page a DM sends people to, naming where it goes
 *  (links say where they go). Pure. */
export function dmLinkWords(kind: 'shop' | 'blog' | 'amazon' | 'custom' | null | undefined, link: string, store?: string | null): string {
  if (kind === 'shop') return 'Open your Link in Bio page'
  if (kind === 'blog') return 'Open your blog post'
  const where = store || storeOf(link)
  return where ? `Open the link on ${where}` : 'Open the link they get'
}

/**
 * Fill the {link} placeholder, then guarantee the two things a DM carrying an
 * affiliate link has to say.
 *
 * The template is the creator's to write, and the default was "Here you go
 * {link}". Next to a cloaked link that is a bare mvpl.ink URL with no retailer
 * named and no disclosure, in a private message, which is the least transparent
 * place a link can land. Amazon policy 6(w) wants the placement to make clear it
 * goes to an Amazon Site, and the FTC wants the relationship disclosed where the
 * recommendation is made, not only on a blog somewhere else.
 *
 * Neither is added when the creator already said it, so a template that reads
 * naturally is left exactly as written.
 */
export function renderMessage(template: string, link: string, amazonDestination = false, confirmedStore: string | null = null): string {
  const t = stripStopLine(template) || DEFAULT_DM_TEMPLATE
  let out = t.includes('{link}') ? t.replace(/\{link\}/g, link) : `${t}\n${link}`
  // Another store a plain address names says so too (lib/store-name). A short
  // link that hides its store is named only when MVP followed it to its store
  // (confirmedStore, lib/link-store); otherwise it gets no guess.
  const store = amazonDestination ? 'Amazon' : (confirmedStore || storeOf(link))
  if (store && !out.toLowerCase().includes(store.toLowerCase())) out = `${out}\n\nThis link goes to ${store}.`
  return ensureDisclaimer(out)
}

/**
 * "Reply STOP to opt out" WAS IN THE DEFAULT MESSAGE, and nothing read the
 * replies (Seb, 2026-10-09). A DM that promises an opt-out MVP never honours is
 * worse than no line at all, and Meta does not ask for one on a private reply
 * (it is a single answer to a comment the person wrote). Saved templates still
 * hold it, so it is taken out when the message is built.
 */
export function stripStopLine(template: string | null | undefined): string {
  return String(template ?? '').replace(/\s*reply\s+stop\s+to\s+opt\s+out\.?/gi, '').trim()
}

/** What MVP posts under a comment after sending the DM. Its own reply comes back
 *  as a comment event, and with the keyword "DM" it would match. */
export const PUBLIC_REPLY = 'Sent you a DM! \u{1F4E9}'
