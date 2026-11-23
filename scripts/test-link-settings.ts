// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Link settings for every text platform, on Your setup → Socials.
//
// A Pro creator, 2026-11-23: "It would be helpful to choose which links appear
// on each social platform, such as to the blog link, to the Amazon Geniuslink,
// or both." Facebook, LinkedIn and Bluesky had the choice behind a Library
// toolbar button; X, Threads and Telegram were fixed to the blog. Seb: "yes
// add and put in settings".

import { readFileSync } from 'node:fs'
import { LINK_MODE_PLATFORMS, parseLinkPrefs, linkPrefFor, shortPostLinks, xLinkTail, threadsLinkLines } from '../lib/social-link-mode'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const BLOG = 'https://geni.us/blogGovee'
const VIDEO = 'https://www.youtube.com/watch?v=abc'
const AMZ = 'https://geni.us/amazonGovee'

// 1. Six platforms, saved and read back
check('X, Threads and Telegram join Facebook, LinkedIn and Bluesky', ['facebook', 'linkedin', 'bluesky', 'twitter', 'threads', 'telegram'].every((p) => (LINK_MODE_PLATFORMS as readonly string[]).includes(p)))
{
  const prefs = parseLinkPrefs({ twitter: { product: true, content: 'none' }, threads: { product: false, content: 'video' }, telegram: 'both' })
  check('their choices are kept, old saved words included', prefs.twitter?.product === true && prefs.twitter?.content === 'none' && prefs.threads?.content === 'video' && prefs.telegram?.product === true && prefs.telegram?.content === 'blog')
  check('nothing chosen is the blog link only, as before', linkPrefFor({}, 'twitter').product === false && linkPrefFor({}, 'telegram').content === 'blog')
}

// 2. The links a short post carries
const o = { blogUrl: BLOG, videoUrl: VIDEO, affiliateLink: AMZ, amazonDestination: true }
check('default: the blog link alone', JSON.stringify(shortPostLinks({ product: false, content: 'blog' }, o).map((l) => l.kind)) === '["blog"]')
check('both: the affiliate link first, naming Amazon, then the blog', (() => { const l = shortPostLinks({ product: true, content: 'blog' }, o); return l.length === 2 && l[0].kind === 'product' && l[0].label === 'Get it on Amazon' && l[1].url === BLOG })())
check('affiliate only', JSON.stringify(shortPostLinks({ product: true, content: 'none' }, o).map((l) => l.kind)) === '["product"]')
check('review video, and the blog when the post has no video', shortPostLinks({ product: false, content: 'video' }, o)[0].url === VIDEO && shortPostLinks({ product: false, content: 'video' }, { ...o, videoUrl: null })[0].url === BLOG)
check('affiliate on but no affiliate link for this post: the content link only, never an empty one', JSON.stringify(shortPostLinks({ product: true, content: 'blog' }, { ...o, affiliateLink: null }).map((l) => l.kind)) === '["blog"]')
check('a store the link names is named; an unknown one is never "Buy now"', shortPostLinks({ product: true, content: 'none' }, { ...o, affiliateLink: 'https://www.walmart.com/ip/123', amazonDestination: false })[0].label === 'Get it on Walmart' && !/buy now|click here|shop now/i.test(shortPostLinks({ product: true, content: 'none' }, { ...o, affiliateLink: 'https://x.co/abc', amazonDestination: false })[0].label))
check('X: the store named before its link, then the blog', xLinkTail(shortPostLinks({ product: true, content: 'blog' }, o)) === `Get it on Amazon: ${AMZ} ${BLOG}`)
check('Threads: one link a line, the store named', threadsLinkLines(shortPostLinks({ product: true, content: 'blog' }, o)) === `🛒 Get it on Amazon 👉 ${AMZ}\n🔗 ${BLOG}`)

// 3. Every way a post goes out follows it
const CRON = read('app/api/cron/process-scheduled/route.ts')
check('scheduled X, Threads and Telegram read the choice', ["linkPrefFor(linkPrefs, 'twitter')", "linkPrefFor(linkPrefs, 'threads')", "linkPrefFor(linkPrefs, 'telegram')"].every((s) => CRON.includes(s)))
for (const [f, p] of [['app/api/blog/twitter-post/route.ts', 'twitter'], ['app/api/blog/threads-post/route.ts', 'threads'], ['app/api/blog/telegram-post/route.ts', 'telegram']] as const) {
  const src = read(f)
  check(`Post now on ${p} reads the choice, finds the affiliate link the shared way, and takes the blog link out of the text first`, src.includes(`'${p}')`) && /linkPrefFor\(parseLinkPrefs\(/.test(src) && /socialAffiliateLink\(supabase/.test(src) && /stripBlogLinks\(/.test(src) && /shortPostLinks\(/.test(src))
}
check('Telegram reads the saved choice', /social_link_modes'\)/.test(read('app/api/blog/telegram-post/route.ts')))

// 4. In Your setup → Socials, and the same panel in the Library window
const PANEL = read('components/social/SocialLinkSettings.tsx')
check('one panel lists every platform with a name', /LINK_MODE_PLATFORMS\.map/.test(PANEL) && ['facebook', 'linkedin', 'bluesky', 'twitter', 'threads', 'telegram'].every((p) => new RegExp(`${p}: '`).test(PANEL)))
check('it is on the Socials page', /<SocialLinkSettings variant="card" \/>/.test(read('app/(dashboard)/connect-socials/page.tsx')))
check('and the Library window is the same panel', /<SocialLinkSettings variant="modal" onDone=\{onClose\} \/>/.test(read('components/content/SocialLinkModeModal.tsx')))
check('a load that failed is said, never shown as everything off', /setLoadError/.test(PANEL) && /did not load/.test(PANEL))
check('no dashes in the panel', !/[–—]/.test(PANEL.replace(/\/\/.*$/gm, '')))

if (failures.length) {
  console.error(`test-link-settings: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-link-settings: all checks passed')
