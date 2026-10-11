// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Cole's TRYBE playbook (Oink interview; Seb 2026-10-12, "do 1, 2, 3, 4"):
//   1. brands scored the way he picks them, a signal not read never scored as 0;
//   2. a first message after a yes (thanks, ideas, a call, their ad spend);
//   3. "don't film yet" until a person at the brand answers;
//   4. one body, many hooks, and never a sale line with nothing on sale.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pickScore, siteSocials, readTopCreatives, tallyTop, readAdLibraryCount, bucketDollars, adLibraryUrl } from '../lib/trybe-pick'
import { afterAccept, parseVideoPlan, honestCtas, scriptFor, NO_ANSWER_DAYS, KICKOFF_SYSTEM, VIDEO_PLAN_SYSTEM } from '../lib/trybe-playbook'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// 1. Picking brands
const small = pickScore({ totalCreators: 3, metaAds: 120, top100Hits: 2, tiktokShop: false, earningsBucket: '$10K - $50K' })
const crowded = pickScore({ totalCreators: 1500, metaAds: 0, top100Hits: 0, tiktokShop: true })
check('few creators + real ad spend beats a crowded brand with no ads', small.score > crowded.score + 60, `${small.score} vs ${crowded.score}`)
check('every reason is said in words', small.reasons.length >= 4 && small.reasons.every(r => r.text.length > 5))
const unread = pickScore({ totalCreators: 10, metaAds: null, top100Hits: null, tiktokShop: null })
check('a signal not read is not scored as zero (no "No Meta ads" when never checked)', !unread.reasons.some(r => /No Meta ads/.test(r.text)) && unread.read === 1)
check('no Meta ads, once read, counts against', pickScore({ totalCreators: null, metaAds: 0, top100Hits: null, tiktokShop: null }).score < 0)
check('TikTok Shop counts against (Cole: less competition off TikTok)', pickScore({ totalCreators: null, metaAds: null, top100Hits: null, tiktokShop: true }).score < pickScore({ totalCreators: null, metaAds: null, top100Hits: null, tiktokShop: false }).score)
check('earnings bucket reads the low end of a range', bucketDollars('$10K - $50K') === 10_000 && bucketDollars('1,000+') === 1000 && bucketDollars('') === null)
check('TikTok read from a brand home page', siteSocials('<a href="https://www.tiktok.com/@gnawnu">').tiktokHandle === 'gnawnu' && siteSocials('Shop us on TikTok Shop').tiktokShop && !siteSocials('<a href="/about">').tiktokShop)
const top = readTopCreatives({ success: true, data: [{ rank: 1, submissionId: 's1', brandId: 'b-aaaaaa1', brandName: 'A' }, { rank: 7, brand: { id: 'b-aaaaaa1', name: 'A' } }, { rank: 3, brandName: 'Only Name' }] })
const t = tallyTop(top)
check('Top 100: two videos for one brand count twice, best rank kept', t.byId.get('b-aaaaaa1')?.hits === 2 && t.byId.get('b-aaaaaa1')?.best === 1)
check('Top 100: a brand given by name only is matched by name', t.byName.get('only name')?.hits === 1)
check('Ad Library counts read as Meta writes them', readAdLibraryCount('~1,200 results') === 1200 && readAdLibraryCount('1 result') === 1 && readAdLibraryCount('No ads match your search') === 0 && readAdLibraryCount('~2.4K results') === 2400 && readAdLibraryCount('Loading') === null)
check('Ad Library searched by the exact brand name, active US ads', /active_status=active/.test(adLibraryUrl('Gnawnu')) && /keyword_exact_phrase/.test(adLibraryUrl('Gnawnu')) && /%22Gnawnu%22/.test(adLibraryUrl('Gnawnu')))

// 2 and 3. After a yes
const now = Date.parse('2026-10-12T12:00:00Z')
const day = 86_400_000
check('no chat: nothing to do', afterAccept({ chat: false, lastIsMine: null, lastAt: 0 }, now).state === 'none')
check('accepted, nothing sent: message before you film', afterAccept({ chat: true, lastIsMine: false, lastAt: now - day }, now).state === 'send_first')
check('sent today: waiting, do not film', (() => { const a = afterAccept({ chat: true, lastIsMine: true, lastAt: now - 3600_000, kickoffSentAt: new Date(now - 3600_000).toISOString() }, now); return a.state === 'waiting' && a.filmOk === false })())
const quiet = afterAccept({ chat: true, lastIsMine: true, lastAt: now - (NO_ANSWER_DAYS + 1) * day }, now)
check(`no answer in ${NO_ANSWER_DAYS}+ days: don't film yet, with a follow up`, quiet.state === 'no_answer' && /Don't film yet/.test(quiet.says))
const yes = afterAccept({ chat: true, lastIsMine: false, lastAt: now - 3600_000, kickoffSentAt: new Date(now - 2 * day).toISOString() }, now)
check('they answered after your message: safe to film 2 or 3', yes.state === 'answered' && yes.filmOk === true && /2 or 3/.test(yes.says))
check('a message older than your kickoff is not an answer', afterAccept({ chat: true, lastIsMine: false, lastAt: now - 3 * day, kickoffSentAt: new Date(now - 2 * day).toISOString() }, now).state !== 'answered')
check('the first message asks for a call and their ad spend, and starts with 2 or 3 videos', /ten minutes for a quick call/.test(KICKOFF_SYSTEM('')) && /spend on ads each month/.test(KICKOFF_SYSTEM('')) && /two or three videos/.test(KICKOFF_SYSTEM('')))

// 4. One body, many hooks
const plan = parseVideoPlan(JSON.stringify({
  product: 'Weight Vest', body: 'This is the vest I wear on walks — it fits snug.',
  hooks: [{ style: 'versus', line: 'Boomer vs Gen Z workout', shot: 'two vests side by side' }, { style: 'negative', line: 'What I hate about this vest', shot: 'pull strap' }, { style: 'before_after', line: 'Before and after a week', shot: 'split' }, { style: 'nonsense', line: 'Watch this', shot: '' }],
  ctas: [{ kind: 'sale', line: 'On sale right now' }, { kind: 'social_proof', line: 'Everyone at my gym asks about it' }],
  funnel: { top: 'a', middle: 'b', bottom: 'c' },
}))
check('a plan is read: body, hooks, calls to action', !!plan && plan.hooks.length === 4 && plan.ctas.length === 2)
check('an unknown hook style is filed, not dropped', plan?.hooks[3].style === 'reaction')
check('dashes are rewritten out of the script', !!plan && !/[–—]/.test(plan.body))
check('nothing on sale: no sale line is offered', !!plan && !honestCtas(plan, []).ctas.some(c => c.kind === 'sale') && honestCtas(plan, ['Weight Vest']).ctas.some(c => c.kind === 'sale'))
check('one script = hook + body + call to action', !!plan && /HOOK: Boomer vs Gen Z workout[\s\S]*BODY:[\s\S]*CTA:/.test(scriptFor(plan, 0)))
check('the plan asks for ten hooks across Cole\'s styles and never invents a sale', /Write 10 hooks/.test(VIDEO_PLAN_SYSTEM('')) && /ONLY when BRAND lists something on sale/.test(VIDEO_PLAN_SYSTEM('')))
check('a broken answer gives no plan rather than an empty one', parseVideoPlan('sorry') === null && parseVideoPlan('{"body":"x","hooks":[]}') === null)

// Wiring
const bg = read('extension/background.js')
check('SCOUT may read TRYBE\'s Top 100, read only', /creator\\\/v2\\\/top-creatives/.test(bg) && /method: 'GET', re: \/\^\\\/backend\\\/api\\\/creator\\\/v2\\\/top-creatives/.test(bg))
check('SCOUT reads Meta\'s Ad Library behind the TRYBE origin check, with Facebook access asked first', /msg\.type === 'MVP_TRYBE_META_ADS'/.test(bg) && /async function metaAdsCounts[\s\S]{0,400}askFacebookAccess/.test(bg))
const manifest = JSON.parse(read('extension/manifest.json')) as { version: string }
check('SCOUT version bumped in lockstep', /SCOUT_LATEST_VERSION = '1\.45\.0'/.test(read('lib/scout-version.ts')) && manifest.version === '1.45.0')
const route = read('app/api/labs/trybe/route.ts')
check('the route saves the Top 100 and Meta counts, guarded against rewrites', /action === 'top100'/.test(route) && /action === 'meta_ads'/.test(route) && /meta_ads_checked_at\.lt\./.test(route))
check('the route writes the first message, the follow up and the plan', /action === 'kickoff' \|\| action === 'followup'/.test(route) && /action === 'video_plan'/.test(route) && /honestCtas\(/.test(route))
check('the list survives a database without migration 425', /COLS = BASE_COLS/.test(route))
const after = read('components/labs/TrybeAfterAccept.tsx')
check('a first message counts as sent only once it shows in the chat', /SENT MEANS SEEN/.test(after) && /seenBefore/.test(after) && /action: 'kickoff_sent'/.test(after))
const page = read('components/labs/TrybeOutreach.tsx')
check('the page offers Best bets and the after-a-yes panel', /id: 'picks', label: 'Best bets'/.test(page) && /<TrybeAfterAccept/.test(page))
const mig = read('supabase/migrations/425_trybe_playbook.sql')
check('migration 425 is safe to run twice', !/add column (?!if not exists)/i.test(mig) && /create index if not exists/.test(mig))

if (failed) { console.error(`\n${failed} TRYBE playbook check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
