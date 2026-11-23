// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE BLOG LINK AND ONE DISCLOSURE PER SOCIAL POST.
//
// Support, 2026-11-23 (a Pro creator): "Social Media Posts include two links to
// the blog and two or three disclosures." Two causes, both in how a scheduled
// push is composed (app/api/cron/process-scheduled):
//
//   1. The text stored on the scheduled row often already holds the blog link
//      (the auto-pilot, Levanta and Edit schedule write `title\n\nURL`), and
//      the composer adds the blog link again. The only check, on X and Threads,
//      compared the exact address, and by publish time the address had changed:
//      a draft's ?p=123 became the real permalink, and with Geniuslink the
//      share link became a geni.us that wraps it. So the stored link is
//      removed first, by what it points at, and the composer adds one.
//
//   2. Each platform stacked its own sentence: the creator's line, then the
//      Amazon Associate line, then a two sentence default, then #ad #sponsored
//      from the service. Now one sentence (oneDisclosure) plus the tags.
//
// Pure, so it is tested (scripts/test-social-caption-clean.ts).

/** A link with the label in front of it ("🔗 Read the full post: URL"), so both go. */
const LABELLED_URL_RE = /(?:🔗\s*)?(?:(?:read|see|check out|watch)\b[^:\n]{0,40}:\s*)?(https?:\/\/[^\s<>()[\]"']+)/giu
/** Short links that wrap other sites: their host never means "the blog". */
const SHORTENERS = /(^|\.)(geni\.us|mvpl\.ink|bit\.ly|amzn\.to|tinyurl\.com|t\.co)$/i

const trimPunct = (u: string) => u.replace(/[.,;:!?]+$/, '')
function hostOf(u: string | null | undefined): string | null {
  if (!u) return null
  try { return new URL(u).host.toLowerCase().replace(/^www\./, '') } catch { return null }
}
/** An address compared by what it points at: no scheme, no www, no trailing slash. */
function norm(u: string): string {
  return trimPunct(u).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
}

/**
 * The caption with every link to this post's blog removed: any address on the
 * blog's own site, and any address the post is known by (its stored link, its
 * permalink, its geni.us share links). A line left with nothing but a label
 * ("🔗 Read the full post:") goes too. Other links (Amazon, a store, the
 * video) stay. Pure.
 */
export function stripBlogLinks(text: string, known: { urls: Array<string | null | undefined>; siteUrls: Array<string | null | undefined> }): string {
  const exact = new Set(known.urls.filter((u): u is string => !!u && /^https?:\/\//i.test(u)).map(norm))
  const hosts = new Set(known.siteUrls.map(hostOf).filter((h): h is string => !!h && !SHORTENERS.test(h)))
  if (!exact.size && !hosts.size) return text || ''
  const isBlog = (raw: string) => {
    const u = trimPunct(raw)
    if (exact.has(norm(u))) return true
    const h = hostOf(u)
    return !!h && hosts.has(h)
  }
  const lines = (text || '').split('\n').map((line) => {
    if (!/https?:\/\//i.test(line)) return line
    const out = line.replace(LABELLED_URL_RE, (m, u: string) => (isBlog(u) ? '' : m)).replace(/[ \t]{2,}/g, ' ').trimEnd()
    if (out === line) return line
    // A line left with no words, or only a short label that pointed at the
    // link ("🔗 Read the full post:"), goes with it.
    const words = out.replace(/[^\p{L}\p{N}\s]/gu, '').trim()
    if (!words) return null
    if (/[:👉→]\s*$/u.test(out.trim()) && words.length <= 40) return null
    return out
  })
  return lines.filter((l): l is string => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export const AMAZON_ASSOCIATE_LINE = 'As an Amazon Associate I earn from qualifying purchases.'

/**
 * The ONE disclosure sentence a post carries (the service layer adds #ad
 * #sponsored on top). The creator's own line when they wrote one; when the post
 * itself carries an Amazon link and their line does not say it is an Amazon
 * Associate link, Amazon's own sentence instead (its policy asks for it beside
 * the link). No line of their own: Amazon's sentence. Pure.
 */
export function oneDisclosure(brandLine: string | null | undefined, carriesAmazonLink: boolean): string {
  const b = (brandLine || '').trim()
  if (b && (!carriesAmazonLink || /amazon associate/i.test(b))) return b
  return AMAZON_ASSOCIATE_LINE
}

/** Whether a caption already discloses (the same test ensureDisclaimer uses). */
export function alreadyDiscloses(text: string): boolean {
  return /\baffiliate\b|#ad\b|\bamazon associate\b/i.test(text || '')
}
