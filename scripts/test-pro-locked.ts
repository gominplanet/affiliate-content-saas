// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EVERY PRO TOOL, LOCKED, FOR THE LEGACY PLANS (lib/pro-locked-nav; Seb,
// 2026-11-08: "the legacy people that are on the creator or studio tier ...
// should be able to see everything ... that the full membership offers, but
// without having access to it ... If they click on something ... they get
// asked to upgrade"). Held on the traps: only Creator and Studio, never staff
// rows, a locked row in Pro's place with a lock, a Pro tab locked on a row the
// member has, nothing the member's plan opens ever covered by the panel, the
// panel saying what the tool does, and no pin on a tool they cannot open.
import { readFileSync } from 'node:fs'
import { lockProRows, lockedPageAt, proLockedBody, seesProLocked, type LockableGroup } from '../lib/pro-locked-nav'
import { newsGateOpen, WHATS_NEW } from '../lib/whats-new'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }

// ── WHO ──
check('only the legacy Creator and Studio plans', seesProLocked('creator') && seesProLocked('studio') && !['pro', 'admin', 'amazon', 'trial', ''].some(seesProLocked))

// ── THE MERGE ──
const menu = (pro: boolean): LockableGroup[] => [
  { label: '', items: [{ href: '/dashboard', label: 'Dashboard' }] },
  { label: 'Find products', items: [
    { href: '/amz-finder', label: 'Product research' },
    { href: '/trybe', label: 'TRYBE', gate: pro, badge: pro ? 'New' : undefined },
  ] },
  { label: 'Blog', items: [
    { href: '/comparison', label: 'Comparisons and guides', tabs: [
      { href: '/comparison', label: 'Comparisons' },
      { href: '/buying-guides', label: 'Buying guides', gate: pro },
    ] },
  ] },
  { label: 'Share', items: [
    { href: '/first-comments', label: 'YouTube comments', gate: pro, tabs: [
      { href: '/first-comments', label: 'Pinned comments', gate: pro },
      { href: '/encore', label: 'On sale comments', gate: pro },
    ] },
    { href: '/oink', label: 'Oink', external: true, gate: pro },
  ] },
  { label: 'Labs', items: [{ href: '/storefront', label: 'AMZ Storefront', gate: pro }] },
]
const out = lockProRows(menu(false), menu(true))
const trybe = out[1].items[1]
check('a Pro row the plan lacks is listed in Pro’s place, locked, with the Pro chip', trybe.gate === true && trybe.locked === true && trybe.badge === 'Pro')
check('a row the plan has is left exactly as it is', out[1].items[0] === menu(false)[1].items[0] || (out[1].items[0].href === '/amz-finder' && !out[1].items[0].locked))
const cmp = out[2].items[0]
check('a Pro tab on a row the member has is locked, the rest of the row kept', !cmp.locked && cmp.tabs![0].locked !== true && cmp.tabs![1].locked === true && cmp.tabs![1].gate === true)
const yc = out[3].items[0]
check('a locked row’s tabs are all locked', yc.locked === true && yc.tabs!.every((t) => t.locked === true))
check('an outside link is never offered', out[3].items[1].gate === false && !out[3].items[1].locked)
check('Labs and Admin are never offered', out[4].items[0].gate === false && !out[4].items[0].locked)
const shifted = lockProRows(menu(false), [menu(true)[0], { ...menu(true)[1], items: [...menu(true)[1].items].reverse() }, ...menu(true).slice(2)])
check('a row that does not line up with Pro’s is left as the member has it', shifted[1].items[1].gate === false)

// ── THE ADDRESS ──
const at = (p: string) => lockedPageAt(out, p)
check('a locked tool, and any page under it, opens the Pro panel', at('/trybe')?.label === 'TRYBE' && at('/trybe/brand/42')?.label === 'TRYBE')
check('a locked tab says its own name', at('/buying-guides')?.label === 'Buying guides' && at('/buying-guides')?.rowHref === '/comparison')
check('a locked row’s tab says the row', at('/encore')?.label === 'YouTube comments')
check('nothing the plan opens is covered', !at('/dashboard') && !at('/comparison') && !at('/amz-finder') && !at('/billing'))
const nested: LockableGroup[] = [{ label: 'A', items: [{ href: '/x', label: 'X', gate: true, locked: true }, { href: '/x/open', label: 'Open one' }] }]
check('the closest address wins, so an open page under a locked one stays open', !lockedPageAt(nested, '/x/open') && !lockedPageAt(nested, '/x/open/7') && lockedPageAt(nested, '/x/other')?.label === 'X')
const tie: LockableGroup[] = [{ label: 'A', items: [{ href: '/y', label: 'Locked', gate: true, locked: true }, { href: '/y?tab=a', label: 'Open' }] }]
check('on a tie the open row wins', !lockedPageAt(tie, '/y'))

// ── THE PANEL ──
const body = proLockedBody({ href: '/trybe', label: 'TRYBE', rowHref: '/trybe' }, 'studio')
check('the panel says what the tool does, then what Pro is, by the member’s own plan', body.startsWith('Find brands on TRYBE') && /Pro is the full MVP membership/.test(body) && /Moving from Studio to Pro keeps everything you have made in MVP\./.test(body))
check('a tab with no line of its own uses its row’s line', proLockedBody({ href: '/encore', label: 'YouTube comments', rowHref: '/trybe' }, 'creator').startsWith('Find brands on TRYBE'))
check('no dashes, no plan the member cannot buy', ![body, proLockedBody({ href: '/x', label: 'X', rowHref: '/x' }, 'creator')].some((b) => /[–—]| - /.test(b) || /\b(Amazon|Studio|Creator) plan\b/.test(b.replace(/Moving from \w+ to Pro/, ''))))

// ── IN THE SHELL ──
const S = readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')
check('the menu is drawn for a plan, from that plan alone', /const navFor = \(forTier: Tier\): NavGroupDef\[\] => \{/.test(S) && /const isPro = canSeeNav\('labs', forTier\)/.test(S) && /const canAmazonHub = amazonHubFor\(forTier\)/.test(S) && !/const canAmazonHub = \(\[/.test(S))
check('legacy plans get the member’s menu with Pro’s rows locked in', /const legacyView = seesProLocked\(effectiveTier\)/.test(S) && /legacyView \? lockProRows<NavItemDef, NavGroupDef>\(navFor\(effectiveTier\), navFor\('pro'\)\) : navFor\(effectiveTier\)/.test(S))
check('opening a locked tool shows the Pro panel in place of the page, after the Amazon wall', /const proLocked = legacyView \? lockedPageAt\(NAV_GROUPS, pathname\) : undefined/.test(S) && /amazonLocked \? <AmazonUpgradeGate[^\n]*\n\s*: proLocked \? <ProUpgradePanel feature=\{proLocked\.label\} body=\{proLockedBody\(proLocked, effectiveTier\)\} \/>\n\s*: children\}/.test(S))
check('a locked row wears a lock and the word Pro, in the menu, the area strip and the tabs', /\{!collapsed && item\.locked && \(/.test(S) && /<Lock size=\{9\} aria-hidden="true" \/>Pro/.test(S) && /\{!collapsed && !item\.locked && item\.badge !== undefined && \(/.test(S) && (S.match(/\{(it|t)\.locked && <Lock size=\{12\} aria-label="Part of Pro" \/>\}/g) || []).length === 3)
check('TRYBE on its own wears the lock too', /badge: s2\.direct && s2\.rows\[0\]\?\.locked \? 'Pro' : sectionBadge\(s2\), locked: s2\.direct && !!s2\.rows\[0\]\?\.locked/.test(S))
check('the lock reaches the Dashboard and the area pages', /locked: it\.locked \}\)\),/.test(S) && /aliases: \(it\.tabs \?\? \[\]\)\.map\(\(t\) => t\.href\)\.filter\(\(h\) => h !== it\.href\), locked: it\.locked \}\)\n/.test(S))
check('no star on a locked row', /!railCollapsed && !item\.external && !item\.locked && \(\(\) => \{/.test(S))
const D = readFileSync('components/dashboard/TealDashboard.tsx', 'utf8')
check('the Dashboard shows the lock, with no pin, and never pins a locked tool', /\{f\.locked \? <ProChip \/> : <Badge badge=\{f\.badge\} \/>\}/.test(D) && /\{!f\.locked && <button type="button" onClick=\{\(\) => pin\(f\)\}/.test(D) && /g\.items\.find\(\(it\) => !it\.locked && \(/.test(D))
const P = readFileSync('app/(dashboard)/area/[section]/page.tsx', 'utf8')
check('an area page shows the lock, says Get it with Pro, counts them, and has no pin on them', /\{f\.locked && <span[^\n]*<Lock size=\{10\}/.test(P) && /\{f\.locked \? 'Get it with Pro' : 'Open'\}/.test(P) && /, \$\{lockedCount\} of them with Pro/.test(P) && /\{!f\.locked && <button type="button" onClick=\{\(\) => pin\(f\)\}/.test(P))

// ── TOLD ──
const news = WHATS_NEW.find((n) => n.gate === 'legacy_plan')
check('What’s new tells the legacy plans, and only them', !!news && newsGateOpen('legacy_plan', 'creator') && newsGateOpen('legacy_plan', 'studio') && !newsGateOpen('legacy_plan', 'pro') && !newsGateOpen('legacy_plan', 'admin'))
check('in plain words, no dashes, no year', !!news && !/[–—]| - /.test(news.title + news.desc) && !/\b20\d\d\b/.test(news.title + news.desc))

if (fails.length) { console.error(`✗ ${fails.length} Pro locked check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
console.log('✓ Pro locked: legacy Creator and Studio see every Pro tool with a lock, and opening one asks them to move to Pro')
