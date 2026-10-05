// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE MENU IS GROUPED BY JOB, AND NOTHING FELL OUT OF IT.
//
// Seb approved the mockup 2026-10-05: sections by job (Find products, Make
// videos, Blog, Share, Work with brands, Your setup, Help), sibling pages
// folded into one row with a tab bar, plain names. This checks that every page
// the old menu linked is still one click away (a row or a tab), that the gates
// moved with their pages, that the Amazon plan's menu holds what the plan
// includes and lists the rest once under More with Pro, and that search still
// finds a page by the name members knew it by.
//
// Run: npx tsx scripts/test-nav-by-job.ts
import { readFileSync } from 'node:fs'
import { searchApp } from '../lib/app-search-index'

const failures: string[] = []
const check = (name: string, ok: boolean, detail?: string) => { if (!ok) failures.push(detail ? `${name}: ${detail}` : name) }
const S = readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')
const nav = S.slice(S.indexOf('const NAV_GROUPS: NavGroupDef[] = ['), S.indexOf('const AMAZON_LOCKED_PREFIXES'))

// ── sections, in order ──────────────────────────────────────────────────────
const SECTIONS = ['Find products', 'Make videos', 'Blog', 'Share', 'Work with brands', 'Your setup', 'Labs', 'Help']
const at = SECTIONS.map((l) => nav.indexOf(`label: '${l}',`))
check('every section is in the menu', at.every((i) => i > 0), SECTIONS.filter((_, i) => at[i] < 0).join(', '))
check('in job order', at.every((v, i) => i === 0 || v > at[i - 1]))
for (const old of ['Set up', 'Create', 'Research', 'Grow', 'Collaborate', 'Help & Community', 'Account', 'Amazon Influencer']) {
  check(`the old "${old}" section is gone`, !nav.includes(`label: '${old}',`))
}

// ── every page the old menu linked is still a row or a tab ──────────────────
const OLD_MENU = [
  '/dashboard', '/tutorials', '/setup', '/connect-youtube', '/brand', '/learn', '/customize', '/photobooth', '/connect-socials',
  '/meta', '/external-integrations', '/ads', '/social-launch-kit', '/liftoff', '/co-pilot', '/encore', '/first-comments',
  '/content', '/content?tab=posts', '/clip-factory', '/link-in-bio', '/comparison', '/buying-guides', '/articles', '/idea-lists',
  '/ltk', '/deals', '/ended-deals', '/script', '/amazon/thumbnails', '/amazon/research', '/amazon/social', '/amazon-live',
  '/live-followup', '/amz-finder', '/deal-radar', '/cc-campaigns', '/joined-campaigns', '/epc-library', '/saved-campaigns',
  '/levanta', '/partnerboost', '/wayward', '/passport', '/seo', '/pulse', '/brand-hub', '/collaborations', '/brand-inquiries',
  '/brand-recap', '/agency', '/assistant', '/support', '/community', '/billing', '/usage',
]
const missing = OLD_MENU.filter((h) => !nav.includes(`'${h}'`))
check('every page from the old menu is still reachable from it', missing.length === 0, missing.join(', '))

// ── gates moved with their pages ────────────────────────────────────────────
const row = (href: string) => (nav.match(new RegExp(`href: '${href.replace(/[/?]/g, (c) => `\\${c}`)}'[^\\n]*`)) ?? [''])[0]
// Since 2026-10-05 (Seb: the Amazon plan gets all six additions) these are
// Pro and Amazon, through lib/amazon-plan and the labs-preview switch list.
check('Bulk Amazon upload is Pro and Amazon', /label: 'Bulk Amazon upload', gate: hasVideoTools\(effectiveTier\)[^\n]*onAmazon: 'included'/.test(row('/liftoff')))
check('Clip Factory is Pro and Amazon', /gate: hasVideoTools\(effectiveTier\), onAmazon: 'included'/.test(row('/clip-factory')))
check('YouTube Co-Pilot is in the Amazon plan', /label: 'YouTube Co-Pilot', onAmazon: 'included'/.test(row('/co-pilot')))
check('Hashtag insights is Pro', /label: 'Hashtag insights', gate: isPro/.test(row('/pulse')))
check('Pinned comments keeps its switch', /label: 'Pinned comments', gate: canUsePreview\('first_comment', effectiveTier\)/.test(nav))
check('On sale comments keeps its switch', /label: 'On sale comments', gate: canUsePreview\('on_sale', effectiveTier\)/.test(nav))
check('Follow-up keeps its switch', /href: '\/live-followup'[^\n]*gate: canUsePreview\('live_followup', effectiveTier\)/.test(nav))
check('Recap keeps its switch', /href: '\/brand-recap'[^\n]*gate: previewOpenToPro\('brand_recap'\) \? isPro : isAdmin/.test(nav))
check('Buying guides keeps its gate', /href: '\/buying-guides'[^\n]*gate: showBuyingGuidesEff/.test(nav))
check('Blog design still hides for content-only sites', /label: 'Blog design', gate: !contentOnly/.test(nav))
check('Labs stays admin only', (() => {
  const labs = nav.slice(nav.indexOf("label: 'Labs',"), nav.indexOf("label: 'Help',"))
  const rows = labs.match(/href: '[^']+'[^\n]*/g) ?? []
  return rows.length > 0 && rows.every((r) => /gate: isAdmin/.test(r))
})())
check('a merged row is shown only when one of its tabs is open to this account',
  /gate: canUsePreview\('first_comment', effectiveTier\) \|\| canUsePreview\('on_sale', effectiveTier\)/.test(nav))

// ── merged rows light up and wear their tab bar ─────────────────────────────
check('a merged row is lit on any of its tabs', /const itemActive = useCallback\([\s\S]{0,200}\(item\.tabs \?\? \[\]\)\.some\(\(t\) => t\.gate !== false && isActive\(t\.href\)\)/.test(S))
check('the sidebar uses it', /active=\{itemActive\(item\)\}/.test(S) && /visibleItems\.some\(\(it\) => itemActive\(it\)\)/.test(S))
check('the tab bar is drawn above the page, never over the upgrade panel',
  /\{!amazonLocked && tabbedItem && <SectionTabs item=\{tabbedItem\} isActive=\{isActive\} \/>\}/.test(S))
check('the tab bar shows only the tabs this account can open', /const tabs = \(item\.tabs \?\? \[\]\)\.filter\(\(t\) => t\.gate !== false\)/.test(S))
check('a route lights only its own row, not every row it is a prefix of (/brand vs /brand-hub)',
  /return pathname === href \|\| pathname\.startsWith\(`\$\{href\}\/`\)/.test(S))
check('a star placed on a page that is now a tab still shows, as its row',
  /for \(const h of \[it\.href, \.\.\.\(it\.tabs \?\? \[\]\)/.test(S))

// ── the Amazon plan ─────────────────────────────────────────────────────────
const AMAZON_INCLUDED = ['/dashboard', '/amazon/thumbnails', '/amazon/social', '/social-launch-kit', '/link-in-bio', '/collaborations',
  '/brand-inquiries', '/brand', '/photobooth', '/billing', '/assistant', '/tutorials', '/passport',
  '/co-pilot', '/clip-factory', '/first-comments', '/amazon-live']
for (const h of AMAZON_INCLUDED) check(`Amazon plan keeps ${h} in its section`, /onAmazon: 'included'/.test(row(h)) || new RegExp(`href: '${h.replace(/\//g, '\\/')}'[\\s\\S]{0,160}onAmazon: 'included'`).test(nav))
check('Amazon plan opens Product research on its own research page',
  /href: amazonView \? '\/amazon\/research' : '\/amz-finder'[^\n]*onAmazon: 'included'/.test(nav))
check('the finders inside Product research are not listed twice', /href: '\/deal-radar'[^\n]*onAmazon: 'inside'/.test(nav) && /href: '\/cc-campaigns'[^\n]*onAmazon: 'inside'/.test(nav))
check('everything else is listed once, under More with Pro, above Labs and Admin',
  /if \(!it\.onAmazon && it\.gate !== false\) more\.push\(it\)/.test(S) && /return \[\.\.\.jobs, \{ label: 'More with Pro', items: more \}, \.\.\.staff\]/.test(S))
check('the Amazon plan never sees the Writing voice tab it cannot open', /href: '\/learn', icon: null, label: 'Writing voice', gate: !amazonView/.test(nav))

// ── search finds the old names ──────────────────────────────────────────────
const OLD_NAMES: Array<[string, string]> = [
  ['liftoff', '/liftoff'], ['encore', '/encore'], ['pulse', '/pulse'], ['social influencer', '/amazon/social'],
  ['brand deals', '/collaborations'], ['epc library', '/epc-library'], ['cc campaigns', '/cc-campaigns'], ['virtual assistant', '/agency'],
  ['help desk', '/assistant'], ['customize blog', '/customize'], ['voice training', '/learn'], ['blog post generator', '/content'],
  ['thumbnail generator', '/amazon/thumbnails'], ['brand hub', '/brand-hub'], ['amz research', '/amz-finder'],
]
for (const [q, href] of OLD_NAMES) {
  const hit = searchApp(q, { limit: 8 }).some((e) => e.href === href)
  check(`searching "${q}" finds ${href}`, hit)
}

// ── the page titles follow the new names ────────────────────────────────────
const CONTENT = readFileSync('app/(dashboard)/content/page.tsx', 'utf8')
check('the /content title follows its tab (Social Push on the published and scheduled tabs)',
  /const isSocialTab = activeTab === 'posts' \|\| activeTab === 'scheduled'/.test(CONTENT) && /title=\{isSocialTab \? 'Social Push' : 'Blog posts'\}/.test(CONTENT))
check('Social Push stays lit on its scheduled queue', /label: 'Social Push', alsoActiveOn: \['\/content\?tab=scheduled'\]/.test(nav)
  && /return tab !== 'posts' && tab !== 'scheduled'/.test(S))
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')
for (const p of ['app/pricing/page.tsx', 'app/page.tsx', 'components/tour/tour-content.tsx', 'components/landing/AdPricingTable.tsx', 'components/HelpDeskSidebar.tsx', 'components/guide/tool-guides.tsx']) {
  const hit = stripComments(readFileSync(p, 'utf8')).match(/[^\n]*(Help Desk|Virtual Assistant|virtual assistant)[^\n]*/)
  check(`${p} uses the new names (Ask MVP, Team)`, !hit, hit?.[0].trim().slice(0, 120))
}

// ── copy ────────────────────────────────────────────────────────────────────
const labels = Array.from(nav.matchAll(/label: '([^']*)'/g)).map((m) => m[1])
check('no dash punctuation in menu names', labels.every((l) => !/[—–]| - /.test(l)), labels.filter((l) => /[—–]| - /.test(l)).join(', '))

if (failures.length) {
  console.error(`\n❌ nav-by-job: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✓ nav-by-job: sections by job, every old page still a row or a tab, gates moved with them, Amazon sees its plan plus one More with Pro list, search knows the old names')
