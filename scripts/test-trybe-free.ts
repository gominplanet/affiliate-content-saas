// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE Free (Seb, 2026-11-19: "the search brand, definitely super important
// to be able to search and request ... Send their automatic message, not
// necessarily AI message", and upload, earnings, the Top 100 and brand
// scripts, "I know it costs AI, but let's see how we can manage that").

import { readFileSync } from 'node:fs'
import { templateRequest, uploadNoteTemplate, freeAllows, freeLeftWords, monthStartUtc, FREE_TABS, FREE_ACTIONS, FREE_CAPPED, FREE_DAILY_SENDS, FREE_SCRIPTS_MONTHLY, TRYBE_FREE_LIVE, TRYBE_FREE_LANDING, TRYBE_FREE_SIGNUP } from '../lib/trybe-free'
import { trybeAccess } from '../lib/labs-preview'

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
check('Make videos says the scripts left, and a batch is Pro', /freeLeftWords\(free\.left, free\.monthly, 'sets of brand scripts'\)/.test(read('components/labs/TrybeCreate.tsx')) && /\{!free && <TrybeBatchScripts \/>\}/.test(read('components/labs/TrybeCreate.tsx')))
check('the planner PDF is Pro on Free', /Weekly planner \(PDF\) is on Pro/.test(read('components/labs/TrybeWeek.tsx')))
check('the page asks for your own message on Free, so View as Free shows the real thing', /\.\.\.\(free \? \{ template: true \} : \{\}\)/.test(O))
check('the page and the menu show it', /if \(access === 'free'\) return <TrybeOutreach free/.test(read('app/(dashboard)/trybe/page.tsx')) && /trybeAcc === 'free' \? 'Free'/.test(read('components/layout/DashboardShellV2.tsx')))
check('once live, TRYBE is open without a plan', /\.\.\.\(TRYBE_FREE_LIVE \? \['\/trybe'\] : \[\]\)/.test(read('app/(dashboard)/layout.tsx')))
const L = read('app/(dashboard)/layout.tsx')
check('a TRYBE Free sign-up goes back to TRYBE, any other account without a plan to Billing', /signup_for === 'trybe'/.test(L) && /redirect\(forTrybe \? '\/trybe' : '\/billing\?plan=pro&start=1'\)/.test(L))
const S = read('components/auth/SignupForm.tsx')
check('the no-card sign-up is /signup?for=trybe and lands in TRYBE', TRYBE_FREE_SIGNUP === '/signup?for=trybe' && TRYBE_FREE_LANDING === '/trybe' && /\(sp\.get\('for'\) \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'trybe'/.test(S) && /if \(!joiningTeam && !forTrybe\) setPaidTier/.test(S) && /\?\? \(forTrybe \? TRYBE_FREE_LANDING : null\)/.test(S))
check('it says no card, and never shows the Pro free week steps', /'Start TRYBE free'/.test(S) && /No credit card needed for TRYBE Free/.test(S) && /!invited && !annual && !trybeFree && \(/.test(S) && /signup_for: 'trybe'/.test(S))
check('the free scripts get past the trial spend gate, the daily backstop still applies', /if \(opts\.counted\) return null/.test(read('lib/ai-spend.ts')) && read('lib/ai-spend.ts').indexOf('globalDailyCeilingUsd()') < read('lib/ai-spend.ts').indexOf('if (opts.counted) return null') && (R.match(/spendGate\(userId, tier, \{ counted: g\.access === 'free' \}\)/g) || []).length === 2)
check('Match my TikTok stays Pro on the server too', /trybeAccess\(me\?\.tier\) === 'free'\) return/.test(read('app/api/labs/tiktok-library/route.ts')))
check('the pricing page says TRYBE is free, under the plan, with the no-card sign-up', /Only here for TRYBE\? TRYBE is free\./.test(read('app/pricing/page.tsx')) && /href=\{TRYBE_FREE_SIGNUP\}/.test(read('app/pricing/page.tsx')))
check('Billing tells an account without a plan that TRYBE is free', /TRYBE is free without a plan: <a href="\/trybe"/.test(read('app/(dashboard)/billing/page.tsx')))

if (failures.length) {
  console.error(`test-trybe-free: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-trybe-free: all checks passed')
