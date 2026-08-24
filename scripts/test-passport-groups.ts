// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Unit tests for Passport Links group helpers — the pure functions behind the
// Geniuslink-style groups feature (migration 292).
//
// Why a real test: channelForSource() decides which group every new link lands
// in, AND its logic is duplicated as a SQL CASE in the migration backfill. If the
// two drift, existing links and new links end up in different groups. This pins
// the mapping so a refactor on either side is caught. cleanGroupName() guards the
// create/rename paths.
//
// Run: `npm run test:access`-style, wired into `npm run build`.

import { channelForSource, cleanGroupName } from '../lib/passport-links'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('channelForSource — source → channel group')
{
  check('null → General', channelForSource(null) === 'General')
  check('empty → General', channelForSource('') === 'General')
  check('blog → Blog', channelForSource('blog') === 'Blog')
  check('BLOG (case) → Blog', channelForSource('BLOG') === 'Blog')
  check('pinterest → Pinterest', channelForSource('pinterest') === 'Pinterest')
  check('social → Social', channelForSource('social') === 'Social')
  check('facebook → Social', channelForSource('facebook') === 'Social')
  check('twitter → Social', channelForSource('twitter') === 'Social')
  check('threads → Social', channelForSource('threads') === 'Social')
  check('linkedin → Social', channelForSource('linkedin') === 'Social')
  check('telegram → Social', channelForSource('telegram') === 'Social')
  check('bluesky → Social', channelForSource('bluesky') === 'Social')
  check('epc → EPC', channelForSource('epc') === 'EPC')
  check('scout → SCOUT', channelForSource('scout') === 'SCOUT')
  check('video → YouTube', channelForSource('video') === 'YouTube')
  check('youtube → YouTube', channelForSource('youtube') === 'YouTube')
  check('11-char video id → YouTube', channelForSource('dQw4w9WgXcQ') === 'YouTube')
  check('id with - and _ → YouTube', channelForSource('a1_b2-c3D4E') === 'YouTube')
  check('unknown short token → General', channelForSource('promo') === 'General')
  // A source with punctuation Amazon's ascsubtag can carry; normalizeSource strips
  // spaces so this collapses and must not crash.
  check('weird source → General', channelForSource('some random thing!') === 'General')
}

console.log('\ncleanGroupName — trim, collapse, cap')
{
  check('trims', cleanGroupName('  Holiday  ') === 'Holiday')
  check('collapses inner whitespace', cleanGroupName('Black   Friday') === 'Black Friday')
  check('empty → empty', cleanGroupName('   ') === '')
  check('null → empty', cleanGroupName(null) === '')
  check('caps at 60 chars', cleanGroupName('x'.repeat(80)).length === 60)
}

if (failures > 0) {
  console.error(`\n✗ ${failures} passport-groups assertion(s) failed.`)
  process.exit(1)
}
console.log('\n✓ All passport-groups tests passed.')
