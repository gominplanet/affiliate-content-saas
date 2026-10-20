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
import { pickHashtags, fitHashtags, TAG_RULES, trendStanding, tagProblem, SOURCE_WORDS, madeOfContent, contentWords, sizeScore, wordsInTag, phraseProblem, sizeWords, SWEET_SPOT } from '../lib/hashtag-engine'
import { categoriesFor, deriveBrandTag } from '../lib/hashtag-map'
import { suggestionSeeds, tagsFromSearches, tagCandidates, researchTags, splitCounts, RESEARCH_MAX_READS } from '../lib/hashtag-research'

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

// ── 10K to 200K, found and counted live (Seb, 2026-10-20: "Do we actually go
// online to find and pick the winning hashtags? ... I love a hashtag that is
// anywhere between 10,000 and 200,000 ... way better than a hashtag like the
// word bike") ──
check('the sweet spot is 10K to 200K posts', SWEET_SPOT.min === 10_000 && SWEET_SPOT.max === 200_000)
check('in range beats around it, beats big, beats a guess, beats a crowd', sizeScore({ source: 'youtube', posts: 49_000 }) > sizeScore({ source: 'youtube', posts: 289_000 }) && sizeScore({ source: 'youtube', posts: 289_000 }) > sizeScore({ source: 'youtube', posts: 2_800_000 }) && sizeScore({ source: 'youtube', posts: 2_800_000 }) > sizeScore(null) && sizeScore(null) > sizeScore({ source: 'youtube', posts: 10_000_000 }))
// Counted live on YouTube for an e-bike, 2026-10-20.
const ytBike = ([['#ebike', 1e6], ['#ebikelife', 49e3], ['#electricbikes', 27e3], ['#ebikes', 86e3], ['#electricbike', 289e3], ['#ebikereview', 9400], ['#ebikecommute', 409], ['#bike', 1e7], ['#cycling', 2e6], ['#jasion', 1000]] as const).map(([tag, posts]) => ({ tag, source: 'youtube', posts, label: `on YouTube: ${posts} videos` }))
const bikeText = `Jasion EB7 Fat Tire Electric Bike for Adults, 750W Motor\n${vt}`
const short = pickHashtags({ platform: 'youtube_short', text: bikeText, brand: 'Jasion EB7 Fat Tire Electric Bike', writer: ['#bike', '#fattireebikecommute'], found: ['#ebikelife', '#electricbikes', '#ebikes', '#ebikereview'], trends: ytBike })
const shortTags = short.tags.map((t) => t.tag)
check('a Short leads with the brand, then tags YouTube counted at 10K to 200K', shortTags[0] === '#jasion' && ['#ebikelife', '#electricbikes', '#ebikes'].every((t) => shortTags.includes(t)) && short.tags.filter((t) => t.source === 'measured').length >= 3, short.tags)
const pedal = pickHashtags({ platform: 'youtube_short', text: 'A bike for the city, light and quick', writer: ['#bike'], trends: [{ tag: '#bike', source: 'youtube', posts: 1e7, label: 'on YouTube: 10M videos' }] })
check('#bike (10M) is never used while there is room for better, and is said to be a crowd', !shortTags.includes('#bike') && !pedal.tags.some((t) => t.tag === '#bike') && pedal.tags.length >= 3 && pedal.dropped.some((d) => d.tag === '#bike' && /crowd/.test(d.why)), pedal)
check('the huge "for reach" tag is gone unless counted in range', !shortTags.includes('#cycling'), shortTags)
check('every measured pick says its count', short.tags.filter((t) => t.source === 'measured').every((t) => /on YouTube: \d+ videos/.test(t.why)), short.tags)
const igBike = pickHashtags({ platform: 'instagram', text: bikeText, brand: 'Jasion EB7 Fat Tire Electric Bike', found: ['#ebikelife', '#ebikes'], elsewhere: ytBike.map((r) => ({ ...r, platform: 'youtube' })) })
check('with no Instagram count, YouTube\'s guides the pick and is said as such', igBike.tags.some((t) => t.tag === '#ebikelife' && /on YouTube.*not counted on Instagram yet/.test(t.why)) && !igBike.tags.some((t) => t.tag === '#bike'), igBike.tags)
check('a tag nobody counted is never called measured', pickHashtags({ platform: 'instagram', ...air }).tags.every((t) => t.source !== 'measured'))
const noCount = pickHashtags({ platform: 'tiktok', text: bikeText, brand: 'Jasion EB7', found: ['#ebikesetup'] })
check('a found tag nobody counted is not used on its own say', !noCount.tags.some((t) => t.tag === '#ebikesetup'), noCount.tags)

check('YouTube is asked about the product, never a video title', suggestionSeeds(bikeText, 'Jasion EB7 Fat Tire Electric Bike for Adults').includes('fat tire') && !suggestionSeeds(vt, null).some((x) => /dont|buy|until/.test(x)), [suggestionSeeds(bikeText, 'Jasion EB7 Fat Tire Electric Bike for Adults'), suggestionSeeds(vt, null)])
check('a search that reads as a tag becomes one, a sentence does not', JSON.stringify(tagsFromSearches(['fat tire ebike', 'electric bike for adults', 'fat tire ebike hitch rack', 'ebike 2026'])) === JSON.stringify(['#fattireebike']), tagsFromSearches(['fat tire ebike', 'electric bike for adults', 'fat tire ebike hitch rack', 'ebike 2026']))
const cands = tagCandidates({ text: bikeText, brand: 'Jasion EB7 Fat Tire Electric Bike', writer: ['#fattireebikecommute', '#halloween'], searches: ['fat tire ebike'] })
check('the forms people tag a product with are all counted', ['#jasion', '#electricbike', '#electricbikes', '#electricbikelife', '#electricbikereview', '#ebikelife', '#fattireebike'].every((t) => cands.includes(t)) && !cands.includes('#halloween'), cands)

const rq = (data: unknown[] = []) => { const q: Record<string, unknown> = {}; for (const k of ['select', 'in', 'gte', 'eq', 'order']) q[k] = () => q; q.limit = () => Promise.resolve({ data }); q.upsert = (rows: unknown) => { saved.push(rows); return Promise.resolve({ error: null }) }; return q }
const saved: unknown[] = []
const fakeAdmin = { from: () => rq([{ platform: 'youtube', tag: '#ebikes', source: 'youtube', posts: 86000, seen_at: new Date().toISOString() }]) }
const asked: string[] = []
;(async () => {
  const live = await researchTags(fakeAdmin, { text: bikeText, brand: 'Jasion EB7 Fat Tire Electric Bike' }, {
    suggest: async () => ['fat tire ebike'],
    read: async (t: string) => { asked.push(t); return t === '#ebikelife' ? { platform: 'youtube', tag: t, source: 'youtube', posts: 49000, label: 'on YouTube: 49K videos' } : null },
  })
  check('research counts on YouTube only what nobody counted this week, at most 16', !asked.includes('#ebikes') && asked.length > 0 && asked.length <= RESEARCH_MAX_READS, asked)
  check('a tag YouTube did not answer for is never taken as zero', live.counts.every((c) => typeof c.posts === 'number') && live.read === 1, live.counts)
  check('what was counted is kept for everyone, and Instagram is asked for', saved.length >= 2, saved.length)
  check('the fresh count reaches the pick', splitCounts(live.counts, 'youtube').own.some((t) => t.tag === '#ebikelife' && t.posts === 49000))
  const t0 = Date.now()
  await researchTags(fakeAdmin, { text: bikeText }, { budgetMs: 600, suggest: async () => [], read: () => new Promise((r) => setTimeout(() => r(null), 5000)) })
  check('research never holds a caption past its time', Date.now() - t0 < 2500, Date.now() - t0)

  check('the size words: in range, crowded, another platform, nobody', sizeWords([{ platform: 'youtube', source: 'youtube', posts: 49000 }], 'youtube_short').tone === 'sweet' && sizeWords([{ platform: 'youtube', source: 'youtube', posts: 1e7 }], 'tiktok').tone === 'crowd' && /on YouTube/.test(sizeWords([{ platform: 'youtube', source: 'youtube', posts: 49000 }], 'instagram').text) && sizeWords([], 'instagram').text === 'not counted yet')

  // Wiring.
  const DATA2 = read('lib/hashtag-data.ts')
  check('every caption is researched live unless a caller says not', /input\.live === false \? Promise\.resolve\(null\) : liveResearch\(input\)/.test(DATA2) && /found: \[\.\.\.\(input\.found \|\| \[\]\), \.\.\.\(research\?\.candidates \|\| \[\]\)\]/.test(DATA2))
  check('Clip Factory researches once per video', /liveResearch\(\{ text: opts\.text, niches: opts\.niches \}\)/.test(DATA2))
  const SHELL = read('components/layout/DashboardShellV2.tsx')
  const READER = read('components/scout/InstagramTagReader.tsx')
  check('Instagram counts are read in the background, quietly, only by SCOUT 1.53.6', /<InstagramTagReader \/>/.test(SHELL) && /\{ quiet: true \}/.test(READER) && /SCOUT_IG_QUIET_MIN_VERSION/.test(READER) && /requestHashtagAccess\(false\)/.test(READER) && !/requestHashtagAccess\(true\)/.test(READER))
  const BG2 = read('extension/background.js')
  const igQuiet = BG2.slice(BG2.indexOf('async function igOwnTab('), BG2.indexOf('async function hashtagInstagram('))
  const igRead = BG2.slice(BG2.indexOf('async function hashtagInstagram('), BG2.indexOf('async function hashtagInstagram(') + 1800)
  check('the quiet read never opens, reloads or closes a tab', igQuiet.length > 100 && !/openWorkTab|tabs\.create|tabs\.reload|windows\.create/.test(igQuiet) && /if \(quiet\) \{\s*tabId = await igOwnTab\(\)\s*if \(tabId == null\) return \{ ok: false, error: 'no-tab' \}/.test(igRead) && /if \(opened && tabId != null\)/.test(igRead))
  check('the Instagram queue is read from what captions asked for', /from\('hashtag_wanted'\)/.test(read('app/api/hashtags/trends/route.ts')) && /create table if not exists public\.hashtag_wanted/.test(read('supabase/migrations/448_hashtag_wanted.sql')))
  check('the sizes show beside the captions creators edit', ['components/TikTokDirectModal.tsx', 'components/InstagramDirectModal.tsx', 'components/clip-factory/PublishPanel.tsx'].every((f) => /<TagCounts text=\{/.test(read(f))))
  check('there is always something to count on Instagram, before any caption asks', /for \(const t of allCategoryTags\(\)\)/.test(read('app/api/hashtags/trends/route.ts')) && /return n\.error \|\| !n\.counted \? NO_TAB_MS : EVERY_MS/.test(READER))
  check('the card\'s own Instagram button reads quietly too, and says when SCOUT is too old for it', /requestInstagramTagCounts\(tags\.map\(\(t\) => t\.replace\(\/\^#\/, ''\)\), \{ quiet \}\)/.test(read('components/pulse/HashtagTrends.tsx')) && /needs SCOUT \{SCOUT_IG_QUIET_MIN_VERSION\}/.test(read('components/pulse/HashtagTrends.tsx')))
  check('the background read says how it went on the Live hashtag data card', /lastIgRead\(\)/.test(read('components/pulse/HashtagTrends.tsx')) && /'no-tab':/.test(read('components/pulse/HashtagTrends.tsx')))

  if (fails.length) { console.error('hashtag-engine failed:\n - ' + fails.join('\n - ')); process.exit(1) }
  console.log('✅ hashtag-engine: one pick for every platform (Instagram 5 with #ad, Threads 1, YouTube up to 15), every post researched and counted live, 10K to 200K first and no crowds, trends only when about the post, dead tags dropped, every post netted and tracked, SCOUT reads only')
})()

