// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A render is billed for the QUALITY it asked for, not the model it named.
//
// OpenAI prices gpt-image by quality. The same model at 'medium' costs about
// $0.06 and at 'high' about $0.19, and the thumbnail route has said so in a
// comment since the day it was written:
//
//   // High costs ~3x more per image (~$0.22 vs ~$0.08), so it's a Pro perk.
//   const gfxQuality = (tier === 'pro' || tier === 'admin') ? 'high' : 'medium'
//
// The billing never heard it. recordUsage was handed the bare model name, so
// every render booked at the high rate whatever quality actually ran. The
// 90-day audit is what exposed it: the two biggest image lines in the product,
// yt_thumb_graphic at $175.94 and pinterest_art_director at $48.26, were both
// substantially renders that asked for 'medium' and were charged for 'high'.
//
// This is not a dashboard cosmetic. monthlyAiSpendCeilingUsd is the thing that
// cuts a creator off mid-month, so an Amazon-tier creator was spending their
// ceiling about three times faster than their real cost, and the ceiling itself
// was sized against the same inflated number — the error compounding on both
// sides of the same decision.
//
// The rule this file pins: if the call asks for 'medium', the logged model is
// the medium-priced one. Raising a render back to 'high' is allowed, but the
// logged model has to move with it.
import { readFileSync } from 'node:fs'
import { PRICING } from '../lib/ai-usage'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const MEDIUM = 'gpt-image-1-medium'

// ── the prices this rests on are the ones in PRICING ────────────────────────
{
  check('the medium variant is priced', PRICING[MEDIUM]?.imageCost === 0.06,
    `got ${PRICING[MEDIUM]?.imageCost}; if this moves, every number below moves`)
  check('and the high-quality default is priced above it',
    (PRICING['gpt-image-2']?.imageCost ?? 0) > (PRICING[MEDIUM]?.imageCost ?? 0),
    'the whole point is that these two are not the same money')
}

// ── art-director-pin: every render asks medium, so every log says medium ────
//
// Four renders in this file (pin, blog hero, roundup pin, roundup hero). All
// four pass quality:'medium'. All four used to log gpt-image-2.
{
  const SRC = readFileSync('lib/art-director-pin.ts', 'utf8')
  const mediums = (SRC.match(/quality: 'medium'/g) ?? []).length
  const highs = (SRC.match(/quality: 'high'/g) ?? []).length
  const loggedMedium = (SRC.match(/model: 'gpt-image-1-medium', images: 1/g) ?? []).length
  const loggedFull = (SRC.match(/model: 'gpt-image-2', images: 1/g) ?? []).length

  check('every render in the pin art director asks for medium', highs === 0 && mediums === 4,
    `${mediums} medium, ${highs} high — if a render was deliberately raised to high, its log has to be raised too and this count updated`)
  check('and every one of them is billed as medium', loggedMedium === mediums,
    `${loggedMedium} logged medium against ${mediums} rendered medium`)
  check('none is still billed at the high rate', loggedFull === 0,
    'that is the $0.19-for-$0.06 charge this whole suite exists to stop')
}

// ── the thumbnail route books by quality, not by model name ─────────────────
{
  const SRC = readFileSync('app/api/youtube/generate-thumbnail/route.ts', 'utf8')

  check('render quality is still tier-gated',
    /const gfxQuality: 'medium' \| 'high' = \(tier === 'pro' \|\| tier === 'admin'\) \? 'high' : 'medium'/.test(SRC),
    'the recorded model is derived from this line; if it changes shape the derivation has to follow')

  check('and the recorded model follows the quality',
    /const gfxRecordOverride: string \| undefined =\s*\n\s*gfxQuality === 'medium' \? 'gpt-image-1-medium' : undefined/.test(SRC),
    'booking the env model name charged every non-Pro creator the Pro rate')

  // The override is only worth anything if it actually reaches recordUsage.
  const uses = (SRC.match(/model: gfxRecordOverride \?\? /g) ?? []).length
  check('the override reaches every graphic render that bills', uses >= 3,
    `only ${uses} call sites read it; one that does not is one that still over-bills`)
}

// ── the ceiling this protects is real money to a creator ────────────────────
//
// Stated as a number so the size of the mistake stays visible rather than
// becoming a comment nobody re-reads.
{
  const high = PRICING['gpt-image-2']?.imageCost ?? 0
  const med = PRICING[MEDIUM]?.imageCost ?? 0
  const perThousand = Math.round((high - med) * 1000)
  check('the gap is worth writing a test about', perThousand >= 100,
    `$${perThousand} per thousand renders`)
}

if (failures.length) {
  console.error(`\n❌ image-quality-billing: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ image-quality-billing: a medium render is billed as medium, so a creator spends their ceiling at the rate they are actually costing us')
