/**
 * EVERY PUBLIC SOCIAL POST SAYS IT IS AN AD, AND EVERY LINK SAYS WHERE IT GOES
 * (Seb, 2026-10-06): "any time we post on social we need to add #ad #sponsored
 * just to be safe, and when showing links we need to mention where the click
 * will go, such as: Check it out here on Amazon".
 *
 * One helper, lib/social-disclaimer discloseSocialPost, applied in the service
 * that talks to each platform's API, so an immediate, bulk, scheduled or quick
 * post cannot reach a platform without it. This pins the helper's behaviour and
 * that every publisher still routes through it.
 *
 * Run: npx tsx scripts/test-social-disclosure.ts
 */
import { readFileSync } from 'node:fs'
import {
  discloseSocialPost, ensureAdTags, ensureDisclaimer, labelLinks, linkDestination,
  rememberLinkDestination, rememberBlogUrl, DISCLOSURE_LIMITS, AD_TAG_FOLD, DEST_LABEL,
  AFFILIATE_DISCLAIMER_DEFAULT, type DisclosurePlatform,
} from '../lib/social-disclaimer'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length
const AD = /(?<![\w#\\])\\?#ad\b/gi
const SP = /(?<![\w#\\])\\?#sponsored\b/gi

// ── Tags ─────────────────────────────────────────────────────────────────────
{
  const out = ensureAdTags('Love this blender.')
  check('both tags are added', count(out, AD) === 1 && count(out, SP) === 1)
  check('they lead the post', out.startsWith('#ad #sponsored'))
  check('running it twice changes nothing', ensureAdTags(out) === out)
  const onlyAd = ensureAdTags('#ad Love this blender.')
  check('#ad alone does not satisfy #sponsored', count(onlyAd, SP) === 1 && count(onlyAd, AD) === 1)
  const onlySp = ensureAdTags('#sponsored Love this blender.')
  check('#sponsored alone does not satisfy #ad', count(onlySp, AD) === 1 && count(onlySp, SP) === 1)
  const adv = ensureAdTags('Weekend #adventure gear #ads')
  check('#adventure and #ads are not #ad', count(adv, AD) === 1 && adv.includes('#adventure') && adv.includes('#ads'))
  const twice = ensureAdTags('#ad #sponsored hello #ad #sponsored')
  check('a doubled tag is reduced to one', count(twice, AD) === 1 && count(twice, SP) === 1)
  const late = ensureAdTags(`${'word '.repeat(40)}#ad`)
  check('a tag past the fold moves to the start', (late.search(AD) ?? 99) < AD_TAG_FOLD && count(late, AD) === 1)
  const md = ensureAdTags('Hello channel', { markdownV2: true })
  check('Telegram MarkdownV2 tags are escaped', md.startsWith('\\#ad \\#sponsored'))
  check('escaped Telegram tags are recognised, not doubled', ensureAdTags(md, { markdownV2: true }) === md)
  const disc = ensureDisclaimer('This post has an affiliate link.')
  check('an "affiliate" body still gets both tags', count(disc, AD) === 1 && count(disc, SP) === 1)
  check('the Associates sentence is still added when missing', ensureDisclaimer('Great pan.').includes('As an Amazon Associate'))
  check('the default disclosure has no dashes', !/[—–]| - /.test(AFFILIATE_DISCLAIMER_DEFAULT))
  // Placement: first line on the short-form platforms, inside the fold on long-form.
  const igCap = 'Loving this lamp\n\nAs an Amazon Associate I earn from qualifying purchases. #ad #sponsored'
  check('instagram: tags move to the first line', discloseSocialPost(igCap, 'instagram').startsWith('#ad #sponsored\n'))
  check('instagram: still exactly once after the move', count(discloseSocialPost(igCap, 'instagram'), AD) === 1)
  const fbCap = '🛒 Grab it on Amazon 👉 https://amzn.to/x\nAs an Amazon Associate I earn from qualifying purchases. #ad #sponsored\n\nGreat.'
  check('facebook: tags already inside the fold stay where they are', discloseSocialPost(fbCap, 'facebook') === fbCap)
}

// ── Limits: the body is cut, never the tags or the link ──────────────────────
{
  const long = `${'This is a really great product that I would recommend to anyone. '.repeat(20)}`
  const url = 'https://www.amazon.com/dp/B000000001?tag=me-20'
  for (const p of ['twitter', 'bluesky', 'threads', 'pinterest', 'instagram', 'linkedin'] as DisclosurePlatform[]) {
    const max = DISCLOSURE_LIMITS[p].maxChars as number
    const body = p === 'linkedin' || p === 'instagram' ? long.repeat(5) : long
    const out = discloseSocialPost(`${body} ${url}`, p)
    check(`${p}: within ${max} characters`, out.length <= max)
    check(`${p}: both tags survive the cut`, count(out, AD) === 1 && count(out, SP) === 1)
    check(`${p}: the link survives whole`, out.includes(url))
    check(`${p}: the link is labelled`, out.includes(`${DEST_LABEL.amazon} ${url}`))
    check(`${p}: idempotent`, discloseSocialPost(out, p) === out)
  }
  const tags = Array.from({ length: 30 }, (_, i) => `#topic${i}`).join(' ')
  const ig = discloseSocialPost(`Nice find\n\n${tags}`, 'instagram')
  check('instagram: never more than 30 hashtags', count(ig, /(?<![\w#])#[\p{L}\p{N}_]+/gu) <= 30)
  check('instagram: a topical tag is dropped, not a disclosure tag', count(ig, AD) === 1 && count(ig, SP) === 1 && !ig.includes('#topic29'))
}

// ── Labels ───────────────────────────────────────────────────────────────────
{
  check('amazon.com is Amazon', linkDestination('https://www.amazon.com/dp/B0') === 'amazon')
  check('amzn.to is Amazon', linkDestination('https://amzn.to/abc') === 'amazon')
  check('a.co is Amazon', linkDestination('https://a.co/d/abc') === 'amazon')
  check('amazon.co.uk is Amazon', linkDestination('https://www.amazon.co.uk/dp/B0') === 'amazon')
  check('walmart.com is Walmart', linkDestination('https://www.walmart.com/ip/123') === 'walmart')
  check('shopltk is LTK', linkDestination('https://www.shopltk.com/explore/me') === 'ltk')
  check('liketk.it is LTK', linkDestination('https://liketk.it/4abc') === 'ltk')
  check('an unknown geni.us is NOT guessed as Amazon', linkDestination('https://geni.us/neverseen') === null)
  rememberLinkDestination('https://geni.us/known1', 'https://www.amazon.com/dp/B0?tag=x')
  check('a geni.us MVP minted resolves to its store', linkDestination('https://geni.us/known1') === 'amazon')
  rememberLinkDestination('https://www.mvpl.ink/abc123', 'amazon')
  check('a Passport link MVP minted resolves to its store', linkDestination('https://www.mvpl.ink/abc123') === 'amazon')
  rememberBlogUrl('https://myblog.example/best-blender/')
  check('the creator\'s WordPress domain is the blog', linkDestination('https://myblog.example/another-post/') === 'blog')
  rememberLinkDestination('https://geni.us/blogwrap', 'https://myblog.example/best-blender/')
  check('a geni.us wrapping the blog is the blog', linkDestination('https://geni.us/blogwrap') === 'blog')

  check('Amazon label', labelLinks('Great https://amzn.to/x').includes('Check it out here on Amazon: https://amzn.to/x'))
  check('blog label', labelLinks('More https://myblog.example/p').includes('Read the full review on my blog: https://myblog.example/p'))
  check('Walmart label', labelLinks('Deal https://www.walmart.com/ip/1').includes('See it on Walmart: https://www.walmart.com/ip/1'))
  check('LTK label', labelLinks('Outfit https://liketk.it/4a').includes('Shop it on LTK: https://liketk.it/4a'))
  check('unknown label', labelLinks('Look https://geni.us/neverseen').includes('Check it out here: https://geni.us/neverseen'))
  const named = '🛒 On Amazon: https://geni.us/neverseen'
  check('a line that already names the store is left alone', labelLinks(named) === named)
  const above = 'Check it out on Walmart\nhttps://www.walmart.com/ip/1'
  check('a label on the line above counts', labelLinks(above) === above)
  check('a generic label gains the store, not a second label',
    labelLinks('🛒 Get it here 👉 https://amzn.to/x') === '🛒 Get it here on Amazon 👉 https://amzn.to/x')
  const once = labelLinks('Great https://amzn.to/x')
  check('never double-labelled', labelLinks(once) === once)
  check('labels carry no dashes', !Object.values(DEST_LABEL).some((l) => /[—–]| - /.test(l)))
  const tg = labelLinks('[Read the full review →](https://myblog.example/p)', undefined, { markdownV2: true })
  check('Telegram link text names the blog', tg === '[Read the full review on my blog](https://myblog.example/p)')
  const pin = discloseSocialPost('A pin with no link in it', 'pinterest')
  check('a description without a URL gets no label', !/Check it out|Read the full/.test(pin))
}

// ── Every publisher routes through it ────────────────────────────────────────
// Each is the last call before that platform's API, so every route above it
// (immediate, bulk, scheduled, Deal Radar, Walmart, Wayward, LTK, Levanta, the
// Amazon hub, Clip Factory) inherits it.
const SERVICES: Array<[string, string, number]> = [
  ['services/twitter.ts', "discloseSocialPost(text, 'twitter')", 1],
  ['services/bluesky.ts', "discloseSocialPost(args.text, 'bluesky')", 1],
  ['services/threads/index.ts', "discloseSocialPost(text, 'threads')", 1],
  ['services/linkedin/index.ts', "discloseSocialPost(opts.text, 'linkedin')", 2],
  ['services/facebook/index.ts', "'facebook')", 3],
  ['lib/facebook-reels.ts', "discloseSocialPost(opts.description, 'facebook')", 1],
  ['services/telegram.ts', "'telegram')", 2],
  ['services/instagram.ts', "discloseSocialPost(opts.caption, 'instagram')", 2],
  ['services/pinterest/index.ts', "discloseSocialPost(opts.description, 'pinterest')", 3],
]
for (const [f, needle, n] of SERVICES) {
  const s = read(f)
  check(`${f}: every outgoing text goes through discloseSocialPost (${n})`, s.split(needle).length - 1 === n)
}
// The payload fields themselves: a raw text/caption/description sent to an API
// would bypass the helper.
check('X payload is disclosed', !/= \{ text \}/.test(read('services/twitter.ts')))
check('Threads container is disclosed', !/containerBody: Record<string, string> = \{ text \}/.test(read('services/threads/index.ts')))
// Only the Page publisher class: the comment replies and private replies further
// down the file are DMs and replies, not posts.
const FB_CLASS = read('services/facebook/index.ts').split('export class FacebookService')[1].split('\n}\n')[0]
check('Facebook sends no raw message or caption', !/message: opts\.message[,\s]|caption: opts\.caption,/.test(FB_CLASS))
check('Instagram sends no raw caption', !/body\.set\('caption', opts\.caption/.test(read('services/instagram.ts')))
check('Pinterest sends no raw description', !/description: opts\.description,/.test(read('services/pinterest/index.ts')))
check('LinkedIn sends no raw text', !/shareCommentary: \{ text: opts\.text \}/.test(read('services/linkedin/index.ts')))
check('Telegram sends no raw caption', !/caption: caption\.slice|text: text\.slice/.test(read('services/telegram.ts')))
// Cloaked links say where they land because the code that mints them records it.
check('Passport mint records its store', /rememberLinkDestination\(passportLinkUrl\(code\)/.test(read('lib/passport-links.ts')))
check('Geniuslink mint records its destination', /rememberLinkDestination\(out\.url, destination\)/.test(read('services/geniuslink/index.ts')))
check('Bitly records its destination', /rememberLinkDestination\(link, url\)/.test(read('lib/bitly.ts')))
check('blog share links record the blog', /rememberBlogUrl\(opts\.post\.wordpress_url\)/.test(read('lib/channel-share-url.ts')))
// DMs are private messages, not posts, and stay untagged.
check('lib/ig-dm.ts is not tagged', !/discloseSocialPost/.test(read('lib/ig-dm.ts')))

if (failures.length) {
  console.error(`✗ social-disclosure: ${failures.length} failed`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ social-disclosure: #ad and #sponsored once each on every post, inside every limit, and every link says where it goes')
