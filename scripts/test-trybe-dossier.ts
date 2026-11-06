// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BRAND PAGE (Seb, 2026-11-06: "a very high-end output of information, of
// data that comes from Tribe"). Pinned: members' samples and replies show only
// past POOL_MIN and never one member's own; Meta ads become a line over time
// from the changes log; products read only an explicit yes as samples; the
// scorecard grades each of six things from what was read and says where it
// came from, never scoring what was not read; and the page is wired in for the
// team only, from wherever a brand's name is shown.
import { readFileSync } from 'node:fs'
import { samplePool, replyPool, metaSeries, seriesMove, timelineOf, dossierProducts, scorecard, verdictOf, readLiveBrand, type ScoreInput } from '../lib/trybe-dossier'
import { POOL_MIN } from '../lib/trybe-changes'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')
const DAY = 86_400_000
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString()

// ── SAMPLES ──────────────────────────────────────────────────────────────────
{
  const few = samplePool([{ user_id: 'a', requested_at: ago(30), received_at: ago(24) }])
  check('one creator\'s samples are never shown', !few.shown && few.arrivedRate == null && /Shown once 5 MVP creators/.test(few.why || ''))
  const rows = ['a', 'b', 'c', 'd', 'e'].map((u, i) => ({ user_id: u, requested_at: ago(40), received_at: i < 4 ? ago(40 - (4 + i)) : null }))
  const p = samplePool(rows)
  check('five creators: the share that arrived, rounded to 5 points', p.shown && p.arrivedRate === 80 && p.members === POOL_MIN)
  check('the middle wait from asking to arriving', p.medianDays === 6)
  check('a sample asked 3+ weeks ago and not here counts as waiting long', p.waitingLong === 1)
  const fresh = samplePool(['a', 'b', 'c', 'd', 'e'].map((u) => ({ user_id: u, requested_at: ago(3), received_at: null })))
  check('samples asked days ago are not counted as missing yet', fresh.shown && fresh.arrivedRate == null && fresh.waitingLong === 0)
  const lopsided = samplePool([...['a', 'b', 'c', 'd', 'e'].map((u) => ({ user_id: u, requested_at: ago(30), received_at: ago(25) })), ...Array.from({ length: 8 }, () => ({ user_id: 'a', requested_at: ago(30), received_at: null }))])
  check('one creator being most of the requests hides it', !lopsided.shown && /one creator is most/.test(lopsided.why || ''))
}

// ── REPLIES ──────────────────────────────────────────────────────────────────
{
  const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((u, i) => ({ user_id: u, status: 'sent', sent_at: ago(10), replied_at: i < 3 ? ago(9) : null }))
  const r = replyPool(rows)
  check('the share of members\' messages it answered, and how fast', r.shown && r.rate === 50 && r.medianDays === 1)
  check('drafts and removed rows are not messages', !replyPool([...rows.slice(0, 4), { user_id: 'z', status: 'drafted', sent_at: null, replied_at: null }]).shown)
}

// ── META ADS OVER TIME ───────────────────────────────────────────────────────
{
  const ch = [
    { kind: 'ads', before: '22', after: '31', at: ago(16) },
    { kind: 'pay', before: '$30', after: '$40', at: ago(20) },
    { kind: 'ads', before: '14', after: '22', at: ago(40) },
  ]
  const s = metaSeries(ch, { count: 38, at: ago(2) })
  check('the line starts at the count before the first change, then each change, then the latest', s.length === 4 && s[0].value === 14 && s[1].value === 22 && s[2].value === 31 && s[3].value === 38)
  check('oldest first', s.every((p, i) => i === 0 || Date.parse(p.at) > Date.parse(s[i - 1].at)))
  check('how it moved, in words', seriesMove(s, 'ads') === 'up 24 ads in 39 days')
  check('no changes and no count, no line', metaSeries([], { count: null, at: null }).length === 0 && seriesMove([], 'ads') === null)
  check('a count read the same day as a change is one point', metaSeries([{ kind: 'ads', before: '1', after: '5', at: ago(0) }], { count: 5, at: ago(0) }).length === 2)
}

// ── TIMELINE AND PRODUCTS ────────────────────────────────────────────────────
{
  const t = timelineOf([{ kind: 'new', before: null, after: '$30 per video', at: ago(100) }, { kind: 'tier', before: '$10K+', after: '$50K+', at: ago(5) }, { kind: 'odd', before: null, after: null, at: ago(1) }])
  check('what happened, newest first, in plain words, unknown kinds left out', t.length === 2 && t[0].kind === 'tier' && /from \$10K\+ to \$50K\+/.test(t[0].line) && /New on TRYBE, pays \$30/.test(t[1].line))
  const p = dossierProducts({ data: [
    { title: 'Gift Card', isActive: true, allowSamples: false },
    { title: 'Hydrator', isActive: true, allowSamples: true, isFeatured: true, imageUrl: 'https://cdn.example.com/a.jpg', metadata: { variants: { edges: [{ node: { price: '44.39' } }, { node: { price: '59.99' } }] } } },
    { title: 'Old', isActive: false, allowSamples: true },
    { title: 'Silent', isActive: true },
  ] })
  check('active products only, featured first, an explicit yes only as samples', p.length === 3 && p[0].name === 'Hydrator' && p[0].samples && !p.find((x) => x.name === 'Silent')?.samples)
  check('a price range from its options', p[0].price === '$44.39 to $59.99' && p[0].options === 2)
  check('a picture only from https', dossierProducts({ data: [{ title: 'x', imageUrl: 'http://a/b.jpg' }] })[0].image === null)
}

// ── THE SCORECARD ────────────────────────────────────────────────────────────
const blank: ScoreInput = { pay: { dollars: null, short: null, basis: null }, meta: { count: null, own: false, fresh: false, top100Hits: null }, samples: { trybe: null, products: null, pool: null }, pool: null, crowd: null, replies: null }
{
  const d = scorecard(blank)
  check('six things, each said', d.length === 6 && d.map((x) => x.id).join() === 'pay,ads,samples,approval,speed,room')
  check('nothing read is scored as nothing, never as bad', d.every((x) => x.score === null && x.grade === 'unknown'))
  const v = verdictOf(d)
  check('fewer than three read gives no score, and says how many were read', v.score === null && v.word === 'Not enough read' && /0 of the 6/.test(v.line))
}
{
  const good: ScoreInput = {
    pay: { dollars: 46, short: '$46 a video', basis: 'members' },
    meta: { count: 38, own: true, fresh: true, top100Hits: 3 },
    samples: { trybe: null, products: { open: 3, total: 6 }, pool: { shown: true, members: 5, arrivedRate: 85, medianDays: 6, waitingLong: 1, why: null } },
    pool: { approvalRate: 70, reviewDays: 4, slowShare: 10 },
    crowd: { level: 'filling', why: '14 joined in 30 days' },
    replies: null,
  }
  const d = scorecard(good)
  const by = Object.fromEntries(d.map((x) => [x.id, x]))
  check('pay says where it came from', by.pay.value === '$46 a video' && /MVP creators/.test(by.pay.source) && by.pay.grade === 'strong')
  check('ad spend counts its own Meta ads and its Top 100 videos', by.ads.value === '38 Meta ads' && /Top 100/.test(by.ads.source) && by.ads.grade === 'strong')
  check('samples: MVP creators\' arrivals come before its products', by.samples.value === '85% arrived' && /about 6 days/.test(by.samples.source))
  check('approval and speed from members, room from crowding', by.approval.value === '70% approved' && by.speed.value === '4 days' && by.room.value === 'Filling' && by.room.grade === 'fair')
  const v = verdictOf(d)
  check('a strong brand reads as a strong bet, with its best and weakest named', v.word === 'Strong bet' && (v.score as number) >= 75 && /Best: .*Weakest: room for you/.test(v.line) && v.read === 6)
  const noSamples = verdictOf(scorecard({ ...good, samples: { trybe: false, products: null, pool: null } }))
  check('a brand that takes no samples is never a strong bet', noSamples.score !== null && noSamples.score <= 54)
  const common = scorecard({ ...good, meta: { count: 900, own: false, fresh: true, top100Hits: null } }).find((x) => x.id === 'ads')
  check('a Meta count that is not the brand\'s own is not scored', common?.score === null && common?.value === 'Unclear')
  const stale = scorecard({ ...good, meta: { count: 38, own: true, fresh: false, top100Hits: null } }).find((x) => x.id === 'ads')
  check('an old Meta count is not scored as today\'s', stale?.score === null)
  const shut = scorecard({ ...good, samples: { trybe: null, products: { open: 0, total: 4 }, pool: null } }).find((x) => x.id === 'samples')
  check('products that all refuse samples score zero and say so', shut?.score === 0 && /None of its 4 products/.test(shut?.source || ''))
}

// ── LIVE FROM TRYBE ──────────────────────────────────────────────────────────
{
  const l = readLiveBrand({ data: { brand: { id: 'x', name: 'Luxe', creatorLabel: '1,500+', trybeScore: 100, payoutDays: 7, reviewRating: 4.9, reviewCount: 46 }, stats: { submissionsLast30Days: 3407, totalSubmissions: '3,600' }, programs: [{ name: 'Luxe creators' }], autoApprove: false } })
  const by = Object.fromEntries(l.numbers.map((n) => [n.id, n.value]))
  check('TRYBE\'s own numbers are found by name, one level deep', by.creators === '1,500+' && by.subs30 === '3,407' && by.subsTotal === '3,600' && by.score === '100' && by.payout === '7 days' && by.rating === '4.9 \u2605')
  check('its program and how it lets creators in', l.program === 'Luxe creators' && l.approval === 'Reviews each creator who asks to join')
  check('the keys TRYBE sent are kept for the team', l.keys.includes('stats') && l.keys.includes('id'))
  const none = readLiveBrand({ data: { name: 'Quiet', about: 'words' } })
  check('a page with no numbers gives none, never a made up one', none.numbers.length === 0 && none.program === null && none.approval === null)
  check('a score over 100 or a word is not a number', readLiveBrand({ score: 340, creatorLabel: 'many creators' }).numbers.length === 0)
}

// ── WIRED IN ─────────────────────────────────────────────────────────────────
const R = read('app/api/labs/trybe/route.ts')
check('one action reads the rest of the brand page', /if \(action === 'dossier'\)/.test(R) && /samplePool\(/.test(R) && /replyPool\(/.test(R) && /metaSeries\(changes/.test(R) && /timelineOf\(changes\)/.test(R))
check('members\' results leave out the one looking', /poolBrands\(memQ\.rows, \{ exclude: ownerId \}\)/.test(R))
check('TRYBE\'s public brand page and products are read, kept a day, and feed the samples count too', /backend\/api\/public\/brand\/\$\{encodeURIComponent\(brandId\)\}/.test(R) && /key: pubKey/.test(R) && /key: `samples:\$\{brandId\}`/.test(R))
const U = read('components/labs/TrybeOutreach.tsx')
const D = read('components/labs/TrybeDossier.tsx')
check('brand names open the page in Find, Sent and Ready to send', (U.match(/<BrandName id=\{b\.brand_id\} name=\{b\.name\}/g) || []).length >= 3)
check('and in Star brands, and on the home', /<BrandName id=\{b\.brand_id\}/.test(read('components/labs/TrybeStarBrands.tsx')))
check('Find brands as a sortable table in the new TRYBE, cards kept as a choice', /\{v2 && listView === 'table' \? \(\s*<TrybeBrandTable/.test(U) && /localStorage\.setItem\('mvp\.trybe\.listView', v\)/.test(U))
{
  const T = read('components/labs/TrybeBrandTable.tsx')
  check('the table says what it has not read, never a zero', /Not counted/.test(T) && /Not known/.test(T) && /Not shown/.test(T))
  check('every column sorts, unknown always last', /if \(x == null\) return 1/.test(T) && /aria-sort=/.test(T))
  check('a brand already written or sent cannot be picked again', /disabled=\{isTaken\}/.test(T))
}
check('the brand page reads its own TRYBE page live through SCOUT, and says when it could not', /requestTrybeApi\('GET', `\/backend\/api\/creator\/v2\/brands\/\$\{encodeURIComponent\(brandId\)\}\/details`\)/.test(D) && /SCOUT could not read its page on TRYBE/.test(D) && /canDetails=\{access === 'granted' && scoutAtLeast\(scoutVersion, SCOUT_TRYBE_PLAYBOOK_MIN_VERSION\)\}/.test(U))
check('a brief link names where it goes', /Open its brief on \{siteName\(live\.briefUrl\)\}/.test(D))
{
  const F = read('components/labs/TrybeFilmIt.tsx')
  const V = read('components/labs/TrybeVideoIdeas.tsx')
  check('every script with words to say can be opened for filming', /setFilming\(\{ title: /.test(V) && /\{filming && <TrybeFilmIt script=\{filming\}/.test(V) && /Film it/.test(V))
  check('Film it shows one line at a time, then the B-roll to tick off, and moves by keys or a tap', /lines\[at\]/.test(F) && /Now the B-roll/.test(F) && /ArrowRight/.test(F) && /aria-label="Next line"/.test(F))
  check('the brand page and Film it sit above the dashboard, whatever box opened them', /createPortal\(/.test(F) && /createPortal\(/.test(D) && /zIndex: 1001/.test(F) && /zIndex: 1000/.test(D))
}
check('brands like it: still on TRYBE, in its categories, biggest Meta advertisers first, each opening its page', /\.overlaps\('categories', cats\)\.neq\('brand_id', brandId\)\.is\('left_at', null\)/.test(R) && /Brands like it/.test(D) && /<BrandName id=\{x\.brand_id\}/.test(D))
check('brand names open the page in What changed, Best new, Most active and the inbox too', ['components/labs/TrybeChanges.tsx', 'components/labs/TrybeBestNew.tsx', 'components/labs/TrybeActive.tsx', 'components/labs/TrybeBrandCard.tsx'].every((f) => /<BrandName id=/.test(read(f))))
check('only with the new TRYBE switched on', /<DossierCtx\.Provider value=\{v2 \? openDossier : null\}>/.test(U))
check('the switch is team only until it is opened', /trybe_v2: 'admin'/.test(read('lib/labs-preview.ts')) && /v2=\{canUsePreview\('trybe_v2', tier\)\}/.test(read('app/(dashboard)/trybe/page.tsx')))
check('what is not read says so on the page', /Not enough read|MVP has not counted its Meta ads yet/.test(D + read('lib/trybe-dossier.ts')) && /Read it again/.test(D))
check('every outside link names where it goes', /Its ads on Meta Ad Library/.test(D) && /Watch on TRYBE/.test(D) && /Open on TRYBE/.test(D))

if (fails.length) {
  console.error(`\n❌ trybe-dossier: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trybe-dossier: one page per brand, its six things graded from what was read, members\' numbers only past five, its Meta ads over time')
