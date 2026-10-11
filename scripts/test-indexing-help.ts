// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Getting posts into Google (Seb, 2026-10-11): every reason Google gives has an
// action, archive noindex is explained as deliberate, a POST with noindex is
// urgent, and the Request indexing list only offers posts worth asking about.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { reasonGuide, requestQueue, inspectLink, REPORT_GUIDE, REQUESTS_PER_DAY } from '../lib/indexing-help'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

check('a POST excluded by noindex is urgent, never "nothing to do"', reasonGuide("Excluded by 'noindex' tag").severity === 'urgent')
check('it says where to look (Discourage search engines, SEO plugin)', /Discourage search engines/.test(reasonGuide("Excluded by 'noindex' tag").todo))
check('a 404 points at Fix 404s', reasonGuide('Not found (404)').tool?.href === '/tools/redirects')
check('a duplicate points at Duplicates', reasonGuide('Duplicate without user-selected canonical').tool?.href === '/tools/duplicates')
check('crawled and discovered say what helps, and that Validate does not', reasonGuide('Crawled - currently not indexed').validate === false && reasonGuide('Discovered - currently not indexed').validate === false && /Request indexing/.test(reasonGuide('Discovered - currently not indexed').todo))
check('an unknown reason still gives an action, never a blank', !!reasonGuide('Something new from Google').todo)
const noindexReport = REPORT_GUIDE.find((r) => /noindex/i.test(r.report))
check('the "Validation failed" decoder explains archive noindex as deliberate', !!noindexReport && /on purpose/.test(noindexReport.yours) && /Do not press Validate/.test(noindexReport.validate))

const now = Date.parse('2026-10-11T12:00:00Z')
const posts = [
  { url: 'https://b.com/a', title: 'A', indexed: false, coverageState: 'Discovered - currently not indexed', publishedAt: '2026-10-01' },
  { url: 'https://b.com/b', title: 'B', indexed: false, coverageState: 'Crawled - currently not indexed', publishedAt: '2026-10-05' },
  { url: 'https://b.com/c', title: 'C', indexed: false, coverageState: 'Not found (404)' },
  { url: 'https://b.com/d', title: 'D', indexed: true, coverageState: 'Submitted and indexed' },
  { url: 'https://b.com/e', title: 'E', indexed: false, coverageState: 'Discovered - currently not indexed', publishedAt: '2026-10-09' },
  { url: null, title: 'F', indexed: false, coverageState: 'Discovered - currently not indexed' },
]
const q = requestQueue(posts, {}, now)
check('the request list leaves out indexed posts, posts with no address, and 404s (fix first)', q.every((p) => p.indexed === false && !!p.url && !/404/.test(p.coverageState || '')))
check('never-visited posts come first, newest first', q[0]?.url === 'https://b.com/e' && q[1]?.url === 'https://b.com/a' && q[2]?.url === 'https://b.com/b', q.map((p) => p.url).join(','))
const asked = requestQueue(posts, { 'https://b.com/e': '2026-10-10T12:00:00Z' }, now)
check('a post asked about this week is not offered again', !asked.some((p) => p.url === 'https://b.com/e'))
check('the list is capped at Google\'s daily allowance', requestQueue(Array.from({ length: 30 }, (_, i) => ({ url: `https://b.com/${i}`, title: String(i), indexed: false, coverageState: 'Discovered - currently not indexed' })), {}, now).length === REQUESTS_PER_DAY)
check('Request indexing opens that post in Search Console\'s URL inspection', inspectLink('sc-domain:gominreviews.com', 'https://gominreviews.com/x/') === 'https://search.google.com/search-console/inspect?resource_id=sc-domain:gominreviews.com&id=https%3A%2F%2Fgominreviews.com%2Fx%2F')

const ov = read('app/api/seo/overview/route.ts')
check('the overview no longer files a noindexed POST as benign', /"excluded by 'noindex' tag":\s*\{ label: 'Post set to noindex',\s*fixable: 'urgent' \}/.test(ov))
const sm = read('app/api/seo/sitemap-status/route.ts')
check('sitemap status is read from Search Console, and a failure is said', /webmasters\/v3\/sites\//.test(sm) && /cannot say whether your sitemap is submitted/.test(sm))
const page = read('app/(dashboard)/seo/page.tsx')
check('the SEO page shows the indexing help when Search Console is connected', /<IndexingHelp/.test(page))

if (failed) { console.error(`\n${failed} indexing check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
