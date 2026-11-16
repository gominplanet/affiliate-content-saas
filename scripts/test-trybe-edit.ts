// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE ads edited from a batch (Seb, 2026-11-16): a take matched to its
// script from what was said, the plan made with the script on the cheaper
// model, the finished video checked against the brief, and TRYBE ads counted
// in their own allowance of 200 a month.

import { readFileSync } from 'node:fs'
import { matchScript, scriptText, checkCut, heardAt, contentWords, MATCH_MIN } from '../lib/trybe-edit'
import { emptyRules, scriptFromRow, type Campaign, type Script } from '../lib/trybe-batch'
import { TRYBE_EDITS_MONTHLY_CAP, trybeEditCapFor, REVIEW_EDITS_MONTHLY_CAP, PRIMARY_FEATURE } from '../lib/usage-cap'
import type { Word } from '../lib/review-edit'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// Words on a clock: one word every 0.4 seconds from `start`.
const said = (text: string, start = 0): Word[] => text.split(/\s+/).filter(Boolean).map((t, i) => ({ text: t, start: start + i * 0.4, end: start + i * 0.4 + 0.35 }))
const script = (idx: number, story: string[], body: string[], title = `Script ${idx}`): Script => scriptFromRow({
  idx, title, story: story.map((say) => ({ say, show: 'Talk to camera' })), body: body.map((say) => ({ say, show: 'Close up', claimIds: [] })), status: 'draft',
})

// 1. Matching a take to its script
const lookBack = script(12, [
  'Stand in the check-in hall at SXM for five minutes and you will see the same thing over and over.',
  'Someone hands their bag over, the agent prints a sticker, and it rolls away on the belt.',
  'Then they do this little look back over their shoulder.',
], ['On our trips now, every bag we check has a NOBL Air Tracker inside.', 'No more look back. I just check my phone.'], 'The look back')
const walter = script(31, [
  'On my walk with Walter this morning, I realized something kind of embarrassing.',
  'I would never let him off the leash somewhere new.',
  'But every time we fly, I hand our bags to total strangers and just walk away.',
], ['So now our checked bag has a NOBL Air Tracker in it. Basically a leash for the luggage.', 'It is linked below. Walter approves.'], 'A leash for the luggage')
const scripts = [lookBack, walter]
const take = said('okay so um stand in the check in hall at SXM for like five minutes sorry stand in the check-in hall at SXM for five minutes and you will see the same thing over and over someone hands their bag over the agent prints a sticker and it rolls away on the belt then they do this little look back over their shoulder on our trips now every bag we check has a NOBL Air Tracker inside no more look back I just check my phone')
const m = matchScript(take, scripts)
check('a take is matched to the script it says', m?.idx === 12 && m.score >= MATCH_MIN)
check('the match says how much of the script was heard', !!m && m.hit > 0 && m.of > m.hit - 1 && m.of > 0)
check('the Walter take matches the Walter script', matchScript(said('on my walk with Walter this morning I realized something embarrassing I would never let him off the leash somewhere new but every time we fly I hand our bags to total strangers and walk away so now our checked bag has a NOBL Air Tracker basically a leash for the luggage'), scripts)?.idx === 31)
check('a take that says neither script is not guessed', matchScript(said('hey guys today I am unboxing a new blender and it is amazing for smoothies'), scripts) === null)
check('two scripts too close to tell are not guessed', matchScript(said('NOBL Air Tracker linked below'), [script(1, ['a'], ['NOBL Air Tracker linked below']), script(2, ['b'], ['NOBL Air Tracker linked below'])]) === null)
check('an empty take matches nothing', matchScript([], scripts) === null)
check('small words do not count as a match', contentWords('the and it is so I a') .length === 0)

// 2. The script for the planner
const st = scriptText(lookBack, 15)
check('the planner gets the title, the story and the product part', /^TITLE: The look back/.test(st) && /STORY \(before the product, the first 15 seconds\):/.test(st) && /PRODUCT:/.test(st) && /SAY: Then they do this little look back/.test(st) && /SHOW: Talk to camera/.test(st))

// 3. The finished video against the brief
const campaign: Pick<Campaign, 'product' | 'rules'> = {
  product: { name: 'NOBL Air Tracker', mustSpell: ['NOBL'], neverSay: ['AirTag'], categoryWords: ['tracker'], showDeny: [] } as unknown as Campaign['product'],
  rules: { ...emptyRules(), productDelaySec: 15, bannedTerms: ['guaranteed'], targetLengthSec: [35, 50] },
}
const good = [...said('stand in the check-in hall and watch the bags roll away on the belt they look back over their shoulder', 0), ...said('so now every bag has a NOBL Air Tracker inside', 16)]
const g = checkCut({ words: good, seconds: 42, campaign, now: 'x' })
check('a clean cut is green', g.state === 'green' && g.items.every((i) => i.tone === 'ok'))
check('green says when the product is first said', g.items.some((i) => /first said at 0:18/.test(i.text)))
check('green says the length against the brief', g.items.some((i) => i.text === '42 seconds, inside the brief’s 35 to 50.' || i.text === "42 seconds, inside the brief's 35 to 50."))
const early = [...said('my tracker is the best way to', 9), ...said('NOBL Air Tracker', 20)]
const e = checkCut({ words: early, seconds: 40, campaign })
check('the product said before the delay is red, with the moment', e.state === 'red' && e.items.some((i) => i.tone === 'bad' && /"tracker" is said at 0:09, before the 15 second mark/.test(i.text)))
check('a plural still counts as the product word', heardAt(said('two trackers in the bag'), 'tracker') !== null)
const banned = checkCut({ words: [...said('it is like an AirTag but guaranteed and only $29 or 30% off', 20), ...said('NOBL', 18)], seconds: 40, campaign })
check('a never-say name is red', banned.items.some((i) => i.tone === 'bad' && /"AirTag" is said/.test(i.text)))
check('a banned term is red', banned.items.some((i) => i.tone === 'bad' && /"guaranteed" is said/.test(i.text)))
check('a price is red', banned.items.some((i) => i.tone === 'bad' && /A price is said/.test(i.text)))
check('a percent is red', banned.items.some((i) => i.tone === 'bad' && /A percent is said/.test(i.text)))
check('"thirty percent" in words is caught too when written as a number', checkCut({ words: said('save 30 percent today NOBL', 20), seconds: 40, campaign }).items.some((i) => /A percent is said/.test(i.text)))
const long = checkCut({ words: said('NOBL Air Tracker', 20), seconds: 58, campaign })
check('a cut outside the length is amber, not red', long.state === 'amber' && long.items.some((i) => i.tone === 'warn' && /58 seconds: the brief asks for 35 to 50/.test(i.text)))
const never = checkCut({ words: said('just a story about bags', 0), seconds: 40, campaign })
check('a product never said is worth a look', never.items.some((i) => i.tone === 'warn' && /never said by name/.test(i.text)))
check('no delay in the brief means no delay check', !checkCut({ words: said('NOBL', 1), seconds: 40, campaign: { ...campaign, rules: { ...campaign.rules, productDelaySec: 0 } } }).items.some((i) => /before the|first said/.test(i.text)))

// 4. The allowance
check('TRYBE ads have their own 200 a month; reviews keep 100', TRYBE_EDITS_MONTHLY_CAP === 200 && trybeEditCapFor('pro') === 200 && trybeEditCapFor('admin') === null && REVIEW_EDITS_MONTHLY_CAP === 100)
check('a TRYBE ad is counted under its own name', PRIMARY_FEATURE.trybeEdit.join() === 'review_edit_trybe' && PRIMARY_FEATURE.reviewEdit.join() === 'review_edit_video')
const S = read('lib/review-edit-server.ts')
check('the counter uses the video’s kind', /feature: kindNow === 'trybe' \? PRIMARY_FEATURE\.trybeEdit\[0\] : PRIMARY_FEATURE\.reviewEdit\[0\], model: 'counter'/.test(S))
check('the allowance is worked out per kind', /editAllowance\(db: Db, userId: string, tier: unknown, kind: VideoKind = 'review'\)/.test(S) && /kind === 'trybe' \? trybeEditCapFor\(t\) : reviewEditCapFor\(t\)/.test(S))
check('waiting videos count against their own kind', /pendingQ\.eq\('settings->>kind', 'trybe'\)/.test(S) && /settings->>kind\.is\.null,settings->>kind\.neq\.trybe/.test(S))
const R = read('app/api/review-edit/route.ts')
check('adding a video checks the allowance of its kind', /const allowance = await editAllowance\(db, g\.userId, g\.tier, settings\.kind\)/.test(R))
check('the list shows both allowances', /trybeAllowance: await editAllowance\(db, g\.userId, g\.tier, 'trybe'\)/.test(R))
check('the Usage page shows the TRYBE ads', /push\('trybeEdits', 'Edited TRYBE ads', await countFeatures\(PRIMARY_FEATURE\.trybeEdit\), introCap\(TRYBE_EDITS_MONTHLY_CAP, subscribedAt\)\)/.test(read('app/api/usage/summary/route.ts')))

// 5. Wiring
check('a batch take is checked as the creator’s own batch, and made a TRYBE ad', /from\('trybe_campaigns'\)\.select\('id'\)\.eq\('id', cid\)\.eq\('user_id', g\.userId\)/.test(R) && /settings\.kind = 'trybe'/.test(R))
check('editing from a batch is behind Labs until it is opened', /canUsePreview\('trybe_edit', g\.tier\)/.test(R) && /trybe_edit: 'admin'|trybe_edit: 'labs'/.test(read('lib/labs-preview.ts')))
check('a missing migration is said by number', /needs migration 468/.test(R))
check('the read finds the script from what was said, and says when it cannot', /matchScript\(words, tb\.scripts\)/.test(S) && /MVP could not tell which script this take is/.test(S))
check('a matched script moves to filmed, never back', /script\.status === 'draft' \|\| script\.status === 'approved'/.test(S) && /status: 'shot'/.test(S))
check('the plan gets the script', /script: script && tb \? scriptText\(script, tb\.campaign\.rules\.productDelaySec\) : null/.test(S))
const P = read('lib/review-edit-plan.ts')
check('a scripted plan runs on the cheaper model', /const SCRIPT_MODEL = 'claude-sonnet-5'/.test(P) && /const model = scripted \? SCRIPT_MODEL : PLAN_MODEL/.test(P) && /feature: 'review_edit_plan', model \}/.test(P))
check('the scripted title never names the product', /never names the product, its brand or its kind/.test(P))
check('the finished video is checked every time it is made', /trybe_check: checkCut\(\{ words: outputWords\(words, spec\.segments\), seconds: spec\.seconds, campaign: tb\.campaign \}\)/.test(S))
check('the creator can say which script a take is', /action === 'script'/.test(R) && /That script is not in this batch/.test(R))
const E = read('components/labs/TrybeBatchEdits.tsx')
check('the batch panel sends its takes as the batch’s TRYBE ads', /trybe=\{\{ campaignId: c\.id \}\}/.test(E) && /trybeLeft=\{allowance\?\.left \?\? null\}/.test(E))
check('a take MVP could not match asks for its script', /MVP could not tell which script this take is/.test(E) && /Pick its script/.test(E))
check('a video still being cut is never shown as ready', /if \(e\.status !== 'done'\) return/.test(E))
check('the batch shows each script’s video', /video=\{editOf\.get\(s\.idx\) \?\? null\}/.test(read('components/labs/TrybeBatchScripts.tsx')))
check('the migration is safe to run twice', /add column if not exists trybe_campaign_id/.test(read('supabase/migrations/468_trybe_edits.sql')))

if (failures.length) {
  console.error(`test-trybe-edit: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-trybe-edit: all checks passed')
