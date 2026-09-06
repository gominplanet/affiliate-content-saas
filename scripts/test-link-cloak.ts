// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Unit tests for the unified link-style decision (lib/link-cloak pickLinkStyle) —
// the single source of truth for which cloaker MVP uses for a creator, applied
// everywhere. Bugs here would silently send every link through the wrong service
// (or leak Geniuslink/Bitly when the creator picked something else).

import { pickLinkStyle, geniuslinkCreds } from '../lib/link-style'

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

// ── Keys saved, no mode ever chosen ─────────────────────────────────────────
// The bug this covers reached a published YouTube description: a creator with
// working Geniuslink credentials had no stored mode (the column arrived after
// the keys did, and a save from another screen used to blank it), so every link
// resolved to 'direct' and shipped a plain Amazon URL. Nobody pays for
// Geniuslink API credentials and then wants them ignored, so silence now reads
// as "use the thing they connected".
console.log('\npickLinkStyle — an unset mode reads the creator\'s credentials')
{
  check('no mode + geniuslink keys → geniuslink',
    pickLinkStyle({ passportEligible: false, mode: '', hasBitly: false, hasGeniuslink: true }) === 'geniuslink')
  check('null mode + geniuslink keys → geniuslink',
    pickLinkStyle({ passportEligible: false, mode: null, hasBitly: false, hasGeniuslink: true }) === 'geniuslink')
  check('whitespace mode + geniuslink keys → geniuslink',
    pickLinkStyle({ passportEligible: false, mode: '   ', hasBitly: false, hasGeniuslink: true }) === 'geniuslink')
  check('no mode + no keys → direct',
    pickLinkStyle({ passportEligible: false, mode: '', hasBitly: false, hasGeniuslink: false }) === 'direct')

  // Silence is read; an actual choice is obeyed. A creator who picked Direct
  // with their keys still on file keeps getting plain links.
  check('EXPLICIT direct beats stored geniuslink keys',
    pickLinkStyle({ passportEligible: false, mode: 'direct', hasBitly: false, hasGeniuslink: true }) === 'direct')
  // Bitly is a shortener a creator may have connected for something else, so an
  // unset mode never promotes it on its own.
  check('no mode + only a bitly token → direct',
    pickLinkStyle({ passportEligible: false, mode: '', hasBitly: true, hasGeniuslink: false }) === 'direct')
  check('passport still wins over an unset mode with keys',
    pickLinkStyle({ passportEligible: true, mode: '', hasBitly: false, hasGeniuslink: true }) === 'passport')
}

// ── The keys a wrap actually calls with ─────────────────────────────────────
// Every generator reads the creator's row for itself and then checks "style is
// geniuslink AND my row has keys". When those two reads disagree the style says
// Geniuslink, the keys read as missing, and the feature publishes a plain link
// with nothing on screen to explain it. getLinkStyle's keys came from the row it
// made the decision from, so they are the authority.
console.log('\ngeniuslinkCreds — the decision and the keys come from one row')
{
  const cfg = { geniuslinkKey: 'cfg-key', geniuslinkSecret: 'cfg-secret' }
  check('a caller row with keys is used as given',
    geniuslinkCreds(cfg, { geniuslink_api_key: 'row-key', geniuslink_api_secret: 'row-secret' })?.key === 'row-key')
  check('an empty caller row falls back to the resolved style\'s keys',
    geniuslinkCreds(cfg, null)?.key === 'cfg-key')
  check('a caller row missing only the secret still wraps',
    geniuslinkCreds(cfg, { geniuslink_api_key: 'row-key' })?.secret === 'cfg-secret')
  check('whitespace is not a credential',
    geniuslinkCreds({ geniuslinkKey: '  ', geniuslinkSecret: '  ' }, null) === null)
  check('no keys anywhere → null, the one honest reason to skip Geniuslink',
    geniuslinkCreds({ geniuslinkKey: null, geniuslinkSecret: null }, {}) === null)
  check('a key with no secret is not a usable pair',
    geniuslinkCreds({ geniuslinkKey: 'k', geniuslinkSecret: null }, null) === null)
}

if (failures > 0) {
  console.error(`\n✗ ${failures} link-cloak assertion(s) failed.`)
  process.exit(1)
}
console.log('\n✓ All link-cloak tests passed.')
