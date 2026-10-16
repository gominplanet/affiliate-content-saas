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
import { afterAccept, readChat, parseVideoPlan, honestCtas, scriptFor, ideaText, planText, NO_ANSWER_DAYS, KICKOFF_SYSTEM, VIDEO_PLAN_SYSTEM } from '../lib/trybe-playbook'

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
const R = (myAts: number[], brandAts: number[]) => ({ ok: true, myAts, brandAts })
check('no chat: nothing to do', afterAccept({ chat: false }, now).state === 'none')
check('chat not read yet: checking, never a verdict', afterAccept({ chat: true }, now).state === 'checking')
check('a chat that could not be read says so, never "don\'t film"', afterAccept({ chat: true, read: { ok: false, myAts: [], brandAts: [] } }, now).state === 'unknown')
check('who wrote is told from the messages, not the list', readChat([{ mine: null, at: 1 }, { mine: null, at: 2 }]).ok === false && readChat([{ mine: true, at: 1 }, { mine: false, at: 2 }]).ok)
check('accepted, nothing sent: message before you film', afterAccept({ chat: true, read: R([], [now - day]) }, now).state === 'send_first')
check('sent today: waiting, do not film', (() => { const a = afterAccept({ chat: true, read: R([now - 3600_000], []) }, now); return a.state === 'waiting' && a.filmOk === false })())
const quiet = afterAccept({ chat: true, read: R([now - (NO_ANSWER_DAYS + 1) * day], []) }, now)
check(`no answer in ${NO_ANSWER_DAYS}+ days: don't film yet, with a follow up`, quiet.state === 'no_answer' && /Don't film yet/.test(quiet.says))
const yes = afterAccept({ chat: true, read: R([now - 2 * day], [now - 3600_000]) }, now)
check('they answered after your message: safe to film 2 or 3', yes.state === 'answered' && yes.filmOk === true && /2 or 3/.test(yes.says))
check('answered stays answered after you write back (review 2026-10-12)', afterAccept({ chat: true, read: R([now - 5 * day, now - 4 * day], [now - 4.5 * day]) }, now).state === 'answered')
check('a message from the brand before yours is not an answer', afterAccept({ chat: true, read: R([], [now - 3 * day]), kickoffSentAt: new Date(now - 2 * day).toISOString() }, now).state === 'waiting')
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
check('the plan asks for ten videos across Cole\'s styles and never invents a sale', /Write exactly 10 videos with 10 clearly different angles/.test(VIDEO_PLAN_SYSTEM('')) && /ONLY when BRAND lists something on sale/.test(VIDEO_PLAN_SYSTEM('')))

// 4b. Ten whole videos, from the brief (Seb 2026-10-13, after Alejandro).
{
  const v = (i: number, cta = 'Grab yours today') => ({ angle: `Angle ${i}`, style: i === 0 ? 'versus' : 'pov', hook: `Hook ${i}`, shot: 'slide it in', beats: ['show it', 'use it'], cta, forBrief: 'show the fit' })
  const p10 = parseVideoPlan(JSON.stringify({
    product: 'Weight Vest', body: 'The vest I wear on walks.', wants: ['Show the fit on a walk', 'Say it is adjustable'], avoid: ['No gym footage'],
    videos: [v(0, 'Get it while the sale lasts'), ...Array.from({ length: 9 }, (_, i) => v(i + 1))],
    ctas: [{ kind: 'sale', line: 'On sale now' }, { kind: 'urgency', line: 'Try it this week' }],
    funnel: { top: '1', middle: '2', bottom: '3' },
  }))
  check('ten videos are read, each with angle, hook, beats and close', p10?.videos?.length === 10 && p10.videos[3].beats.length === 2 && p10.videos[3].angle === 'Angle 3')
  check('the hook-swap list comes from the videos when no separate hooks are sent', p10?.hooks.length === 10 && p10.hooks[0].line === 'Hook 0')
  check('what the brief asks for and rules out is kept', p10?.wants?.length === 2 && p10.avoid?.[0] === 'No gym footage')
  const honest = p10 && honestCtas(p10, [])
  check('nothing on sale: a video that closes on a sale gets an honest close', !!honest && honest.videos?.[0].cta === 'Try it this week' && honest.videos?.[1].cta === 'Grab yours today')
  const txt = p10 ? planText({ ...p10, brief: 'text' }, 'Oink') : ''
  check('the printed plan carries the brief and all ten videos', /THE BRIEF ASKS FOR:\n- Show the fit/.test(txt) && /THE BRIEF RULES OUT:/.test(txt) && /10\. Angle 9/.test(txt))
  check('a brief MVP could not open is said on the page', p10 ? /document MVP could not read/.test(planText({ ...p10, brief: 'link_only' }, 'Oink')) : false)
  check('one idea copies as a script', p10 ? /HOOK: Hook 1\nFIRST 2 SECONDS: slide it in\n1\) show it/.test(ideaText(p10.videos![1], 2)) : false)
  check('the brief comes first in the prompt', /THE BRIEF COMES FIRST/.test(VIDEO_PLAN_SYSTEM('')))
  const r = read('app/api/labs/trybe/route.ts')
  check('the route plans from the brief the page read, and keeps where it came from', /BRIEF \(the brand's own creative brief on TRYBE\)/.test(r) && /brief: briefState/.test(r))
  const ui = read('components/labs/TrybeVideoIdeas.tsx')
  check('the page reads the brief through SCOUT and says which kind it found', /loadBrandPage\(brandId\)/.test(ui) && /TRYBE shows no brief for this brand/.test(ui) && /MVP could not read their brief on TRYBE/.test(ui))
  check('the ideas can be copied whole and printed', /planText\(plan, name\)/.test(ui) && /Print or save as PDF/.test(ui))
}
check('a broken answer gives no plan rather than an empty one', parseVideoPlan('sorry') === null && parseVideoPlan('{"body":"x","hooks":[]}') === null)

// Wiring
const bg = read('extension/background.js')
check('SCOUT may read TRYBE\'s Top 100, read only', /creator\\\/v2\\\/top-creatives/.test(bg) && /method: 'GET', re: \/\^\\\/backend\\\/api\\\/creator\\\/v2\\\/top-creatives/.test(bg))
check('SCOUT reads Meta\'s Ad Library behind the TRYBE origin check, with Facebook access asked first', /msg\.type === 'MVP_TRYBE_META_ADS'/.test(bg) && /async function metaAdsCounts[\s\S]{0,400}askFacebookAccess/.test(bg))
const manifest = JSON.parse(read('extension/manifest.json')) as { version: string }
check('SCOUT version bumped in lockstep', read('lib/scout-version.ts').includes(`SCOUT_LATEST_VERSION = '${manifest.version}'`) && /^1\.4[5-9]\./.test(manifest.version))
const route = read('app/api/labs/trybe/route.ts')
check('the route saves the Top 100 and Meta counts, guarded against rewrites', /action === 'top100'/.test(route) && /action === 'meta_ads'/.test(route) && /meta_ads_checked_at\.lt\./.test(route))
check('the route writes the first message, the follow up and the plan', /action === 'kickoff' \|\| action === 'followup'/.test(route) && /action === 'video_plan'/.test(route) && /honestCtas\(/.test(route))
check('the list survives a database without migration 425', /COLS = BASE_COLS/.test(route))
// 2026-10-12: a brand judged "not a fit" for "solar" topped Best fit on Tech & Gadgets.
check('a fit score counts only for the search it was judged for', /m\.fit_prefs === pageKey/.test(route) && /fit_score: fitScore\(r\.brand_id\)/.test(route))
check('Best fit puts the AI\'s "not a fit" for this search last, below brands not scored', /judgedNo\(id\) \? -2 : fitScore\(id\) \?\? -1/.test(route))
check('an old verdict is said as one, never as this search\'s', /AI said not a fit for an earlier search/.test(read('components/labs/TrybeOutreach.tsx')))
const after = read('components/labs/TrybeAfterAccept.tsx')
// The send itself is shared with the stuck-video nudge (My brands, 2026-10-12).
const chatSend = read('components/labs/trybe-chat-send.ts')
check('a first message counts as sent only once it shows in the chat', /SENT MEANS SEEN|Sent means SEEN/.test(chatSend) && /seenBefore/.test(chatSend) && /sendInTrybeChat\(/.test(after) && /if \(!r\.sent\)/.test(after) && /action: 'kickoff_sent'/.test(after))
const page = read('components/labs/TrybeOutreach.tsx')
check('the page offers Best bets and the after-a-yes panel', /id: 'picks', label: 'Best bets'/.test(page) && /<TrybeAfterAccept/.test(page))
const mig = read('supabase/migrations/425_trybe_playbook.sql')
check('migration 425 is safe to run twice', !/add column (?!if not exists)/i.test(mig) && /create index if not exists/.test(mig))

// Review fixes, 2026-10-12 (three reviews of the whole page).
const ui = read('components/labs/TrybeOutreach.tsx')
check('a request list that could not be read is said, never shown as 0 accepted', /if \(pages === 0\) \{ setRequestsFailed/.test(ui) && /could not read where your requests stand/.test(ui))
check('"not in TRYBE\'s list" only after a whole read', /requests\.complete \? went\.filter/.test(ui))
check('Accepted and Replied use the same rule (a chat after the request)', /requestState\(requests\.flags\[b\.brand_id\], inbox \? answered : null\)/.test(ui))
check('the after-a-yes panel shows only for a chat after the request, and the counts come from the panels', /reply === 'replied' && \(\s*<TrybeAfterAccept/.test(ui) && /onState=\{onAfterState\}/.test(ui) && /afterStates\[r\.b\.brand_id\] \|\| 'checking'/.test(ui))
check('the daily find never pulls you out of the Inbox, and a failed TRYBE read is not marked done', /setTab\(t => \(t === 'find' \|\| t === 'queue' \? 'queue' : t\)\)/.test(ui) && /if \(!collected\)/.test(ui))
check('Meta check runs in batches with progress and says why a brand was not read', /i \+= 8/.test(ui) && /not-english/.test(ui) && /could-not-open/.test(ui) && /already-running/.test(ui))
check('a creator never sees a migration number', /function setupWords/.test(route) && route.slice(route.indexOf('export async function POST(')).split('\n').filter(l => /migration \d+ in Supabase first/.test(l) && /error/.test(l) && !/setupWords/.test(l)).length === 0)
check('only an admin replaces the shared Top 100, and a read matching nothing changes nothing', /if \(tier !== 'admin'\) \{\s*const fresh/.test(route) && /NOTHING MATCHED, NOTHING CHANGED/.test(route))
check('Best bets ranks a wider pool than the keyword search keeps', /sort === 'picks' \|\| sort === 'creators' \|\| sort === 'spend' \? 1200 : 400/.test(route))
check('SCOUT\'s Meta check stops on a deadline, keeps alive, and reopens a closed tab', /notReached\.push/.test(bg) && /const ka = startKeepAlive\(\)[\s\S]{0,200}for \(let i = 0; i < list\.length/.test(bg) && /catch \(e\) \{ tab = null \}/.test(bg))
const afterUi = read('components/labs/TrybeAfterAccept.tsx')
check('a message already in the chat is not sent twice, and a lost answer is checked before "Not sent"', /already in your TRYBE chat, so it was not sent again/.test(afterUi) && /const maybeSent = !r\.ok && !r\.status/.test(chatSend) && /sent: true, already: true/.test(chatSend))

if (failed) { console.error(`\n${failed} TRYBE playbook check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
