// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What each post needs (Seb, 2026-10-11): every post in one stage with a
// reason and next steps; a social push only where it helps and the post is not
// shared yet; links added from posts Google already shows, never twice; a
// straight backlink answer from the blog's numbers; and none of it pointing at
// Google's Indexing API, which Google limits to job posts and livestreams.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { laneFor, diagnose, buildBoard, backlinkVerdict, type DoctorPost } from '../lib/post-doctor'
import { addLinkToPost, linkedAddresses, bareUrl } from '../lib/internal-links'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const now = Date.parse('2026-10-11T12:00:00Z')
const old = '2026-08-01T00:00:00Z'
const base: DoctorPost = { postId: 'p', title: 'Ninja Air Fryer Review', url: 'https://b.com/ninja-air-fryer/', publishedAt: old, indexed: true, coverageState: null, clicks: 0, impressions: 0, position: null, ctr: null, shared: [], linkedFrom: [], linkSources: [{ postId: 's', title: 'Best Air Fryers' }] }
const P = (o: Partial<DoctorPost>): DoctorPost => ({ ...base, ...o })

// Stages
check('a POST set to noindex is "Fix first"', laneFor(P({ indexed: false, coverageState: "Excluded by 'noindex' tag" }), now) === 'blocked')
check('a 404 is "Fix first" and points at Fix 404s', diagnose(P({ indexed: false, coverageState: 'Not found (404)' }), now).steps[0].href === '/tools/redirects')
check('discovered, not indexed: Google has not read it', laneFor(P({ indexed: false, coverageState: 'Discovered - currently not indexed' }), now) === 'unseen')
check('crawled, not indexed: Google read it and passed', laneFor(P({ indexed: false, coverageState: 'Crawled - currently not indexed' }), now) === 'passed')
check('a post from yesterday is new, whatever Google says yet', laneFor(P({ indexed: false, coverageState: 'URL is unknown to Google', publishedAt: '2026-10-10T00:00:00Z' }), now) === 'fresh')
check('position 12 with views is "Almost on page one"', laneFor(P({ position: 12, impressions: 80, clicks: 1 }), now) === 'close')
check('seen often at position 4, clicked under 1.5%: the title is the fix', laneFor(P({ position: 4, impressions: 400, clicks: 2, ctr: 0.005 }), now) === 'unclicked' && diagnose(P({ position: 4, impressions: 400, clicks: 2, ctr: 0.005 }), now).steps.some((s) => s.kind === 'title'))
check('indexed for months with almost no views: buried', laneFor(P({ impressions: 5 }), now) === 'buried')
check('clicks from Google: working', laneFor(P({ impressions: 300, clicks: 12, position: 5, ctr: 0.04 }), now) === 'working')
check('not checked by Google yet: waiting, nothing to do', laneFor(P({ indexed: null }), now) === 'waiting')

// Steps and their order
const unseen = diagnose(P({ indexed: false, coverageState: 'Discovered - currently not indexed', inSitemap: false }), now)
check('unseen: sitemap first, then a link, then Request indexing, then share', unseen.steps.map((s) => s.kind).join(',') === 'sitemap,link,request,share', unseen.steps.map((s) => s.kind).join(','))
check('an orphan is named as one', /None of your other posts link here/.test(unseen.steps.find((s) => s.kind === 'link')?.text || ''))
const passed = diagnose(P({ indexed: false, coverageState: 'Crawled - currently not indexed' }), now)
check('passed over: improve the post before asking Google again', passed.steps[0].kind === 'improve' && passed.steps.findIndex((s) => s.kind === 'request') > 0)
check('a shared post is never told to share', !diagnose(P({ impressions: 5, shared: ['pinterest'] }), now).steps.some((s) => s.kind === 'share'))
check('an Instagram post does not count as a path in (no clickable link)', diagnose(P({ impressions: 5, shared: ['instagram'] }), now).steps.some((s) => s.kind === 'share'))
check('a page-two post is told to ask the brand for a link', diagnose(P({ position: 12, impressions: 80 }), now).steps.some((s) => s.kind === 'brand'))
check('with three links already, no link step', !diagnose(P({ indexed: false, coverageState: 'Discovered - currently not indexed', linkedFrom: ['a', 'b', 'c'] }), now).steps.some((s) => s.kind === 'link'))
check('a guessed address is fixed before anything else', diagnose(P({ urlGuessed: true, indexed: false, coverageState: 'URL is unknown to Google' }), now).steps[0].kind === 'address')
check('every stage gives a reason in words', ['blocked', 'unseen', 'passed', 'fresh', 'close', 'unclicked', 'buried', 'working', 'waiting'].every((l) => {
  const sample: Record<string, Partial<DoctorPost>> = {
    blocked: { indexed: false, coverageState: 'Soft 404' }, unseen: { indexed: false, coverageState: 'Discovered - currently not indexed' },
    passed: { indexed: false, coverageState: 'Crawled - currently not indexed' }, fresh: { indexed: null, publishedAt: '2026-10-10T00:00:00Z' },
    close: { position: 14, impressions: 60 }, unclicked: { position: 3, impressions: 500, ctr: 0.004 }, buried: { impressions: 2 },
    working: { clicks: 9, impressions: 200, position: 4, ctr: 0.05 }, waiting: { indexed: null },
  }
  const d = diagnose(P(sample[l]), now)
  return d.lane === l && d.why.length > 20 && d.steps.length > 0
}))

// Board and backlinks
const board = buildBoard([
  P({ postId: 'a', position: 12, impressions: 80 }),
  P({ postId: 'b', indexed: false, coverageState: 'Discovered - currently not indexed' }),
  P({ postId: 'c', impressions: 300, clicks: 12, position: 5, ctr: 0.04, shared: ['facebook'] }),
], now)
check('stages come in working order, Fix first before the rest', board.lanes.map((l) => l.info.id).join(',') === 'close,unseen,working')
check('Share these first: page-two first, never a shared post', board.shareFirst[0].postId === 'a' && !board.shareFirst.some((p) => p.postId === 'c'))
const notYet = backlinkVerdict(buildBoard([1, 2, 3].map((i) => P({ postId: `n${i}`, indexed: false, coverageState: 'Crawled - currently not indexed' })), now))
check('mostly not in Google: backlinks are not the first job', notYet.need === 'not_yet')
const yes = backlinkVerdict(buildBoard([1, 2, 3].map((i) => P({ postId: `y${i}`, impressions: 3 })), now))
check('in Google but shown for nothing: yes, backlinks', yes.need === 'yes')

// Linking from another post
const body = '<p>Intro</p><!-- wp:heading --><h2>Frequently Asked Questions</h2><!-- /wp:heading --><p>Q</p>'
const added = addLinkToPost(body, { title: 'Ninja Air Fryer Review', url: 'https://b.com/ninja-air-fryer/' })
check('a link card is added before the FAQ', added.added && added.content.indexOf('gr-ac-card') < added.content.indexOf('Frequently Asked Questions'))
const again = addLinkToPost(added.content, { title: 'Ninja Air Fryer Review', url: 'http://www.b.com/ninja-air-fryer' })
check('never a second link to the same post (http, www, trailing slash ignored)', !again.added && /already links/.test(again.reason || ''))
const grid = addLinkToPost(added.content, { title: 'Other', url: 'https://b.com/other/' })
check('a second target joins the existing block, not a new one', grid.added && (grid.content.match(/gr-also-consider/g) || []).length === 1)
check('linked addresses are read from href, bare', linkedAddresses('<a href="https://www.B.com/x/?utm=1">x</a>').has('b.com/x') && bareUrl('HTTPS://b.com/x/#y') === 'b.com/x')

// Wiring
const page = read('app/(dashboard)/seo/page.tsx')
check('the SEO page shows the board', /<PostBoard/.test(page))
check('no button on the SEO page sends blog posts to Google\'s Indexing API', !/\/api\/seo\/request-index/.test(page) && !/Indexing API/.test(page.replace(/\/\/.*$/gm, '')))
check('Get my blog found does not claim to ping Google, and says when Bing refused', !/pinging Google/.test(page) && /pingError/.test(page))
const ov = read('app/api/seo/overview/route.ts')
check('the overview returns links, shares and link sources per post', /r\.linkedFrom =/.test(ov) && /r\.shared =/.test(ov) && /r\.linkSources =/.test(ov) && /linksCounted/.test(ov))
const route = read('app/api/seo/link-to/route.ts')
check('link-to republishes the post and says when it already linked', /updatePost\(/.test(route) && /added: false/.test(route))
const idx = read('lib/indexnow.ts')
check('IndexNow keeps the host the posts live on (a www site was refused)', !/replace\(\/\^www\\\.\/, ''\)\s*\n\s*const urls/.test(idx) && /hostOf\(urls\[0\]\)/.test(idx))
check('IndexNow sends WordPress\'s own addresses, not slugs glued to the site', /wordpress_url \|\| p\.slug/.test(read('app/api/seo/indexnow/route.ts')))

if (failed) { console.error(`\n${failed} post board check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
