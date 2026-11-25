// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE Free (Seb, 2026-11-19: "the search brand, definitely super important
// to be able to search and request ... Send their automatic message, not
// necessarily AI message", and upload, earnings, the Top 100 and brand
// scripts, "I know it costs AI, but let's see how we can manage that").

import { readFileSync } from 'node:fs'
import { templateRequest, uploadNoteTemplate, freeAllows, freeLeftWords, freeScriptsTitle, freeScriptsLine, monthStartUtc, FREE_TABS, FREE_ACTIONS, FREE_CAPPED, FREE_DAILY_SENDS, FREE_SCRIPTS_MONTHLY, TRYBE_FREE_LIVE, TRYBE_FREE_LANDING, TRYBE_FREE_SIGNUP } from '../lib/trybe-free'
import { trybeAccess } from '../lib/labs-preview'
import { lockAllBut, freeOpenPath, proLockedBody, lockedPageAt } from '../lib/pro-locked-nav'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// 1. Who gets it
// LIVE (Seb, 2026-11-19: "ok go live")
check('live: an account with no plan gets TRYBE Free', (TRYBE_FREE_LIVE as boolean) === true && trybeAccess('trial') === 'free' && trybeAccess(null) === 'free')
check('the legacy Creator and Studio plans get TRYBE Free too (Seb: "give them free trybe too")', trybeAccess('creator') === 'free' && trybeAccess('studio') === 'free')
check('an admin viewing as Free sees TRYBE Free', trybeAccess('trial', { adminPreview: true }) === 'free')
check('Pro keeps all of it, the Amazon plan its preview', trybeAccess('pro') === 'full' && trybeAccess('admin') === 'full' && trybeAccess('amazon') === 'preview' && trybeAccess('amazon', { adminPreview: true }) === 'preview')

// 2. What is open
for (const t of ['find', 'top100', 'queue', 'sent', 'inbox', 'upload', 'create', 'analytics', 'brands', 'submissions', 'week', 'home']) check(`the ${t} tab is open`, FREE_TABS.includes(t))
for (const t of ['stars', 'filmed', 'working', 'changes']) check(`the ${t} tab shows what Pro adds`, !FREE_TABS.includes(t))
for (const a of ['browse', 'adopt', 'draft', 'claim', 'result', 'settings', 'top_board', 'my_stats', 'upload_note', 'video_plan']) check(`${a} is allowed`, freeAllows(a).ok)
for (const a of ['match', 'suggest_reply', 'kickoff', 'followup', 'message_links', 'top100_profile', 'intro_script', 'daily_refresh', 'directory_refresh', 'meta_ads']) check(`${a} is Pro`, !freeAllows(a).ok && !FREE_ACTIONS.has(a))
const no = freeAllows('suggest_reply')
check('a Pro action says what it is and what Free has', !no.ok && /^A reply written in your voice is part of MVP Pro\. TRYBE Free has Find brands, your own requests/.test(no.error))
check('scripts and brief reads are counted a month', FREE_CAPPED.video_plan.feature === 'trybe_video_plan' && FREE_CAPPED.video_plan.monthly === FREE_SCRIPTS_MONTHLY && FREE_CAPPED.brief_read.feature === 'trybe_brief_read')
check('20 requests a day, 3 sets of scripts a month', FREE_DAILY_SENDS === 20 && FREE_SCRIPTS_MONTHLY === 3)
check('the month counts from the 1st, UTC', monthStartUtc(Date.parse('2026-11-19T15:00:00Z')) === '2026-11-01T00:00:00.000Z')
check('what is left is said, and when it is used up', freeLeftWords(2, 3, 'sets of brand scripts') === '2 of 3 free sets of brand scripts left this month.' && /come back on the 1st, or Pro writes as many as you need/.test(freeLeftWords(0, 3, 'sets of brand scripts')))

// 3. Your own message, no AI
check('{brand} becomes the brand', templateRequest('Hi {brand} team!\nI make honest reviews.', 'Oink') === 'Hi Oink team!\nI make honest reviews.')
check('[Brand] and {{brand name}} too', templateRequest('Hello [Brand], I love {{brand name}}.', 'Audien') === 'Hello Audien, I love Audien.')
check('a greeting line gets the brand', templateRequest('Hey there!\n\nI film pet products.', 'Oink') === 'Hey Oink team!\n\nI film pet products.')
check('no greeting gets one on top', templateRequest('I film pet products for TikTok.', 'Oink') === 'Hi Oink team!\n\nI film pet products for TikTok.')
check('the rest is word for word', templateRequest('Hi!\nMy reviews get 50k views.\nThanks,\nSeb', 'X').endsWith('My reviews get 50k views.\nThanks,\nSeb'))
check('an empty message stays empty', templateRequest('   ', 'Oink') === '')
const note = uploadNoteTemplate({ brand: 'Oink', count: 3, products: ['Vest'] })
check('the upload note names the videos and asks if anything should change', note === 'Hi Oink team! I just submitted 3 new videos for Vest on TRYBE. Let me know if you would like anything changed. Thank you!' && !/[–—]/.test(note))

// 4. The server enforces it
const R = read('app/api/labs/trybe/route.ts')
check('the free gate runs before any action, and counts AI before it is spent', /if \(g\.access === 'free'\) \{\n    const v = freeAllows\(action\)/.test(R) && /const left = await freeLeft\(admin, userId, capped\.feature, capped\.monthly\)/.test(R) && /if \(left === null\) return NextResponse\.json\(\{ error: `MVP could not count your free/.test(R))
check('a free request is the creator’s own message, written before any AI or spend', R.indexOf("if (g.access === 'free' || body.template === true) {") > 0 && R.indexOf("if (g.access === 'free' || body.template === true) {") > R.indexOf("if (action === 'draft') {") && R.indexOf("if (g.access === 'free' || body.template === true) {") < R.indexOf('const spend = await spendGate(userId, tier)', R.indexOf("if (action === 'draft') {")) && /let text = templateRequest\(settings\.coreMessage, String\(r\.name \|\| ''\)\)/.test(R))
check('a free send is capped at the free number a day', /const settings = g\.access === 'free' \? \{ \.\.\.base, dailyCap: FREE_DAILY_SENDS \} : base/.test(R) && /dailyCap: FREE_DAILY_SENDS \} : s\)\)/.test(R))
check('the free upload note is the template', /if \(g\.access === 'free'\) return NextResponse\.json\(\{ ok: true, text: uploadNoteTemplate/.test(R))
check('samples and alerts are open to Free', /trybeAccess\(intg\?\.tier\) !== 'free'/.test(read('app/api/labs/trybe/samples/route.ts')) && /trybeAccess\(intg\?\.tier\) !== 'free'/.test(read('app/api/labs/trybe/alerts/route.ts')))

// 5. The page mirrors it
const O = read('components/labs/TrybeOutreach.tsx')
check('a Pro tab opens as what Pro adds, with a lock in the menu', /\(free && !FREE_TABS\.includes\(t\)\)/.test(O) && /locked=\{free \? proOnly : undefined\}/.test(O) && /\{locked\?\.\(firstOf\(it\)\) && <Lock/.test(read('components/labs/TrybeNav.tsx')))
check('no daily find and no fit check on Free', /if \(preview \|\| free \|\| loading/.test(O) && /if \(free\) return \{ fit, no, failed \}/.test(O) && /\{!preview && !free && \(\n          <TrybeDailyBrands/.test(O))
check('the banner says what Free has and what Pro adds', /<p className="text-\[15px\] font-bold">TRYBE Free<\/p>/.test(O) && /href="\/billing\?plan=pro"/.test(O))
check('the inbox answers by hand on Free', /free=\{free\} \/>\}/.test(O) && /\{!free && <TrybeBrandLinks/.test(read('components/labs/TrybeInbox.tsx')) && /Suggested replies are on Pro/.test(read('components/labs/TrybeInbox.tsx')))
// Seb, 2026-11-25: "we need to make sure free users understand that 3
// scripts a month is included and only 3".
check('Brand scripts says up front: 3 a month, and only 3', freeScriptsTitle(3) === 'TRYBE Free includes 3 sets of brand scripts a month, and only 3')
check('what is left, what a set is, and that unused sets do not carry over', /^2 of 3 left this month\. Each set is 10 shooting scripts for one product, and writing one uses 1 of your 3\./.test(freeScriptsLine(2, 3, 10)) && /do not carry over/.test(freeScriptsLine(2, 3, 10)) && /fresh 3 on the 1st/.test(freeScriptsLine(2, 3, 10)))
check('used up says so, and when they come back', /^You have used all 3 this month\. Your next 3 come on the 1st\./.test(freeScriptsLine(0, 3, 10)))
check('not counted (View as Free) still says the limit, never a number it does not have', !/left this month/.test(freeScriptsLine(null, 3, 10)) && /uses 1 of your 3/.test(freeScriptsLine(null, 3, 10)))
check('no dashes in the Free scripts words', ![freeScriptsTitle(3), freeScriptsLine(2, 3, 10), freeScriptsLine(0, 3, 10), freeScriptsLine(null, 3, 10)].some((w) => /[\u2013\u2014]| - /.test(w)))
{
  const C = read('components/labs/TrybeCreate.tsx')
  check('the banner is at the top of Brand scripts, with or without SCOUT', (C.match(/\{freeBanner\(\)\}/g) || []).length === 2 && /aria-label="Brand scripts on TRYBE Free"/.test(C))
  check('the quick scripts card says writing a set uses 1, even when the count is not known', /Writing this set uses 1\./.test(C) && /`TRYBE Free: \$\{free\.monthly\} sets a month\.`/.test(C))
}
check('Make videos says the scripts left, and a batch is Pro', /freeLeftWords\(free\.left, free\.monthly, 'sets of brand scripts'\)/.test(read('components/labs/TrybeCreate.tsx')) && /\{!free && <TrybeBatchScripts \/>\}/.test(read('components/labs/TrybeCreate.tsx')))
check('the planner PDF is Pro on Free', /Weekly planner \(PDF\) is on Pro/.test(read('components/labs/TrybeWeek.tsx')))
check('the page asks for your own message on Free, so View as Free shows the real thing', /\.\.\.\(free \? \{ template: true \} : \{\}\)/.test(O))
check('the page and the menu show it', /if \(access === 'free'\) return <TrybeOutreach free/.test(read('app/(dashboard)/trybe/page.tsx')) && /trybeAcc === 'free' \? 'Free'/.test(read('components/layout/DashboardShellV2.tsx')))
check('once live, TRYBE is open without a plan', /\.\.\.\(TRYBE_FREE_LIVE \? \['\/trybe'\] : \[\]\)/.test(read('app/(dashboard)/layout.tsx')))
const L = read('app/(dashboard)/layout.tsx')
// EVERY PAGE BUT TRYBE IS A LOCKED PREVIEW (Seb, 2026-11-20: "anything else
// that they would click on the left ... should ask them to go pro. It should
// just give them a preview of that page, but just they can't do anything")
check('a free account is never bounced: the shell locks the pages instead', /if \(!TRYBE_FREE_LIVE && normalizeTier\(tier\) === 'trial' && signedUpWithoutTrial\(user\.created_at\) && ownsAccount\)/.test(L) && /const freeLocks = TRYBE_FREE_LIVE && normalizeTier\(tier\) === 'trial' && ownsAccount/.test(L) && /freeLocks=\{freeLocks\}/.test(L))
check('a team member on the owner\u2019s account is never locked as a free one', /const ownsAccount = normalizeTier\(tier\) === 'trial' \? \(await getOwnerUserId\(user\.id\)/.test(L))
check('a free account meets the preview, never the YouTube funnel', /if \(!onboarded && normalizeTier\(tier\) !== 'amazon' && !freeLocks\)/.test(L))
type Row = { href: string; label: string; gate?: boolean; locked?: boolean; badge?: string | number; tabs?: Row[] }
const menu: Array<{ label: string; items: Row[] }> = [
  { label: 'Find products', items: [{ href: '/amz-finder', label: 'Product research' }, { href: '/trybe', label: 'TRYBE', badge: 'Free' }, { href: '/cc-campaigns', label: 'CC campaigns', tabs: [{ href: '/cc-campaigns', label: 'All CC campaigns' }, { href: '/joined-campaigns', label: 'Joined' }] }] },
  { label: 'Make videos', items: [{ href: '/review-editor', label: 'Review Editor' }, { href: '/hidden', label: 'Hidden', gate: false }] },
  { label: 'Admin', items: [{ href: '/admin', label: 'Admin' }] },
]
const locked = lockAllBut(menu, freeOpenPath)
const at = (h: string) => locked.flatMap((g) => g.items).find((x) => x.href === h)!
check('every row but TRYBE is locked, marked Pro, its tabs too', !!at('/amz-finder').locked && at('/amz-finder').badge === 'Pro' && !!at('/review-editor').locked && !at('/trybe').locked && at('/trybe').badge === 'Free' && (at('/cc-campaigns').tabs || []).every((t) => t.locked))
check('a hidden row stays hidden and staff rows are left alone', at('/hidden').gate === false && !at('/hidden').locked && !at('/admin').locked)
check('TRYBE, the hubs and the account pages stay open; the rest does not', ['/trybe', '/trybe?tab=find', '/area/find-products', '/billing', '/billing/success', '/settings', '/help'].every(freeOpenPath) && !['/dashboard', '/cc-campaigns', '/review-editor', '/content/new', '/trybe-x'].some(freeOpenPath))
check('a locked page is found under its row, with its name', lockedPageAt(locked, '/cc-campaigns')?.label === 'CC campaigns' && lockedPageAt(locked, '/trybe') === undefined)
check('the panel for a free account names no plan to move from, and keeps TRYBE free', /TRYBE stays free either way\.$/.test(proLockedBody({ href: '/cc-campaigns', label: 'CC campaigns', rowHref: '/cc-campaigns' }, 'trial')) && !/Creator|Studio/.test(proLockedBody({ href: '/x', label: 'X', rowHref: '/x' }, 'trial')))
const SH = read('components/layout/DashboardShellV2.tsx')
check('the shell locks the menu and every page outside it on Free; an admin viewing as Free sees it', /const freeView = TRYBE_FREE_LIVE && \(freeLocks \|\| \(isAdmin && effectiveTier === 'trial'\)\)/.test(SH) && /freeView \? lockAllBut<NavItemDef, NavGroupDef>\(proRows, freeOpenPath\) : proRows/.test(SH) && /lockedPageAt\(NAV_GROUPS, pathname\) \?\? \{ href: pathname, label: 'This page', rowHref: pathname \}/.test(SH))
check('the locked page is a preview nothing on can be pressed, under the way to Pro', /<div inert aria-hidden="true" className="pointer-events-none select-none overflow-hidden"/.test(SH) && /\[data-sonner-toaster\]\{display:none !important\}/.test(SH) && /trybeFree=\{freeView\}/.test(SH))
const PP = read('components/upgrade/ProUpgradePanel.tsx')
check('the panel goes to the card checkout, says the free week, and leads back to TRYBE', /href=\{trybeFree \? '\/billing\?plan=pro' : '\/billing'\}/.test(PP) && /\{trybeFree \? 'Go Pro' : 'Upgrade to Pro'\}/.test(PP) && /FREE_WEEK_SENTENCE/.test(PP) && /Back to TRYBE, free/.test(PP))
// SCOUT FIRST (Seb, 2026-11-20: "Scout is necessary to run Tribe, even on the free account")
check('without SCOUT, TRYBE opens on a start card with the Chrome Web Store button and four steps', /\{!preview && access === 'no-scout' && \(\(\) => \{/.test(O) && /TRYBE in MVP runs through SCOUT, our free Chrome extension/.test(O) && /Add SCOUT from the Chrome Web Store/.test(O) && /I added SCOUT: reload this page/.test(O) && O.indexOf("access === 'no-scout' && (() => {") < O.indexOf('TRYBE FREE: what is open'))
check('a phone or another browser is told where SCOUT works', /SCOUT works on a computer, in Google Chrome\./.test(O) && /SCOUT is a Google Chrome extension\./.test(O))
check('the free sign-up, its email step and the pricing line say SCOUT comes next', /where MVP shows you how to add SCOUT/.test(read('components/auth/SignupForm.tsx')) && /The first step there is adding SCOUT/.test(read('components/auth/SignupForm.tsx')) && /through SCOUT, our free extension/.test(read('app/pricing/page.tsx')))
const S = read('components/auth/SignupForm.tsx')
check('the no-card sign-up is /signup?for=trybe and lands in TRYBE', TRYBE_FREE_SIGNUP === '/signup?for=trybe' && TRYBE_FREE_LANDING === '/trybe' && /\(sp\.get\('for'\) \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'trybe'/.test(S) && /if \(!joiningTeam && !forTrybe\) setPaidTier/.test(S) && /\?\? \(forTrybe \? TRYBE_FREE_LANDING : null\)/.test(S))
check('it says no card, and never shows the Pro free week steps', /'Start TRYBE free'/.test(S) && /No credit card needed for TRYBE Free/.test(S) && /!invited && !annual && !trybeFree && \(/.test(S) && /signup_for: 'trybe'/.test(S))
check('the free scripts get past the trial spend gate, the daily backstop still applies', /if \(opts\.counted\) return null/.test(read('lib/ai-spend.ts')) && read('lib/ai-spend.ts').indexOf('globalDailyCeilingUsd()') < read('lib/ai-spend.ts').indexOf('if (opts.counted) return null') && (R.match(/spendGate\(userId, tier, \{ counted: g\.access === 'free' \}\)/g) || []).length === 2)
check('Match my TikTok stays Pro on the server too', /trybeAccess\(me\?\.tier\) === 'free'\) return/.test(read('app/api/labs/tiktok-library/route.ts')))
check('the pricing page says TRYBE is free, under the plan, with the no-card sign-up', /Only here for TRYBE\? TRYBE is free\./.test(read('app/pricing/page.tsx')) && /href=\{TRYBE_FREE_SIGNUP\}/.test(read('app/pricing/page.tsx')))
check('Billing tells an account without a plan that TRYBE is free', /TRYBE is free without a plan: <a href="\/trybe"/.test(read('app/(dashboard)/billing/page.tsx')))

check('the Top 100 board answers TRYBE Free, as the page shows it', /canUsePreview\('trybe_top_board', tier\) && g\.access !== 'free'/.test(readFileSync('app/api/labs/trybe/route.ts', 'utf8')) && FREE_ACTIONS.has('top_board'))

if (failures.length) {
  console.error(`test-trybe-free: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-trybe-free: all checks passed')
