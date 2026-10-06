// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE OUTREACH KEEPS ITS BRAKES ON, AND SAYS WHAT HAPPENED.
//
// Seb, 2026-10-06: start at 20 requests a day and work up, with time between
// sends "so it doesn't seem like it's a bot doing it". This guard holds the
// cap (rolling 24 hours, unanswered sends counted), the gaps, the draft rules
// (no dashes, no year), and the honest outcome words on screen.
import { readFileSync } from 'node:fs'
import { clampCap, countsTowardCap, nextGapMs, sanitizeScanned, tidyDraft, sendUrl, MIN_GAP_MS, MAX_GAP_MS, BREAK_MS, DEFAULT_DAILY_CAP, cleanTerms, prefsKey, parseFit, DAILY_FIND } from '../lib/trybe-outreach'
import { pageSummary, normalizeSite } from '../lib/trybe-research'
import { readDirectoryItem, mergeDirectory, nicheScore, readCategories } from '../lib/trybe-directory'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }

// Cap
check('default cap is 20', DEFAULT_DAILY_CAP === 20 && clampCap(undefined) === 20)
check('cap is held to 1..50', clampCap(0) === 1 && clampCap(500) === 50 && clampCap(35) === 35)
const now = Date.parse('2026-10-06T12:00:00Z')
check('a sent request from 23h ago counts', countsTowardCap({ status: 'sent', send_started_at: '2026-10-05T13:00:00Z' }, now))
check('a sent request from 25h ago does not', !countsTowardCap({ status: 'sent', send_started_at: '2026-10-05T11:00:00Z' }, now))
check('an unanswered send counts', countsTowardCap({ status: 'sending', send_started_at: '2026-10-06T11:59:00Z' }, now))
check('a failed send does not', !countsTowardCap({ status: 'failed', send_started_at: null }, now))
check('already requested does not', !countsTowardCap({ status: 'already', send_started_at: '2026-10-06T11:59:00Z' }, now))

// Gaps
for (const r of [0, 0.5, 0.999]) {
  const g = nextGapMs(1, () => r)
  check(`gap ${r} is 45 to 120 seconds`, g >= MIN_GAP_MS && g <= MAX_GAP_MS)
}
check('every fifth send takes a longer break', nextGapMs(5, () => 0) >= BREAK_MS[0])
check('MIN gap is at least 45 seconds', MIN_GAP_MS >= 45_000)

// Scanned input is untrusted
check('a bad brand id is refused', sanitizeScanned({ brandId: '<script>', name: 'X' }) === null)
const ok = sanitizeScanned({ brandId: 'c147d498-df8d-47e0-98c9-156bfbfdaea5', name: ' Next  Meds ', brandUrl: 'https://evil.example/x', totalCreators: '150', trybeScore: '95', creatorEarnings: '$30K+' })
check('a good brand is kept and tidied', !!ok && ok.name === 'Next Meds' && ok.totalCreators === 150 && ok.trybeScore === 95)
check('a send address off TRYBE is dropped', !!ok && ok.brandUrl === null)
check('the fallback send address is on TRYBE', sendUrl('abc123', null).startsWith('https://jointrybe.com/creator/discover?brand='))

// Drafts
const t = tidyDraft('"Hi there — love your Pro Blender – it rocks - truly."')
check('dashes become commas, quotes trimmed', !/[—–]/.test(t) && !/ - /.test(t) && !t.startsWith('"'))
check('long drafts end on a sentence', tidyDraft('Short one. '.repeat(200), 300).endsWith('.'))

// Research parsing
const s = pageSummary('<html><head><title>Acme &amp; Co</title><meta name="description" content="Cold brew kits"></head><body><nav>Menu</nav><h1>Brew better</h1><script>x()</script><p>Our kit.</p></body></html>')
check('summary has title, description, heading, text', s.includes('Acme & Co') && s.includes('Cold brew kits') && s.includes('Brew better') && s.includes('Our kit') && !s.includes('x()') && !s.includes('Menu'))
check('a site without scheme is accepted', normalizeSite('acme.com') === 'https://acme.com/')
check('tracking params are dropped', normalizeSite('https://acme.com/?utm_source=trybe&a=1') === 'https://acme.com/?a=1')

// Prompt and screen
const LIB = readFileSync('lib/trybe-outreach.ts', 'utf8')
check('the prompt forbids a year and invented facts', /Never write a year/.test(LIB) && /NEVER invent facts/.test(LIB))
const UI = readFileSync('components/labs/TrybeOutreach.tsx', 'utf8')
check('unconfirmed is shown apart from sent', UI.includes('Not confirmed') && UI.includes("b.status === 'sent'"))
check('a draft written without the website says so', UI.includes('Website not read'))
const ROUTE = readFileSync('app/api/labs/trybe/route.ts', 'utf8')
check('the cap is enforced on the server at claim', /action === 'claim'[\s\S]*used >= settings\.dailyCap/.test(ROUTE))
check('it is Labs only', ROUTE.includes("canUsePreview('trybe_outreach'"))
const BG = readFileSync('extension/background.js', 'utf8')
check('SCOUT only reports sent when the box closed', /if \(gone\) \{ steps\.push\('closed'\); return \{ outcome: 'sent'/.test(BG))
check('a late SCOUT answer is unconfirmed, never failed', /MVP_TRYBE_SEND[\s\S]{0,200}outcome: 'unconfirmed'/.test(BG))

// THE NICHE (Seb, 2026-10-06: "not just blindly message all brands").
check('terms are trimmed, de-duplicated and capped', JSON.stringify(cleanTerms([' Bible ', 'bible', '', 'Kids  crafts'])) === JSON.stringify(['Bible', 'Kids crafts']) && cleanTerms('a,b').length === 2 && cleanTerms(Array(30).fill(0).map((_, i) => 'k' + i)).length === 12)
check('the niche key ignores order and case', prefsKey(['Faith', 'beauty'], ['x']) === prefsKey(['Beauty', 'faith'], ['X']) && prefsKey([], []) !== prefsKey(['a'], []))
const pf = parseFit('Here: [{"id":"a1","fit":true,"score":140,"reason":"Sells journals \u2014 fits"},{"id":"zz","fit":true,"score":90,"reason":"x"},{"id":"b2","fit":"yes","score":50,"reason":"y"}]', ['a1', 'b2'])
check('fit verdicts: only the brands asked about, score held to 100, no dashes', pf.length === 2 && pf[0].score === 100 && !/[\u2013\u2014]/.test(pf[0].reason))
check('fit is true only when the model said true', pf[1].fit === false)
check('a fit answer that is not JSON gives no verdicts', parseFit('no idea', ['a1']).length === 0)
check('twenty a day', DAILY_FIND === 20)
check('line breaks in a draft are kept', tidyDraft('Hi team,\n\nWe love it.\n\n\n\nThanks!\nSeb and Michelle') === 'Hi team,\n\nWe love it.\n\nThanks!\nSeb and Michelle')
check('the prompt asks for paragraphs and the sign-off as written', /blank line between them/.test(LIB) && /sign-off, word for word/.test(LIB))
check('the route judges fit and never drafts a brand that does not fit', /action === 'match'/.test(ROUTE) && /r\.status === 'not_fit'\) return \{ brandId: r\.brand_id, ok: false/.test(ROUTE))
check('a brand that does not fit is never sent', !/'not_fit'/.test(ROUTE.slice(ROUTE.indexOf("action === 'claim'"), ROUTE.indexOf("action === 'result'"))) && /\['drafted', 'failed'\]\.includes\(row\.status\)/.test(ROUTE))
check('the morning queue is its own tab', /<TabBtn id="queue"/.test(UI) && /tab === 'queue' &&/.test(UI))
check('a send that cannot start says why in the run log', /Not started: \$\{c\.error/.test(UI) && /Run log/.test(UI))
check('the daily find runs once a day, with a niche saved', /20 \* 3600_000/.test(UI) && /autoRan\.current = true/.test(UI) && /savedKey === prefsKey\(\[\], \[\]\)\) return/.test(UI))
check('joining TRYBE is one visible button, marked as a referral', /https:\/\/jointrybe\.com\/r\/HTLEJE47/.test(UI) && /rel="sponsored noopener noreferrer"/.test(UI) && /referral link/.test(UI))
check('SCOUT searches the keywords and presses the categories, and reports each pass', /async function trybeSearchInPage\(/.test(BG) && /async function trybeChipInPage\(/.test(BG) && /passes: report/.test(BG))
check('a category filter is never a brand row', /el\.querySelector\('img'\)\) return false/.test(BG.slice(BG.indexOf('async function trybeChipInPage('))))

// THE DIRECTORY (Seb, 2026-10-06: TRYBE's search "does not work very well";
// collect every brand and filter it ourselves).
const entry = { id: 'e93f7da1-e647-46e8-b01e-48dc1f30e52d', brandId: 'c147d498-df8d-47e0-98c9-156bfbfdaea5', brand: { name: 'Spiral Bible', website: 'spiralbible.com', description: 'Bible journaling kits' }, nicheCategories: [{ category: 'Books & Education', emoji: 'x' }], trybeScore: '92' }
const rd = readDirectoryItem(entry)
check('a TRYBE entry is read by its brandId, not the entry id', !!rd && rd.brandId === 'c147d498-df8d-47e0-98c9-156bfbfdaea5')
check('name, website, about and categories are found inside the entry', !!rd && rd.name === 'Spiral Bible' && rd.website === 'https://spiralbible.com/' && rd.about === 'Bible journaling kits' && rd.categories[0] === 'Books & Education' && rd.trybeScore === 92)
check('a website on TRYBE itself is not a brand website', readDirectoryItem({ brandId: 'abcdef12', name: 'X', website: 'https://jointrybe.com/x' })?.website === null)
check('an entry with no brand id is dropped', readDirectoryItem({ name: 'X' }) === null)
const merged = mergeDirectory([{ brandId: 'abcdef12', name: 'X' }, { brandId: 'abcdef12', name: 'X', website: 'x.com' }])
check('one brand listed twice is one brand, gaps filled', merged.length === 1 && merged[0].website === 'https://x.com/')
const sb = { name: 'Spiral Bible', categories: ['Books & Education'], about: 'Journaling', siteText: 'faith based gifts', products: ['Bible Journaling Kit'] }
check('a keyword in a product name matches', nicheScore(sb, [], ['bible']) > 0 && nicheScore(sb, [], ['skateboard']) === 0)
check('a TRYBE category matches', nicheScore(sb, ['Books & Education'], []) >= 20)
check('TRYBE category list is read by name', JSON.stringify(readCategories({ data: [{ category: 'Fashion & Apparel', emoji: 'x' }, { category: 'Beauty & Personal Care' }] })) === JSON.stringify(['Fashion & Apparel', 'Beauty & Personal Care']))
const harvest = BG.slice(BG.indexOf('async function trybeHarvestInPage('), BG.indexOf('// In page: one Request to Join'))
check('collecting the list reads TRYBE pages and never clicks anything', /\/backend\/api\/discovery\/brands\?limit=75&page=/.test(harvest) && !/\.click\(\)/.test(harvest))
check('collecting runs in a tab behind, not in front', /url: TRYBE_DISCOVER, active: false/.test(harvest))
check('the directory is shared, written by the server only', /action === 'directory'/.test(ROUTE) && /from\('trybe_directory'\)\.upsert/.test(ROUTE))
check('the shortlist leaves out brands already on the list', /\.filter\(r => !have\.has\(r\.brand_id\)\)/.test(ROUTE))
check('websites are read in the background', /researchBrandSite/.test(readFileSync('app/api/cron/trybe-directory/route.ts', 'utf8')))

if (failures.length) { console.error('TRYBE outreach checks failed:\n - ' + failures.join('\n - ')); process.exit(1) }
console.log('trybe-outreach: all checks passed')
