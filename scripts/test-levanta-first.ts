// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LEVANTA LINKS WHEN THEY PAY MORE (Seb, 2026-10-24: "could mvp let users use
// levanta links when possible?"). Holds:
//   - the rule: a product Levanta has for the creator gets its Levanta link,
//     unless its Creator Connections campaign pays as much or more;
//   - off costs nothing: with the switch off no path asks Levanta or reads a
//     row, so every creator who has not turned it on keeps every link;
//   - every path that builds an Amazon link asks, including the ones that
//     hand-roll their own Passport chain, and a new one that does not fails
//     here;
//   - Passport is never handed the ASIN of a Levanta link (it would put the
//     Associates tag back): it forwards the Levanta link as it is;
//   - Levanta is asked the way its v2 API takes it (product_ids, a
//     marketplace), and only amazon.com counts;
//   - the Levanta page says what MVP decided for each product, and what a
//     Levanta link gives up.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const f = join(dir, name)
    if (statSync(f).isDirectory()) walk(f, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(f)
  }
  return out
}

;(async () => {
  const { levantaDecision, levantaFresh, levantaMarketplaceOk, isLevantaUrl, levantaStateWords, levantaLinkFor, LEVANTA_FRESH_MS } = await import('../lib/levanta-first')

  // The rule.
  check('not on Levanta keeps Amazon', levantaDecision({ onLevanta: false, access: false, commission: null, ccCommission: null }) === 'not-on-levanta')
  check('not approved by the brand keeps Amazon', levantaDecision({ onLevanta: true, access: false, commission: 20, ccCommission: null }) === 'no-access')
  check('on Levanta with no campaign uses Levanta', levantaDecision({ onLevanta: true, access: true, commission: 12, ccCommission: null }) === 'use')
  check('a campaign that pays as much keeps Amazon', levantaDecision({ onLevanta: true, access: true, commission: 15, ccCommission: 15 }) === 'pays-less')
  check('a campaign that pays less loses to Levanta', levantaDecision({ onLevanta: true, access: true, commission: 20, ccCommission: 10 }) === 'use')
  check('a rate Levanta did not give never beats a campaign', levantaDecision({ onLevanta: true, access: true, commission: null, ccCommission: 5 }) === 'pays-less')

  // Saved answers.
  const now = Date.parse('2026-10-24T12:00:00Z')
  check('a fresh answer is used', levantaFresh({ state: 'use', checked_at: '2026-10-22T12:00:00Z' }, now))
  check('an old one is asked again', !levantaFresh({ state: 'use', checked_at: '2026-10-10T12:00:00Z' }, now))
  check('a failed ask is retried within hours', LEVANTA_FRESH_MS.failed <= 12 * 3_600_000 && !levantaFresh({ state: 'failed', checked_at: '2026-10-24T03:00:00Z' }, now))
  check('an unknown state is never fresh', !levantaFresh({ state: 'weird', checked_at: '2026-10-24T11:00:00Z' }, now) && !levantaFresh(null, now))

  // Only amazon.com, and Levanta links recognised.
  check('amazon.com and links that hide the store are allowed', levantaMarketplaceOk('https://www.amazon.com/dp/B000000000?tag=x') && levantaMarketplaceOk('https://geni.us/x') && levantaMarketplaceOk(null))
  check('another country’s Amazon is not', !levantaMarketplaceOk('https://www.amazon.co.uk/dp/B000000000') && !levantaMarketplaceOk('https://www.amazon.de/dp/B000000000'))
  check('a Levanta link is recognised in each form', isLevantaUrl('https://lvnta.com/abc') && isLevantaUrl('https://www.amazon.com/dp/B000000000?maas=maas_adg_1&ref_=aa_maas') && !isLevantaUrl('https://www.amazon.com/dp/B000000000?tag=me-20'))

  // Off costs nothing.
  check('off asks nothing at all', (await levantaLinkFor({ userId: 'u', asin: 'B000000000', prefer: false })) === null)
  check('a bad ASIN asks nothing', (await levantaLinkFor({ userId: 'u', asin: 'nope', prefer: true })) === null)

  // The words.
  for (const st of ['use', 'pays-less', 'not-on-levanta', 'no-access', 'no-key', 'failed']) {
    const w = levantaStateWords(st, { commission: 18, ccCommission: 10 })
    check(`"${st}" is said in plain words with no dashes`, w.length > 10 && !/[–—]| - /.test(w))
  }
  check('a Levanta link names its rate and what it beat', levantaStateWords('use', { commission: 18, ccCommission: 10 }) === 'Levanta link, 18% (Creator Connections pays 10%)')

  // Levanta asked the way its API takes it.
  const SVC = read('services/levanta/index.ts'), FIRST = read('lib/levanta-first.ts')
  check('the product filter is product_ids, never asins', /qs\.set\('product_ids', opts\.asins\)/.test(SVC) && !/qs\.set\('asins'/.test(SVC))
  check('the marketplace is always sent, and only amazon.com counts', /marketplace: 'amazon\.com', limit: 10/.test(FIRST) && /x\.marketplace === 'amazon\.com'/.test(FIRST) && /createLevantaLink\(token, \{ asin, marketplace: 'amazon\.com'/.test(FIRST))
  check('a link that waits gives up within seconds', /const ASK_MS = 8000/.test(FIRST) && /timeoutMs: ASK_MS/.test(FIRST))

  // The central path and the switch.
  const CLOAK = read('lib/link-cloak.ts')
  check('the switch is read where every link path reads its style', /preferLevanta: ig\.prefer_levanta === true/.test(CLOAK) && /preferLevanta: false/.test(CLOAK))
  check('the central path asks only with the switch on, after the showcase', /if \(!\(useShowcase && cfg\.showcaseUrl\) && cfg\.preferLevanta\) \{/.test(CLOAK))
  check('resolveLevantaLink returns before any lookup when off', /if \(!cfg\.preferLevanta\) return null\n\s+const pick = await levantaLinkFor/.test(CLOAK))
  check('Passport forwards the Levanta link, never its ASIN', /destinationUrl: dest, label: opts\?\.label \?\? null, source: opts\?\.source \?\? opts\?\.channel \?\? null/.test(CLOAK.slice(CLOAK.indexOf('async function cloakLevantaUrl'))))
  check('the link result says when it is a Levanta link', /levanta\?: \{ commission: number \| null \}/.test(CLOAK) && /levanta: \{ commission: lv\.commission \}/.test(CLOAK))

  // Every path that builds an Amazon link asks.
  const EXEMPT = new Set(['lib/link-cloak.ts', 'lib/passport-links.ts', 'lib/feature-access.ts'])
  const builders = [...walk('app'), ...walk('lib')].filter((f) => /passportLinkForUser(Detailed)?\(/.test(read(f)) && !EXEMPT.has(f))
  check('the builders were found', builders.length >= 10)
  for (const f of builders) check(`${f} asks Levanta before Passport`, /resolveLevantaLink\(|levantaLinkFor\(/.test(read(f)))
  check('pin links ask too, with the full Levanta link', /if \(asin && cfg\.preferLevanta\) \{\n\s+const lv = await levantaLinkFor/.test(read('lib/pin-product-link.ts')))
  const SHARE = read('lib/blog-share-url.ts')
  check('sharing a post never rebuilds a Levanta link from its ASIN', /let asin = levantaLink \? null :/.test(SHARE) && /isLevantaUrl\(link\)/.test(SHARE))

  // The switch and the page.
  const ROUTE = read('app/api/levanta/prefer/route.ts'), CARD = read('components/levanta/LevantaFirst.tsx'), PAGE = read('app/(dashboard)/levanta/page.tsx')
  check('it cannot be turned on without Levanta connected', /if \(body\.on && !\(await getExternalKey\(supabase, user\.id, 'levanta'\)\)\)/.test(ROUTE))
  check('a member is never told to run a migration', /ig\?\.tier === 'admin' \? 'Run migration 455 in Supabase first\.' :/.test(ROUTE))
  check('the page has the switch', /<LevantaFirst key=\{keyTick\} \/>/.test(PAGE))
  check('the card says what a Levanta link gives up', /Amazon pays on the whole cart for 24 hours after a click, Levanta pays on this product for 14 days/.test(CARD) && /always goes to amazon\.com/.test(CARD))
  check('the card says what MVP decided for each product', /r\.words/.test(CARD) && /kept on Amazon/.test(CARD))
  check('its product links say where they go', /See it on Amazon/.test(CARD))
  const MIG = read('supabase/migrations/455_levanta_first.sql')
  check('migration 455 is safe to run twice', /add column if not exists prefer_levanta boolean not null default false/.test(MIG) && /create table if not exists public\.levanta_links/.test(MIG) && /drop policy if exists "levanta_links_own_read"/.test(MIG))

  // Passport at click time (Seb, 2026-10-24: "build the passport, click time Levanta switch").
  const { levantaAtClick, LEVANTA_CLICK_MAX_MS } = await import('../lib/levanta-first')
  const useRow = { state: 'use', url: 'https://www.amazon.com/dp/B000000000?maas=maas_adg_1', checked_at: '2026-10-22T12:00:00Z' }
  check('a US-bound click on a creator with the switch on goes to the saved Levanta link', levantaAtClick({ prefer: true, usStore: true, row: useRow, now }).url === useRow.url)
  check('switch off, or a visitor bound for another Amazon, keeps the Amazon link and asks nothing', levantaAtClick({ prefer: false, usStore: true, row: useRow, now }).url === null && levantaAtClick({ prefer: true, usStore: false, row: useRow, now }).url === null && !levantaAtClick({ prefer: true, usStore: false, row: null, now }).ask)
  check('a product never asked about keeps the Amazon link now and is asked after the click', levantaAtClick({ prefer: true, usStore: true, row: null, now }).url === null && levantaAtClick({ prefer: true, usStore: true, row: null, now }).ask)
  check('an answer of no Levanta, or a link over 30 days old, is not used', levantaAtClick({ prefer: true, usStore: true, row: { state: 'pays-less', url: null, checked_at: '2026-10-23T12:00:00Z' }, now }).url === null && levantaAtClick({ prefer: true, usStore: true, row: { ...useRow, checked_at: new Date(now - LEVANTA_CLICK_MAX_MS - 1).toISOString() }, now }).url === null)
  check('a week old "use" still sends the click, and is asked again behind it', (() => { const r = levantaAtClick({ prefer: true, usStore: true, row: { ...useRow, checked_at: '2026-10-15T12:00:00Z' }, now }); return r.url === useRow.url && r.ask })())
  const GO = read('app/go/[code]/route.ts')
  check('the Passport redirect asks it, for amazon.com-bound clicks, asks Levanta only after the redirect, and skips ascsubtag on a Levanta link', /levantaAtClick\(\{ prefer: preferRes\?\.data\?\.prefer_levanta === true, usStore: marketplace === AMAZON_HOME_HOST/.test(GO) && /if \(lv\.ask\) after\(/.test(GO) && /if \(lv\.url\) \{\s*finalUrl = lv\.url/.test(GO))
  check('the switch and the saved answer are read on their own, so the tags never fail with them', /select\('prefer_levanta'\)\.eq\('user_id', link\.user_id\)/.test(GO) && /select\('amazon_associates_tag, amazon_country_tags'\)\.eq\('user_id', link\.user_id\)/.test(GO))
  check('the page says Passport links already published switch too, for amazon.com visitors only', /Passport links already published switch at the click, for visitors headed to amazon\.com only/.test(CARD))

  if (fails.length) { console.error('levanta-first failed:\n - ' + fails.join('\n - ')); process.exit(1) }
  console.log(`✅ levanta-first: Levanta links when they pay more, off by default at no cost, asked by all ${builders.length} link builders, Passport never rebuilding one`)
})()
