// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EVERY MEMBER IS ASKED FOR SCOUT, AND SCOUT IS PUT TO WORK.
//
// In the week of 2026-10-06, 386 of 411 first comments went through YouTube's
// API (50 units each from the quota every account shares) because SCOUT only
// started its background work when a member opened Liftoff. Seb: "make sure
// users download and activate scout.. this is imperative". This guard keeps
// the banner on every dashboard page, the background switch-on, the due-comment
// wake, and the record of who has SCOUT.
import { readFileSync, existsSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }

const SHELL = readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')
const BANNER = readFileSync('components/layout/ScoutRequired.tsx', 'utf8')
const ROUTE = existsSync('app/api/scout/seen/route.ts') ? readFileSync('app/api/scout/seen/route.ts', 'utf8') : ''
const MIG = existsSync('supabase/migrations/414_scout_presence.sql') ? readFileSync('supabase/migrations/414_scout_presence.sql', 'utf8') : ''

check('the banner is on every dashboard page', /<ScoutRequired tier=\{String\(tier\)\} \/>/.test(SHELL))
check('it is for every member SCOUT uploads for', /usesStudioUpload\(tier\)/.test(BANNER))
check('not installed, not Chrome, too old, switched off and not answering are each said',
  ["kind: 'missing'", "'not-chrome'", "kind: 'old'", "kind: 'bg-off'", "kind: 'bg-failed'"].every((k) => BANNER.includes(k)))
check('success shows nothing', /phase\.kind === 'ok'[^\n]*return null/.test(BANNER))
check('hiding lasts this visit only, not for good', /sessionSet\(HIDE_KEY, '1'\)/.test(BANNER) && !/localStorage\.setItem\(HIDE_KEY/.test(BANNER))
check('the background work is switched on from any page', /await setLiftoffAuto\(true\)/.test(BANNER))
check('a member who switched it off is asked, not overruled', /mvp_liftoff_bg'\) === 'off'/.test(BANNER) && BANNER.indexOf("=== 'off'") < BANNER.indexOf('await setLiftoffAuto(true)'))
check('due first comments wake SCOUT', /setLiftoffAuto\(true, 1\)/.test(BANNER) && /first-comment\/scout/.test(BANNER))
check('what was found is recorded', /\/api\/scout\/seen/.test(BANNER) && /scout_seen_at/.test(ROUTE) && /scout_background/.test(ROUTE))
check('the record is the server\'s to write', /createAdminClient\(\)/.test(ROUTE) && /\.eq\('user_id', user\.id\)/.test(ROUTE))
check('migration 414 is safe to run twice', /add column if not exists scout_version/.test(MIG) && /add column if not exists scout_seen_at/.test(MIG))
check('no dashes in what the member reads', !/[–—]| - /.test((BANNER.match(/<b>[^]*?<\/>/g) || []).join(' ')))

if (failures.length) {
  console.error(`\n❌ scout-required: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ scout-required: every member is asked for SCOUT until it is installed, current and working, and it is put to work')
