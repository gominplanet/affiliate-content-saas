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

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

check('admin only until Seb opens it', canUsePreview('trybe_layout', 'admin') && !canUsePreview('trybe_layout', 'pro'))

// ── THE MENU ──
const shape = GROUPS_V3.map((g) => `${g.label}: ${g.items.map((it) => `${it.label}[${it.tabs.join(',')}]`).join(' ')}`)
check('five jobs in the order a creator works', GROUPS_V3.map((g) => g.label).join() === 'Home,Find brands,Messages,Videos,Earnings')
check('Home holds what is happening', shape[0] === 'Home: Today[home] This week[week] What changed[changes]')
check('Find brands holds the searching only', shape[1] === 'Find brands: Find brands[find] Star brands[stars]')
check('Messages holds every word to and from a brand', shape[2] === 'Messages: Inbox[inbox] Ready to send[queue] Sent[sent]')
check('Videos holds a video from script to approval', shape[3] === 'Videos: Brand scripts[create] Upload[upload] Submissions[submissions] What’s working[working]')
check('Earnings holds what came of it', shape[4] === 'Earnings: Earnings[analytics] By brand[brands]')
const ALL = ['home', 'create', 'upload', 'find', 'stars', 'queue', 'sent', 'inbox', 'analytics', 'submissions', 'brands', 'week', 'changes', 'working']
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

if (fails.length) { console.error(`✗ ${fails.length} TRYBE layout check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
console.log('✓ TRYBE layout: five jobs in the order a creator works, and Find brands with every filter in one column')
