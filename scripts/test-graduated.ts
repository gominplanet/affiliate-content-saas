// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Pinned Comments, Ended Deals, Brand Recap and Amazon Live Prep left Labs
// (September): open to Pro, in their own menu sections, each with a guide,
// and no "still being tested" answer left for a Pro user to meet.
import { readFileSync } from 'node:fs'
import { canUsePreview, previewOpenToPro } from '../lib/labs-preview'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }

const FEATURES = ['first_comment', 'deal_aftercare', 'brand_recap', 'amazon_live'] as const
for (const f of FEATURES) {
  check(`${f} is open to Pro`, previewOpenToPro(f) && canUsePreview(f, 'pro') && canUsePreview(f, 'admin'))
}
const NAV = read('components/layout/DashboardShellV2.tsx')
const labsAt = NAV.indexOf("label: 'Labs',")
const labsEnd = NAV.indexOf("label: 'Help & Community'")
const labs = NAV.slice(labsAt, labsEnd)
for (const href of ['/first-comments', '/ended-deals', '/brand-recap', '/amazon-live']) {
  const at = NAV.indexOf(`href: '${href}'`)
  check(`${href} is in the menu, outside Labs`, at > 0 && !labs.includes(`href: '${href}'`))
}
check('First comments is called Pinned Comments', /label: 'Pinned Comments'/.test(NAV) && !/label: 'First comments'/.test(NAV))
const pages: Array<[string, string]> = [
  ['components/first-comments/OlderVideos.tsx', 'PinnedCommentsGuide'],
  ['components/deal/EndedDeals.tsx', 'EndedDealsGuide'],
  ['components/brand-recap/BrandRecap.tsx', 'BrandRecapGuide'],
  ['components/labs/AmazonLive.tsx', 'AmazonLiveGuide'],
]
for (const [f, g] of pages) check(`${f} shows its how-to guide`, new RegExp(`guide=\\{<${g} />\\}`).test(read(f)))
const G = read('components/guide/tool-guides.tsx')
for (const [, g] of pages) {
  const body = G.slice(G.indexOf(`export function ${g}`), G.indexOf(`export function ${g}`) + 6000)
  check(`${g} exists and has no em or en dash`, G.includes(`export function ${g}`) && !/[—–]/.test(body.slice(0, body.indexOf('\n}\n') > 0 ? body.indexOf('\n}\n') : body.length)))
}
for (const f of ['app/api/deal-aftercare/route.ts', 'app/api/brand-recap/route.ts', 'app/api/brand-recap/log/route.ts', 'app/api/brand-recap/amazon-videos/route.ts',
  'app/api/youtube/first-comment/route.ts', 'app/api/youtube/first-comment/videos/route.ts', 'app/api/youtube/first-comment/[id]/route.ts',
  'app/api/live/plan/route.ts', 'app/api/live/products/route.ts', 'app/api/live/plans/route.ts', 'app/api/live/plans/[id]/route.ts']) {
  check(`${f} no longer says it is being tested`, !/still being tested|Labs testing|Not open yet/.test(read(f)))
}
const E = read('components/deal/EndedDeals.tsx')
check('Ended Deals Refresh shows it is working and says what it found', /\{refreshing \? 'Refreshing…' : 'Refresh'\}/.test(E) && /toast\.success\(`Up to date:/.test(E) && /Updated \{loadedAt/.test(E))
check('Make all cannot be started twice', /if \(convertingAll\) return/.test(E))
check('the price-check count is the server\'s own rule', /p\.needsCheck \?\? p\.state === 'unknown'/.test(E) && /p\.needsCheck = needsPriceCheck\(p\)/.test(read('lib/deal-aftercare-server.ts')))

{
  const C = read('app/api/cron/deal-aftercare/route.ts'), A = read('app/api/deal-aftercare/route.ts')
  check('Ended Deals automatic is opt-in: only the owner or a creator who switched it on',
    /\.or\('tier\.eq\.admin,deal_aftercare_auto_chosen_at\.not\.is\.null'\)/.test(C) && /eq\('tier', 'admin'\)\.limit\(50\)/.test(C)
    && /deal_aftercare_auto_chosen_at: new Date\(\)\.toISOString\(\)/.test(A) && /\(g\.isAdmin \|\| !!a\.data\?\.deal_aftercare_auto_chosen_at\)/.test(A)
    && /set default false/.test(read('supabase/migrations/386_deal_aftercare_opt_in.sql')))
}

if (failures.length) {
  console.error(`\n❌ graduated: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ graduated: Pinned Comments, Ended Deals, Brand Recap and Amazon Live Prep are out of Labs, each with its guide')
