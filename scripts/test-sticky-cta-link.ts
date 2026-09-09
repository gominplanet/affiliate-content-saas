// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The floating bar has to point where the article's buy button points.
//
// Fix Affiliate Links re-pointed a post to Passport. The in-article button
// became mvpl.ink/d9jycjr, correctly. The floating bar at the bottom of the page
// still went somewhere else, and the app reported "Done" because the content it
// checked really had been fixed.
//
// The bar is not in the post body. The WordPress plugin renders it in wp_footer
// and picks its own URL by scanning the content, first match wins, in a fixed
// order. Passport was not in that order at all, so the bar skipped the new link
// and fell through to the amazon.* rule, which matched a comparison-block
// amazon.com/s?k=... SEARCH link. The most prominent button on the page ended up
// pointing at a search box.
//
// Same lesson as styleOfUrl and asinFromAmazonUrl, in a third place: an Amazon
// URL is not automatically a buy link, and a list of known link shapes has to be
// updated everywhere it exists, not just where it was first written.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WP_VERSIONS } from '../lib/wp-versions'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const PLUGIN = readFileSync(join(root, 'wp-plugin/mvpaffiliate-platform/mvpaffiliate-platform.php'), 'utf8')

// Just the sticky-CTA function, so a mvpl.ink mention elsewhere cannot pass this.
const at = PLUGIN.indexOf('function mvp_affiliate_render_sticky_cta')
check('the sticky CTA renderer is findable', at > 0)
const fn = PLUGIN.slice(at, at + 2600)

check('Passport is recognised at all', /mvpl\\\\?\\.ink/.test(fn) || /mvpl\\.ink/.test(fn),
  'a post re-pointed to Passport had its bar skip the new link entirely')
check('and the app-origin /go/ fallback too', /\/go\//.test(fn),
  'links minted before the branded domain existed are still live')
check('Passport is matched BEFORE geni.us',
  fn.indexOf('mvpl') < fn.indexOf('geni'),
  'first match wins, so a post carrying both would keep showing the old link')
check('the amazon fallback requires a PRODUCT path',
  /dp\|gp\/product\|gp\/aw\/d\|clp/.test(fn),
  'matching any amazon URL is how the bar ended up pointing at amazon.com/s?k=')
check('and no longer matches a bare amazon host with any path',
  !/amazon\\\\.\[a-z\.\]\+\/\[\^/.test(fn.replace(/\s+/g, '')),
  'the old rule was amazon.[a-z.]+/<anything>')

// The plugin ships to sites by version, so a fix nobody can install is not a fix.
const v = WP_VERSIONS.plugin.version
const headerV = PLUGIN.match(/^ \* Version: (.+)$/m)?.[1]?.trim()
check('the plugin header and the app registry agree on the version',
  headerV === v, `header ${headerV}, registry ${v}`)
check('and the version is past the one that lacked Passport',
  (() => {
    const p = v.split('.').map(Number), q = [1, 0, 94]
    for (let i = 0; i < 3; i++) { if ((p[i] ?? 0) !== q[i]) return (p[i] ?? 0) > q[i] }
    return true
  })(),
  'sites update by version; 1.0.93 and earlier draw the bar without Passport')

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
