// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TEXT IS ALWAYS READABLE, IN EITHER MODE (Seb, 2026-10-08: a member could
// barely read the VA permissions panel in dark mode: white text on a light
// panel). Pins the safety net in app/globals.css and the panel's own fix.
import { readFileSync } from 'node:fs'
const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const CSS = readFileSync('app/globals.css', 'utf8')
const AGENCY = readFileSync('app/(dashboard)/agency/page.tsx', 'utf8')

for (const c of ['bg-white', 'bg-gray-50', 'bg-gray-100']) {
  check(`in dark mode, text on a light-only ${c} gets the light theme's colours`,
    new RegExp(`\\.dark \\.${c}:not\\(\\[class\\*="dark:bg-"\\]\\)`).test(CSS))
}
check('the theme variables are re-scoped too, so text that follows --text stays readable', /--text:\s+#18181B;\s*--text-2:\s+#52525B;\s*--text-3:\s+#71717A;\s*--text-soft:\s+rgba\(0,0,0,0\.78\);\s*--text-subtle:\s+rgba\(0,0,0,0\.68\);\s*--text-faint:\s+rgba\(0,0,0,0\.55\);\s*--text-dim:\s+rgba\(0,0,0,0\.40\);\s*color: #18181B;/.test(CSS))
// A POPUP OUTSIDE THE SHELL (Seb, 2026-10-17): the soft and faint shades were
// set only on the dashboard shell's own element, so What's new and every
// other popup drawn onto the page showed its grey words in full black or
// white. They are set for the whole page now, for both themes.
check('the soft and faint shades are set for the whole page, light and dark', ['--text-soft', '--text-subtle', '--text-faint', '--text-dim'].every(v => {
  const root = CSS.slice(CSS.indexOf(':root'), CSS.indexOf('.dark {'))
  const dark = CSS.slice(CSS.indexOf('.dark {'), CSS.indexOf('}', CSS.indexOf('.dark {')))
  return root.includes(v + ':') && dark.includes(v + ':')
}))
check('a row that turns white on hover turns a dark shade in dark mode', /\.dark \.hover\\:bg-white:hover:not\(\[class\*="dark:hover:bg-"\]\)/.test(CSS))
check('the backgrounds themselves are not repainted (a white knob stays white)', !/\.dark \.bg-white:not\(\[class\*="dark:bg-"\]\)[^{]*\{[^}]*background/.test(CSS))
check('in light mode, text on a dark-only background gets the dark theme\'s colours', /html:not\(\.dark\) :is\(\.bg-black, \.bg-gray-900/.test(CSS))
check('the VA permissions panel has its own dark design', /p-3 bg-gray-50 space-y-2 dark:border-white\/10 dark:bg-white\/5/.test(AGENCY) && /text-xs text-gray-800 dark:text-gray-100">\{meta\.label\}/.test(AGENCY))

if (failures.length) { console.error('❌ readable-text:\n  - ' + failures.join('\n  - ')); process.exit(1) }
console.log('✅ readable-text: text on a light-only background is dark in dark mode, and the other way round')
