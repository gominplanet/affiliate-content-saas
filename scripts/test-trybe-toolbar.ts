// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FIND BRANDS, ONE TOOLBAR (Seb, 2026-10-16: "This whole section where brands
// that match is very confusing ... at first glance, it is very overwhelming
// ... things don't get lost through the cracks"). Six rows of chips before the
// first brand became Quick lists, then one bar: brand search, Sort, Pay and
// Sells as dropdowns, and a Filters button that opens the rest, grouped.
//
// What this holds: nothing was lost (every filter still has its control), and
// nothing hides (every filter that is on shows as a chip with an x, even with
// the panel closed, and the Filters button counts them).
import { readFileSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

const C = read('components/labs/TrybeFinderControls.tsx')
const P = read('components/labs/TrybeOutreach.tsx')

// Every filter the finder has (NO_FILTERS) has words for its chip and a control in the panel.
const keys = (C.match(/export const NO_FILTERS: FinderFilters = \{([^}]*)\}/)?.[1] || '').split(',').map((x) => x.split(':')[0].trim()).filter(Boolean)
const toggles = C.slice(C.indexOf('export const TOGGLE_WORDS'), C.indexOf('export const NUMBER_WORDS'))
const numbers = C.slice(C.indexOf('export const NUMBER_WORDS'), C.indexOf('export const panelFiltersOn'))
// 15 since 2026-10-17: On TikTok Shop and Payout tier went up. 16 since
// 2026-10-21: TRYBE score or more (Star brands).
check('the finder still has all its filters', keys.length === 16, keys)
const missing = keys.filter((k) => k !== 'sells' && !new RegExp(`\\b${k}:`).test(toggles) && !new RegExp(`\\b${k}:`).test(numbers))
check('every filter has words for its chip', missing.length === 0, missing)
const noControl = keys.filter((k) => k !== 'sells' && !new RegExp(`(toggle|numberBox)\\('${k}'`).test(C))
check('every filter has its control in the panel', noControl.length === 0, noControl)

// Nothing hides.
check('every filter that is on gets a chip with an x, the panel open or not', /for \(const k of Object\.keys\(NUMBER_WORDS\) as NumberKey\[\]\) \{ const n = filters\[k\]; if \(n\) on\.push/.test(C) && /for \(const k of Object\.keys\(TOGGLE_WORDS\) as ToggleKey\[\]\) if \(filters\[k\]\) on\.push/.test(C) && /aria-label=\{`Remove: \$\{o\.text\}`\}/.test(C))
check('the name, sort, pay and sells show as chips too', /key: 'name'/.test(C) && /key: 'sort'/.test(C) && /key: 'pay'/.test(C) && /key: 'sells'/.test(C))
check('the Filters button opens a panel it names, and counts what is on inside it', /aria-expanded=\{open\} aria-controls="finder-filters"/.test(C) && /id="finder-filters"/.test(C) && /const inPanel = panelFiltersOn\(filters\)/.test(C) && /\{inPanel > 0 && <span/.test(C))
check('Clear all resets everything', /onFilters\(NO_FILTERS\); onName\(''\); onSort\(sorts\[0\]\.id\); onPay\(pays\[0\]\.id\)/.test(C))
check('the dropdowns are native, labelled selects', /<select value=\{value\}/.test(C) && /<Picker label="Sort"/.test(C) && /<Picker label="Pay"/.test(C) && /<Picker label="Sells"/.test(C))

// The page.
check('the page uses the toolbar, with its sorts and pay types', /<FinderToolbar filters=\{filters\}/.test(P) && /sorts=\{SORTS\.filter\(s => !preview \|\| s\.id !== 'fit'\)(\.map\([^\n]*?\))?\}/.test(P) && /pays=\{PAYS\.map\(/.test(P))
check('the old rows are gone', !/aria-label="Sort brands"/.test(P) && !/aria-label="Filter by pay type"/.test(P) && !/FinderFilterBar/.test(P + C))
check('Your priorities sit in view under Best bets, and in the panel otherwise', /panelExtra=\{sortBy === 'picks' \? undefined : priorityBox\}/.test(P) && /\{sortBy === 'picks' && priorityBox\}/.test(P))
check('the admin box starts closed', /<details className="rounded-lg border border-dashed/.test(P) && /<summary className="cursor-pointer font-semibold">Admin only/.test(P))
check('Quick lists come first, as before', P.indexOf('<FinderPresets') > 0 && P.indexOf('<FinderPresets') < P.indexOf('<FinderToolbar'))
check('purple words stay readable on the dark theme', /const ON_TEXT = 'text-\[#7C3AED\] dark:text-\[#B9A2FF\]'/.test(C))
check('the words on screen have no dashes', !/[–—]/.test((C.slice(C.indexOf('export function FinderToolbar'), C.indexOf('/** What the filters did')).match(/>[^<>{}\n]{3,}</g) || []).join(' ')))

if (fails.length) { console.error('trybe-toolbar failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ trybe-toolbar: one bar and a grouped Filters panel; every filter kept, and every one that is on shows as a chip with an x')
