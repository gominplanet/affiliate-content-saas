// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which Amazon storefronts MVP delivers to. Data only, no I/O, no dependencies.
//
// This lived in lib/global-sync until a client component needed to ask one
// question of it: is this market English? global-sync also holds the
// translation call, so it imports the Anthropic client, which imports node's
// fs, and the build broke with "Module not found: Can't resolve 'fs'" the
// moment a browser bundle touched it. A market list is a fact about the
// product; a translation call is a server capability. They had no business
// being reachable through the same import.
//
// So the table lives here and global-sync re-exports it, which keeps every
// existing server import working unchanged while the client pays for nothing
// but the list itself.

/** A supported Amazon marketplace. `needsTranslation` false = English market
 *  (US/CA/UK/AU), so we skip the translation call and reuse the master copy. */
export interface Market {
  domain: string   // amazon.co.uk
  code: string     // UK
  country: string  // United Kingdom
  lang: string     // de-DE (BCP-47)
  langName: string // German
  needsTranslation: boolean
}

// The supported set. English markets first (no translation, no dub), then the
// five non-English marketplaces we localize + dub for. This is the deliberate
// service scope — extend only as we verify each new Creator Hub flow.
export const MARKETS: Market[] = [
  { domain: 'amazon.com',    code: 'US', country: 'United States',  lang: 'en-US', langName: 'English', needsTranslation: false },
  { domain: 'amazon.ca',     code: 'CA', country: 'Canada',         lang: 'en-CA', langName: 'English', needsTranslation: false },
  { domain: 'amazon.com.au', code: 'AU', country: 'Australia',      lang: 'en-AU', langName: 'English', needsTranslation: false },
  { domain: 'amazon.co.uk',  code: 'UK', country: 'United Kingdom', lang: 'en-GB', langName: 'English', needsTranslation: false },
  { domain: 'amazon.fr',     code: 'FR', country: 'France',         lang: 'fr-FR', langName: 'French',  needsTranslation: true },
  { domain: 'amazon.de',     code: 'DE', country: 'Germany',        lang: 'de-DE', langName: 'German',  needsTranslation: true },
  { domain: 'amazon.es',     code: 'ES', country: 'Spain',          lang: 'es-ES', langName: 'Spanish',  needsTranslation: true },
  { domain: 'amazon.it',     code: 'IT', country: 'Italy',          lang: 'it-IT', langName: 'Italian',  needsTranslation: true },
  { domain: 'amazon.co.jp',  code: 'JP', country: 'Japan',          lang: 'ja-JP', langName: 'Japanese', needsTranslation: true },
]

export function marketByDomain(domain: string): Market | undefined {
  return MARKETS.find(m => m.domain === domain)
}

/** The English-speaking storefronts: US, Canada, UK, Australia.
 *
 *  Video Launchpad ships THIS set only. The master video's audio is already
 *  English, so every one of these markets takes the file as it is: no
 *  translation, no dub, no credits, no extra minutes before the first upload
 *  starts. That is the whole reason for the cut. Launchpad is the one-click
 *  path, and hanging a dub off it meant the fast lane waited on the slow one.
 *
 *  The non-English markets and the dubbing that serves them are NOT removed.
 *  They stay on the standalone Storefront Sync page, where a creator has come
 *  specifically to localize and a couple of minutes per market is the expected
 *  price. Launchpad simply stops offering them for now.
 *
 *  Derived from MARKETS rather than typed out again, so adding a market with
 *  needsTranslation:false puts it here automatically and nothing can disagree
 *  about which storefronts speak English. */
export const ENGLISH_MARKETS: Market[] = MARKETS.filter(m => !m.needsTranslation)

/** Just the domains, for the callers that pass an allow-list. */
export const ENGLISH_MARKET_DOMAINS: string[] = ENGLISH_MARKETS.map(m => m.domain)

export function isEnglishMarket(domain: string): boolean {
  return ENGLISH_MARKET_DOMAINS.includes(domain)
}
