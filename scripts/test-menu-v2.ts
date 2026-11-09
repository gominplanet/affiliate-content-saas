// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE LEFT MENU REDRAWN, THE DASHBOARD'S ORDER, AND TRYBE'S TODAY APART FROM
// WHAT CHANGED (lib/menu-areas, labs-preview menu_v2; Seb, 2026-11-08: "still
// not organized the way I want it to be organized. It's a little bit all over
// the place"; 2026-11-09: "go ahead and do everything that you're supposed
// to"). Held on the traps: admin only until opened, every tool in exactly one
// area with its gates and tabs untouched, a tool the plan does not name never
// dropped, TRYBE right under the Dashboard, Needs you first on the Dashboard,
// and the market news shown once, in What changed.
import { readFileSync } from 'node:fs'
import { previewOpenToPro } from '../lib/labs-preview'
import { MENU_V2, REDRAWN, regroupMenu } from '../lib/menu-areas'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

check('on for every account on every plan (Seb, 2026-11-09: "turn it on for everyone")', previewOpenToPro('menu_v2'))

// ── THE PLAN ──
check('one job per area, in the order a creator works', MENU_V2.map((a) => a.label).join() === 'Find products,Make videos,Post videos,Social,Blog,Brand deals')
check('making a video and posting it are apart', MENU_V2[1].rows.join() === 'Video Scripts,Scriptwriter,Review Editor,Thumbnails,Clip Factory,Amazon Live' && MENU_V2[2].rows.join() === 'Drop,Bulk Amazon upload,YouTube Co-Pilot,YouTube comments')
check('the Deals Hub writes blog posts, so it sits in Blog', MENU_V2.find((a) => a.label === 'Blog')!.rows.includes('Deals Hub') && !MENU_V2.find((a) => a.label === 'Social')!.rows.includes('Deals Hub'))
const named = MENU_V2.flatMap((a) => a.rows)
check('no tool is named twice', new Set(named).size === named.length)

// Every row of the job areas in the menu itself is named by the plan.
const S = read('components/layout/DashboardShellV2.tsx')
const nav = S.slice(S.indexOf('const navFor = (forTier: Tier): NavGroupDef[] => {'), S.indexOf('const AMAZON_LOCKED_PREFIXES'))
const jobs = nav.slice(nav.indexOf("label: 'Find products',"), nav.indexOf("label: 'Your setup',"))
const rows = Array.from(jobs.matchAll(/icon: <[^>]*\/>, label: '([^']+)'/g)).map((m) => m[1])
const missing = rows.filter((r) => !named.includes(r))
check('every tool in the menu has an area in the plan', rows.length >= 30 && missing.length === 0)
if (missing.length) fails.push(`not in the plan: ${missing.join(', ')}`)

// ── THE REGROUPING ──
{
  const item = (label: string, gate?: boolean) => ({ label, href: `/${label}`, gate })
  const groups = [
    { label: '', items: [item('Dashboard')] },
    { label: 'Find products', items: [item('Product research'), item('TRYBE', false)] },
    { label: 'Make videos', items: [item('Drop'), item('Video Scripts'), item('A new tool')] },
    { label: 'Share', items: [item('Social Push'), item('Deals Hub'), item('Something new to share')] },
    { label: 'Work with brands', items: [item('Brand pitches')] },
    { label: 'Your setup', items: [item('Connections')] },
    { label: 'Help', items: [item('Ask MVP')] },
  ]
  const out = regroupMenu(groups)
  check('the areas around the job areas stay where they were', out[0].label === '' && out[out.length - 2].label === 'Your setup' && out[out.length - 1].label === 'Help')
  const area = (l: string) => out.find((g) => g.label === l)
  check('rows move to their new areas, the same objects (gates and tabs untouched)', area('Post videos')?.items[0] === groups[2].items[0] && area('Blog')?.items[0] === groups[3].items[1] && area('Find products')?.items[1].gate === false)
  check('a tool the plan does not name stays in its area, or the one that took its place', area('Make videos')!.items.some((i) => i.label === 'A new tool') && area('Social')!.items.some((i) => i.label === 'Something new to share'))
  check('an area with nothing in it is not drawn', out.every((g) => g.items.length > 0) && !out.some((g) => REDRAWN.includes(g.label) && !MENU_V2.some((a) => a.label === g.label)))
  check('nothing is lost and nothing is doubled', out.flatMap((g) => g.items).length === groups.flatMap((g) => g.items).length)
}

// ── IN THE SHELL ──
check('the shell redraws the menu for every account once open', /const menuV2 = previewOpenToPro\('menu_v2'\) \|\| canUsePreview\('menu_v2', effectiveTier\)/.test(S) && /const NAV_GROUPS: NavGroupDef\[\] = menuV2 \? regroupMenu<NavItemDef, NavGroupDef>\(builtNav\) : builtNav/.test(S))
check('TRYBE sits right under the Dashboard in the redrawn menu', /if \(menuV2\) \{\n\s*const at = out\.findIndex\(\(s2\) => s2\.slug === 'trybe'\)/.test(S) && /out\.splice\(dash \+ 1, 0, t\)/.test(S))
check('every new area has its colour and icon, and is listed on the Dashboard', ['Post videos', 'Social', 'Brand deals'].every((l) => S.includes(`'${l}':`) && S.includes(`'${l}': <`)) && /const JOB_SECTIONS = \[[^\]]*'Post videos', 'Social', 'Brand deals'\]/.test(S))

// ── THE DASHBOARD ──
const D = read('components/dashboard/TealDashboard.tsx')
check('Needs you comes first, right under the welcome', /const menuV2 = previewOpenToPro\('menu_v2'\) \|\| \(viewTier \? canUsePreview\('menu_v2', viewTier\) : false\)/.test(D) && D.includes('{menuV2 ? <>{needsBlock}{pinnedBlock}{monthBlock}</> : <>{pinnedBlock}{monthBlock}{needsBlock}</>}'))

// ── TRYBE: TODAY APART FROM WHAT CHANGED ──
const H = read('components/labs/TrybeHome.tsx')
const O = read('components/labs/TrybeOutreach.tsx')
check('Today is the creator’s own in the new menu, What changed holds the market', /<TrybeHome view=\{layout \? 'today' : 'all'\}/.test(O) && /\{tab === 'changes' && layout && <TrybeHome view="market"/.test(O))
check('the market lists show only where the market is', ['POURING MONEY INTO META', 'PAY ', 'TIERS AND TOP 100'].every((t) => new RegExp(`── ${t}[^\\n]*\\n\\s*\\{market && d && \\(`).test(H)) && /\{market && d\?\.payIndex/.test(H))
check('the creator’s own parts show only on Today', /\{mine && <Section title="What needs you today">/.test(H) && /\{mine && canMoney && \(/.test(H) && /\{mine && forYou\.length > 0 && \(/.test(H) && /\{mine && yours\.length > 0 && \(/.test(H))
check('Today leads with what waits for the creator, and opens What changed', /\? \(todo\.length \? `\$\{todo\.join\(', '\)\}\.` : inboxRead \? 'You are all caught up\.'/.test(H) && /See what changed<\/button>/.test(H))
check('new brands are listed once: What changed has its own', /\{view === 'all' && d && d\.fresh\.length > 0 && \(/.test(H))

if (fails.length) { console.error(`✗ ${fails.length} menu check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
console.log('✓ Menu v2: one job per area, TRYBE under the Dashboard, Needs you first, and TRYBE’s Today apart from What changed')
