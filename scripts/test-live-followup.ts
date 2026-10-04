// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AMAZON LIVE FOLLOW-UP: Pro, drafts only, and every step
// says what happened.
//
// Pinned here: the stream it reads, the clip windows it cuts, the captions'
// timing, the roundup text, the Labs gate, and that nothing in the follow-up
// posts anywhere by itself (the clips open in Clip Factory as drafts).
import { readFileSync } from 'node:fs'
import { pickStream, clampMoment, wordsInWindow, parseMoments, composeRoundup, CLIP_MAX_SEC, CLIP_MIN_SEC, cropXForFace, windowShare } from '../lib/live-followup'
import { canUsePreview } from '../lib/labs-preview'
import { parseLiveReplayHtml, broadcastIdOf, vttToWordCues } from '../lib/amazon-live-page'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const r = (p: string) => readFileSync(p, 'utf8')

check('the master playlist is read first', pickStream(['https://a/x.mp4', 'https://a/720p.m3u8', 'https://a/master.m3u8?t=1']) === 'https://a/master.m3u8?t=1')
check('any playlist beats an mp4', pickStream(['https://a/x.mp4', 'https://a/720p.m3u8']) === 'https://a/720p.m3u8')
check('an mp4 when there is no playlist', pickStream(['http://a/x.m3u8', 'https://a/x.mp4']) === 'https://a/x.mp4')
check('nothing usable is null', pickStream(['blob:https://a/1']) === null)

const long = clampMoment({ startSec: 100, endSec: 400 }, 3600)
check('a clip is never longer than the limit', !!long && long.endSec - long.startSec === CLIP_MAX_SEC)
const short = clampMoment({ startSec: 100, endSec: 104 }, 3600)
check('a clip is never shorter than the limit', !!short && short.endSec - short.startSec === CLIP_MIN_SEC)
const atEnd = clampMoment({ startSec: 3595, endSec: 3700 }, 3600)
check('a clip stays inside the replay', !!atEnd && atEnd.endSec === 3600 && atEnd.endSec - atEnd.startSec >= CLIP_MIN_SEC)
check('a moment past the end is dropped', clampMoment({ startSec: 4000, endSec: 4030 }, 3600) === null)

const words = wordsInWindow([{ start: 9, end: 10.2, text: 'a' }, { start: 10.5, end: 11, text: 'b' }, { start: 40, end: 41, text: 'c' }], 10, 30)
check('captions are timed from the clip start', words.length === 2 && words[1].startSec === 0.5 && words[1].text === 'b')

const products = [{ asin: 'B000000001', title: 'Air Fryer' }, { asin: 'B000000002', title: 'Robot Vacuum' }]
const parsed = parseMoments('ok {"moments":[{"asin":"B000000002","startSec":600,"endSec":650,"hook":"It found every crumb"},{"asin":"B0NOTASKED","startSec":1,"endSec":30},{"asin":"B000000001","startSec":120,"endSec":170,"hook":"x"}]}', products, 3600)
check('only products asked about are kept, in replay order', parsed.map((m) => m.asin).join(',') === 'B000000001,B000000002')
check('a garbled answer is no moments, not a crash', parseMoments('not json', products, 3600).length === 0)

const roundup = composeRoundup({ title: 'Kitchen finds', items: [{ title: 'Air Fryer, 6 Quart, Black', link: 'https://mvpl.ink/a' }, { title: 'Vacuum', link: null }], disclosure: 'As an Amazon Associate I earn from qualifying purchases.' })
check('the roundup lists linked products and ends with the disclosure', /Air Fryer, 6 Quart, Black: https:\/\/mvpl\.ink\/a/.test(roundup) && !/Vacuum/.test(roundup) && roundup.endsWith('qualifying purchases.'))
check('no dashes as sentence breaks in the roundup', !/ [–—-] /.test(roundup) && !/[–—]/.test(roundup))

check('open to Pro, not to lower plans', canUsePreview('live_followup', 'pro') && canUsePreview('live_followup', 'admin') && !canUsePreview('live_followup', 'trial'))
const nav = r('components/layout/DashboardShellV2.tsx')
check('the menu item follows the Pro switch', /href: '\/live-followup'[^\n]*gate: previewOpenToPro\('live_followup'\) \? isPro : isAdmin/.test(nav))

const route = r('app/api/live/followup/route.ts')
check('the route checks the Labs gate', /canUsePreview\('live_followup'/.test(route))
check('the follow-up never posts by itself', !/scheduled_posts|publishTo|tiktok|instagram_|facebook-reel|uploadVideo/i.test(route.replace(/channel: 'facebook'/g, '')))
check('a failed step is stored on the row', /const fail = async/.test(route) && /save\(\{ error \}\)/.test(route))
const server = r('lib/live-followup-server.ts')
check('clips are cut from the stream, never by downloading the whole replay', /stream: true/.test(server))

const ingest = r('ingest-service/server.js')
check('the video service reads audio from a stream', /app\.post\('\/stream-audio'/.test(ingest) && /assertPublicHttpUrl\(url\)/.test(ingest))
check('stream clips go through the SSRF guard', /fromStream\) \{\s*\n\s*await assertPublicHttpUrl\(url\)/.test(ingest))

const bg = r('extension/background.js')
check('SCOUT answers MVP_AMZ_LIVE_REPLAY', /msg\.type === 'MVP_AMZ_LIVE_REPLAY'/.test(bg) && /function readLiveReplay/.test(bg))
check('SCOUT only opens amazon.com/live pages for it', /not-a-live-page/.test(bg))
const frame = r('lib/extension-frame.ts')
check('MVP asks for SCOUT 1.22.1 before using it', /_cmpVersion\(st\.version, '1\.22\.1'\) < 0/.test(frame))

const cf = r('components/clip-factory/ClipFactory.tsx')
check('Clip Factory only takes a hand-over clip from MVP storage', /liveClip/.test(cf) && /storage\/v1\/object\/public\//.test(cf))

// THE REPLAY PAGE: the stream, Amazon's captions and the products shown are
// read from the page's own data (the player hides its stream from the page).
const BID = '29fd644a-515e-4b0c-bf99-843f287df62b'
const OTHER = '11111111-2222-3333-4444-555555555555'
const fixture = [
  '<title>Watch Weekend Shopping on Amazon Live</title>',
  '<script type="application/ld+json">{"@type":"VideoObject","name":"Watch Weekend Shopping on Amazon Live","contentUrl":"https://d1.cloudfront.net/' + BID + '_7Rt/hls/byte-range-multivariant.m3u8","duration":"PT54M28S"}</script>',
  '<div data-state="{&#034;broadcast&#034;:{&#034;carouselItems&#034;:[{&#034;type&#034;:&#034;PRODUCT&#034;,&#034;id&#034;:&#034;x1&#034;,&#034;asin&#034;:&#034;B0FK5MBDJZ&#034;},{&#034;type&#034;:&#034;PRODUCT&#034;,&#034;id&#034;:&#034;x2&#034;,&#034;asin&#034;:&#034;B0DPZVKV7V&#034;}],',
  '&#034;broadcastVariants&#034;:[{&#034;playbackUrl&#034;:&#034;https:\\/\\/d1.cloudfront.net\\/' + BID + '_7Rt\\/hls\\/byte-range-multivariant.m3u8&#034;,&#034;captionUrl&#034;:&#034;https:\\/\\/d9.cloudfront.net\\/' + BID + '_trimmed.vtt&#034;}],&#034;id&#034;:&#034;' + BID + '&#034;}}"></div>',
  '<div data-x="{&#034;carouselItems&#034;:[{&#034;type&#034;:&#034;PRODUCT&#034;,&#034;asin&#034;:&#034;B000OTHER1&#034;}],&#034;id&#034;:&#034;' + OTHER + '&#034;}"></div>',
].join('\n')
const page = parseLiveReplayHtml(fixture, BID)
check('the broadcast id comes from the link', broadcastIdOf(`https://www.amazon.com/live/broadcast/${BID}?ref_=x`) === BID)
check('the stream is the page\'s contentUrl for this Live', page.streamUrl === `https://d1.cloudfront.net/${BID}_7Rt/hls/byte-range-multivariant.m3u8`)
check('Amazon\'s captions for that same stream are found', page.captionUrl === `https://d9.cloudfront.net/${BID}_trimmed.vtt`)
check('the products are this Live\'s, in order, not another Live\'s', page.asins.join(',') === 'B0FK5MBDJZ,B0DPZVKV7V')
check('title and length come from the page', page.title === 'Weekend Shopping' && page.durationSec === 3268)
const vttWords = vttToWordCues('WEBVTT\n\n1\n00:00:07.878 --> 00:00:11.678\nI was not going\n\n2\n01:00:00.000 --> 01:00:01.000\n<c>Hi</c> there\n')
check('captions become timed words', vttWords.length === 6 && vttWords[0].text === 'I' && vttWords[1].start === 8.828 && vttWords[4].start === 3600 && vttWords[4].text === 'Hi')
const route2 = r('app/api/live/followup/route.ts')
check('the server reads the replay page before asking SCOUT', /const page = await readReplayPage\(replayUrl\)/.test(route2) && /tryScout: !body\.read/.test(route2))
check('Amazon\'s captions skip transcription when present', /vttToWordCues\(await r\.text\(\)\)/.test(route2) && /state: 'transcribed'/.test(route2))
check('a product nobody could name is listed, not dropped', /no product name found/.test(route2))

// FRAMING: the 9:16 window sits on the speaker, inside the frame.
check('a 16:9 frame shows about a third of its width in 9:16', Math.abs(windowShare(16 / 9) - 0.3164) < 0.001)
check('a face in the middle keeps the centre crop', cropXForFace(0.5, 16 / 9) === 0.5)
check('a face on the left moves the window left, never past the edge', cropXForFace(0.3, 16 / 9) < 0.5 && cropXForFace(0.05, 16 / 9) === 0 && cropXForFace(0.98, 16 / 9) === 1)
check('the face lands in the middle of the window', (() => { const x = cropXForFace(0.3, 16 / 9); const w = windowShare(16 / 9); return Math.abs(x * (1 - w) + w / 2 - 0.3) < 0.002 })())
const route3 = r('app/api/live/followup/route.ts')
check('a clip is framed on the speaker unless the creator set it', /action === 'frame' \|\| action === 'clip'/.test(route3) && /cropXForFace\(faceX, f\.aspect\)/.test(route3) && /framing: 'manual'/.test(route3))
check('no speaker found is said, and the middle is used', /framing: faceX == null \? 'centre' : 'auto'/.test(route3) && /No face was clear/.test(route3))
check('the crop position reaches the video service', /cropX: framing\.cropX/.test(r('lib/live-followup-server.ts')) && /cropAt\(cropX\)/.test(r('ingest-service/server.js')))

if (failures.length) {
  console.error(`\n❌ live-followup: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ live-followup: Pro, drafts only, clips cut from the stream inside the limits, and every step reports what happened')
