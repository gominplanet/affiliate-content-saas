// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Facebook setup and Meta's monthly limit on outside-link posts from a Page.
// Every way MVP posts to a Page asks lib/facebook-link-budget first, counts a
// post that carries an outside link, and stops one past the limit with words
// that say why: never a post whose link Facebook shows as plain text.

import { readFileSync } from 'node:fs'
import { pageReelCaption } from '../lib/reel-group-caption'
import { productLinkFromDescription } from '../lib/description-product-link'
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

// ── The link limit is switched off (Seb: "we shouldn't even apply to it") ───
check('nothing is held back while the guard is off', /export const LINK_GUARD_ON = false/.test(read('lib/facebook-link-budget.ts')) && /const enforced = LINK_GUARD_ON &&/.test(read('lib/facebook-link-budget.ts')))

// ── Social Push: Group first, one click ─────────────────────────────────────
const modal = read('components/content/SocialPreviewModal.tsx')
check('one button per Group: Group + Page', /`Post to \$\{g\.name\?\.trim\(\) \|\| 'Group'\} \+ Page`/.test(modal))
check('the Page post goes out by itself once SCOUT sees the Group post', /void shareGroupPostOnPage\(i, \{ link: st\.url/.test(modal))
check('without the post\'s own link, the Page post links to the Group and says so', /void shareGroupPostOnPage\(i, \{ link: g\.url/.test(modal) && /could not read the post's own link/.test(modal))
check('no direct Page post with the affiliate link in Group-first mode', /\{groupFirstMode \? null : scheduleEnabled/.test(modal) && /platformKey && !groupFirstMode/.test(modal))
check('a Page post that fails after the Group post is said, not shown as done', /Your Group post is up, but the Page post did not go out\./.test(modal))
check('creators with no Group are nudged to set one up', /Set up your deals Group first/.test(modal))
check('Social Push turns it on with the Labs switch', /groupFirst: canUsePreview\('facebook_setup', userTier\)/.test(read('app/(dashboard)/content/page.tsx')))

// ── The Meta page and its switch ────────────────────────────────────────────
check('one switch, admin while tested', /facebook_setup: 'admin'/.test(read('lib/labs-preview.ts')) && /export function facebookSetupEnabled/.test(read('lib/facebook-link-budget.ts')))
check('the setup route only accepts real Group links', /isFacebookGroupLink/.test(read('app/api/facebook/setup/route.ts')))
const page = read('app/(dashboard)/meta/page.tsx')
check('the Meta page says how Facebook works in plain words', /Your Group holds the link\. Your Page points to it\./.test(page))
check('the Meta page says who does what, for posts and for Reels', /You do/.test(page) && /MVP does/.test(page) && /title: 'A Reel'/.test(page))
check('the Meta page asks nothing about link limits', !/Meta One/.test(page))
check('the hub is Facebook only: no Instagram on it', !/Instagram/.test(page))
check('the old addresses land on Meta Hub', /redirect\('\/meta'\)/.test(read('app/(dashboard)/facebook-setup/page.tsx')) && /redirect\('\/meta'\)/.test(read('app/(dashboard)/facebook/page.tsx')))
check('the menu says Meta Hub and opens /meta', /href: '\/meta', icon: <Users size=\{15\} \/>, label: 'Meta Hub'/.test(read('components/layout/DashboardShellV2.tsx')))
check('the nudges send people to Meta Hub, not the old address', !/href="\/facebook"/.test(read('components/clip-factory/ClipFactory.tsx')) && !/href="\/facebook"/.test(read('components/content/SocialPreviewModal.tsx')))
check('SCOUT answers whether it is allowed on Facebook', /msg\.type === 'MVP_FB_ACCESS'/.test(read('extension/background.js')))

// ── Clip Factory: the clip in the Group, the Reel linking to that exact post ─
{
  const cap = pageReelCaption('This cream changed my skin.\nGrab it 👉 https://amzn.to/abc\nLink in bio\n#skincare #glow', ['skincare', 'glow'])
  check('the Page Reel caption drops the Amazon link and "link in bio"', !/amzn\.to|link in bio/i.test(cap) && /This cream changed my skin\./.test(cap) && /#skincare/.test(cap))
}
const reel = read('components/clip-factory/ReelDestinations.tsx')
check('SCOUT attaches the clip itself to the Group post', /\{ kind: 'clip', url: p\.clipUrl \}/.test(reel) && /hero\.kind === 'clip'/.test(read('extension/background.js')))
check('the Reel\'s first line links to the exact Group post', /`Get it here 👉 \$\{link\}`/.test(reel) && /isFacebookReelLink\(st\.url\)\)\) \{ await postReel\(st\.url, 'post'\)/.test(reel))
check('without the post\'s own link, the Reel waits for it or links to the Group only when asked', /Link to my Group instead/.test(reel) && !/postReel\(group\.url, 'group'\); return/.test(reel))
check('the Group post up and the Reel not is said as exactly that', /Your Group post is up, but the Reel did not go out/.test(reel))
check('an old SCOUT stops before filling a post without its clip', /attaching a clip to a Group post needs/.test(read('lib/extension-frame.ts')))
check('Clip Factory runs it with the Labs switch and a Group, and nudges without one', /canUsePreview\('facebook_setup', tier\) && \(fbGroups\?\.length \?\? 0\) > 0/.test(read('components/clip-factory/ClipFactory.tsx')) && /Set up your deals Group first\./.test(read('components/clip-factory/ClipFactory.tsx')))

// ── The product link from the YouTube description ───────────────────────────
{
  const desc = 'My honest review of this suitcase.\n\n🎬 Subscribe: https://youtube.com/@me\n🛒 Grab it on Amazon 👉 https://www.mvpl.ink/sb2v2dy\nFollow me https://instagram.com/me\nRead more https://myblog.com/post'
  check('the Amazon or short product link in a description is found', productLinkFromDescription(desc) === 'https://www.mvpl.ink/sb2v2dy')
  check('socials and YouTube are never taken for the product', productLinkFromDescription('Follow https://instagram.com/me and https://youtube.com/@me') === null)
  check('a link on a selling line is found when there is no Amazon link', productLinkFromDescription('Intro\nShop the cream here: https://brand.com/cream') === 'https://brand.com/cream')
  check('an empty description gives no link', productLinkFromDescription('') === null && productLinkFromDescription(null) === null)
  const rc = read('lib/reel-caption.ts')
  check('Clip Factory reads the stored description before the bare ASIN, after the blog post and Enhance', rc.indexOf("productSource = 'video-description'") > rc.indexOf("productSource = 'blog-post'") && rc.indexOf("productSource = 'video-description'") < rc.indexOf("'enhance-product' : 'video-asin'"))
  check('the panel says the link came from the YouTube description', /'video-description': 'from your YouTube video/.test(read('components/clip-factory/PublishPanel.tsx')))
  check('the Group post waits for a product link, and a typed one counts', /requireProductLink/.test(read('components/clip-factory/PublishPanel.tsx')) && /typedProductLink/.test(read('components/clip-factory/PublishPanel.tsx')))
  check('a Reel description is not promised clickable', !/Links in a Reel description are clickable/.test(read('lib/clip-description.ts')))
}

// ── A video Group post gets time to reach the feed ─────────────────────────
{
  const bg = read('extension/background.js')
  check('a video post that is created but not yet in the feed gets minutes, not 20 seconds', /const patience = r\.seen \? 45000 : 6 \* 60 \* 1000/.test(bg) && /if \(r\.processing && !r\.seen\) seenAt = Date\.now\(\)/.test(bg))
  check('the timestamp is hovered on every look, never clicked', /for \(const type of \['pointerover', 'pointerenter', 'mouseover', 'mouseenter'\]\)/.test(bg))
  check('the post number is read under every name Facebook uses', /top_level_post_id\|legacy_story_hideable_id\|story_fbid/.test(bg))
}

// ── A video in a Group has a Reel address, and that address is used ─────────
{
  const { isFacebookReelLink, isFacebookGroupPostLink } = require('../lib/facebook-group-link') as typeof import('../lib/facebook-group-link')
  check('a Group video\'s Reel address is accepted', isFacebookReelLink('https://www.facebook.com/reel/2121612745112942') && !isFacebookReelLink('https://evil.com/reel/2121612745112942') && !isFacebookReelLink('https://www.facebook.com/reel/abc'))
  check('a Group post address is still accepted', isFacebookGroupPostLink('https://www.facebook.com/groups/247dealsandcoupons/posts/123456789/'))
  const bg = read('extension/background.js')
  check('SCOUT reads the Reel address from the new post and from the tab', /out\.feedUrl = 'https:\/\/www\.facebook\.com\/reel\/' \+ v\[1\]/.test(bg) && /via: 'tab reel'/.test(bg))
  check('Clip Factory posts the Reel linking to either address', /isFacebookGroupPostLink\(st\.url\) \|\| isFacebookReelLink\(st\.url\)/.test(read('components/clip-factory/ReelDestinations.tsx')))
}

// ── The new post is found by its own hook, never by the shared disclosure ──
{
  const bg = read('extension/background.js')
  const start = bg.indexOf('function groupSnippet(')
  const src = bg.slice(start, bg.indexOf('\n}\n', start) + 2)
  // eslint-disable-next-line no-new-func
  const groupSnippet = new Function(src + '; return groupSnippet')() as (t: string) => string
  const post = 'The insert pops right out and goes straight in the dishwasher.\n\n🛒 Grab it on Amazon 👉 https://www.mvpl.ink/np4zh58\n🎬 Watch the full review 👉 https://www.youtube.com/watch?v=BJqeYMIDhlg\n\n#crockpottips #kitchencleanup\n\nThis post contains affiliate links. I may earn a commission at no extra cost to you. As an Amazon Associate I earn from qualifying purchases.'
  const snip = groupSnippet(post)
  check('the fingerprint is the post\'s own opening line', snip.startsWith('The insert pops right out'))
  check('the fingerprint is never the disclosure every post shares', !/affiliate|commission|Associate/i.test(snip))
  check('a post whose time stamp says hours or a date is never taken for the new one', /const OLD_STAMP = /.test(bg) && /&& !isOld\(a\)\)/.test(bg))
}

// ── No captions from YouTube: get the video and carry on, once ─────────────
{
  const panel = read('components/vertical/ShortsCreatePanel.tsx')
  check('without captions, SCOUT fetches the video from Studio and Find Shorts runs again by itself', /data\.needsUpload && autoStudio && youtubeVideoId && getFromStudioRef\.current/.test(panel) && /return await findShorts\(whole, false\)/.test(panel))
  check('it tries once, then shows the way in with SCOUT\'s own reason', /findShorts = useCallback\(async \(whole = false, autoStudio = true\)/.test(panel) && /setStudioError\(errText\(e\)\)/.test(panel))
}

// ── A dropped connection during a render is checked, never shown raw ────────
{
  const panel = read('components/vertical/ShortsCreatePanel.tsx')
  check('a dropped connection looks for the finished Short before saying anything', /if \(e instanceof TypeError\) \{/.test(panel) && /Checking whether the Short finished/.test(panel))
  check('and only then says what happened, in words', /The connection to MVP dropped while this Short was rendering/.test(panel))
}

// ── The Facebook hub ───────────────────────────────────────────────────────
{
  const hubRoute = read('app/api/facebook/hub/route.ts')
  check('the hub gathers reviews, Reel-length clips and videos with no clip', /from\('blog_posts'\)/.test(hubRoute) && /from\('youtube_shorts'\)/.test(hubRoute) && /c\.seconds >= 3 && c\.seconds <= REEL_MAX_SEC/.test(hubRoute) && /!clipped\.has\(v\.id\)/.test(hubRoute))
  check('a re-burned clip still counts as posted', /clipv:\$\{p\.video_id\}:\$\{p\.title\}/.test(hubRoute))
  check('the record keeps only Facebook addresses', /facebook\\\.com\\\//.test(hubRoute))
  check('both flows record what went where, and a Group-only post too', /recordFacebookPush\(/.test(read('components/content/SocialPreviewModal.tsx')) && /record\(link, null\)/.test(read('components/clip-factory/ReelDestinations.tsx')))
  check('a hub row says where it is: not on Facebook, Group only, or both', /Not on Facebook yet/.test(page) && /In your Group, not on your Page yet/.test(page) && /In your Group and on your Page/.test(page))
  check('a review posts from the hub in the same Group-first window', /<SocialPreviewModal[\s\S]{0,900}groupFirst/.test(page))
  check('a video opens its clips in the Clip Factory inside Meta Hub, in one click', /onClick=\{\(\) => makeReels\(v\.id\)\}/.test(page) && /replaceState\(null, '', `\/meta\?video=\$\{videoId\}`\)/.test(page) && /get\('video'\)/.test(read('components/clip-factory/ClipFactory.tsx')))
  check('without migration 402 the hub says so, never a silent "not posted"', /migration 402/.test(page))
}

// ── Meta Hub: one umbrella, five steps, niche Groups, Clip Factory inside ──
{
  check('Meta Hub has the five steps in order', /n=\{1\} title="Your Page"[\s\S]*n=\{2\} title="Your niche Groups"[\s\S]*n=\{3\} title="SCOUT on Facebook"[\s\S]*n=\{4\} title="Make Reels"[\s\S]*n=\{5\} title="Share your reviews"/.test(page))
  check('each step ticks when done and opens again on a tap', /done \? <Check size=\{15\} \/> : n/.test(page) && /aria-expanded=\{open\}/.test(page) && /onToggle=\{\(\) => toggle\('reels'\)\}/.test(page))
  check('Make Reels ticks only on a Reel that is in a Group and on the Page', /reelsDone = !!hub\?\.clips\.some\(\(c\) => c\.status === 'both'\)/.test(page))
  check('Clip Factory runs inside Meta Hub, Facebook only, remounted on the picked video', /<ClipFactory facebookOnly key=\{`\$\{reelVideo \?\? 'pick'\}:\$\{groupsSig\}`\} \/>/.test(page))
  check('a niche Group keeps its niche and words, and can be edited', /post\(\{ updateGroup: editing \}/.test(page) && /updateGroup/.test(read('app/api/facebook/setup/route.ts')) && /cleanNicheGroup/.test(read('app/api/clip-factory/facebook-reel/route.ts')))
  check('the clip goes to the Group whose words match it', /pickNicheGroup\(p\.groups/.test(read('components/clip-factory/ReelDestinations.tsx')))
  check('a new creator gets the how-to for a niche Group: Public, Associates list', /How to make a niche Group/.test(page) && /<strong>Public<\/strong>/.test(page) && /Amazon Associates/.test(page))
  check('Meta Hub is Facebook only: no TikTok or Instagram words', !/TikTok|Instagram/.test(page))
}

if (failures.length) {
  console.error('❌ facebook setup guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ facebook setup guard passed')
