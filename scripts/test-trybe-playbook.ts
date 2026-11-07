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
import { afterAccept, readChat, parseVideoPlan, honestCtas, scriptFor, ideaText, planText, NO_ANSWER_DAYS, KICKOFF_SYSTEM, VIDEO_PLAN_SYSTEM, PROVEN_OPENERS, PROVEN_HOOK_LINES, OPENER_VIDEOS, openerOf, whyText } from '../lib/trybe-playbook'
import { brandAdsForPlan, brandAdsBlock, PLAN_META_ADS, type MetaAd } from '../lib/trybe-adsgallery'
import { scrubBanned } from '../lib/scrub'

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
// Seb, 2026-10-24: the ad spend question is out ("Remove it"): no money talk in any TRYBE message.
check('the first message asks for a call, never their ad spend, and starts with 2 or 3 videos', /ten minutes for a quick call/.test(KICKOFF_SYSTEM('')) && !/spend on ads/.test(KICKOFF_SYSTEM('')) && /two or three videos/.test(KICKOFF_SYSTEM('')))

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
// 4c. THE WORDS TO SAY (Seb, 2026-10-22: "give me actual words to say ...
// small sentences, very, very short and sweet ... And then just give ideas
// of a bunch of different B-rolls").
{
  const vs = (i: number) => ({ angle: `Angle ${i}`, style: 'problem', hook: 'Your leftovers go bad in three days.', shot: 'Fridge door swings open',
    say: ['Your leftovers go bad in three days.', 'Mine last weeks now.', 'Seal it, and the air is gone.', 'Thirty bags come in the box.', i === 0 ? 'Grab it while the sale lasts.' : 'Try it on your next grocery run.'],
    broll: ['Slow push in as the bag shrinks around the steak', 'Hands drop a bag into the freezer drawer', 'Close-up of the seal light going green', 'Fridge shelf of sealed bags'], cta: '', forBrief: '' })
  const ps = parseVideoPlan(JSON.stringify({ product: 'Vacuum Sealer with 30 Bags', body: 'It seals food airtight.', videos: Array.from({ length: 10 }, (_, i) => vs(i)), ctas: [{ kind: 'urgency', line: 'Try it this week' }], funnel: { top: '1', middle: '2', bottom: '3' } }))
  const one = ps?.videos?.[1]
  check('each video keeps its words to say, line by line, and its B-roll', one?.say?.length === 5 && one.broll?.length === 4 && one.say[0] === 'Your leftovers go bad in three days.')
  check('the hook is the first line and the close the last', one?.hook === 'Your leftovers go bad in three days.' && one?.cta === 'Try it on your next grocery run.')
  check('anything that reads beats still reads the script', (one?.beats.length ?? 0) >= 3 && one?.beats[0] === 'Mine last weeks now.')
  const hs = ps && honestCtas(ps, [])
  check('nothing on sale: a spoken line promising a sale is swapped too', !!hs && !hs.videos![0].say!.some((l) => /sale/i.test(l)) && hs.videos![0].say!.includes('Try it this week'))
  check('one video copies as its words to say, then its B-roll', one ? /SAY, ONE LINE AT A TIME:\n1\) Your leftovers go bad in three days\.\n2\) Mine last weeks now\.[\s\S]*B-ROLL TO FILM:\n- Slow push in/.test(ideaText(one, 2)) : false)
  const sys = VIDEO_PLAN_SYSTEM('')
  check('the prompt asks for spoken lines of 4 to 10 words, never directions, modelled on the winners', /"say": \["THE SCRIPT: the exact words the creator says, in order, 5 to 7 lines/.test(sys) && /4 to 10 words, said in one breath/.test(sys) && /THE SCRIPT IS WORDS TO SAY, NOT DIRECTIONS/.test(sys) && /the way the WINNING VIDEOS and WINNING TRYBE ADS below talk/.test(sys) && /"broll": \["5 to 7 B-roll shots to film for this video, one for every line said/.test(sys))
  const ui = read('components/labs/TrybeVideoIdeas.tsx')
  check('the page shows the lines to say one by one, the B-roll, and says when a plan is from before scripts', /Say, one line at a time/.test(ui) && /B-roll to film/.test(ui) && /These ideas are from before scripts\. Press New scripts/.test(ui))
  // Every line is scrubbed, whatever the model sent.
  const dirty = parseVideoPlan(JSON.stringify({ product: 'Vest', body: 'It fits \u2014 really.', videos: [0, 1, 2].map((i) => ({ angle: `A${i}`, style: 'negative', hook: `Honestly \u2014 I hated it ${i}`, say: ['Honestly \u2014 I hated it', 'Then it clicked', 'I deal with back pain', 'No big deal'], broll: ['Pour \u2013 slide'], cta: 'Grab one' })), ctas: [{ kind: 'urgency', line: 'Try it' }], funnel: {} }))
  const lines = dirty ? [dirty.body, ...(dirty.videos || []).flatMap((v) => [v.hook, v.cta, ...(v.say || []), ...(v.broll || [])])].join(' | ') : ''
  check('a plan line never keeps a dash or "honest", even when the model sent one', !!dirty && !/[–—]|honest/i.test(lines))
  check('"deal with" and "no big deal" are no sale promise and keep their lines', !!dirty && (honestCtas(dirty, []).videos?.[0].say || []).some((l) => /deal with back pain/.test(l)) && (honestCtas(dirty, []).videos?.[0].say || []).some((l) => /big deal/.test(l)))
  check('the video prompt never asks for an "honest" anything', !/honest/i.test(VIDEO_PLAN_SYSTEM('')) && !/honest/i.test(KICKOFF_SYSTEM('')))
  check('the planner PDF prints the words to say and the B-roll', /const script = v\.say\?\.length \? v\.say\.slice\(0, 8\) : null/.test(read('lib/trybe-planner-pdf.ts')) && /B-roll: \$\{broll\.join/.test(read('lib/trybe-planner-pdf.ts')))
}
// 4d. WHY THIS HOOK (Seb, 2026-11-06, after Built4More's "drive the knife",
// Techna Digital's five Ws and his own ten openers): who it calls out, the
// moment, the whys dug to the real reason, the hook said, shown and written
// on screen, and the brand's own Meta ads read for who it sells to.
{
  const sys = VIDEO_PLAN_SYSTEM('')
  check('Seb\'s ten openers, word for word, in the prompt', PROVEN_OPENERS.length === 10 && PROVEN_OPENERS.every((o) => sys.includes(`"${o}"`))
    && ['Nobody mentions this', 'I wish I knew this earlier', 'Pause for a second', 'Ever notice this pattern', "Here's the real truth", 'Let me save you hours', 'This may surprise you', 'You need this now', 'You may not agree with this', 'I just figured this out'].every((o) => (PROVEN_OPENERS as readonly string[]).includes(o)))
  check(`at least ${OPENER_VIDEOS} of the 10 open with one, finished with who or the moment, never bare, never twice`, new RegExp(`At least ${OPENER_VIDEOS} of the 10 videos start their hook with one of these, word for word`).test(sys) && /Never say an opener bare, never two videos on the same opener/.test(sys))
  check('the five Ws, then the whys dug to a moment and a feeling', /THE FIVE WS, THEN THE FIVE WHYS/.test(sys) && /ask again until you reach a moment in someone's life and a feeling/.test(sys) && /"why": \["the surface problem/.test(sys) && /"who": "WHO it calls out: a person in a situation/.test(sys) && /never a demographic/.test(sys))
  check('the hook opens on the deepest why, in the buyer\'s words', /THE HOOK OPENS ON THE DEEPEST WHY, NEVER THE SURFACE/.test(sys) && /in their words, never the brand's/.test(sys) && /Call out only people the product is really for/.test(sys))
  check('the hook is said, shown and written on screen', /THE HOOK IS THREE THINGS AT ONCE/.test(sys) && /"onScreen": "the text on screen in the first 2 seconds, under 6 words, never the same words as the hook"/.test(sys))
  check('drive the knife, then the relief, the doubt answered, a new scene every line', /DRIVE THE KNIFE, THEN THE RELIEF/.test(sys) && /"objection":/.test(sys) && /A NEW SCENE EVERY 3 SECONDS/.test(sys) && /Urgency only when it is true/.test(sys))
  check('steal the skeleton, never the words, from the brand\'s longest running Meta ads', /STEAL THE SKELETON, NEVER THE WORDS/.test(sys) && /BRAND'S OWN META ADS that have run the longest/.test(sys))
  check('no health claim and no made up promise in the dig', /never a medical claim, never a promise the product cannot keep/.test(sys))
  check('the prompt has no dash and no "honest"', !/[\u2013\u2014]| - /.test(sys) && !/honest/i.test(sys))
  check('no opener is changed by MVP\'s word scrub', PROVEN_OPENERS.every((o) => scrubBanned(o) === o))

  check('the opener is read from the hook itself', openerOf('Nobody mentions this about shaving the night before a date') === 'Nobody mentions this'
    && openerOf('Here\u2019s the real truth about meal prep') === "Here's the real truth" && openerOf('PAUSE FOR A SECOND, if your feet ache') === 'Pause for a second'
    && openerOf('Nobody mentions shaving') === '' && openerOf('Nobody mentions thistle') === '' && openerOf('') === '')

  const sayIt = ['Nobody mentions this about shaving the night before a date.', 'You check your neck in every mirror.', 'This razor glides without the bumps.', 'Watch it on day three.', 'It fits every handle you own.', 'Grab one before your next date.']
  const vv = (i: number, extra: Record<string, unknown> = {}) => ({ angle: `A${i}`, style: 'problem', hook: i === 0 ? sayIt[0] : `Hook number ${i} for you`, say: i === 0 ? sayIt : [`Hook number ${i} for you`, 'Line two here', 'Line three here', 'Grab one'], broll: ['Push in on the mirror'], cta: '', forBrief: '',
    who: 'Guys who shave every morning', when: 'The night before a date', where: 'A steamy bathroom mirror', what: 'Red bumps on my neck',
    why: ['Razor bumps', 'They look bad up close', 'You do not want her staring at your neck at dinner'], onScreen: 'Date night neck check', objection: 'Will it fit my handle?', opener: 'Nobody mentions this', ...extra })
  const pw = parseVideoPlan(JSON.stringify({ product: 'Razor', body: 'It shaves clean.', videos: [vv(0), vv(1), vv(2, { onScreen: 'Hook number 2 for you' })], ctas: [{ kind: 'urgency', line: 'Try it' }], funnel: {} }))
  const w0 = pw?.videos?.[0], w1 = pw?.videos?.[1], w2 = pw?.videos?.[2]
  check('who, when, where, what, the whys, the screen words and the doubt are kept', w0?.who === 'Guys who shave every morning' && w0.when === 'The night before a date' && w0.where === 'A steamy bathroom mirror' && w0.what === 'Red bumps on my neck' && w0.why?.length === 3 && w0.onScreen === 'Date night neck check' && w0.objection === 'Will it fit my handle?')
  check('a hook up to 16 words is kept whole', w0?.hook === sayIt[0])
  check('an opener the model claims but the hook does not use is not shown', w0?.opener === 'Nobody mentions this' && !!w1 && !w1.opener)
  check('screen words that only repeat the hook are dropped', !!w2 && !w2.onScreen)
  const it = w0 ? ideaText(w0, 1) : ''
  check('a copied video carries the screen words, why the hook works and the doubt', /ON SCREEN: Date night neck check/.test(it) && /WHY THIS HOOK:\nWHO: Guys who shave every morning\nWHEN: The night before a date/.test(it) && /THE REAL REASON: Razor bumps > They look bad up close > You do not want her staring/.test(it) && /THE DOUBT IT ANSWERS: Will it fit my handle\?/.test(it))
  check('a plan from before has no why, and copies as it did', !!pw && whyText({ ...pw.videos![0], who: undefined, when: undefined, where: undefined, what: undefined, why: undefined }) === '')

  // The brand's own Meta ads, for its scripts.
  const now = Date.parse('2026-11-06T12:00:00Z')
  const ad = (id: string, brandId: string, page: string, started: string, extra: Partial<MetaAd> = {}): MetaAd => ({ id, brandId, brand: 'Oink', page, startedText: null, started, body: 'Your bacon deserves better. 0:00 / 0:31', opening: '', paid: false, video: true, versions: false, preview: null, readAt: '2026-11-05T00:00:00Z', cta: 'Shop now', ...extra })
  const g = { ads: [
    ad('1', 'b-oink', 'Oink', '2026-10-25'), ad('2', 'b-oink', 'Oink', '2026-07-01'), ad('3', 'b-oink', 'Someone Else', '2026-01-01'),
    ad('4', 'b-other', 'Other', '2026-01-01'), ad('5', 'b-oink', 'Jane Creator', '2026-09-01', { paid: true, partner: 'Oink' }),
    ...Array.from({ length: 6 }, (_, i) => ad(`x${i}`, 'b-oink', 'Oink', '2026-10-30')),
  ] }
  const hooks = { '2': { hook: 'Nobody tells you bacon can taste like this.', script: 'Nobody tells you bacon can taste like this. 0:00 / 0:20 You fry it once and you get it.', state: 'ready' as const, at: '2026-11-01', tries: 1 } }
  const mine = brandAdsForPlan(g, hooks, 'b-oink', 'Oink', now)
  check(`only the brand's own ads, the longest running first, at most ${PLAN_META_ADS}`, mine.length === PLAN_META_ADS && mine[0].id === '2' && mine[1].id === '5' && !mine.some((a) => a.id === '3' || a.id === '4'))
  check('what MVP heard the video say goes with it, without the player clock', mine[0].script === 'Nobody tells you bacon can taste like this. You fry it once and you get it.' && mine[0].text === 'Your bacon deserves better.')
  const blk = brandAdsBlock(mine)
  check('the block says how long each ran, which ones sell, the button, and never to borrow a price', /^THE BRAND'S OWN META ADS/.test(blk) && /Meta ad 1 \(running 127 days, a keeper, a video, button "Shop now"\)\. Said in the video: "Nobody tells you/.test(blk) && /run by a creator in paid partnership/.test(blk) && /never borrow a price, discount, number or result/.test(blk) && !/[\u2013\u2014]/.test(blk))
  check('no ads, no block, no brand, no ads', brandAdsBlock([]) === '' && brandAdsForPlan(g, hooks, '', 'Oink', now).length === 0 && brandAdsForPlan(null, null, 'b-oink', 'Oink', now).length === 0)

  const r = read('app/api/labs/trybe/route.ts')
  check('the plan reads the brand\'s own Meta ads and its TRYBE products, and says how many went in', /metaAds = brandAdsForPlan\(/.test(r) && /key', `samples:\$\{lookupId\}`\)/.test(r) && /\$\{metaAdsText \? `\\n\\n\$\{metaAdsText\}` : ''\}/.test(r) && /\$\{trybeText \? `\\n\\n\$\{trybeText\}` : ''\}/.test(r) && (r.match(/fromMetaAds: metaAds\.length, metaAdsLongest: metaAds\[0\]\?\.days \?\? null, fromTrybeProducts: trybeProducts\.length/g) || []).length === 2)
  const ui = read('components/labs/TrybeVideoIdeas.tsx') + read('components/labs/WhyThisHook.tsx')
  check('each video shows who it is for, the screen words, a proven opener, and why the hook works', /<WhyThisHook v=\{v\} \/>/.test(ui) && /Why this hook works/.test(ui) && /Dug down to the real reason/.test(ui) && /The hook opens here/.test(ui) && /On screen, first 2 seconds/.test(ui) && /Proven opener/.test(ui) && /The doubt it answers:/.test(ui))
  check('the plan says how many open with a proven opener, and when it fell short', /open with one of your proven openers\$\{n < OPENER_VIDEOS \? `, fewer than the \$\{OPENER_VIDEOS\} MVP asked for` : ''\}/.test(ui) && /None of these open with one of your proven openers/.test(ui))
  check('the note says how many of the brand\'s Meta ads went in', /of the brand's own Meta ads/.test(ui) && /product\$\{tp === 1 \? '' : 's'\} it lists on TRYBE/.test(ui))
  check('Film it shows the screen words with the hook', /onScreen: v\.onScreen \|\| null/.test(ui) && /at === 0 && script\.onScreen/.test(read('components/labs/TrybeFilmIt.tsx')))
  check('the printed planner says who each video is for and its screen words', /const forText = v\.who/.test(read('lib/trybe-planner-pdf.ts')) && /On screen: \$\{v\.onScreen\}/.test(read('lib/trybe-planner-pdf.ts')))
}
check('a broken answer gives no plan rather than an empty one', parseVideoPlan('sorry') === null && parseVideoPlan('{"body":"x","hooks":[]}') === null)

// Wiring
const bg = read('extension/background.js')
check('SCOUT may read TRYBE\'s Top 100, read only', /creator\\\/v2\\\/top-creatives/.test(bg) && /method: 'GET', re: \/\^\\\/backend\\\/api\\\/creator\\\/v2\\\/top-creatives/.test(bg))
check('SCOUT reads Meta\'s Ad Library behind the TRYBE origin check, with Facebook access asked first', /msg\.type === 'MVP_TRYBE_META_ADS'/.test(bg) && /async function metaAdsCounts[\s\S]{0,400}askFacebookAccess/.test(bg))
const manifest = JSON.parse(read('extension/manifest.json')) as { version: string }
check('SCOUT version bumped in lockstep', read('lib/scout-version.ts').includes(`SCOUT_LATEST_VERSION = '${manifest.version}'`) && /^1\.(4[5-9]|[5-9]\d)\./.test(manifest.version))
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
// The batches live in one reader since 2026-10-17 (Find brands and the ads gallery share it).
const metaRead = read('components/labs/metaAdsRead.ts')
check('Meta check runs in batches with progress and says why a brand was not read', /i \+= 8/.test(metaRead) && /not-english/.test(metaRead) && /could-not-open/.test(metaRead) && /already-running/.test(metaRead) && /readMetaAds\(todo\.map/.test(ui))
check('a creator never sees a migration number', /function setupWords/.test(route) && route.slice(route.indexOf('export async function POST(')).split('\n').filter(l => /migration \d+ in Supabase first/.test(l) && /error/.test(l) && !/setupWords/.test(l)).length === 0)
check('only an admin replaces the shared Top 100, and a read matching nothing changes nothing', /if \(tier !== 'admin'\) \{\s*const fresh/.test(route) && /NOTHING MATCHED, NOTHING CHANGED/.test(route))
check('Best bets ranks a wider pool than the keyword search keeps', /sort === 'picks' \|\| sort === 'creators' \|\| sort === 'spend' \|\| sort === 'roomPay' \|\| sort === 'payouts' \|\| sort === 'adsPerCreator' \|\| readFilters\(body\.filters\)\.minRating \? 1200 : 400/.test(route))
check('SCOUT\'s Meta check stops on a deadline, keeps alive, and reopens a closed tab', /notReached\.push/.test(bg) && /const ka = startKeepAlive\(\)[\s\S]{0,200}for \(let i = 0; i < list\.length/.test(bg) && /catch \(e\) \{ tab = null \}/.test(bg))
const afterUi = read('components/labs/TrybeAfterAccept.tsx')
check('a message already in the chat is not sent twice, and a lost answer is checked before "Not sent"', /already in your TRYBE chat, so it was not sent again/.test(afterUi) && /const maybeSent = !r\.ok && !r\.status/.test(chatSend) && /sent: true, already: true/.test(chatSend))

// MORE PROVEN HOOKS (Seb, 2026-11-07, from a creator: "I'm just adding some
// more ideas"): seven sentences with a blank, counted as proven openers.
check('the seven proven hooks are kept, each a sentence with a blank, no dashes', PROVEN_HOOK_LINES.length === 7 && PROVEN_HOOK_LINES.every(x => x.line.includes('___') && !/[\u2013\u2014]| - /.test(x.line)))
check('a hook built on one counts as a proven opener, read from its own words', openerOf("I'm probably going to offend somebody with this, but we need to stop pretending cheap pans are fine") === "I'm probably going to offend somebody with this" && openerOf("I almost didn't share this because I thought I was the only one who hated mornings") === "I almost didn't share this" && openerOf('Still struggling with frizz? You are overlooking this.') === 'Still struggling with')
check('a near miss is not counted', openerOf('I wish I had bought this sooner') === '' && openerOf('You need one more thing') === '')
check('the script agent is given all seven with what to do with the blank', PROVEN_HOOK_LINES.every(x => VIDEO_PLAN_SYSTEM('').includes(x.line)) && /PROVEN HOOKS \(MVP's list too, whole sentences with a blank\)/.test(VIDEO_PLAN_SYSTEM('')) && /They count as proven openers/.test(VIDEO_PLAN_SYSTEM('')))

if (failed) { console.error(`\n${failed} TRYBE playbook check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
