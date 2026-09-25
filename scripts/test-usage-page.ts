// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Guards for the Your usage page (/usage).
//
// THE PAGE MUST SAY WHAT THE GATES DO. A usage page that counts its own way
// can show "3 left" while the gate says no, which is worse than no page. So:
// the monthly numbers come only from /api/usage/summary (the same counts the
// caps enforce), the daily numbers use the gates' own constants, a count that
// failed is never shown as zero, and AI spend never appears on screen.

import { readFileSync } from 'node:fs'
import { SALE_COMMENTS_PER_DAY, INDEX_NUDGES_PER_DAY } from '../lib/daily-limits'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')

const PAGE = read('components/usage/YourUsage.tsx')
const DAILY = read('app/api/usage/daily/route.ts')
const INDEX = read('app/api/seo/request-index/route.ts')
const COMMENT = read('app/api/on-sale/comment/route.ts')

check('monthly numbers come from the summary the caps use, and only from it',
  /fetch\('\/api\/usage\/summary'\)/.test(PAGE) && !/from\('ai_usage'\)|from\('blog_posts'\)/.test(PAGE))
check('the daily limits are the gates\' own numbers',
  SALE_COMMENTS_PER_DAY === 20 && INDEX_NUDGES_PER_DAY === 2
  && /const PER_USER_DAILY_CAP = INDEX_NUDGES_PER_DAY/.test(INDEX)
  && /SALE_COMMENTS_PER_DAY/.test(COMMENT)
  && /SALE_COMMENTS_PER_DAY, INDEX_NUDGES_PER_DAY \} from '@\/lib\/daily-limits'/.test(DAILY))
check('the daily counts use the same tables and 24 hour window as the gates',
  /recent\('sale_comments', 'posted_at'\)/.test(DAILY) && /recent\('indexing_submissions', 'created_at'\)/.test(DAILY)
  && /Date\.now\(\) - 86_400_000/.test(DAILY) && /canUsePreview\('on_sale', intg\?\.tier\)/.test(DAILY))
check('a count that failed is left out, never shown as zero used',
  /if \(error\) return null/.test(DAILY) && (DAILY.match(/if \(t\) buckets\.push/g) ?? []).length === 2
  && /no numbers are shown rather than wrong ones/.test(PAGE))
// The code and the words on screen, without comments (which explain the rule).
const PAGE_CODE = PAGE.replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
check('no AI spend or cost on the page',
  !/usage\/spend|spent|ceiling|\$\{?cost|AI cost/i.test(PAGE_CODE))
check('the admin preview is said to be a preview',
  /summary\?\.tier === 'admin'/.test(PAGE) && /sample numbers/.test(PAGE))
check('warnings at 80% and at the limit',
  /used \/ limit >= 0\.8 \? 'close'/.test(PAGE) && /used >= limit \? 'out'/.test(PAGE))
check('the page is reachable from the nav and from the usage bar',
  (read('components/layout/DashboardShellV2.tsx').match(/href: '\/usage'/g) ?? []).length === 2
  && /href="\/usage"/.test(read('components/layout/UsageBar.tsx')))
check('copy has no dashes as sentence breaks', !/ — | – | - [A-Z]/.test(PAGE_CODE))

if (failures.length) {
  console.error(`\n❌ usage-page: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ usage-page: the page shows the gates\' own numbers, hides failed counts and AI spend, and warns at 80%')
