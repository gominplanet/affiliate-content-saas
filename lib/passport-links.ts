// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Passport Links — MVP-native geo-routing affiliate links (migration 282).
//
// One short link per product resolves, at click time, to the visitor's own
// country's Amazon store with the creator's tag for that country. This module
// holds the country → marketplace map, the destination builder, and the
// get-or-create for a link's short code. The redirect route (app/go/[code]) and
// the link-builders (blog / social) use it.

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

/** Full public URL for a link code. */
export function passportLinkUrl(code: string): string {
  return `${passportLinkBase()}/go/${code}`
}

/** Normalize a visitor country header to an alpha-2 key we map on. UK → GB. */
export function normalizeCountry(raw: string | null | undefined): string {
  const c = (raw || '').trim().toUpperCase()
  if (c === 'UK') return 'GB'
  return /^[A-Z]{2}$/.test(c) ? c : 'US'
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

/**
 * Get the existing Passport Link code for (user, site, asin), or mint a new one.
 * Uses the admin client so it works from server routes; the (user_id, site_id,
 * asin) unique key means one stable link per product per site. Returns the code,
 * or null on failure (the caller then just uses a plain Amazon link).
 */
export async function getOrCreatePassportLink(
  admin: Db, userId: string, siteId: string | null, asin: string, label?: string | null,
): Promise<string | null> {
  const a = (asin || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(a)) return null

  // Find this creator's existing link for the product (Supabase needs .is for a
  // null site_id and .eq otherwise).
  const findExisting = async (): Promise<string | null> => {
    let q = admin.from('passport_links').select('code').eq('user_id', userId).eq('asin', a)
    q = siteId === null ? q.is('site_id', null) : q.eq('site_id', siteId)
    const { data } = await q.maybeSingle()
    return (data?.code as string | undefined) || null
  }

  try {
    const existing = await findExisting()
    if (existing) return existing

    // Mint a new code, retrying on the small chance of a code collision or a
    // concurrent create (the (user, site, asin) unique key catches the latter).
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode()
      const { data } = await admin.from('passport_links').insert({
        code, user_id: userId, site_id: siteId, asin: a, label: (label || '').slice(0, 300) || null,
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
