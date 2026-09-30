// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Liftoff in two parts (Labs liftoff_split): part 1 is YouTube only and asks
// for no countries; part 2 is Amazon, locked until YouTube is done and started
// with its own button. The CTA copy never reaches Amazon, and one thumbnail
// serves every country.
import { readFileSync } from 'node:fs'
import { batchSteps, launchBlocker, batchRecap, youtubePartDone, type BatchRow, type ItemRow } from '../lib/launch-batch'
import { canUsePreview } from '../lib/labs-preview'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// ── the rules ───────────────────────────────────────────────────────────────
const batch = (over: Partial<BatchRow> = {}): BatchRow => ({
  id: 'b1', name: 'x', state: 'draft', cta: null, cta_chosen: true, thumbnail: null, thumbnail_chosen: true,
  markets: [], daily_slots: ['17:00'], start_on: '2030-01-01', timezone: 'UTC', send_to_youtube: true,
  youtube_channel_id: 'UC1', ...over,
} as BatchRow)
const item = (over: Partial<ItemRow> = {}): ItemRow => ({
  id: 'i1', position: 0, source_url: 'https://x/a.mp4', rendered_url: null, asin: 'B0TEST1234', title: 'A real title',
  title_source: 'creator', thumbnail_url: 'https://x/t.jpg', state: 'prepared', reason: null, ...over,
} as ItemRow)

const split = batch({ amazon_later: true })
const classic = batch({ amazon_later: false })
check('part 1 has no countries step', !batchSteps(split, [item()]).some((s) => s.id === 'countries'))
check('the classic Liftoff still asks for countries', batchSteps(classic, [item()]).some((s) => s.id === 'countries'))
check('part 1 launches with no countries', launchBlocker(split, [item()]) === null)
check('the classic Liftoff still waits for countries', /countries/i.test(launchBlocker(classic, [item()]) || ''))
check('the recap says Amazon is part 2, not "YouTube only"',
  batchRecap(split, [item()]).some((l) => /part 2/.test(l)) && !batchRecap(split, [item()]).some((l) => /YouTube only/.test(l)))

const onYT = item({ id: 'a', state: 'scheduled', youtube_video_id: 'vid00000001' } as Partial<ItemRow>)
const going = item({ id: 'b', state: 'prepared', youtube_video_id: null } as Partial<ItemRow>)
const failed = item({ id: 'c', state: 'blocked', youtube_video_id: null } as Partial<ItemRow>)
check('not done before launch', !youtubePartDone('draft', [onYT]).done)
check('not done while a video is still going up', !youtubePartDone('launched', [onYT, going]).done)
check('done once every video is on YouTube or could not go', youtubePartDone('launched', [onYT, failed]).done)
check('a batch where nothing reached YouTube is not "done"', !youtubePartDone('launched', [failed]).done)
check('the counts are the rows', JSON.stringify(youtubePartDone('launched', [onYT, going, failed])) === JSON.stringify({ done: false, onYouTube: 1, failed: 1, waiting: 1 }))

check('it starts admin only', canUsePreview('liftoff_split', 'admin') && !canUsePreview('liftoff_split', 'pro'))

// ── the wiring ─────────────────────────────────────────────────────────────
const LIB = read('lib/launch-batch.ts')
check('an Amazon only batch is never split (Amazon is the whole job there)', /canUsePreview\('liftoff_split', data\?\.tier\) && batch\.send_to_youtube !== false/.test(LIB))

const DRAIN = read('app/api/cron/launch-drain/route.ts')
const hand = DRAIN.slice(DRAIN.indexOf('async function handOverToAmazon'), DRAIN.indexOf('async function noteHandOver'))
check('with no countries the hand-over still records the video and its clean original',
  !/markets\.length === 0\) return/.test(hand) && /source_video_url: it\.clean_url \?\? null/.test(hand) && /video_masters/.test(hand))
check('and makes the country rows only when there are countries', /if \(markets\.length > 0\) \{[\s\S]*storefront_coverage[\s\S]*\}\s*\n\s*const \{ error: linkErr \}/.test(hand))

const LAUNCH = read('app/api/launch/batches/[id]/launch/route.ts')
check('part 1 clears countries picked before the split, at the first launch only',
  /batch\.amazon_later && !late && batch\.markets\.length > 0/.test(LAUNCH) && /update\(\{ markets: \[\] \}\)/.test(LAUNCH))

const START = read('app/api/launch/batches/[id]/amazon/route.ts')
check('Start Amazon needs a launched batch', /batch\.state !== 'launched' && batch\.state !== 'launching'/.test(START))
check('Start Amazon saves the countries on the batch, so latecomers and the background tab use them', /update\(\{ markets: allMarkets/.test(START))
check('Start Amazon makes a row per video per country, with each country\'s own ASIN', /storefront_coverage'\)\.upsert\(/.test(START) && /cachedLocalAsins\(/.test(START))
check('Amazon never gets the CTA copy: no rendered_url anywhere in Start Amazon', !/rendered_url/.test(START))
check('a video with no original left is named, not queued to fail later', /noOriginal\.push\(name\)/.test(START))

const BOARD = read('components/launch/LaunchBoard.tsx')
check('the countries step is not drawn in part 1', /\{!batch\.amazon_later && <StepCard/.test(BOARD))
check('part 2 is its own section, locked until YouTube is done', /LIFTOFF PART 2: AMAZON/.test(BOARD) && /youtubePartDone\(batch\.state, items\)/.test(BOARD) && /Opens when YouTube is done/.test(BOARD))
check('it says "YouTube is done" from the rows, with each video\'s link', /YouTube is done\./.test(BOARD) && /youtube\.com\/watch\?v=\$\{i\.youtube_video_id\}/.test(BOARD))
check('nothing about Amazon starts on a tick: part 2 holds them until Start Amazon',
  /setAmazonPick\(/.test(BOARD) && /startAmazon\(amazonPick\)/.test(BOARD) && /\/api\/launch\/batches\/\$\{batchId\}\/amazon/.test(BOARD))
check('part 1 shows no Amazon panel, button or row box', /const amazonOn = !batch\.amazon_later \|\| batch\.markets\.length > 0/.test(BOARD)
  && /\{amazonOn && <div className="mt-3 flex items-center gap-3 flex-wrap">/.test(BOARD) && /hideAmazon=\{!!batch\.amazon_later && batch\.markets\.length === 0\}/.test(BOARD))
check('one country grid for both parts', (BOARD.match(/countryGrid\(\{/g) ?? []).length === 2)

if (failures.length) {
  console.error(`\n❌ liftoff-split: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ liftoff-split: YouTube first with no countries asked, then Amazon on its own button once YouTube is done, never with the CTA copy')
