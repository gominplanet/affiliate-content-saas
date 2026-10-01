// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AMAZON LIVE FOLLOW-UP: admin only while tested, drafts only, and every step
// says what happened.
//
// Pinned here: the stream it reads, the clip windows it cuts, the captions'
// timing, the roundup text, the Labs gate, and that nothing in the follow-up
// posts anywhere by itself (the clips open in Clip Factory as drafts).
import { readFileSync } from 'node:fs'
import { pickStream, clampMoment, wordsInWindow, parseMoments, composeRoundup, CLIP_MAX_SEC, CLIP_MIN_SEC } from '../lib/live-followup'
import { canUsePreview } from '../lib/labs-preview'

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

check('admin only while tested', canUsePreview('live_followup', 'admin') && !canUsePreview('live_followup', 'pro'))
const nav = r('components/layout/DashboardShellV2.tsx')
check('the Labs item is admin gated', /href: '\/live-followup'[^\n]*gate: isAdmin/.test(nav))

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

const cf = r('app/(dashboard)/clip-factory/page.tsx')
check('Clip Factory only takes a hand-over clip from MVP storage', /liveClip/.test(cf) && /storage\/v1\/object\/public\//.test(cf))

if (failures.length) {
  console.error(`\n❌ live-followup: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ live-followup: admin only, drafts only, clips cut from the stream inside the limits, and every step reports what happened')
