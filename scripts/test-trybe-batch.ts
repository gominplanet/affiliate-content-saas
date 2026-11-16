// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BATCH SCRIPTS FOR A BRAND CHALLENGE (Seb, 2026-11-14, the Story-Time Script
// Generator brief). Every rule of the checker on the brief's own fixtures, the
// even spread, and a whole round with a pretend writer: distribution, repeats
// caught, a broken script rewritten, and one that stays broken flagged red.
import { readFileSync } from 'node:fs'
import {
  readCampaign, checkScript, planSlots, runRound, estimateSeconds, likeness, casedWords, parseScripts, suggestDeny,
  rulesFromReply, paceWords, notReadyWords, writerSystem, writerPrompt, rulesInput, claimsFromReply, seedCampaign, planSummary, BATCH_ROUND, MAX_PER_CAMPAIGN,
  RULES_SYSTEM, type Script, type Campaign, type Slot,
} from '../lib/trybe-batch'

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
check('a story shorter than the product delay is caught', reasons(base({ story: [{ say: 'Short story.', show: 'x' }, { say: 'Done.', show: 'y' }, { say: 'Ok.', show: 'z' }] })).reasons.some((r) => /story runs about/.test(r)))
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

  if (fails.length) { console.error(`❌ trybe-batch: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
  console.log('✅ trybe-batch: every rule on the brief\'s fixtures, an even spread, and a whole round with rewrites and red flags')
})()
void read
