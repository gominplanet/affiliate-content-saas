/**
 * FIVE NEW NICHE GROUP KITS A MONTH (Seb, 2026-10-05).
 *
 * Checked before the write, counted once the kit exists, said on the page
 * before the button, and a niche's cover and icon need its kit, so the images
 * cannot be made around the count.
 *
 * Run: npx tsx scripts/test-niche-kit-limit.ts
 */
import { readFileSync } from 'node:fs'
import { NICHE_KITS_PER_MONTH, utcMonthStart, nicheKitLimitMessage } from '../lib/niche-kit-limit'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }

check('five a month', NICHE_KITS_PER_MONTH === 5)
check('the month starts on the 1st, UTC', utcMonthStart(new Date('2026-10-31T23:00:00Z')).toISOString() === '2026-10-01T00:00:00.000Z')
check('the refusal says they can still set Groups up by hand, and when it resets', /by hand/.test(nicheKitLimitMessage()) && /on the 1st/.test(nicheKitLimitMessage()))

const G = read('app/api/social-launch-kit/generate/route.ts')
const lock = G.indexOf('if (existingKit?.kit)')
const limit = G.indexOf('const usage = await nicheKitUsage(user.id)')
check('reopening a kit already made never counts (the made-lock comes first)', lock > 0 && lock < limit)
check('checked before any paid call', limit > 0 && limit < G.indexOf('new Anthropic('))
check('admin is not limited', /if \(niche && !isAdmin\) \{\s*const usage/.test(G))
check('counted only once the kit exists', G.indexOf('recordNicheKit(user.id, tier)') > G.indexOf('recordAnthropicUsage(msg'))
const I = read('app/api/social-launch-kit/image/route.ts')
check('a niche cover needs its kit', /if \(niche && !existingKit\?\.kit\) \{/.test(I))
const S = read('app/api/social-launch-kit/saved/route.ts')
check('the page is told the count on load', /nicheKits = isAdmin \? null : await nicheKitUsage\(user\.id\)/.test(S))
const L = read('components/launch-kit/LaunchKit.tsx')
check('the niche bar says how many are left', /new niche Group kits made this month/.test(L) && /usage=\{nicheKits\}/.test(L))

if (failures.length) {
  console.error('❌ niche-kit-limit guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ niche-kit-limit guard passed (5 new niche Group kits a month, said up front)')
