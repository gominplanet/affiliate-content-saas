// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Guard: thumbnail text says only what the video, the post or the listing
// says, and there is little of it (Seb, 2026-10-19: "titles cannot invent
// situations or facts or results or tests" and "too much text typically means
// a greater ratio of errors").
//
// The test set is the screenshots Seb sent: SPOILER: YES!, 4-IN-1 CONFIRMED!,
// ALL SEASON LONG, GLOW ALL NIGHT, 8HR and 3 DEVICES, none of which the video
// said. What would make this look done while broken: a check that runs on the
// briefs but not on the fallback copy, a swap that puts in another invented
// line, an extra that is replaced rather than left out, a concept that still
// quotes the words that were taken off, and a banner or chip row that the
// image prompt still asks for after the brief stopped writing one.
import { readFileSync } from 'node:fs'
import { factsText, unsupportedClaims, checkBriefText, factCheckBriefs, cleanConcept, SAFE_HEADLINE } from '../lib/thumb-facts'
import { buildGraphicThumbnailPrompt, creativeHead, oneChip, TEXT_BUDGET, type ThumbnailPromptInput } from '../lib/thumbnail-prompt'
import { presetToBriefRules, presetToPrompt, resolvePreset } from '../lib/visual-presets'

const fails: string[] = []
const check = (name: string, ok: boolean, detail?: string) => { if (!ok) fails.push(`${name}${detail ? `\n      ${detail}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')

// ── Seb's screenshots, against facts that do not say them ───────────────────
const LAMP = factsText([
  'This kids lamp changes colour and has a timer',
  'Kids night light, 7 colours, USB rechargeable, touch control',
  '- my daughter loves the colours\n- the timer turns it off',
])
for (const line of ['SPOILER: YES!', '4-IN-1 CONFIRMED!', 'ALL SEASON LONG', 'GLOW ALL NIGHT', 'LASTS 8HR', 'CHARGES 3 DEVICES', 'TESTED FOR 30 DAYS', 'I TRIED IT', 'PROVEN RESULTS', 'BEST EVER LAMP']) {
  check(`"${line}" is caught when the facts do not say it`, unsupportedClaims(line, LAMP).length > 0, unsupportedClaims(line, LAMP).join('; '))
}
for (const line of ['7 COLOURS', 'TOUCH CONTROL', 'KIDS NIGHT LIGHT', 'IS IT ANY GOOD?', 'WHAT YOU ACTUALLY GET', 'USB RECHARGEABLE']) {
  check(`"${line}" passes when the facts back it`, unsupportedClaims(line, LAMP).length === 0, unsupportedClaims(line, LAMP).join('; '))
}

// The same words pass when the creator did say them.
const SAID = factsText(['I tested it all night and it is confirmed 4-in-1, it charges 3 devices for 8hr'])
for (const line of ['TESTED ALL NIGHT', '4-IN-1 CONFIRMED', 'CHARGES 3 DEVICES', '8HR BATTERY']) {
  check(`"${line}" passes when the creator said it`, unsupportedClaims(line, SAID).length === 0, unsupportedClaims(line, SAID).join('; '))
}
check('a YES! answer is never backed, because nothing answers a thumbnail', unsupportedClaims('SPOILER: YES!', SAID).length > 0)
check('the safe headlines claim nothing',
  unsupportedClaims(`${SAFE_HEADLINE.statement.line1} ${SAFE_HEADLINE.statement.line2}`, '').length === 0
  && unsupportedClaims(`${SAFE_HEADLINE.question.line1} ${SAFE_HEADLINE.question.line2}`, '').length === 0)

// ── one brief: the extra is left out, not replaced ──────────────────────────
{
  const c = checkBriefText({ line1: 'GLOW', line2: 'ALL NIGHT', badge: '8HR', callouts: ['3 DEVICES'] }, LAMP)
  check('an unbacked badge is left out', c.badge === '')
  check('an unbacked chip is left out', c.callouts.length === 0)
  check('the headline problem is named', /ALL NIGHT/.test(c.headlineWhy), c.headlineWhy)
  check('and every change is said in words', c.notes.length === 2 && c.notes.every((n) => /nothing in the video, post or listing says|not in the video, post or listing/.test(n)), c.notes.join(' | '))
  const own = checkBriefText({ line1: 'GLOW', line2: 'ALL NIGHT', callouts: [] }, LAMP, { lockedHeadline: true })
  check("the creator's own headline is never checked", own.headlineWhy === '')
}

// ── several briefs: an unbacked headline is swapped for a backed one ────────
{
  const out = factCheckBriefs([
    { line1: 'SPOILER:', line2: 'YES!', emphasisWord: 'YES', badge: '', callouts: ['7 COLOURS'], concept: 'A starry bedroom, the word "SPOILER" in a burst and "YES!" huge.' },
    { line1: 'KIDS NIGHT', line2: 'LIGHT', emphasisWord: 'NIGHT', badge: '', callouts: ['TOUCH CONTROL'], concept: 'Soft purple gradient, "KIDS NIGHT LIGHT" in rounded type.' },
  ], LAMP)
  check('an invented headline is swapped for a backed brief', `${out[0].line1} ${out[0].line2}` === 'KIDS NIGHT LIGHT', `${out[0].line1} ${out[0].line2}`)
  check('and takes that brief\'s accent word', out[0].emphasisWord === 'NIGHT')
  check('the backed chip stays', out[0].callouts[0] === '7 COLOURS')
  check('the concept no longer quotes the words taken off', !/SPOILER|YES!/.test(out[0].concept), out[0].concept)
  check('the swap is said, with what replaced it', out[0].textNotes.some((n) => /Did not use the headline "SPOILER: YES!"[\s\S]*Used "KIDS NIGHT LIGHT" instead/.test(n)), out[0].textNotes.join(' | '))
  check('a brief that was fine is left alone', out[1].textNotes.length === 0 && out[1].concept.includes('"KIDS NIGHT LIGHT"'))

  const none = factCheckBriefs([{ line1: 'GLOW', line2: 'ALL NIGHT', callouts: [] }], LAMP, { question: true })
  check('with no backed brief, the safe question goes in', `${none[0].line1} ${none[0].line2}` === 'IS IT ANY GOOD?')
  const stmt = factCheckBriefs([{ line1: 'ALL SEASON', line2: 'LONG', callouts: [] }], LAMP)
  check('and the safe statement in statement style', `${stmt[0].line1} ${stmt[0].line2}` === 'WHAT YOU ACTUALLY GET')
}
{
  const c = cleanConcept('A "pop-art" feel with "GLOW ALL NIGHT" in neon and "7 COLOURS" on a chip.', '7 COLOURS', LAMP)
  check('a lowercase quote describes a look and stays', c.concept.includes('"pop-art"'))
  check('a quoted line that is not on the design goes', !c.concept.includes('GLOW ALL NIGHT') && c.dropped.includes('GLOW ALL NIGHT'), c.concept)
  check('the words that are on the design stay quoted', c.concept.includes('"7 COLOURS"'))
}

// ── the image prompt: headline plus ONE small extra ─────────────────────────
const base: ThumbnailPromptInput = {
  presetId: 'bold', line1: 'KIDS NIGHT', line2: 'LIGHT',
  concept: 'Soft purple gradient with the lamp centre frame.', palette: 'purple and gold',
  banner: 'GAME CHANGER!', callouts: ['7 COLOURS', 'TOUCH CONTROL', 'USB'],
  creatorRefLabel: 'Image 1', identityInstruction: 'Identity.', productLabel: 'the lamp',
}
{
  const head = creativeHead(base).join('\n')
  check('a banner is never drawn, even from an old cached brief', !/GAME CHANGER|BANNER PHRASE/.test(head), head)
  check('only the first chip is drawn', /"7 COLOURS"/.test(head) && !/TOUCH CONTROL|USB/.test(head), head)
  const withBadge = creativeHead({ ...base, badge: 'SO BRIGHT' }).join('\n')
  check('no chip at all when the badge is on, because the badge is the one extra', !/7 COLOURS/.test(withBadge))
  check('oneChip agrees', oneChip({ callouts: ['A'], badge: 'B' }) === '' && oneChip({ callouts: ['', 'A'] }) === 'A')
  const full = buildGraphicThumbnailPrompt(base)
  check('the text budget is a hard rule in every graphic prompt', full.includes(TEXT_BUDGET))
  check('the headline line no longer asks for a banner', !/use a banner for a key phrase/.test(full))
  check('the budget keeps the product\'s own printing', /product's own printing stays/.test(TEXT_BUDGET))
}
{
  const bold = resolvePreset('bold')
  check('the loud look no longer asks for a phrase in a torn banner', !/short punchy phrase|torn banner/.test(bold.typography), bold.typography)
  const rules = presetToBriefRules(bold)
  check('the loud look allows one extra, never a banner, badge and chips together',
    /a starburst badge OR one callout chip, never both and never more than one/.test(rules) && /Return "" for banner/.test(rules), rules)
  check('the fallback prompt allows one chip at most', /at most ONE small benefit chip/.test(presetToPrompt(bold, { surface: 'thumbnail' })))
  check('the editorial kicker uses the headline, not new words', /first line of the headline may be set as a small uppercase kicker/.test(resolvePreset('editorial').typography))
}

// ── the wiring ──────────────────────────────────────────────────────────────
const R = read('app/api/youtube/generate-thumbnail/route.ts')
check('the art director is told banner is always empty and one callout at most',
  /- banner: always ""/.test(R) && /- callouts: AT MOST ONE short real spec/.test(R))
check('and that every word comes from the facts', /FACTS ONLY \(non-negotiable\)/.test(R))
check('the creator\'s full words reach the brief when there is no claims sheet', /FACTS, THE CREATOR'S OWN WORDS/.test(R))
check('the art director\'s briefs are checked', /if \(briefs\.length > 0\) return factChecked\(briefs\)/.test(R))
check('so is the copy fallback', /return factChecked\(copies\.map<ThumbBrief>/.test(R))
check('so is the quick headline', /quick hook[\s\S]{0,40}\$\{why\[0\]\}/.test(R) || /unsupportedClaims\(hook, factsText/.test(R))
check('clampBrief keeps one callout and no banner', /\.slice\(0, 1\)\s*\n\s*: \[\]/.test(R) && /banner: '',/.test(R))
check('the face path tells the prompt which badge is on', /callouts: briefCallouts,\s*\n\s*badge: gfxBadge,/.test(R))
check('the product-only path draws one chip and states the budget',
  /const chipP = oneChip\(/.test(R) && !/BANNER PHRASE/.test(R) && /\n\s*TEXT_BUDGET,\n\s*`REAL COPY ONLY/.test(R))
check('pins, Instagram and stories ask for one chip, not a stacked list',
  !/STACKED/.test(R) && !/1–3 short punchy callouts/.test(R) && (R.match(/at most ONE small chip/g) || []).length >= 3)
check('briefs cached before these rules are not handed back', /:t2\$\{wantQuestion/.test(R))
check('the notes go back to the page', (R.match(/textNotes: textNotesOf\(/g) || []).length === 2)
check('no current year in the headline examples', !/OF 2026\?/.test(R))

const PIN = read('lib/art-director-pin.ts')
check('pins and blog heroes get the same check', /factCheckBriefs\(\[\{/.test(PIN) && /\.slice\(0, 1\) : \[\]/.test(PIN))
check('and one chip with the text budget', (PIN.match(/ONE CHIP: add a single small spec pill/g) || []).length === 2 && (PIN.match(/TEXT_BUDGET,/g) || []).length === 2)
check('and no longer ask for three chips', !/callouts: 3 short benefit/.test(PIN))

const P = read('app/(dashboard)/co-pilot/page.tsx')
check('Co-Pilot says what the check changed', /MVP kept the text to what your video and the listing say/.test(P) && /data\.textNotes/.test(P))

if (fails.length) {
  console.error(`✗ thumb-facts: ${fails.length} failed\n  - ${fails.join('\n  - ')}`)
  process.exit(1)
}
console.log('✓ thumb-facts: thumbnail text is backed by the facts, and it is a headline plus one small extra')
