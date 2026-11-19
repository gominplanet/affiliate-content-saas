// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BATCH SCRIPTS FOR A BRAND CHALLENGE (Seb, 2026-11-14, the Story-Time Script
// Generator brief). Every rule of the checker on the brief's own fixtures, the
// even spread, and a whole round with a pretend writer: distribution, repeats
// caught, a broken script rewritten, and one that stays broken flagged red.
import { readFileSync } from 'node:fs'
import {
  readCampaign, checkScript, planSlots, runRound, estimateSeconds, likeness, casedWords, parseScripts, suggestDeny,
  rulesFromReply, paceWords, notReadyWords, writerSystem, writerPrompt, rulesInput, claimsFromReply, seedCampaign, planSummary, seedFor, contextFromReply, contextInput, contextStale, CONTEXT_SYSTEM, BATCH_ROUND, MAX_PER_CAMPAIGN,
  RULES_SYSTEM, REAL_PERSON, type Script, type Campaign, type Slot,
} from '../lib/trybe-batch'
import { quickContextBlock, contextMisses, contextFixPrompt, withRewrites, readVideoIdeas, VIDEO_PLAN_SYSTEM, VIDEO_IDEAS, type VideoIdea } from '../lib/trybe-playbook'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail).slice(0, 500)}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')

// ── The NOBL campaign from the brief ─────────────────────────────────────────
export const NOBL: Campaign = readCampaign({
  name: 'NOBL Air Tracker challenge',
  product: { name: 'NOBL Air Tracker', neverSay: ['AirTag', 'Air Tag'], categoryWords: ['tracker', 'tracking device'], showDeny: ['suitcase', 'luggage', 'carry-on'] },
  rules: {
    approvedClaims: [
      { id: 'map', text: 'live map of where your bag is' }, { id: 'timeline', text: 'trip timeline' }, { id: 'arrive', text: 'arrival alert' },
      { id: 'move', text: 'unexpected-movement alert' }, { id: 'pair', text: 'pull-tab pairing in about 30 seconds' }, { id: 'phones', text: 'works with iOS and Android' },
    ],
    bannedTerms: ['free', 'Black Friday', 'Cyber Monday'], saleLanguageRule: 'Generic sale language only in the final 10 seconds',
    targetLengthSec: [25, 45], productDelaySec: 15,
  },
  reality: {
    locations: [
      { name: 'SXM airport (before security)', accessNotes: 'Before security only; no gates, no baggage claim, no plane windows', deny: ['gate', 'duty free', 'jet bridge', 'baggage claim', 'carousel', 'boarding', 'plane window'] },
      { name: 'Beach', accessNotes: '', deny: [] }, { name: 'Boardwalk', accessNotes: '', deny: [] }, { name: 'Ferry dock', accessNotes: 'On the dock, not on board', deny: ['on board'] },
    ],
    isTraveling: false, cast: [{ name: 'Seb', phone: 'iPhone' }, { name: 'Mich', phone: 'Android' }], onePersonPerVideo: true, appFootageReuse: true,
  },
  creatorFacts: ['lives in St. Maarten since 2010', 'works in shipping', 'travel creator'],
  target: 50,
}, 'camp-1')

const STORY_OK = [
  { say: 'Stand in the check-in hall at SXM for five minutes and you will see the same thing over and over.', show: 'Wide shot of the check-in hall, people queueing' },
  { say: 'Someone hands over a bag, the belt takes it, and their face changes the moment it disappears behind the curtain.', show: 'Close on a stranger watching the belt' },
  { say: 'My mom did exactly that last spring, and I watched her worry about it all the way to Miami.', show: 'Seb talking to camera near the departures board' },
]
const BODY_OK = [
  { say: 'Anyway, that is why I put a NOBL Air Tracker in her bag before every trip now.', show: 'Seb holding the tracker, then the app', claimIds: [] },
  { say: 'She lands, I get the arrival alert, and I can see her bag on the live map.', show: 'Screen recording from a past trip: arrival alert, live map', claimIds: ['arrive', 'map'] },
  { say: 'It is linked below.', show: 'Seb pointing down', claimIds: [] },
]
const base = (o: Partial<Script> = {}): Script => {
  const story = o.story ?? STORY_OK, body = o.body ?? BODY_OK
  return { idx: 1, title: 'The look on their face at check-in', angle: 'Stress', host: 'Seb', location: 'SXM airport (before security)', realStory: true, realityReason: 'Dropping his mom off', story, body, estSeconds: estimateSeconds(story, body), status: 'draft', link: null, notes: null, tries: 0, checks: { state: 'green', reasons: [], warnings: [] }, ...o }
}
const reasons = (s: Script, others: Script[] = []) => checkScript(s, NOBL, others)

// ── The brief's fixtures ─────────────────────────────────────────────────────
const pass = reasons(base())
check('PASSES: the check-in hall story, with the product entering after it', pass.state !== 'red', pass)
const delay = reasons(base({ story: [{ say: 'I put my NOBL Air Tracker in my bag.', show: 'Seb at the counter' }, ...STORY_OK.slice(1)] }))
check('FAILS product delay: "I put my NOBL Air Tracker in my bag."', delay.state === 'red' && delay.reasons.some((r) => /enters too early/.test(r)), delay)
const gate = reasons(base({ story: [{ say: 'I was standing at the gate watching people wave.', show: 'Seb near the window' }, ...STORY_OK.slice(1)] }))
check('FAILS location: an airport before security script mentioning "at the gate"', gate.state === 'red' && gate.reasons.some((r) => /no "gate"/.test(r)), gate)
const travel = reasons(base({ story: [{ say: "I'm checking in right now and I already feel it.", show: 'Seb at the counter' }, ...STORY_OK.slice(1)] }))
check('FAILS travelling: "I\'m checking in right now" when not travelling', travel.state === 'red' && travel.reasons.some((r) => /travelling right now/.test(r)), travel)

// ── Every other rule ─────────────────────────────────────────────────────────
check('the story shots may not show luggage before the product delay', reasons(base({ story: [STORY_OK[0], { say: STORY_OK[1].say, show: 'Close on my suitcase on the belt' }, STORY_OK[2]] })).reasons.some((r) => /shots show "suitcase"/.test(r)))
check('a category word in the title is too early', reasons(base({ title: 'Why every mom needs a tracker' })).reasons.some((r) => /enters too early: "tracker"/.test(r)))
check('a story shorter than the product delay is caught', reasons(base({ story: [{ say: 'Short story.', show: 'x' }, { say: 'Done.', show: 'y' }, { say: 'Ok.', show: 'z' }] })).reasons.some((r) => /story has \d+ words, so the product would enter before 15 seconds \(it needs at least 35\)/.test(r)))
check('a banned word anywhere is caught, whatever its case', reasons(base({ body: [BODY_OK[0], { ...BODY_OK[1], say: 'Grab it before BLACK FRIDAY ends.' }, BODY_OK[2]] })).reasons.some((r) => /"Black Friday"/.test(r)))
check('a forbidden name is caught', reasons(base({ body: [{ ...BODY_OK[0], say: 'Better than an AirTag for this.' }, ...BODY_OK.slice(1)] })).reasons.some((r) => /"AirTag"/.test(r)))
check('the required capitals: "Nobl" and "nobl" are refused', reasons(base({ body: [{ ...BODY_OK[0], say: 'That is why I use a Nobl Air Tracker now.' }, ...BODY_OK.slice(1)] })).reasons.some((r) => /"Nobl" is spelled with the wrong capitals/.test(r)) && casedWords(NOBL.product).join() === 'NOBL')
check('a price and a percentage are caught', reasons(base({ body: [BODY_OK[0], { ...BODY_OK[1], say: 'It was $29, and 20% off today.' }, BODY_OK[2]] })).reasons.some((r) => /price/.test(r)))
check('sale words are fine in the last beat and refused before it',
  reasons(base({ body: [BODY_OK[0], BODY_OK[1], { ...BODY_OK[2], say: 'It is on sale right now, linked below.' }] })).state !== 'red'
  && reasons(base({ body: [BODY_OK[0], { ...BODY_OK[1], say: 'It is on sale and the map is live.' }, BODY_OK[2]] })).reasons.some((r) => /Sale words/.test(r)))
check('one person on camera: a shot of Seb and Mich together is refused, so is Mich in Seb\'s video',
  reasons(base({ body: [BODY_OK[0], { ...BODY_OK[1], show: 'Seb and Mich look at the map together' }, BODY_OK[2]] })).reasons.some((r) => /on camera/.test(r))
  && reasons(base({ story: [STORY_OK[0], STORY_OK[1], { ...STORY_OK[2], show: 'Mich waving at the counter' }] })).reasons.some((r) => /Mich on camera/.test(r)))
check('a claim not on the approved list is refused', reasons(base({ body: [BODY_OK[0], { ...BODY_OK[1], claimIds: ['battery'] }, BODY_OK[2]] })).reasons.some((r) => /not in the approved list \(battery\)/.test(r)))
check('a place or host outside the campaign is refused', reasons(base({ location: 'At the gate' })).reasons.some((r) => /not one of the campaign's places/.test(r)) && reasons(base({ host: 'Alex' })).reasons.some((r) => /not in the cast/.test(r)))
const other = base({ idx: 2 })
check('the same title, opening or body as another script is refused', reasons(base(), [other]).reasons.some((r) => /Same title as #2/.test(r)))
check('a near copy (85% alike) is refused', reasons(base({ title: 'Different title here' }), [base({ idx: 3, title: 'Another title', story: [{ ...STORY_OK[0], say: STORY_OK[0].say.replace('five', 'ten') }, STORY_OK[1], STORY_OK[2]] })]).reasons.some((r) => /Too close to #3|Same/.test(r)))
check('trigram likeness: same text 1, unrelated text low', likeness('the check in hall at SXM', 'the check in hall at SXM') === 1 && likeness('the check in hall at SXM', 'a beach day with friends') < 0.2)
check('a script outside the length is a warning, not a failure', (() => { const r = reasons(base({ body: [BODY_OK[0], { ...BODY_OK[1], say: `${BODY_OK[1].say} ${'and it keeps going and going '.repeat(20)}` }, BODY_OK[2]] })); return r.state === 'amber' && r.warnings.some((w) => /outside 25 to 45/.test(w)) })())
check('seconds are estimated at 2.5 words a second in the story and 2.6 in the body', estimateSeconds([{ say: 'one two three four five', show: '' }], [{ say: 'a b c d e f g h i j k l m', show: '' }]) === 7)

// ── The even spread ──────────────────────────────────────────────────────────
const fifty = planSlots(NOBL, [], 50)
const count = (k: keyof Slot) => { const m = new Map<string, number>(); for (const s of fifty) m.set(String(s[k]), (m.get(String(s[k])) || 0) + 1); return Array.from(m.values()) }
const spread = (arr: number[]) => Math.max(...arr) - Math.min(...arr)
check('fifty scripts spread evenly across places, hosts and angles (at most one apart)', spread(count('location')) <= 1 && spread(count('host')) <= 1 && spread(count('angle')) <= 1 && count('location').length === 4 && count('angle').length === 4, { l: count('location'), h: count('host'), a: count('angle') })
check('the spread continues from what is already written', planSlots(NOBL, fifty.slice(0, 3).map((s) => ({ ...s })), 1)[0].idx === 4)

// ── A whole round with a pretend writer ──────────────────────────────────────
// The writer returns a valid script per slot, except slot 1 breaks the delay
// rule on its first try, and slot 2 copies slot 1's title every time.
let calls = 0
const fake = async (_system: string, user: string): Promise<string> => {
  calls++
  const idxs = Array.from(user.matchAll(/- index (\d+): place "([^"]+)", host "([^"]+)", angle "([^"]+)"/g)).map((m) => ({ idx: Number(m[1]), location: m[2], host: m[3], angle: m[4] }))
  const OPEN = ['Nobody warns you about the quiet ten minutes after you drop someone off', 'My cousin once waited two hours for news that never came', 'There is a bench on the boardwalk where I do all my worrying', 'Every Sunday the ferry dock fills with the same nervous faces', 'Shipping taught me that things get lost in the boring places', 'The sunset here makes everyone forget what they were stressed about', 'I counted eleven people checking their phones at once yesterday', 'Growing up on the island, we never asked where our things went', 'A wedding guest of ours once flew home without her dress', 'Storm season changes how you think about every trip', 'The market man told me he tracks his crates by memory', 'Rental car lines are where vacations go to wait']
  const MID = ['and nobody talks about that feeling out loud', 'which still makes my stomach drop when I think about it', 'so I started paying attention to what people do next', 'and it is never the big moments that get you', 'because the waiting is worse than the losing', 'which is funny, because the fix was so small', 'and honestly it changed how I pack for everyone', 'so now I notice it everywhere I go', 'and the answer was sitting in my pocket the whole time', 'because you cannot do anything once it is gone', 'which is the part that nobody plans for', 'and I swore I would never feel that again']
  const scripts = idxs.map((s) => {
    const n = s.idx
    const o = OPEN[(n * 7) % 12], m = MID[(n * 5) % 12], m2 = MID[(n * 11 + 3) % 12]
    const first = calls === 1 && n === 1 ? 'My NOBL Air Tracker saved me once.' : `${o}, ${m}.`
    return {
      index: n, title: n === 2 ? 'Title for script one' : n === 1 ? 'Title for script one' : `${o.split(' ').slice(0, 5).join(' ')} ${n}`, realStory: false, realityReason: 'Dropping a friend off',
      story: [{ say: first, show: `Wide shot ${n}` }, { say: `It happened on an ordinary afternoon, ${m2}, and I remember every second of it.`, show: `Close shot ${n}` }, { say: `After that I made a quiet rule for my family, number ${n} on a very long list of rules.`, show: `${s.host} to camera` }],
      body: [{ say: `Anyway, that is why the NOBL Air Tracker goes in my mom's bag now${n % 2 ? '' : ', every single time'}.`, show: `${s.host} with the app`, claimIds: [] }, { say: n % 3 ? 'When she lands I get the arrival alert, then I watch the live map until she is out.' : 'If her bag moves when it should not, the alert tells me before she even notices.', show: 'Screen recording from a past trip', claimIds: n % 3 ? ['arrive', 'map'] : ['move'] }, { say: n % 2 ? 'It is linked below.' : 'I left it linked below for you.', show: 'Pointing down', claimIds: [] }],
    }
  })
  return JSON.stringify({ scripts })
}
;(async () => {
  const r = await runRound(NOBL, [], BATCH_ROUND, fake)
  check('a round writes ten scripts, one per slot', r.scripts.length === 10 && r.missing === 0, r.scripts.map((s) => s.idx))
  const one = r.scripts.find((s) => s.idx === 1)!
  check('a script that broke a rule was rewritten and now passes', one.checks.state !== 'red' && one.tries >= 1 && !/NOBL/.test(one.story[0].say), one)
  const two = r.scripts.find((s) => s.idx === 2)!
  check('one that keeps breaking a rule is flagged red, with the reason, after two rewrites', two.checks.state === 'red' && two.checks.reasons.some((x) => /Same title as #1/.test(x)) && two.tries === 2, two.checks)
  check('three calls at most: the first, then two rewrites', r.calls === 3, r.calls)
  check('the round spread places and angles evenly', new Set(r.scripts.map((s) => s.location)).size === 4 && new Set(r.scripts.map((s) => s.angle)).size === 4)
  const titles = r.scripts.filter((s) => s.checks.state !== 'red').map((s) => s.title.toLowerCase())
  check('no two passing scripts share a title', new Set(titles).size === titles.length)
  const r2 = await runRound(NOBL, r.scripts, BATCH_ROUND, fake)
  check('the next round carries on the numbering and sees what was written', r2.scripts[0].idx === 11)

  const runRoundFake = () => r.scripts.slice(0, 10)
  // ── The prompts and the reading ────────────────────────────────────────────
  const sys = writerSystem()
  check('the writer is told: story first, physical sense, one person, approved claims only, show what you say, real stories, soft CTA',
    /STORY FIRST/.test(sys) && /PHYSICAL SENSE/.test(sys) && /ONE PERSON ON CAMERA/.test(sys) && /ONLY APPROVED CLAIMS/.test(sys) && /SHOW WHAT YOU SAY/.test(sys) && /realStory/.test(sys) && /linked below/.test(sys))
  const up = writerPrompt(NOBL, planSlots(NOBL, [], 2), r.scripts)
  check('each round sees the scripts already written, and the campaign\'s rules', /ALREADY WRITTEN/.test(up) && /#1 \|/.test(up) && /PRODUCT DELAY: 15 seconds/.test(up) && /TRAVELLING TODAY: NO/.test(up) && /ONE PERSON ON CAMERA/.test(up))
  check('a reply the writer garbled gives no scripts, never invented ones', parseScripts('not json', planSlots(NOBL, [], 2)).length === 0 && parseScripts('{"scripts":[{"index":99}]}', planSlots(NOBL, [], 2)).length === 0)
  check('an airport before security suggests its banned words', suggestDeny({ name: 'Airport', accessNotes: 'before security only' }).includes('gate'))
  const merged = rulesFromReply(JSON.stringify({ approvedClaims: [{ id: 'c1', text: 'live map' }], bannedTerms: ['coupon'], productDelaySec: 10, neverSay: ['Tile'] }), NOBL)
  check('rules read from a brief fold onto the creator\'s own (theirs kept)', merged.rules.approvedClaims[0].text === 'live map' && merged.rules.bannedTerms.includes('free') && merged.rules.bannedTerms.includes('coupon') && merged.rules.productDelaySec === 10 && merged.product.neverSay.includes('AirTag') && merged.product.neverSay.includes('Tile'))
  check('pace: accepted of target, and a day count to the deadline', /0 accepted of 50\. You need 5 a day/.test(paceWords({ target: 50, deadline: '2026-11-24' }, [], new Date('2026-11-14T12:00:00Z')).line))
  check('a campaign says what it still needs', notReadyWords(readCampaign({})).length === 4 && notReadyWords(NOBL).length === 0)
  check('a campaign holds at most 300 scripts', readCampaign({ target: 5000 }).target === MAX_PER_CAMPAIGN)

  // ── Starting from TRYBE (Seb, 2026-11-15: "select the product and then MVP figure out the brief") ──
  const seeded = seedCampaign({ brandId: 'nobl-123', brandName: 'NOBL', product: 'NOBL Air Tracker' }, { reality: NOBL.reality, creatorFacts: ['Lives in St. Maarten'], angles: NOBL.angles, hooks: NOBL.hooks })
  check('a new campaign from TRYBE keeps the brand, its name and the product exactly as TRYBE spells it', seeded.brandId === 'nobl-123' && seeded.brandName === 'NOBL' && seeded.product.name === 'NOBL Air Tracker' && /NOBL Air Tracker/.test(seeded.name))
  check('where you film, who is on camera and your facts come from your last campaign', seeded.reality.locations.length === NOBL.reality.locations.length && seeded.reality.cast.length === NOBL.reality.cast.length && seeded.creatorFacts[0] === 'Lives in St. Maarten')
  check('the brand\'s rules start empty, for the reader to fill (never the last brand\'s claims)', seeded.rules.approvedClaims.length === 0 && seeded.rules.bannedTerms.length === 0 && seeded.product.neverSay.length === 0)
  check('a first campaign starts with nothing of yours, and says what it needs', notReadyWords(seedCampaign({ product: 'X' }, null)).includes('who is on camera'))
  check('the brand name survives a save and a reload', readCampaign(JSON.parse(JSON.stringify(seeded)), 'id1').brandName === 'NOBL')
  const inp = rulesInput({ product: 'NOBL Air Tracker', brandName: 'NOBL', brief: 'Keep the product out of the first 15 seconds.', sent: 'From "Creator deck":\nArrival alerts.', pasted: '', brand: 'Smart luggage tracker.' })
  check('the reader gets each source labelled, and none it does not have', /PRODUCT: NOBL Air Tracker \(by NOBL\)/.test(inp) && /THE BRIEF:\nKeep/.test(inp) && /WHAT THE BRAND SENT:\nFrom "Creator deck"/.test(inp) && /THE BRAND:\nSmart/.test(inp) && !/PASTED BY THE CREATOR/.test(inp))
  check('a brief MVP could not open is said to the reader, not hidden', /ABOUT THE BRIEF: The brief on TRYBE is a link/.test(rulesInput({ product: 'X', briefNote: 'The brief on TRYBE is a link MVP could not read.' })))
  check('where the claims came from is read from the reply', claimsFromReply('{"claimsFrom":"brand","approvedClaims":[]}') === 'brand' && claimsFromReply('{"claimsFrom":"sent"}') === 'sent' && claimsFromReply('{}') === null && claimsFromReply('{"claimsFrom":"website"}') === null)
  const withObjects = rulesFromReply(JSON.stringify({ approvedClaims: [{ text: 'arrival alert' }], productDelaySec: 15, showDeny: ['suitcase', 'luggage'], mustSpell: ['NOBL'] }), seeded)
  check('objects that give the product away are filled from the brief', withObjects.product.showDeny.includes('suitcase') && withObjects.product.mustSpell[0] === 'NOBL' && withObjects.rules.productDelaySec === 15)
  check('the reader is told where claims may come from, and never to invent one', /Only when none of those states a feature of this product, take the features THE BRAND itself states/.test(RULES_SYSTEM) && /Never invent a claim/.test(RULES_SYSTEM) && /"claimsFrom"/.test(RULES_SYSTEM) && /"showDeny"/.test(RULES_SYSTEM))

  // ── The screen and the server ──────────────────────────────────────────────
  const ui = read('components/labs/TrybeBatchScripts.tsx')
  const api = read('app/api/labs/trybe-batch/route.ts')
  check('New campaign starts by picking the brand you work with on TRYBE, then its product', /view === 'pick' && <Picker/.test(ui) && /creator\/v2\/brands\/stats/.test(ui) && /loadBrandPage\(b\.id\)/.test(ui) && /Which \{brand\.name\} product is the challenge for\?/.test(ui))
  check('picking the product reads the rules straight away, with TRYBE\'s brief', /startFromTrybe/.test(ui) && /call\('rules', \{ id: saved\.id, briefText: pasted, trybe \}/.test(ui))
  check('without SCOUT the setup is still there, by hand', /if \(canRead\) \{ setErr\(null\); setView\('pick'\) \} else newByHand\(\)/.test(ui) && /set it up by hand/.test(ui))
  check('the screen names each source as read or not read', /MVP read:/.test(ui) && /No documents from your messages with/.test(ui) && /has no brief on its TRYBE page/.test(ui) && /No product claims in any of it/.test(ui))
  check('claims taken from the brand\'s own description are flagged to check', /come from \{brand\}&rsquo;s own description/.test(ui))
  check('the server reads TRYBE\'s brief, what the brand sent and the brand\'s description', /body\.trybe/.test(api) && /msglinks:\$\{ownerId\}:\$\{key\}/.test(api) && /from\('trybe_brands'\)\.select\('name,about,site_summary,site_products'\)/.test(api) && /rulesInput\(/.test(api))
  check('nothing to read is said with the reason, never a generic error', /has no brief on its TRYBE page/.test(api) && /nothingToRead: true/.test(api))
  check('your places and cast carry to the next campaign', /const last = top\?\.setup/.test(api) && /seedCampaign\(\{ brandId: b\.id, brandName: b\.name, product \}, last/.test(ui))

  // ── Brand scripts, A with C's plan card (Seb, 2026-11-15) ─────────────────
  const plan = planSummary({ ...NOBL, target: 50, deadline: '2026-12-05' }, [], new Date('2026-11-15T12:00:00Z'))
  check('the plan spreads 50 evenly over the places and the people', plan.left === 50 && plan.places.every((x) => x.n >= 12 && x.n <= 13) && plan.places.reduce((n, x) => n + x.n, 0) === 50 && plan.cast.every((x) => x.n === 25), plan)
  check('the plan says the rules and the pace to the due date', plan.claims === 6 && plan.delaySec === 15 && plan.never.includes('free') && plan.never.includes('AirTag') && plan.days === 21 && plan.perDay === 3, plan)
  check('a plan with places missing says what to add, never a made-up spread', (() => { const q = planSummary(seedCampaign({ product: 'X' }, null)); return q.places.length === 0 && q.missing.includes('at least one place to film') && q.missing.includes('who is on camera') })())
  const half = runRoundFake()
  check('the plan for a batch half written covers only what is left, still even', (() => { const q = planSummary({ ...NOBL, target: 20 }, half); return q.left === 10 && q.places.reduce((n, x) => n + x.n, 0) === 10 })())
  check('no due date is said as none, a past one as passed', planSummary(NOBL).perDay === null && planSummary({ ...NOBL, deadline: '2026-01-01' }, [], new Date('2026-11-15T12:00:00Z')).perDay === null)

  const create = read('components/labs/TrybeCreate.tsx')
  const batchUi = read('components/labs/TrybeBatchScripts.tsx')
  check('Brand scripts for everyone: pick a brand, then one page with two doors, and no other layout', !/simple/.test(create) && !/steps\(\)/.test(create) && /\{!brand && brandGrid\(\)\}/.test(create) && /\{brand && door === 'home' && brandHome\(\)\}/.test(create))
  check('batch scripts are open to Pro, not only to the admin', /trybe_batch: 'labs'/.test(read('lib/labs-preview.ts')))
  check('door one: quick scripts, from the writer creators already use', /\{VIDEO_IDEAS\} quick scripts/.test(create) && /\{brand && door === 'quick' && quickSection\(\)\}/.test(create) && /<TrybeVideoIdeas key=/.test(create))
  check('door two: a batch of any size up to 300, with a due date', /\[10, 25, 50, 100, 300\]\.map/.test(create) && /Plan \{batchCount\} scripts/.test(create) && /<BatchRun key=\{batchKey\}/.test(create))
  check('the page says what MVP has from the brand: brief, documents, website', /What MVP has from \{brand\.name\}:/.test(create) && /brandDocs\(brand\.id\)/.test(create) && /No documents from your messages yet/.test(create) && /Add a PDF they sent/.test(create))
  check('the product in your hands is picked first', /if \(page && !product && page\.products\.length\) setProduct\(page\.products\[0\]\.name\)/.test(create))
  check('every script for the brand sits on its page: batches and quick sets', /<BrandBatches brandId=\{brand\.id\}/.test(create) && /<TrybeSavedScripts brandId=\{brand\.id\} brandName=\{brand\.name\}/.test(create))
  check('the old saved scripts box and batch card are not on the brand page', !/\{step === 1 && <TrybeSavedScripts \/>\}/.test(create) && !/<TrybeBatchScripts canRead \/>/.test(create) && (create.slice(create.lastIndexOf('  return (')).match(/<TrybeBatchScripts/g) || []).length === 0)
  check('a batch shows MVP\'s plan before it writes, and writes only on Start writing', /view === 'plan' && c && <PlanCard/.test(batchUi) && /Here is my plan before I write anything\./.test(batchUi) && /onStart=\{async \(\) => \{ const s = await save\(c\); if \(s\) \{ setAuto\(true\); setView\('scripts'\) \} \}\}/.test(batchUi) && /autoStart = false/.test(batchUi))
  check('the plan names what was read, what was not, and what is missing', /Following/.test(batchUi) && /src\.missed\.map/.test(batchUi) && /Before I write, add \{p\.missing\.join\(', '\)\}\./.test(batchUi) && /Add where you film/.test(batchUi))
  check('the saved sets list can show one brand', /shown = sets && brandId \? sets\.filter\(\(x\) => x\.brand_id === brandId\) : sets/.test(read('components/labs/TrybeSavedScripts.tsx')))


  // ── The context (Seb, 2026-11-16: the Walter scripts, "any type of context and everything can be tied back in to a product") ──
  const CTX = 'Michelle films in the parked car before or after walking Walter, our French bulldog, with B-roll of the morning walks. Use Walter in every story.'
  const SEEDS = ["Walter's leash rule: never off the leash somewhere new, yet our bags go to strangers", 'Frenchies cannot fly cargo, so Walter stays home and all the worry goes to the bag',
    "The sitter checklist: two pages for the dog, a paper sticker for the bag", "The 'we landed' text to Walter's sitter", 'Walter sulks when the suitcase comes out',
    "Walter's nose finds anything; I cannot find my bag", 'Walter the sock thief, and things going missing while packing', 'Creature of habit: travel throws us both off',
    'The first walk after a trip, without a minute of bag stress', 'Morning walks are thinking time, and the what-ifs show up']
  const W = readCampaign({ ...NOBL, context: CTX, contextPlan: { from: CTX, mention: ['Walter'], seeds: SEEDS, keepApart: ['The NOBL Air Tracker is never on Walter or his collar: it is sold for luggage'], careful: ['Say a lot of airlines restrict snub-nosed breeds in cargo, never all'] },
    reality: { locations: [{ name: 'Parked car, B-roll of walks with Walter', accessNotes: 'Engine off; story lines are car or B-roll', deny: [] }], isTraveling: false, cast: [{ name: 'Mich', phone: 'iPhone' }], onePersonPerVideo: true, appFootageReuse: true } }, 'w1')
  check('a campaign keeps its context and MVP\'s reading of it', W.context === CTX && W.contextPlan?.seeds.length === 10 && W.contextPlan.mention[0] === 'Walter' && readCampaign(JSON.parse(JSON.stringify(W)), 'w1').contextPlan?.keepApart.length === 1)
  const fifty = Array.from({ length: 50 }, (_, i) => seedFor(W, i + 1))
  check('the story ideas spread over a batch: 50 scripts use each of 10 ideas five times, never twice in a row', SEEDS.every((x) => fifty.filter((y) => y === x).length === 5) && fifty.every((x, i) => i === 0 || x !== fifty[i - 1]))
  check('no context, no story ideas', seedFor(NOBL, 3) === null)
  const wp = writerPrompt(W, planSlots(W, [], 3), [])
  check('the writer gets the context, the names to use, what stays apart and what is said with care', /CONTEXT \(what every story is about, beyond the place\):\nMichelle films/.test(wp) && /USE BY NAME: Walter/.test(wp) && /KEEP APART[\s\S]*never on Walter/.test(wp) && /SAY CAREFULLY[\s\S]*a lot of airlines/.test(wp))
  check('each slot carries its own story idea', /- index 1: [^\n]*story seed "Walter's leash rule/.test(wp) && /- index 2: [^\n]*story seed "Frenchies cannot fly cargo/.test(wp))
  check('the writer builds each story from its idea, bridges it to the product\'s problem and calls back at the close', /11\. THE CONTEXT/.test(writerSystem()) && /BRIDGE/.test(writerSystem()) && /calls back to the context/.test(writerSystem()) && /KEEP APART/.test(writerSystem()))
  // Script #1 of Seb's Walter PDF, as the writer would answer it.
  const leash = { idx: 1, title: "Walter's leash rule", angle: 'Aha moment', host: 'Mich', location: 'Parked car, B-roll of walks with Walter', realStory: false,
    story: [{ say: 'On my walk with Walter this morning, I realized something kind of embarrassing.', show: 'B-roll: Walter trotting ahead on the leash, early morning light' },
      { say: 'I would never let him off the leash somewhere new. Not for one second.', show: 'B-roll: close-up of the leash clipped on, Walter sniffing a wall' },
      { say: 'But every time we fly, I hand our bags to total strangers and just walk away.', show: 'Mich in the parked car, talking to camera' },
      { say: 'No leash, no way to check on them, nothing. Until we land.', show: 'Mich shrugs, half laughing' }],
    body: [{ say: 'So now our checked bag has a NOBL Air Tracker in it. Basically, a leash for the luggage.', show: 'Insert at home: Mich tucks the NOBL Air Tracker into the suitcase lining pocket', claimIds: [] },
      { say: 'On our last trip, I could see it on the live map in the NOBL app the whole way.', show: 'Screen recording from a past trip: live map with the bag dot', claimIds: ['map'] },
      { say: 'And the app sent an alert when it landed.', show: 'Screen recording: arrival alert', claimIds: ['arrive'] },
      { say: "It's linked below. Walter approves.", show: 'B-roll: Walter looking up at the camera, tongue out', claimIds: [] }], estSeconds: 0 }
  leash.estSeconds = estimateSeconds(leash.story, leash.body)
  const leashCheck = checkScript(leash, W, [])
  check('script #1 of the Walter PDF passes: Walter in the story, NOBL after the story, approved claims only', leashCheck.state !== 'red' && !leashCheck.warnings.some((w) => /context/.test(w)), leashCheck)
  const noWalter = checkScript({ ...leash, story: leash.story.map((b) => ({ say: b.say.replace(/Walter/g, 'my neighbor'), show: b.show.replace(/Walter/g, 'a cat') })) }, W, [])
  check('a story that leaves the context out is flagged, by name', noWalter.warnings.some((w) => /leaves out your context \(Walter\)/.test(w)), noWalter)
  check('a script in a campaign with no context is never flagged for it', !checkScript(leash, NOBL, []).warnings.some((w) => /context/.test(w)))
  const reply = JSON.stringify({ mention: ['Walter'], seeds: SEEDS.slice(0, 3), keepApart: ['never on Walter'], careful: [] })
  check('the reader\'s answer becomes the plan, read from this context', contextFromReply(reply, CTX)?.seeds.length === 3 && contextFromReply(reply, CTX)?.from === CTX && contextFromReply('no json', CTX) === null && contextFromReply('{"seeds":[]}', CTX) === null)
  check('where the context says you film is picked up, to film there instead', contextFromReply(JSON.stringify({ seeds: ['a'], places: ['Parked car, B-roll of the morning walks'] }), CTX)?.places[0] === 'Parked car, B-roll of the morning walks' && /"places"/.test(CONTEXT_SYSTEM) && /Film in \{named\.length === 1 \? 'this' : 'these'\} instead/.test(read('components/labs/TrybeBatchScripts.tsx')))
  check('an edited context is read again; an unchanged one is not', !contextStale(W) && contextStale({ ...W, context: CTX + ' He hates the vacuum.' }) && !contextStale({ ...W, context: '' }))
  check('the reader gets the product, its claims and the context, and is told to keep the product to its claims', /APPROVED CLAIMS:\n- live map/.test(contextInput(W)) && /THE CREATOR'S CONTEXT:\nMichelle/.test(contextInput(W)) && /Never make the product do something the approved claims do not say/.test(CONTEXT_SYSTEM) && /bridge/.test(CONTEXT_SYSTEM))

  const ctxRoute = read('app/api/labs/trybe-batch/route.ts')
  const ctxUi = read('components/labs/TrybeBatchScripts.tsx')
  check('the server reads the context with the rules, and again when it changes', /if \(next\.context\) next\.contextPlan = await readContext\(next, userId, tier\)/.test(ctxRoute) && /contextStale\(c\) && c\.rules\.approvedClaims\.length/.test(ctxRoute) && /context: c\.context, contextPlan: c\.contextPlan/.test(ctxRoute) && /feature: 'trybe_batch_context'/.test(ctxRoute))
  check('the brand page and the setup both take a context, and a batch carries it', /<span className="font-semibold">Context<\/span>/.test(read('components/labs/TrybeCreate.tsx')) && /context=\{context\} openId=\{openBatch\}/.test(read('components/labs/TrybeCreate.tsx')) && />Context \(optional\)<\/Label>/.test(ctxUi) && /context: context\.trim\(\)\.slice\(0, 2000\)/.test(ctxUi))
  check('the plan shows the story ideas from the context, what stays apart, and says so when it could not read them', /story ideas from it, one per script in turn/.test(ctxUi) && /Kept apart:/.test(ctxUi) && /MVP could not turn your context into story ideas this time/.test(ctxUi))
  check('the PDF\'s first page carries the context', /section\('The context'/.test(read('lib/trybe-batch-pdf.ts')))


  // ── The script craft playbook, section 7 (Seb, 2026-11-16; docs/script-craft-playbook.md) ──
  const at = (o: Partial<Script>) => base({ realStory: false, ...o })
  const obs = at({ title: 'The look back at check-in', angle: 'Thing nobody thinks of',
    story: [{ say: "Stand in the check-in hall at SXM for five minutes and you'll see the same thing over and over.", show: 'Wide shot of the check-in hall, people queueing' },
      { say: 'Someone hands their bag over, the agent prints a sticker, and it rolls away on the belt.', show: "Close on a stranger's bag rolling away on the belt" },
      { say: 'Then they do this little look back over their shoulder.', show: 'A traveller glancing back, Seb watching from the side' },
      { say: "That's the last time they see it until the other end. No way to check on it in between.", show: 'Seb to camera near the departures board' }],
    body: [{ say: 'On our trips now, every bag we check has a NOBL Air Tracker inside.', show: 'Insert at home: Seb drops the NOBL Air Tracker into a bag', claimIds: [] },
      { say: 'Last trip, I could open the NOBL app and see our bag on a live map the whole way.', show: 'Screen recording from your last trip: live map with the bag dot', claimIds: ['map'] },
      { say: 'No more look back. I just check my phone.', show: 'Seb glancing at his phone, smiling', claimIds: [] },
      { say: "Link's below if you check bags.", show: 'Seb pointing down', claimIds: [] }] })
  const obsR = reasons(obs)
  check('PLAYBOOK GOOD: the airport, not travelling, observational script passes clean', obsR.state === 'green', obsR)
  const drop = at({ title: 'Less nervous this time', angle: 'Relief', realStory: true,
    story: [{ say: 'I just dropped my mom off for her flight home.', show: 'Seb at the departures curb, waving at someone off camera' },
      { say: "She has two connections, and she's not the type to sit on hold with an airline.", show: 'Seb to camera, half smiling' },
      { say: "Every time she flies, I'm the one who gets the call when something goes wrong.", show: 'Seb holding up his phone' },
      { say: "This time, I'm a lot less nervous, and here's why.", show: 'Seb walking back toward the parking lot' }],
    body: [{ say: 'Last night I paired a NOBL Air Tracker to my phone and put it in her suitcase.', show: 'Insert at home the night before: pull tab, pairing screen, tracker into her suitcase', claimIds: ['pair'] },
      { say: 'Right now I can see her bag on the live map in the NOBL app.', show: 'Phone at the curb: live map showing her bag at the airport', claimIds: ['map'] },
      { say: 'And when she lands, I get an arrival alert before she even calls.', show: 'Close-up of the arrival alert on the phone', claimIds: ['arrive'] },
      { say: "It's linked below.", show: 'Seb pointing down', claimIds: [] }] })
  const dropR = reasons(drop)
  check('PLAYBOOK GOOD: the drop-off script passes (the tracker paired and packed the night before, the map live at the curb)', dropR.state !== 'red', dropR)
  check('PLAYBOOK GOOD: a story naming a real person (my mom) is marked to shoot only if true, whatever the writer said', REAL_PERSON.test(drop.story[0].say) && parseScripts(JSON.stringify({ scripts: [{ index: 1, title: 't', realStory: false, story: drop.story, body: drop.body }] }), [{ idx: 1, location: 'SXM airport (before security)', host: 'Seb', angle: 'Relief' }])[0].realStory === true)
  const bad = (name: string, sc: Script, want: RegExp, camp: Campaign = NOBL) => { const r = checkScript(sc, camp, []); check(`PLAYBOOK BAD: ${name}`, r.state === 'red' && r.reasons.some((x) => want.test(x)), r) }
  bad('the product as the opening line fails the product delay', at({ story: [{ say: 'I put my NOBL Air Tracker in my bag before every trip, and here is why.', show: 'Seb at the counter' }, ...obs.story.slice(1)], body: obs.body }), /enters too early/)
  bad('"at the gate watching them load our plane" fails the place', at({ story: [{ say: "I'm at the gate watching them load our plane right now.", show: 'Seb near the window' }, ...obs.story.slice(1)], body: obs.body }), /no "gate"/)
  bad('"I\'m checking in for my flight" fails when not travelling', at({ story: [{ say: "I'm checking in for my flight and I'm completely calm, here's why.", show: 'Seb at the counter' }, ...obs.story.slice(1)], body: obs.body }), /travelling right now/)
  bad('"Seb and Mich arguing at the counter" fails one person on camera', at({ story: [obs.story[0], { ...obs.story[1], show: 'Seb and Mich arguing at the counter' }, ...obs.story.slice(2)], body: obs.body }), /on camera/)
  bad('"an AirTag but better, and it\'s 30% off" fails the brand rules', at({ story: obs.story, body: [{ ...obs.body[0], say: "It's an AirTag but better, and it's 30% off." }, ...obs.body.slice(1)] }), /"AirTag"|percentage/)
  bad('the luggage tracker on the dog\'s collar fails, no claim covers it', { ...leash, body: [{ ...leash.body[0], show: "Mich clips the NOBL Air Tracker on Walter's collar" }, ...leash.body.slice(1)] } as Script, /puts the product on Walter/, W)
  bad('"Introducing the NOBL Air Tracker, the ultimate travel gadget you need!" reads like an ad', at({ story: obs.story, body: [{ ...obs.body[0], say: 'Introducing the NOBL Air Tracker, the ultimate travel gadget you need!' }, ...obs.body.slice(1)] }), /reads like an ad/)
  bad('"same price" is a comparison no brief approves', at({ story: obs.story, body: [obs.body[0], { ...obs.body[1], say: 'Same price as a nice luggage tag, and I can see the live map.' }, ...obs.body.slice(2)] }), /compares the product \("Same price"\)/i)
  bad('talking about a feature before the product enters fails the delay', at({ story: [obs.story[0], { ...obs.story[1], say: 'Someone hands their bag over, and I wish they had a live map of it the whole way.' }, ...obs.story.slice(2)], body: obs.body }), /talks about a feature \("live map"\)/)
  bad('a story too short for the product delay fails (2.3 words a second)', at({ story: [{ say: 'Bags go missing.', show: 'x' }, { say: 'It happens a lot.', show: 'y' }, { say: 'Really, it does.', show: 'z' }], body: obs.body }), /needs at least 35/)
  const noDemo = reasons(at({ story: obs.story, body: [obs.body[0], { ...obs.body[1], show: 'Seb smiling at the camera' }, ...obs.body.slice(2)] }))
  check('a feature line with no shot of the feature is flagged', noDemo.warnings.some((w) => /no shot that shows the feature/.test(w)), noDemo)
  const noLabel = reasons(at({ story: obs.story, body: [obs.body[0], { ...obs.body[1], show: 'Screen recording: live map with the bag dot' }, ...obs.body.slice(2)] }))
  check('app footage not labelled as from your last trip is flagged when you are not travelling', noLabel.warnings.some((w) => /from your last trip/.test(w)), noLabel)
  const tenSame = Array.from({ length: 10 }, (_, i) => ({ ...obs, idx: i + 2, title: `Title ${i}`, story: [{ ...obs.story[0], say: `${obs.story[0].say} ${i}` }, ...obs.story.slice(1)] }))
  const rot = checkScript({ ...obs, idx: 20, title: 'Another one' }, NOBL, tenSame)
  check('the same product line in more than 1 in 10 scripts is flagged', rot.warnings.some((w) => /product line is the same as in/.test(w)), rot)
  const ws = writerSystem()
  check('the writer gets the playbook: the 4 beat story and product halves, the pivot, the self-check, the two examples', /STORY FIRST, IN 4 BEATS, about 38 to 50 words/.test(ws) && /\(3\) the turn/.test(ws) && /THE PRODUCT HALF, IN 4 BEATS, about 45 to 60 words/.test(ws) && /\(5\) the pivot/.test(ws) && /never "Introducing" or "Check out"/.test(ws) && /BEFORE YOU ANSWER, CHECK EVERY SCRIPT/.test(ws) && /TWO EXAMPLES OF THE SHAPE/.test(ws) && /one script in five opens/.test(ws) && /filmed parked/.test(ws) && /Never invent comments, quotes, numbers or statistics/.test(ws))
  check('the plan card answers the four questions before writing: travelling, places, who is on camera', /row\('Shoot day'/.test(read('components/labs/TrybeBatchScripts.tsx')) && /row\('Places'/.test(read('components/labs/TrybeBatchScripts.tsx')) && /row\('On camera'/.test(read('components/labs/TrybeBatchScripts.tsx')))
  check('the playbook is kept in the repo', /The script formula/.test(read('docs/script-craft-playbook.md')) && /The tie-in technique/.test(read('docs/script-craft-playbook.md')))
  check('a campaign without a length from the brief aims for 35 to 50 seconds', readCampaign({}).rules.targetLengthSec.join() === '35,50')


  // ── The context in quick scripts too (Seb, 2026-11-16: "add the context box to quick scripts too yes") ──
  const qb = quickContextBlock(CTX)
  check('the quick writer gets the context with the tie-in technique and the keep-apart rule', /THE CREATOR'S CONTEXT/.test(qb) && /Michelle films in the parked car/.test(qb) && /bridges that detail to the problem the product solves/.test(qb) && /never put on the dog/.test(qb) && /never invent numbers, quotes or comments/.test(qb) && quickContextBlock('   ') === '')
  const trybeRoute = read('app/api/labs/trybe/route.ts')
  const ideasUi = read('components/labs/TrybeVideoIdeas.tsx')
  check('the quick writer sends the context, writes a new set for it, and says it was used', /\.\.\.\(context\.trim\(\) \? \{ context: context\.trim\(\)\.slice\(0, 2000\) \} : \{\}\)/.test(ideasUi) && /if \(match && !context\.trim\(\)\)/.test(ideasUi) && /follow your context/.test(ideasUi))
  const createUi = read('components/labs/TrybeCreate.tsx')
  check('one context box on the brand page feeds both doors', (createUi.match(/<span className="font-semibold">Context<\/span>/g) || []).length === 1 && /buyerShot=\{buyerShot\} context=\{context\}( onPlan=\{free \? \(\) => free\.onUsed\(\) : undefined\})? \/>/.test(createUi) && /context=\{context\} openId=\{openBatch\}/.test(createUi) && /in quick scripts and in a batch/.test(createUi))


  // ── Every quick script follows the context (Seb, 2026-11-16: "only a few had the context ... make sure that the context is being actually listened to") ──
  const qplan = { mention: ['Walter'], seeds: SEEDS, keepApart: ['the tracker never on Walter'], careful: [], places: ['Parked car', 'Morning walks with Walter'] }
  const qbp = quickContextBlock(CTX, qplan)
  check('the quick writer gets one context idea per video, in order, and the names and the place spelled out', /CONTEXT IDEAS, one per video, in order:\n1\. Walter's leash rule/.test(qbp) && new RegExp(`\\n${VIDEO_IDEAS}\\. `).test(qbp) && /USE BY NAME in every video: Walter/.test(qbp) && /WHERE YOU FILM: every shot of every video is filmed here: Parked car; Morning walks with Walter/.test(qbp) && /it is not optional/.test(qbp))
  const sysCtx = VIDEO_PLAN_SYSTEM('', true)
  check('with a context, the quick writer is told it comes right after the brief and binds every video', /THE CREATOR'S CONTEXT COMES NEXT, AND EVERY VIDEO FOLLOWS IT/.test(sysCtx) && new RegExp(`all ${VIDEO_IDEAS} videos are built on it, not some of them`).test(sysCtx) && /told THROUGH the context/.test(sysCtx) && sysCtx.indexOf('THE BRIEF COMES FIRST') < sysCtx.indexOf("THE CREATOR'S CONTEXT COMES NEXT") && !/CONTEXT COMES NEXT/.test(VIDEO_PLAN_SYSTEM('', false)))
  const vid = (hook: string, broll: string[]): VideoIdea => ({ angle: 'a', style: 'problem', hook, shot: broll[0] || '', beats: [], say: [hook, 'Then the bag went missing.', 'So now there is a NOBL Air Tracker in it.', "It's linked below."], broll, cta: "It's linked below.", forBrief: '' })
  const vids = [vid('Walter has one rule on our morning walk.', ['Parked car, Mich to camera', 'B-roll: Walter on the walk']), vid('Nobody tells you this about checked bags.', ['Parked car, Mich to camera']), vid('Walter steals socks when I pack.', ['Mich in the kitchen packing a bag'])]
  const qm = contextMisses(vids, qplan, CTX)
  check('a video that leaves out Walter is caught, and one filmed in the kitchen when the context says the car and the walks', qm.checked && qm.misses.length === 2 && qm.misses[0].index === 1 && /leaves out Walter/.test(qm.misses[0].why) && qm.misses[1].index === 2 && /films in the kitchen/.test(qm.misses[1].why), qm)
  check('a video that follows the context passes', contextMisses([vids[0]], qplan, CTX).misses.length === 0)
  check('a place the context itself names is never counted against it', contextMisses([vid('Walter in my kitchen again.', ['Mich in the kitchen'])], { ...qplan, places: ['kitchen studio'] }, 'I film in my kitchen studio with Walter.').misses.length === 0)
  const studio = { mention: [], seeds: ['a'], keepApart: [], careful: [], places: ['My studio'] }
  const sm = contextMisses([vid('Here is what nobody tells you about packing.', ['Studio, Seb at the desk with the product']), vid('I tested this for a week.', ['Seb in the kitchen holding it'])], studio, "I'm going to be shooting these videos in my studio.")
  check('"shooting in my studio": a desk in the studio passes, the kitchen does not', sm.checked && sm.misses.length === 1 && sm.misses[0].index === 1 && /films in the kitchen, not where your context says \(My studio\)/.test(sm.misses[0].why), sm)
  check('with nothing read from the context, nothing is claimed either way', contextMisses(vids, null, CTX).checked === false)
  check('only the videos that missed are sent back, by number, and put back in their places', /video 2: it leaves out Walter[\s\S]*video 3: it films in the kitchen/.test(contextFixPrompt(qm.misses)) && /holding exactly these 2 videos/.test(contextFixPrompt(qm.misses)) && (() => { const fixed = withRewrites(vids, qm.misses, [vids[0], vids[0]]); return fixed[1] === vids[0] && fixed[2] === vids[0] && fixed[0] === vids[0] && fixed.length === 3 })())
  check('each video says how it uses the context', readVideoIdeas([{ hook: 'h', say: ['h', 'x'], contextUse: "Walter's leash rule bridged to bags" }])[0].contextUse === "Walter's leash rule bridged to bags")
  const tr = read('app/api/labs/trybe/route.ts')
  check('the server reads the context into ideas first, puts it at the top of the request and reminds at the end', /system: CONTEXT_SYSTEM/.test(tr) && /ctxPlan = contextFromReply\(/.test(tr) && /quickContextBlock\(contextWords, ctxPlan\)/.test(tr) && /text: `\$\{contextText \? `\$\{contextText\}\\n\\n` : ''\}BRAND:/.test(tr) && /REMEMBER: every one of the \$\{VIDEO_IDEAS\} videos follows THE CREATOR'S CONTEXT/.test(tr) && /system: VIDEO_PLAN_SYSTEM\(BANNED_RULE, !!contextText\)/.test(tr))
  check('the server checks every video, rewrites the misses once, and keeps the result on the set', /let r = contextMisses\(parsed\.videos, ctxPlan, contextWords\)/.test(tr) && /content: contextFixPrompt\(r\.misses\)/.test(tr) && /parsed\.videos = withRewrites\(parsed\.videos, r\.misses, rewrites\)/.test(tr) && /\.\.\.\(contextCheck \? \{ contextCheck \} : \{\}\)/.test(tr) && /\.\.\.\(contextText \? \{ context: contextWords \} : \{\}\)/.test(tr))
  const iu = read('components/labs/TrybeVideoIdeas.tsx')
  check('the screen says how many follow the context, which missed, and when it could not check', /All \{k\.of\} follow your context/.test(iu) && /\{k\.followed\} of \{k\.of\} follow your context/.test(iu) && /MVP could not check each video against it/.test(iu) && /AbortSignal\.timeout\(295_000\)/.test(iu) && /<b>Your context:<\/b> \{v\.contextUse\}/.test(read('components/labs/ScriptParts.tsx')))

  if (fails.length) { console.error(`❌ trybe-batch: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
  console.log('✅ trybe-batch: every rule on the brief\'s fixtures, an even spread, and a whole round with rewrites and red flags')
})()
void read
