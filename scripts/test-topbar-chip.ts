/**
 * THE BLOG SWITCHER STAYS CLICKABLE.
 *
 * The phone layout let the site chip's wrapper shrink (min-w-0); on a crowded
 * topbar it went to zero width while its text stayed visible, the search box
 * slid over it, and a Pro member with two blogs could no longer switch.
 * The chip never shrinks; the search box is what gives way.
 *
 * Run: npx tsx scripts/test-topbar-chip.ts
 */
import { readFileSync } from 'node:fs'
const S = readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')
const T = readFileSync('components/layout/TopbarSearch.tsx', 'utf8')
const failures: string[] = []
if (!/<div className="hidden sm:block flex-shrink-0"><SiteSwitcherChip/.test(S)) failures.push('the site chip wrapper must not shrink')
if (/min-w-0"><SiteSwitcherChip/.test(S)) failures.push('the site chip wrapper is shrinkable again')
if (!/['"]relative hidden md:block w-full max-w-72['"]/.test(T)) failures.push('the search box must be the one that narrows')
// The new look's wide box (lib/look) has no cap of its own; its wrapper is the
// part that shrinks (min-w-0 flex-1), so the chip still never gives way.
if (!/wide \? 'relative hidden md:block w-full' :/.test(T) || !/<div className=\{cn\('min-w-0 flex-1', teal \? 'md:max-w-xl'/.test(S)) failures.push('the new look\'s wide search box must shrink, never the chip')
if (failures.length) { console.error('❌ topbar-chip guard failed:\n  - ' + failures.join('\n  - ')); process.exit(1) }
console.log('✓ topbar-chip guard passed (the blog switcher is never covered by the search box)')
