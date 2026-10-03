// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Facebook setup and Meta's monthly limit on outside-link posts from a Page.
// Every way MVP posts to a Page asks lib/facebook-link-budget first, counts a
// post that carries an outside link, and stops one past the limit with words
// that say why: never a post whose link Facebook shows as plain text.

import { readFileSync } from 'node:fs'
import { outsideLinks, allowanceFor, planEnforces, linkLimitRefusal, cleanPlan, linkWindow } from '../lib/facebook-link-budget'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// ── What counts as an outside link ──────────────────────────────────────────
check('an Amazon link counts', outsideLinks('Grab it 👉 https://amzn.to/3abc').length === 1)
check('a geni.us link without https counts', outsideLinks('Grab it geni.us/Abc1').length === 1)
check('a link field counts', outsideLinks('no link here', 'https://myblog.com/post').length === 1)
check('a link to the creator\'s own Group does not count', outsideLinks('Full post in the Group 👇 https://www.facebook.com/groups/mydeals/posts/123').length === 0)
check('Instagram, WhatsApp and Threads do not count', outsideLinks('https://instagram.com/me https://wa.me/123 https://threads.net/@me').length === 0)
check('plain text has no link', outsideLinks('Just a review, no link').length === 0)
check('a trailing full stop is not part of the link', outsideLinks('See https://amzn.to/x1.')[0] === 'https://amzn.to/x1')

// ── Plans, by Meta's own help page ──────────────────────────────────────────
check('no Meta One is 2 a month and stops posts past it', allowanceFor('free') === 2 && planEnforces('free'))
check('Advanced is 8 and Expert is 20', allowanceFor('advanced') === 8 && allowanceFor('expert') === 20)
check('Max and "not limited" have no allowance and never stop', allowanceFor('max') === null && !planEnforces('max') && !planEnforces('not_limited'))
check('never answered counts but does not stop posts nobody agreed to', !planEnforces(null) && allowanceFor(null) === 2)
check('the first answers are still read', cleanPlan('unsure') === 'free' && cleanPlan('unlimited') === 'not_limited' && cleanPlan('limited', 8) === 'advanced' && cleanPlan('yes') === null)
{
  const now = new Date('2026-10-17T12:00:00Z')
  const free = linkWindow('free', null, now)
  check('free resets on the 1st', free.since.toISOString().startsWith('2026-10-01') && free.resets.toISOString().startsWith('2026-11-01'))
  const paid = linkWindow('advanced', 20, now)
  check('a paid plan resets on its renewal day', paid.since.toISOString().startsWith('2026-09-20') && paid.resets.toISOString().startsWith('2026-10-20'))
  const late = linkWindow('expert', 31, new Date('2026-03-05T00:00:00Z'))
  check('a 31st renewal lands on a short month\'s last day', late.since.toISOString().startsWith('2026-02-28') && late.resets.toISOString().startsWith('2026-03-31'))
  check('free ignores a stray renewal day', linkWindow('free', 15, now).since.toISOString().startsWith('2026-10-01'))
}
{
  const said = linkLimitRefusal({ allowance: 2, used: 2, resetsAt: '2026-11-01T00:00:00.000Z' })
  check('the refusal says when it resets and what to do', /until Nov 1/.test(said) && /Group/.test(said))
  check('the refusal does not claim what Facebook does past the limit', !/plain text/.test(said))
}

// ── Every Page post path asks first and counts after ────────────────────────
const paths: Array<[string, string]> = [
  ['blog shares', 'app/api/blog/facebook-post/route.ts'],
  ['deal posts', 'lib/deal-social-publish.ts'],
  ['Amazon designs', 'lib/amazon-social-publish.ts'],
  ['scheduled posts and auto-pilot', 'app/api/cron/process-scheduled/route.ts'],
]
for (const [name, file] of paths) {
  const src = read(file)
  const ask = src.indexOf('checkPageLinkPost(')
  const post = Math.min(...['postPhoto(', 'postLink('].map((k) => { const i = src.indexOf(k, ask); return i < 0 ? Infinity : i }))
  check(`${name}: asks before posting`, ask > 0 && post > ask)
  check(`${name}: records a link post after`, /recordPageLinkPost\(/.test(src))
}
const fbService = read('services/facebook/index.ts')
check('no new way to post to a Page slipped past the guard', (fbService.match(/\/feed`|\/photos`/g) ?? []).length === 2)
check('a held scheduled post never marks Facebook as failing', /em\.startsWith\(LINK_LIMIT_PREFIX\)/.test(read('lib/channel-health.ts')) && /\$\{LINK_LIMIT_PREFIX\} \$\{fbLinkCheck\.error\}/.test(read('app/api/cron/process-scheduled/route.ts')))
check('a stopped blog share is a 409 with its code, not "Facebook failed"', /code: limited\?\.code/.test(read('app/api/blog/facebook-post/route.ts')))

// ── The page and its switch ─────────────────────────────────────────────────
check('Facebook setup is one switch, admin while tested', /facebook_setup: 'admin'/.test(read('lib/labs-preview.ts')) && /export function facebookSetupEnabled/.test(read('lib/facebook-link-budget.ts')))
check('the setup route only accepts real Group links', /isFacebookGroupLink/.test(read('app/api/facebook/setup/route.ts')))
const page = read('app/(dashboard)/facebook-setup/page.tsx')
check('the page says the rule in plain words', /Your Page gets the content\. Your Group gets the links\./.test(page))
check('the count says what it cannot see', /posts you put up yourself are not seen/.test(page))
check('a count that cannot be read says so, never a silent zero', /cannot count your Page&apos;s link posts yet/.test(page))
check('SCOUT answers whether it is allowed on Facebook', /msg\.type === 'MVP_FB_ACCESS'/.test(read('extension/background.js')))

if (failures.length) {
  console.error('❌ facebook setup guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ facebook setup guard passed')
