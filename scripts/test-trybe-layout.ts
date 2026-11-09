// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE'S NEW MENU AND FIND BRANDS (labs-preview trybe_layout; Seb,
// 2026-11-08: "when I click on tribe, I am met with a lot of confusion ... Can
// we have a better, I guess, hierarchy of things? ... when I'm searching for
// brands, I feel like it's still a mess to filter"). Held on the traps: admin
// only until opened, every page in exactly one job, the red number where the
// replies are, no page with a second switch inside it, every filter in one
// column beside the brands (a Filters button on a phone, Hide filters on a
// wide screen), the settings out of Find brands, and the old page untouched
// while the switch is off.
import { readFileSync } from 'node:fs'
import { canUsePreview } from '../lib/labs-preview'
import { GROUPS_V3, groupOf, pageLabelV3 } from '../components/labs/TrybeNav'
import { filterCheck, readFilters, anyFilterOn } from '../lib/trybe-finder'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

check('open to every Pro account (Seb, 2026-11-09: "push it live"), and to no plan without TRYBE', canUsePreview('trybe_layout', 'admin') && canUsePreview('trybe_layout', 'pro') && !canUsePreview('trybe_layout', 'creator') && !canUsePreview('trybe_layout', 'trial'))

// ── THE MENU ──
const shape = GROUPS_V3.map((g) => `${g.label}: ${g.items.map((it) => `${it.label}[${it.tabs.join(',')}]`).join(' ')}`)
check('five jobs in the order a creator works', GROUPS_V3.map((g) => g.label).join() === 'Home,Find brands,Messages,Videos,Earnings')
check('Home holds what is happening', shape[0] === 'Home: Today[home] This week[week] What changed[changes]')
check('Find brands holds the searching, and the brands you already filmed', shape[1] === 'Find brands: Find brands[find] Star brands[stars] Match my TikTok[filmed]')
check('Messages holds every word to and from a brand', shape[2] === 'Messages: Inbox[inbox] Ready to send[queue] Sent[sent]')
check('Videos holds a video from script to approval', shape[3] === 'Videos: Brand scripts[create] Upload[upload] Submissions[submissions] What’s working[working]')
check('Earnings holds what came of it', shape[4] === 'Earnings: Earnings[analytics] By brand[brands]')
const ALL = ['home', 'create', 'upload', 'find', 'stars', 'filmed', 'queue', 'sent', 'inbox', 'analytics', 'submissions', 'brands', 'week', 'changes', 'working']
const seen = GROUPS_V3.flatMap((g) => g.items.flatMap((it) => it.tabs))
check('every page is in exactly one job, and each is its own button', ALL.every((t) => seen.filter((x) => x === t).length === 1) && seen.length === ALL.length && GROUPS_V3.every((g) => g.items.every((it) => it.tabs.length === 1)))
check('the red number sits on the Inbox, the queue count on Ready to send', GROUPS_V3[2].items[0].count === 'unread' && GROUPS_V3[2].items[1].count === 'queue')
check('a page opens its own job', groupOf('inbox', true) === 'messages' && groupOf('submissions', true) === 'videos' && groupOf('week', true) === 'home' && groupOf('inbox') === 'get')
check('the header above a page uses the menu’s own name', pageLabelV3('create') === 'Brand scripts' && pageLabelV3('brands') === 'By brand')
check('short hints, no dashes', GROUPS_V3.every((g) => g.hint.length <= 20 && !/[–—]/.test(g.hint)))

// ── THE PAGE ──
const O = read('components/labs/TrybeOutreach.tsx')
const P = read('app/(dashboard)/trybe/page.tsx')
check('the page follows the switch', /layout=\{canUsePreview\('trybe_layout', tier\)\}/.test(P) && /<TrybeNav tab=\{tab\} queue=\{queue\.length\} unread=\{navUnread\} go=\{go\} layout=\{layout\} \/>/.test(O))
check('no page carries a second switch inside it in the new menu', /const pair = !layout && tile && tile\.tabs\.length > 1 \? tile\.tabs : null/.test(O))
check('one search row: what you review, or a brand by name', /htmlFor="trybe-kw"/.test(O) && /htmlFor="trybe-name"/.test(O) && /\{layout \? \(\n\s*\/\/ ONE SEARCH ROW/.test(O))
check('the old search card is kept while the switch is off', /Or browse a niche/.test(O))
check('the filters sit in one column beside the brands', /<aside id="trybe-filters"/.test(O) && /<FinderSidebar filters=\{filters\}/.test(O) && /lg:grid lg:grid-cols-\[15\.5rem_minmax\(0,1fr\)\]/.test(O))
check('a phone opens the column from Filters; a wide screen can hide it', /className="lg:hidden inline-flex[^"]*"[^>]*>\s*<SlidersHorizontal size=\{14\} \/> \{filtersOpen \? 'Hide filters' : 'Filters'\}/.test(O) && /\{filtersHidden \? 'Show filters' : 'Hide filters'\}/.test(O) && /localStorage\.setItem\('mvp\.trybe\.filtersHidden'/.test(O))
check('the count, the filter button and Sort share one bar', /\{layout && finderToolbar\(true\)\}/.test(O) && /compact=\{compact\}/.test(O))
check('the daily settings move into the outreach setup', /\{layout && capRow && <div className=\{card\} style=\{cardStyle\}><p className="text-\[14px\] font-semibold mb-2">Daily messages<\/p>\{capRow\}<\/div>\}/.test(O))
const C = read('components/labs/TrybeFinderControls.tsx')
const side = C.slice(C.indexOf('export function FinderSidebar'))
check('every filter group is in the column, in view', ['Quick lists', 'Niche', 'Pay', 'Room for you', 'The brand', 'Sells'].every((t) => side.includes(`section('${t}'`)))
check('filters are plain ticks, radios and numbers', /type="checkbox"/.test(side) && /type="radio"/.test(side) && /type="number"/.test(side))
check('each group says how many of its filters are on', /const payCount = /.test(side) && /const roomCount = /.test(side) && /const brandCount = /.test(side))
check('no dashes in the column', !/[–—]/.test(side.replace(/\/\*[\s\S]*?\*\//g, '')))

// ── WHAT MVP ALREADY HAD, SHOWN AND FILTERED ON (Seb, 2026-11-08: "You have
// to utilize all that information that Tribe is giving us") ──
{
  const base = { perVideo: 30, creators: null, stats: { videosApproved: null, videos30d: null, paidOut: null, samples: null, joinedAt: null } as never, earningsBucket: null, amazon: null, starred: false }
  const f = { ...{ approves: true } }
  check('Approves most videos passes at 60% and up, fails under, and waits when the pool is too small',
    filterCheck({ ...base, approval: 0.6 }, f).pass && !filterCheck({ ...base, approval: 0.55 }, f).pass && filterCheck({ ...base, approval: null }, f).unknown.includes('approves'))
  const g = { roomAndPay: true }
  check('Room and pays well wants both sides read: not crowded and paying',
    filterCheck({ ...base, roomPay: { crowd: 'filling', pay: 'paying' } }, g).pass && !filterCheck({ ...base, roomPay: { crowd: 'crowded', pay: 'paying' } }, g).pass
    && !filterCheck({ ...base, roomPay: { crowd: 'open', pay: 'some' } }, g).pass && filterCheck({ ...base, roomPay: { crowd: 'open', pay: null } }, g).unknown.includes('roomAndPay'))
  check('the new filters are read from the page and counted as on', readFilters({ approves: true, roomAndPay: true }).approves === true && readFilters({ roomAndPay: true }).roomAndPay === true && anyFilterOn({ approves: true }))
  const R = read('app/api/labs/trybe/route.ts')
  check('the members\u2019 approval rate comes with every brand, and feeds the filter', /if \(p\.approvalRate != null\) approval\.set\(id, p\.approvalRate\)/.test(R) && /approval: results\.approval\.get\(x\.r\.brand_id\) \?\? null, roomPay: roomPayBy\.get\(x\.r\.brand_id\) \?\? null/.test(R) && /approval: results\.approval\.get\(r\.brand_id\) \?\? null,/.test(R))
  check('how often it answers: other members\u2019 requests to the brands shown, pooled like the brand page', /\.in\('brand_id', top\.map\(x => x\.r\.brand_id as string\)\)\.neq\('user_id', ownerId\)\.in\('status', \['sent', 'already'\]\)/.test(R) && /const p = replyPool\(list\); if \(p\.shown\) repliesBy\.set/.test(R) && /replies: repliesBy\.get\(r\.brand_id\) \?\? null/.test(R))
  const T = read('components/labs/TrybeBrandTable.tsx')
  check('the table shows what a month pays, TikTok Shop, approvals and answers, in the spreadsheet too',
    ["{ id: 'month', label: 'Pays a month'", "{ id: 'tiktok', label: 'TikTok Shop'", "{ id: 'approves', label: 'Approves'", "{ id: 'answers', label: 'Answers'"].every((x) => T.includes(x)) && /'Pays a month \(\$\)'.*'TikTok Shop'.*'Approves \(%\)', 'Answers \(%\)'/.test(T))
  check('the brand\u2019s name stays in view while the table scrolls', /position: 'sticky', left: preview \? 0 : 40/.test(T) && /sticky left-0 z-\[1\]/.test(T))
  check('a brand not read says so in the new columns, never a zero', /<Unknown>Not checked<\/Unknown>/.test(T) && (T.match(/<Unknown>Not yet<\/Unknown>/g) || []).length >= 3)
  check('every card shows its Meta ads and Top 100, its approvals and its answers', /<AdsChip count=\{b\.meta_ads\} fresh=\{b\.meta_fresh\} trust=\{b\.meta_trust\} top100=\{b\.top100_hits\} \/>/.test(O) && /<ApprovalChip rate=\{b\.approval\} \/>/.test(O) && /<RepliesChip replies=\{b\.replies\} \/>/.test(O))
  check('a Meta count that is not the brand\u2019s own is never shown as its number', /const own = typeof count === 'number' && fresh && \(!trust \|\| trust === 'own' \|\| trust === 'unchecked'\)/.test(C))
  check('the column offers the new filters', /tick\('approves'/.test(side) && /tick\('roomAndPay'/.test(side))
}

if (fails.length) { console.error(`✗ ${fails.length} TRYBE layout check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
console.log('✓ TRYBE layout: five jobs in the order a creator works, and Find brands with every filter in one column')
