// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH STORE A LINK OPENS, CONFIRMED (Seb, 2026-10-10: "it all depends on
// which store the link points to, it's not always Amazon, MVP needs to
// confirm"). A cloaked link says nothing by its address, so it is asked:
//   - a Passport code (mvpl.ink, /go/<code>) is looked up by its stored target
//   - a short or affiliate redirect link (geni.us, bit.ly, ShareASale...) is
//     followed to where it lands
//   - a plain store address (amazon.com, walmart.com) says it by itself
// Anything else stays unconfirmed, and no store is named for it.
//
// Server only. Never throws.

import { linkDestination, rememberLinkDestination, DEST_NAME, type LinkDestination } from '@/lib/social-disclaimer'
import { passportCodeFromUrl, passportTargetForCode } from '@/lib/passport-links'
import { resolveTrueDestination } from '@/lib/affiliate-resolve'
import { nameStoreBeforeLinks } from '@/lib/link-store-words'

const URL_RE = /https?:\/\/[^\s<>"'\])]+/g
/** Links that only say where they go once followed. */
const REDIRECT_HOST = /(?:^|\.)(?:geni\.us|gnz\.[a-z]+|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly|shrsl\.com|howl\.(?:me|link)|rstyle\.me|linksynergy\.com|sjv\.io|pxf\.io|go\.magik\.ly|shop-links\.co|amzlink\.to|linktw\.in|cutt\.ly|t\.co|ow\.ly|is\.gd)$/i
const FOLLOW_MS = 6000
const MAX_LINKS = 6

export type LinkStoreCheck = {
  /** What was confirmed, for linkDestination(url, known). */
  known: Record<string, LinkDestination | string>
  confirmed: Array<{ url: string; store: string }>
  /** Links MVP could not confirm: no store was named for these. */
  unconfirmed: string[]
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

async function landing(userId: string, url: string): Promise<LinkDestination | string | null> {
  const code = passportCodeFromUrl(url)
  if (code) {
    const t = await passportTargetForCode(userId, code)
    if (t?.asin) return 'amazon'
    return t?.destinationUrl || null
  }
  if (!REDIRECT_HOST.test(hostOf(url))) return null
  const dest = await Promise.race([
    resolveTrueDestination(url).catch(() => ''),
    new Promise<string>((r) => setTimeout(() => r(''), FOLLOW_MS)),
  ])
  return dest && hostOf(dest) && hostOf(dest) !== hostOf(url) ? dest : null
}

export async function confirmLinkStores(userId: string, text: string): Promise<LinkStoreCheck> {
  const urls = [...new Set([...String(text || '').matchAll(URL_RE)].map((m) => m[0].replace(/[.,!?;:]+$/, '')))].slice(0, MAX_LINKS)
  const known: Record<string, LinkDestination | string> = {}
  await Promise.all(urls.map(async (url) => {
    if (linkDestination(url)) return
    try {
      const target = await landing(userId, url)
      if (target) { known[url] = target; rememberLinkDestination(url, target) }
    } catch { /* unconfirmed */ }
  }))
  const confirmed: LinkStoreCheck['confirmed'] = []
  const unconfirmed: string[] = []
  for (const url of urls) {
    const d = linkDestination(url, known)
    if (d) confirmed.push({ url, store: DEST_NAME[d] })
    else unconfirmed.push(url)
  }
  return { known, confirmed, unconfirmed }
}

/** The comment with each confirmed store named right before its link, and
 *  what could not be confirmed. Never throws: on any failure the text comes
 *  back unchanged and every link is reported unconfirmed. */
export async function nameLinkStores(userId: string, text: string, product?: string | null): Promise<{ text: string } & Omit<LinkStoreCheck, 'known'>> {
  try {
    const c = await confirmLinkStores(userId, text)
    return { text: nameStoreBeforeLinks(text, c.known, product), confirmed: c.confirmed, unconfirmed: c.unconfirmed }
  } catch {
    const urls = [...String(text || '').matchAll(URL_RE)].map((m) => m[0])
    return { text, confirmed: [], unconfirmed: urls }
  }
}

/** The words a page shows when a link's store could not be confirmed. */
export function unconfirmedStoreWords(unconfirmed: string[]): string | null {
  if (!unconfirmed.length) return null
  return unconfirmed.length === 1
    ? `MVP could not confirm which store ${unconfirmed[0]} opens, so the comment does not name one. Add "on Amazon" (or the right store) before the link yourself.`
    : `MVP could not confirm which store ${unconfirmed.length} of the links open, so the comment does not name one for them. Add the store before each link yourself.`
}
