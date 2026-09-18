// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE HELP DESK QUOTES THE PRODUCT, NOT A MEMORY OF IT.
//
// lib/assistant-features-doc is injected verbatim into the in-app assistant's
// system prompt, so its contents ARE the assistant's knowledge. A stale number
// there is not a stale doc, it is a wrong answer delivered confidently to a
// paying customer who then plans around it.
//
// WHAT HAPPENED. Lisa asked the help desk what her Clip Factory limit was. The
// Shorts cap was not in the doc at all, so the model reached for the nearest
// number it could see, "Video scripts: 150/mo" on the Pro line, and told her
// Clip Factory allowed 150 clips a month. The enforced cap is 50. It then did
// arithmetic on the invented figure ("50 used, so 100 remaining") and invented
// a reset date, neither of which it has any data for. She came back to support
// quoting all three as fact.
//
// The 150 was ALSO wrong on its own terms: video scripts are 120. An audit of
// the hand-written plan table found eight wrong numbers, it documented two
// plans no longer sold, and it said nothing about the Amazon plan, which is one
// of the two that are.
//
// So the plan table is generated from TIERS and the enforced cap constants, and
// this file holds it there. Same lesson as scripts/test-sales-page-facts, one
// surface further in: a number that CAN be typed will be, and it will be right
// on the day it is typed and wrong by the next release.
import { readFileSync } from 'node:fs'
import { MVP_FEATURES_DOC } from '../lib/assistant-features-doc'
import { TIERS, SELLABLE_TIERS } from '../lib/tier'
import { SHORTS_MONTHLY_CAP, X_MONTHLY_CAP } from '../lib/usage-cap'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const DOC = MVP_FEATURES_DOC
const SRC = readFileSync('lib/assistant-features-doc.ts', 'utf8')

// ── the enforced caps are stated, and stated correctly ──────────────────────
//
// Asserted against the SAME constants the render route enforces, so the doc
// cannot say one thing while the product does another. Lisa's question had no
// answer in this doc at all, which is why the model made one up.
{
  check('the doc states the Clip Factory cap',
    /Clip Factory: \d+ finished Shorts/.test(DOC),
    'the cap was absent, so the model quoted the nearest number on the page')
  check('and it is the cap the render route enforces',
    DOC.includes(`Clip Factory: ${SHORTS_MONTHLY_CAP} finished Shorts`),
    `enforced at ${SHORTS_MONTHLY_CAP}`)
  check('the doc states the X cap',
    DOC.includes(`X / Twitter posts: ${X_MONTHLY_CAP} per billing period`),
    `enforced at ${X_MONTHLY_CAP}`)
  check('the caps are read from the constants, not typed',
    /\$\{SHORTS_MONTHLY_CAP\}/.test(SRC) && /\$\{X_MONTHLY_CAP\}/.test(SRC),
    'a literal here is correct until the cap moves, and wrong silently afterwards')

  // A presence check on the right number would still pass if a DIFFERENT number
  // were sitting three lines above it, so the doc must not state any Shorts
  // figure other than the enforced one.
  //
  // This started life as a ban on the literal "150 clips", the exact wrong
  // answer Lisa was given. Then the cap was deliberately raised to 150 and that
  // clause became a guard that fails on correct content: the sentence it
  // forbade had become the truth. Banning a specific wrong value only works
  // while that value stays wrong. Comparing every stated figure against the
  // constant works whatever the constant is.
  const stated = [...DOC.matchAll(/(\d+)\s+(?:finished\s+)?(?:clips|Shorts)\b/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => n !== SHORTS_MONTHLY_CAP)
  check('the doc states no Shorts figure other than the enforced cap',
    stated.length === 0,
    `found ${stated.join(', ')} against an enforced ${SHORTS_MONTHLY_CAP}`)
}

// ── every sellable plan's numbers match the product ─────────────────────────
{
  for (const key of SELLABLE_TIERS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = TIERS[key] as any
    check(`the doc lists the ${t.label} plan`, DOC.includes(`### ${t.label} ($${t.price}/mo`),
      'the Amazon plan was missing entirely while being the one the ads point at')
    const numbered: [string, number | null][] = [
      ['Video scripts', t.scriptsPerMonth],
      ['Art Director thumbnails', t.thumbnailsPerMonth],
      ['WordPress sites', t.sites],
      ['Virtual Assistant seats', t.vaSeats],
      ['Help Desk messages', t.assistantMessagesPerMonth],
    ]
    for (const [label, value] of numbered) {
      if (!value) continue  // 0 / null means the row is not rendered at all
      const seen = new RegExp(`- ${label}: (\\d[\\d,]*)`, 'g')
      const hits = [...DOC.matchAll(seen)].map((m) => Number(m[1].replace(/,/g, '')))
      check(`${t.label}: the doc's ${label} figure is a real one`,
        hits.includes(value),
        `product says ${value}; doc has ${hits.join('/') || 'none'}`)
    }
  }
}

// ── the numbers are generated, not typed ────────────────────────────────────
//
// The clause that actually prevents the next drift. Checking the VALUES passes
// again the day somebody types the current number by hand, and fails the
// release after that.
{
  check('the plan table is generated from TIERS',
    /function plansBlock\(\)/.test(SRC) && /TIERS\[key\]/.test(SRC),
    'a hand-written table had drifted in eight places before anybody noticed')
  check('and it is spliced into the guide rather than duplicated',
    /FEATURE_GUIDE\.replace\('<<PLANS>>', plansBlock\(\)\)/.test(SRC))
  check('the placeholder is actually consumed',
    !DOC.includes('<<PLANS>>'),
    'an unreplaced token would ship the literal string to the model')

  // The specific stale figures that were live. A generated table makes these
  // impossible, which is exactly why a regression would mean somebody went back
  // to typing them.
  const STALE: [string, RegExp][] = [
    ['Pro generations 200', /200 generations/],
    ['Pro video scripts 150', /Video scripts: 150/],
    ['Pro newsletter 8 sends', /8 sends/],
    ['Pro multi-site 5', /up to 5\)/],
    ['Studio generations 60', /60 generations/],
    ['Studio IG thumbnails 30', /IG AI thumbnails: 30/],
    ['Deals Hub capped at 30', /Deals Hub: 30/],
    ['Deals Hub capped at 5', /Deals Hub unlocked \(5/],
  ]
  for (const [what, re] of STALE) {
    check(`the stale "${what}" is gone`, !re.test(DOC),
      'it was in the assistant\'s prompt, so it was being told to customers')
  }
}

// ── it does not do arithmetic it has no data for ────────────────────────────
//
// The second half of Lisa's wrong answer. The assistant is given a tier and a
// feature guide, and no usage at all, so "100 remaining before your reset on
// the 5th" was three invented facts in one clause. Telling it the cap without
// telling it to stop subtracting would leave the more harmful half in place.
{
  check('the doc forbids computing a remaining allowance',
    /NEVER CALCULATE SOMEONE'S REMAINING ALLOWANCE/.test(DOC))
  check('and says plainly that usage is not available to it',
    /You are not given anyone's usage/.test(DOC),
    'a rule without its reason is a rule a model talks itself out of')
  check('and forbids stating a reset date',
    /do not state a\nreset date|not know their reset date/.test(DOC))
  check('and points at the page that has the real figure',
    /\(\/billing\)/.test(DOC),
    'refusing to answer is only acceptable if it hands over somewhere that can')

  // The assistant route must not quietly start passing usage in without this
  // instruction being revisited. If it ever does, the rule above becomes false
  // and needs rewriting rather than deleting.
  const ROUTE = readFileSync('app/api/assistant/chat/route.ts', 'utf8')
  check('the route still does not put usage in the prompt',
    !/checkUsageCap\([\s\S]{0,400}systemPrompt|usage[A-Za-z]*\s*\}\s*\)\s*=>\s*`/.test(ROUTE)
      && !/\$\{[^}]*used[^}]*\}/.test(ROUTE),
    'if usage IS available now, the never-calculate rule has to be rewritten, not dropped')
}

// ── house style, on text a model will echo ──────────────────────────────────
//
// Whatever the doc is written in, the assistant writes back in. Scoped to the
// generated block, which is the part this change owns.
{
  const a = DOC.indexOf('Every number below is read')
  const b = DOC.indexOf('Some platforms above also sit behind')
  check('the generated plan block was found', a > 0 && b > a, `${a}..${b}`)
  const block = DOC.slice(a, b)
  // PER LINE, and the spaced-hyphen test only applies mid-line. Run over the
  // whole block, `\s-\s` matches the newline before every markdown bullet, so
  // the clause failed on correct text and would have been "fixed" by deleting
  // it. Caught because the debug print showed no offending line at all.
  const dashy = block.split('\n')
    .filter((l) => /[—–]/.test(l) || /\S \- \S/.test(l))
  check('no dash punctuation in the generated plan block',
    dashy.length === 0,
    dashy.slice(0, 3).join(' | '))
  check('no year stamped into it', !/\b20\d{2}\b/.test(block))
  check('no "1 slots" style plural slips',
    !/\b1 (?:slots|sites|seats|sends)\b/.test(block),
    'it reads as a typo to the customer and as noise to the model quoting it')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
