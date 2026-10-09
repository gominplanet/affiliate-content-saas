// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Auto-DM guard (Seb, 2026-10-09: "does it work properly??").
//
// What the send log showed: two Instagram DMs in July, then nothing from
// Instagram for two months, and 850 Facebook rows that were one per Page event
// rather than one per comment. A comment skipped for a missing keyword left no
// trace, "sent" was written before the DM left, a comment on a post made in the
// Instagram app was dropped, and every DM promised a STOP opt-out nobody read.
// These checks hold each of those fixed.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripStopLine, renderMessage, matchesKeyword, anyPostOn, fallbackDmLink, PUBLIC_REPLY } from '../lib/ig-dm'
import { dmLogWords, SENDING_STALE_MS } from '../lib/dm-log-words'
import { withDmCta } from '../lib/dm-caption-cta'
import { pickDmLink } from '../lib/dm-link-options'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

async function main() {
  // No STOP promise.
  check('the STOP line comes out of a saved message', stripStopLine('Here you go {link}\n\nReply STOP to opt out.') === 'Here you go {link}')
  check('in any case, with or without the full stop', stripStopLine('Hi {link} reply stop to opt out') === 'Hi {link}')
  check('a message without it is left alone', stripStopLine('Grab it here {link}') === 'Grab it here {link}')
  const msg = renderMessage('Here you go {link}\n\nReply STOP to opt out.', 'https://mvpl.ink/x', true)
  check('a sent DM never carries the STOP line', !/reply stop/i.test(msg), msg)
  check('it still says the link goes to Amazon', /amazon/i.test(msg), msg)
  check('and still carries the link', msg.includes('https://mvpl.ink/x'))

  // Keyword.
  check('the keyword matches as a word in any case', matchesKeyword('link please!', 'LINK'))
  check('not inside another word', !matchesKeyword('linked in', 'LINK'))
  check('MVP\'s own public reply is recognisable', PUBLIC_REPLY.startsWith('Sent you a DM'))

  // Every post, unless turned off.
  check('every post is on by default', anyPostOn(null) && anyPostOn({}) && anyPostOn({ any_post: null }))
  check('and off when the creator turns it off', !anyPostOn({ any_post: false }))

  // The backup link: the creator's own, else the published shop, else nothing.
  const shopDb = (row: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }) })
  check('the creator\'s backup link wins', await fallbackDmLink(shopDb({ handle: 'seb', published: true }), 'u', { fallback_link: 'https://example.com/x' }) === 'https://example.com/x')
  const shop = await fallbackDmLink(shopDb({ handle: 'gominreviews', published: true }), 'u', {})
  check('else the Link in Bio shop', !!shop && shop.endsWith('/shop/gominreviews'), String(shop))
  check('an unpublished shop is not sent', await fallbackDmLink(shopDb({ handle: 'x', published: false }), 'u', {}) === null)
  check('no shop at all sends nothing rather than a made-up link', await fallbackDmLink(shopDb(null), 'u', { fallback_link: 'not a url' }) === null)

  // The log in plain words: a sent DM, a failure, a wait and a skip never look alike.
  const now = Date.parse('2026-10-09T12:00:00Z')
  const titles = new Set([
    dmLogWords({ status: 'sent', link_sent: 'https://x' }, now).title,
    dmLogWords({ status: 'failed', error: 'nope' }, now).title,
    dmLogWords({ status: 'sending', created_at: new Date(now - 1000).toISOString() }, now).title,
    dmLogWords({ status: 'skipped', error: 'The comment did not contain "LINK".' }, now).title,
  ])
  check('sent, failed, sending and skipped each read differently', titles.size === 4, [...titles].join(' / '))
  check('a send Meta never answered reads as a problem, not as sending',
    dmLogWords({ status: 'sending', created_at: new Date(now - SENDING_STALE_MS - 1000).toISOString() }, now).tone === 'bad')
  check('a skip says why', dmLogWords({ status: 'skipped', error: 'Auto-DM is turned off.' }, now).detail === 'Auto-DM is turned off.')

  // Source rules.
  const ig = read('lib/ig-dm.ts')
  const fb = read('lib/fb-dm.ts')
  for (const [name, src] of [['Instagram', ig], ['Facebook', fb]] as const) {
    check(`${name}: a DM is claimed as sending, not sent, before it goes out`, /status: 'sending'/.test(src) && !/insert\(\{[^}]*status: 'sent'/.test(src))
    check(`${name}: a missing keyword leaves a row saying so`, /did not contain/.test(src))
    check(`${name}: Auto-DM off leaves a row saying so`, /Auto-DM is turned off\./.test(src))
    check(`${name}: settings are read whole, so a new column cannot fail the read`, /from\('ig_dm_settings'\)\.select\('\*'\)/.test(src))
    check(`${name}: posts MVP did not publish get the backup link`, /fallbackDmLink\(/.test(src))
  }
  const webhook = read('app/api/facebook/webhook/route.ts')
  check('the Facebook webhook no longer writes a row per Page event', !/logFbDiag|POST received/.test(webhook))
  const settingsRoute = read('app/api/instagram/dm-settings/route.ts')
  check('the default message has no STOP line', !/Reply STOP/i.test(settingsRoute))
  const page = read('app/(dashboard)/instagram-dm/page.tsx')
  check('the page has no STOP line or "Meta requires it" claim', !/Reply STOP|Meta requires/i.test(page))
  check('the page links to Meta approval', /Check Meta approval/.test(page))
  check('the page lists recent comments and the posts picker', /Recent comments/.test(page) && /dm-posts/.test(page))
  const debug = read('app/api/instagram/dm-debug/route.ts')
  check('the Instagram check can turn comment alerts on and shows Meta\'s reason', /subscribeToCommentsWhy/.test(debug) && /Instagram refused/.test(debug))
  check('both new routes stay Labs, admin only', /normalizeTier\(integ\?\.tier\) !== 'admin'/.test(debug) && /normalizeTier\(integ\?\.tier\) !== 'admin'/.test(read('app/api/instagram/dm-posts/route.ts')))
  const mig = read('supabase/migrations/422_auto_dm_any_post.sql')
  check('migration 422 is safe to run twice', /add column if not exists any_post/.test(mig) && /add column if not exists fallback_link/.test(mig))

  // The caption tells viewers how to get the link (Seb, 2026-10-09).
  const cap = 'Holds any angle. Link in bio.\n\n#mirror\n\n\u{1F4CC} As an Amazon Associate I earn from qualifying purchases.'
  const on = withDmCta(cap, 'LINK')
  check('Auto-DM on swaps "Link in bio" for the comment line', /Comment LINK and I.ll DM you the link\./.test(on) && !/link in bio/i.test(on), on)
  check('a new keyword updates the line', /Comment MIRROR and/.test(withDmCta(on, 'mirror')))
  check('Auto-DM off puts "Link in bio." back', withDmCta(on, null) === cap)
  check('a caption with no bio line gets the line above the hashtags', /Great\.\n\nComment LINK[^\n]*\n\n#x/.test(withDmCta('Great.\n\n#x', 'LINK')))
  const adFirst = withDmCta('#ad #sponsored\n\nGreat dryer.\n\n#hair\n\n\u{1F4CC} As an Amazon Associate I earn.', 'LINK')
  check('a caption opening with #ad gets the line under the body, not under the disclosure', /Great dryer\.\n\nComment LINK[^\n]*\n\n#hair/.test(adFirst), adFirst)
  check('a short product link is followed to find the product', /resolveTrueDestination\(productUrl\)/.test(read('lib/dm-link-options.ts')))
  const modal = read('components/InstagramBurnedModal.tsx')
  check('the Shorts Instagram window offers Auto-DM to Labs accounts', /tier === 'admin'/.test(modal) && /withDmCta\(/.test(modal))

  // The DM link is picked for the creator (Seb, 2026-10-09).
  const opts = [
    { kind: 'blog' as const, url: 'https://blog/x', label: 'Blog post', note: '' },
    { kind: 'amazon' as const, url: 'https://mvpl.ink/a', label: 'Amazon link', note: '' },
  ]
  check('the creator\'s last choice is preselected when it exists', pickDmLink(opts, 'amazon')?.kind === 'amazon')
  check('a last choice this clip lacks falls back to the first that exists', pickDmLink(opts, 'shop')?.kind === 'blog')
  check('no options means no preselected link', pickDmLink([], 'shop') === null)
  const modal2 = read('components/InstagramBurnedModal.tsx')
  check('the window offers the found links and remembers the choice', /dm-link-options/.test(modal2) && /mvp\.ig\.dmLinkKind/.test(modal2))
  check('Shorts Studio passes the video so its blog post can be found', /videoId=\{videoId\}/.test(read('components/content/ShortsStudioModal.tsx')))
  const pub = read('app/api/instagram/publish-burned/route.ts')
  check('a DM to the Link in Bio page puts the product on that page', /dm\.kind === 'shop'[\s\S]*syncLinkInBioTile/.test(pub))
  check('a blog or shop DM link never becomes a product tile', /dmIsProduct/.test(pub))

  if (failed) { console.error(`\n${failed} Auto-DM check(s) failed`); process.exit(1) }
  console.log('\nALL PASS')
}

main().catch((e) => { console.error(e); process.exit(1) })
