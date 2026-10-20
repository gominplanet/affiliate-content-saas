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
import { pickHashtags, fitHashtags, TAG_RULES, trendStanding, tagProblem, SOURCE_WORDS, madeOfContent, contentWords, sizeScore, wordsInTag, phraseProblem } from '../lib/hashtag-engine'
import { categoriesFor, deriveBrandTag } from '../lib/hashtag-map'

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

// ── A trending tag must be about THIS product (live TikTok lists, 2026-10-16) ──
const vacWords = contentWords('Shark cordless vacuum with self-empty base, pet hair pickup')
check('#cordlessvacuum is about a cordless vacuum', madeOfContent('#cordlessvacuum', vacWords))
check('#cordlessblower is not, though it shares "cordless"', !madeOfContent('#cordlessblower', vacWords))
check('an add-on keeps it about the product (#airfryerrecipes)', madeOfContent('#airfryerrecipes', contentWords(air.text)))
check('an add-on alone is about nothing (#recipes)', !madeOfContent('#recipes', contentWords(air.text)) && !madeOfContent('#tipshacks', contentWords(air.text)))
check('#yellowteeth is about strips for yellow teeth', madeOfContent('#yellowteeth', contentWords('Crest whitening strips for yellow teeth')))
const ttLive = [{ tag: '#cordlessvacuum', source: 'tiktok_cc', rank: 3 }, { tag: '#cordlessblower', source: 'tiktok_cc', rank: 2 }, { tag: '#productreview', source: 'tiktok_cc', rank: 1 }]
const vac = pickHashtags({ platform: 'tiktok', text: 'Shark cordless vacuum with self-empty base, pet hair pickup', trends: ttLive })
check('a vacuum gets the vacuum trend, not the blower one or a generic one', vac.tags.some((t) => t.tag === '#cordlessvacuum' && t.source === 'trend') && !vac.tags.some((t) => t.tag === '#cordlessblower' || t.tag === '#productreview'), vac.tags)
check('"pet hair" on a vacuum is not hair care', !categoriesFor('Shark cordless vacuum with self-empty base, pet hair pickup', 3).some((c) => c.key === 'haircare') && !vac.tags.some((t) => /hair/.test(t.tag)), vac.tags)
check('an electric blanket is bedding, not single words', categoriesFor('Electric blanket heated throw', 1)[0]?.key === 'bedding' && pickHashtags({ platform: 'tiktok', text: 'Electric blanket heated throw, cosy nights' }).tags.every((t) => t.source !== 'keyword'))
check('whitening strips are oral care', categoriesFor('Crest whitening strips for yellow teeth', 1)[0]?.key === 'oral-care')

// ── Terrible tags on an e-bike Short (Seb, 2026-10-20: "we still have an
// issue with terrible hashtags", over "#dont #bicycle #mtb #fattireebikecommute") ──
check('a title\'s first word is not a brand ("Don\'t", "Why", "This", "Stop")', ["Don't buy a fat tire e-bike", 'Don’t buy this', 'Why I sold my car', 'This e-bike', 'Stop buying cheap bikes', "I'm done", 'Fat Tire Electric Bike'].every((t) => deriveBrandTag(t) === null))
check('a real maker still is, possessives too', deriveBrandTag('Jasion EB7 Fat Tire Electric Bike') === '#jasion' && deriveBrandTag('COSORI Pro LE') === '#cosori' && deriveBrandTag("L'Oreal Paris") === '#loreal')
check('#fattireebikecommute is four words run together', wordsInTag('#fattireebikecommute', new Set(['fat', 'tire', 'ebike', 'commute'])) === 4 && !!phraseProblem('#fattireebikecommute', new Set(['fat', 'tire', 'ebike', 'commute'])))
check('a real tag is not a phrase (#airfryerrecipes, #catsofinstagram, #contentcreator)', ['#airfryerrecipes', '#catsofinstagram', '#contentcreator', '#ebikelife'].every((t) => !phraseProblem(t, new Set(['air', 'fryer', 'cats', 'ebike']))))
const vt = "Don't Buy a Fat Tire E-Bike Until You See This"
const ebikeWriter = ['#dont', '#bicycle', '#mtb', '#fattireebikecommute']
check('an e-bike is an e-bike, not a car (its tire) or a pedal bike', categoriesFor(`${vt}\nfat tire ebike for my commute`, 2).map((c) => c.key).join() === 'ebike', categoriesFor(`${vt}\nfat tire ebike for my commute`, 2))
check('a car tire inflator is still a car thing', categoriesFor('Portable tire inflator for car tires, 150 PSI', 1)[0]?.key === 'auto')
for (const platform of ['instagram', 'tiktok', 'youtube_short'] as const) {
  // The video title passed as the brand, as some posts did.
  const eb = pickHashtags({ platform, text: `${vt}\nMy daily commute on a fat tire ebike`, brand: vt, writer: ebikeWriter })
  const got = eb.tags.map((t) => t.tag)
  check(`${platform}: the e-bike Short gets e-bike tags`, got.includes('#ebike') || got.includes('#electricbike'), got)
  check(`${platform}: never #dont, #mtb or a run-together phrase`, !got.some((t) => ['#dont', '#mtb', '#fattireebikecommute', '#tire', '#caressentials'].includes(t)), got)
  check(`${platform}: the phrase is dropped and says why`, eb.dropped.some((d) => d.tag === '#fattireebikecommute' && /nobody searches/.test(d.why)), eb.dropped)
}
const withMaker = pickHashtags({ platform: 'instagram', text: `Jasion EB7 Fat Tire Electric Bike for Adults\n${vt}`, brand: 'Jasion EB7 Fat Tire Electric Bike for Adults', writer: ebikeWriter })
check('with the product known, its maker leads', withMaker.tags[0]?.tag === '#jasion' && withMaker.tags.length >= 3, withMaker.tags)
check('a video title is never passed as the brand of a caption', /brand: input\.product\?\.title \|\| null,/.test(read('lib/direct-caption.ts')) && !/brand: input\.product\?\.title \|\| input\.videoTitle/.test(read('lib/direct-caption.ts')))

// ── What the platforms themselves say ────────────────────────────────────────
check('standing: Instagram under 2K posts is a dead end, over 300M a crowd', trendStanding({ source: 'instagram', posts: 1500 }) === 'dead' && trendStanding({ source: 'instagram', posts: 4e8 }) === 'crowd' && trendStanding({ source: 'instagram', posts: 4e6 }) === 'active')
check('standing: no count is unknown, never dead', trendStanding({ source: 'instagram', posts: null }) === 'unknown' && trendStanding({ source: 'youtube', posts: null }) === 'unknown')
check('standing: TikTok Creative Center is trending by definition', trendStanding({ source: 'tiktok_cc', posts: null }) === 'active')
const dead = pickHashtags({ platform: 'instagram', ...air, trends: [{ tag: '#kitchenessentials', source: 'instagram', posts: 500 }, { tag: '#cosori', source: 'instagram', posts: 900 }] })
check('a tag Instagram shows almost nobody using is dropped, with the count', !dead.tags.some((t) => t.tag === '#kitchenessentials') && dead.dropped.some((d) => d.tag === '#kitchenessentials' && /500/.test(d.why)), dead)
check('the brand tag stays even when small (brand tags are)', dead.tags[0]?.tag === '#cosori', dead.tags)
check('the pick is still full after a dead tag is dropped', dead.tags.length >= 3, dead.tags)

// ── Picked by what the platforms vouch for (Seb, 2026-10-16: "it means
// nothing if MVP is not really honing in onto using the appropriate, correct,
// and most viral hashtag") ──
check('the busy middle beats unchecked, unchecked beats a crowd, a dead end is never used', sizeScore({ source: 'instagram', posts: 500_000 }) > sizeScore(null) && sizeScore(null) > sizeScore({ source: 'instagram', posts: 4e8 }) && sizeScore({ source: 'instagram', posts: 300 }) < 0 && sizeScore({ source: 'tiktok_cc', posts: null, rank: 1 }) > sizeScore({ source: 'instagram', posts: 500_000 }))
const igReal = [['#hairdryer', 558e3], ['#hairtips', 2.2e6], ['#haircare', 30.9e6], ['#dreamegleam', 173]].map(([tag, posts]) => ({ tag: tag as string, source: 'instagram', posts: posts as number, label: `on Instagram: ${posts} posts` }))
const dryer = pickHashtags({ platform: 'instagram', text: 'Dreame Gleam hair dryer, high speed blow dryer with ionic care for fast drying hair', brand: 'Dreame Gleam', trends: igReal })
check('a hair dryer gets the tags Instagram vouches for', dryer.tags.some((t) => t.tag === '#hairdryer') && dryer.tags.some((t) => t.tag === '#hairtips') && !dryer.tags.some((t) => t.tag === '#dreamegleam'), dryer.tags)
check('a count Instagram showed is never called Trending', dryer.tags.every((t) => t.source !== 'trend') && dryer.tags.some((t) => t.source === 'measured') && /on Instagram/.test(dryer.tags.find((t) => t.tag === '#hairdryer')?.why || ''), dryer.tags)
check('Checked on the platform has its words', SOURCE_WORDS.measured === 'Checked on the platform')
const deadCat = pickHashtags({ platform: 'instagram', ...air, trends: [{ tag: '#kitchenessentials', source: 'instagram', posts: 500 }] })
check('a dead category tag is said in dropped, with its count', deadCat.dropped.some((d) => d.tag === '#kitchenessentials' && /500/.test(d.why)) && !deadCat.tags.some((t) => t.tag === '#kitchenessentials'), deadCat)

// ── Every generator reads the research, not only the map ──
const PLAN = read('lib/shorts-planner.ts')
check('Clip Factory\u2019s planner loads the research once, from TikTok, Shorts and Reels', /const tagInfo = await tagData\(\{ platforms: \['tiktok', 'youtube_short', 'instagram'\], userId: opts\.telemetry\?\.userId \?\? null/.test(PLAN) && /\.\.\.tagInfo,\n\s*\}\)\.tags\.map/.test(PLAN))
for (const [f, plat] of [['threads-post', 'threads'], ['twitter-post', 'x'], ['bluesky-post', 'bluesky'], ['telegram-post', 'telegram'], ['linkedin-post', 'linkedin']] as const) {
  const src = read(`app/api/blog/${f}/route.ts`)
  check(`${f}: the engine picks the tags of what the model wrote, never of what the creator typed`, new RegExp(`\\.text[^\\n]*\\n(?:\\s*//[^\\n]*\\n)*\\s*\\w+ = \\(await researchedTags\\(\\w+, \\{ platform: '${plat}'`).test(src) && (src.match(/researchedTags\(/g) || []).length === 1)
}
const DATA = read('lib/hashtag-data.ts')
check('the post goes as written if the research fails, and the safety net still runs', /export async function researchedTags[\s\S]{0,1200}\} catch \{\n\s*return \{ text, pick: null \}/.test(DATA))
const SUM = read('app/api/pulse/summary/route.ts')
check('Pulse shows, per platform, how many posted tags had a live reading and any dead ends', /research: await researchOf\(p\.key\)/.test(SUM) && /if \(!r\.posted_at \|\| r\.posted_at < RESEARCH_LIVE_AT\) continue/.test(SUM) && /tags MVP posted here had a live reading from/.test(read('components/pulse/PulsePanel.tsx')))

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
