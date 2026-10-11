// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GETTING POSTS INTO GOOGLE, AND WHAT SEARCH CONSOLE IS SAYING (Seb,
// 2026-10-11: "we need a bullet proof way of dealing with indexing and google
// search console.. failed validations.. posts not showing up on search. we
// need actionable ways to fix these issues, right on this MVP section").
//
// Two things a creator reads in Search Console and cannot act on:
//   1. A report with "Validation failed" that is not a problem at all. 863
//      pages "Excluded by noindex" on gominreviews.com are tag, author, date
//      and paged archives MVP's plugin keeps out of Google ON PURPOSE (thin
//      duplicates of the real reviews). Validate can never pass for those.
//   2. A post that is not in Google, with a reason that names no action.
// This turns each of Google's reasons into: is it a problem, what to do, the
// MVP tool that does it, and whether to press Validate. Pure, so it is tested
// (scripts/test-indexing-help).

import { gscResourceId } from '@/lib/gsc-links'

export type Severity = 'urgent' | 'fix' | 'wait' | 'fine'

export interface ReasonGuide {
  label: string
  severity: Severity
  /** What it means, in one or two plain sentences. */
  means: string
  /** The thing to do, as an instruction. */
  todo: string
  /** An MVP page that does it. */
  tool?: { href: string; label: string }
  /** Whether "Validate fix" in Search Console is worth pressing once fixed. */
  validate: boolean
}

const G: Record<string, ReasonGuide> = {
  "excluded by 'noindex' tag": {
    label: 'Excluded by noindex', severity: 'urgent',
    means: 'This POST tells Google not to index it. On an archive page that is on purpose; on a review it is a mistake, and the post can never appear in search.',
    todo: 'In WordPress, open Settings, then Reading, and make sure "Discourage search engines" is NOT ticked. If you use Yoast or Rank Math, open the post and set it to index. Then press Request indexing below.',
    validate: true,
  },
  'blocked by robots.txt': {
    label: 'Blocked by robots.txt', severity: 'urgent',
    means: 'Your robots.txt file stops Google from reading this post.',
    todo: 'Open yourblog.com/robots.txt. Remove any "Disallow" line that covers your posts (a single "Disallow: /" blocks the whole site). Then press Request indexing.',
    validate: true,
  },
  'not found (404)': {
    label: 'Not found (404)', severity: 'fix',
    means: 'Google went to this address and found nothing. The post moved or was deleted.',
    todo: 'Send the old address to a live post with a 301 redirect.',
    tool: { href: '/tools/redirects', label: 'Fix 404s' }, validate: true,
  },
  'soft 404': {
    label: 'Soft 404', severity: 'fix',
    means: 'The page loads but looks empty or broken to Google, so it is treated as missing.',
    todo: 'Open the post: if it is blank or has almost no text, rebuild it or redirect it to a stronger post.',
    tool: { href: '/tools/redirects', label: 'Fix 404s' }, validate: true,
  },
  'duplicate without user-selected canonical': {
    label: 'Duplicate of another post', severity: 'fix',
    means: 'Google sees this post as a copy of another one of yours and indexes only one of them.',
    todo: 'Merge the two into the stronger post and redirect the weaker one.',
    tool: { href: '/tools/duplicates', label: 'Duplicates' }, validate: true,
  },
  'duplicate, google chose different canonical than user': {
    label: 'Google picked another page', severity: 'fix',
    means: 'You said this is the main version, but Google decided another page is.',
    todo: 'Merge this post into the page Google chose, or make this one clearly different and better.',
    tool: { href: '/tools/duplicates', label: 'Duplicates' }, validate: true,
  },
  'crawled - currently not indexed': {
    label: 'Crawled, not indexed', severity: 'wait',
    means: 'Google read the post and chose not to show it yet. It usually thinks the page adds little over what it already has.',
    todo: 'Make it worth indexing: your own photos or video, real testing notes, a clear verdict. Link to it from two or three of your posts that ARE in Google. Then press Request indexing once.',
    validate: false,
  },
  'discovered - currently not indexed': {
    label: 'Discovered, not indexed', severity: 'wait',
    means: 'Google knows the address but has not visited yet. On a young site it visits a few pages a day.',
    todo: 'Press Request indexing for your best posts first (Google allows about 10 a day). Link to them from posts already in Google. Publishing fewer, better posts gets the rest visited sooner.',
    validate: false,
  },
  'url is unknown to google': {
    label: 'Unknown to Google', severity: 'wait',
    means: 'Google has never seen this address.',
    todo: 'Make sure your sitemap is submitted (below), then press Request indexing.',
    validate: false,
  },
  'page with redirect': {
    label: 'Page with redirect', severity: 'fine',
    means: 'This old address now sends visitors to another page. Google indexes the page it lands on instead.',
    todo: 'Nothing to do, as long as the page it lands on is in Google.',
    validate: false,
  },
  'alternate page with proper canonical tag': {
    label: 'Alternate page', severity: 'fine',
    means: 'A copy of a page Google already indexes (often the AMP or ?query version). Expected.',
    todo: 'Nothing to do.',
    validate: false,
  },
  'redirect error': {
    label: 'Redirect error', severity: 'fix',
    means: 'The address redirects in a loop, or to a page that does not load.',
    todo: 'Open the address in your browser and see where it ends up; fix or remove the redirect.',
    tool: { href: '/tools/redirects', label: 'Fix 404s' }, validate: true,
  },
}

/** The guide for Google's reason on a POST, or a generic one. Pure. */
export function reasonGuide(coverageState: string | null | undefined): ReasonGuide {
  const raw = String(coverageState || '').trim().toLowerCase()
  const g = G[raw]
  if (g) return g
  if (!raw) return { label: 'Not checked yet', severity: 'wait', means: 'MVP has not had Google\'s answer for this post yet.', todo: 'It is checked within a day. Nothing to do.', validate: false }
  return { label: coverageState!, severity: 'fix', means: 'Google gave a reason MVP does not have a guide for yet.', todo: 'Open it in Search Console with the button below to see Google\'s details.', validate: false }
}

// ── Search Console's site-wide reports (incl. pages that are not posts) ──────

export interface ReportGuide { report: string; yours: string; validate: string }

/** "Validation failed" decoder: the Search Console reports a creator sees,
 *  what each means on an MVP blog, and whether pressing Validate makes sense. */
export const REPORT_GUIDE: ReportGuide[] = [
  {
    report: "Excluded by 'noindex' tag",
    yours: 'Mostly tag, author, date and page 2+ archive pages. MVP keeps those out of Google on purpose: they are thin copies of your reviews and would compete with them. MVP checks your POSTS separately below, and flags any post in this list as urgent.',
    validate: 'Do not press Validate for archive pages. It fails every time, because the noindex is deliberate. A failed validation here does not hurt your site.',
  },
  {
    report: 'Crawled, currently not indexed',
    yours: 'Google read these and chose not to show them yet. The fix is quality and links, not a button.',
    validate: 'Validate does not speed this up. Improve the post, link to it, then Request indexing.',
  },
  {
    report: 'Discovered, currently not indexed',
    yours: 'Google knows these addresses and has not visited. Normal on a young blog that publishes often.',
    validate: 'Validate does not help. Request indexing for your best posts (about 10 a day) and link to them.',
  },
  {
    report: 'Page with redirect',
    yours: 'Old addresses MVP redirected (merged duplicates, fixed 404s). Expected.',
    validate: 'Do not press Validate. These are supposed to redirect.',
  },
  {
    report: 'Not found (404)',
    yours: 'Addresses that point at nothing. Worth fixing.',
    validate: 'Fix them with Fix 404s first, then press Validate once.',
  },
  {
    report: 'Alternate page with proper canonical tag',
    yours: 'Copies of pages Google already indexes. Expected.',
    validate: 'Do not press Validate.',
  },
]

// ── What to request today ────────────────────────────────────────────────────

/** Google's own limit on manual Request indexing, per property per day, roughly. */
export const REQUESTS_PER_DAY = 10
/** A post asked about within this many days is not suggested again. */
const REQUEST_AGAIN_DAYS = 7

export interface PostForQueue { url: string | null; title: string; indexed: boolean | null; coverageState: string | null; publishedAt?: string | null; impressions?: number }

/** Today's posts to Request indexing for: not in Google, nothing broken that
 *  must be fixed first, not asked about this week. Best first: posts Google
 *  has never visited, then those it passed over; newest first within each. */
export function requestQueue(posts: PostForQueue[], requested: Record<string, string>, now = Date.now(), max = REQUESTS_PER_DAY): PostForQueue[] {
  const fresh = (url: string) => {
    const at = requested[url] ? Date.parse(requested[url]) : NaN
    return !Number.isFinite(at) || now - at > REQUEST_AGAIN_DAYS * 86_400_000
  }
  const rank = (p: PostForQueue) => {
    const s = reasonGuide(p.coverageState).severity
    return /discovered|unknown/i.test(p.coverageState || '') ? 0 : s === 'wait' ? 1 : 2
  }
  return posts
    .filter((p) => p.indexed === false && !!p.url && fresh(p.url))
    .filter((p) => { const s = reasonGuide(p.coverageState).severity; return s === 'wait' || s === 'urgent' })
    .sort((a, b) => rank(a) - rank(b) || (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0))
    .slice(0, max)
}

// ── Links into Search Console ────────────────────────────────────────────────

/** Search Console's URL inspection for one address: the page with the Request
 *  indexing button. (Google offers no API to request indexing for blog posts.) */
export function inspectLink(property: string | null | undefined, url: string): string {
  const base = 'https://search.google.com/search-console/inspect'
  return property
    ? `${base}?resource_id=${gscResourceId(property)}&id=${encodeURIComponent(url)}`
    : `${base}?id=${encodeURIComponent(url)}`
}
