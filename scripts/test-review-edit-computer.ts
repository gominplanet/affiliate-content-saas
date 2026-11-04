// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BATCH FROM THIS COMPUTER (Seb, 2026-11-04: "yes build batch upload too").
//
// What this proves:
//   - the browser reads when a take was filmed, how long it is and whether it
//     was filmed upright from the file itself, wherever its header sits, with
//     the video server's rule (an iPhone's own date with its time zone first);
//   - those takes pair and become TRYBE ads or reviews the Drive batch's way;
//   - nothing is uploaded before the videos are checked, each video is added
//     as soon as its own files are up, a file already in a video is left out,
//     a video that fails keeps none of its files, and leaving asks first;
//   - the nightly sweep no longer deletes a take a video still needs (it did
//     after a day), and still clears takes no video holds;
//   - a TRYBE ad never reads "captions on" while the look has them off.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readVideoFacts, factsFromMoov, filmedAtFromText } from '../lib/video-file-facts'
import { batchVideos, uploadKey, type DriveTake } from '../lib/review-edit-batch'
import { KIND_WORDS, kindLine } from '../lib/review-edit'

const ROOT = path.resolve(__dirname, '..')
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8')
const fixture = (f: string) => new Blob([readFileSync(path.join(ROOT, 'scripts/fixtures/video-facts', f))])
const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const NOW = Date.parse('2026-11-04T12:00:00Z')

/** A box: its size, its type, its contents. */
const box = (type: string, ...parts: Uint8Array[]) => {
  const body = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(8 + body)
  new DataView(out.buffer).setUint32(0, 8 + body)
  out.set([...type].map((c) => c.charCodeAt(0)), 4)
  let at = 8
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const bytes = (n: number, f: (v: DataView) => void) => { const b = new Uint8Array(n); f(new DataView(b.buffer)); return b }

async function main() {
  // ── What the file says about itself ──
  const end = await readVideoFacts(fixture('sideways-moov-at-end.mp4'), NOW)
  check('a sideways take with its header at the end: filmed time, length and shape', end.filmedAt === '2026-10-30T18:22:40.000Z' && end.seconds === 3 && end.width === 64 && end.height === 48, end)
  const up = await readVideoFacts(fixture('upright-phone.mp4'), NOW)
  check('a phone video stored sideways and turned a quarter to play upright reads as upright', up.width === 48 && up.height === 64 && up.filmedAt === '2026-10-30T18:40:00.000Z' && up.seconds === 2, up)
  const ip = await readVideoFacts(fixture('iphone-date.mov'), NOW)
  check('an iPhone’s own date, with its time zone, wins over the file’s creation time (as on the video server)', ip.filmedAt === '2026-10-30T18:22:33.000Z', ip)
  const tall = await readVideoFacts(fixture('tall-no-date.mp4'), NOW)
  check('a file that does not say when it was filmed gives no time, and still its shape', tall.filmedAt === null && tall.width === 48 && tall.height === 64, tall)
  const junk = await readVideoFacts(new Blob([new Uint8Array(64)]), NOW)
  check('a file that is not a movie gives nothing and does not throw', junk.filmedAt === null && junk.seconds === null && junk.width === null)

  // The 64-bit header kind (version 1), built by hand.
  const secs1904 = (iso: string) => (Date.parse(iso) - Date.UTC(1904, 0, 1)) / 1000
  const mvhd1 = box('mvhd', bytes(32, (v) => { v.setUint8(0, 1); v.setUint32(4, 0); v.setUint32(8, secs1904('2026-10-31T09:00:00Z')); v.setUint32(20, 600); v.setUint32(24, 0); v.setUint32(28, 600 * 75) }))
  const tkhd1 = box('tkhd', bytes(96, (v) => { v.setUint8(0, 1); v.setInt32(52, 0); v.setInt32(56, 65536); v.setInt32(64, -65536); v.setInt32(68, 0); v.setUint32(88, 1920 * 65536); v.setUint32(92, 1080 * 65536) }))
  const f1 = factsFromMoov(new Uint8Array([...mvhd1, ...box('trak', tkhd1)]), NOW)
  check('the 64-bit headers read the same way, a quarter turn included', f1.filmedAt === '2026-10-31T09:00:00.000Z' && f1.seconds === 75 && f1.width === 1080 && f1.height === 1920, f1)
  // A camera whose clock was never set.
  const mvhd0 = box('mvhd', bytes(20, (v) => { v.setUint32(4, secs1904('2001-01-01T00:00:00Z')); v.setUint32(12, 1000); v.setUint32(16, 5000) }))
  check('a clock never set is not a filming time', factsFromMoov(mvhd0, NOW).filmedAt === null && factsFromMoov(mvhd0, NOW).seconds === 5)

  // The same rule as the video server's (ingest-service test-edit-filters).
  check('dates read like the video server reads them', filmedAtFromText('2026-10-30T14:22:33-0400', NOW) === '2026-10-30T18:22:33.000Z' && filmedAtFromText('1970-01-01T00:00:00Z', NOW) === null && filmedAtFromText('2099-01-01T00:00:00Z', NOW) === null && filmedAtFromText('', NOW) === null)

  // ── Pairing, as a Drive batch pairs ──
  const take = (id: string, name: string, f: { filmedAt: string | null; seconds: number | null; width: number | null; height: number | null }): DriveTake => ({ id, name, bytes: 1000, createdAt: null, ...f })
  const a1 = take('a1', 'IMG_0101.MOV', { filmedAt: '2026-11-04T15:00:00Z', seconds: 90, width: 1920, height: 1080 })
  const b1 = take('b1', 'IMG_0102.MOV', { filmedAt: '2026-11-04T15:03:00Z', seconds: 40, width: 1920, height: 1080 })
  const a2 = take('a2', 'IMG_0103.MOV', { filmedAt: '2026-11-04T15:10:00Z', seconds: 60, width: 1080, height: 1920 })
  const b2 = take('b2', 'IMG_0104.MOV', { filmedAt: '2026-11-04T15:12:00Z', seconds: 30, width: 1080, height: 1920 })
  const vids = batchVideos([a2, a1], [b2, b1])
  check('takes from the computer pair by when they were filmed', vids.length === 2 && vids.find((v) => v.a[0].id === 'a1')?.b[0]?.id === 'b1' && vids.find((v) => v.a[0].id === 'a2')?.b[0]?.id === 'b2', vids.map((v) => [v.a[0].id, v.b[0]?.id, v.how]))
  check('upright becomes a TRYBE ad, sideways a review', vids.find((v) => v.a[0].id === 'a2')?.kind === 'trybe' && vids.find((v) => v.a[0].id === 'a1')?.kind === 'review')
  check('a file is known by its name and size', uploadKey('IMG_0101.MOV', 1000) === 'IMG_0101.MOV|1000' && uploadKey('IMG_0101.MOV', 1001) !== uploadKey('IMG_0101.MOV', 1000))

  // ── The batch on the page ──
  const C = read('components/review-editor/ComputerBatch.tsx')
  const E = read('components/review-editor/ReviewEditor.tsx')
  const U = read('components/review-editor/upload-take.ts')
  const R = read('app/api/review-edit/route.ts')
  check('the page has a batch from this computer beside Drive and One video', /\['computer', 'A batch from this computer'\]/.test(E) && /<ComputerBatch settings=\{settings\} onAdded=\{load\} left=\{allowance\?\.left \?\? null\} \/>/.test(E))
  check('each file is read on the computer before anything is uploaded', /readVideoFacts\(file\)/.test(C) && /batchVideos\(nextTalk, nextRoll\)/.test(C) && C.indexOf('readVideoFacts(file)') < C.indexOf('uploadTake(supabase'))
  check('the videos are checked with the same list as a Drive batch', /<BatchCheck videos=\{videos\} setVideos=\{setVideos\} pool=\{roll\} locked=\{running\} status=\{status\} \/>/.test(C) && /<BatchCheck videos=\{videos\}/.test(read('components/review-editor/DriveBatch.tsx')))
  const loop = C.slice(C.indexOf('const addAll'), C.indexOf('const status ='))
  check('each video is added the moment its own files are up, not after the whole batch', loop.indexOf('uploadTake(supabase') > 0 && loop.indexOf("action: 'add'") > loop.indexOf('uploadTake(supabase') && /for \(let i = 0; i < list\.length; i\+\+\)/.test(loop))
  check('a video that fails keeps none of its uploaded files', /const forget = async \(\) =>/.test(loop) && /\.remove\(\[\.\.\.up\.values\(\)\]\.map\(\(u\) => u\.path\)\)/.test(loop) && (loop.match(/await forget\(\)/g) || []).length >= 3)
  check('files already in a video are left out and listed', /action: 'uploaded_before'/.test(C) && /Left out, already in a video/.test(C) && /if \(action === 'uploaded_before'\)/.test(R) && /f\?\.kind === 'upload'/.test(R) && /uploadKey\(/.test(R))
  check('leaving while it uploads asks first, and it can stop after a video', /addEventListener\('beforeunload'/.test(C) && /Stop after this video/.test(C) && /stop\.current = true/.test(C))
  check('no more uploaded than the month has left', /const room = left === null \? list\.length : Math\.max\(0, left\)/.test(loop) && /no edited videos left this month/.test(loop) && /d\.allowanceFull/.test(loop))
  check('every video says what happened to it', ['Waiting to upload.', 'Uploading ', 'Uploaded and added. MVP is working on it.', 'Not added. '].every((w) => C.includes(w)))
  check('a dropped connection is said in plain words, not the browser’s', /failed to fetch\|load failed/.test(U) && /the connection to MVP dropped/.test(U))
  check('one way to upload a take, for One video and the batch', /uploadTake\(supabase, user\.id, file/.test(E) && /source-edit-\$\{crypto\.randomUUID\(\)\}/.test(U) && !/uploadResumable\(/.test(E))

  // ── How big a take may be ──
  const L = read('lib/clip-source-limits.ts')
  check('a take may be 2 GB (a Pocket 3 records about 300 MB a minute at 1080p), the same as Clip Factory and the YouTube push', /export const BULK_VIDEO_MAX_BYTES = 2 \* 1024 \* 1024 \* 1024/.test(L) && /const MAX_UPLOAD_BYTES = 2 \* 1024 \* 1024 \* 1024/.test(read('app/api/cron/launch-drain/route.ts')) && /file_size_limit = 2147483648/.test(read('supabase/migrations/463_video_bucket_2gb.sql')))
  check('a take over it says how to fit it, never "film at 1080p"', ![C, E, read('components/labs/DropBoard.tsx'), read('components/labs/TrybeUpload.tsx'), read('components/launch/LaunchBoard.tsx')].some((x) => /film at 1080p/i.test(x)) && /tooBigWords\(f\.size\)} Split it into two files/.test(C) && /tooBigWords\(file\.size\)} Split it into two files/.test(E))

  // ── The nightly sweep and the editor's takes ──
  const P = read('app/api/cron/purge-shorts-sources/route.ts')
  check('the sweep leaves every take a video still needs', /from\('review_edits'\)[\s\S]{0,120}\.is\('raw_deleted_at', null\)/.test(P) && /excluded\.add\(path\)/.test(P) && /path\.split\('\/'\)\[0\] === r\.user_id/.test(P))
  check('when the editor’s videos cannot be read, none of its takes is swept', /editTakesKnown = false/.test(P) && /!editTakesKnown && f\.name\.startsWith\('source-edit-'\)/.test(P))
  check('a take no video holds is still swept after a day', /\^\(burner\|clip\|source\)-/.test(P) && /RETENTION_HOURS = 24/.test(P))

  // ── The TRYBE ad line ──
  check('a TRYBE ad says captions only when they are on', !/captions/i.test(KIND_WORDS.trybe.line) && /Word by word captions on\./.test(kindLine('trybe', true)) && /No captions: they are off in Your look\./.test(kindLine('trybe', false)) && kindLine('review', false) === KIND_WORDS.review.line)
  check('the One video picker says it with the look’s setting', /kindLine\(k, settings\.captions\)/.test(E) && !/KIND_WORDS\[k\]\.line/.test(E))

  if (fails.length) { console.error(`\n❌ review-edit-computer: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
  console.log('✅ review-edit-computer: takes read on the computer, paired, uploaded and added one video at a time, swept only when no video holds them')
}

main().catch((e) => { console.error(e); process.exit(1) })
