// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Brand recap — assemble the "we covered your product, here's where it's live"
// message a creator sends a brand after publishing. Pulls every link MVP
// already stored for a post (blog, YouTube, the product/affiliate link, and
// each social permalink it can build) and fills the creator's customizable
// template.
//
// Isomorphic on purpose (no server-only): the API builds the links + initial
// message, and the modal re-fills the template live as the user edits the
// brand name. Keep it dependency-free.
//
// Design notes:
//  - PLATFORM-NEUTRAL. Not every product is on Amazon (services, DTC, Walmart),
//    so the default template never hardcodes "Amazon" — the product link is
//    just one entry in the list, labeled "Amazon" only when the URL actually
//    is one, else "Product page".
//  - Some platforms only store an opaque post id (Threads, Instagram, Telegram)
//    from which no reliable PUBLIC url can be built without the account handle
//    / a stored permalink — those are omitted rather than emit a broken link.
//    Capturing real permalinks at post-time is a later upgrade.

export type RecapPlatform =
  | 'product' | 'amazon_video' | 'blog' | 'youtube' | 'tiktok' | 'pinterest'
  | 'x' | 'facebook' | 'linkedin' | 'threads' | 'instagram' | 'telegram'

export interface RecapLink {
  platform: RecapPlatform
  /** Human label used both in the modal checklist and the message list. */
  label: string
  url: string
}

export interface BrandRecapSettings {
  /** Editable body with {{brand}} {{product}} {{links}} {{name}} {{site}}. */
  template: string
  tone: 'warm' | 'professional' | 'casual'
  /** Sign-off name + site — default from the brand profile, overridable. */
  senderName: string
  siteUrl: string
}

/** Platform-neutral default — no "Amazon" baked in (works for any retailer
 *  or a non-retail service). The product link, if any, rides in {{links}}. */
export const DEFAULT_RECAP_TEMPLATE = `Hi {{brand}} team,

Quick note to share that our review of {{product}} is now live — here's where you can see it:

{{links}}

We genuinely enjoyed featuring it, and we're always on the lookout for new products and brands to work with. If there's anything you'd like us to cover next, just say the word.

Thanks so much — have a great day!
{{name}}
{{site}}`

const AMAZON_RE = /(?:amazon\.[a-z.]+|amzn\.to|a\.co|geni\.us)/i

/** "Amazon" when the product URL is an Amazon/affiliate link, else the neutral
 *  "Product page" — so the message reads right for non-Amazon products too. */
export function productLinkLabel(url: string): string {
  return AMAZON_RE.test(url) ? 'Amazon' : 'Product page'
}

export function isAmazonUrl(url: string | null | undefined): boolean {
  return !!url && AMAZON_RE.test(url)
}

interface PostLike {
  wordpress_url?: string | null
  tiktok_share_url?: string | null
  pinterest_pin_id?: string | null
  twitter_post_id?: string | null
  facebook_post_id?: string | null
  linkedin_post_id?: string | null
}

/** LinkedIn stores the share/activity id in a few shapes; the public update
 *  URL wants an activity urn. Best-effort normalize; user can drop it if off. */
function linkedinUpdateUrl(id: string): string {
  const raw = id.trim()
  if (raw.startsWith('urn:li:')) return `https://www.linkedin.com/feed/update/${raw}`
  if (/^\d+$/.test(raw)) return `https://www.linkedin.com/feed/update/urn:li:activity:${raw}`
  return `https://www.linkedin.com/feed/update/${raw}`
}

/** Canonical public URL for a post on each platform, derived from the id the
 *  platform's API returned. SINGLE SOURCE OF TRUTH — both buildRecapLinks (for
 *  posts published before permalink-capture existed) and the post routes (which
 *  store the result via recordSocialPermalink at publish time) use these, so a
 *  stored permalink always matches what the builder would construct. */
export const socialPermalink = {
  /** x.com/i/web/status/<id> reliably redirects to the real tweet without
   *  needing the @handle. */
  x: (id: string) => `https://x.com/i/web/status/${id}`,
  /** facebook.com/<pageId>_<postId> resolves to the post. */
  facebook: (id: string) => `https://www.facebook.com/${id}`,
  linkedin: (id: string) => linkedinUpdateUrl(id),
  pinterest: (id: string) => `https://www.pinterest.com/pin/${id}/`,
}

/**
 * Build the ordered list of links that actually exist for a post. Product
 * first (the brand cares most), then the full review, then video + socials.
 *
 * `permalinks` (blog_posts.social_permalinks) holds the REAL public URL each
 * platform handed back at post-time. When present for a platform it WINS over
 * the URL reconstructed from an opaque id — and it's the only way to surface
 * platforms with no id-derivable public URL (Threads, Instagram, Telegram),
 * which are otherwise omitted rather than linked wrongly.
 */
export function buildRecapLinks(opts: {
  post: PostLike
  youtubeUrl?: string | null
  productUrl?: string | null
  permalinks?: Record<string, string> | null
}): RecapLink[] {
  const { post, youtubeUrl, productUrl } = opts
  const pl = opts.permalinks || {}
  const out: RecapLink[] = []
  // Product = the brand's OWN listing. Neutral label (not "Amazon") so the
  // message never implies the creator's content lives on Amazon — and the
  // modal defaults this OFF (a brand doesn't need their own link sent back).
  if (productUrl) out.push({ platform: 'product', label: 'Product page', url: productUrl })
  if (post.wordpress_url) out.push({ platform: 'blog', label: 'Full written review', url: post.wordpress_url })
  if (youtubeUrl) out.push({ platform: 'youtube', label: 'YouTube', url: youtubeUrl })
  // Socials: prefer the stored real permalink; else fall back to the
  // id-derived URL for platforms where that reliably resolves.
  const tiktok = pl.tiktok || post.tiktok_share_url
  if (tiktok) out.push({ platform: 'tiktok', label: 'TikTok', url: tiktok })
  const pinterest = pl.pinterest || (post.pinterest_pin_id ? socialPermalink.pinterest(post.pinterest_pin_id) : null)
  if (pinterest) out.push({ platform: 'pinterest', label: 'Pinterest', url: pinterest })
  const x = pl.x || (post.twitter_post_id ? socialPermalink.x(post.twitter_post_id) : null)
  if (x) out.push({ platform: 'x', label: 'X', url: x })
  const facebook = pl.facebook || (post.facebook_post_id ? socialPermalink.facebook(post.facebook_post_id) : null)
  if (facebook) out.push({ platform: 'facebook', label: 'Facebook', url: facebook })
  const linkedin = pl.linkedin || (post.linkedin_post_id ? socialPermalink.linkedin(post.linkedin_post_id) : null)
  if (linkedin) out.push({ platform: 'linkedin', label: 'LinkedIn', url: linkedin })
  // Platforms with NO reliable id-derived public URL — included only when we
  // captured a real permalink at post-time.
  if (pl.threads) out.push({ platform: 'threads', label: 'Threads', url: pl.threads })
  if (pl.instagram) out.push({ platform: 'instagram', label: 'Instagram', url: pl.instagram })
  if (pl.telegram) out.push({ platform: 'telegram', label: 'Telegram', url: pl.telegram })
  return out
}

/** Trim a giant Amazon listing title down to "Brand + product type" for the
 *  message — e.g. "AEOCKY 4200 ft² Whole-House Air Purifier with 515 sq ft…"
 *  → "AEOCKY 4200 ft² Whole-House Air Purifier". Cuts at the first comma/pipe
 *  or a " with "/" for " feature clause, capped to a readable length. */
export function cleanProductName(amazonTitle?: string | null): string {
  const t = (amazonTitle || '').trim()
  if (!t) return ''
  let cut = t.split(/\s*[,|]\s*/)[0]
  cut = cut.split(/\s+(?:with|for|featuring)\s+/i)[0]
  return cut.slice(0, 72).trim()
}

/** First-word best guess at the brand from a product title (Amazon titles
 *  lead with the brand). Always shown as an EDITABLE field — never sent blind. */
export function guessBrandName(productTitle?: string | null): string {
  const t = (productTitle || '').trim()
  if (!t) return ''
  const head = t.split(/[,|]|\s[-–]\s/)[0].trim()
  const first = head.split(/\s+/)[0] || ''
  // A 1-word brand ("SHEHDS", "Kieba") is the common case; if the first token
  // is a generic filler, fall back to the first two words.
  return first.length >= 2 ? first : head.split(/\s+/).slice(0, 2).join(' ')
}

/** Fill the template. `replaceAll` avoided for TS-target safety. */
export function fillRecapMessage(template: string, vars: {
  brand: string
  product: string
  links: RecapLink[]
  name: string
  site: string
}): string {
  const linksBlock = vars.links.map(l => `• ${l.label}: ${l.url}`).join('\n')
  const sub = (s: string, token: string, val: string) => s.split(token).join(val)
  let out = template
  out = sub(out, '{{brand}}', vars.brand || 'there')
  out = sub(out, '{{product}}', vars.product || 'your product')
  out = sub(out, '{{links}}', linksBlock)
  out = sub(out, '{{name}}', vars.name || '')
  out = sub(out, '{{site}}', vars.site || '')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}
