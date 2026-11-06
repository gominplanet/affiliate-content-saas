// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BRIEF CHECKLIST READS EVERY PLACE A PLAN IS KEPT (Seb, 2026-11-06: the
// upload said it "could not read Taste Flavor Co.'s brief checklist" because
// the saved ideas table was missing, while the plan sat on the brand's row,
// and a plan made for a sample never reached the saved ideas at all).
import { readFileSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const route = readFileSync('app/api/labs/trybe/route.ts', 'utf8')
const at = route.indexOf("if (action === 'ideas')")
const ideas = route.slice(at, route.indexOf("if (action === 'home')", at))

check('it reads the saved ideas, the samples and the brand’s row', /from\('trybe_ideas'\)/.test(ideas) && /from\('trybe_samples'\)\.select\('id, product, ideas, ideas_at'\)\.eq\('user_id', ownerId\)\.eq\('brand_id', brandId\)/.test(ideas) && /from\('trybe_brands'\)\.select\('video_plan, video_plan_at'\)/.test(ideas))
check('a missing table is said only when no place gave a plan', /\.\.\.\(!plans\.length && failed\.length \? \{ why:/.test(ideas) && !/return NextResponse\.json\(\{ ok: true, plans: \[\], why:/.test(ideas))
check('newest first, one plan per product', /found\.sort\(\(a, b\) => \(Date\.parse\(b\.created_at\) \|\| 0\) - \(Date\.parse\(a\.created_at\) \|\| 0\)\)/.test(ideas) && /if \(seen\.has\(k\)\) return false/.test(ideas))
check('a member never sees a migration number', /setupWords\(tier, 'Saved ideas need migration 429/.test(ideas))
check('the reason is never followed by a second full stop', /\{error\.replace\(\/\[\.\\s\]\+\$\/, ''\)\}\. Check the brief on TRYBE/.test(readFileSync('components/labs/TrybeBriefCheck.tsx', 'utf8')))

if (fails.length) { console.error(`✗ ${fails.length} brief checklist check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
console.log('✓ Brief checklist: reads every place a plan is kept, and says a failed read only when none gave one')
