// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR BRANDS' TOP VIDEOS, WORD FOR WORD (Seb, 2026-10-20: "what if we also
// gave users the exact scripts of the top videos"). SCOUT reads each joined
// brand's page, MVP files the videos in the shared copy, the transcription
// job writes the words once for everyone. A member's filing only adds, and
// only files on TRYBE's own hosts are ever listened to.
import { readFileSync } from 'node:fs'
import { cleanFiling, mediaOk, hostOf, wordsFrom, scriptCounts, BRAND_SCRIPTS_PER_BRAND } from '../lib/trybe-brand-scripts'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

const hosts = new Set(['media.trybe-cdn.com'])
check('a file on a host TRYBE\'s own files came from may be listened to', mediaOk('https://media.trybe-cdn.com/v/1.mp4', hosts) && mediaOk('https://static.jointrybe.com/x.mp4', hosts))
check('any other file, or a plain http one, may not', !mediaOk('https://evil.example.com/x.mp4', hosts) && !mediaOk('http://media.trybe-cdn.com/v/1.mp4', hosts) && !mediaOk('javascript:alert(1)', hosts))
check('a host is read safely', hostOf('https://A.Example.com/x') === 'a.example.com' && hostOf('nope') === null && hostOf(42) === null)
const filed = cleanFiling([
  { brandId: 'brand-123456', brandName: 'Acme', videos: [
    { id: 'sub-111111', video: 'https://media.trybe-cdn.com/a.mp4', thumbnail: 'https://media.trybe-cdn.com/a.jpg', caption: 'Hi' },
    { id: 'sub-111111', video: 'https://media.trybe-cdn.com/dupe.mp4' },
    { id: 'sub-222222', video: 'https://evil.example.com/b.mp4', thumbnail: 'https://evil.example.com/b.jpg' },
    { id: 'bad id!', video: 'https://media.trybe-cdn.com/c.mp4' },
  ] },
  { brandId: '<script>', videos: [] },
  ...Array.from({ length: 50 }, (_, i) => ({ brandId: `brand-x${String(i).padStart(4, '0')}`, videos: [] })),
], hosts)
check('ids are checked and a video is filed once', filed[0].videos.length === 2 && filed[0].videos[0].id === 'sub-111111')
check('a file not on TRYBE\'s hosts is filed without it, so it is never listened to or shown', filed[0].videos[1].video === null && filed[0].videos[1].thumbnail === null)
check('a bad brand id is dropped and one pass is capped', !filed.some((b) => b.brandId === '<script>') && filed.length <= 40)
const many = cleanFiling([{ brandId: 'brand-123456', videos: Array.from({ length: 40 }, (_, i) => ({ id: `sub-${String(i).padStart(6, '0')}`, video: 'https://media.trybe-cdn.com/v.mp4' })) }], hosts)
check('up to the per-brand count is kept', many[0].videos.length === BRAND_SCRIPTS_PER_BRAND)
const deaf = { state: 'waiting', source: 'none', detail: 'MVP could not listen to it: the file is gone', video_url: 'https://x' }
check('a video MVP could not listen to says why, never "being written down", and is not counted as waiting', wordsFrom(deaf).tone === 'none' && /could not listen to it: the file is gone\.$/.test(wordsFrom(deaf).text) && scriptCounts([deaf]).waiting === 0 && scriptCounts([deaf]).none === 1)
check('where the words came from is said, and a gap says why', wordsFrom({ state: 'ready', source: 'transcribed', detail: null, video_url: 'x' }).text === 'Written down by MVP from the video'
  && wordsFrom({ state: 'ready', source: 'trybe', detail: null, video_url: null }).text === 'TRYBE’s own words for this video'
  && wordsFrom({ state: 'waiting', source: 'none', detail: null, video_url: 'https://x' }).tone === 'wait'
  && /no video file/.test(wordsFrom({ state: 'waiting', source: 'none', detail: null, video_url: null }).text)
  && /heard no speech/.test(wordsFrom({ state: 'none', source: 'none', detail: 'MVP listened to it and heard no speech', video_url: 'x' }).text))
const c = scriptCounts([{ state: 'ready', video_url: 'x' }, { state: 'waiting', video_url: 'x' }, { state: 'waiting', video_url: null }, { state: 'none', video_url: 'x' }])
check('the counts tell words, coming and none apart', c.videos === 4 && c.ready === 1 && c.waiting === 1 && c.none === 2)

const ROUTE = read('app/api/labs/trybe/route.ts')
const filing = ROUTE.slice(ROUTE.indexOf("if (action === 'brand_top_seen')"), ROUTE.indexOf("if (action === 'brand_scripts')"))
check('a member\'s filing only adds: new rows ignore duplicates, and only a waiting row takes a fresh file link', /upsert\(fresh, \{ onConflict: 'submission_id', ignoreDuplicates: true \}\)/.test(filing) && /\.eq\('state', 'waiting'\)/.test(filing) && !/script:/.test(filing))
check('the hosts a member may file from come from the team\'s Top 100 filing', /\.not\('best_rank', 'is', null\)\.like\('video_url', 'https:\/\/%'\)/.test(filing) && /if \(tier === 'admin'\) for/.test(filing))
check('the scripts are read for the brands asked about', /if \(action === 'brand_scripts'\)/.test(ROUTE) && /\.in\('brand_id', ids\)/.test(ROUTE))
const CRON = read('app/api/cron/trybe-top-hear/route.ts')
check('the transcription job listens to up to 100 a day, Top 100 first', /const DAILY_CAP = 100/.test(CRON) && /\.order\('best_rank', \{ ascending: true, nullsFirst: false \}\)/.test(CRON))
const UI = read('components/labs/TrybeBrandScripts.tsx')
const MB = read('components/labs/TrybeMyBrands.tsx')
check('My brands shows them', /<TrybeBrandScripts brands=\{brands\} isAdmin=\{isAdmin\} \/>/.test(MB))
check('each joined brand\'s page is read once a day through SCOUT, then filed', /brands\/\$\{encodeURIComponent\(b\.id\)\}\/details/.test(UI) && /action: 'brand_top_seen'/.test(UI) && /readOn\(\) === today\(\)/.test(UI))
check('the full words show, with Copy, and the creator is told to make it theirs', /\{r\.script\}<\/p>/.test(UI) && /Copy the words/.test(UI) && /make it yours: a brand may turn down a video that copies another creator/.test(UI))
check('no dashes in what the creator reads', !/[–—]| - /.test(UI.split('\n').filter((l) => !l.trim().startsWith('//')).join(' ') + read('lib/trybe-brand-scripts.ts').split('\n').filter((l) => /'|`/.test(l) && !l.trim().startsWith('//')).join(' ')))

if (failures.length) {
  console.error(`\n❌ trybe-brand-scripts: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trybe-brand-scripts: every joined brand\'s top videos, filed once, written down once, shown word for word')
