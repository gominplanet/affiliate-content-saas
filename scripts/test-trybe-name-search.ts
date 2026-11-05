// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BRAND BY NAME IS FOUND (Seb, 2026-11-05: "I can find a brand like
// Alphatech Apparel really quickly by just searching for the brand. When I do
// the same thing and I search for a brand by brand name, it doesn't show up.
// We really need to fix that... Brands that match zero").
//
// Pinned here: a name search covers all of TRYBE in MVP's copy with the
// filters paused (and said), brands already messaged shown with where they
// stand, a brand the last collection missed shown and marked; and when the
// copy has no such brand, TRYBE itself is asked through SCOUT, what it finds
// is kept, and what happened is said either way.
import { readFileSync } from 'node:fs'
import { nameKey, trybeSearchPath, brandsNamed, TRYBE_SEARCH_PARAMS } from '../lib/trybe-name-lookup'
import { anyFilterOn, readFilters } from '../lib/trybe-finder'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// ── NAMES ────────────────────────────────────────────────────────────────────
check('names compare without case, spaces or marks', nameKey('Alpha Tech') === nameKey('AlphaTech') && nameKey('Alphatech Apparel').includes(nameKey('alphatech')) && nameKey("Ben & Jerry's") === 'benjerrys')

// ── WHAT SCOUT IS ASKED ──────────────────────────────────────────────────────
const BG = readFileSync('extension/background.js', 'latin1')
const allowSrc = /\{ method: 'GET', re: (\/\^\\\/backend\\\/api\\\/discovery\\\/\[\\w-\]\+\(\\\?\[\\w=&%\.-\]\*\)\?\$\/) \}/.exec(BG)?.[1]
check('SCOUT already lets MVP read TRYBE\'s brand list by any query', !!allowSrc)
const allow = allowSrc ? new RegExp(allowSrc.slice(2, -2).replace(/^/, '^').replace(/$/, '$')) : /^$/
const paths = ['Alphatech', 'Alpha Tech Apparel', "Ben & Jerry's", 'Café (Naturel)!', 'a*b~c'].flatMap((n) => TRYBE_SEARCH_PARAMS.map((p) => trybeSearchPath(p, n)))
check('every name asked stays inside what SCOUT allows, so no new SCOUT is needed', paths.every((p) => allow.test(p)))
check('the brand list is asked by name, first page', trybeSearchPath('search', 'Alpha Tech') === '/backend/api/discovery/brands?limit=75&page=1&search=Alpha%20Tech')
check('several ways of asking are tried', TRYBE_SEARCH_PARAMS.length >= 3 && TRYBE_SEARCH_PARAMS[0] === 'search')

// ── WHAT TRYBE ANSWERS ───────────────────────────────────────────────────────
const page = { data: [
  { brandId: 'abc123def', brandName: 'Alphatech Apparel', categories: ['Activewear'] },
  { brandId: 'zzz999yyy', brandName: 'Other Brand' },
  { brandId: 'bad' , brandName: 'Alphatech Fake' },
], pagination: { totalPages: 1 } }
const hits = brandsNamed(page, 'alpha tech')
check('only the brands with that name are kept, read the way a collection reads them', hits.length === 1 && hits[0].name === 'Alphatech Apparel' && hits[0].brandId === 'abc123def' && (hits[0].raw as { brandName?: string }).brandName === 'Alphatech Apparel')
check('an answer that lists nothing by that name finds nothing', brandsNamed({ data: [{ brandId: 'zzz999yyy', brandName: 'Other Brand' }] }, 'Alphatech').length === 0 && brandsNamed(null, 'Alphatech').length === 0 && brandsNamed(page, 'a').length === 0)
check('a list given bare, or as brands, is read too', brandsNamed(page.data, 'alphatech').length === 1 && brandsNamed({ brands: page.data }, 'alphatech').length === 1)

// ── THE SEARCH ───────────────────────────────────────────────────────────────
const R = read('app/api/labs/trybe/route.ts')
check('a name search pauses the filters and pay type, and says so', /const nameOnly = nameQ\.length >= 2 && !asked\.starred/.test(R) && /const filters = nameOnly \? readFilters\(null\) : asked/.test(R) && /if \(nameOnly\) payType = 'any'/.test(R) && /nameSearch: nameOnly \? \{ query: nameQ, pausedFilters \} : null/.test(R))
check('the filters it paused are only said when some were on', anyFilterOn(readFilters({ minPerVideo: 25 })) && !anyFilterOn(readFilters(null)))
check('a name search shows brands already messaged, with where they stand', /const includeMine = nameOnly \|\| body\.includeMine === true/.test(R) && /const shown = includeMine \? ranked/.test(R))
check('"Alpha Tech" finds "Alphatech" too', /nameQ\.replace\(\/\\s\+\/g, ''\)/.test(R) && /name\.ilike\."%\$\{v\}%"/.test(R))
check('a brand the last collection missed is shown and marked, not hidden', /if \(since && !nameOnly\) q = q\.gte\('last_seen_at', since\)/.test(R) && /not_listed: nameOnly && !!since && !!r\.last_seen_at && r\.last_seen_at < since/.test(R) && /last_seen_at, raw'/.test(R))
check('a quote or star in the name cannot break the search', R.includes(String.raw`body.name.replace(/[%,()_\\"*]/g, ' ')`))

// ── THE PAGE ─────────────────────────────────────────────────────────────────
const U = read('components/labs/TrybeOutreach.tsx')
check('nothing in the copy: TRYBE itself is asked, once per name', /lookedUp\.current\.has\(key\)/.test(U) && /requestTrybeApi\('GET', trybeSearchPath\(param, q\)\)/.test(U))
check('what TRYBE finds is kept like a collection, and the search runs again', /await api\(\{ action: 'directory', items: hits\.map\(\(h\) => h\.raw\) \}\)/.test(U) && /setLiveNonce\(\(n\) => n \+ 1\)/.test(U))
check('SCOUT not reachable stops at once, said with its reason', /if \(!answered\) break/.test(U) && /and SCOUT could not ask TRYBE: \{l\.note \|\| 'no answer'\}/.test(U))
check('asking, found, and not found on TRYBE either are each said', /Asking TRYBE itself through SCOUT/.test(U) && /TRYBE found \{l\.names\?\.join\(', '\)\}/.test(U) && /TRYBE did not find a brand called &ldquo;\{q\}&rdquo; either/.test(U))
check('the list says it searched all of TRYBE, and that filters were paused', /Searching all of TRYBE for &ldquo;\{live\.nameSearch\.query\}&rdquo;/.test(U) && /with your filters paused while you search by name/.test(U))
check('a brand not on the list at the last check is marked', /\{b\.not_listed && <span/.test(U))
check('the page keeps what the search says about names', /nameSearch: d\.nameSearch \?\? null/.test(U))

if (fails.length) {
  console.error(`\n❌ trybe-name-search: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trybe-name-search: a brand typed by name is found over all of TRYBE, asked of TRYBE itself when MVP\'s copy lacks it, and what happened is said')
