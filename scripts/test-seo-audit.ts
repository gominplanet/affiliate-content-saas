// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Audit my site (lib/seo-audit): one button, a short list in order.
//
// The test subject is Alejandro's real blog on 2026-10-15: 145 posts through
// MVP, 55 in Google, 47 "Discovered", 35 "unknown to Google", one post MVP
// listed as live that was in his WordPress Trash, some pages taking 5 to 13
// seconds, a homepage titled "Alex Media Creations - Alex Media Creations",
// and a site that was quiet for 17 months before the MVP posts. The audit has
// to put the broken post first, offer the buttons MVP can press, say plainly
// what it could not check, and tell a healthy blog it is healthy.
import { readFileSync, existsSync } from 'node:fs'
import { auditSite, coverageKind, homeTitleProblem, linkPairs, indexPicks, paceOf, readAudit, type AuditFacts, type AuditPost } from '../lib/seo-audit'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: string) => { if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`) }

const NOW = Date.parse('2026-10-15T12:00:00Z')
const day = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
const TOPICS = ['Ergonomic Office Chair', 'Back Massager with Heat', 'Gaming Chair with Footrest', 'Cat Water Fountain', 'Charcoal Grill', 'Dehumidifier']

function post(i: number, coverage: string | null, indexed: AuditPost['indexed']): AuditPost {
  return { id: `p${i}`, title: `${TOPICS[i % TOPICS.length]} ${i} Review`, url: `https://reviewcentralhub.com/post-${i}`, publishedAt: day(i), indexed, coverage, clicks: i === 3 ? 3 : 0, impressions: indexed === 'indexed' ? 4 : 0, droppedAt: null }
}

function alejandro(): AuditFacts {
  const P: AuditPost[] = []
  let i = 0
  for (let k = 0; k < 34; k++) P.push(post(i++, 'Submitted and indexed', 'indexed'))
  for (let k = 0; k < 21; k++) P.push(post(i++, 'Indexed, confirmed by Search Console impressions', 'indexed'))
  for (let k = 0; k < 47; k++) P.push(post(i++, 'Discovered - currently not indexed', 'not_indexed'))
  for (let k = 0; k < 35; k++) P.push(post(i++, 'URL is unknown to Google', 'not_indexed'))
  for (let k = 0; k < 6; k++) P.push(post(i++, 'Crawled - currently not indexed', 'not_indexed'))
  P.push(post(i++, null, null))
  P.push(post(i++, 'Discovered - currently not indexed', 'not_indexed'))
  const live = P.slice(50, 80).map((p, k) => ({ postId: p.id, url: p.url as string, status: 200, ms: k % 4 === 0 ? 9000 : 2900, finalUrl: p.url, noindex: false }))
  live.push({ postId: 'p144', url: P[144].url as string, status: 404, ms: 2100, finalUrl: P[144].url, noindex: false, wpStatus: 'trash' } as typeof live[number])
  const old = Array.from({ length: 68 }, (_, k) => new Date(Date.parse('2023-10-18') + k * 6 * 86_400_000).toISOString())
  const recent = Array.from({ length: 127 }, (_, k) => day(k))
  return {
    now: NOW, siteUrl: 'https://reviewcentralhub.com', gsc: 'ok', property: 'https://reviewcentralhub.com/', posts: P,
    wpDates: [...old, ...recent],
    home: { status: 200, ms: 800, title: 'Alex Media Creations - Alex Media Creations', noindex: false },
    robots: { found: true, blocksAll: false },
    sitemap: { found: true, urls: 193, address: 'https://reviewcentralhub.com/sitemap_index.xml' },
    gscSitemaps: [{ path: 'https://reviewcentralhub.com/sitemap_index.xml', lastDownloaded: day(3), errors: 0 }],
    live, blocked: false,
    nudges: { last30: 0, roomToday: 2, perDay: 2, scopeOk: true },
  }
}

// ── Alejandro ───────────────────────────────────────────────────────────────
{
  const a = auditSite(alejandro())
  const ids = a.steps.map((s) => s.id)
  check('the broken post comes first', ids[0] === 'gone', ids.join(','))
  const gone = a.steps.find((s) => s.id === 'gone')
  check('the broken post says where it went', gone?.posts?.[0]?.note === 'In your WordPress Trash', JSON.stringify(gone?.posts))
  check('headline gives the real number in Google', a.headline.startsWith('Google has 55 of your 145 posts.'), a.headline)
  const disc = a.steps.find((s) => s.id === 'discovered')
  check('discovered posts get links MVP adds', disc?.action === 'link-up' && (disc.pairs?.length ?? 0) > 0)
  check('a link comes from a post Google already shows', !!disc?.pairs?.every((p) => Number(p.fromId.slice(1)) < 55))
  check('a link comes from the same kind of product', !!disc?.pairs?.every((p) => p.fromTitle.split(' ')[0] === p.toTitle.split(' ')[0]), JSON.stringify(disc?.pairs?.slice(0, 2)))
  check('the why names the real causes', /slow/.test(disc?.why || '') && /quiet for/.test(disc?.why || ''), disc?.why)
  const nudge = a.steps.find((s) => s.id === 'nudge')
  check('MVP offers to ask Google for 2 posts', nudge?.action === 'request-index' && nudge.indexUrls?.length === 2)
  check('the unused nudges are pointed out', /not used it/.test(nudge?.why || ''))
  check('pace is flagged', ids.includes('pace'))
  check('slow pages are flagged', ids.includes('slow'))
  check('the homepage title is flagged', ids.includes('home-title'))
  check('35 unknown to Google is a step', ids.includes('unknown'))
  check('6 of 145 crawled is not a step', !ids.includes('crawled'))
  check('never more than 7 steps', a.steps.length <= 7)
  check('Search Console counts as right', a.right.some((r) => /Search Console is connected/.test(r)))
  check('it says it did not open every post', a.unchecked.some((u) => /opened 31 of your 145/.test(u)), a.unchecked.join(' | '))
  check('the numbers are the real ones', a.numbers.discovered === 48 && a.numbers.unknownToGoogle === 35 && a.numbers.crawledNot === 6 && a.numbers.indexed === 55)
  const copy = a.steps.flatMap((s) => [s.title, s.actionLabel || '', ...s.doThis]).concat(a.right, a.unchecked, [a.headline]).join('\n')
  check('no em or en dashes in the copy', !/[—–]/.test(copy))
  check('round trips through storage', readAudit(JSON.parse(JSON.stringify(a)))?.steps.length === a.steps.length)
}

// ── A healthy blog is told so ───────────────────────────────────────────────
{
  const P = Array.from({ length: 12 }, (_, i) => ({ ...post(i, 'Submitted and indexed', 'indexed' as const), clicks: 10, impressions: 300 }))
  const a = auditSite({ ...alejandro(), posts: P, wpDates: P.map((p) => p.publishedAt as string), home: { status: 200, ms: 500, title: 'Review Central', noindex: false }, live: P.map((p) => ({ postId: p.id, url: p.url as string, status: 200, ms: 600, finalUrl: p.url, noindex: false })) })
  check('healthy: no steps', a.steps.length === 0, a.steps.map((s) => s.id).join(','))
  check('healthy: headline says nothing needs fixing', /Nothing needs fixing/.test(a.headline), a.headline)
  check('healthy: lists what is right', a.right.length >= 5, a.right.join(' | '))
}

// ── Not connected: only what MVP can see ────────────────────────────────────
{
  const f = alejandro()
  const a = auditSite({ ...f, gsc: 'none', property: null, gscSitemaps: null, posts: f.posts.map((p) => ({ ...p, indexed: null, coverage: null })) })
  const ids = a.steps.map((s) => s.id)
  check('not connected: connect step', ids.includes('connect-gsc'))
  check('not connected: no Google based steps', !ids.some((x) => ['discovered', 'unknown', 'nudge', 'pace', 'crawled'].includes(x)), ids.join(','))
  check('not connected: still finds the broken post', ids.includes('gone'))
}

// ── Site blocks Google, host refuses MVP ────────────────────────────────────
{
  const f = alejandro()
  const a = auditSite({ ...f, home: { ...f.home!, noindex: true }, live: f.live.map((l, i) => (i < 5 ? { ...l, status: 429 } : l)), blocked: true })
  check('noindex on the site is the top step', a.steps[0]?.id === 'noindex-site', a.steps.map((s) => s.id).join(','))
  check('refused checks are not called broken posts', (a.steps.find((s) => s.id === 'gone')?.posts?.length ?? 0) === 1)
  check('refused checks are said out loud', a.unchecked.some((u) => /refused/.test(u)))
  const r = auditSite({ ...f, robots: { found: true, blocksAll: true } })
  check('robots.txt blocking all is caught', r.steps[0]?.id === 'noindex-site' && /robots/.test(r.steps[0].why))
}

// ── A host robot check (SiteGround's captcha) ───────────────────────────────
{
  const f = alejandro()
  const a = auditSite({ ...f, home: { status: 429, ms: 200, title: null, noindex: false }, robots: null, live: f.live.map((l) => ({ ...l, status: 429, noindex: false })), blocked: true, challenged: true })
  check('robot check: never "your site blocks Google"', !a.steps.some((s) => s.id === 'noindex-site' || s.id === 'site-down'), a.steps.map((s) => s.id).join(','))
  check('robot check: said in plain words', a.unchecked.some((u) => /robot check/.test(u)))
  check('robot check: Google based steps still come', a.steps.some((s) => s.id === 'discovered') && a.steps.some((s) => s.id === 'nudge'))
  check('robot check: no broken posts claimed', !a.steps.some((s) => s.id === 'gone'))
}
const sitemapLib = readFileSync('lib/sitemap.ts', 'utf8')
check('a robot check page is not read as a sitemap', /urlset\|sitemapindex/.test(sitemapLib))

// ── Sitemap not handed to Google ────────────────────────────────────────────
{
  const a = auditSite({ ...alejandro(), gscSitemaps: [] })
  const s = a.steps.find((x) => x.id === 'submit-sitemap')
  check('unsubmitted sitemap is a step with the exact address', !!s && s.doThis.some((d) => /sitemap_index\.xml/.test(d)) && /sitemaps\?resource_id=/.test(s.href || ''))
  check('unknown posts point at the sitemap step', !!a.steps.find((x) => x.id === 'unknown')?.doThis[0].includes('Submitting your sitemap'))
  const none = auditSite({ ...alejandro(), sitemap: { found: false, urls: 0, address: null } })
  check('no sitemap found is a step', none.steps.some((x) => x.id === 'no-sitemap'))
  const old = auditSite({ ...alejandro(), gscSitemaps: [{ path: 'x', lastDownloaded: day(45), errors: 0 }] })
  check('a sitemap Google stopped reading is a step', old.steps.some((x) => x.id === 'sitemap-stale'))
}

// ── Moved addresses, noindex posts, a fresh drop ────────────────────────────
{
  const f = alejandro()
  const live = f.live.map((l, i) => (i === 0 ? { ...l, finalUrl: 'https://reviewcentralhub.com/new-address/' } : i === 1 ? { ...l, noindex: true } : l))
  const posts = f.posts.map((p, i) => (i === 2 ? { ...p, droppedAt: day(2) } : p))
  const a = auditSite({ ...f, live, posts })
  check('a moved post offers Refresh post addresses', a.steps.find((s) => s.id === 'moved')?.action === 'refresh-urls')
  check('a noindex post is a step', a.steps.some((s) => s.id === 'post-noindex'))
  check('a post that fell out this week is a step', a.steps.some((s) => s.id === 'dropped'))
  const slash = auditSite({ ...f, live: f.live.map((l) => ({ ...l, finalUrl: `${l.finalUrl}/` })) })
  check('a trailing slash is not a move', !slash.steps.some((s) => s.id === 'moved'))
}

// ── The pieces ──────────────────────────────────────────────────────────────
check('coverage: discovered', coverageKind('Discovered - currently not indexed') === 'discovered')
check('coverage: crawled', coverageKind('Crawled - currently not indexed') === 'crawled')
check('coverage: unknown', coverageKind('URL is unknown to Google') === 'unknown')
check('coverage: indexed', coverageKind('Submitted and indexed') === 'indexed' && coverageKind('Indexed, confirmed by Search Console impressions') === 'indexed')
check('coverage: noindex', coverageKind("Excluded by 'noindex' tag") === 'noindex')
check('title twice', !!homeTitleProblem('Alex Media Creations - Alex Media Creations'))
check('title default', !!homeTitleProblem('My Blog | Just another WordPress site'))
check('title fine', homeTitleProblem('Review Central | Honest product reviews') === null)
check('pace sees a quiet spell', paceOf(['2024-12-01', '2026-05-01', '2026-05-02'], NOW).quietDays > 500)
const picks = indexPicks([post(1, 'URL is unknown to Google', 'not_indexed'), post(2, 'Discovered - currently not indexed', 'not_indexed'), post(3, 'Submitted and indexed', 'indexed')], 2)
check('ask Google for discovered first', picks[0]?.endsWith('post-2') && picks.length === 2 && !picks.some((u) => u.endsWith('post-3')))
check('no links without a post Google shows', linkPairs([post(1, null, 'not_indexed')], [post(1, null, 'not_indexed')]).length === 0)

// ── Wired in ────────────────────────────────────────────────────────────────
check('the route exists', existsSync('app/api/seo/audit/route.ts'))
const route = existsSync('app/api/seo/audit/route.ts') ? readFileSync('app/api/seo/audit/route.ts', 'utf8') : ''
check('the route uses auditSite', /auditSite\(/.test(route))
check('the route saves the audit and survives a missing column', /seo_audit/.test(route) && /catch/.test(route))
const page = readFileSync('app/(dashboard)/seo/page.tsx', 'utf8')
check('the SEO page leads with the audit', /<SiteAudit/.test(page))
check('the rest of the page folds away', /Every SEO tool/.test(page))

if (fails.length) { console.error('seo-audit failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ seo-audit: one button, a short list in order, honest about what it could not check')
