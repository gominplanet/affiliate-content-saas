// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE STORE IS NAMED RIGHT BEFORE THE LINK (Seb, 2026-10-10: a pinned YouTube
// comment read "see why so many session musicians are ditching their rigs:
// https://www.mvpl.ink/utsvk5v". "We absolutely need to disclaim the end link
// store... check out this XXXX on Amazon: (link)". And: "it all depends on which
// store the link points to, it's not always Amazon, MVP needs to confirm").
//
// Pure. The caller passes `known`, the destinations it CONFIRMED (a Passport
// code looked up, a short link followed: lib/link-store). A link whose store is
// not confirmed is left exactly as it is: naming the wrong store is worse than
// naming none, and the caller reports it.

import { linkDestination, DEST_NAME, DEST_LABEL, DEST_SAID, type LinkDestination } from '@/lib/social-disclaimer'

const URL_RE = /https?:\/\/[^\s<>"'\])]+/g
// A lead-in that already introduces the link: "Grab it here:", "Get it 👉".
const SEP_END = /\s*(?::|👉|→|➡️?|⬇️?)\s*$/u
/** A lead-in this short takes the store inside it ("Grab it here on Amazon:").
 *  A longer one is a sentence about something else ("see why musicians are
 *  ditching their rigs:"), and "on Amazon" there would change what it says,
 *  so the link gets its own line with its own label. */
export const SHORT_LEAD_WORDS = 8

const STORES = new Set<LinkDestination>(['amazon', 'walmart', 'ltk', 'tiktok'])

function cleanProduct(name: string | null | undefined): string {
  const words = String(name || '').replace(/^\s*the\s+/i, '').replace(/[:|]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  return words.slice(0, 6).join(' ')
}

/** The label put on a line of its own before a link: "Check out the Boss
 *  Katana 50 on Amazon:", or the plain store label without a product name. */
export function storeLead(dest: LinkDestination, product?: string | null): string {
  const p = cleanProduct(product)
  return p && STORES.has(dest) ? `Check out the ${p} on ${DEST_NAME[dest]}:` : DEST_LABEL[dest]
}

/** The words since the last sentence end: what the link's lead-in actually says. */
function clauseOf(s: string): string {
  const parts = s.split(/[.!?]+(?=\s)/)
  return parts[parts.length - 1] ?? ''
}
const wordCount = (s: string) => (s.replace(SEP_END, '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length

/**
 * Name the confirmed store right before every link in a comment. Idempotent:
 * a link whose lead-in already names its store is left alone.
 */
export function nameStoreBeforeLinks(
  text: string,
  known: Record<string, LinkDestination | string>,
  product?: string | null,
): string {
  let t = text || ''
  const matches = [...t.matchAll(URL_RE)].reverse()
  for (const m of matches) {
    const idx = m.index ?? 0
    const url = m[0].replace(/[.,!?;:]+$/, '')
    const dest = linkDestination(url, known)
    if (!dest) continue
    const on = `${dest === 'fbgroup' ? 'in' : 'on'} ${DEST_NAME[dest]}`
    const lineStart = t.lastIndexOf('\n', idx - 1) + 1
    const before = t.slice(lineStart, idx)

    if (!/[\p{L}\p{N}]/u.test(before)) {
      // The link starts its own line: the line above is its lead-in.
      const prevEnd = t.slice(0, lineStart).replace(/\s+$/, '').length
      const prevStart = t.lastIndexOf('\n', prevEnd - 1) + 1
      const prevLine = t.slice(prevStart, prevEnd)
      const directlyAbove = !/\n\s*\n/.test(t.slice(prevEnd, lineStart))
      if (directlyAbove && DEST_SAID[dest].test(clauseOf(prevLine))) continue
      if (directlyAbove && /[\p{L}]\s*:$/u.test(prevLine) && wordCount(clauseOf(prevLine)) <= SHORT_LEAD_WORDS) {
        const colon = prevEnd - 1
        t = `${t.slice(0, colon).replace(/\s+$/, '')} ${on}${t.slice(colon)}`
        continue
      }
      t = `${t.slice(0, idx)}${storeLead(dest, product)} ${t.slice(idx)}`
      continue
    }

    const clause = clauseOf(before)
    if (DEST_SAID[dest].test(clause)) continue
    const sep = SEP_END.exec(before)
    if (wordCount(clause) <= SHORT_LEAD_WORDS) {
      if (sep) {
        // "Grab it here: url" becomes "Grab it here on Amazon: url".
        const at = lineStart + (sep.index ?? 0)
        t = `${t.slice(0, at)} ${on}${t.slice(at)}`
      } else {
        // "Grab yours url" becomes "Grab yours here on Amazon: url".
        const here = /\bhere\s*$/i.test(before) ? '' : 'here '
        t = `${t.slice(0, idx).replace(/\s*$/, ' ')}${here}${on}: ${t.slice(idx)}`
      }
      continue
    }
    // A long sentence: it ends where it is, and the link gets its own label.
    let lead = before.replace(SEP_END, '').replace(/\s+$/, '')
    if (!/[.!?)]$/.test(lead)) lead += '.'
    t = `${t.slice(0, lineStart)}${lead}\n\n${storeLead(dest, product)} ${t.slice(idx)}`
  }
  return t
}
