// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which posts are doing nothing, and is the list safe to act on?
//
// 279 posts on one site, 47 indexed, 394 in "Crawled, currently not indexed".
// That catalogue is not helped by a 280th post. It is helped by turning the
// weakest forty into the strongest ten.
//
// Two things make this list dangerous rather than useful, and both are tested
// here.
//
// A post published three weeks ago with no impressions is not weak, it is new.
// Putting it on a "merge or delete these" list would have a creator destroy work
// that was about to start earning.
//
// And a post that Google shows but nobody clicks is the OPPOSITE of a merge
// candidate. It is ranking. Merging it away throws out a ranking the creator
// already has, to fix a title problem that takes ten minutes.
import {
  buildConsolidationReport, titleKeywords, graceDays, hasHadItsChance, type PostStat,
} from '../lib/consolidation'
import { readVelocity } from '../lib/publish-velocity'
import { readFileSync } from 'fs'
import { join } from 'path'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const NOW = new Date('2026-09-17T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

const post = (over: Partial<PostStat> & { id: string }): PostStat => ({
  title: 'A Product Review', url: `https://x.com/${over.id}/`, publishedAt: daysAgo(400),
  words: 1200, impressions: 0, clicks: 0, ...over,
})

// ── a new post is not a weak post ───────────────────────────────────────────
// The mistake that would have creators destroy work about to start earning.
{
  const r = buildConsolidationReport(
    [post({ id: 'fresh', publishedAt: daysAgo(20) })],
    { ageMonths: 24, now: NOW, statsAvailable: true })
  check('a three week old post is never a candidate', r.candidates.length === 0,
    JSON.stringify(r.candidates.map(c => c.id)))
  check('and is counted so the list is not mistaken for the whole catalogue',
    r.tooYoung === 1, `${r.tooYoung}`)
  check('the note says how many were not judged, and why',
    !!r.note && /still inside the 90 day window/.test(r.note), r.note ?? '')
}

// ── the grace period tracks the site's age ──────────────────────────────────
// Ninety days mean different things on a two year old site and a four month one.
{
  check('a young site gets the longest grace', graceDays(3) === 180, `${graceDays(3)}`)
  check('a first-year site gets a middle one', graceDays(8) === 120, `${graceDays(8)}`)
  check('an established site gets the shortest', graceDays(24) === 90, `${graceDays(24)}`)
  check('an unknown age is treated as young, not as old', graceDays(null) === 180)

  const young = buildConsolidationReport(
    [post({ id: 'p', publishedAt: daysAgo(120) })],
    { ageMonths: 3, now: NOW, statsAvailable: true })
  check('a 120 day old post on a young site is still too new', young.candidates.length === 0)
  const old = buildConsolidationReport(
    [post({ id: 'p', publishedAt: daysAgo(120) })],
    { ageMonths: 24, now: NOW, statsAvailable: true })
  check('but is judged on an established one', old.candidates.length === 1)
}

// ── a ranking post is not a merge candidate ─────────────────────────────────
// This is the dangerous half. Merging it away throws out a ranking.
{
  const r = buildConsolidationReport(
    [post({ id: 'ranks', impressions: 2400, clicks: 0, words: 1800 })],
    { ageMonths: 24, now: NOW, statsAvailable: true })
  check('a shown-but-unclicked post is identified separately',
    r.candidates[0]?.weakness === 'shown-never-clicked', r.candidates[0]?.weakness)
  check('and the row says explicitly not to merge it',
    /do NOT merge it away/i.test(r.candidates[0]?.reason ?? ''), r.candidates[0]?.reason)
  check('it names the real fix instead',
    /title and description/.test(r.candidates[0]?.reason ?? ''))
  check('and it never appears in a merge group',
    r.groups.every(g => !g.ids.includes('ranks')), JSON.stringify(r.groups))
}

// ── a post that earns is never on the list at all ───────────────────────────
{
  const r = buildConsolidationReport(
    [post({ id: 'good', impressions: 5000, clicks: 240 })],
    { ageMonths: 24, now: NOW, statsAvailable: true })
  check('a post with clicks is left alone', r.candidates.length === 0)
  check('and counted as working', r.working === 1)
}

// ── never shown is the real merge candidate ─────────────────────────────────
{
  const r = buildConsolidationReport(
    [post({ id: 'dead', impressions: 0, clicks: 0 })],
    { ageMonths: 24, now: NOW, statsAvailable: true })
  check('a post Google never showed is a merge candidate',
    r.candidates[0]?.weakness === 'never-shown', r.candidates[0]?.weakness)
  check('the reason says it is competing for nothing',
    /not competing for anything/.test(r.candidates[0]?.reason ?? ''), r.candidates[0]?.reason)
  check('and states its age so the claim can be checked',
    /Published \d+ days ago/.test(r.candidates[0]?.reason ?? ''))
}

// ── posts on the same product are grouped, so the merge is obvious ──────────
{
  const r = buildConsolidationReport([
    post({ id: 'a', title: 'DeWalt 20V Battery Adapter Review' }),
    post({ id: 'b', title: 'Is the DeWalt 20V Adapter Worth It?' }),
    post({ id: 'c', title: 'Milwaukee M18 Inflator Review' }),
  ], { ageMonths: 24, now: NOW, statsAvailable: true })
  check('two posts on one product are grouped', r.groups.length === 1, JSON.stringify(r.groups))
  check('and the group holds exactly those two',
    r.groups[0]?.ids.sort().join() === 'a,b', JSON.stringify(r.groups[0]?.ids))
  check('an unrelated post is not dragged in', !r.groups[0]?.ids.includes('c'))
  check('each row knows what it overlaps with',
    r.candidates.find(c => c.id === 'a')?.overlapsWith.includes('b') === true)
}

// ── grouping is conservative ────────────────────────────────────────────────
// Grouping two unrelated posts invites a creator to merge away a good page.
{
  const r = buildConsolidationReport([
    post({ id: 'a', title: 'Best Kitchen Scale Review' }),
    post({ id: 'b', title: 'Best Travel Pillow Review' }),
  ], { ageMonths: 24, now: NOW, statsAvailable: true })
  check('two posts sharing only filler words are not grouped', r.groups.length === 0,
    JSON.stringify(r.groups))
  check('filler words are stripped from the key',
    !titleKeywords('The Best Review Guide').includes('best')
    && !titleKeywords('The Best Review Guide').includes('review'),
    titleKeywords('The Best Review Guide').join(','))
  check('but the product words survive',
    titleKeywords('DeWalt 20V Battery Adapter Review').includes('dewalt'))

  // Review-title filler, stripped directly. Not load-bearing on its own, since
  // the rarity rule catches most of it, but a small catalogue has no rarity to
  // work with and "fix" paired a face mask with a sleep patch on a live site.
  check('review filler carries no product identity',
    titleKeywords('The Real Fix: Tested, Honest, Complete').length === 0,
    titleKeywords('The Real Fix: Tested, Honest, Complete').join(','))
  check('and "fix" specifically, which caused the live failure',
    !titleKeywords('Fix Dry Skin?').includes('fix'),
    titleKeywords('Fix Dry Skin?').join(','))

  // The threshold's real job. These share exactly ONE distinctive word, and a
  // kitchen scale is not a kitchen knife. Merging them because both are
  // "kitchen" would destroy a page over a category noun.
  const oneWord = buildConsolidationReport([
    post({ id: 'a', title: 'Kitchen Scale Review' }),
    post({ id: 'b', title: 'Kitchen Knife Review' }),
  ], { ageMonths: 24, now: NOW, statsAvailable: true })
  check('one shared category word is not the same product', oneWord.groups.length === 0,
    JSON.stringify(oneWord.groups))

  // Two shared distinctive words is the same product.
  const twoWords = buildConsolidationReport([
    post({ id: 'a', title: 'Kitchen Scale Review' }),
    post({ id: 'b', title: 'Kitchen Scale Worth Buying?' }),
  ], { ageMonths: 24, now: NOW, statsAvailable: true })
  check('two shared words is', twoWords.groups.length === 1, JSON.stringify(twoWords.groups))
}

// ── no Search Console means no list, not a guessed one ──────────────────────
{
  const r = buildConsolidationReport(
    [post({ id: 'x' }), post({ id: 'y' })],
    { ageMonths: 24, now: NOW, statsAvailable: false })
  check('without stats there are no candidates', r.candidates.length === 0)
  check('and the reason is stated rather than the panel looking empty',
    !!r.note && /Connect Google Search Console/.test(r.note), r.note ?? '')
  check('with the refusal explained',
    !!r.note && /guessing at that would be worse/.test(r.note), r.note ?? '')
}

// ── a post with no publish date is never judged ─────────────────────────────
// Guessing its age would put real work on a delete list.
{
  const r = buildConsolidationReport(
    [post({ id: 'undated', publishedAt: null })],
    { ageMonths: 24, now: NOW, statsAvailable: true })
  check('an undated post is not a candidate', r.candidates.length === 0)
  check('and is not counted as too young either, since nothing is known',
    r.tooYoung === 0, `${r.tooYoung}`)
}

// ── velocity: a rate is never a problem on its own ──────────────────────────
{
  const dates = Array.from({ length: 56 }, (_, i) => daysAgo(i % 28))
  const landing = readVelocity({
    publishedAt: dates, totalPosts: 200, postsShown: 150, ageMonths: 24, now: NOW })
  check('two a day with posts landing is left alone', landing.verdict === 'fast-and-landing',
    landing.verdict)
  check('and gets no lecture', landing.note === null, landing.note ?? '')

  const notLanding = readVelocity({
    publishedAt: dates, totalPosts: 200, postsShown: 12, ageMonths: 24, now: NOW })
  check('two a day onto a pile nobody reads is raised',
    notLanding.verdict === 'fast-and-not-landing', notLanding.verdict)
  check('and says more posts is the lever that will not help',
    !!notLanding.note && /more posts is the one lever that will not help/.test(notLanding.note),
    notLanding.note ?? '')
  check('while making clear nothing is broken and nobody is penalising them',
    !!notLanding.note && /nobody is going to penalise you/.test(notLanding.note),
    notLanding.note ?? '')
  check('the rate is stated so it can be checked',
    !!notLanding.note && /about 14 a week/.test(notLanding.note), notLanding.note ?? '')
}

// ── a young site publishing fast is told it is normal ───────────────────────
{
  const dates = Array.from({ length: 56 }, (_, i) => daysAgo(i % 28))
  const v = readVelocity({ publishedAt: dates, totalPosts: 60, postsShown: 3, ageMonths: 1, now: NOW })
  check('a young site is not told its work is going nowhere',
    !!v.note && /that is normal and nothing is wrong/.test(v.note), v.note ?? '')
  check('and is explicitly not warned', !!v.note && /this is not a warning/.test(v.note), v.note ?? '')
}

// ── unmeasured reach never produces a warning ───────────────────────────────
// Telling a creator their work is going nowhere off a failed API call would be
// the worst thing this function could do.
{
  const dates = Array.from({ length: 56 }, (_, i) => daysAgo(i % 28))
  const v = readVelocity({ publishedAt: dates, totalPosts: 200, postsShown: null, ageMonths: 24, now: NOW })
  check('unmeasured reach gives no verdict', v.verdict === 'unknown', v.verdict)
  check('and no note', v.note === null, v.note ?? '')
}

// ── a slow or new site is never nagged ──────────────────────────────────────
{
  const slow = readVelocity({
    publishedAt: [daysAgo(3), daysAgo(10)], totalPosts: 40, postsShown: 2, ageMonths: 24, now: NOW })
  check('two posts a month is never raised', slow.note === null, slow.note ?? '')
  check('and is called steady', slow.verdict === 'steady', slow.verdict)

  const tiny = readVelocity({
    publishedAt: [daysAgo(1), daysAgo(2), daysAgo(3)], totalPosts: 3, postsShown: 0, ageMonths: 0, now: NOW })
  check('a site with three posts has no rate worth reading', tiny.verdict === 'unknown', tiny.verdict)
  check('and is told nothing', tiny.note === null, tiny.note ?? '')
}

// ── the failure Seb's own site exposed ──────────────────────────────────────
// 315 posts, eleven a week, every single one inside the 180 day window. The
// panel reported "nothing to consolidate" while Google was showing 106 of the
// 315 and ignoring the other 209. A site publishing at that rate keeps almost
// every post inside the window permanently, so age alone makes this list useless
// for exactly the creators who need it most.
{
  // 40 posts across the last 100 days. Some indexed, most not. Nothing is
  // outside a 180 day grace window.
  const posts: PostStat[] = []
  for (let i = 0; i < 40; i++) {
    posts.push(post({
      id: `p${i}`,
      title: `Product ${i} Review`,
      publishedAt: daysAgo(100 - i * 2),
      // The four most recent are indexed, so Google has demonstrably crawled
      // past everything older than them.
      impressions: i >= 36 ? 400 : 0,
    }))
  }
  const r = buildConsolidationReport(posts, { ageMonths: 4, now: NOW, statsAvailable: true })
  check('posts inside the window are still judged when Google crawled past them',
    r.candidates.length > 0, `${r.candidates.length} candidates from 40 posts`)
  check('and the count judged on evidence is reported',
    r.judgedByEvidence > 0, `${r.judgedByEvidence}`)
  check('the row says Google indexed something published after it',
    r.candidates.some(c => /crawled past/.test(c.reason)),
    r.candidates[0]?.reason ?? 'no candidates')
  check('the note explains why they were counted despite being new',
    !!r.note && /newer than the 180 day window but counted anyway/.test(r.note), r.note ?? '')

  // A post published AFTER everything Google has indexed has no evidence
  // against it, so it must still be left alone however fast the site publishes.
  const withBrandNew = buildConsolidationReport(
    [...posts, post({ id: 'brand-new', publishedAt: daysAgo(1), impressions: 0 })],
    { ageMonths: 4, now: NOW, statsAvailable: true })
  check('a post newer than every indexed one is still left alone',
    !withBrandNew.candidates.some(c => c.id === 'brand-new'),
    'Google has not been past it yet, so its silence means nothing')
  check('and is counted as too young', withBrandNew.tooYoung >= 1, `${withBrandNew.tooYoung}`)
}

// ── with nothing indexed anywhere, age is all there is ──────────────────────
// No indexed post means no evidence Google has looked at the site at all, and
// condemning every page on that basis would be the worst thing this file does.
{
  const posts: PostStat[] = []
  for (let i = 0; i < 20; i++) {
    posts.push(post({ id: `n${i}`, publishedAt: daysAgo(60 - i), impressions: 0 }))
  }
  const r = buildConsolidationReport(posts, { ageMonths: 4, now: NOW, statsAvailable: true })
  check('a site with nothing indexed condemns nothing', r.candidates.length === 0,
    `${r.candidates.length}`)
  check('and every post is counted as too young instead', r.tooYoung === 20, `${r.tooYoung}`)
}

// ── the evidence rule, directly ─────────────────────────────────────────────
{
  const now = NOW.getTime()
  const grace = 180 * 86_400_000
  const old = now - 200 * 86_400_000
  const recent = now - 10 * 86_400_000
  const indexedAt = now - 30 * 86_400_000

  check('an old post has had its chance on age alone',
    hasHadItsChance(old, now, grace, null) === true)
  check('a recent post with no indexed evidence has not',
    hasHadItsChance(recent, now, grace, null) === false)
  check('a post older than the newest indexed one has been crawled past',
    hasHadItsChance(now - 60 * 86_400_000, now, grace, indexedAt) === true)
  check('a post newer than every indexed one has not',
    hasHadItsChance(recent, now, grace, indexedAt) === false)
  check('a post published on the same day as the newest indexed one counts',
    hasHadItsChance(indexedAt, now, grace, indexedAt) === true)
}

// ── the groups the live panel got wrong ─────────────────────────────────────
// Real titles from gominreviews.com. The first version grouped all of these and
// three of the four groupings were wrong, because a brand name plus a category
// noun clears a two-word threshold just as easily as a product name does.
{
  // The catalogue these live in: a site full of face masks and solar lights, so
  // "mask", "collagen", "solar" and "lights" are the category, not the product.
  const catalogue = [
    'TOLEVITA Snail Mucin Bio-Collagen Face Mask: Fix Dry Skin?',
    'TOLEVITA Sleep Patches Review: The No-Pill Fix',
    'TOLEVITA Turmeric Vitamin C Bio-Collagen Mask: Real Glow?',
    'Karseell Collagen Hair Mask for Damaged Hair Review',
    'Sheet Mask Multipack Review: Worth The Money?',
    'Clay Mask for Oily Skin: A Real Test',
    'Collagen Peptide Powder Review',
    '20-Inch Solar Landscape Lights: Real-World Performance Review',
    'Solar Firefly Lights Review: Better Than Expected',
    'SHONELIGHTING Solar Step Lights: 33 LEDs, Zero Wiring',
    'Solar Fence Lights: Do They Last?',
    'Solar Path Lights Review',
    'String Lights for Patio Review',
    'NUMANU Collapsible Stool: Portable Seat That Packs Small',
    'Numanu Portable Telescopic Camping Stool Review',
  ].map((title, i) => post({ id: `t${i}`, title, publishedAt: daysAgo(300) }))

  const r = buildConsolidationReport(catalogue, { ageMonths: 24, now: NOW, statsAvailable: true })
  const groupOf = (needle: string) =>
    r.groups.find(g => g.titles.some(t => t.includes(needle)))

  // WRONG before: a face mask and a sleep patch, joined by the brand and by the
  // word "fix" meaning two different things.
  const maskGroup = groupOf('Snail Mucin')
  check('a face mask is not grouped with sleep patches',
    !maskGroup?.titles.some(t => t.includes('Sleep Patches')),
    JSON.stringify(maskGroup?.titles))

  // WRONG before: two different brands, joined by "collagen" and "mask".
  check('two brands are not grouped by a shared category noun',
    !maskGroup?.titles.some(t => t.includes('Karseell')),
    JSON.stringify(maskGroup?.titles))

  // WRONG before: three different solar products, joined by "solar" and "lights".
  const solarGroup = groupOf('20-Inch Solar')
  check('three different solar products are not one product',
    solarGroup === undefined || solarGroup.titles.length < 3,
    JSON.stringify(solarGroup?.titles))

  // RIGHT before, and must stay right: the same stool written up twice.
  const stoolGroup = groupOf('NUMANU Collapsible')
  check('the same product written twice IS still grouped',
    stoolGroup?.titles.length === 2, JSON.stringify(stoolGroup?.titles))
  check('and it is the two Numanu posts',
    stoolGroup?.titles.every(t => /numanu/i.test(t)) === true,
    JSON.stringify(stoolGroup?.titles))
}

// ── the count that cannot be right ──────────────────────────────────────────
// The live panel reported 176 posts judged by evidence out of 174 candidates.
// The two extra were posts that passed the gate and then turned out to be
// working, counted before the check that would have excluded them.
{
  const posts: PostStat[] = [
    post({ id: 'indexed-newest', publishedAt: daysAgo(10), impressions: 500, clicks: 30 }),
    post({ id: 'fine', publishedAt: daysAgo(30), impressions: 900, clicks: 40 }),
    post({ id: 'dead1', publishedAt: daysAgo(40), impressions: 0, clicks: 0 }),
    post({ id: 'dead2', publishedAt: daysAgo(50), impressions: 0, clicks: 0 }),
  ]
  const r = buildConsolidationReport(posts, { ageMonths: 4, now: NOW, statsAvailable: true })
  check('posts judged by evidence never exceed the candidates',
    r.judgedByEvidence <= r.candidates.length,
    `${r.judgedByEvidence} of ${r.candidates.length}`)
  check('a working post is not counted as judged by evidence',
    r.judgedByEvidence === 2, `${r.judgedByEvidence}`)
  check('and both working posts are counted as such', r.working === 2, `${r.working}`)
}

// ── the route and the panel never act ───────────────────────────────────────
// Merging and redirecting are destructive to live content on somebody's own
// site. The correct shape is a list a person reads and decides on.
{
  const strip = (x: string) => x.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  const read = (f: string) => strip(readFileSync(join(__dirname, '..', f), 'utf8'))

  const ROUTE = read('app/api/seo/consolidation/route.ts')
  check('the comment stripper works',
    strip('  // .delete(\nreal code').indexOf('.delete(') === -1)
  check('the route has no write path at all',
    !/\.(delete|update|upsert|insert)\(/.test(ROUTE),
    'this endpoint reads and reports, it never changes a post')
  check('and no POST handler',
    !/export async function (POST|PUT|PATCH|DELETE)/.test(ROUTE))

  check('a failed Search Console call is not read as an empty site',
    /if \(pageRows !== null\)/.test(ROUTE),
    'treating a timeout as no page ever shown would list every post as a merge candidate')
  check('and statsAvailable gates the whole report',
    /statsAvailable \}\)/.test(ROUTE))
  check('URLs are compared without scheme, www or trailing slash',
    /replace\(\/\^www\\\.\/i, ''\)/.test(ROUTE) && /replace\(\/\\\/\+\$\/, ''\)/.test(ROUTE),
    'Search Console and WordPress disagree about all three')
  check('the window is long enough that a quiet month does not condemn a post',
    /setDate\(start\.getDate\(\) - 183\)/.test(ROUTE))

  const PANEL = read('components/seo/Consolidation.tsx')
  check('the panel has no action button',
    !/onClick=\{[^}]*(delete|merge|redirect|remove)/i.test(PANEL))
  check('and says plainly that MVP will not do it for them',
    /MVP does not change any of these for you/.test(PANEL))
  check('a ranking post is styled as the different thing it is',
    /weaknessTone/.test(PANEL),
    'sharing the dead-post treatment would invite merging away a ranking')
  check('the excluded counts are stated rather than implied by a short list',
    /left out entirely: too soon to tell/.test(PANEL),
    'a panel showing nothing looks identical to a panel that is broken')
  check('and the trimmed list says it is trimmed',
    /Showing the \{data\.candidates\.length\} weakest of/.test(PANEL),
    '"show the other 92" under a heading counting 174 reads like a bug')
  check('the route sends the full count for that',
    /totalCandidates: report\.candidates\.length/.test(ROUTE))
  check('the group copy does not claim certainty it does not have',
    /look like they cover the same product/.test(PANEL)
    && /a good signal and not a certainty/.test(PANEL),
    'the grouping was wrong on three of four real groups before this')
}

// ── break tests ─────────────────────────────────────────────────────────────
{
  const breaks: string[] = []
  const broke = (name: string, cond: boolean) => { if (!cond) breaks.push(name) }

  // Break 1: judging a post before it has had a chance.
  broke('a 20 day old post on the list is caught',
    buildConsolidationReport([post({ id: 'f', publishedAt: daysAgo(20) })],
      { ageMonths: 24, now: NOW, statsAvailable: true }).candidates.length === 0)

  // Break 2: a ranking post offered as a merge, which throws out a ranking.
  const ranked = buildConsolidationReport(
    [post({ id: 'r1', title: 'DeWalt Adapter Review', impressions: 900 }),
     post({ id: 'r2', title: 'DeWalt Adapter Worth It', impressions: 900 })],
    { ageMonths: 24, now: NOW, statsAvailable: true })
  broke('a ranking post inside a merge group is caught',
    ranked.groups.every(g => !g.ids.includes('r1') && !g.ids.includes('r2')))

  // Break 3: a guessed list when there is no Search Console.
  broke('a guessed list with no stats is caught',
    buildConsolidationReport([post({ id: 'x' })],
      { ageMonths: 24, now: NOW, statsAvailable: false }).candidates.length === 0)

  // Break 4: grouping on a single shared category word, which would merge a
  // kitchen scale into a kitchen knife.
  broke('one shared word grouping two products is caught',
    buildConsolidationReport([
      post({ id: 'a', title: 'Kitchen Scale Review' }),
      post({ id: 'b', title: 'Kitchen Knife Review' }),
    ], { ageMonths: 24, now: NOW, statsAvailable: true }).groups.length === 0)

  // Break 5: a warning fired off a failed measurement.
  const dates = Array.from({ length: 56 }, (_, i) => daysAgo(i % 28))
  broke('a velocity warning off unmeasured reach is caught',
    readVelocity({ publishedAt: dates, totalPosts: 200, postsShown: null, ageMonths: 24, now: NOW }).note === null)

  // Break 6: nagging a creator whose posts ARE landing.
  broke('a lecture to someone doing fine is caught',
    readVelocity({ publishedAt: dates, totalPosts: 200, postsShown: 150, ageMonths: 24, now: NOW }).note === null)

  // Break 7: an undated post treated as old enough to judge.
  broke('an undated post on the list is caught',
    buildConsolidationReport([post({ id: 'u', publishedAt: null })],
      { ageMonths: 24, now: NOW, statsAvailable: true }).candidates.length === 0)

  // Break 8: age-only judging, which is what made the panel useless on a site
  // publishing eleven posts a week.
  const fast: PostStat[] = []
  for (let i = 0; i < 40; i++) {
    fast.push(post({ id: `f${i}`, title: `Product ${i} Review`, publishedAt: daysAgo(100 - i * 2), impressions: i >= 36 ? 400 : 0 }))
  }
  broke('age-only judging on a fast site is caught',
    buildConsolidationReport(fast, { ageMonths: 4, now: NOW, statsAvailable: true }).candidates.length > 0)

  // Break 9: condemning a whole site that has nothing indexed at all.
  const none: PostStat[] = []
  for (let i = 0; i < 20; i++) none.push(post({ id: `x${i}`, publishedAt: daysAgo(60 - i), impressions: 0 }))
  broke('condemning a site with nothing indexed is caught',
    buildConsolidationReport(none, { ageMonths: 4, now: NOW, statsAvailable: true }).candidates.length === 0)

  // Break 10: condemning a post Google has not reached yet, which on a fast
  // site would put this week's work on a merge list.
  broke('condemning a post newer than everything indexed is caught',
    !buildConsolidationReport(
      [...fast, post({ id: 'bn', publishedAt: daysAgo(1), impressions: 0 })],
      { ageMonths: 4, now: NOW, statsAvailable: true }).candidates.some(c => c.id === 'bn'))

  // Break 11: grouping on category nouns, which paired a face mask with a
  // sleep patch and two rival brands with each other on a live site.
  const cat = [
    'TOLEVITA Snail Mucin Bio-Collagen Face Mask: Fix Dry Skin?',
    'Karseell Collagen Hair Mask for Damaged Hair Review',
    'Sheet Mask Multipack Review: Worth The Money?',
    'Clay Mask for Oily Skin: A Real Test',
    'Collagen Peptide Powder Review',
  ].map((title, i) => post({ id: `c${i}`, title, publishedAt: daysAgo(300) }))
  broke('grouping two brands on a shared category noun is caught',
    buildConsolidationReport(cat, { ageMonths: 24, now: NOW, statsAvailable: true }).groups.length === 0)

  // Break 12: dropping the filler stopwords, which a small catalogue has no
  // rarity signal to fall back on.
  broke('review filler treated as a product name is caught',
    titleKeywords('The Real Fix: Tested, Honest, Complete').length === 0)

  // Break 13: a judged-by-evidence count that includes working posts.
  const mixed = [
    post({ id: 'a', publishedAt: daysAgo(10), impressions: 500, clicks: 30 }),
    post({ id: 'b', publishedAt: daysAgo(40), impressions: 0, clicks: 0 }),
  ]
  const mr = buildConsolidationReport(mixed, { ageMonths: 4, now: NOW, statsAvailable: true })
  broke('a judged count above the candidate count is caught',
    mr.judgedByEvidence <= mr.candidates.length)

  for (const b of breaks) failures.push(`BREAK TEST MISSED ${b}`)
}

if (failures.length) {
  console.error(`\n❌ consolidation: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('✅ consolidation: only posts that have had a real chance are listed, and a ranking post is never offered as a merge')
