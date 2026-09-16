// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A CAP WRITTEN IN PROSE NEXT TO THE LITERAL IS A SECOND SOURCE OF TRUTH.
//
// lib/tier.ts is the product's price list, and its comments had drifted off the
// values they sat beside. Found while answering a prospect's question about
// which plan he needed, where the comment I read said one thing and the field
// under it said another:
//
//   thumbnailsPerMonth   "The headline feature: 400 Art Director thumbnails /
//                        mo. Raised 200 -> 400" — the literal is 250.
//   pins / IG / Facebook "Raised (pins 150 -> 200, IG 100 -> 200, FB 40 -> 150)"
//                        — the literals are 150, 150 and 120. A raise that was
//                        written down and then only partly applied.
//   scriptsPerMonth      "Pro (150/mo)" in two places — the literal is 120.
//   metadataGensPerMonth "Pro 250" — the literal is 200.
//   dealsPerMonth        Amazon "(60)" — the literal is 150.
//   IG AI thumbnails     "Studio (30/mo)" — the literal is 25.
//   Deals Hub            "Studio 5/mo, Pro 30/mo" — both are null on those
//                        tiers, because a deal comes out of the shared post
//                        pool there. The comment described a model that had
//                        been replaced.
//
// Nothing user-facing was wrong: the pricing page reads TIERS and
// test-sales-page-facts holds it to that. The damage is to whoever reads this
// file next to answer a question, which is what happened.
//
// So: a number in a comment here has to agree with the field it describes. The
// check is deliberately narrow — it only fires on a claim it can RESOLVE — and
// what it cannot resolve it leaves alone rather than guessing.
import { readFileSync } from 'node:fs'
import { TIERS } from '../lib/tier'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const SRC = readFileSync('lib/tier.ts', 'utf8')
const lines = SRC.split('\n')

const TIER_BY_LABEL: Record<string, keyof typeof TIERS> = {
  trial: 'trial', free: 'trial', creator: 'creator',
  amazon: 'amazon', studio: 'studio', pro: 'pro',
}

/** The field a comment is talking about: the nearest backticked identifier that
 *  is a real cap, looking at the line itself and the few lines above it. */
function fieldNear(i: number): string | null {
  for (let j = i; j >= Math.max(0, i - 6); j--) {
    for (const m of lines[j].matchAll(/`(\w+)`/g)) {
      if (Object.prototype.hasOwnProperty.call(TIERS.pro, m[1])) return m[1]
    }
  }
  return null
}

// ── every resolvable "Tier N/mo" claim matches the field ───────────────────
{
  // A currency amount is a COST, not a cap, and those are genuinely useful in
  // this file ("$47/mo of ledger cost"). Excluded by requiring no $ in the run
  // of characters leading up to the number.
  const claim = /\b(Trial|Free|Creator|Amazon|Studio|Pro)\b[^\n$]{0,24}?\(?(\d+)\s*(?:\/\s*mo|\/\s*month|per month)\b/gi
  let resolved = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/^\s*(\*|\/\/)/.test(line)) continue
    // "the pre-2026-06-04 cap (4/month)" is a grandfathered value returned by a
    // branch, not the tier's field. Stated as history, and true.
    if (/\bpre-\d|\bwas\b|\bused to\b|\bformerly\b|\braised (?:from|to)\b|->/i.test(line)) continue

    for (const m of line.matchAll(claim)) {
      const tier = TIER_BY_LABEL[m[1].toLowerCase()]
      const stated = Number(m[2])
      const field = fieldNear(i)
      if (!tier || !field) continue // not resolvable; say nothing rather than guess
      resolved++
      const actual = (TIERS[tier] as Record<string, unknown>)[field]
      check(`${field} for ${m[1]} matches the comment`, Number(actual) === stated,
        `the comment says ${stated}, the field is ${String(actual)}`)
    }
  }

  // Zero is the CORRECT answer here today: the claims were rephrased away, so
  // there is nothing left to resolve. Which means the loop above proves nothing
  // on its own, and a check that passes because it found no work is the same
  // shape as the bug this whole file is about. So the resolver is exercised
  // against a line built here, where the right answer is known.
  console.log(`   (${resolved} tier/number claim(s) in comments were resolvable and checked)`)

  const probeField = 'scriptsPerMonth'
  const realPro = Number((TIERS.pro as Record<string, unknown>)[probeField])
  const wrong = realPro + 1
  const shape = (n: number) => ` * \`${probeField}\`. Pro (${n}/mo) is the cap.`
  const reads = (l: string) => {
    const m = l.match(/\b(Trial|Free|Creator|Amazon|Studio|Pro)\b[^\n$]{0,24}?\(?(\d+)\s*(?:\/\s*mo|\/\s*month|per month)\b/i)
    return m ? Number(m[2]) : null
  }
  check('the claim reader finds a number in a comment of this shape',
    reads(shape(wrong)) === wrong,
    'if it cannot read the pattern, the loop above skips every claim and passes on silence')
  check('and a wrong one would not equal the field', reads(shape(wrong)) !== realPro)
  check('while the right one would', reads(shape(realPro)) === realPro)
  check('a cost figure is not read as a cap', reads(' * costs about $47/mo of ledger spend') === null,
    'those are useful in this file and must not be flagged')
}

// ── the headline caps are not restated in prose at all ─────────────────────
//
// The Amazon block is where this went furthest wrong, so it is held to the
// stronger rule: describe the shape, never repeat the number.
{
  const start = SRC.indexOf('thumbnailsPerMonth: 250')
  const block = SRC.slice(Math.max(0, start - 1400), start + 700)
  const comments = block.split('\n').filter(l => /^\s*(\*|\/\/)/.test(l)).join('\n')
  for (const n of ['400', '200 -> 400', 'pins 150 -> 200', 'IG 100 -> 200', 'FB 40 -> 150']) {
    check(`the Amazon cap comments no longer claim "${n}"`, !comments.includes(n),
      'it described a raise that was written down and only partly applied')
  }
}

// ── and the values themselves are still sane ───────────────────────────────
//
// Cheap, and it catches the other direction: a cap edited to something that
// cannot be what was meant.
{
  for (const t of ['creator', 'amazon', 'studio', 'pro'] as const) {
    const v = TIERS[t] as Record<string, unknown>
    check(`${t} has a price`, typeof v.price === 'number' && (v.price as number) > 0)
    check(`${t}'s struck price is higher than its price`,
      (v.regularPrice as number) > (v.price as number),
      'the pricing page computes the saving by subtracting these two')
  }
  check('Amazon really has no blog', TIERS.amazon.sites === 0 && TIERS.amazon.postsPerMonth === 0,
    'the plan is sold as storefront-only; sites > 0 would make that copy false')
  check('Pro is the only multi-channel plan',
    TIERS.pro.youtubeChannels > 1
    && TIERS.creator.youtubeChannels === 1 && TIERS.studio.youtubeChannels === 1,
    'a creator with four channels is told Pro is the answer; this is that promise')
}

if (failures.length) {
  console.error(`\n❌ tier-comments: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ tier-comments: every number written in prose beside a cap agrees with the cap')
