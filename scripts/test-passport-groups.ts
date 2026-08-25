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

console.log('channelForSource — source → MVP-<CHANNEL> group (per platform, like Geniuslink)')
{
  check('null → MVP-GENERAL', channelForSource(null) === 'MVP-GENERAL')
  check('empty → MVP-GENERAL', channelForSource('') === 'MVP-GENERAL')
  check('blog → MVP-BLOG', channelForSource('blog') === 'MVP-BLOG')
  check('BLOG (case) → MVP-BLOG', channelForSource('BLOG') === 'MVP-BLOG')
  check('pinterest → MVP-PINTEREST', channelForSource('pinterest') === 'MVP-PINTEREST')
  // Each social platform now gets its OWN group (not a lumped "Social").
  check('facebook → MVP-FACEBOOK', channelForSource('facebook') === 'MVP-FACEBOOK')
  check('twitter → MVP-TWITTER', channelForSource('twitter') === 'MVP-TWITTER')
  check('x → MVP-TWITTER', channelForSource('x') === 'MVP-TWITTER')
  check('threads → MVP-THREADS', channelForSource('threads') === 'MVP-THREADS')
  check('linkedin → MVP-LINKEDIN', channelForSource('linkedin') === 'MVP-LINKEDIN')
  check('telegram → MVP-TELEGRAM', channelForSource('telegram') === 'MVP-TELEGRAM')
  check('bluesky → MVP-BLUESKY', channelForSource('bluesky') === 'MVP-BLUESKY')
  check('instagram → MVP-INSTAGRAM', channelForSource('instagram') === 'MVP-INSTAGRAM')
  check('tiktok → MVP-TIKTOK', channelForSource('tiktok') === 'MVP-TIKTOK')
  // Legacy blanket 'social' source (links minted before the per-channel split).
  check('social (legacy) → MVP-SOCIAL', channelForSource('social') === 'MVP-SOCIAL')
  check('epc → MVP-EPC', channelForSource('epc') === 'MVP-EPC')
  check('scout → MVP-SCOUT', channelForSource('scout') === 'MVP-SCOUT')
  check('video → MVP-YOUTUBE', channelForSource('video') === 'MVP-YOUTUBE')
  check('youtube → MVP-YOUTUBE', channelForSource('youtube') === 'MVP-YOUTUBE')
  check('11-char video id → MVP-YOUTUBE', channelForSource('dQw4w9WgXcQ') === 'MVP-YOUTUBE')
  check('id with - and _ → MVP-YOUTUBE', channelForSource('a1_b2-c3D4E') === 'MVP-YOUTUBE')
  check('unknown short token → MVP-GENERAL', channelForSource('promo') === 'MVP-GENERAL')
  // A source with punctuation Amazon's ascsubtag can carry; normalizeSource strips
  // spaces so this collapses and must not crash.
  check('weird source → MVP-GENERAL', channelForSource('some random thing!') === 'MVP-GENERAL')
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
