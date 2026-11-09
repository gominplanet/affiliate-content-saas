// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW MVP KNOWS, AND RETAINERS (lib/trybe-evidence; Seb, 2026-11-09: "are
// these brands paying creators? Are they spending on ads? How do we know for
// sure? What is the data backing it up from tribe? ... show users very
// visibly if a brand is also offering retainers"). Held on the traps: every
// fact names where it came from and when, ad spend is never credited to
// TRYBE, a claim nothing proves says so with why, a retainer comes from
// TRYBE's terms or the brand's own words next to creators (never a product
// called a retainer), and a brand that says nothing of one is never called a
// no.
import { readFileSync } from 'node:fs'
import { evidenceOf, retainerOf, retainerWords, retainerShort, retainerSource, retainerKindOf, type EvidenceInput } from '../lib/trybe-evidence'
import { filterCheck, readFilters } from '../lib/trybe-finder'
import { PRESETS } from '../components/labs/TrybeFinderControls'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

const none: EvidenceInput = { paidOut: null, earningsBucket: null, videosApproved: null, videos30d: null, payLines: [], membersPerVideo: null, tierUpFrom: null, listAt: '2026-11-08T06:00:00Z', metaAds: null, metaCheckedAt: null, metaTrust: null, metaFresh: false, top100Hits: null, top100BestRank: null, top100At: null, about: null, siteText: null }

// ── PAYS CREATORS ──
{
  const e = evidenceOf({ ...none, paidOut: 52400, videos30d: 140, membersPerVideo: 46, payLines: ['$50 per approved video'] })
  check('what TRYBE shows paid out proves it, said with TRYBE as the source and the day it was read', e.pays.confirmed && e.pays.lines[0].text === 'TRYBE shows $52,400 paid to its creators' && e.pays.lines[0].source === 'TRYBE' && e.pays.lines[0].at === none.listAt && e.pays.missing === null)
  check('videos approved, members’ pay and its terms are listed too, each with its source', e.pays.lines.some((l) => l.text === '140 videos approved in the last 30 days' && l.source === 'TRYBE') && e.pays.lines.some((l) => l.text === 'MVP members were paid about $46 per approved video' && l.source === 'MVP members') && e.pays.lines.some((l) => /Its pay on TRYBE: \$50 per approved video/.test(l.text)))
  const b = evidenceOf({ ...none, earningsBucket: '$50K+', tierUpFrom: '$10K+' })
  check('TRYBE’s payout range proves it, with its rise', b.pays.confirmed && b.pays.lines[0].text === 'TRYBE puts what its creators earned at $50K+, up from $10K+ this month')
  const terms = evidenceOf({ ...none, payLines: ['15% of GMV'] })
  check('pay terms alone do not prove it pays, and it says so', !terms.pays.confirmed && /it lists pay on TRYBE, but TRYBE shows nothing paid out/.test(terms.pays.missing || ''))
  check('nothing at all is said as not confirmed, never as a yes', !evidenceOf(none).pays.confirmed && /^Not confirmed yet: TRYBE shows nothing paid out and no pay terms/.test(evidenceOf(none).pays.missing || ''))
}

// ── SPENDS ON ADS ──
{
  const e = evidenceOf({ ...none, metaAds: 38, metaCheckedAt: '2026-11-07T10:00:00Z', metaTrust: 'own', metaFresh: true, top100Hits: 3, top100BestRank: 12, top100At: '2026-11-08T09:00:00Z' })
  check('its own Meta ads prove it, from Meta’s Ad Library, on the day counted', e.ads.confirmed && e.ads.lines[0].text === '38 ads of its own running on Meta' && e.ads.lines[0].source === 'Meta Ad Library' && e.ads.lines[0].at === '2026-11-07T10:00:00Z')
  check('its Top 100 videos are said from TRYBE’s Top 100, with its best place', e.ads.lines[1].text === '3 videos in TRYBE’s Top 100, best at #12' && e.ads.lines[1].source === 'TRYBE Top 100')
  check('ad spend is never credited to TRYBE itself', [e, evidenceOf({ ...none, metaAds: 0, metaFresh: true, metaTrust: 'own' })].every((x) => x.ads.lines.every((l) => l.source !== 'TRYBE')))
  const zero = evidenceOf({ ...none, metaAds: 0, metaFresh: true, metaTrust: 'own', top100At: '2026-11-08T09:00:00Z' })
  check('no ads at the last count is said, and not confirmed', !zero.ads.confirmed && zero.ads.lines[0].text === 'No ads of its own running on Meta at the last count' && /none of its videos in TRYBE’s Top 100/.test(zero.ads.missing || ''))
  const capped = evidenceOf({ ...none, metaAds: 1000, metaFresh: true, metaTrust: 'capped' })
  const mixed = evidenceOf({ ...none, metaAds: 400, metaFresh: true, metaTrust: 'mixed' })
  check('a Meta count that is not its own is said as such, and proves nothing', !capped.ads.confirmed && /cannot be told apart/.test(capped.ads.lines[0].text) && !mixed.ads.confirmed && /other advertisers/.test(mixed.ads.lines[0].text))
  const stale = evidenceOf({ ...none, metaAds: 38, metaFresh: false, metaTrust: 'own' })
  check('an old count is said as old, and proves nothing', !stale.ads.confirmed && /over four weeks ago/.test(stale.ads.lines[0].text))
  check('Top 100 videos alone prove it', evidenceOf({ ...none, top100Hits: 1, top100At: '2026-11-08T09:00:00Z' }).ads.confirmed)
  check('not counted yet is said', /MVP has not counted its Meta ads/.test(evidenceOf(none).ads.missing || ''))
}

// ── RETAINERS ──
{
  const t = retainerOf({ payLines: ['15% of GMV', 'Guaranteed $500 this period if you submit 10 videos'], about: null, siteText: null })
  check('TRYBE’s terms give the retainer, its amount and videos, in TRYBE’s own words', t?.source === 'terms' && t.amount === 500 && t.videos === 10 && /Guaranteed \$500/.test(t.text))
  check('its badge and its source say so plainly: a guaranteed amount is a smart retainer', !!t && t.kind === 'smart' && retainerShort(t) === 'Smart retainer $500 for 10 videos' && retainerSource(t).startsWith('TRYBE’s pay terms: “Guaranteed $500') && /Smart retainer: a guaranteed amount your commission counts toward/.test(retainerSource(t)))
  const a = retainerOf({ payLines: [], about: 'We love working with creators. Our best performers move onto monthly retainers after their first month.', siteText: null })
  check('the brand’s own words on TRYBE count, quoted, said as a mention and never as a set retainer', a?.source === 'about' && /monthly retainers/.test(a.text) && retainerShort(a) === 'Mentions retainers' && retainerSource(a).startsWith('Its own words on TRYBE: “') && /not a retainer set in its TRYBE terms: ask the brand/.test(retainerSource(a)))
  check('its website counts too, next to creators', retainerOf({ payLines: [], about: null, siteText: 'Join our UGC creator program: top creators earn a retainer every month.' })?.source === 'website')
  check('a product called a retainer is never an offer', retainerWords('Clear retainers for a straighter smile, made by dentists.') === null && retainerWords('Our retainer cases are BPA free and fit every aligner.') === null)
  check('the word alone, with no creators or pay near it, is not enough', retainerWords('Retainer.') === null)
  // Seb, 2026-11-09: "how do you figure out which brand offers retainers?"
  // Pay or partners near the word is not enough: agencies and services say that.
  check('a retainer near pay, partners or content but no creators is not an offer', retainerWords('Our agency works on a monthly retainer with partners who pay for content.') === null && retainerWords('Retainer clients get priority support and paid media.') === null)
  check('smart and standard are told apart by their words, never guessed', retainerKindOf('Guaranteed $500 this period if you submit 10 videos') === 'smart' && retainerKindOf('Smart retainer for top creators') === 'smart' && retainerKindOf('We top up your commission to $1,000') === 'smart'
    && retainerKindOf('A flat $300 monthly fee on top of commission') === 'standard' && retainerKindOf('Standard retainer: $400 a month') === 'standard' && retainerKindOf('Our creators get monthly retainers') === null)
  const st = retainerOf({ payLines: ['Retainer $300 per month, in addition to commission'], about: null, siteText: null })
  check('a set fee on top of commission is a standard retainer', st?.kind === 'standard' && retainerShort(st) === 'Standard retainer $300')
  const plain = retainerOf({ payLines: ['Retainer $250 for 5 videos'], about: null, siteText: null })
  check('terms that do not say which are a retainer, and say they do not say', plain?.kind === null && retainerShort(plain!) === 'Retainer $250 for 5 videos' && /do not say whether it is smart or standard/.test(retainerSource(plain!)))
  check('a brand that says nothing of one has no retainer, which is not a no', retainerOf({ payLines: ['$40 per approved video'], about: 'Clean protein.', siteText: null }) === null)
  const base = { perVideo: 30, creators: null, stats: { videosApproved: null, videos30d: null, paidOut: null, samples: null, joinedAt: null } as never, earningsBucket: null, amazon: null, starred: false }
  const f = readFilters({ retainer: true })
  const out = filterCheck({ ...base, retainer: false }, f)
  check('the filter keeps brands with one, and counts the rest apart as saying nothing', f.retainer === true && filterCheck({ ...base, retainer: true }, f).pass && !out.pass && out.blank.includes('retainer'))
  check('Offers retainers is a quick list', PRESETS.some((p) => p.id === 'retainers' && p.filters.retainer === true))
}

// ── ON SCREEN ──
const R = read('app/api/labs/trybe/route.ts')
check('the brand search reads retainers for every brand matched, and filters on them', /const retainerBy = new Map\(rows\.map\(r => \[r\.brand_id as string, retainerOf\(/.test(R) && /retainer: !!retainerBy\.get\(x\.r\.brand_id\),/.test(R))
check('each brand shown carries its proof and its retainer', /retainer: retainerBy\.get\(r\.brand_id\) \?\? null,\n[\s\S]{0,240}?evidence: \(\(\) => \{/.test(R) && /const ev = evidenceOf\(\{/.test(R))
const C = read('components/labs/TrybeFinderControls.tsx')
const O = read('components/labs/TrybeOutreach.tsx')
check('every card wears its retainer by its name, solid gold when TRYBE sets it, a gold outline when only mentioned, and its proof box under it', /<RetainerBadge retainer=\{b\.retainer\} \/>/.test(O) && /<BrandProof evidence=\{b\.evidence\} retainer=\{b\.retainer\} \/>/.test(O) && /set \? \{ background: '#F59E0B', color: '#1F1300' \} : \{ border: '1\.5px solid #F59E0B'/.test(C))
check('the proof box names each fact’s source and day, green when proven and amber with why when not', /How MVP knows/.test(C) && /\(\{l\.source\}\{day\(l\.at\)/.test(C) && /\{p\.missing && <span className="block" style=\{\{ color: AMBER \}\}>/.test(C))
const T = read('components/labs/TrybeBrandTable.tsx')
check('the table sorts by retainer and shows each one, set or mentioned, in the spreadsheet with where it was read', /\{ id: 'retainer', label: 'Retainer'/.test(T) && /b\.retainer \? retainerSource\(b\.retainer\) : ''/.test(T) && /'Mentions retainers'/.test(T) && /if \(r\.source !== 'terms'\)/.test(T))
check('the table’s paid out and Meta ads say how MVP knows when hovered', /title=\{proofTitle\(b\.evidence\?\.pays\)\}/.test(T) && /title=\{proofTitle\(b\.evidence\?\.ads\)\}/.test(T))
const D = read('components/labs/TrybeDossier.tsx')
check('the brand page shows the same proof and the retainer', /<Section title="How MVP knows"/.test(D) && /<BrandProof evidence=\{listing\.evidence\} retainer=\{listing\.retainer\} \/>/.test(D) && /<RetainerBadge retainer=\{listing\?\.retainer\} \/>/.test(D))
check('the filter column and the filter note know retainers', /tick\('retainer'/.test(C) && /that say nothing of a retainer in their TRYBE terms or their own words/.test(C))
const L = read('lib/trybe-evidence.ts')
check('no dashes in anything the creator reads', !/[–—]/.test((L.match(/[`'"][^`'"\n]{8,}[`'"]/g) || []).join(' ')))

if (fails.length) { console.error(`✗ ${fails.length} TRYBE evidence check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
console.log('✓ TRYBE evidence: every claim with its facts, sources and days; retainers from TRYBE’s terms or the brand’s own words, shown in gold')
