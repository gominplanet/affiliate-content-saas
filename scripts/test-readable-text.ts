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
check('the theme variables are re-scoped too, so text that follows --text stays readable', /--text:\s+#18181B;\s*--text-2:\s+#52525B;\s*--text-3:\s+#71717A;\s*color: #18181B;/.test(CSS))
check('a row that turns white on hover turns a dark shade in dark mode', /\.dark \.hover\\:bg-white:hover:not\(\[class\*="dark:hover:bg-"\]\)/.test(CSS))
check('the backgrounds themselves are not repainted (a white knob stays white)', !/\.dark \.bg-white:not\(\[class\*="dark:bg-"\]\)[^{]*\{[^}]*background/.test(CSS))
check('in light mode, text on a dark-only background gets the dark theme\'s colours', /html:not\(\.dark\) :is\(\.bg-black, \.bg-gray-900/.test(CSS))
check('the VA permissions panel has its own dark design', /p-3 bg-gray-50 space-y-2 dark:border-white\/10 dark:bg-white\/5/.test(AGENCY) && /text-xs text-gray-800 dark:text-gray-100">\{meta\.label\}/.test(AGENCY))

if (failures.length) { console.error('❌ readable-text:\n  - ' + failures.join('\n  - ')); process.exit(1) }
console.log('✅ readable-text: text on a light-only background is dark in dark mode, and the other way round')
