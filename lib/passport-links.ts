// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Passport Links — MVP-native geo-routing affiliate links (migration 282).
//
// One short link per product resolves, at click time, to the visitor's own
// country's Amazon store with the creator's tag for that country. This module
// holds the country → marketplace map, the destination builder, and the
// get-or-create for a link's short code. The redirect route (app/go/[code]) and
// the link-builders (blog / social) use it.

import { canUsePassport } from '@/lib/feature-access'
import { normalizeTier } from '@/lib/tier'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** ISO-3166 alpha-2 country → the Amazon marketplace to send that visitor to.
 *  Only the marketplaces with an Associates program are listed; a country not
 *  here falls back to the US store + US tag (so the click still earns). Vercel's
 *  x-vercel-ip-country gives us the alpha-2 code on every request. */
export const AMAZON_MARKETPLACES: Record<string, { host: string; code: string }> = {
  US: { host: 'www.amazon.com', code: 'US' },
  CA: { host: 'www.amazon.ca', code: 'CA' },
  GB: { host: 'www.amazon.co.uk', code: 'GB' },
  IE: { host: 'www.amazon.ie', code: 'IE' },
  DE: { host: 'www.amazon.de', code: 'DE' },
  FR: { host: 'www.amazon.fr', code: 'FR' },
  IT: { host: 'www.amazon.it', code: 'IT' },
  ES: { host: 'www.amazon.es', code: 'ES' },
  NL: { host: 'www.amazon.nl', code: 'NL' },
  SE: { host: 'www.amazon.se', code: 'SE' },
  PL: { host: 'www.amazon.pl', code: 'PL' },
  BE: { host: 'www.amazon.com.be', code: 'BE' },
  JP: { host: 'www.amazon.co.jp', code: 'JP' },
  AU: { host: 'www.amazon.com.au', code: 'AU' },
  IN: { host: 'www.amazon.in', code: 'IN' },
  MX: { host: 'www.amazon.com.mx', code: 'MX' },
  BR: { host: 'www.amazon.com.br', code: 'BR' },
  SG: { host: 'www.amazon.sg', code: 'SG' },
  AE: { host: 'www.amazon.ae', code: 'AE' },
  SA: { host: 'www.amazon.sa', code: 'SA' },
  TR: { host: 'www.amazon.com.tr', code: 'TR' },
}

/** The base URL a Passport Link is built on. Set PASSPORT_LINK_BASE to the short
 *  branded domain (e.g. https://mvpl.ink) once it's registered + pointed at the
 *  app; until then it defaults to the app origin, and the same codes keep working
 *  when the domain is swapped in (only this env changes). No trailing slash. */
export function passportLinkBase(): string {
  const explicit = (process.env.PASSPORT_LINK_BASE || '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  const app = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mvpaffiliate.io').trim().replace(/\/+$/, '')
  return app
}

/** Full public URL for a link code. On the branded short domain the redirect is
 *  served at the root via a host rewrite (mvpl.ink/x7k), so no /go segment; on the
 *  app's own domain (the pre-domain fallback) the route lives at /go/x7k. */
export function passportLinkUrl(code: string): string {
  const explicit = (process.env.PASSPORT_LINK_BASE || '').trim().replace(/\/+$/, '')
  if (explicit) return `${explicit}/${code}`
  const app = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mvpaffiliate.io').trim().replace(/\/+$/, '')
  return `${app}/go/${code}`
}

/** Normalize a visitor country header to an alpha-2 key we map on. UK → GB. */
export function normalizeCountry(raw: string | null | undefined): string {
  const c = (raw || '').trim().toUpperCase()
  if (c === 'UK') return 'GB'
  return /^[A-Z]{2}$/.test(c) ? c : 'US'
}

/**
 * Best-effort device / browser / OS from a User-Agent string, for the dashboard
 * breakdowns (the same slices Geniuslink shows). Deliberately lightweight: a few
 * ordered regex checks, no dependency. Returns null fields for an empty/unknown
 * UA so the analytics side can bucket them as "Unknown".
 */
export function parseUserAgent(ua: string | null | undefined): { device: string | null; browser: string | null; os: string | null } {
  const s = (ua || '').trim()
  if (!s) return { device: null, browser: null, os: null }

  // OS first (also informs the device guess).
  let os: string | null = null
  if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS'
  else if (/Android/i.test(s)) os = 'Android'
  else if (/Windows NT/i.test(s)) os = 'Windows'
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS'
  else if (/CrOS/i.test(s)) os = 'ChromeOS'
  else if (/Linux/i.test(s)) os = 'Linux'

  // Device class. A tablet is an iPad, or an Android without the "Mobile" token.
  let device: string
  if (/iPad|Tablet|PlayBook|Silk/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) device = 'Tablet'
  else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(s)) device = 'Mobile'
  else device = 'Desktop'

  // Browser — order matters (Edge/Brave/Opera masquerade as Chrome; Chrome UAs
  // also carry "Safari", so Chrome must be checked before Safari).
  let browser: string | null = null
  if (/Edg[eA]?\//i.test(s)) browser = 'Edge'
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera'
  else if (/SamsungBrowser/i.test(s)) browser = 'Samsung Internet'
  else if (/Firefox\/|FxiOS/i.test(s)) browser = 'Firefox'
  else if (/CriOS/i.test(s)) browser = 'Chrome'
  else if (/Chrome\//i.test(s)) browser = 'Chrome'
  else if (/Safari\//i.test(s)) browser = 'Safari'
  else if (/bot|crawler|spider|facebookexternalhit|WhatsApp|Slackbot|Discordbot|TelegramBot/i.test(s)) browser = 'Bot'

  return { device, browser, os }
}

export interface PassportDestination {
  url: string
  marketplace: string // amazon host we chose
  country: string     // resolved alpha-2
  usedFallback: boolean
}

/**
 * Build the destination Amazon URL for a click: the visitor's marketplace + the
 * creator's tag there. Falls back to the US store + US tag for any country the
 * creator has no tag in, so a click is never wasted.
 *   countryTags: { GB: "brand-21", DE: "brand-21", ... }  (US omitted — that's defaultTag)
 */
export function buildPassportDestination(
  asin: string,
  visitorCountry: string,
  countryTags: Record<string, string> | null | undefined,
  defaultTag: string | null,
): PassportDestination {
  const country = normalizeCountry(visitorCountry)
  const tags = countryTags || {}
  const localTag = (tags[country] || '').trim()
  const usTag = (defaultTag || '').trim()
  const mkt = AMAZON_MARKETPLACES[country]

  // Send them local ONLY if we have both a marketplace AND a tag for it — a local
  // store with no valid local tag wouldn't track, so fall back to US instead.
  if (mkt && localTag) {
    return {
      url: `https://${mkt.host}/dp/${asin}${localTag ? `?tag=${encodeURIComponent(localTag)}` : ''}`,
      marketplace: mkt.host, country, usedFallback: false,
    }
  }
  const usHost = AMAZON_MARKETPLACES.US.host
  return {
    url: `https://${usHost}/dp/${asin}${usTag ? `?tag=${encodeURIComponent(usTag)}` : ''}`,
    marketplace: usHost, country, usedFallback: true,
  }
}

/**
 * The one gate every content surface uses: return the creator's Passport Link URL
 * for a product WHEN Passport Links is ON, else null. A null means "not enabled" —
 * the caller then falls through to its existing behavior (Geniuslink, plain tag,
 * whatever is configured). So turning Passport Links off changes nothing anywhere.
 *
 * `source` is baked into the short code (its own clean link per surface), stored
 * on the row, and read back at redirect time for analytics + the Amazon ascsubtag
 * (per-video / per-surface attribution). `db` can be the user's session client or
 * the admin client.
 */
export async function passportLinkForUser(
  db: Db, userId: string, asin: string, opts?: { source?: string | null; title?: string | null },
): Promise<string | null> {
  const a = (asin || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(a)) return null
  try {
    const { data: ig } = await db.from('integrations').select('passport_links_enabled, tier').eq('user_id', userId).maybeSingle()
    if (!ig?.passport_links_enabled) return null
    // Studio + Pro only — even if the flag is set, a lower tier gets no link.
    if (!canUsePassport(normalizeTier(ig?.tier))) return null
    const { data: site } = await db.from('wordpress_sites').select('id').eq('user_id', userId).eq('is_default', true).maybeSingle()
    const siteId = (site?.id as string | undefined) ?? null
    // The source is baked into its own code, so the URL stays clean (no ?s= tail).
    const code = await getOrCreatePassportLink(db, userId, siteId, { asin: a, label: opts?.title ?? null, source: opts?.source ?? null })
    if (!code) return null
    return passportLinkUrl(code)
  } catch {
    return null
  }
}

const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789' // no look-alikes (0/o/1/l)
function randomCode(len = 7): string {
  let s = ''
  for (let i = 0; i < len; i++) {
    // crypto for uniform, collision-resistant codes.
    const n = Math.floor((globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ?? 0) / 0x100000000 * CODE_ALPHABET.length)
    s += CODE_ALPHABET[n] || CODE_ALPHABET[0]
  }
  return s
}

/** Sanitize a source token: URL-safe, short, or null for "no source". */
export function normalizeSource(source: string | null | undefined): string | null {
  const s = (source || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40)
  return s || null
}

export interface PassportTarget {
  asin?: string | null            // Amazon product → geo-routed
  destinationUrl?: string | null  // any other link → cloaked + tracked redirect
  label?: string | null           // display label (dashboard)
  source?: string | null          // baked into the code for per-surface attribution
}

/**
 * Get the existing Passport Link code for (user, site, target, source), or mint a
 * new one. `target` is either an Amazon ASIN (geo-routed) OR a destination URL
 * (any other link, forwarded as-is). Uses the admin client so it works from
 * server routes; the unique index keeps one stable link per (user, site, target,
 * source). Returns the code, or null on invalid input / failure.
 */
export async function getOrCreatePassportLink(
  admin: Db, userId: string, siteId: string | null, target: PassportTarget,
): Promise<string | null> {
  const asin = (target.asin || '').trim().toUpperCase()
  const hasAsin = /^[A-Z0-9]{10}$/.test(asin)
  const dest = (target.destinationUrl || '').trim()
  const hasDest = /^https?:\/\/\S+$/i.test(dest)
  // Exactly one target kind. Amazon ASIN wins if somehow both were passed.
  if (!hasAsin && !hasDest) return null
  const a: string | null = hasAsin ? asin : null
  const d: string | null = hasAsin ? null : dest.slice(0, 2048)
  const src = normalizeSource(target.source)

  // Find this creator's existing link for the same target + source (Supabase
  // needs .is for null columns and .eq otherwise).
  const findExisting = async (): Promise<string | null> => {
    let q = admin.from('passport_links').select('code').eq('user_id', userId)
    q = a === null ? q.is('asin', null) : q.eq('asin', a)
    q = d === null ? q.is('destination_url', null) : q.eq('destination_url', d)
    q = siteId === null ? q.is('site_id', null) : q.eq('site_id', siteId)
    q = src === null ? q.is('source', null) : q.eq('source', src)
    const { data } = await q.maybeSingle()
    return (data?.code as string | undefined) || null
  }

  try {
    const existing = await findExisting()
    if (existing) return existing

    // Mint a new code, retrying on the small chance of a code collision or a
    // concurrent create (the unique index catches the latter).
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode()
      const { data } = await admin.from('passport_links').insert({
        code, user_id: userId, site_id: siteId, asin: a, destination_url: d, source: src,
        label: (target.label || '').slice(0, 300) || null,
      }).select('code').maybeSingle()
      if (data?.code) return data.code as string
      const race = await findExisting()
      if (race) return race
    }
    return null
  } catch {
    return null
  }
}
