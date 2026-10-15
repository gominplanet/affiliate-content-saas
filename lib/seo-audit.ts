// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AUDIT MY SITE (Seb, 2026-10-15: "one button that is able to completely audit
// someone's site and then give them actionable things to do"). The SEO page
// had grown into a wall of cards nobody read. What actually helped Alejandro
// was one audit: what MVP knows, what Google says about every post, a live look
// at the site, and then a short list in order, each with the button that does
// it or the exact clicks.
//
// This is the judgement half: facts in, an ordered list out. The route
// (app/api/seo/audit) gathers the facts. Pure, so scripts/test-seo-audit.ts
// checks the ranking and the wording against every shape of blog.
//
// Rules it holds to:
//   A check that could not run says so under "What MVP could not check". It
//   never reads as a pass.
//   Nothing is listed unless it is worth doing. A healthy site gets one line.
//   Never claim MVP does something it cannot. Where the work is theirs, the
//   steps are the exact clicks.

export type IndexState = 'indexed' | 'not_indexed' | 'unknown' | null

export interface AuditPost {
  id: string
  title: string
  url: string | null
  publishedAt: string | null
  indexed: IndexState
  /** Google's own words for the post (Search Console coverage). */
  coverage: string | null
  clicks: number
  impressions: number
  droppedAt: string | null
}

/** One post MVP opened on the live site. */
export interface LiveCheck {
  postId: string
  url: string
  /** HTTP status, null when the page did not answer at all. */
  status: number | null
  /** Time until the site started answering, in ms. */
  ms: number | null
  /** Where the address ended up after any redirect. */
  finalUrl: string | null
  noindex: boolean
  /** For a page that is gone: what WordPress says happened to it, when MVP could ask. */
  wpStatus?: 'trash' | 'draft' | 'private' | 'pending' | 'future' | 'deleted' | 'publish' | null
}

export type GscState = 'ok' | 'none' | 'expired' | 'no-property'

export interface AuditFacts {
  now: number
  siteUrl: string | null
  gsc: GscState
  property: string | null
  posts: AuditPost[]
  /** Every public post date on the site (MVP's and older), when WordPress shared them. */
  wpDates: string[] | null
  home: { status: number | null; ms: number | null; title: string | null; noindex: boolean } | null
  robots: { found: boolean; blocksAll: boolean } | null
  sitemap: { found: boolean; urls: number; address: string | null }
  /** Sitemaps Search Console holds. null = could not ask. */
  gscSitemaps: { path: string; lastDownloaded: string | null; errors: number }[] | null
  live: LiveCheck[]
  /** The host refused several of MVP's checks (403 or 429). */
  blocked: boolean
  /** The host showed MVP a robot check (a captcha page) instead of the site. */
  challenged?: boolean
  nudges: { last30: number; roomToday: number; perDay: number; scopeOk: boolean | null }
}

export type AuditAction =
  | 'connect-gsc' | 'get-found' | 'refresh-urls' | 'request-index' | 'link-up' | 'open' | 'none'

export interface AuditPostRef { id: string; title: string; url: string | null; note?: string }

export interface AuditStep {
  id: string
  title: string
  why: string
  /** The exact steps, in order. */
  doThis: string[]
  action: AuditAction
  actionLabel?: string
  /** For action 'open': where the button goes. */
  href?: string
  who: 'mvp' | 'you'
  tone: 'blocked' | 'act'
  weight: number
  posts?: AuditPostRef[]
  /** For 'request-index': the addresses to ask Google for. */
  indexUrls?: string[]
  /** For 'link-up': which post links to which. */
  pairs?: { fromId: string; fromTitle: string; toId: string; toTitle: string }[]
}

export interface AuditNumbers {
  posts: number
  indexed: number
  notIndexed: number
  neverChecked: number
  unknownToGoogle: number
  discovered: number
  crawledNot: number
  clicks: number
  impressions: number
  checkedLive: number
  medianSeconds: number | null
}

export interface Audit {
  at: string
  siteUrl: string | null
  headline: string
  steps: AuditStep[]
  right: string[]
  unchecked: string[]
  numbers: AuditNumbers
}

const DAY = 86_400_000
const n = (x: number) => x.toLocaleString('en-US')
const posts = (x: number) => `post${x === 1 ? '' : 's'}`
const secs = (ms: number) => `${Math.round(ms / 100) / 10} seconds`

/** Google's coverage words, sorted into what they mean for the creator. Pure. */
export type CoverageKind = 'indexed' | 'unknown' | 'discovered' | 'crawled' | 'redirect' | 'gone' | 'noindex' | 'robots' | 'duplicate' | 'other' | 'none'
export function coverageKind(c: string | null | undefined): CoverageKind {
  const t = (c || '').toLowerCase()
  if (!t) return 'none'
  if (/unknown to google/.test(t)) return 'unknown'
  if (/discovered/.test(t)) return 'discovered'
  if (/crawled/.test(t)) return 'crawled'
  if (/redirect/.test(t)) return 'redirect'
  if (/not found|404|soft 404|server error|5xx/.test(t)) return 'gone'
  if (/noindex/.test(t)) return 'noindex'
  if (/robots\.txt/.test(t)) return 'robots'
  if (/duplicate|canonical/.test(t)) return 'duplicate'
  if (/indexed/.test(t) && !/not indexed/.test(t)) return 'indexed'
  return 'other'
}

/** The address without its scheme, host, query or trailing slash, lowercased. */
export function pathOf(u: string | null | undefined): string {
  if (!u) return ''
  try { return new URL(u).pathname.replace(/\/+$/, '').toLowerCase() } catch { return u.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase() }
}

/** A homepage title that says the same name twice ("Alex Media - Alex Media"),
 *  or WordPress's default tagline. Returns what is wrong, or null. Pure. */
export function homeTitleProblem(title: string | null | undefined): string | null {
  const t = (title || '').replace(/\s+/g, ' ').trim()
  if (!t) return 'Your homepage has no title, which is the line Google shows above your site in results.'
  if (/just another wordpress site|my wordpress blog/i.test(t)) return `Your homepage title is WordPress's default ("${t}").`
  const parts = t.split(/\s[-|–—•:]\s/).map((p) => p.trim().toLowerCase()).filter(Boolean)
  if (parts.length >= 2 && new Set(parts).size < parts.length) return `Your homepage title says the same thing twice ("${t}").`
  return null
}

const STOP = new Set('the a an and or for with of to in on by your my best review reviews is it this that vs how what why our from at as new top'.split(' '))
const wordsOf = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))

/** Which post Google already shows should link to each post it has not read:
 *  the closest topic by title words, then the most seen. Each source is used
 *  once where it can be. Pure. */
export function linkPairs(all: AuditPost[], targets: AuditPost[], max = 5): NonNullable<AuditStep['pairs']> {
  const sources = all.filter((p) => p.indexed === 'indexed' && p.url)
  if (!sources.length) return []
  const used = new Set<string>()
  const out: NonNullable<AuditStep['pairs']> = []
  for (const t of targets.slice(0, max)) {
    const tw = wordsOf(t.title)
    let best: AuditPost | null = null, bestScore = -1
    for (const s of sources) {
      if (s.id === t.id) continue
      let overlap = 0
      for (const w of wordsOf(s.title)) if (tw.has(w)) overlap++
      const score = overlap * 1000 + Math.min(999, s.impressions) - (used.has(s.id) ? 500 : 0)
      if (score > bestScore) { best = s; bestScore = score }
    }
    if (!best) continue
    used.add(best.id)
    out.push({ fromId: best.id, fromTitle: best.title, toId: t.id, toTitle: t.title })
  }
  return out
}

const newestFirst = (a: AuditPost, b: AuditPost) => (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0)

/** The posts to ask Google for today: ones Google knows but has not read
 *  first (closest to being listed), then ones it has never heard of, newest
 *  first. Pure. */
export function indexPicks(all: AuditPost[], count: number): string[] {
  const cand = all.filter((p) => p.url && p.indexed !== 'indexed')
  const rank = (p: AuditPost) => { const k = coverageKind(p.coverage); return k === 'discovered' ? 0 : k === 'unknown' ? 1 : k === 'crawled' ? 3 : 2 }
  return cand.sort((a, b) => rank(a) - rank(b) || newestFirst(a, b)).slice(0, Math.max(0, count)).map((p) => p.url as string)
}

/** Publishing pace: posts in the last 60 days, and the longest quiet spell
 *  (in days) before the latest run of posts. Pure. */
export function paceOf(dates: string[], now: number): { last60: number; quietDays: number; quietEnded: string | null } {
  const ts = dates.map((d) => Date.parse(d)).filter(Number.isFinite).sort((a, b) => a - b)
  const last60 = ts.filter((t) => now - t <= 60 * DAY).length
  let quietDays = 0, quietEnded: string | null = null
  for (let i = 1; i < ts.length; i++) {
    const gap = Math.round((ts[i] - ts[i - 1]) / DAY)
    if (gap > quietDays) { quietDays = gap; quietEnded = new Date(ts[i]).toISOString() }
  }
  return { last60, quietDays, quietEnded }
}

const ref = (p: AuditPost, note?: string): AuditPostRef => ({ id: p.id, title: p.title, url: p.url, ...(note ? { note } : {}) })
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }

const GONE_NOTE: Record<string, string> = {
  trash: 'In your WordPress Trash',
  draft: 'Saved as a draft, not published',
  private: 'Set to Private',
  pending: 'Waiting for review in WordPress',
  future: 'Scheduled for later',
  deleted: 'Deleted in WordPress',
  publish: 'WordPress says it is published, but its address does not open',
}

/** The audit: facts in, a short ordered list out. Pure. */
export function auditSite(f: AuditFacts): Audit {
  const steps: AuditStep[] = []
  const right: string[] = []
  const unchecked: string[] = []
  const P = f.posts
  const connected = f.gsc === 'ok'
  const byId = new Map(P.map((p) => [p.id, p]))

  const kinds = P.map((p) => coverageKind(p.coverage))
  const count = (k: CoverageKind) => kinds.filter((x) => x === k).length
  const indexed = P.filter((p) => p.indexed === 'indexed').length
  const notIndexed = P.filter((p) => p.indexed === 'not_indexed').length
  const neverChecked = P.filter((p) => !p.indexed || p.indexed === 'unknown').length
  const unknownToGoogle = count('unknown'), discovered = count('discovered'), crawledNot = count('crawled')
  const clicks = P.reduce((s, p) => s + (p.clicks || 0), 0)
  const impressions = P.reduce((s, p) => s + (p.impressions || 0), 0)

  const answered = f.live.filter((l) => l.status != null && l.status !== 403 && l.status !== 429)
  const times = answered.map((l) => l.ms).filter((m): m is number => typeof m === 'number')
  const med = median(times)
  const slowShare = times.length ? times.filter((m) => m > 5000).length / times.length : 0
  const slowest = times.length ? Math.max(...times) : null

  // 1. The site itself.
  const homeOk = !!f.home && f.home.status != null && f.home.status < 400
  if (f.home && !homeOk && f.home.status !== 403 && f.home.status !== 429) {
    steps.push({
      id: 'site-down', tone: 'blocked', who: 'you', weight: 100, action: 'open', actionLabel: 'Open my site', href: f.siteUrl || undefined,
      title: f.home.status == null ? 'Your site did not open' : `Your site answered with an error (${f.home.status})`,
      why: 'If MVP cannot open your homepage, Google cannot either, and nothing else on this list matters until it opens.',
      doThis: ['Open your site in a private browser window.', 'If it does not load, contact your web host and tell them your site is down.', 'Run this audit again once it opens.'],
    })
  }
  const robotsBlocks = !!f.robots?.blocksAll
  if ((f.home?.noindex && homeOk) || robotsBlocks) {
    steps.push({
      id: 'noindex-site', tone: 'blocked', who: 'you', weight: 99, action: 'none',
      title: 'Your site tells Google to stay away',
      why: robotsBlocks
        ? 'Your robots.txt file blocks every search engine from your whole site, so Google will not read any post.'
        : 'Your homepage carries a "do not list me" instruction. That is usually one WordPress setting, and while it is on Google drops your pages.',
      doThis: robotsBlocks
        ? ['In WordPress, open Rank Math (or Yoast), then General Settings, then Edit robots.txt.', 'Remove the line that says "Disallow: /" under "User-agent: *".', 'Save, then run this audit again.']
        : ['In WordPress, open Settings, then Reading.', 'Untick "Discourage search engines from indexing this site".', 'Save, then run this audit again.'],
    })
  } else if (homeOk) right.push('Nothing on your site tells Google to stay away.')

  // 2. Search Console: almost everything else reads from it.
  if (f.gsc === 'none') {
    steps.push({
      id: 'connect-gsc', tone: 'act', who: 'you', weight: 92, action: 'connect-gsc', actionLabel: 'Connect Search Console',
      title: 'Connect Google Search Console',
      why: 'It is free, and it is the only way MVP can see which of your posts Google has, which it refuses, and why. Without it, this audit can check your site but not what Google does with it.',
      doThis: ['Press Connect and sign in with the Google account that owns your site in Search Console.', 'If you have never used Search Console, it will walk you through adding your site first.', 'Run this audit again tomorrow, once MVP has asked Google about every post.'],
    })
  } else if (f.gsc === 'expired' || f.gsc === 'no-property') {
    steps.push({
      id: 'reconnect-gsc', tone: 'blocked', who: 'you', weight: 92, action: 'connect-gsc', actionLabel: 'Reconnect Search Console',
      title: f.gsc === 'expired' ? 'Your Search Console sign in expired' : 'Search Console is connected, but not to this site',
      why: f.gsc === 'expired'
        ? 'Google stopped letting MVP read your Search Console, so the numbers MVP shows about Google are getting old.'
        : `None of the sites in your Search Console matches ${f.siteUrl || 'your blog'}, so MVP cannot ask Google about your posts.`,
      doThis: f.gsc === 'expired'
        ? ['Press Reconnect and sign in with the same Google account.']
        : ['Open Search Console and check your site is added there, with the exact address your blog uses (with or without www).', 'Then press Reconnect here.'],
    })
  } else right.push('Search Console is connected, and MVP asks Google about your posts every night.')

  // 3. Posts MVP lists as published whose page is gone.
  const gone = f.live.filter((l) => l.status === 404 || l.status === 410)
  if (gone.length) {
    const refs = gone.map((l) => { const p = byId.get(l.postId); return { id: l.postId, title: p?.title || l.url, url: l.url, note: l.wpStatus ? GONE_NOTE[l.wpStatus] : undefined } })
    const inTrash = gone.some((l) => l.wpStatus === 'trash'), inDraft = gone.some((l) => l.wpStatus === 'draft' || l.wpStatus === 'private' || l.wpStatus === 'pending')
    steps.push({
      id: 'gone', tone: 'blocked', who: 'you', weight: 96, action: 'none', posts: refs,
      title: `${n(gone.length)} ${posts(gone.length)} MVP lists as live ${gone.length === 1 ? 'shows' : 'show'} "Page not found"`,
      why: 'Anyone arriving from Google, a video description or a pin lands on an error page, and Google is still being sent there by your sitemap.',
      doThis: [
        inTrash || inDraft || !gone.some((l) => l.wpStatus) ? 'In WordPress, open Posts and look in Trash and Drafts.' : 'In WordPress, open Posts and search for the title.',
        'If you still want it, restore it and press Publish (or Update).',
        'If you removed it on purpose, there is nothing else to do: Google drops a missing page on its own within a few weeks.',
      ],
    })
  }

  // 4. Posts that tell Google not to list them.
  const noindexPosts = f.live.filter((l) => l.status != null && l.status < 300 && l.noindex)
  if (noindexPosts.length) {
    steps.push({
      id: 'post-noindex', tone: 'blocked', who: 'you', weight: 90, action: 'none',
      posts: noindexPosts.map((l) => ref(byId.get(l.postId) || { id: l.postId, title: l.url, url: l.url } as AuditPost)),
      title: `${n(noindexPosts.length)} ${posts(noindexPosts.length)} ${noindexPosts.length === 1 ? 'tells' : 'tell'} Google not to list ${noindexPosts.length === 1 ? 'it' : 'them'}`,
      why: 'These pages carry a "noindex" instruction, so Google will never show them however good they are.',
      doThis: ['Open the post in WordPress.', 'In the Rank Math (or Yoast) box, open Advanced and set Robots to Index.', 'Press Update.'],
    })
  }

  // 5. Addresses that moved: MVP still has the old one.
  const moved = f.live.filter((l) => l.status != null && l.status < 400 && l.finalUrl && pathOf(l.finalUrl) !== pathOf(l.url))
  if (moved.length) {
    steps.push({
      id: 'moved', tone: 'act', who: 'mvp', weight: 84, action: 'refresh-urls', actionLabel: 'Refresh post addresses',
      posts: moved.map((l) => ref(byId.get(l.postId) || { id: l.postId, title: l.url, url: l.url } as AuditPost, `Now at ${pathOf(l.finalUrl)}`)),
      title: `MVP has an old address for ${n(moved.length)} ${posts(moved.length)}`,
      why: 'These posts moved to a new address. Links MVP shares and the checks it asks Google for go to the old one first, which slows everything down.',
      doThis: ['Press Refresh post addresses. MVP asks WordPress for each post\'s real address and saves it.'],
    })
  }

  // 6. Fell out of Google this week.
  const dropped = P.filter((p) => p.droppedAt && f.now - Date.parse(p.droppedAt) <= 7 * DAY && !gone.some((g) => g.postId === p.id))
  if (connected && dropped.length) {
    steps.push({
      id: 'dropped', tone: 'blocked', who: 'mvp', weight: 85, action: 'get-found', actionLabel: 'Get my blog found',
      posts: dropped.slice(0, 10).map((p) => ref(p)),
      title: `${n(dropped.length)} ${posts(dropped.length)} fell out of Google this week`,
      why: 'They were being shown to people and are not any more. Usually something on the post changed: its address, a redirect, or a setting.',
      doThis: ['Press Get my blog found. It refreshes your sitemap, repairs moved addresses and fixes the SEO basics on every post.', 'Then press Request indexing on the posts in this list (2 a day).'],
    })
  }

  // 7. The sitemap: found on the site, and handed to Google.
  if (!f.sitemap.found) {
    steps.push({
      id: 'no-sitemap', tone: 'act', who: 'you', weight: 82, action: 'none',
      title: 'MVP could not find a sitemap on your site',
      why: 'A sitemap is the list of every post you hand to Google. Without one, Google only finds posts by following links, which is slow and misses many.',
      doThis: ['In WordPress, open Rank Math, then Dashboard, and make sure the Sitemap module is on (Yoast: SEO, Settings, XML sitemaps).', 'Open yoursite.com/sitemap_index.xml to check it loads.', 'Run this audit again.'],
    })
  } else {
    right.push(`Your sitemap is there and lists ${n(f.sitemap.urls)} ${f.sitemap.urls === 1 ? 'address' : 'addresses'}.`)
  }
  if (connected && f.gscSitemaps) {
    const scLink = f.property ? `https://search.google.com/search-console/sitemaps?resource_id=${encodeURIComponent(f.property)}` : 'https://search.google.com/search-console/sitemaps'
    if (f.sitemap.found && f.gscSitemaps.length === 0) {
      steps.push({
        id: 'submit-sitemap', tone: 'act', who: 'you', weight: 83, action: 'open', actionLabel: 'Open Search Console Sitemaps', href: scLink,
        title: 'Your sitemap is not in Search Console',
        why: 'Google has not been handed your list of posts, so it only finds them by chance. This is usually the biggest reason posts are "unknown to Google".',
        doThis: [`Open Search Console Sitemaps (the button opens it).`, `Under "Add a new sitemap", paste ${f.sitemap.address ? f.sitemap.address.replace(/^https?:\/\/[^/]+\//i, '') : 'sitemap_index.xml'} and press Submit.`, 'Come back in a day or two: it should say Success.'],
      })
    } else if (f.gscSitemaps.length) {
      const read = f.gscSitemaps.map((s) => Date.parse(s.lastDownloaded || '')).filter(Number.isFinite)
      const lastRead = read.length ? Math.max(...read) : null
      const errs = f.gscSitemaps.reduce((s, x) => s + (x.errors || 0), 0)
      if (errs > 0 || (lastRead != null && f.now - lastRead > 30 * DAY)) {
        steps.push({
          id: 'sitemap-stale', tone: 'act', who: 'you', weight: 76, action: 'open', actionLabel: 'Open Search Console Sitemaps', href: scLink,
          title: errs > 0 ? `Google found ${n(errs)} ${errs === 1 ? 'error' : 'errors'} in your sitemap` : `Google has not read your sitemap in ${Math.round((f.now - (lastRead as number)) / DAY)} days`,
          why: 'Google reads your sitemap to find new posts. While it is failing or stale, new posts wait.',
          doThis: ['Open Search Console Sitemaps.', 'Click your sitemap to see what Google says about it.', 'Remove it and add it again, then press Submit.'],
        })
      } else right.push('Google reads your sitemap regularly.')
    }
  } else if (connected && f.gscSitemaps === null) unchecked.push('Search Console did not say whether your sitemap is submitted.')

  // 8. What Google says about the posts.
  const notIn = P.filter((p) => p.indexed !== 'indexed')
  if (connected && unknownToGoogle >= 3) {
    const hasSubmit = steps.some((s) => s.id === 'submit-sitemap')
    steps.push({
      id: 'unknown', tone: 'act', who: 'mvp', weight: 78, action: 'get-found', actionLabel: 'Get my blog found',
      posts: P.filter((p) => coverageKind(p.coverage) === 'unknown').sort(newestFirst).slice(0, 10).map((p) => ref(p)),
      title: `Google has never heard of ${n(unknownToGoogle)} of your ${posts(P.length)}`,
      why: 'They are not in Google\'s records at all, not even waiting. These are usually your newest posts, or posts Google has no path to.',
      doThis: [
        ...(hasSubmit ? ['Submitting your sitemap (above) fixes most of these.'] : []),
        'Press Get my blog found once. It refreshes your sitemap, tells Bing about every post and fixes the SEO basics.',
        'Pressing it again does nothing extra. Give it a week.',
      ],
    })
  }
  if (connected && discovered >= 3) {
    const targets = P.filter((p) => ['discovered', 'unknown'].includes(coverageKind(p.coverage))).sort(newestFirst)
    const pairs = linkPairs(P, targets, 5)
    const pace = f.wpDates?.length ? paceOf(f.wpDates, f.now) : paceOf(P.map((p) => p.publishedAt || '').filter(Boolean), f.now)
    const causes: string[] = []
    if (med != null && (med > 2500 || slowShare >= 0.2)) causes.push('your pages are slow to open, so Google reads fewer of them per visit')
    if (pace.quietDays >= 180) causes.push(`your site was quiet for ${Math.round(pace.quietDays / 30)} months before your latest posts, so Google is rebuilding its trust in it`)
    if (pace.last60 >= 20) causes.push(`you published ${n(pace.last60)} posts in the last 60 days, faster than Google reads a site its size`)
    if (clicks < 20) causes.push('few people reach your site from Google yet, which is how Google judges a site is worth reading more of')
    steps.push({
      id: 'discovered', tone: 'act', who: 'mvp', weight: 74, action: pairs.length ? 'link-up' : 'none', actionLabel: pairs.length ? `Add ${pairs.length} ${pairs.length === 1 ? 'link' : 'links'} for me` : undefined,
      pairs: pairs.length ? pairs : undefined,
      posts: P.filter((p) => coverageKind(p.coverage) === 'discovered').sort(newestFirst).slice(0, 10).map((p) => ref(p)),
      title: `Google knows about ${n(discovered)} ${posts(discovered)} but has not visited ${discovered === 1 ? 'it' : 'them'} yet`,
      why: `Google decides how much of a site to read each day. ${causes.length ? `Here, ${causes.join('; ')}.` : 'It is reading yours slowly.'} A link from a post Google already shows is the strongest nudge.`,
      doThis: [
        pairs.length ? `Press Add links. MVP adds a link to ${pairs.length === 1 ? 'one of these posts' : `${pairs.length} of these posts`} from your closest post that Google already shows, and republishes it.` : 'Link to these posts from your posts that are already in Google.',
        'Repeat in a few days for the next ones (run the audit again and it picks the next posts).',
      ],
    })
  }
  if (connected && crawledNot >= 3 && crawledNot / Math.max(1, P.length) >= 0.1) {
    steps.push({
      id: 'crawled', tone: 'act', who: 'you', weight: 70, action: 'open', actionLabel: 'Check for duplicates', href: '/tools/duplicates',
      posts: P.filter((p) => coverageKind(p.coverage) === 'crawled').sort(newestFirst).slice(0, 10).map((p) => ref(p)),
      title: `Google read ${n(crawledNot)} ${posts(crawledNot)} and chose not to list ${crawledNot === 1 ? 'it' : 'them'}`,
      why: 'This is Google saying the page is too close to others (yours or someone else\'s) to be worth showing. Asking again does not change it; changing the page does.',
      doThis: ['Check for duplicates: two posts on the same product compete and Google drops one. Keep the stronger.', 'On the rest, add what only you know: your own photos, how you used it, who it is not for.', 'Then press Request indexing on that post.'],
    })
  } else if (connected && indexed > 0 && crawledNot < 3) right.push('Google is not turning your posts down for quality.')

  // 9. Speed.
  if (med != null && (med > 2500 || slowShare >= 0.2)) {
    steps.push({
      id: 'slow', tone: 'act', who: 'you', weight: 68, action: 'none',
      title: `Your posts are slow to open (typically ${secs(med)}${slowest && slowest > med * 1.5 ? `, up to ${secs(slowest)}` : ''})`,
      why: 'Google reads fewer pages from a slow site, and visitors leave before a slow post appears.',
      doThis: ['Ask your web host to turn on caching (most hosts have a switch for it in their dashboard).', 'Or install one caching plugin, such as LiteSpeed Cache (if your host runs LiteSpeed) or WP Super Cache.', 'Run this audit again to compare.'],
    })
  } else if (med != null) right.push(`Your posts open quickly (typically ${secs(med)}).`)

  // 10. The 2 a day Google nudge.
  if (connected && notIn.length > 0) {
    const picks = indexPicks(P, Math.min(f.nudges.roomToday, f.nudges.perDay))
    if (f.nudges.scopeOk === false) {
      steps.push({
        id: 'nudge-scope', tone: 'act', who: 'you', weight: 66, action: 'connect-gsc', actionLabel: 'Reconnect Search Console',
        title: 'Let MVP ask Google to look at your posts',
        why: `MVP can ask Google directly to visit ${f.nudges.perDay} posts a day, but your Search Console connection is from before this was possible.`,
        doThis: ['Press Reconnect and sign in with the same Google account. Google will ask for one extra permission.'],
      })
    } else if (picks.length) {
      steps.push({
        id: 'nudge', tone: 'act', who: 'mvp', weight: 66, action: 'request-index', actionLabel: `Ask Google for ${picks.length === 1 ? 'this post' : `these ${picks.length}`}`, indexUrls: picks,
        posts: picks.map((u) => { const p = P.find((x) => x.url === u); return p ? ref(p) : { id: u, title: u, url: u } }),
        title: `Ask Google to look at ${picks.length === 1 ? '1 post' : `${picks.length} posts`} today`,
        why: `${n(notIn.length)} of your posts are not in Google yet. MVP can ask Google directly for ${f.nudges.perDay} a day${f.nudges.last30 === 0 ? ', and you have not used it in the last 30 days' : ''}.`,
        doThis: ['Press the button. MVP picks the posts closest to being listed.', 'Come back tomorrow and run the audit again for the next ones.'],
      })
    }
  }

  // 11. Pace: publishing faster than Google reads.
  const share = P.length ? indexed / P.length : 1
  const paceDates = f.wpDates?.length ? f.wpDates : P.map((p) => p.publishedAt || '').filter(Boolean)
  const pace = paceOf(paceDates, f.now)
  if (connected && P.length >= 20 && share < 0.5 && (pace.last60 >= 20 || pace.quietDays >= 180)) {
    steps.push({
      id: 'pace', tone: 'act', who: 'you', weight: 60, action: 'none',
      title: 'You are publishing faster than Google is reading',
      why: `${pace.quietDays >= 180 ? `Your site was quiet for ${Math.round(pace.quietDays / 30)} months, then ` : ''}${pace.last60 >= 20 ? `${n(pace.last60)} posts went up in the last 60 days` : 'many posts went up at once'}, and Google has ${Math.round(share * 100)}% of them. New posts join the back of the same queue.`,
      doThis: ['Keep to 3 or 4 new posts a week until most of your posts are in Google.', 'Write about the same kinds of products as your posts that are already in Google. A tight group of topics gets read faster than a wide mix.', 'Put the link to each post in the description of your matching video: that gives Google a path from outside your site.'],
    })
  }

  // 12. Shown, rarely clicked.
  if (connected && impressions >= 200 && clicks / impressions < 0.01) {
    steps.push({
      id: 'titles', tone: 'act', who: 'mvp', weight: 58, action: 'open', actionLabel: 'Open Title Check', href: '/tools/title-audit',
      title: `Google showed your posts ${n(impressions)} times and ${clicks === 0 ? 'nobody clicked' : `only ${n(clicks)} clicked`}`,
      why: 'You are already in the results. People read your title and chose another one, so the fix is the title, not search.',
      doThis: ['Open Title Check. It scores every title and drafts a better one you can accept or edit.', 'Start with the posts shown most.'],
    })
  } else if (connected && clicks > 0) right.push(`People found you ${n(clicks)} ${clicks === 1 ? 'time' : 'times'} from Google in the last 28 days.`)

  // 13. Homepage title.
  if (homeOk) {
    const t = homeTitleProblem(f.home?.title)
    if (t) {
      steps.push({
        id: 'home-title', tone: 'act', who: 'you', weight: 50, action: 'none',
        title: 'Fix your homepage title',
        why: `${t} It is the line Google shows for your site, and the name people remember.`,
        doThis: ['In WordPress, open Settings, then General, and set Site Title to your blog\'s name. Save.', 'In Rank Math, open Titles & Meta, then Homepage, and check the title there reads well (Yoast: Settings, Site basics).'],
      })
    } else right.push('Your homepage title reads well.')
  }

  // What could not be checked never reads as a pass.
  if (!f.home) unchecked.push('MVP could not open your homepage.')
  if (!f.robots) unchecked.push('MVP could not read your robots.txt.')
  if (f.challenged) unchecked.push('Your web host showed MVP a robot check (a captcha page) instead of your site, so MVP could not open your pages. Hosts usually let Google through, but check in Search Console, Settings, Crawl stats, that Google is not being refused too.')
  else if (f.blocked) unchecked.push('Your web host refused some of MVP\'s checks (it treats quick visits as a robot). Make sure in Search Console, Settings, Crawl stats, that Google is not being refused too.')
  if (P.length && f.live.length < P.length) unchecked.push(`MVP opened ${n(f.live.length)} of your ${n(P.length)} posts (the newest and the ones Google has not listed), not every one.`)
  if (f.live.some((l) => l.status == null)) unchecked.push(`${n(f.live.filter((l) => l.status == null).length)} ${posts(f.live.filter((l) => l.status == null).length)} did not answer in time.`)
  if (connected && neverChecked > 0) unchecked.push(`Google has not been asked about ${n(neverChecked)} ${posts(neverChecked)} yet (MVP checks a batch each night).`)
  if (!gone.length && answered.length) right.push(`All ${n(answered.length)} posts MVP opened are live.`)
  if (connected && P.length && share >= 0.8) right.push(`Google has ${Math.round(share * 100)}% of your posts.`)

  steps.sort((a, b) => b.weight - a.weight)
  const top = steps.slice(0, 7)

  const headline = !P.length
    ? 'You have not published a post through MVP yet, so there is nothing for Google to find.'
    : connected
      ? `Google has ${n(indexed)} of your ${n(P.length)} ${posts(P.length)}. ${top.length ? `${top.length} ${top.length === 1 ? 'thing' : 'things'} to do, most important first.` : 'Nothing needs fixing.'}`
      : `MVP checked your site and ${n(P.length)} ${posts(P.length)}. ${top.length ? `${top.length} ${top.length === 1 ? 'thing' : 'things'} to do, most important first.` : 'Nothing needs fixing.'}`

  return {
    at: new Date(f.now).toISOString(),
    siteUrl: f.siteUrl,
    headline,
    steps: top,
    right,
    unchecked,
    numbers: { posts: P.length, indexed, notIndexed, neverChecked, unknownToGoogle, discovered, crawledNot, clicks, impressions, checkedLive: f.live.length, medianSeconds: med == null ? null : Math.round(med / 100) / 10 },
  }
}

/** A saved audit, read safely (what the page stores and reads back). Pure. */
export function readAudit(v: unknown): Audit | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Partial<Audit>
  if (typeof a.headline !== 'string' || !Array.isArray(a.steps) || typeof a.at !== 'string') return null
  return { at: a.at, siteUrl: a.siteUrl ?? null, headline: a.headline, steps: a.steps as AuditStep[], right: Array.isArray(a.right) ? a.right : [], unchecked: Array.isArray(a.unchecked) ? a.unchecked : [], numbers: (a.numbers || {}) as AuditNumbers }
}
