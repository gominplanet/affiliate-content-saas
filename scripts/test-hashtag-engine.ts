// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE HASHTAG ENGINE FOR EVERYTHING MVP POSTS (lib/hashtag-engine; Seb,
// 2026-10-16: "whenever MVP is using hashtags or posting hashtags on anything
// we create, we should really have a great way, a perfect way, a bulletproof
// way to find the best hashtags for that particular content every time").
//
// Held on the traps: an air fryer that got #techfinds, a viral #halloween on
// a kitchen gadget, #fyp and years in a title, Instagram's 5 (with #ad, and
// #ad only), Threads' 1, a tag the platform shows almost nobody using, a
// duplicate in another case, and a tag trimmed out of the middle of a
// sentence taking its word with it. Then the wiring: every generator picks
// through the engine, every post goes through the safety net, every platform
// is tracked, and SCOUT reads trends without ever posting.
import { readFileSync, existsSync } from 'node:fs'
import { pickHashtags, fitHashtags, TAG_RULES, trendStanding, tagProblem, SOURCE_WORDS } from '../lib/hashtag-engine'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')
const tagsOf = (s: string): string[] => s.match(/#[A-Za-z][A-Za-z0-9_]*/g) || []

// ── The rulebook ─────────────────────────────────────────────────────────────
check('Instagram: 5 a post, #ad counted', TAG_RULES.instagram.hardMax === 5 && TAG_RULES.instagram.disclosure === 1 && TAG_RULES.instagram.max <= 4)
check('Threads: 1', TAG_RULES.threads.max === 1 && TAG_RULES.threads.hardMax === 1)
check('YouTube: 3 to 5, never more than 15 (YouTube ignores them all past 15)', TAG_RULES.youtube.min === 3 && TAG_RULES.youtube.max === 5 && TAG_RULES.youtube.hardMax === 15)
check('TikTok: 3 to 5', TAG_RULES.tiktok.min === 3 && TAG_RULES.tiktok.max === 5)
check('X and Bluesky: 1 or 2', TAG_RULES.x.hardMax === 2 && TAG_RULES.bluesky.hardMax === 2)
check('every rule says what it is in words, without dashes', Object.values(TAG_RULES).every((r) => r.says.length > 10 && !/[–—]| - /.test(r.says)))
check('the words for each source have no dashes', Object.values(SOURCE_WORDS).every((w) => !/[–—]| - /.test(w)))

// ── What it picks ────────────────────────────────────────────────────────────
const air = { text: 'COSORI Pro LE Air Fryer 5 Qt, healthy cooking, crispy fries with little oil', brand: 'COSORI' }
const trends = [{ tag: '#halloween', source: 'tiktok_cc', rank: 1 }, { tag: '#airfryerrecipes', source: 'tiktok_cc', rank: 14 }]
const writer = ['#2026deals', '#fyp', '#kitchengadgets', '#techfinds']
const ig = pickHashtags({ platform: 'instagram', ...air, writer, trends })
const igTags = ig.tags.map((t) => t.tag)
check('Instagram picks 3 to 4 (5 with #ad)', igTags.length >= 3 && igTags.length <= 4, igTags)
check('the brand and what the product is lead', igTags[0] === '#cosori' && igTags.includes('#airfryer'), igTags)
check('an air fryer never gets #techfinds', !igTags.includes('#techfinds'), igTags)
check('a trend about the content is used, and says it is trending', ig.tags.some((t) => t.tag === '#airfryerrecipes' && t.source === 'trend'), ig.tags)
check('a viral trend that is not about the content is never used', !ig.tags.some((t) => t.tag === '#halloween'), igTags)
const tt = pickHashtags({ platform: 'tiktok', ...air, writer, trends })
check('a year is dropped and says why', tt.dropped.some((d) => d.tag === '#2026deals' && /year/.test(d.why)), tt.dropped)
check('#fyp is dropped as spam', tt.dropped.some((d) => d.tag === '#fyp'), tt.dropped)
check('no picked tag anywhere carries a year or spam', ['instagram', 'tiktok', 'youtube_short', 'facebook', 'pinterest', 'linkedin'].every((p) => pickHashtags({ platform: p as 'instagram', ...air, writer, trends }).tags.every((t) => !tagProblem(t.tag).problem)))
const th = pickHashtags({ platform: 'threads', ...air, writer, trends })
check('Threads gets exactly one, about the product', th.tags.length === 1 && /airfryer/.test(th.tags[0].tag), th.tags)
check('every pick says where it came from', [...ig.tags, ...tt.tags, ...th.tags].every((t) => t.why.length > 3 && SOURCE_WORDS[t.source]))
const lamp = pickHashtags({ platform: 'instagram', text: 'Dimmable LED desk lamp with USB charging port for home office', brand: 'TaoTronics' })
check('a desk lamp gets lighting or office tags, not kitchen ones', lamp.tags.length >= 3 && !lamp.tags.some((t) => /kitchen|airfryer|cook/.test(t.tag)), lamp.tags)

// ── What the platforms themselves say ────────────────────────────────────────
check('standing: Instagram under 2K posts is a dead end, over 300M a crowd', trendStanding({ source: 'instagram', posts: 1500 }) === 'dead' && trendStanding({ source: 'instagram', posts: 4e8 }) === 'crowd' && trendStanding({ source: 'instagram', posts: 4e6 }) === 'active')
check('standing: no count is unknown, never dead', trendStanding({ source: 'instagram', posts: null }) === 'unknown' && trendStanding({ source: 'youtube', posts: null }) === 'unknown')
check('standing: TikTok Creative Center is trending by definition', trendStanding({ source: 'tiktok_cc', posts: null }) === 'active')
const dead = pickHashtags({ platform: 'instagram', ...air, trends: [{ tag: '#kitchenessentials', source: 'instagram', posts: 500 }, { tag: '#cosori', source: 'instagram', posts: 900 }] })
check('a tag Instagram shows almost nobody using is dropped, with the count', !dead.tags.some((t) => t.tag === '#kitchenessentials') && dead.dropped.some((d) => d.tag === '#kitchenessentials' && /500/.test(d.why)), dead)
check('the brand tag stays even when small (brand tags are)', dead.tags[0]?.tag === '#cosori', dead.tags)
check('the pick is still full after a dead tag is dropped', dead.tags.length >= 3, dead.tags)

// ── The safety net every post goes through ──────────────────────────────────
const net = fitHashtags('I love my #airfryer and my #Cosori daily. #a\n\n#AirFryer #cosori #kitchen #cooking #food #yum #ad', 'instagram')
check('each tag once, in any case', tagsOf(net).filter((t) => /airfryer/i.test(t)).length === 1 && tagsOf(net).filter((t) => /cosori/i.test(t)).length === 1, net)
check('Instagram: 4 tags and #ad, nothing more', tagsOf(net).length === 5 && tagsOf(net).includes('#ad'), net)
check('a tag trimmed from a sentence keeps its word', /I love my #airfryer and my #Cosori daily\./.test(net), net)
const mid = fitHashtags('Tip of the day #fyp is not real\n#one #two #three', 'threads')
check('a spam tag in a sentence leaves the word, and Threads keeps 1', /Tip of the day fyp is not real/.test(mid) && tagsOf(mid).length === 1, mid)
const yt = fitHashtags(`Review ${Array.from({ length: 20 }, (_, i) => `#tag${String.fromCharCode(97 + i)}x`).join(' ')}`, 'youtube')
check('YouTube never gets more than 15 (it would ignore them all)', tagsOf(yt).length === 15, tagsOf(yt).length)
check('the safety net leaves no stray spaces before a tag line', !/\n[ \t]+#/.test(fitHashtags('Hi\n\n #a1 #airfryer #ad', 'instagram')))

// ── Wiring: every generator picks through the engine ─────────────────────────
const PICKERS = [
  'lib/ig-burn.ts', 'lib/direct-caption.ts', 'app/api/blog/instagram-post/route.ts', 'lib/amazon-social-publish.ts', 'lib/pin-assets.ts',
  'lib/amazon-pin-publish.ts', 'app/api/youtube/generate-metadata/route.ts', 'lib/shorts-planner.ts', 'app/api/blog/facebook-post/route.ts', 'app/(dashboard)/content/page.tsx',
]
for (const f of PICKERS) check(`${f} picks hashtags through the engine`, /hashtagsFor\(|hashtagLine\(|pickHashtags\(/.test(read(f)))
for (const f of ['services/youtube/index.ts', 'services/tiktok.ts', 'app/api/instagram/post-direct-video/route.ts']) check(`${f} sends through the safety net`, /fitHashtags\(/.test(read(f)))
check('the social disclaimer nets every platform but Telegram, and Instagram takes #ad only', /fitHashtags\(/.test(read('lib/social-disclaimer.ts')) && /onlyAd/.test(read('lib/social-disclaimer.ts')))

// ── Wiring: every platform is tracked ────────────────────────────────────────
const TRACKED: Array<[string, string]> = [
  ['app/api/blog/facebook-post/route.ts', 'facebook'], ['app/api/blog/threads-post/route.ts', 'threads'], ['app/api/blog/twitter-post/route.ts', 'x'],
  ['app/api/blog/linkedin-post/route.ts', 'linkedin'], ['app/api/blog/bluesky-post/route.ts', 'bluesky'], ['app/api/blog/telegram-post/route.ts', 'telegram'],
  ['app/api/blog/pinterest-post/route.ts', 'pinterest'], ['app/api/tiktok/publish-burned/route.ts', 'tiktok'], ['app/api/blog/tiktok-post/video/route.ts', 'tiktok'],
  ['app/api/instagram/post-direct-video/route.ts', 'instagram'], ['app/api/clip-factory/facebook-reel/route.ts', 'facebook'], ['app/api/pinterest/video-pin/route.ts', 'pinterest'],
]
for (const [f, p] of TRACKED) check(`${f} tracks its ${p} post`, new RegExp(`trackPost\\(\\{[^}]*platform: '${p}'`).test(read(f)))
check('tracking is awaited, so a serverless function cannot end before the row is written', [...TRACKED.map(([f]) => f), 'app/api/cron/process-scheduled/route.ts', 'lib/amazon-social-publish.ts', 'lib/amazon-pin-publish.ts'].every((f) => !/void trackPost\(/.test(read(f)) && /await trackPost\(/.test(read(f))))
check('scheduled posts are tracked, X as x', /trackPost\(/.test(read('app/api/cron/process-scheduled/route.ts')))
const PULSE = read('lib/reach-pulse.ts')
check('a platform with no results says why, and is recorded not pending', /NO_RESULTS_WHY/.test(PULSE) && /status: collectable \? 'pending' : 'recorded'/.test(PULSE) && ['tiktok', 'threads', 'x', 'linkedin', 'telegram'].every((p) => new RegExp(`\\b${p}: '`).test(PULSE)))
const COLLECT = read('app/api/cron/collect-reach/route.ts')
check('results come back from Facebook, Pinterest and Bluesky, each on its own baseline', /facebookEngagement\(/.test(COLLECT) && /pinterestAnalytics\(/.test(COLLECT) && /blueskyCounts\(/.test(COLLECT) && /touched\.add\(`\$\{row\.user_id\}:facebook`\)/.test(COLLECT))
const SUMMARY = read('app/api/pulse/summary/route.ts')
check('Pulse shows every platform, measured or not, and why not', /byPlatform/.test(SUMMARY) && /noResultsWhy/.test(SUMMARY) && /Tags recorded, results not available/.test(read('components/pulse/PulsePanel.tsx')))

// ── SCOUT reads trends, never posts ──────────────────────────────────────────
const BG = read('extension/background.js')
const MAN = JSON.parse(read('extension/manifest.json')) as { optional_host_permissions: string[] }
check('SCOUT answers the three hashtag messages, only for MVP itself', /msg\.type === 'MVP_HASHTAG_ACCESS'/.test(BG) && /msg\.type === 'MVP_HASHTAG_TIKTOK'/.test(BG) && /msg\.type === 'MVP_HASHTAG_INSTAGRAM'/.test(BG) && /\/\^MVP_\(TRYBE\|HASHTAG\)_\/\.test\(msg\.type\) && !trybeCallerOk\(sender\)/.test(BG))
check('Creative Center and Instagram are asked for, never assumed', MAN.optional_host_permissions.includes('https://ads.tiktok.com/*') && MAN.optional_host_permissions.includes('https://www.instagram.com/*') && existsSync('extension/hashtags-allow.html') && /SCOUT_HASHTAG_ALLOW_RESULT/.test(read('extension/hashtags-allow.js')))
const igFn = BG.slice(BG.indexOf('async function igTagCountsInPage('), BG.indexOf('async function hashtagInstagram('))
check('the Instagram read only reads: no POST, no like, no follow', igFn.length > 200 && !/method:\s*['"](POST|PUT|DELETE)/i.test(igFn) && !/like|follow|comment/i.test(igFn.replace(/\/\/.*$/gm, '')) && /\/api\/v1\/tags\/web_info\//.test(igFn))
check('at most 20 tags, an unhurried pause between them', /\.slice\(0, 20\)/.test(BG.slice(BG.indexOf('async function hashtagInstagram('))) && /sleep\(gapMs \+ Math\.round\(Math\.random\(\) \* gapMs\)\)/.test(igFn))
const ccMore = BG.slice(BG.indexOf('function ccMoreInPage('), BG.indexOf('async function hashtagTikTok('))
check('on Creative Center SCOUT presses View more and nothing else', /\(view\|load\|see\) more/.test(ccMore) && (ccMore.match(/\.click\(\)/g) || []).length === 1)
const HOOK = read('extension/tiktok-cc-hook.js')
check('the Creative Center watcher keeps a copy and changes nothing', /creative_radar_api/.test(HOOK) && /r\.clone\(\)/.test(HOOK) && /return p\n/.test(HOOK) && /return realOpen\.apply\(this, arguments\)/.test(HOOK))
check('the watcher is on only for the read', /registerContentScripts\(\[\{ id: CC_HOOK_ID, .*world: 'MAIN'/.test(BG) && /finally \{[\s\S]{0,200}unregisterContentScripts\(\{ ids: \[CC_HOOK_ID\] \}\)/.test(BG))
check('a read that found nothing says so', /error: 'nothing-read'/.test(BG))

if (fails.length) { console.error('hashtag-engine failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ hashtag-engine: one pick for every platform (Instagram 5 with #ad, Threads 1, YouTube up to 15), trends only when about the post, dead tags dropped, every post netted and tracked, SCOUT reads only')
