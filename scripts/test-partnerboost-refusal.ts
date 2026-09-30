// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A REFUSED PARTNERBOOST TOKEN IS A FAILURE, NEVER "0 PRODUCTS, OK".
//
// The brand list's error was swallowed, so a token PartnerBoost stopped
// accepting produced an empty sweep, a sync reported as successful, and a
// cache that froze for five weeks while the Finder called it "instant".
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const SW = readFileSync('lib/partnerboost-sweep.ts', 'utf8')
const FI = readFileSync('app/api/partnerboost/finder/route.ts', 'utf8')
const UI = readFileSync('components/partnerboost/PartnerBoostFinder.tsx', 'utf8')

check('the sweep keeps what PartnerBoost said when the brand list fails',
  /catch \(e\) \{ if \(!brandListError\) brandListError = /.test(SW) && /brandListOk = true/.test(SW))
check('a sync with no brand list answer throws, in PartnerBoost\'s words, and keeps the cache',
  /if \(!brandListOk && brandListError\) \{/.test(SW) && /no longer accepts your API token/.test(SW)
  && SW.indexOf('if (!brandListOk && brandListError)') < SW.indexOf("from('pb_finder_cache').upsert"))
check('the live Finder scan says so too', /if \(!brandListOk && brandListError\) \{/.test(FI) && /status: 502/.test(FI))
check('a catalog older than two days is called stale, not instant',
  /> 2 \* 86_400_000/.test(UI) && /The automatic refresh has not succeeded since then/.test(UI))

if (failures.length) {
  console.error(`\n❌ partnerboost-refusal: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ partnerboost-refusal: a refused token is said, and a stale catalog is called stale')
