// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// META ADS COUNTED ON THE BRAND'S OWN PAGE (Seb, 2026-11-06: "we need to be
// able to search for meta ads the right way.., unsure if the quotation marks
// are needed"). Pinned: a name search keeps its quotes (without them Meta
// matches any one word); SCOUT 1.57.0 finds the brand's advertiser Page from
// Meta's own suggestions, only by its exact name, never guessing between two,
// counts that Page, and falls back to the name with the reason said; MVP keeps
// the Page, hands it back next time, never replaces a known Page with "none
// found", treats a Page's ads as the brand's own, says how each count was
// taken, and links to the Page.
import { readFileSync } from 'node:fs'
import { adLibraryUrl } from '../lib/trybe-pick'
import { metaBrandOf, metaAdsWords, type MetaAdsRun } from '../components/labs/metaAdsRead'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// ── THE LINKS ────────────────────────────────────────────────────────────────
check('a name search keeps its quotes and Meta\'s exact-phrase setting', adLibraryUrl('TASTE Flavor Co.').includes('q=%22TASTE%20Flavor%20Co.%22') && adLibraryUrl('TASTE Flavor Co.').includes('search_type=keyword_exact_phrase'))
check('a known Page opens that Page, every ad it runs', adLibraryUrl('TASTE Flavor Co.', '1234567890') === 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&is_targeted_country=false&media_type=all&search_type=page&view_all_page_id=1234567890')
check('a Page id that is not a number is not used', adLibraryUrl('X', 'abc') === adLibraryUrl('X'))

// ── WHAT MVP SENDS SCOUT ─────────────────────────────────────────────────────
check('a brand goes with its kept Page, or asked to be looked for', JSON.stringify(metaBrandOf({ brand_id: 'b1', name: 'A', page_id: '123456' })) === JSON.stringify({ brandId: 'b1', name: 'A', pageId: '123456' })
  && JSON.stringify(metaBrandOf({ brand_id: 'b2', name: 'B', find_page: true })) === JSON.stringify({ brandId: 'b2', name: 'B', findPage: true })
  && JSON.stringify(metaBrandOf({ brand_id: 'b3', name: 'C' })) === JSON.stringify({ brandId: 'b3', name: 'C' }))

// ── WHAT THE RUN SAYS ────────────────────────────────────────────────────────
const base: MetaAdsRun = { total: 10, read: 10, noCount: 0, couldNot: 0, late: 0, notEnglish: '', stopped: '', cardsAsked: false, cardsSent: false, galleryAds: 0, cardsMissed: 0, looked: 0, picked: false, notOwn: 0, capped: 0, mixed: 0, doubled: 0, saved: 10, kept: 0, byPage: 7, byPhrase: 3, pageMissed: 3, pageWhys: { 'no-advertiser-named-so': 2, 'several-advertisers-named-so': 1 } }
const words = metaAdsWords(base).text
check('the run says how many were counted on the brand\'s own Page and how many by name, and why no Page', /7 counted on the brand’s own Facebook Page, 3 by the brand’s exact name \(no Page used for 3: 2 because Meta suggested no advertiser with that name, 1 because more than one advertiser has that name\)/.test(words))
check('no dashes in the words', !/[–—]| - /.test(words))

// ── SCOUT ────────────────────────────────────────────────────────────────────
const BG = read('extension/background.js')
check('SCOUT builds the Page address Meta uses', /search_type=page&view_all_page_id=' \+ encodeURIComponent/.test(BG) && /function metaPageIdIn\(url\)/.test(BG))
check('SCOUT takes only an advertiser with exactly the brand\'s name, and never guesses between two', /async function metaFindPageInPage\(name\)/.test(BG) && /norm\(firstLine\(el\)\) === want/.test(BG) && /if \(ids\.length > 1\) return \{ why: 'several-advertisers-named-so', seen \}/.test(BG) && /if \(withPicture\.length > 1\) return \{ why: 'several-advertisers-named-so', seen \}/.test(BG))
check('SCOUT counts a known Page first, falls back to the name when it does not read, and says which', /if \(pageId\) \{\s*await go\(metaAdsPageUrl\(pageId\)\)/.test(BG) && /else \{ pageWhy = 'page-not-read'; await go\(metaAdsUrl\(b\.name\)\); got = await read\(\) \}/.test(BG) && /basis, pageId: pageId \|\| null, pageName, pageWhy, pageSeen/.test(BG))
check('SCOUT only looks for a Page when MVP asks, and not on a Facebook in another language', /if \(b\.findPage && !\(got && got\.lang && !\/\^en\/\.test\(got\.lang\)\)\)/.test(BG))
const M = JSON.parse(read('extension/manifest.json'))
check('SCOUT 1.57.0 or later, the app agrees, no new permission', /^1\.(5[7-9]|[6-9]\d)\./.test(M.version) && read('lib/scout-version.ts').includes(`SCOUT_LATEST_VERSION = '${M.version}'`) && /SCOUT_META_PAGE_MIN_VERSION = '1\.57\.0'/.test(read('lib/scout-version.ts'))
  && JSON.stringify(M.permissions.slice().sort()) === JSON.stringify(['activeTab', 'alarms', 'downloads', 'scripting', 'storage', 'tabs']))

// ── MVP ──────────────────────────────────────────────────────────────────────
const R = read('app/api/labs/trybe/route.ts')
check('MVP keeps each brand\'s Page and hands it back with the brands to count; one not found is looked for again after a month', /async function metaPagesOf\(admin: Db, ids: string\[\]\)/.test(R) && /key: `metapage:\$\{id\}`/.test(R) && /if \(p\?\.id\) t\.page_id = p\.id/.test(R) && /else if \(!p \|\| Date\.now\(\) - Date\.parse\(p\.at\) > META_PAGE_RETRY_MS\) t\.find_page = true/.test(R) && /const META_PAGE_RETRY_MS = 30 \* 86_400_000/.test(R))
check('a known Page is never replaced by "none found"', /const write = pageRows\.filter\(r => r\.value\.id \|\| !kept\.get\(r\.key\.slice\('metapage:'\.length\)\)\?\.id\)/.test(R))
check('a Page\'s ads are the brand\'s own, for the count and the gallery', /const onPage = x\.basis === 'page'/.test(read('components/labs/metaAdsRead.ts')) && /const own = x\.basis === 'page' \? ads\.length : ads\.filter/.test(R))
check('every caller sends the Page along', ['components/labs/TrybeOutreach.tsx', 'components/labs/TrybeStarBrands.tsx'].every((f) => /todo\.map\(metaBrandOf\)/.test(read(f))))
check('the brand page links to its own Page when MVP has it', /metaPage: metaPage\?\.id \? \{ id: metaPage\.id, name: metaPage\.name \} : null/.test(R) && /adLibraryUrl\(title, d\?\.metaPage\?\.id\)/.test(read('components/labs/TrybeDossier.tsx')) && /Its own Page on Meta Ad Library/.test(read('components/labs/TrybeDossier.tsx')))

if (fails.length) {
  console.error(`❌ meta-page: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ meta-page: Meta ads counted on the brand\'s own Page, found from Meta\'s suggestions by exact name, the name search kept as the fallback, and each count says how it was taken')
