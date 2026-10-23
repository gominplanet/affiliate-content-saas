// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// INSTAGRAM AUTO-DM IS OPEN (Seb, 2026-10-23, the day Meta approved
// instagram_business_manage_messages and instagram_business_manage_comments:
// "let's open to users"). Every plan that posts to Instagram, the page, the
// menu, the Reel option and the routes alike; Facebook's side stays with the
// team until Meta approves its own permissions; a member is never shown
// MVP's Vercel settings.
import { readFileSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

;(async () => {
  delete process.env.NEXT_PUBLIC_IG_DM_ENABLED
  const { canUseIgDm } = await import('../lib/ig-dm-access')
  const { tierAllowsSocial } = await import('../lib/tier')
  check('the team always can', canUseIgDm('admin'))
  check('a plan that posts to Instagram can, one that does not cannot', canUseIgDm('pro') === tierAllowsSocial('pro', 'instagram') && !canUseIgDm(null))
  check('it is on unless Vercel turns it off', /process\.env\.NEXT_PUBLIC_IG_DM_ENABLED !== 'false'/.test(read('lib/feature-flags.ts')))
  check('connecting Instagram asks for both approved permissions unless Vercel turns it off', /process\.env\.IG_DM_SCOPES !== 'false'\s*\n?\s*\? \['instagram_business_manage_comments', 'instagram_business_manage_messages'\]/.test(read('services/instagram.ts')))
  const PAGE = read('app/(dashboard)/instagram-dm/page.tsx')
  check('the page opens to every plan that can use it, with no Labs badge', /const allowed = tier !== null && canUseIgDm\(tier\)/.test(PAGE) && !/FlaskConical/.test(PAGE) && !/Until Meta approves the app/.test(PAGE))
  check('a member is told to reconnect once, with a link that says where it goes', /Reconnect Instagram in Setup, Socials/.test(PAGE) && /href="\/connect-socials"/.test(PAGE))
  check('Facebook stays with the team, and says what it waits on', /\{team && \(<>/.test(PAGE) && /<FacebookDmStatus \/>/.test(PAGE) && /Facebook Auto-DM waits on Meta approving pages_messaging/.test(PAGE))
  const NAV = read('components/layout/DashboardShellV2.tsx')
  check('the menu shows it to members, out of Labs', /href: '\/instagram-dm', icon: <MessageCircle size=\{15\} \/>, label: 'Instagram Auto-DM', gate: canUseIgDm\(effectiveTier\)/.test(NAV) && !/label: 'Instagram Auto-DM', gate: isAdmin/.test(NAV))
  check('the Reel option and the routes use the same rule', /const dmAvailable = canUseIgDm\(tier\)/.test(read('components/InstagramBurnedModal.tsx')) && /if \(!canUseIgDm\(integ\?\.tier\)\)/.test(read('app/api/instagram/dm-posts/route.ts')) && /if \(!canUseIgDm\(integ\?\.tier\)\)/.test(read('app/api/instagram/dm-debug/route.ts')))
  const DBG = read('app/api/instagram/dm-debug/route.ts'), STATUS = read('components/instagram/InstagramDmStatus.tsx')
  check('a member never sees Vercel settings, in the rows or the verdict', /\.\.\.\(data\?\.team \? \[/.test(STATUS) && /if \(!team && \(!appSecretSet \|\| !scopesRequested\)\) verdict = /.test(DBG) && !/Until Meta approves the app/.test(DBG))
  if (fails.length) { console.error('ig-dm-access failed:\n - ' + fails.join('\n - ')); process.exit(1) }
  console.log('✅ ig-dm-access: Instagram Auto-DM is open to every plan that posts to Instagram, the permissions are asked for on connect, Facebook stays with the team, and members never see Vercel settings')
})()
