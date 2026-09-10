// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A favourited brand means THAT brand, not everyone who mentions it.
//
// "Message all" on a Levoit watchlist entry opened a window addressed to 14
// brands. Thirteen were other sellers: replacement filters, compatible parts,
// comparison listings, all with Levoit in the product title and a different
// company in brand_name. Pressing send would have put thirteen messages out
// from the creator's own Amazon account, to brands they never chose, with no
// way to unsend them.
//
// The cause was a matcher written for a different job. brandMatches accepts the
// label in the brand OR the title, because Amazon leaves brand_name null often
// enough that a title-only match is the only way to find those campaigns. That
// looseness is right for finding and wrong for acting.
//
// brandIsSeller is the acting version: a named brand is the authority, and the
// title is consulted only when there is no brand at all.
import { brandIsSeller, brandMatches } from '../lib/brand-match'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the campaigns that ARE the brand's ──────────────────────────────────────
{
  check('an exact brand matches', brandIsSeller('Levoit', 'Levoit', 'Levoit Core 300 Air Purifier'))
  check('case does not matter', brandIsSeller('levoit', 'LEVOIT', 'whatever'))
  check('a brand variant matches', brandIsSeller('Levoit', 'Levoit Technology', 'Air Purifier'),
    'Amazon returns the same brand under several names, which is why the matcher is fuzzy at all')

  // The null-brand case is the entire reason the loose match exists, and it has
  // to keep working: no brand recorded, so the title is all there is.
  check('a null brand falls back to the title', brandIsSeller('Levoit', null, 'Levoit Core 300 Air Purifier'))
  check('an empty brand falls back to the title', brandIsSeller('Levoit', '   ', 'Levoit Smart Humidifier'))
}

// ── the thirteen that were not ──────────────────────────────────────────────
{
  // This one assertion is the bug. The loose matcher says yes; the acting
  // matcher must say no.
  const otherSeller = ['Levoit', 'FilterPro', 'Replacement Filter for Levoit Core 300'] as const
  check('a different seller is NOT the brand', !brandIsSeller(...otherSeller),
    'this is the assertion that stops thirteen unwanted messages')
  check('and the loose matcher genuinely disagreed', brandMatches(otherSeller[0], otherSeller[1], otherSeller[2]),
    'if this ever fails, the two matchers have converged and this test proves nothing')

  check('a comparison listing is not the brand',
    !brandIsSeller('Levoit', 'Winix', 'Winix vs Levoit: which air purifier wins'))
  check('a compatible-part listing is not the brand',
    !brandIsSeller('Dreame', 'VacParts Co', 'Brush roll compatible with Dreame X30'))
  // A named brand is the authority in BOTH directions: the title naming someone
  // else cannot disqualify a campaign the brand really does sell.
  check('a real brand still matches when the title names a rival',
    brandIsSeller('Levoit', 'Levoit', 'Better than the Winix: Levoit Core 300'))
}

// ── the boundary the original matcher was built for ─────────────────────────
{
  // "dreame" must not match "Dreamegg". Word boundaries still apply.
  check('a longer look-alike brand does not match', !brandIsSeller('Dreame', 'Dreamegg', 'Dreamegg sound machine'))
  check('a look-alike in a null-brand title does not match', !brandIsSeller('Dreame', null, 'Dreamegg white noise machine'))
}

// ── nothing to match ────────────────────────────────────────────────────────
{
  check('an empty label matches nothing', !brandIsSeller('', 'Levoit', 'Levoit Core 300'))
  check('a whitespace label matches nothing', !brandIsSeller('   ', 'Levoit', 'Levoit Core 300'))
  check('no brand and no title matches nothing', !brandIsSeller('Levoit', null, null))
  check('no brand and an unrelated title matches nothing', !brandIsSeller('Levoit', null, 'Anker power bank'))
}

if (failures.length) {
  console.error(`\n❌ brand-is-seller: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ brand-is-seller: a named brand is the authority, and the title only speaks when there is no brand')
