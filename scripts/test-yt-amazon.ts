// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUTUBE VS AMAZON (lib/yt-amazon-match, lib/yt-amazon-links; Seb,
// 2026-11-11: "is there a way to look at all of the youtube videos ive
// uploaded and see what is missing when you look at my amazon storefront?").
// The four lists on a made-up channel and storefront; a gear list left out; a
// short link followed to its ASIN without Amazon's own page ever being
// fetched; and the page in Labs for the team only.
import { readFileSync, existsSync } from 'node:fs'
import { buildCoverage, titleAsins, whyWords, amazonState, listText, topLinks, titleMatcher, titleKey, type YtVideo, type AmzVideo } from '../lib/yt-amazon-match'
import { followToAsin, productsOfVideo } from '../lib/yt-amazon-links'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

const yt = (id: string, views: number, extra: Partial<YtVideo> = {}): YtVideo => ({ id, title: `Video ${id}`, publishedAt: '2026-10-01T00:00:00Z', views, thumb: null, short: false, readAt: '2026-11-11T00:00:00Z', why: null, ...extra })
const amz = (aci: string, views: number, extra: Partial<AmzVideo> = {}): AmzVideo => ({ aci, description: `Amazon video ${aci}`, state: 'PUBLISHED', publishedAt: null, views, productsRead: true, ...extra })

// Ten YouTube videos; GEAR is the microphone linked in every description.
const vids = [yt('a', 900), yt('b', 5000), yt('c', 100), yt('d', 50, { readAt: null }), yt('e', 70, { why: 'elsewhere:brand.com' }), yt('f', 10), yt('g', 1), yt('h', 2), yt('i', 3), yt('j', 4)]
const ytp = [
  { videoId: 'a', asin: 'B0AAAAAAAA', via: 'https://geni.us/a' },
  { videoId: 'b', asin: 'B0BBBBBBBB', via: 'title' },
  { videoId: 'c', asin: 'B0CCCCCCCC', via: 'https://amzn.to/c' },
  { videoId: 'f', asin: 'B0FFFFFFFF', via: 'https://amzn.to/f' },
  ...['a', 'b', 'c', 'f', 'g', 'h', 'i', 'j'].map((v) => ({ videoId: v, asin: 'B0GEARMIC0', via: 'https://geni.us/mic' })),
]
const amzVids = [amz('x1', 300), amz('x2', 40), amz('x3', 20, { state: 'REJECTED' }), amz('x4', 9, { productsRead: false }), amz('x5', 5), amz('x6', 1), amz('x7', 2)]
const amzp = [
  { aci: 'x1', asin: 'B0BBBBBBBB', title: 'Thing B' },
  { aci: 'x2', asin: 'B0ZZZZZZZZ', title: 'Only on Amazon' },
  { aci: 'x3', asin: 'B0CCCCCCCC', title: 'Thing C' },
  { aci: 'x5', asin: 'B0GEARMIC0', title: 'The microphone' },
  { aci: 'x7', asin: 'B0FFFFFFFF', title: 'Thing F' },
]
const c = buildCoverage(vids, ytp, amzVids, amzp)
const ids = (xs: Array<{ yt: YtVideo }>) => xs.map((x) => x.yt.id).join(',')
check('on YouTube with no Amazon video: the gap, biggest first', ids(c.missing) === 'a,c', ids(c.missing))
check('a product Amazon rejected the video for still counts as missing, and says so', c.missing.find((m) => m.yt.id === 'c')!.rejected.length === 1 && amazonState('REJECTED') === 'rejected')
check('on both: an Amazon video shows the product', ids(c.both) === 'b,f', ids(c.both))
check('a gear list in most descriptions is left out and named, so the microphone’s Amazon video covers nothing', c.common.length === 1 && c.common[0].asin === 'B0GEARMIC0' && !c.both.some((b) => b.asins.includes('B0GEARMIC0')))
check('a video whose only link is the gear list cannot be placed, and says why', /gear list/.test(c.unknown.find((u) => u.yt.id === 'g')!.why))
check('not read yet and links leading elsewhere are said as that', /Not read yet/.test(c.unknown.find((u) => u.yt.id === 'd')!.why) && /lead to brand\.com, not to Amazon/.test(c.unknown.find((u) => u.yt.id === 'e')!.why))
check('on Amazon only: an Amazon video no YouTube video links to; the gear list’s does not count', c.amazonOnly.map((x) => x.amz.aci).join(',') === 'x2,x5', c.amazonOnly.map((x) => x.amz.aci))
check('an Amazon video whose products are not read yet is counted apart, never listed', c.counts.amazonUnread === 1 && !c.amazonOnly.some((x) => x.amz.aci === 'x4'))
check('counts add up', c.counts.youtube === 10 && c.counts.missing + c.counts.both + c.counts.unknown === 10 && c.counts.youtubeRead === 9)
check('Copy this list gives a line per video with its YouTube link and ASINs', listText(c, 'missing').split('\n')[0] === 'Video a\thttps://www.youtube.com/watch?v=a\tB0AAAAAAAA')
check('an ASIN in a title is only the B0 form, never a model number', titleAsins('Review B0ABCDEF12 and the XR500PRO12') .join() === 'B0ABCDEF12' && titleAsins('No asin here').length === 0)
check('every reason has words', ['no-link', 'amazon-not-product', 'link-failed', 'elsewhere:a.com,b.com'].every((w) => whyWords({ readAt: 'x', why: w }).length > 20))

// SEB'S DESCRIPTIONS (2026-11-11, his first run: 3,248 of 3,539 not placed).
const sebDesc = `CHECK OUT TODAY'S PRICE: \u25ba\u25ba\u25ba     \n\nhttps://geni.us/pbKL5\n(Amazon link)\n-\nDISCLAIMER: This video and description may contain affiliate links.\n-\nRESOURCES:\n\u27a1\ufe0f Start Reviewing Products on Amazon: https://tinyurl.com/224mdynm\n\u27a1\ufe0f Get Unlimited Copyright Free Music: https://tinyurl.com/mrxyneeb\n\nWHAT WE SHOOT REVIEWS WITH:\n\u27a1\ufe0f Our Favorite Phone: https://geni.us/oH9Zog (Amazon)\n\u27a1\ufe0f Our Favorite Lights: https://geni.us/IWcXF (Amazon)\n#windshield #carcare`
check('only the product link at the top of a description is followed, never the promo and gear links below it', topLinks(sebDesc).join(' ') === 'https://geni.us/pbKL5', topLinks(sebDesc))
check('a description with its links under a heading still finds the first block', topLinks('Great blender.\n\nGet it here: https://amzn.to/abc and https://amzn.to/def\n\nFOLLOW ME\nhttps://instagram.com/x').join(' ') === 'https://amzn.to/abc https://amzn.to/def')
// Title pairing: an Amazon video's own words are often the YouTube title.
const amzT = [amz('t1', 10, { description: 'Windshield Sun Shade Umbrella: Keep Your Dash Protected And Your Car Temp Down!' }), amz('t2', 10, { description: 'Is the Annie & Mia Design Electric Egg Cooker worth it?\nMore words here' }), amz('t3', 10, { description: 'Travel neck pillow' })]
const same = titleMatcher(amzT)
check('the same title pairs, whatever its punctuation or hashtags', same('Windshield Sun Shade Umbrella - Keep Your Dash Protected and Your Car Temp Down #carcare')[0]?.aci === 't1' && titleKey('Q&A: Hello!') === 'q and a hello')
check('nearly the same words pair; a few shared words do not', same('Annie and Mia Design Electric Egg Cooker: worth it?')[0]?.aci === 't2' && same('Electric kettle worth it').length === 0 && same('Travel pillow').length === 0)
const ct = buildCoverage([yt('w', 169180, { title: 'Windshield Sun Shade Umbrella: Keep Your Dash Protected And Your Car Temp Down!', why: 'link-failed' })], [], amzT, [{ aci: 't1', asin: 'B0CWS46T3D', title: 'Sun shade' }])
check('a video with no readable link is paired by its title, takes the Amazon video’s product, and that Amazon video is no longer Amazon only', ct.both.length === 1 && ct.both[0].byTitle === true && ct.both[0].asins[0] === 'B0CWS46T3D' && ct.counts.bothByTitle === 1 && !ct.amazonOnly.some((x) => x.amz.aci === 't1') && ct.unknown.length === 0)

// Following a link: hop by hop, and Amazon itself is never fetched.
;(async () => {
  const calls: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (u: string) => {
    calls.push(String(u))
    return new Response(null, { status: 302, headers: { location: 'https://www.amazon.com/dp/B0ABCDEFGH?tag=seb-20&linkCode=ll1' } })
  }) as typeof fetch
  try {
    const r = await followToAsin('https://93.184.216.34/short')
    check(`a short link is followed to its ASIN, and the Amazon page it lands on is never fetched (${calls.join(' ')})`, 'asin' in r && r.asin === 'B0ABCDEFGH' && calls.length === 1 && !calls.some((u) => /amazon\./.test(u)))
    calls.length = 0
    const direct = await followToAsin('https://www.amazon.com/dp/B0DIRECT01')
    const shop = await followToAsin('https://www.amazon.com/shop/gominreviews')
    check('an Amazon address is read, never fetched: a product gives its ASIN, a storefront is not a product', 'asin' in direct && direct.asin === 'B0DIRECT01' && 'why' in shop && shop.why === 'amazon-not-product' && calls.length === 0)
    const local = await followToAsin('https://127.0.0.1/x')
    check('a private address is refused before any request', 'why' in local && local.why === 'link-failed' && calls.length === 0)
    // "Slow down" is waited out and tried again.
    let n = 0
    const waits: number[] = []
    globalThis.fetch = (async () => (++n === 1 ? new Response(null, { status: 429, headers: { 'retry-after': '3' } }) : new Response(null, { status: 302, headers: { location: 'https://www.amazon.com/dp/B0SLOWDOWN?tag=x' } }))) as typeof fetch
    const slow = await followToAsin('https://93.184.216.34/s', async (ms) => { waits.push(ms) })
    check(`a link service that says slow down is waited out (as long as it asks, up to ten seconds) and asked again (${waits.join(',')})`, 'asin' in slow && slow.asin === 'B0SLOWDOWN' && waits.join(',') === '3000')
    globalThis.fetch = (async () => new Response(null, { status: 429 })) as typeof fetch
    const still = await followToAsin('https://93.184.216.34/s', async () => {})
    check('one that keeps saying slow down is said as that, never as a dead link', 'why' in still && still.why === 'rate-limited')
    // A link already resolved is never followed again.
    calls.length = 0
    globalThis.fetch = (async (u: string) => { calls.push(String(u)); return new Response(null, { status: 500 }) }) as typeof fetch
    const known = new Map<string, string | null>([['https://geni.us/pbKL5', 'B0CWS46T3D']])
    const viaKnown = await productsOfVideo('Windshield Sun Shade Umbrella', sebDesc, known)
    check('a link already resolved (in any earlier video) is taken from memory, with no request at all', viaKnown.asins.map((a) => a.asin).join() === 'B0CWS46T3D' && viaKnown.followed === 0 && calls.length === 0)
  } finally { globalThis.fetch = realFetch }

  const R = read('app/api/labs/yt-amazon/route.ts')
  check('the route is for the MVP team only, and says when migration 466 is missing', /normalizeTier\(intg\?\.tier\) !== 'admin'/.test(R) && /migration 466/.test(R))
  check('links are read a batch at a time inside a time limit, each saved as it is read', /Date\.now\(\) - started > 70_000/.test(R) && /\.limit\(60\)/.test(R) && /Array\.from\(\{ length: 3 \}, worker\)/.test(R) && /const known = new Map<string, string \| null>\(\)/.test(R) && /productsOfVideo\(v\.title \|\| '', v\.description \|\| '', known\)/.test(R))
  check('videos with no product whose link did not answer, and once those the first reader could not place, are read again', /if \(body\.action === 'unplaced'\)/.test(R) && /\.in\('products_why', \['link-failed', 'rate-limited'\]\)/.test(R) && /\.lt\('products_read_at', READER_2\)/.test(R))
  const L = read('lib/yt-amazon-links.ts')
  check('the follower checks for Amazon before it fetches, and every hop is checked as public', L.indexOf('AMAZON_HOST.test(host)') < L.indexOf('await fetch(') && L.indexOf('assertPublicHttpUrlResolved(current)') < L.indexOf('await fetch(') && /'User-Agent': RESOLVER_UA/.test(L))
  const M = read('supabase/migrations/466_youtube_video_products.sql')
  check('migration 466 is safe to run twice', /create table if not exists public\.youtube_video_products/.test(M) && /add column if not exists products_read_at/.test(M) && /drop policy if exists/.test(M))
  check('in Labs for the team only, with its line', /\{ href: '\/youtube-amazon', icon: <ListChecks size=\{15\} \/>, label: 'YouTube vs Amazon', gate: isAdmin/.test(read('components/layout/DashboardShellV2.tsx')) && /'\/youtube-amazon': /.test(read('lib/feature-lines.ts')) && existsSync('app/(dashboard)/youtube-amazon/page.tsx') && /tier !== 'admin'\) router\.replace/.test(read('app/(dashboard)/youtube-amazon/page.tsx')))
  const P = read('components/amazon/YouTubeAmazonGaps.tsx')
  check('Check everything reads YouTube, then Amazon, then the links, and each step says what it read', /await readYouTube\(\)\n\s*if \(!stop\.current\) await readAmazon\(\)\n\s*if \(!stop\.current\) await readLinks\(\)/.test(P) && /note\('youtube', true/.test(P) && /note\('amazon', false/.test(P) && /note\('links', !slowed/.test(P) && /if \(retryUnplaced\) await post\('\/api\/labs\/yt-amazon', \{ action: 'unplaced' \}\)/.test(P))
  check('what SCOUT\u2019s Amazon list read got is said: how many videos, or why it stopped', /SCOUT read \$\{num\(st\.saved\)\} videos from your Amazon video list/.test(P) && /SCOUT could not read your Amazon video list: \$\{errWords\}/.test(P) && /this Chrome is signed out of Amazon/.test(P))
  check('a pair found by the same title is marked', /On Amazon\{m\.byTitle \? ' \(same title\)' : ''\}/.test(P))
  check('every link names where it goes', /Watch on YouTube/.test(P) && /see it on Amazon/.test(P) && !/>\s*(Open|Buy now|Click here|Shop now)\s*</.test(P))
  const words = (src: string) => (src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n').match(/'[^'\n]*'|`[^`\n]*`|>[^<>{}\n]+</g) || []).join(' ')
  check('no dashes in what a creator reads', ![P, read('lib/yt-amazon-match.ts')].some((s) => /[–—]| - /.test(words(s))))

  if (fails.length) { console.error(`❌ yt-amazon: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
  console.log('✅ yt-amazon: every YouTube upload placed against the Amazon storefront by product (missing, Amazon only, could not tell, both), a gear list left out, short links followed without fetching Amazon, in Labs for the team')
})()
