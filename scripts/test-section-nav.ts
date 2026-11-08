// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MAIN AREAS ON THE LEFT, PAGES INSIDE (lib/labs-preview section_nav; Seb,
// 2026-11-08: "Could this be just the ones that you see on the left? ... if I
// click on find products, it would bring me to a page where inside that page,
// I would have the different sub pages ... Tribe should be its own kind of
// main menu"). Held on the traps: admin only until opened, the menu's own
// rows and gates (nothing a member cannot open), TRYBE out of Find products
// and straight to its page, every page of an area wearing the strip of its
// sister pages, the area page never clashing with Passport's public /go
// links, and the menu exactly as before while the switch is off.
import { readFileSync, existsSync } from 'node:fs'
import { previewOpenToPro } from '../lib/labs-preview'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const S = readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')
const PAGE = 'app/(dashboard)/area/[section]/page.tsx'

check('on for every account on every plan (Seb, 2026-11-08: "turn it on for everyone")', previewOpenToPro('section_nav') && /const sectionNav = previewOpenToPro\('section_nav'\) \|\| canUsePreview\('section_nav', effectiveTier\)/.test(S))
check('the menu is exactly as before while the switch is off', /\{!sectionNav && orderedGroups\.map\(\(group\) => \{/.test(S))
check('the left side shows one row per main area', /\{sectionNav && \(\s*<div className="flex flex-col gap-0\.5">\s*\{navSections\.map\(\(s2\) => \(/.test(S))
check('areas are the menu’s own rows, gates kept, nothing external', /const rows = g\.items\.filter\(\(it\) => it\.gate !== false && !it\.external\)/.test(S))
check('TRYBE comes out of Find products and opens straight away', /const trybe = rows\.find\(\(it\) => it\.href === '\/trybe'\)/.test(S) && /out\.push\(\{ label: 'TRYBE', slug: 'trybe', href: '\/trybe',[^}]*direct: true/.test(S))
check('no My features area: pins live on the Dashboard (Seb, 2026-11-08)', /\/\/ Pins are on the Dashboard, not in an area of their own\.\n\s*if \(rest\.length\) out\.push\(/.test(S) && !/'My features'/.test(S))
check('each area opens its own page, on an address Passport does not use', /href: `\/area\/\$\{slugOf\(g\.label\)\}`/.test(S) && existsSync(PAGE) && !existsSync('app/(dashboard)/go') && existsSync('app/go/[code]'))
check('an area row counts its tools’ unread numbers', /const sectionBadge = /.test(S) && /badge: s2\.direct && s2\.rows\[0\]\?\.locked \? 'Pro' : sectionBadge\(s2\)/.test(S))
check('every page of an area wears the strip of its sister pages, above its own tabs', /<SectionStrip section=\{activeSection\}/.test(S) && S.indexOf('<SectionStrip section={activeSection}') < S.indexOf('<SectionTabs item={tabbedItem}'))
check('a page belongs to its own area', /const activeSection = navSections\.find\(\(s2\) => !s2\.direct && \(pathname === s2\.href \|\| s2\.rows\.some\(\(it\) => itemActive\(it\)\)\)\)/.test(S))
const P = readFileSync(PAGE, 'utf8')
check('the area page lists the menu’s rows for this member, and says when an address is not in their menu', /useShellSections\(\)/.test(P) && /This part of MVP is not in your menu/.test(P))
check('each tool says what it does and can be pinned to the Dashboard', /featureLine\(f\.href\)/.test(P) && /aria-label=\{on \? `Unpin \$\{f\.label\}` : `Pin \$\{f\.label\} to the top of your Dashboard`\}/.test(P))
check('no dashes in what the member reads', !/[–—]/.test(P.split('\n').slice(9).join('\n')))

if (fails.length) { console.error(`✗ ${fails.length} section menu check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
console.log('✓ Section menu: main areas on the left, their tools inside, TRYBE on its own, for everyone')
