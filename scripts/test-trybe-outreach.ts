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
check('the prompt asks for paragraphs and the sign-off as written', /a blank line between the greeting, each paragraph of the core message, and the sign-off/.test(LIB) && /keep it word for word on its own lines/.test(LIB))
check('the core message goes out nearly word for word, with a hello on top', /the brand gets it nearly word for word/.test(LIB) && /Open with one short, warm greeting line to the brand by name/.test(LIB) && /never describe their catalog or website back to them/.test(LIB))
check('a markdown link goes out as its address', tidyDraft('See [www.gominreviews.com](https://www.gominreviews.com) now') === 'See https://www.gominreviews.com now')
check('a draft can be written again from the core message', /onRewrite=\{\(\) => void rewrite\(\[b\]\)\}/.test(UI) && /Rewrite all/.test(UI))
check('the route judges fit and never drafts a brand that does not fit', /action === 'match'/.test(ROUTE) && /r\.status === 'not_fit'\) return \{ brandId: r\.brand_id, ok: false/.test(ROUTE))
check('a brand that does not fit is never sent', !/'not_fit'/.test(ROUTE.slice(ROUTE.indexOf("action === 'claim'"), ROUTE.indexOf("action === 'result'"))) && /\['drafted', 'failed'\]\.includes\(row\.status\)/.test(ROUTE))
check('Ready to send is its own tab', /<TabBtn id="queue"/.test(UI) && /tab === 'queue' &&/.test(UI))
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
check('the key list order wins: a brand name over a promo title', readDirectoryItem({ brandId: 'abcdef12', title: 'Summer promo', brandName: 'Real Brand' })?.name === 'Real Brand')
check('a logo address is never the brand website', readDirectoryItem({ brandId: 'abcdef12', name: 'X', logo: { url: 'https://cdn.example.com/x.png' } })?.website === null)
check('the website inside the brand object is found', readDirectoryItem({ brandId: 'abcdef12', name: 'X', brand: { website: 'shop.example.com' } })?.website === 'https://shop.example.com/')
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

// THE COLLECTOR RUNS IN TRYBE'S PAGE, ALONE. Chrome copies only that one
// function into the page; 1.41.2 called a helper defined elsewhere in SCOUT
// and failed before asking TRYBE for anything ("no-answer-from-page"). So the
// function is run here, by itself, against a fake TRYBE.
// THE SECOND REVIEW (2026-10-07), each fix held.
const SEND = BG.slice(BG.indexOf('async function trybeSendInPage('), BG.indexOf('async function trybeSend('))
check('the page itself never passes for a brand popup', /if \(!d \|\| d === document\.body\) return null/.test(SEND) && !/d = d \|\| document\.body/.test(SEND))
check('"Pending Requests" is not a requested button; already means TRYBE said so in the popup', /\^\(requested\|request sent\|cancel request\|withdraw\( request\)\?\)\$/.test(SEND) && /fail\('request-button-not-found'\)/.test(SEND))
check('a collection that stopped partway is said, and only a whole one waits a day', /complete = !error && !!totalPages && pages >= totalPages/.test(BG) && /lastCollectedAt: c\.complete && c\.at \? c\.at : null/.test(ROUTE) && /collected: \{ complete: h\.complete === true/.test(UI))
check('a fit or draft that was not saved is not reported as done', (ROUTE.match(/if \(upErr\)/g) || []).length >= 3)
check('directory search runs in the database, with a capped fallback', /rpc\('trybe_directory_search'/.test(ROUTE) && /allRows<Record<string, any>>\(make, 2000\)/.test(ROUTE))
check('what a brand already had is not blanked by an emptier entry', /website: keep\(b\.website, p\.website\)/.test(ROUTE) && /\(fresh \?\? had \?\? null\) : \(had \?\? fresh \?\? null\)/.test(ROUTE))
check('the shortlist reports what was really added', /added = \(ins \|\| \[\]\)\.length/.test(ROUTE))
check('TRYBE category list in its {data} shape is kept', /if \(body\.categories != null\)/.test(ROUTE))
check('the cap is counted again after a claim', /const after = await usedToday\(admin, ownerId\)/.test(ROUTE))
check('the daily find goes by the saved settings, not the half-typed page', /!saved \|\| !saved\.dailyFind/.test(UI) && /!saved\.core\.trim\(\)/.test(UI))
check('Check them now never leaves the page stuck', /judge\(unjudged\)\.finally\(\(\) => setFinding\(null\)\)/.test(UI))

// THE LIVE LIST (Seb, 2026-10-07: "as users change filters, the results ...
// should change"). MVP's copy is searched on every change, nothing fetched.
check('the live list searches MVP\'s copy as categories and keywords change', /\[hasDirectory, catsKey, kwsKey, liveNonce\]/.test(UI) && /action: 'browse', categories: cats, keywords: kws/.test(UI) && /setTimeout\(async \(\) => \{/.test(UI))
check('an older search never overwrites a newer one', /if \(id !== liveReq\.current\) return/.test(UI))
check('browse leaves nothing out, so a brand on the list shows where it stands', /rpc\('trybe_directory_search', \{ p_words: words, p_user: null/.test(ROUTE) && /status: m\?\.status \?\? null/.test(ROUTE))
check('browse never asks SCOUT, TRYBE or a website', (() => { const b = ROUTE.slice(ROUTE.indexOf("action === 'browse'"), ROUTE.indexOf("action === 'adopt'")); return !/researchBrandSite|siteFacts|fetch\(/.test(b) })())
check('queued or sent brands cannot be picked again', /const TAKEN: Array<Brand\['status'\]> = \['drafted', 'sending', 'sent', 'already', 'failed'\]/.test(UI) && /disabled=\{taken\}/.test(UI))
check('a picked brand is put on the list, then drafted', /action: 'adopt', brandIds: ids/.test(UI) && /const r = ready\.length \? await draftIds\(ready\)/.test(UI))

// THE SHARED COPY IS GUARDED: a collection by anyone but an admin adds and
// fills, never overwrites what is kept.
check('a member\'s collection cannot overwrite a kept website, name or description', /const trusted = tier === 'admin'/.test(ROUTE) && /trusted \? \(fresh \?\? had \?\? null\) : \(had \?\? fresh \?\? null\)/.test(ROUTE))

// THE INBOX (Seb, 2026-10-07: "reading and replying to messages right on MVP").
const INBOX = readFileSync('components/labs/TrybeInbox.tsx', 'utf8')
const API = BG.slice(BG.indexOf('const TRYBE_API_ALLOW = ['), BG.indexOf('let trybeApiTab = null'))
check('SCOUT\'s TRYBE bridge reads, posts a message or marks read, and nothing else',
  (API.match(/method: '([A-Z]+)'/g) || []).every(m => /'(GET|POST)'/.test(m)) && (API.match(/method: 'POST'/g) || []).length === 1 && API.includes('(messages|read)$/'))
check('the bridge runs alone in the page', !/trybeTokenInPage/.test(BG) && /async function trybeApiInPage\(method, path, body\)/.test(BG))
check('a reply counts as sent only when it shows in the conversation', /const seen = after\.some\(m => flat\(m\.text\) === flat\(text\)\)/.test(INBOX) && /const flat = \(t: string\) => t\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)/.test(INBOX))
check('nothing TRYBE says is stored on MVP', !/fetch\('\/api\//.test(INBOX))
check('an unreadable answer says what TRYBE sent', /TRYBE sent: \$\{shapeOf\(r\.json\)\}/.test(INBOX))
check('the inbox is a tab of TRYBE Outreach, still Labs', /<TabBtn id="inbox" label="Inbox" \/>/.test(UI) && /trybe_outreach: 'admin'/.test(readFileSync('lib/labs-preview.ts', 'utf8')))

const collectorRun = (async () => {
  const fnSrc = BG.slice(BG.indexOf('async function trybeHarvestInPage('), BG.indexOf('const TRYBE_HOOK_ID'))
  const store: Record<string, string> = { 'sb-x-auth-token': JSON.stringify({ access_token: 'T1' }) }
  const g = globalThis as any // eslint-disable-line @typescript-eslint/no-explicit-any
  const saved = { localStorage: g.localStorage, document: g.document, window: g.window, fetch: g.fetch, getComputedStyle: g.getComputedStyle, setTimeout: g.setTimeout, XMLHttpRequest: g.XMLHttpRequest }
  g.XMLHttpRequest = class { setRequestHeader() {} }
  g.localStorage = { get length() { return Object.keys(store).length }, key: (i: number) => Object.keys(store)[i], getItem: (k: string) => store[k] }
  g.document = { cookie: '', body: { scrollHeight: 0 }, querySelectorAll: () => [] }
  g.window = { scrollTo() {}, fetch: null }
  g.getComputedStyle = () => ({ overflowY: 'visible' })
  const real = saved.setTimeout
  g.setTimeout = (f: () => void) => real(f, 0)
  g.fetch = async (path: string, init: { headers: Record<string, string> }) => {
    if (init.headers.authorization !== 'Bearer T1') return { status: 401, ok: false, json: async () => null }
    if (path.includes('niche-categories')) return { status: 200, ok: true, json: async () => ({ data: [{ category: 'Beauty & Personal Care' }] }) }
    const page = Number(new URL('https://x' + path).searchParams.get('page'))
    const n = page < 2 ? 75 : 10
    return { status: 200, ok: true, json: async () => ({ success: true, data: Array.from({ length: n }, (_, i) => ({ brandId: `brand-${page}-${i}` })), pagination: { page, limit: 75, total: 85, totalPages: 2 } }) }
  }
  try {
    const fn = (0, eval)('(' + fnSrc.trim() + ')')
    const r = await fn(1, 10, true)
    check('the collector runs alone in the page and reads every page', r.ok === true && r.items.length === 85 && r.pages === 2 && r.done === true && !!r.categories)
    // TRYBE's real shape (2026-10-07): a cookie, "base64-" + URL-safe base64,
    // split in parts. 1.41.3 could not decode it and went in signed out.
    for (const k of Object.keys(store)) delete store[k]
    const json = JSON.stringify({ access_token: 'T1', refresh_token: 'r?>>' })
    const b64url = Buffer.from(json).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const half = Math.floor(b64url.length / 2)
    g.document.cookie = `other=1; sb-abc-auth-token.0=base64-${b64url.slice(0, half)}; sb-abc-auth-token.1=${b64url.slice(half)}`
    const c = await fn(1, 10, false)
    check('a split, URL-safe base64 sign-in cookie is read', c.ok === true && c.items.length === 85 && c.tokenFrom === 'cookie')
    // What TRYBE's own page sent wins (trybe-hook.js).
    g.document.cookie = ''
    g.window.__mvpTrybeAuth = { token: 'T1', at: Date.now() }
    const h = await fn(1, 10, false)
    check('the sign-in TRYBE\'s own page sent is used first', h.ok === true && h.tokenFrom === 'page')
    // Nothing anywhere: said as such, not as "signed out".
    delete g.window.__mvpTrybeAuth
    const out = await fn(1, 10, false)
    check('no sign-in found is said as that', out.ok === false && out.error === 'no-sign-in-found')
    // A sign-in TRYBE refuses: said as a refusal.
    store['sb-x-auth-token'] = JSON.stringify({ access_token: 'WRONG' })
    const ref = await fn(1, 10, false)
    check('a sign-in TRYBE refuses is said as a refusal', ref.ok === false && ref.error === 'refused-401')
  } catch (e) {
    check(`the collector runs alone in the page (it threw: ${e instanceof Error ? e.message : e})`, false)
  } finally {
    Object.assign(g, saved)
  }
})()
const HOOK = readFileSync('extension/trybe-hook.js', 'utf8')
check('the sign-in watcher loads before TRYBE, only during a collection, and changes nothing', /runAt: 'document_start', world: 'MAIN'/.test(BG) && /await trybeHookOff\(\)/.test(BG) && /return realFetch\.apply\(this, arguments\)/.test(HOOK) && /return realSet\.apply\(this, arguments\)/.test(HOOK))
check('the collector has no helper outside itself', !/trybeTokenInPage/.test(BG) && /const readToken = \(\) =>/.test(BG))

// Seb, 2026-10-07: search first, niches second; stats for the admin only;
// Ready to send; Remove; messages about the whole range.
check('searching a keyword is shown as the better way, niches as one click', /Best results/.test(UI) && /Search what you review/.test(UI) && /Or browse a niche/.test(UI) && /nicheIcon\(c\)/.test(UI))
check('a niche alone nudges toward a keyword', /cats\.length > 0 && !kws\.length/.test(UI) && /Add a keyword/.test(UI))
check('MVP\'s copy of TRYBE is described to the admin only', /isAdmin: g\.tier === 'admin'/.test(ROUTE) && UI.split('MVP&rsquo;s copy of TRYBE: <b>').slice(0, -1).every(before => /isAdmin && /.test(before.slice(-700))) && UI.includes('MVP&rsquo;s copy of TRYBE: <b>'))
check('a problem from a find is shown to everyone, not only the admin', /findNotes\.filter\(n => !ADMIN_NOTE\.test\(n\)\)/.test(UI) && /const ADMIN_NOTE = \/\^\(SCOUT collected /.test(UI))
check('the queue is called Ready to send', /label=\{`Ready to send \(\$\{queue\.length\}\)`\}/.test(UI) && !/[Mm]orning queue/.test(UI))
check('Remove never touches a brand that went, or may have gone, to TRYBE', /action === 'remove'/.test(ROUTE) && /\.in\('status', \['new', 'not_fit', 'drafted', 'skipped', 'failed'\]\)\.select\('brand_id'\)/.test(ROUTE) && /onRemove=\{\(\) => void remove\(b\)\}/.test(UI))
check('a removed brand stays out of the daily find but can be picked by hand', /\['not_fit', 'skipped', 'removed'\]/.test(ROUTE) && /'removed'/.test(LIB))
check('a message never singles out one product', /never single out one product/.test(LIB) && !/a product by name from its website/.test(LIB))
check('products naming a keyword are shown first', /productsFirst\(r\.site_products \|\| \[\], kws\)/.test(ROUTE))

void collectorRun.then(() => {
  if (failures.length) { console.error('TRYBE outreach checks failed:\n - ' + failures.join('\n - ')); process.exit(1) }
  console.log('trybe-outreach: all checks passed')
})
