// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Where a Pinterest pin is allowed to point.
//
// A Deal Radar push came back with "Sorry! We blocked this link because it may
// lead to spam." on Pinterest alone, while X, Facebook, Threads and the
// Instagram Story all went out fine. The pin was pointing at an mvpl.ink
// Passport link.
//
// MVP already knew this. app/api/pinterest/video-pin/route.ts carries the rule
// in code: "Destination link (NEVER an affiliate redirect — Pinterest + Amazon
// ToS; every option here is the creator's own page)". Its four options are all
// pages the creator owns. The Amazon pin path was written separately and does
// the opposite, so one half of the product knew the rule and the other half
// broke it, and only the second half shipped to Pinterest.
//
// This is not something domain verification fixes. Pinterest blocks affiliate
// redirect and cloaking domains as a class, so mvpl.ink, geni.us and bit.ly are
// all the same answer to them, and a link that works today gets reclassified
// the moment somebody else's links are flagged.
//
// WHAT A DEAL RADAR PUSH CAN POINT AT INSTEAD. Not a blog post: a deal push
// never makes one. The creator's Link in Bio shop page, which already exists at
// /shop/<handle>, and which every Amazon social push already drops the product
// onto as a tile with the affiliate link on it. That is why the same modal
// tells the creator to point their bio at it. It is a real page with real
// content that they own, and the affiliate link sits one click deeper, which is
// the arrangement both Pinterest and Amazon expect.
//
// This module is the pure half: what the destination should be, and what to say
// when there is not one yet.

// 'showcase' is the creator's own TikTok Shop, used when a post opts out of
// the affiliate link entirely. It is the one destination that needs no detour:
// the whole reason a pin normally goes via the creator's own page is that
// Pinterest rejects affiliate redirect and cloaking domains, and tiktok.com is
// neither.
export type PinDestinationKind = 'shop' | 'blog_post' | 'homepage' | 'none' | 'showcase' | 'product_page' | 'amazon'

export interface PinDestination {
  /** The URL to put on the pin, or null when we must not pin at all. */
  url: string | null
  kind: PinDestinationKind
  /** Shown to the creator. Non-null whenever the answer is worth explaining. */
  note: string | null
  /** True when the ONLY thing standing between this creator and working
   *  Pinterest pins is a Link in Bio page they have not made yet.
   *
   *  Kept as a flag rather than left for the UI to sniff out of the message,
   *  so the caller can offer the fix as a button instead of printing a
   *  sentence and leaving them to find the page. */
  needsLinkPage?: boolean
  /** Where to send them to fix it. */
  setupPath?: string
}

export interface PinDestinationInput {
  /** The creator's Link in Bio handle, when they have a published page. */
  shopHandle?: string | null
  /** A published post about this product, when one exists. */
  blogPostUrl?: string | null
  /** Their site's homepage, the last resort that is still their own page. */
  homepageUrl?: string | null
  /** Where /shop/<handle> lives. */
  appOrigin: string
}

/**
 * Pick the pin's destination.
 *
 * Order is by how well the page answers the pin: a post about this exact
 * product beats a shop grid containing it, which beats a homepage that merely
 * belongs to the same person. The affiliate link is never a candidate.
 *
 * Returns url: null rather than falling back to the affiliate link when there
 * is nothing to point at. Publishing a pin we know Pinterest will reject, and
 * then showing the creator Pinterest's own spam wording, is how our missing
 * configuration got read as their account being in trouble.
 */
export function pinDestination(input: PinDestinationInput): PinDestination {
  const blog = clean(input.blogPostUrl)
  if (blog) return { url: blog, kind: 'blog_post', note: null }

  const handle = String(input.shopHandle ?? '').trim().replace(/^@/, '')
  if (handle) {
    const origin = String(input.appOrigin || '').replace(/\/+$/, '')
    return {
      url: `${origin}/shop/${encodeURIComponent(handle)}`,
      kind: 'shop',
      note: 'Pinterest does not allow affiliate redirect links, so this pin points at your Link in Bio shop page. The product is on that page with your affiliate link on it.',
    }
  }

  const home = clean(input.homepageUrl)
  if (home) {
    return {
      url: home,
      kind: 'homepage',
      note: 'Pinterest does not allow affiliate redirect links, so this pin points at your site homepage. Set up your Link in Bio page and pins will land on the product itself.',
      needsLinkPage: true,
      setupPath: LINK_IN_BIO_PATH,
    }
  }

  return {
    url: null,
    kind: 'none',
    note: 'Pinterest does not allow affiliate redirect links, so a pin has to point at a page of yours. Set up your Link in Bio page and this product will be on it, ready to pin.',
    needsLinkPage: true,
    setupPath: LINK_IN_BIO_PATH,
  }
}

/** Where a creator makes the page this feature needs. */
export const LINK_IN_BIO_PATH = '/link-in-bio'

/** Is this URL one Pinterest will treat as a cloaked affiliate redirect?
 *
 *  Used as a last guard right before publishing: whatever route assembled the
 *  pin, if the link is one of these it must not go out, because the failure is
 *  not a rejected request but a creator being told their content looks like
 *  spam. */
export function isBlockedPinLink(url: string | null | undefined): boolean {
  const s = String(url ?? '').trim().toLowerCase()
  if (!s) return false
  return /(^|\/\/|\.)(mvpl\.ink|geni\.us|gnz\.[a-z]+|bit\.ly|amzn\.to|a\.co|tinyurl\.com|rebrand\.ly|ow\.ly|buff\.ly)(\/|$)/.test(s)
    || /\/go\/[a-z0-9]+/i.test(s)
}

function clean(u: string | null | undefined): string | null {
  const s = String(u ?? '').trim()
  return /^https?:\/\/\S+$/i.test(s) ? s : null
}

// ── One setting for where product pins go (migration 382) ──────────────────
//
// Pinterest refuses short and redirect links, so every choice here is a real
// page: the creator's blog post about the product, the product's own page on
// their Link in Bio, or the full amazon.com product link with their tag. The
// creator picks the order; whatever is not available falls through to the
// next, and the pin says where it actually went and why.

export type PinProductDest = 'auto' | 'blog_post' | 'link_in_bio' | 'amazon'
export const PIN_PRODUCT_DESTS: PinProductDest[] = ['auto', 'blog_post', 'link_in_bio', 'amazon']
export function readPinProductDest(raw: unknown): PinProductDest {
  return (PIN_PRODUCT_DESTS as string[]).includes(String(raw)) ? (raw as PinProductDest) : 'auto'
}

export type ChosenPinKind = 'blog_post' | 'product_page' | 'amazon' | 'homepage' | 'none'
export interface ChosenPin {
  url: string | null
  kind: ChosenPinKind
  /** Why it is not the one the creator picked, when it is not. */
  note: string | null
}

const LABEL: Record<Exclude<ChosenPinKind, 'none'>, string> = {
  blog_post: 'your blog post about it', product_page: 'its page on your Link in Bio', amazon: 'Amazon directly', homepage: 'your blog homepage',
}

/**
 * Pick the pin's link. The creator's choice first, then blog post, Link in Bio
 * product page, Amazon, homepage, in that order. Never a redirect: anything
 * Pinterest would block is treated as not available. Pure.
 */
export function choosePinDestination(input: {
  pref: PinProductDest
  blogPostUrl?: string | null
  productPageUrl?: string | null
  amazonUrl?: string | null
  homepageUrl?: string | null
}): ChosenPin {
  const ok = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) && !isBlockedPinLink(u) ? u : null)
  const have: Record<Exclude<ChosenPinKind, 'none'>, string | null> = {
    blog_post: ok(input.blogPostUrl), product_page: ok(input.productPageUrl), amazon: ok(input.amazonUrl), homepage: ok(input.homepageUrl),
  }
  const wanted: Exclude<ChosenPinKind, 'none'> | null =
    input.pref === 'blog_post' ? 'blog_post' : input.pref === 'link_in_bio' ? 'product_page' : input.pref === 'amazon' ? 'amazon' : null
  if (wanted && have[wanted]) return { url: have[wanted], kind: wanted, note: null }
  const order: Array<Exclude<ChosenPinKind, 'none'>> = ['blog_post', 'product_page', 'amazon', 'homepage']
  for (const k of order) {
    if (!have[k]) continue
    const why = wanted
      ? wanted === 'blog_post' ? 'There is no blog post about this product yet'
        : wanted === 'product_page' ? 'Your Link in Bio page is not published, or the product could not be added to it'
          : 'There is no Amazon tag to put on the link'
      : null
    return { url: have[k], kind: k, note: why ? `${why}, so this pin goes to ${LABEL[k]}.` : null }
  }
  return { url: null, kind: 'none', note: 'There is no page to send this pin to: no blog post, no published Link in Bio page, and no Amazon tag. Set up your Link in Bio page or add your Amazon tag.' }
}

/** The full amazon.com product link a pin may carry. Never shortened. Pure. */
export function amazonPinUrl(asin: string | null | undefined, tag: string | null | undefined): string | null {
  const a = String(asin || '').toUpperCase()
  const t = String(tag || '').trim()
  if (!/^[A-Z0-9]{10}$/.test(a) || !/^[A-Za-z0-9-]{3,40}$/.test(t)) return null
  return `https://www.amazon.com/dp/${a}?tag=${encodeURIComponent(t)}`
}

/** The product's own page on Link in Bio. Pure. */
export function productPageUrl(appOrigin: string, handle: string, asin: string): string {
  return `${String(appOrigin || '').replace(/\/+$/, '')}/shop/${encodeURIComponent(handle)}/${encodeURIComponent(asin.toUpperCase())}`
}

/** The claim code out of whatever Pinterest gave: the bare code or the whole meta tag. Pure. */
export function pinterestClaimCode(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const m = /content\s*=\s*["']([a-f0-9]{16,64})["']/i.exec(s) || /^([a-f0-9]{16,64})$/i.exec(s)
  return m ? m[1].toLowerCase() : null
}

/**
 * The site's custom meta tags with the Pinterest claim tag set to this code
 * (or removed, for null). Any earlier p:domain_verify tag is replaced, never
 * duplicated, and every other tag is kept as it is. Pure.
 */
export function withClaimTag(tags: unknown, code: string | null): string[] {
  const kept = (Array.isArray(tags) ? tags : []).map(String).filter((t) => t.trim() && !/p:domain_verify/i.test(t))
  return code ? [...kept, `<meta name="p:domain_verify" content="${code}"/>`] : kept
}

/** The claim code already on the site, if any. Pure. */
export function claimCodeIn(tags: unknown): string | null {
  for (const t of Array.isArray(tags) ? tags : []) if (/p:domain_verify/i.test(String(t))) return pinterestClaimCode(t)
  return null
}
