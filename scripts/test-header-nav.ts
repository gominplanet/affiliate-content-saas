// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The blog header menu never stacks into a column (a member, 2026-10-09: "the
// categories are in a vertical orientation and make my blog look like
// garbage"). A long tagline plus the Ask and Work with us pills squeezed the
// menu to the width of one label, and every category went on its own line.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let failed = 0
function check(name: string, ok: boolean) {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}`) }
}
const css = readFileSync(join(process.cwd(), 'wp-plugin/mvp-affiliate-theme/assets/css/main.css'), 'utf8')
const js = readFileSync(join(process.cwd(), 'wp-plugin/mvp-affiliate-theme/assets/js/main.js'), 'utf8')

const brand = css.match(/\.mvp-header-brand \{[^}]*\}/)?.[0] ?? ''
check('the brand has a width ceiling, so a long tagline cannot take the row', /max-width:\s*\d+px/.test(brand))
check('the tagline wraps to two lines at most', /\.mvp-header-tagline \{[^}]*-webkit-line-clamp:\s*2/.test(css))
check('a menu label never breaks over two lines', /\.mvp-nav-menu a \{[^}]*white-space:\s*nowrap/.test(css))
check('the menu can shrink without forcing the row wider', /\.mvp-header-nav \{[^}]*min-width:\s*0/.test(css))
check('a crowded menu moves to its own full-width row', /\.mvp-header--two-row \.mvp-header-nav \{[^}]*flex-basis:\s*100%/.test(css))
check('the script measures the one-row layout before choosing', /classList\.remove\('mvp-header--two-row'\)[\s\S]*offsetTop[\s\S]*classList\.add\('mvp-header--two-row'\)/.test(js))
check('it re-measures when the plugin injects its header pills', /MutationObserver/.test(js))

if (failed) { console.error(`\n${failed} header check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
