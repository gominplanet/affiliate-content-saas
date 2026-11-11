// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE CREATOR'S geni.us LINKS, READ FROM THEIR OWN GENIUSLINK ACCOUNT (YouTube
// vs Amazon; Seb, 2026-11-11: "most YouTube videos, if not all of them, will
// have a link, and that link will be a product").
//
// Nearly every one of Seb's descriptions opens with a geni.us link, and
// geni.us answers ten follows a minute (its own ratelimit-limit: 10 header),
// so reading 3,500 of them by following each one came back "slow down" for
// most. The creator's Geniuslink account lists the same links with where each
// goes (services/geniuslink listLinks), so a batch of descriptions costs one
// call there and no follows at all. The keys are the ones the creator saved in
// MVP for Geniuslink links. Server only.

import { createGeniuslinkService, type GeniuslinkLink } from '@/services/geniuslink'
import { asinFromAmazonUrl } from '@/lib/asin'
import { getLinkStyle } from '@/lib/link-cloak'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type GeniusEntry = { asin: string | null; destination: string | null }

export interface GeniusRead {
  /** code (as written in the link) to where it goes. */
  map: Map<string, GeniusEntry>
  /** 'read': asked the account; 'no-keys': no Geniuslink keys saved in MVP;
   *  'error': the account did not answer (see `why`). */
  state: 'read' | 'no-keys' | 'error'
  why: string | null
}

/** The short code of a geni.us link, or null for any other link. Pure. */
export function geniusCode(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/^(www\.)?geni\.us$/i.test(u.hostname)) return null
    const m = /^\/([A-Za-z0-9_-]{3,40})\/?$/.exec(u.pathname)
    return m ? m[1] : null
  } catch { return null }
}

const entryOf = (l: GeniuslinkLink): GeniusEntry => ({
  asin: asinFromAmazonUrl(l.destination || '') || asinFromAmazonUrl(l.productUrl || '') || null,
  destination: l.destination || l.productUrl || null,
})

// The whole account, kept a few minutes per creator, for when the account does
// not narrow its list by code (a batch is read every few seconds).
const whole = new Map<string, { at: number; map: Map<string, GeniusEntry> }>()

async function keysFor(db: Db, ownerId: string): Promise<{ key: string; secret: string } | null> {
  try {
    const { data } = await db.from('integrations').select('geniuslink_api_key, geniuslink_api_secret').eq('user_id', ownerId).maybeSingle()
    if (data?.geniuslink_api_key && data?.geniuslink_api_secret) return { key: String(data.geniuslink_api_key), secret: String(data.geniuslink_api_secret) }
  } catch { /* the link style may hold them */ }
  try {
    const style = await getLinkStyle(db, ownerId)
    if (style.geniuslinkKey && style.geniuslinkSecret) return { key: style.geniuslinkKey, secret: style.geniuslinkSecret }
  } catch { /* none */ }
  return null
}

/** Where each geni.us link in `urls` goes, from the creator's account. */
export async function geniuslinkAsins(db: Db, ownerId: string, urls: string[]): Promise<GeniusRead> {
  const codes = Array.from(new Set(urls.map(geniusCode).filter((c): c is string => !!c)))
  const map = new Map<string, GeniusEntry>()
  if (!codes.length) return { map, state: 'read', why: null }
  const keys = await keysFor(db, ownerId)
  if (!keys) return { map, state: 'no-keys', why: null }
  const gl = createGeniuslinkService(keys.key, keys.secret)
  const want = new Set(codes)
  const put = (l: GeniuslinkLink, into: Map<string, GeniusEntry>) => {
    const e = entryOf(l)
    into.set(l.code, e)
    for (const a of l.aliases) if (!a.domain || /geni\.us$/.test(a.domain)) into.set(a.code, e)
  }
  const first = await gl.listLinks({ codes, take: codes.length * 2 + 20 })
  if (first.error) return { map, state: 'error', why: first.error }
  // Narrowed as asked: every link that came back is one of these codes.
  const narrowed = first.links.length > 0 && first.links.every((l) => want.has(l.code) || l.aliases.some((a) => want.has(a.code)))
  if (narrowed) {
    for (const l of first.links) put(l, map)
    return { map, state: 'read', why: null }
  }
  // Not narrowed (or nothing matched): the whole account, a page at a time.
  let all = whole.get(ownerId)
  if (!all || Date.now() - all.at > 10 * 60_000) {
    const m = new Map<string, GeniusEntry>()
    for (let page = 0; page < 40; page++) {
      const r = await gl.listLinks({ take: 500, skip: page * 500 })
      if (r.error) return { map, state: 'error', why: r.error }
      for (const l of r.links) put(l, m)
      if (r.links.length < 500) break
    }
    all = { at: Date.now(), map: m }
    whole.set(ownerId, all)
  }
  for (const c of codes) { const e = all.map.get(c); if (e) map.set(c, e) }
  return { map, state: 'read', why: null }
}
