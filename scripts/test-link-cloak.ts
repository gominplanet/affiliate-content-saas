// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Unit tests for the unified link-style decision (lib/link-cloak pickLinkStyle) —
// the single source of truth for which cloaker MVP uses for a creator, applied
// everywhere. Bugs here would silently send every link through the wrong service
// (or leak Geniuslink/Bitly when the creator picked something else).

import { pickLinkStyle } from '../lib/link-cloak'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('pickLinkStyle — priority + credential fallbacks')
{
  // Passport (eligible) always wins, whatever the stored mode is.
  check('passport eligible wins over geniuslink mode',
    pickLinkStyle({ passportEligible: true, mode: 'geniuslink', hasBitly: true, hasGeniuslink: true }) === 'passport')
  check('passport eligible wins over bitly mode',
    pickLinkStyle({ passportEligible: true, mode: 'bitly', hasBitly: true, hasGeniuslink: true }) === 'passport')

  // Passport not eligible → the stored mode decides.
  check('not eligible + geniuslink (with keys) → geniuslink',
    pickLinkStyle({ passportEligible: false, mode: 'geniuslink', hasBitly: false, hasGeniuslink: true }) === 'geniuslink')
  check('not eligible + bitly (with token) → bitly',
    pickLinkStyle({ passportEligible: false, mode: 'bitly', hasBitly: true, hasGeniuslink: false }) === 'bitly')
  check('not eligible + direct → direct',
    pickLinkStyle({ passportEligible: false, mode: 'direct', hasBitly: false, hasGeniuslink: false }) === 'direct')

  // A chosen style with no creds downgrades to direct (never fail to make a link).
  check('bitly mode but no token → direct',
    pickLinkStyle({ passportEligible: false, mode: 'bitly', hasBitly: false, hasGeniuslink: false }) === 'direct')
  check('geniuslink mode but no keys → direct',
    pickLinkStyle({ passportEligible: false, mode: 'geniuslink', hasBitly: false, hasGeniuslink: false }) === 'direct')

  // Missing / garbage mode → direct.
  check('null mode → direct', pickLinkStyle({ passportEligible: false, mode: null, hasBitly: false, hasGeniuslink: false }) === 'direct')
  check('unknown mode → direct', pickLinkStyle({ passportEligible: false, mode: 'sparkle', hasBitly: false, hasGeniuslink: false }) === 'direct')
  check('GENIUSLINK (case) with keys → geniuslink', pickLinkStyle({ passportEligible: false, mode: 'GENIUSLINK', hasBitly: false, hasGeniuslink: true }) === 'geniuslink')
}

if (failures > 0) {
  console.error(`\n✗ ${failures} link-cloak assertion(s) failed.`)
  process.exit(1)
}
console.log('\n✓ All link-cloak tests passed.')
