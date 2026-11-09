// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MATCH MY TIKTOK (lib/tiktok-videos, lib/tiktok-match, lib/tiktok-library,
// lib/tiktok-video-list, SCOUT 1.59.0; Seb, 2026-11-09: TrybeDaily "can scan
// user's tiktok accounts and retrieve their videos and match them to brands
// and products on trybe.. possible?"; "build both, but we're going to use
// Scout to start since I don't have the permission"). Held on the traps:
//
//   - a reviewer with no TikTok Shop tags is still matched (TrybeDaily read
//     Seb's 116 videos and matched 0), by @tags and the caption
//   - an everyday-word brand ("Glow") is never a match on its name alone
//   - TikTok's answers are read on MVP's server, nothing guessed: a missing
//     view count is null, never 0, and a place anchor is not a product
//   - MVP never asks TikTok for video.list before the switch is on (asking
//     for an unapproved scope breaks posting for everyone)
//   - SCOUT keeps only the profile's own grid, never solves a puzzle, says
//     how a scan ended, and its version moves in lockstep
//   - the page says how the scan ended, not just "0 brands matched"
import { readFileSync } from 'node:fs'
import { cleanHandle, captionTags, parseWebItem, parseOfficialVideo, productTags, itemsOfBody, cleanProfile, withProductCount, type TikTokVideo } from '../lib/tiktok-videos'
import { buildIndex, matchVideos, nameIsDistinct, brandName, productKey, isMatch, filmedLine, withFilmedLine, type MatchBrand } from '../lib/tiktok-match'
import { tiktokScopes, videoListSwitchOn, scopesIncludeVideoList, readVideoList } from '../lib/tiktok-video-list'
import { filterCheck, readFilters, anyFilterOn } from '../lib/trybe-finder'
import { PRESETS } from '../components/labs/TrybeFinderControls'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

// ── HANDLES AND CAPTIONS ──
check('a handle is read as typed, with an @, or from a profile link', cleanHandle('@GominReviews') === 'gominreviews' && cleanHandle('https://www.tiktok.com/@gomin.reviews?lang=en') === 'gomin.reviews' && cleanHandle('gominreviews') === 'gominreviews')
check('something that is not a handle is refused', cleanHandle('not a handle!') === null && cleanHandle('@') === null && cleanHandle('a') === null)
{
  const t = captionTags('Loving my #NinjaCreami from @ninjakitchen! email me@x.com #ad')
  check('hashtags and @tags are read from a caption, an email is not a tag', t.hashtags.join() === 'ninjacreami,ad' && t.mentions.join() === 'ninjakitchen')
}

// ── TIKTOK'S OWN ANSWERS, READ ON THE SERVER ──
const item = {
  id: '7300000000000000001', desc: 'The best ice cream maker #ninjacreami @ninjakitchen', createTime: 1730000000,
  author: { uniqueId: 'gominreviews' }, stats: { playCount: 15400, diggCount: 900 }, video: { cover: 'https://p16.tiktokcdn.com/cover.jpg', duration: 42 },
  textExtra: [{ hashtagName: 'ninjacreami' }, { userUniqueId: 'ninjakitchen' }],
  anchors: [{ id: '1', type: 33, keyword: 'Ninja CREAMi Ice Cream Maker', extra: JSON.stringify({ product_id: '1729000', shop_name: 'Ninja Kitchen' }) }],
}
const v = parseWebItem(item, 'gominreviews')!
check('a video from the profile page is read whole: link, caption, tags, date, views, cover', !!v && v.url === 'https://www.tiktok.com/@gominreviews/video/7300000000000000001' && v.hashtags.includes('ninjacreami') && v.mentions.includes('ninjakitchen') && v.views === 15400 && v.likes === 900 && v.postedAt === new Date(1730000000 * 1000).toISOString() && v.cover === 'https://p16.tiktokcdn.com/cover.jpg' && v.duration === 42)
check('its TikTok Shop tag is read with the product and the shop', v.products.length === 1 && v.products[0].id === '1729000' && v.products[0].title === 'Ninja CREAMi Ice Cream Maker' && v.products[0].shop === 'Ninja Kitchen')
check('a view count TikTok did not send is not known, never 0', parseWebItem({ ...item, stats: undefined }, 'gominreviews')!.views === null)
check('a place or effect anchor is not a product', productTags({ anchors: [{ id: '9', type: 1, keyword: 'Los Angeles, California' }] }).length === 0)
check('a video without an id TikTok would use is dropped', parseWebItem({ ...item, id: 'abc' }, 'x') === null)
check('the answers’ item list is found as TikTok sends it', itemsOfBody({ itemList: [item], hasMore: true }).length === 1)
check('with a product counts only videos that carry a tag', withProductCount([v, { ...v, products: [] }]) === 1)
{
  const o = parseOfficialVideo({ id: '7300000000000000002', title: 'Unboxing', video_description: 'Unboxing the Dyson Airwrap #dyson', create_time: 1731000000, share_url: 'https://www.tiktok.com/@gominreviews/video/7300000000000000002', view_count: 200, cover_image_url: 'https://p16/c.jpg' }, 'gominreviews')!
  check('a video from the official API is read into the same shape, with no product tags', o.caption.includes('Dyson Airwrap') && o.hashtags.includes('dyson') && o.views === 200 && o.products.length === 0)
}
check('the profile is kept only as far as it is sure', cleanProfile({ name: 'Gomin Reviews', videoCount: 116, avatar: 'javascript:alert(1)' }, 'gominreviews').avatar === null && cleanProfile({ videoCount: 116 }, 'g').videoCount === 116)

// ── MATCHING ──
const brands: MatchBrand[] = [
  { id: 'b-ninja', name: 'Ninja Kitchen', tiktokHandle: 'ninjakitchen', products: ['Ninja CREAMi Ice Cream Maker 7 in 1'] },
  { id: 'b-glow', name: 'Glow' },
  { id: 'b-lumi', name: 'Lumineux Oral Essentials Inc', products: ['Lumineux Teeth Whitening Strips 21 Treatments'] },
  { id: 'b-arc', name: 'Arcadia Sleep Co', tiktokHandle: 'arcadiasleep' },
  { id: 'b-bee', name: 'BeeBright' },
]
const idx = buildIndex(brands)
const mk = (id: string, caption: string, extra: Partial<TikTokVideo> = {}): TikTokVideo => ({ id, url: `https://www.tiktok.com/@me/video/${id}`, caption, ...captionTags(caption), postedAt: '2026-11-01T00:00:00Z', views: null, likes: null, cover: null, duration: null, products: [], ...extra })
{
  // Seb's case: reviews with no TikTok Shop tags at all.
  const videos = [
    mk('1', 'Is this worth it? Lumineux teeth whitening strips 21 treatments honest review'),
    mk('2', 'My new pillow from @arcadiasleep is unreal'),
    mk('3', 'Morning routine glow up with my favorite serum'),
    mk('4', '#beebright night light for the kids room'),
  ]
  const m = matchVideos(videos, idx)
  const by = new Map(m.map((x) => [x.brandId, x]))
  check('a reviewer with no TikTok Shop tags is still matched (TrybeDaily matched 0 of 116)', m.filter(isMatch).length >= 3)
  check('an @tag of the brand’s own account is sure, and says so', by.get('b-arc')?.sureness === 'sure' && /tags @arcadiasleep, the brand’s TikTok account/.test(by.get('b-arc')!.how[0].text))
  check('a product named in the caption is likely, with the product quoted', by.get('b-lumi')?.sureness === 'likely' && by.get('b-lumi')!.how.some((h) => h.kind === 'product'))
  check('a hashtag that is a distinct brand name run together is likely', by.get('b-bee')?.sureness === 'likely' && by.get('b-bee')!.how[0].kind === 'hashtag')
  check('an everyday-word brand ("Glow") is never a match on its name alone', !by.get('b-glow') || by.get('b-glow')!.sureness === 'maybe')
}
{
  const m = matchVideos([mk('5', 'Dessert time', { products: [{ id: '1', title: 'CREAMi Deluxe', shop: 'Ninja Kitchen' }] })], idx)
  check('a TikTok Shop tag naming the brand’s shop is sure', m[0]?.brandId === 'b-ninja' && m[0].sureness === 'sure' && m[0].how[0].kind === 'product_tag')
}
{
  const m = matchVideos([mk('6', 'glow serum #glow'), mk('7', 'My Glow routine')], idx)
  check('an everyday name in two videos is still only a maybe', m.every((x) => x.brandId !== 'b-glow' || x.sureness === 'maybe'))
}
// SEB'S FIRST REAL SCAN (2026-11-09: "so many are wrong"): everyday words
// matched as brands. Each of these captions is from his videos.
{
  const real: MatchBrand[] = [
    { id: 'goodbye', name: 'The Goodbye Company' }, { id: 'volume', name: 'Volume' }, { id: 'needed', name: 'Needed' },
    { id: 'nights', name: 'Nights' }, { id: 'boost', name: 'Boost' }, { id: 'ninja', name: 'Ninja Kitchen' },
  ]
  const ix = buildIndex(real)
  const caps = [
    'Why settle for less? Our Stainless Steel Lemon Squeezer is built for maximum juice. Say goodbye to hand cramps and wasted juice.',
    'Michelle said she didn\u2019t think she needed these until she tried them on camera. The Atom One amplifies everyday sounds, no more turning up the volume.',
    'Volume for days! This hot brush works like a charm for sleepless nights and lazy mornings',
    'Charge on the go! A tiny power bank to boost your phone',
    'Vaginal health is a thing? #boost #needed #nights',
  ]
  const m = matchVideos(caps.map((c, i) => mk(`r${i}`, c)), ix)
  check('everyday words in a caption are not brands: The Goodbye Company, Volume, Needed, Nights and Boost all stay out of the matches', m.filter(isMatch).length === 0)
  check('lowercase everyday words are not even listed as possible', !m.some((x) => x.brandId === 'needed' || x.brandId === 'boost' || x.brandId === 'goodbye'))
  check('"say goodbye" is never The Goodbye Company', !m.some((x) => x.brandId === 'goodbye'))
  const g = matchVideos([mk('g1', 'Unboxing from The Goodbye Company, finally a squeezer that works')], ix)
  check('The Goodbye Company written as its name is a match', g[0]?.brandId === 'goodbye' && g[0].sureness === 'likely')
  const n = matchVideos([mk('n1', 'My Ninja Kitchen blender after a month'), mk('n2', 'ninja kitchen hacks for busy nights')], ix)
  check('an all-everyday name counts written as a name, lowercase it is only possible', n[0]?.brandId === 'ninja' && n[0].sureness === 'likely' && n[0].how.some((h) => /as a name/.test(h.text)))
  const rep2 = matchVideos([mk('a', 'Testing Lumineux strips'), mk('b', 'Lumineux day 7'), mk('c', 'Lumineux results')], buildIndex([{ id: 'lumi', name: 'Lumineux' }]))
  check('the same words from several videos are one line with a count', rep2[0].how.length === 1 && rep2[0].how[0].count === 3 && rep2[0].videoIds.length === 3)
}
check('company words are not part of the name a caption says', brandName('Lumineux Oral Essentials Inc') === 'lumineux oral essentials' && brandName('The Arcadia Sleep Co') === 'arcadia sleep')
check('a short or everyday name is not distinct; a name no dictionary has is', !nameIsDistinct('Glow') && !nameIsDistinct('Zap') && !nameIsDistinct('Pure Glow') && !nameIsDistinct('Volume') && !nameIsDistinct('The Goodbye Company') && nameIsDistinct('Lumineux') && nameIsDistinct('Olaplex'))
check('a product name too short or too generic to be safe is not matched', productKey('Ice Cream') === null && productKey('Stainless Steel Lemon Squeezer') === null && productKey('Ninja CREAMi Ice Cream Maker 7 in 1') === 'ninja creami ice cream maker 7')
{
  const many: MatchBrand[] = Array.from({ length: 8000 }, (_, i) => ({ id: `x${i}`, name: `Brandname ${i} Labs`, products: [`Product line number ${i} deluxe edition`] }))
  const t0 = Date.now()
  const big = buildIndex([...many, ...brands])
  const vids = Array.from({ length: 1000 }, (_, i) => mk(String(i), `Review number ${i} of something great #review @someone`))
  matchVideos(vids, big)
  check('8,000 brands against 1,000 videos is matched in well under the time a request has', Date.now() - t0 < 8000)
}

// ── FIND BRANDS ──
check('Filmed on TikTok is a filter that a brand Match my TikTok did not match fails, counted apart', (() => { const f = readFilters({ filmed: true }); const r = filterCheck({ perVideo: null, creators: null, stats: { paidOut: null, videosApproved: null, videos30d: null, samples: null } as never, earningsBucket: null, amazon: null, amazonUnknown: false, starred: false, crowd: null }, f); return anyFilterOn(f) && !r.pass && r.blank.includes('filmed') })())
check('You filmed on TikTok is a quick list', PRESETS.some((p) => p.id === 'filmed' && p.filters.filmed === true))
const R = read('app/api/labs/trybe/route.ts')
check('Find brands adds the filmed brands directly under the filter, and marks each card', /filmedBrandIds\(admin, ownerId\)/.test(R) && /filmed: filmedBy\.has\(x\.r\.brand_id\)/.test(R) && /filmed: filmedBy\.get\(r\.brand_id\) \?\? null/.test(R))
check('each card wears the Filmed on TikTok chip', /<FilmedChip filmed=\{b\.filmed\} \/>/.test(read('components/labs/TrybeOutreach.tsx')))

// ── RIGHT FROM THE MATCH: REQUEST AND SCRIPTS (Seb, 2026-11-09: "is there a
// direct way right there to request partnership with the brand and then also
// create scripts all from there?") ──
{
  const url = 'https://www.tiktok.com/@gominreviews/video/7300000000000000001'
  const line = filmedLine({ core: 'Hi! I review kitchen gear for 40K followers.', url, product: 'Ninja CREAMi Deluxe $199.99', brand: 'Ninja Kitchen' })
  check('a request to a brand you filmed names your TikTok video of it, in your voice, never a price', line === `I already made a TikTok video featuring your Ninja CREAMi Deluxe: ${url}`)
  check('a team writes we', /^We already made/.test(filmedLine({ core: 'We are a couple who review home finds.', url, brand: 'Arcadia' }) || ''))
  check('no TikTok video address, no line', filmedLine({ core: 'x', url: 'https://example.com/v/1', brand: 'B' }) === null)
  const draft = 'Hi Ninja Kitchen, so glad to have found you here.\n\nI review kitchen gear.\n\nSpeak soon,\nSeb'
  const out = withFilmedLine(draft, line)
  check('the line goes right after the greeting, and the rest is kept as written', out.split('\n\n')[1] === line && out.endsWith('Speak soon,\nSeb') && out.startsWith('Hi Ninja Kitchen'))
  check('it is never added twice', withFilmedLine(out, line) === out)
  const R2 = read('app/api/labs/trybe/route.ts')
  check('the request writer adds it for matched brands only, after the pay check', /const filmedFor = await filmedVideos\(admin, ownerId, ids\)/.test(R2) && /if \(fv\) text = withFilmedLine\(text, filmedLine\(/.test(R2) && R2.indexOf('withFilmedLine(text') < R2.indexOf('const lastHit = termsHit(text)'))
  const P2 = read('components/labs/TrybeTikTokMatch.tsx')
  check('each match has Request partnership, then Send request now and a way to read it first, and Write scripts', /Request partnership/.test(P2) && /Send request now/.test(P2) && /Read it first in Ready to send/.test(P2) && /Write scripts/.test(P2))
  check('a request already gone shows where it stands instead of a second request', /\{!gone && !drafted && \(/.test(P2))
  check('sending says why it cannot start, never a dead button', /title=\{actions\.sendBlocked \|\| /.test(P2) && /\{drafted && actions\.sendBlocked && <span/.test(P2))
  const O = read('components/labs/TrybeOutreach.tsx')
  check('the TRYBE page hands the card its send, its scripts and Ready to send', /onSend=\{peekActions \? \(id\) => peekActions\.send\(id\) : undefined\}/.test(O) && /onScripts=\{\(id, name, product\) => \{ setScriptsFor\(\{ id, name, product \}\); go\('create'\) \}\}/.test(O))
  const C = read('components/labs/TrybeCreate.tsx')
  check('before the brand accepts, Brand scripts offers scripts from its product in Video Scripts', /href=\{`\/video-scripts\?product=\$\{encodeURIComponent\(missProduct\)\}`\}/.test(C) && /get\('product'\)/.test(read('components/labs/ProductScripts.tsx')))
}

// ── THE OFFICIAL ROUTE, OFF UNTIL TIKTOK APPROVES ──
check('MVP never asks TikTok for video.list before the switch is on', !tiktokScopes({}).includes('video.list') && tiktokScopes({ TIKTOK_VIDEO_LIST: 'on' }).endsWith(',video.list') && !videoListSwitchOn({ TIKTOK_VIDEO_LIST: 'yes please' }))
check('posting scopes are always asked for', tiktokScopes({}) === 'user.info.basic,user.info.profile,video.upload,video.publish')
check('the connection asks for the scopes from the switch', /url\.searchParams\.set\('scope', tiktokScopes\(\)\)/.test(read('app/api/auth/tiktok/route.ts')))
check('a connection with the scope is told apart', scopesIncludeVideoList('user.info.basic,video.list') && !scopesIncludeVideoList('user.info.basic,video.publish'))
check('the daily cloud check does nothing until the switch is on', /if \(!videoListSwitchOn\(\)\) return NextResponse\.json\(\{ ok: true, skipped:/.test(read('app/api/cron/tiktok-library/route.ts')) && /"\/api\/cron\/tiktok-library"/.test(read('vercel.json')))
const listChecks = (async () => {
  let calls = 0
  const pages = [{ videos: [{ id: '7300000000000000010' }, { id: '7300000000000000011' }], cursor: 5, has_more: true }, { videos: [{ id: '7300000000000000012' }], cursor: 9, has_more: false }]
  const fake = (async () => { const p = pages[calls++]; return new Response(JSON.stringify({ data: p, error: { code: 'ok' } }), { status: 200 }) }) as unknown as typeof fetch
  const r = await readVideoList('t', 'me', { deadline: Date.now() + 5000, fetchImpl: fake })
  check('the official list is paged to its end and says it reached it', r.videos.length === 3 && r.reachedEnd && r.error === null)
  calls = 0
  const k = await readVideoList('t', 'me', { deadline: Date.now() + 5000, fetchImpl: fake, known: new Set(['7300000000000000010', '7300000000000000011']) })
  check('the daily check stops at the first page MVP already has', k.videos.length === 2 && !k.reachedEnd && k.pages === 1)
  const denied = (async () => new Response(JSON.stringify({ error: { code: 'scope_not_authorized', message: 'no' } }), { status: 401 })) as unknown as typeof fetch
  const d = await readVideoList('t', 'me', { deadline: Date.now() + 5000, fetchImpl: denied })
  check('a connection without the scope is said in words, never as zero videos', d.videos.length === 0 && /Connect TikTok again/.test(d.error || ''))
})()

// ── THE ROUTE ──
const A = read('app/api/labs/tiktok-library/route.ts')
check('the route exports only its handlers and config', (A.match(/^export /gm) || []).length === 4 && /export async function GET/.test(A) && /export async function POST/.test(A) && /export const runtime/.test(A) && /export const maxDuration/.test(A))
check('a hand-over for a scan that is no longer current is refused, so SCOUT stops', /lib\.scan_id !== body\.scanId \|\| lib\.scan_status !== 'running'\) return NextResponse\.json\(\{ ok: false, keep: false, error: 'stale-scan' \}\)/.test(A))
check('only the creator’s own videos are kept', /v\.url\.toLowerCase\(\)\.includes\(`\/@\$\{handle\}\/`\)/.test(A))
check('a scan that went silent is said as stopped, with why, never left running', /SILENT_MS/.test(A) && /SCOUT stopped answering partway/.test(A))
check('a missing migration is said as such', /Match my TikTok needs migration 465/.test(A))
const M = read('supabase/migrations/465_tiktok_library.sql')
check('the migration is safe to run twice and says so', /Safe to run twice/.test(M) && !/create table public\./.test(M) && (M.match(/create table if not exists/g) || []).length === 2 && /create index if not exists/.test(M))

// ── SCOUT ──
const B = read('extension/background.js')
const H = read('extension/tiktok-videos-hook.js')
const MF = JSON.parse(read('extension/manifest.json'))
check('SCOUT keeps only the profile’s own video grid, never liked, reposted or saved lists', /\\\/api\\\/\(post\|creator\)\\\/item_list\\\//.test(H) && !/repost|collect|favorite/i.test(H.split('const wanted')[1].split('\n')[0]))
check('tiktok.com is an optional permission, asked from its own window, so updating SCOUT disables nobody', MF.optional_host_permissions.includes('https://www.tiktok.com/*') && !MF.host_permissions.includes('https://www.tiktok.com/*') && /tiktok-allow\.html/.test(B))
check('SCOUT reads in its own minimized window, told it is on screen', /const tab = await openWorkTab\(`https:\/\/www\.tiktok\.com\/@\$\{encodeURIComponent\(job\.handle\)\}`\)/.test(B) && /quietTabIds\.add\(tabId\)\n\s*void quietShim\(tabId\)/.test(B))
check('a puzzle stops the scan and is said, never solved', /if \(read\.puzzle\) \{ error = TT_SAY\.puzzle; break \}/.test(B) && /it never answers those/.test(B))
check('SCOUT hands each batch to MVP itself, so the scan goes on with MVP’s tab closed', /\/api\/labs\/tiktok-library/.test(B) && /void ttScan\(\{ handle, scanId: String\(msg\.scanId\), origin \}\)/.test(B))
check('the end of every scan is handed over, with how it ended', /try \{ await hand\(\[\], null, true\) \} catch/.test(B) && /body\.reachedEnd = reachedEnd; if \(error\) body\.error = error/.test(B))
check('SCOUT and MVP agree on the version', MF.version === '1.60.1' && /SCOUT_LATEST_VERSION = '1\.60\.1'/.test(read('lib/scout-version.ts')) && /SCOUT_TIKTOK_LIBRARY_MIN_VERSION = '1\.59\.0'/.test(read('lib/scout-version.ts')) && /SCOUT_TIKTOK_DOWNLOAD_MIN_VERSION = '1\.60\.0'/.test(read('lib/scout-version.ts')))

// ── DOWNLOADS (Seb, 2026-11-09: "a download button for each video matched so
// users can then re-upload those to trybe") ──
{
  check('SCOUT saves a video from its own TikTok page in its own window, the page first, then Chrome’s downloads', /const tab = await openWorkTab\(`https:\/\/www\.tiktok\.com\/@\$\{encodeURIComponent\(h\)\}\/video\/\$\{encodeURIComponent\(id\)\}`\)/.test(B) && /const r = await trybeRun\(ttSaveInPage, \[c\.url, name\], tabId\)/.test(B) && /dlId = await chrome\.downloads\.download\(\{ url: c\.url, filename: name/.test(B))
  check('a download is reported done only when Chrome has the whole file', /if \(d\.state === 'complete'\) return \{ ok: true/.test(B) && /if \(d\.ok\) return \{ ok: true, way: 'page'/.test(B))
  check('a file too small to be a video is not kept as one', /blob\.size < 50000/.test(B) && /d\.bytes < 50000\) \{ tried\.push\(\{ from: c\.from, way: 'chrome', result: 'chrome-too-small' \}\); try \{ chrome\.downloads\.removeFile/.test(B))
  check('a puzzle or a private video is said, never a silent failure', /if \(found\.puzzle\) return \{ ok: false, error: 'puzzle' \}/.test(B) && /if \(found\.gone\) return \{ ok: false, error: 'gone' \}/.test(B))
  check('only the creator’s own handle and a video id are accepted', /if \(!\/\^\[a-z0-9_\.\]\{2,24\}\$\/\.test\(h\) \|\| !\/\^\\d\{6,30\}\$\/\.test\(id\)\) return \{ ok: false, error: 'bad-request' \}/.test(B))
  check('no new Chrome permission: downloads was already there', MF.permissions.includes('downloads'))
  // Seb's first try (2026-11-09) timed out with no reason given.
  check('Chrome’s own downloads go first: they never ask where to save, and are followed by their id', B.indexOf("way: 'chrome', result: d.ok ? 'ok' : d.error") < B.indexOf("way: 'page', result: d.ok ? 'ok' : d.error") && /saveAs: false/.test(B) && /async function ttFollowDownload\(id, deadline\)/.test(B))
  check('a stalled download is cancelled and every try has its own limit inside one deadline', /ttDropDownload\(id\); return \{ ok: false, error: last > 0 \? 'chrome-stalled' : 'chrome-no-answer' \}/.test(B) && /const deadline = Date\.now\(\) \+ TT_DL_MAX_MS/.test(B) && /setTimeout\(\(\) => stop\.abort\(\), 20000\)/.test(B))
  check('a failed download says which way failed and why, with its codes', /r\.error === 'not-saved' && tried \? `Not saved\. \$\{tried\}`/.test(read('components/labs/TrybeTikTokMatch.tsx')) && /TikTok refused to send the file \(Forbidden\)/.test(read('components/labs/TrybeTikTokMatch.tsx')))
  const P3 = read('components/labs/TrybeTikTokMatch.tsx')
  check('every video has Download, every brand Download all, and a saved file leads to TRYBE’s Upload', /'Download'\}/.test(P3) && /Download all \$\{m\.videoIds\.length\} videos/.test(P3) && /label: 'Upload to TRYBE', onClick: openUpload/.test(P3) && /onOpenUpload=\{\(\) => go\('upload'\)\}/.test(read('components/labs/TrybeOutreach.tsx')))
  check('a download that did not happen is said with why', /Saved to your Downloads: /.test(P3) && /DL_WORDS\[r\.error\]/.test(P3) && /Chrome updates SCOUT by itself within a day/.test(P3))
  check('a video is a link and a button side by side, never a button inside a link', !/<a [^>]*>[^]*?<button[^]*?<\/a>/.test(P3.slice(P3.indexOf('{vids.map((v) => ('), P3.indexOf('{m.videoIds.length > vids.length'))))
}

// ── THE PAGE ──
const P = read('components/labs/TrybeTikTokMatch.tsx')
check('the page says how a scan ended: to the end, TikTok stopped loading, stopped, or failed', /Read to the end of your videos/.test(P) && /TikTok stopped loading more after/.test(P) && /scan\.status === 'stopped'/.test(P) && /scan\.status === 'failed'/.test(P))
check('nothing matched is explained, never a bare 0', /None of your \{lib\.kept\.toLocaleString\(\)\} videos names a TRYBE brand/.test(P))
check('every TikTok link names TikTok', /Watch on TikTok/.test(P) && /on TikTok <ExternalLink/.test(P) && !/>\s*(Open|Watch|View)\s*</.test(P))
check('the time left is marked as an estimate', /\(estimate\)/.test(P))
check('it is in TRYBE’s Find brands menu', /\{ label: 'Match my TikTok', icon: ScanSearch, tabs: \['filmed'\] \}/.test(read('components/labs/TrybeNav.tsx')))
check('no em or en dashes in what members read', !/[–—]/.test(P.replace(/^\s*\/\/.*$/gm, '')) && !/[–—]/.test(read('extension/tiktok-allow.html')))

void listChecks.then(() => {
  if (fails.length) { console.error(`✗ ${fails.length} Match my TikTok check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
  console.log('✓ Match my TikTok: videos read on the server, matched with how MVP knows, everyday names kept apart, the official route off until approved, and every scan’s end said')
})
