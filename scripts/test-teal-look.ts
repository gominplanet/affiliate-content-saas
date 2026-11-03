// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE TEAL POP LOOK (Seb, 2026-11-03: "I like A"), behind Labs.
//
// What this proves:
//   - every violet in the compiled CSS becomes a --brand variable, so the look
//     changes MVP's colour everywhere a class names it, and nothing changes in
//     the old look (the variables default to the same violet);
//   - only accounts allowed to try it see it, it is on for them by default,
//     and the switch back is honoured from the first paint (a cookie the
//     server reads);
//   - the new Dashboard's "Everything MVP does" has a line for every menu row,
//     and lists rows from the menu itself, never from a list of its own;
//   - the search box understands the plain requests its new wording invites.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import postcss from 'postcss'
import { lookFor, canTryLook, lookCookie, LOOK_COOKIE } from '../lib/look'
import { previewOpenToPro } from '../lib/labs-preview'
import { FEATURE_LINES } from '../lib/feature-lines'
import { searchApp, requestWords } from '../lib/app-search-index'
import { pickBuckets } from '../lib/usage-highlights'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(__dirname, '..')
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8')
const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }

async function main() {
  // ── The rewrite itself ──
  const brand = require(path.join(ROOT, 'postcss/brand-vars.cjs')) as { rewriteBrand: (v: string) => string; SHADES: [number, number, number, string][] }
  const rw = brand.rewriteBrand
  check('a hex brand colour becomes the variable, in any case', rw('#7C3AED') === 'rgb(var(--brand-rgb))' && rw('#7c3aed') === 'rgb(var(--brand-rgb))')
  check('Tailwind opacity form keeps its opacity', rw('rgb(124 58 237 / 0.1)') === 'rgb(var(--brand-rgb) / 0.1)', rw('rgb(124 58 237 / 0.1)'))
  check('Tailwind variable opacity keeps its brackets balanced', rw('rgb(124 58 237 / var(--tw-bg-opacity, 1))') === 'rgb(var(--brand-rgb) / var(--tw-bg-opacity, 1))', rw('rgb(124 58 237 / var(--tw-bg-opacity, 1))'))
  check('comma rgba keeps its opacity', rw('rgba(124, 58, 237, 0.35)') === 'rgb(var(--brand-rgb) / 0.35)' && rw('rgba(124,58,237,0.1)') === 'rgb(var(--brand-rgb) / 0.1)')
  check('the hover shade and the gradient end have their own variables', rw('#6D28D9') === 'rgb(var(--brand-strong-rgb))' && rw('#C026D3') === 'rgb(var(--brand-2-rgb))')
  check('inside a gradient too', rw('linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)') === 'linear-gradient(135deg, rgb(var(--brand-rgb)) 0%, rgb(var(--brand-2-rgb)) 100%)')
  check('an eight digit hex and other colours are left alone', rw('#7C3AED20') === '#7C3AED20' && rw('#FF3B30') === '#FF3B30' && rw('rgb(124 58 238)') === 'rgb(124 58 238)')

  // ── Wired into the build, after Tailwind ──
  const PC = read('postcss.config.mjs')
  check('the PostCSS config runs it after Tailwind and before autoprefixer', /tailwindcss: \{\},[\s\S]*'\.\/postcss\/brand-vars\.cjs': \{\},[\s\S]*autoprefixer/.test(PC))
  check('and Next can find it by that name', (() => { try { require.resolve('./postcss/brand-vars.cjs', { paths: [ROOT] }); return true } catch { return false } })())

  // ── The variables: violet by default, teal in the look ──
  const CSS = read('app/globals.css')
  const rootBlock = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('}', CSS.indexOf(':root {')))
  const hex2 = (n: number) => n.toString(16).padStart(2, '0')
  for (const [r, g, b, name] of brand.SHADES) {
    check(`${name} defaults to its violet (${r} ${g} ${b}), so the old look is unchanged`, new RegExp(`${name}:\\s*${r} ${g} ${b};`).test(rootBlock))
    void hex2
  }
  const tealStart = CSS.indexOf('[data-look="teal"] {')
  const tealBlock = CSS.slice(tealStart, CSS.indexOf('}', tealStart))
  check('the look sets every brand variable', tealStart > 0 && brand.SHADES.every(([, , , name]) => new RegExp(`${name}:\\s*\\d+ \\d+ \\d+;`).test(tealBlock)))
  check('teal is the brand in the look', /--brand-rgb:\s*11 122 110;/.test(tealBlock))
  check('the accent variables are declared again in the look, so they are worked out in teal', /--accent:\s*rgb\(var\(--brand-rgb\)\)/.test(tealBlock) && /--accent-gradient:/.test(tealBlock))
  check('a dark version of the look', /\.dark\[data-look="teal"\],\s*\.dark \[data-look="teal"\] \{[\s\S]*?--brand-rgb:\s*15 133 121;/.test(CSS))
  check('Sora headings and Plus Jakarta Sans text in the look', /\[data-look="teal"\] :is\(h1, h2\) \{\s*font-family: var\(--font-sora\)/.test(CSS) && /font-family: var\(--font-jakarta\)/.test(tealBlock))
  check('Sora is loaded, and not preloaded on pages that never use it', /const sora = Sora\(\{[\s\S]*?variable: '--font-sora',\s*preload: false/.test(read('app/layout.tsx')) && /\$\{sora\.variable\}/.test(read('app/layout.tsx')))

  // ── Compile the real stylesheet the way the build does ──
  const tailwind = require('tailwindcss')
  const autoprefixer = require('autoprefixer')
  const out = await postcss([tailwind(path.join(ROOT, 'tailwind.config.ts')), require(path.join(ROOT, 'postcss/brand-vars.cjs'))(), autoprefixer()])
    .process(CSS, { from: path.join(ROOT, 'app/globals.css') })
  const left: string[] = []
  let unbalanced = 0
  postcss.parse(out.css).walkDecls((d) => {
    if (d.prop.startsWith('--brand')) return
    if (/#7c3aed(?![0-9a-f])|124[ ,]+58[ ,]+237/i.test(d.value)) left.push(`${d.parent && 'selector' in d.parent ? (d.parent as { selector: string }).selector : '?'} { ${d.prop}: ${d.value} }`)
    if (d.value.includes('var(--brand') && (d.value.match(/\(/g) || []).length !== (d.value.match(/\)/g) || []).length) unbalanced++
  })
  check('no violet is left anywhere in the compiled CSS', left.length === 0, left.slice(0, 5))
  check('every rewritten value has balanced brackets', unbalanced === 0, unbalanced)
  check('text-[#7C3AED] follows the brand', /\.text-\\\[\\#7C3AED\\\]\s*\{[^}]*rgb\(var\(--brand-rgb\)/.test(out.css))
  check('bg-[#7C3AED]/10 keeps its tenth', /\.bg-\\\[\\#7C3AED\\\]\\\/10\s*\{[^}]*rgb\(var\(--brand-rgb\) \/ 0\.1\)/.test(out.css))
  check('violet-600 from the palette follows it too', /\.bg-violet-600\s*\{[^}]*rgb\(var\(--brand-rgb\)/.test(out.css))

  // ── Who sees it ──
  check('admin sees the new look straight away', lookFor('admin', undefined) === 'teal' && canTryLook('admin'))
  check('and the switch back holds', lookFor('admin', 'classic') === 'classic' && lookFor('admin', 'teal') === 'teal')
  check('a member sees it only once it opens to Pro', lookFor('pro', undefined) === (previewOpenToPro('new_look') ? 'teal' : 'classic') && lookFor('trial', undefined) === 'classic' && lookFor('amazon', undefined) === 'classic')
  check('a cookie alone never gives the look to someone not allowed it', lookFor('trial', 'teal') === 'classic')
  check('the switch writes the cookie the server reads, for every page, a year long', lookCookie('classic') === `${LOOK_COOKIE}=classic; path=/; max-age=31536000; samesite=lax`)
  const LAYOUT = read('app/(dashboard)/layout.tsx')
  check('the layout decides the look from the cookie and hands it to the shell', /const look = lookFor\(tier, \(await cookies\(\)\)\.get\(LOOK_COOKIE\)\?\.value\)/.test(LAYOUT) && /look=\{look\}/.test(LAYOUT) && /canTryLook=\{canTryLook\(tier\)\}/.test(LAYOUT))
  const SHELL = read('components/layout/DashboardShellV2.tsx')
  check('the shell marks its own root, so the first paint is already teal', /data-look=\{teal \? 'teal' : undefined\}/.test(SHELL))
  check('and <html>, for popups drawn on <body>, taken off on the way out', /root\.setAttribute\('data-look', 'teal'\)/.test(SHELL) && /return \(\) => root\.removeAttribute\('data-look'\)/.test(SHELL))
  check('the switch is shown only to accounts that may try the look', /\{canTryLook && !railCollapsed && \(/.test(SHELL) && /document\.cookie = lookCookie\(teal \? 'classic' : 'teal'\)/.test(SHELL))
  check('the Dashboard page asks the same question as the layout', /lookFor\(tier, \(await cookies\(\)\)\.get\(LOOK_COOKIE\)\?\.value\) === 'teal'/.test(read('app/(dashboard)/dashboard/page.tsx')))

  // ── Everything MVP does ──
  const navStart = SHELL.indexOf('const NAV_GROUPS')
  const nav = SHELL.slice(navStart, SHELL.indexOf('AMAZON_LOCKED_PREFIXES', navStart))
  // Menu rows (not their tabs): a row has an icon, a tab has icon: null.
  const rows = new Set<string>()
  for (const m of nav.matchAll(/href: ([^,]+?), icon: </g)) for (const h of m[1].matchAll(/'([^']+)'/g)) if (!h[1].startsWith('/admin/')) rows.add(h[1])
  const missing = Array.from(rows).filter((h) => !FEATURE_LINES[h])
  check('the menu was read', rows.size > 30, rows.size)
  check('every menu row has a line saying what it does', missing.length === 0, missing)
  const bad = Object.entries(FEATURE_LINES).filter(([, l]) => /[–—]| - /.test(l) || /\b20\d\d\b/.test(l) || l.length > 90 || !/\.$/.test(l))
  check('lines are plain sentences: no dashes, no year, short', bad.length === 0, bad)
  check('a line about Passport names the store it sends people to', /Amazon store/.test(FEATURE_LINES['/passport']))
  check('the Dashboard lists the menu itself (no list of its own)', /ShellNavContext\.Provider value=\{jobGroups\}/.test(SHELL) && /const groups = useShellNav\(\)/.test(read('components/dashboard/TealDashboard.tsx')) && /\.filter\(\(it\) => it\.gate !== false && !it\.external\)/.test(SHELL))

  // ── Says what happened ──
  const TD = read('components/dashboard/TealDashboard.tsx')
  check('"Nothing needs you" only once every source was read', /: unread\.length \? 'Nothing found so far today\.'\s*: 'Nothing needs you today\.'/.test(TD) && /todayError \? 'Today’s list did not load\.'/.test(TD))
  check('a failed usage read says so instead of showing nothing', /Your usage could not be read just now\./.test(TD))
  const b = pickBuckets([
    { key: 'pins', label: 'Pins', used: 1, limit: 10 }, { key: 'collabs', label: 'Collabs', used: 0, limit: 5 },
    { key: 'reviewEdits', label: 'Edited videos', used: 12, limit: 100 }, { key: 'shorts', label: 'Shorts', used: 3, limit: 150 },
    { key: 'thumbnails', label: 'Thumbnails', used: 9, limit: 200 },
  ])
  check('This month shows four allowances, edited videos first', b.length === 4 && b.map((x) => x.key).join() === 'reviewEdits,shorts,thumbnails,pins', b.map((x) => x.key))

  // ── The search box's new question ──
  check('filler words drop and plurals fold', requestWords('Edit a review') .join() === 'edit,review' && requestWords('find deals').join() === 'find,deal')
  const first = (q: string) => searchApp(q)[0]?.href
  check('"edit a review" opens the Review Editor', first('edit a review') === '/review-editor', searchApp('edit a review').map((e) => e.label))
  check('"write a post" opens Blog posts', first('write a post') === '/content', searchApp('write a post').map((e) => e.label))
  check('"find deals" opens Deal Radar', first('find deals') === '/deal-radar', searchApp('find deals').map((e) => e.label))
  check('the pages the menu shows are all in search now', ['/drop', '/review-editor', '/trybe', '/instagram-dm', '/group-queue'].every((h) => searchApp(h === '/trybe' ? 'trybe' : h.slice(1).replace('-', ' ')).some((e) => e.href === h)))

  if (fails.length) {
    console.error(`test-teal-look: ${fails.length} failed`)
    for (const f of fails) console.error(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log('test-teal-look: all checks passed')
}

main().catch((e) => { console.error(e); process.exit(1) })
