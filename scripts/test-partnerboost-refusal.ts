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

// A token is checked with PartnerBoost before "Connected" is shown, a GET
// refused as an unknown publisher is retried as the documented POST, a saved
// key that cannot be read is never swapped for the shared env key, and brands
// whose products are refused are counted, not read as empty.
const SAVE = readFileSync('app/api/integrations/external/route.ts', 'utf8')
const SVC = readFileSync('services/partnerboost/index.ts', 'utf8')
const KEYS = readFileSync('lib/external-keys.ts', 'utf8')
check('a PartnerBoost token is verified before it is saved', /verifyPartnerBoostToken\(cleanPastedKey\(key\)\)/.test(SAVE) && /if \(!check\.known\)/.test(SAVE) && /status: 422/.test(SAVE))
check('a good token clears the 12 hour sync back-off', /pb_sync_failed:\$\{g\.userId\}/.test(SAVE))
check('a refused GET is retried as POST JSON', /code !== 1000 && first\?\.status\?\.code !== 1001\) return first/.test(SVC) && /method: 'POST'/.test(SVC))
check('an unreadable saved key is not replaced by the env key', /saved key could not be decrypted[\s\S]{0,40}return null/.test(KEYS))
check('product feeds that fail are counted, retried when the connection drops, and said apart', /productErrors\+\+/.test(SW) && /productDropped\+\+/.test(SW) && /attempt < 5/.test(SW) && /connection to PartnerBoost dropped/.test(UI) && /PartnerBoost refused the products of/.test(UI))
check('"Too many request" pauses every worker and is retried, not counted as a refusal', /isThrottle\(msg\)\) \{[\s\S]{0,200}pauseUntil = Math\.max/.test(SW) && /MIN_GAP_MS = 250/.test(SW) && /asked MVP to slow down/.test(UI))
check('a sync with unreadable brands never purges their saved products', /purgeSafe = rows\.length > 0 && !timedOut && productErrors === 0/.test(SW))
check('no screen sends people to an "All Channels" token any more', !/copy the "All Channels"|All-Channels API token|Token Manage → All Channels/.test(SW + FI + readFileSync('components/integrations/ExternalKeyConnect.tsx', 'utf8') + readFileSync('app/(dashboard)/partnerboost/page.tsx', 'utf8')))

if (failures.length) {
  console.error(`\n❌ partnerboost-refusal: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ partnerboost-refusal: a refused token is said, and a stale catalog is called stale')
