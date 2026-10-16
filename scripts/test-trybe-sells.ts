// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT A TRYBE BRAND SELLS (lib/trybe-sells; Seb, 2026-10-16). Held on brand
// shapes like the real ones, including the traps: "Privacy policy" on every
// site is not insurance, a gift card is not a product, "Tech & Gadgets" is
// devices, a product brand with an app is both, and too little to go on is
// not known. Under the Sells filter a brand MVP cannot tell is left out and
// counted, never listed.
import { readFileSync } from 'node:fs'
import { sellsOf, readSells, SELLS_WORDS } from '../lib/trybe-sells'
import { filterCheck, readFilters, readDirStats } from '../lib/trybe-finder'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

const policyAdvisor = sellsOf({ name: 'PolicyAdvisor', categories: ['Finance'], about: 'PolicyAdvisor helps Canadians compare life insurance and get a quote online in minutes.', siteText: 'compare life insurance quotes. get a quote. licensed advisors. privacy policy terms', products: [] })
check('an insurance brand is a service', policyAdvisor.kind === 'service' && policyAdvisor.why.length > 0, policyAdvisor)

const skincare = sellsOf({ name: 'Glow Lab', categories: ['Skincare'], about: 'Clean skincare for sensitive skin.', siteText: 'shop now free shipping over $50 vitamin c serum 1 fl oz', products: ['Vitamin C Serum', 'Night Cream', 'Cleanser', 'Gift Card'], samples: true })
check('a store with products and samples sells products, and says why', skincare.kind === 'physical' && skincare.why.some((w) => /store lists 3 products/.test(w)) && skincare.why.some((w) => /sends samples/.test(w)), skincare)

const app = sellsOf({ name: 'Habitly App', categories: ['Apps'], about: 'Build better habits. Download our app on the App Store and Google Play.', siteText: 'download on the app store get it on google play', products: [] })
check('a phone app is an app', app.kind === 'app', app)

const saas = sellsOf({ name: 'Clipwise', categories: ['Business'], about: 'AI-powered video editing software for teams.', siteText: 'start your free trial no credit card required dashboard integrations per seat pricing', products: [] })
check('online software is software', saas.kind === 'software', saas)

const empty = sellsOf({ name: 'Northwind', categories: [], about: null, siteText: null, products: [] })
check('nothing to go on is not known, never guessed', empty.kind === null && empty.kinds.length === 0 && empty.why.length === 0, empty)

const boiler = sellsOf({ name: 'Acme', categories: [], about: 'Welcome to Acme.', siteText: 'home about contact privacy policy terms of service refund policy cookie policy', products: [] })
check('"privacy policy" and "terms" are not a service', boiler.kind === null, boiler)

const giftOnly = sellsOf({ name: 'Studio', categories: [], about: 'Online classes.', siteText: '', products: ['Gift Card', 'E-Gift Card', 'Membership'] })
check('gift cards and memberships are not products that ship', giftOnly.kinds.includes('physical') === false, giftOnly)

const gadget = sellsOf({ name: 'Volt', categories: ['Tech & Gadgets'], about: 'The smallest portable charger.', siteText: 'add to cart in stock ships in 24 hours', products: ['Volt Mini', 'Volt Max'] })
check('"Tech & Gadgets" with a store is products, not software', gadget.kind === 'physical' && !gadget.kinds.includes('software'), gadget)

const both = sellsOf({ name: 'Fitband', categories: ['Fitness'], about: 'Smart rings. Download our app to track your sleep.', siteText: 'add to cart free shipping download on the app store', products: ['Ring 3', 'Charger', 'Sizing Kit'], samples: true })
check('a product brand with its own app is products first, app too', both.kind === 'physical' && both.kinds.includes('app'), both)

const shipIns = sellsOf({ name: 'Pawly', categories: ['Pets'], about: 'Dog treats.', siteText: 'shipping insurance available. add to cart. free shipping.', products: ['Chicken Chews', 'Dental Sticks', 'Shipping Protection'], samples: true })
check('"shipping insurance" on a store that sends samples does not make it a service', shipIns.kind === 'physical' && !shipIns.kinds.includes('service'), shipIns)

check('the filter value is read safely', readSells('software') === 'software' && readSells('cars') === null && readSells(undefined) === null && readFilters({ sells: 'app' }).sells === 'app' && readFilters({ sells: 'x' }).sells === null)

// ── The filter ──
const base = { perVideo: null, creators: null, stats: readDirStats({}), earningsBucket: null, amazon: null, starred: false }
const unknown = filterCheck({ ...base, sells: empty }, { sells: 'physical' })
check('under Sells, a brand MVP cannot tell is left out and counted as not known', !unknown.pass && unknown.failed.join() === 'sells' && unknown.blank.join() === 'sells' && !unknown.unknown.length, unknown)
check('a brand that sells it passes', filterCheck({ ...base, sells: skincare }, { sells: 'physical' }).pass)
check('a brand that sells something else is left out, not counted as unknown', (() => { const c = filterCheck({ ...base, sells: policyAdvisor }, { sells: 'physical' }); return !c.pass && !c.blank.length })())
check('a brand that is both passes either', filterCheck({ ...base, sells: both }, { sells: 'app' }).pass && filterCheck({ ...base, sells: both }, { sells: 'physical' }).pass)
check('with no Sells filter nothing changes', filterCheck({ ...base, sells: empty }, {}).pass)

// ── Wired through ──
const ROUTE = read('app/api/labs/trybe/route.ts')
const CTRL = read('components/labs/TrybeFinderControls.tsx')
check('browse reads what each brand sells from what MVP keeps, and filters on it', /sellsBy\.set\(x\.r\.brand_id, sellsOf\(\{ name: x\.r\.name, categories: x\.r\.categories \|\| \[\], about: x\.r\.about, siteText: x\.r\.site_text, products: x\.r\.site_products \|\| \[\], samples: statsBy\.get\(x\.r\.brand_id\)\?\.samples \?\? null, raw: x\.r\.raw \}\)\)/.test(ROUTE) && /sells: sellsBy\.get\(x\.r\.brand_id\) \?\? null, spend: spendBy\.get\(x\.r\.brand_id\)\?\.dollars \?\? null \}, filters\)/.test(ROUTE) && /sells: sellsBy\.get\(r\.brand_id\) \?\? null,/.test(ROUTE))
check('the page has the Sells row, the chip says why, and the note counts the ones not known', /SELLS\.map\(\(k\) =>/.test(CTRL) && /Why MVP thinks so:/.test(CTRL) && /where MVP cannot yet tell what they sell/.test(CTRL) && /<SellsChip sells=\{b\.sells\} \/>/.test(read('components/labs/TrybeOutreach.tsx')) && /<SellsChip sells=\{brand\.sells\} \/>/.test(read('components/labs/TrybeBrandPeek.tsx')))
check('the words on screen have no dashes', Object.values(SELLS_WORDS).every((w) => !/[–—]| - /.test(`${w.label} ${w.chip} ${w.says}`)))

if (fails.length) { console.error('trybe-sells failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ trybe-sells: products, apps, software and services told apart from what MVP keeps; a brand it cannot tell is left out of the filter and counted')
