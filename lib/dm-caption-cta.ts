// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The caption line that tells viewers how to get the link (Seb, 2026-10-09:
// "I want a CTA that says comment this word for link"). With Auto-DM on, a
// Reel's caption saying "Link in bio" sends people the long way round while
// the post can DM them the link. Pure.

/** The call to action for a keyword, in the creator's voice. */
export function dmCtaLine(keyword: string): string {
  const kw = (keyword || 'LINK').trim().toUpperCase() || 'LINK'
  return `Comment ${kw} and I’ll DM you the link.`
}

const OURS = /Comment\s+\S+\s+and I[’']ll DM you the link\.?/i
const BIO = /(?:\u{1F449}\s*)?(?:shop the )?link (?:is )?in (?:my |the )?bio[.!]?/iu

/**
 * The caption with the Auto-DM line in place (keyword given) or back to
 * "Link in bio." (keyword null). Replaces a "Link in bio" when there is one,
 * swaps an earlier keyword's line, and otherwise puts the line just above the
 * hashtags or disclosure so it is read before them.
 */
export function withDmCta(caption: string, keyword: string | null): string {
  const text = String(caption ?? '')
  if (keyword === null) return OURS.test(text) ? text.replace(OURS, 'Link in bio.') : text
  const line = dmCtaLine(keyword)
  if (OURS.test(text)) return text.replace(OURS, line)
  if (BIO.test(text)) return text.replace(BIO, line)
  const lines = text.split('\n')
  // Above the first hashtags or disclosure AFTER the body. A caption that opens
  // with "#ad #sponsored" put the line at the very bottom, under the disclosure.
  const tail = /^\s*(#|\u{1F4CC}|As an Amazon Associate)/u
  const body = lines.findIndex((l) => l.trim() !== '' && !tail.test(l))
  const at = body < 0 ? -1 : lines.findIndex((l, i) => i > body && tail.test(l))
  if (at <= 0) return text.trim() ? `${text.trimEnd()}\n\n${line}` : line
  const before = lines.slice(0, at).join('\n').trimEnd()
  return `${before}\n\n${line}\n\n${lines.slice(at).join('\n')}`.slice(0, 2200)
}
