// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Guards for pins (migration 376): the features a creator pinned, shown at the
// top of the Dashboard. They were the menu's My features until 2026-11-08.

import { readFileSync } from 'node:fs'
import { toggleFavorite, MAX_NAV_FAVORITES } from '../lib/nav-favorites'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')

{
  const a = toggleFavorite([], '/co-pilot')
  const b = toggleFavorite(a.next, '/encore')
  check('starring adds in pin order, and starring again takes it out',
    b.next.join() === '/co-pilot,/encore' && toggleFavorite(b.next, '/co-pilot').next.join() === '/encore')
  const full = Array.from({ length: MAX_NAV_FAVORITES }, (_, i) => `/p${i}`)
  const r = toggleFavorite(full, '/one-more')
  check('a full list refuses the next one and says so, and can still take one out',
    r.full && r.next.length === MAX_NAV_FAVORITES && !toggleFavorite(full, '/p0').full)
}
{
  const L = read('lib/nav-favorites.ts')
  check('saved to the account, mirrored in the browser, and says when it is only on this device',
    /from\('user_nav_favorites'\)\s*\n?\s*\.upsert\(/.test(L) && /writeLocal\(r\.next\)/.test(L) && /setSavedTo\(error \? 'device' : 'account'\)/.test(L))
  const S = read('components/layout/DashboardShellV2.tsx')
  check('the menu has no My features section any more (Seb, 2026-11-08)', !/label: 'My features'/.test(S) && !/groupsWithFavorites/.test(S))
  check('every feature in the classic menu has a star that pins it to the Dashboard, shown on hover, with a label for screen readers',
    /aria-label=\{starred \? `Unpin \$\{item\.label\} from your Dashboard` : `Pin \$\{item\.label\} to the top of your Dashboard`\}/.test(S)
    && /'opacity-0 group-hover\/nav:opacity-100'/.test(S))
  check('a full list and a device-only save are said on screen', /You can pin \$\{MAX_NAV_FAVORITES\}\. Unpin one to pin \$\{label\}\./.test(S) && /Pins are saved on this browser only for now/.test(S))
  const M = read('supabase/migrations/376_nav_favorites.sql')
  check('migration 376 is twice-runnable and each creator only reaches their own row',
    /create table if not exists public\.user_nav_favorites/.test(M) && /drop policy if exists "user_nav_favorites_own"/.test(M) && /using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\)/.test(M))
}

// STUCK STARS (Seb, 2026-10-24: "why cant i get rid of the two feature stuck
// in my features"). A star saved on a page later merged into another row as
// a tab showed as that row, whose star never checked it.
{
  const stuck = ['/brand-kit', '/youtube-first-comments']
  const out = toggleFavorite(stuck, '/brand-inquiries', MAX_NAV_FAVORITES, ['/brand-kit', '/inquiries'])
  check('a row\'s star takes out a star saved on one of its tabs', out.next.join() === '/youtube-first-comments' && !out.full)
  check('and adds the row\'s own address when none is starred', toggleFavorite(['/co-pilot'], '/brand-inquiries', MAX_NAV_FAVORITES, ['/brand-kit']).next.join() === '/co-pilot,/brand-inquiries')
  check('it clears every address of the row at once', toggleFavorite(['/a', '/x', '/b'], '/x', MAX_NAV_FAVORITES, ['/a', '/b']).next.length === 0)
  const S2 = read('components/layout/DashboardShellV2.tsx')
  check('the star reads the row and its tabs', /const starred = \[item\.href, \.\.\.aliases\]\.some\(\(h\) => favorites\.includes\(h\)\)/.test(S2) && /starFeature\(item\.href, item\.label, aliases\)/.test(S2))
}

if (failures.length) {
  console.error(`\n❌ nav-favorites: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ nav-favorites: pinned features show on the Dashboard, follow the account, and say when they cannot')
