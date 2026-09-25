// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Guards for My features, the starred sidebar section (migration 376).

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
  check('My features sits right under the Dashboard row, from the menu the creator can see',
    /label: 'My features', items/.test(S) && /orderedGroups\.slice\(0, dashIdx \+ 1\), mine/.test(S) && /it\.gate !== false && !it\.external/.test(S))
  check('every feature has a star, shown on hover or while editing, with a label for screen readers',
    /aria-label=\{starred \? `Take \$\{item\.label\} out of My features` : `Add \$\{item\.label\} to My features`\}/.test(S)
    && /editingFavorites \? 'opacity-100' : 'opacity-0 group-hover\/nav:opacity-100'/.test(S))
  check('a full list and a device-only save are said on screen', /My features holds \$\{MAX_NAV_FAVORITES\}/.test(S) && /Saved on this browser only for now/.test(S))
  const M = read('supabase/migrations/376_nav_favorites.sql')
  check('migration 376 is twice-runnable and each creator only reaches their own row',
    /create table if not exists public\.user_nav_favorites/.test(M) && /drop policy if exists "user_nav_favorites_own"/.test(M) && /using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\)/.test(M))
}

if (failures.length) {
  console.error(`\n❌ nav-favorites: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ nav-favorites: starred features pin to the top, follow the account, and say when they cannot')
