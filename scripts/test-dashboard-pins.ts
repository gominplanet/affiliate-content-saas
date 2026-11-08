// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PIN IT TO THE TOP (Seb, 2026-11-07: "on the cards, have a little box that
// says pin it to the top. And if I pin that card to the top, it becomes a
// pinned card to the top of the dashboard"). Held on the traps: every tool
// card has a pin that never opens the tool, the pins are the same list as My
// features in the menu (saved to the account), a pin made on the Dashboard
// shows in the menu at once and the other way round, a tool this plan cannot
// open is never pinned on screen, the limit is said, and a list kept only in
// this browser says so.
import { readFileSync } from 'node:fs'
import { toggleFavorite, MAX_NAV_FAVORITES } from '../lib/nav-favorites'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const D = readFileSync('components/dashboard/TealDashboard.tsx', 'utf8')
const F = readFileSync('lib/nav-favorites.ts', 'utf8')
const S = readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')

check('every tool card under Everything MVP does has a pin, beside the link, not inside it', /\{\/\* PIN IT TO THE TOP: the one place pins live[\s\S]{0,160}?\*\/\}\s*\{!f\.locked && <button type="button" onClick=\{\(\) => pin\(f\)\} aria-pressed=\{on\}/.test(D) && /<\/Link>\s*\{\/\* PIN IT TO THE TOP/.test(D))
check('the pins are one list, saved to the account', /const \{ favorites, toggle: togglePin, savedTo \} = useNavFavorites\(\)/.test(D) && /from\('user_nav_favorites'\)/.test(F))
check('a pinned card shows first, under the banner, before This month', D.indexOf('PINNED: the tools this member pinned') > D.indexOf('{alerts}') && D.indexOf('PINNED: the tools this member pinned') < D.indexOf('── 2. This month ──'))
check('pinned in the order pinned, only tools this plan opens (from the menu itself)', /for \(const h of favorites\) \{\s*for \(const g of groups\) \{/.test(D) && /it\.href === h \|\| \(it\.aliases \|\| \[\]\)\.includes\(h\)/.test(D))
check('a pinned card can be unpinned from where it sits', /aria-label=\{`Unpin \$\{f\.label\}`\}/.test(D) && /<PinOff size=\{15\} \/>/.test(D))
check('with nothing pinned, the Dashboard says how to pin', /Put the tools you use most right here\. Press/.test(D))
check('the limit is said by name, never a silent no', /You can pin \$\{MAX_NAV_FAVORITES\}\. Unpin one to pin \$\{f\.label\}\./.test(D) && toggleFavorite(Array.from({ length: MAX_NAV_FAVORITES }, (_, i) => `/x${i}`), '/y').full === true)
check('kept only in this browser is said', /savedTo === 'device'/.test(D) && /Saved in this browser only for now/.test(D))
check('a pin shows everywhere at once, and in another tab', /const CHANGED_EVENT = 'mvp:nav-favorites'/.test(F) && /window\.dispatchEvent\(new CustomEvent\(CHANGED_EVENT, \{ detail: r\.next \}\)\)/.test(F) && /window\.addEventListener\(CHANGED_EVENT, onChange\)/.test(F) && /window\.addEventListener\('storage', onStorage\)/.test(F))
check('a row’s tabs count as the row, so a pin on a tab shows as its tool', /aliases: \(it\.tabs \?\? \[\]\)\.map\(\(t\) => t\.href\)\.filter\(\(h\) => h !== it\.href\)/.test(S) && /\[f\.href, \.\.\.\(f\.aliases \|\| \[\]\)\]\.some\(\(h\) => favorites\.includes\(h\)\)/.test(D))
// NO MY FEATURES IN THE MENU (Seb, 2026-11-08: "I don't think we need the left
// tab or left area called My Features. That could be gone, and we could have
// the dashboard have the pinned features instead").
const P = readFileSync('app/(dashboard)/area/[section]/page.tsx', 'utf8')
check('the menu has no My features: no area, no section, no colour', !/'My features'/.test(S) && !/groupsWithFavorites/.test(S))
check('the old My features address goes to the Dashboard and says so', /const pinsMoved = section === 'my-features'/.test(P) && /router\.replace\('\/dashboard'\)/.test(P) && /Your pinned tools are at the top of your/.test(P))
check('the menu’s star pins to the Dashboard, and says so', /aria-label=\{starred \? `Unpin \$\{item\.label\} from your Dashboard` : `Pin \$\{item\.label\} to the top of your Dashboard`\}/.test(S))
check('the Dashboard no longer points at a menu list that is gone', !/My features in the menu/.test(D.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')))
check('no dashes in what the member reads', !/[–—]/.test(D.slice(D.indexOf('PINNED: the tools'), D.indexOf('── 2. This month ──'))))

if (fails.length) { console.error(`✗ ${fails.length} dashboard pin check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
console.log('✓ Dashboard pins: a pin on every tool, pinned tools first, the one place pins live, said when they cannot follow you')
