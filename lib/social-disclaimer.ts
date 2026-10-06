// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One source of truth for the FTC affiliate disclosure on every public social
// post MVP publishes, whether it goes out from the scheduled cron or an
// immediate, bulk or quick post.
//
// Two layers:
//   ensureDisclaimer   the long-form Amazon Associates SENTENCE (LinkedIn,
//                      Telegram, Facebook, Threads), appended when missing.
//   discloseSocialPost the #ad #sponsored TAGS plus a destination LABEL before
//                      every link, applied at the last step before each
//                      platform's API (services/*), so no publish path can miss
//                      it. scripts/test-social-disclosure pins both.

import { SOCIAL_LIMITS } from '@/lib/social-cap'

export const AFFILIATE_DISCLAIMER_DEFAULT =
  '📌 As an Amazon Associate I earn from qualifying purchases. This post may contain affiliate links, and I may earn a small commission at no extra cost to you.'

/** Append the disclaimer to a caption ONLY if it isn't already disclosed — so
 *  every post carries it and a body that already discloses never doubles up.
 *  Per-alternative word boundaries: a leading \b fails before "#" (space→# is
 *  not a boundary), so "#adventure" is correctly NOT treated as "#ad".
 *
 *  THE TAGS ARE NOT PART OF THAT SKIP. A body that said "affiliate" anywhere
 *  used to return untouched, so it shipped with no #ad and no #sponsored. The
 *  sentence still skips; the tags are ensured either way. */
export function ensureDisclaimer(text: string, disclaimer = AFFILIATE_DISCLAIMER_DEFAULT): string {
  const t = (text || '').trim()
  if (/\baffiliate\b|#ad\b|\bamazon associate\b/i.test(t)) return ensureAdTags(t)
  return ensureAdTags(`${t}\n\n${disclaimer}`)
}

// ─── #ad #sponsored ──────────────────────────────────────────────────────────

/** WHERE THE TAGS GO, PER PLATFORM (the one place this is decided):
 *    X, Bluesky, Threads, Instagram, Pinterest, Telegram: the FIRST LINE.
 *      Short posts and captions cut at a line or two ("more"), so the start is
 *      the only place that is clear and conspicuous for the FTC.
 *    Facebook, LinkedIn: anywhere in the first AD_TAG_FOLD characters, where
 *      they already sit beside the link and the Associates line that lead a
 *      Facebook caption; long-form keeps the sentence at the end as before.
 *  A tag that is missing, or that sits outside its platform's place (a " #ad" a
 *  caller appended at the end), goes to the START of the post. */
export const AD_TAG_FOLD = 100

const tagRe = (name: 'ad' | 'sponsored') =>
  // Not after a word char, "#" or "\" (so "x#ad" and "##ad" are not it); the
  // optional backslash is Telegram MarkdownV2's escaped "\#ad". \b after the
  // word, so "#adventure" and "#ads" are not "#ad".
  new RegExp(`(?<![\\w#\\\\])\\\\?#${name}\\b`, 'gi')

function tidy(s: string): string {
  return s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+(?=\n)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Both #ad and #sponsored, each exactly once, both inside the fold. Each tag
 *  is checked on its own: "#ad" present does not satisfy "#sponsored". */
export function ensureAdTags(text: string, opts: { markdownV2?: boolean; firstLine?: boolean } = {}): string {
  const md = opts.markdownV2 === true
  const tag = (n: string) => (md ? `\\#${n}` : `#${n}`)
  let t = (text || '').trim()

  for (const name of ['ad', 'sponsored'] as const) {
    const all = [...t.matchAll(tagRe(name))]
    if (!all.length) continue
    // Out of its place, every copy goes (re-added at the start below). In it,
    // the first stays and any later copy goes, so it appears exactly once.
    const at = all[0].index ?? 0
    const nl = t.indexOf('\n')
    const keepFirst = at < AD_TAG_FOLD && (!opts.firstLine || nl < 0 || at < nl)
    let seen = 0
    t = t.replace(tagRe(name), (m) => (keepFirst && seen++ === 0 ? m : ''))
    t = tidy(t)
  }

  const ad = tagRe('ad').exec(t)
  const sp = tagRe('sponsored').exec(t)
  if (ad && sp) return t
  if (ad) {
    const at = (ad.index ?? 0) + ad[0].length
    return `${t.slice(0, at)} ${tag('sponsored')}${t.slice(at)}`
  }
  if (sp) {
    const at = sp.index ?? 0
    return `${t.slice(0, at)}${tag('ad')} ${t.slice(at)}`
  }
  return t ? `${tag('ad')} ${tag('sponsored')}\n\n${t}` : `${tag('ad')} ${tag('sponsored')}`
}

// ─── Where a link goes ───────────────────────────────────────────────────────

export type LinkDestination = 'amazon' | 'walmart' | 'ltk' | 'blog' | 'youtube' | 'tiktok' | 'fbgroup'

const DEST_NAME: Record<LinkDestination, string> = {
  amazon: 'Amazon', walmart: 'Walmart', ltk: 'LTK', blog: 'my blog', youtube: 'YouTube', tiktok: 'TikTok Shop',
  fbgroup: 'my Facebook group',
}
/** The label put before a link that has none. No dashes of any kind. */
export const DEST_LABEL: Record<LinkDestination, string> = {
  amazon: 'Check it out here on Amazon:',
  walmart: 'See it on Walmart:',
  ltk: 'Shop it on LTK:',
  blog: 'Read the full review on my blog:',
  youtube: 'Watch it on YouTube:',
  tiktok: 'Shop it on TikTok Shop:',
  fbgroup: 'Join the conversation in my Facebook group:',
}
export const UNKNOWN_LINK_LABEL = 'Check it out here:'
const DEST_SAID: Record<LinkDestination, RegExp> = {
  amazon: /amazon/i, walmart: /walmart/i, ltk: /\bltk\b/i, blog: /\bblog\b/i, youtube: /youtube/i, tiktok: /tiktok/i,
  fbgroup: /\bgroup\b/i,
}

// A cloaked link (Passport, geni.us) cannot say where it lands, so the code
// that MINTS one records it here (lib/passport-links, services/geniuslink,
// lib/channel-share-url). Keyed by URL or by blog host, both of which mean the
// same thing for every request, so a module-level map shared across requests
// is safe. Bounded, oldest out first.
const remembered = new Map<string, LinkDestination | string>()
const blogHosts = new Set<string>()
const MAX_REMEMBERED = 5000

function urlKey(url: string): string {
  return url.trim().replace(/#.*$/, '').replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/i, '').toLowerCase()
}
function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

/** Record where a short or cloaked link lands: a kind, or the URL it redirects
 *  to (classified when asked, so a geni.us wrapping the blog reads as blog). */
export function rememberLinkDestination(url: string | null | undefined, target: LinkDestination | string | null | undefined): void {
  if (!url || !target || !/^https?:\/\//i.test(url)) return
  if (remembered.size >= MAX_REMEMBERED) remembered.delete(remembered.keys().next().value as string)
  remembered.set(urlKey(url), target)
}

/** Record a creator's blog: every URL on its host is "my blog". */
export function rememberBlogUrl(url: string | null | undefined): void {
  const h = url ? hostOf(url) : ''
  if (h && !classifyHost(h)) blogHosts.add(h)
}

function classifyHost(h: string): LinkDestination | null {
  if (/(^|\.)amazon\.[a-z.]+$/.test(h) || /^(amzn\.(to|com|eu|asia)|a\.co)$/.test(h)) return 'amazon'
  if (/(^|\.)walmart\.com$/.test(h) || h === 'walmrt.us') return 'walmart'
  if (/(^|\.)shopltk\.com$/.test(h) || h === 'liketk.it' || /(^|\.)ltk\.app$/.test(h)) return 'ltk'
  if (/(^|\.)youtube\.com$/.test(h) || h === 'youtu.be') return 'youtube'
  if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok'
  return null
}

/** Where a link lands, as MVP knows it, or null when it truly does not know.
 *  Never guesses Amazon: a geni.us or Passport link MVP did not see minted is
 *  unknown, not Amazon. */
export function linkDestination(url: string, known?: Record<string, LinkDestination | string>, depth = 0): LinkDestination | null {
  if (depth > 3) return null
  const fromKnown = known && (known[url] ?? Object.entries(known).find(([k]) => urlKey(k) === urlKey(url))?.[1])
  const target = fromKnown || remembered.get(urlKey(url))
  if (target) {
    if (target in DEST_NAME) return target as LinkDestination
    if (/^https?:\/\//i.test(target)) return linkDestination(target, known, depth + 1)
  }
  const h = hostOf(url)
  if (!h) return null
  if (/(^|\.)facebook\.com$/.test(h) && /^https?:\/\/[^/]+\/groups\//i.test(url)) return 'fbgroup'
  return classifyHost(h) ?? (blogHosts.has(h) ? 'blog' : null)
}

const URL_RE = /https?:\/\/[^\s<>"'\])]+/g
// A label that already introduces the link but names no store: "Get it here 👉".
const SEPARATOR_END = /\s*(?::|👉|→|➡️?|⬇️?)\s*$/u

/** Precede every URL with a plain label naming where the click goes. A link
 *  whose line (or the line above, when the link starts its own line) already
 *  names the destination is left alone, so nothing is ever labelled twice.
 *  markdownV2: Telegram text, where links are [text](url) spans and the span
 *  text is the label. */
export function labelLinks(text: string, known?: Record<string, LinkDestination | string>, opts: { markdownV2?: boolean } = {}): string {
  let t = text || ''
  if (opts.markdownV2) {
    return t.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (whole, label: string, url: string) => {
      const dest = linkDestination(url.replace(/\\(.)/g, '$1'), known)
      if (!dest || DEST_SAID[dest].test(label)) return whole
      return `[${label.replace(SEPARATOR_END, '').trim()} on ${DEST_NAME[dest]}](${url})`
    })
  }
  const matches = [...t.matchAll(URL_RE)].reverse()
  for (const m of matches) {
    const idx = m.index ?? 0
    const url = m[0].replace(/[.,!?;:]+$/, '')
    const dest = linkDestination(url, known)
    const lineStart = t.lastIndexOf('\n', idx - 1) + 1
    const before = t.slice(lineStart, idx)
    let context = before
    if (!/[A-Za-z]/.test(before)) {
      // The link starts its own line: the line above is its label.
      const prev = t.slice(0, lineStart).replace(/\s+$/, '')
      context = `${prev.slice(prev.lastIndexOf('\n') + 1)} ${before}`
    }
    const sep = SEPARATOR_END.exec(before)
    const labelled = /[A-Za-z]/.test(before) && !!sep
    if (!dest) {
      if (labelled || /[A-Za-z].*(?::|👉|→)\s*$/u.test(context.trim()) || /check it out here/i.test(context)) continue
      t = `${t.slice(0, idx)}${UNKNOWN_LINK_LABEL} ${t.slice(idx)}`
      continue
    }
    if (DEST_SAID[dest].test(context)) continue
    if (labelled && sep) {
      // "Get it here 👉 url" becomes "Get it here on Amazon 👉 url".
      const at = lineStart + (sep.index ?? 0)
      t = `${t.slice(0, at)} on ${DEST_NAME[dest]}${t.slice(at)}`
      continue
    }
    t = `${t.slice(0, idx)}${DEST_LABEL[dest]} ${t.slice(idx)}`
  }
  return t
}

// ─── Per platform ────────────────────────────────────────────────────────────

export type DisclosurePlatform = 'twitter' | 'bluesky' | 'threads' | 'instagram' | 'pinterest' | 'facebook' | 'linkedin' | 'telegram'

/** Hard limits the post has to fit AFTER the tags and labels are in. The body
 *  is what gets cut, never a tag, a label or a link. Telegram is MarkdownV2 and
 *  is not cut here (its tags lead, so its own length slice cannot reach them). */
export const DISCLOSURE_LIMITS: Record<DisclosurePlatform, { maxChars: number | null; maxHashtags: number | null }> = {
  twitter: { maxChars: SOCIAL_LIMITS.twitter, maxHashtags: null },
  bluesky: { maxChars: SOCIAL_LIMITS.bluesky, maxHashtags: null },
  threads: { maxChars: SOCIAL_LIMITS.threads, maxHashtags: null },
  instagram: { maxChars: 2200, maxHashtags: 30 },
  pinterest: { maxChars: SOCIAL_LIMITS.pinterest, maxHashtags: null },
  facebook: { maxChars: null, maxHashtags: null },
  linkedin: { maxChars: SOCIAL_LIMITS.linkedin, maxHashtags: null },
  telegram: { maxChars: null, maxHashtags: null },
}

const TAGS_ON_FIRST_LINE = new Set<DisclosurePlatform>(['twitter', 'bluesky', 'threads', 'instagram', 'pinterest', 'telegram'])

const HASHTAG_RE = /(?<![\w#\\])#[\p{L}\p{N}_]+/gu
const isAdTag = (h: string) => /^#(ad|sponsored)$/i.test(h)

/** Drop topical hashtags from the end until the post (with #ad #sponsored)
 *  is within the platform's hashtag limit. The disclosure tags never go. */
function capHashtags(text: string, max: number): string {
  const tags = [...text.matchAll(HASHTAG_RE)]
  const topical = tags.filter((m) => !isAdTag(m[0]))
  let excess = topical.length + 2 - max
  if (excess <= 0) return text
  let t = text
  for (const m of topical.reverse()) {
    if (excess <= 0) break
    const i = m.index ?? 0
    t = `${t.slice(0, i)}${t.slice(i + m[0].length)}`
    excess--
  }
  return tidy(t)
}

/** Cut the prose so the whole post fits `max`, protecting every link with its
 *  label and every #ad / #sponsored. */
function fitBody(text: string, max: number): string {
  if (text.length <= max) return text
  const protect: Array<[number, number]> = []
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0
    const lineStart = text.lastIndexOf('\n', i - 1) + 1
    protect.push([Math.max(lineStart, i - 48), i + m[0].length])
  }
  for (const name of ['ad', 'sponsored'] as const) {
    for (const m of text.matchAll(tagRe(name))) protect.push([m.index ?? 0, (m.index ?? 0) + m[0].length])
  }
  protect.sort((a, b) => a[0] - b[0])
  const pieces: Array<{ s: string; locked: boolean }> = []
  let pos = 0
  for (const [a, b] of protect) {
    if (b <= pos) continue
    const start = Math.max(a, pos)
    if (start > pos) pieces.push({ s: text.slice(pos, start), locked: false })
    pieces.push({ s: text.slice(start, b), locked: true })
    pos = b
  }
  if (pos < text.length) pieces.push({ s: text.slice(pos), locked: false })

  for (let guard = 0; guard < 20; guard++) {
    const total = pieces.reduce((n, p) => n + p.s.length, 0)
    let over = total - max
    if (over <= 0) break
    const free = pieces.filter((p) => !p.locked && p.s.trim().length > 1)
    if (!free.length) break
    const p = free.reduce((a, b) => (b.s.trim().length > a.s.trim().length ? b : a))
    const lead = /^\s*/.exec(p.s)?.[0] ?? ''
    const trail = /\s*$/.exec(p.s)?.[0] ?? ''
    const core = p.s.trim()
    const keep = core.length - over - 1 // one for the ellipsis
    if (keep <= 3) { p.s = lead || trail ? ' ' : ''; over -= core.length; continue }
    let cut = core.slice(0, keep)
    const sp = cut.lastIndexOf(' ')
    if (sp > keep * 0.6) cut = cut.slice(0, sp)
    p.s = `${lead}${cut.replace(/[\s.,;:!?]+$/, '')}…${trail || ''}`
  }
  const out = tidy(pieces.map((p) => p.s).join(''))
  // Last resort, never expected: the links alone outgrow the limit. The tags
  // lead, so a slice from the end still keeps them.
  return out.length <= max ? out : out.slice(0, max)
}

/**
 * The one call every social publisher makes on the text it is about to send:
 * a label naming the destination before every link, #ad and #sponsored once
 * each inside the fold, and the whole thing back inside the platform's limits
 * by trimming the body. Idempotent: running it twice changes nothing.
 */
export function discloseSocialPost(
  text: string,
  platform: DisclosurePlatform,
  opts: { known?: Record<string, LinkDestination | string> } = {},
): string {
  const md = platform === 'telegram'
  let t = labelLinks(text || '', opts.known, { markdownV2: md })
  t = ensureAdTags(t, { markdownV2: md, firstLine: TAGS_ON_FIRST_LINE.has(platform) })
  const lim = DISCLOSURE_LIMITS[platform]
  if (lim.maxHashtags) t = capHashtags(t, lim.maxHashtags)
  if (lim.maxChars) t = fitBody(t, lim.maxChars)
  return t
}
