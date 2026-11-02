// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE CREATOR THUMBNAIL LOOK (Seb, 2026-11-02). Pinned: a still of the
// creator from the parts the edit kept, made bigger with the head under the
// words; two to four words in the serif, the red bar under one; the head in
// front of the words only when it hides a sliver, else the words go beside
// it or in front, and the result says which; 1280 x 720 under YouTube's 2MB;
// made by itself once a review is made; carried through Drop to Liftoff as
// the video's own thumbnail; every failure said on the card.
import { readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { alphaBox, cropFor, splitLines, accentIndex, hiddenShare, composeThumb, THUMB_W, THUMB_H } from '../lib/creator-thumb'
import { fromOutput, thumbTimes, toOutput } from '../lib/review-edit'
import { cleanThumbWords } from '../lib/review-edit-plan'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

const person = (cx: number, headY: number, s = 1) => `<ellipse cx="${cx}" cy="${headY + 120 * s}" rx="${95 * s}" ry="${120 * s}" fill="FILL"/><path d="M ${cx - 300 * s} 1080 Q ${cx - 280 * s} ${headY + 290 * s} ${cx} ${headY + 270 * s} Q ${cx + 280 * s} ${headY + 290 * s} ${cx + 300 * s} 1080 Z" fill="FILL"/>`
async function frame(cx: number, headY: number, s: number) {
  const still = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#9c8573"/>${person(cx, headY, s).replace(/FILL/g, '#2f3b4a')}</svg>`)).jpeg().toBuffer()
  const cut = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">${person(cx, headY, s).replace(/FILL/g, '#ffffff')}</svg>`)).png().toBuffer()
  return { still, cut }
}
const redShare = async (jpg: Buffer, y0: number, y1: number) => {
  const { data, info } = await sharp(jpg).extract({ left: 0, top: y0, width: THUMB_W, height: y1 - y0 }).raw().toBuffer({ resolveWithObject: true })
  let red = 0
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 180 && data[i + 1] < 90 && data[i + 2] < 90) red++
  return red / (info.width * info.height)
}

async function main() {
  // ── Pure parts ─────────────────────────────────────────────────────────────
  const a = new Uint8Array(100 * 50); for (let y = 10; y < 40; y++) for (let x = 20; x < 60; x++) a[y * 100 + x] = 255
  check('the box round the creator', JSON.stringify(alphaBox(a, 100, 50)) === JSON.stringify({ x0: 20, y0: 10, x1: 60, y1: 40 }) && alphaBox(new Uint8Array(100 * 50), 100, 50) === null)
  const c = cropFor({ x0: 800, y0: 200, x1: 1120, y1: 1080 }, 1920, 1080)
  check('the crop is 16:9, inside the frame, zoomed 1.5 times at most', Math.abs(c.width / c.height - 16 / 9) < 0.01 && c.left >= 0 && c.top >= 0 && c.left + c.width <= 1920 && c.top + c.height <= 1080 && c.height >= 1080 / 1.5 - 1, c)
  check('and puts the top of the head about a third down when it can', Math.abs((200 - c.top) / c.height - 0.3) < 0.03, c)
  check('no creator found: the whole frame', JSON.stringify(cropFor(null, 1920, 1080)) === JSON.stringify({ left: 0, top: 0, width: 1920, height: 1080 }))
  check('two lines of about even length when one does not fit', JSON.stringify(splitLines('better than the expensive one', true)) === JSON.stringify([['better', 'than', 'the'], ['expensive', 'one']]) && splitLines('so good', false).length === 1)
  check('the red bar goes under the word asked for, else the last', accentIndex("don't buy this", "DON'T") === 0 && accentIndex('worth every penny', 'nope') === 2)
  check('how much of the words the head covers', hiddenShare(new Uint8Array([255, 255, 0, 255]), new Uint8Array([255, 0, 255, 0])) === 1 / 3)
  check('the words are cleaned: four at most, no dashes, year, hashtag or emoji', JSON.stringify(cleanThumbWords('the best — hoodie of 2026 #ad \u{1F525} ever', 'best')) === JSON.stringify({ words: 'the best hoodie of', accent: 'best' }) && cleanThumbWords('', '') === null && cleanThumbWords('so good', 'great')!.accent === 'good')

  // ── Frames only from what the edit kept ────────────────────────────────────
  const segs: [number, number][] = [[2, 10], [15, 30], [40, 52]]
  const times = thumbTimes(segs, 16)
  check('candidate frames come only from the parts the edit kept', times.length === 16 && times.every((t) => toOutput(segs, t) !== null), times)
  check('an output second maps back into the take', fromOutput(segs, 0) === 2 && fromOutput(segs, 8) === 15 && fromOutput(segs, 23.5) === 40.5 && fromOutput(segs, 999) === null)

  // ── The drawing ────────────────────────────────────────────────────────────
  const f1 = await frame(960, 220, 1.2)
  const r1 = await composeThumb({ still: f1.still, cutout: f1.cut, words: 'surprisingly good', accent: 'good' })
  const meta = await sharp(r1.jpg).metadata()
  check('1280 x 720, a JPEG under YouTube’s 2MB', meta.width === THUMB_W && meta.height === THUMB_H && meta.format === 'jpeg' && r1.jpg.byteLength < 2 * 1024 * 1024, [meta.width, meta.height, r1.jpg.byteLength])
  check('words at the top, the head in front of them, hiding next to nothing', r1.layout === 'top' && r1.depth === true && r1.hidden <= 0.07, r1)
  check('the red bar is drawn, near the top, under the words', (await redShare(r1.jpg, 0, Math.round(THUMB_H * 0.35))) > 0.004 && (await redShare(r1.jpg, Math.round(THUMB_H * 0.5), THUMB_H)) < 0.001)
  const f2 = await frame(960, 60, 1.6)
  const r2 = await composeThumb({ still: f2.still, cutout: f2.cut, words: 'worth every penny', accent: 'penny' })
  check('a head high in the frame never hides a word: beside it, or the words in front, and said', (r2.depth && r2.hidden <= 0.07) || (!r2.depth && r2.layout === 'front'), r2)
  const r3 = await composeThumb({ still: f1.still, cutout: null, words: 'no cut out', accent: 'out' })
  check('no cut-out: the words in front, and said', r3.depth === false && r3.layout === 'front')
  let refused = ''
  try { await composeThumb({ still: f1.still, cutout: null, words: '  ', accent: '' }) } catch (e) { refused = String(e) }
  check('no words is refused, never an empty thumbnail', /no words/.test(refused))

  // ── Wiring ─────────────────────────────────────────────────────────────────
  const W = read('lib/review-edit-server.ts'), R = read('app/api/review-edit/route.ts'), U = read('components/review-editor/ReviewEditor.tsx')
  const S = read('ingest-service/server.js'), D = read('components/labs/DropBoard.tsx'), P = read('lib/review-edit-plan.ts')
  check('the serif ships with the routes that draw thumbnails', existsSync('node_modules/@fontsource/playfair-display/files/playfair-display-latin-800-normal.woff') && /playfair-display-latin-800-normal\.woff/.test(read('next.config.ts')))
  check('the video server takes frames at the times asked and one still at full size, sent in the answer only', /req\.body\?\.at/.test(S) && /app\.post\('\/still'/.test(S) && /jpg: fs\.readFileSync\(out\)\.toString\('base64'\)/.test(S))
  check('frames are picked by a cheap model and the words written by one, both counted', /feature: 'review_edit_thumb_frame', model: QUICK_MODEL/.test(P) && /feature: 'review_edit_thumb_words', model: QUICK_MODEL/.test(P) && /feature: 'review_edit_thumb_cutout'/.test(W))
  check('new words redraw on the same frame and cut-out, with no AI', /const sameFrame = !o\.next && !!prev\?\.stillUrl/.test(W) && /if \(sameFrame && stillUrl\) \{\s*\n\s*still = await fetchBuf\(stillUrl\)/.test(W))
  check('a review just made gets one by itself, claimed first so two ticks never make the same', /\.eq\('settings->>kind', 'review'\)\.is\('info->thumb', null\)/.test(W) && /\.eq\('id', row\.id\)\.is\('info->thumb', null\)\.select\('id'\)/.test(W))
  check('every failure is saved and said on the card; one stuck making is said to have stopped', /state: 'failed', error/.test(W) && /MVP stopped while making the thumbnail/.test(R) && /t\?\.state === 'failed' && <p/.test(U))
  check('words in front of the head are said, not passed off as the look', /your head could not go in front of the words/.test(U))
  check('removing a video removes its thumbnail files', /edit-thumbsrc-\$\{row\.id\}\.jpg/.test(R) && /edit-thumbcut-\$\{row\.id\}\.png/.test(R))
  check('Send to Drop takes the thumbnail along, and Drop gives it to Liftoff as the video’s own', /wish: \{ thumbnailUrl: e\.thumb\.url \}/.test(U) && /\/api\/launch\/items\/\$\{res\.launchItemId\}\/thumbnail/.test(D) && /did not reach Liftoff/.test(D) && /thumbnailUrl: v\.thumbnailUrl/.test(D))
  check('Drop says whether Liftoff has it yet', /thumbnail_source === 'creator'/.test(D) && /It is given to Liftoff when the video goes in/.test(D))
  check('a TRYBE ad gets none', /A TRYBE ad has no YouTube thumbnail/.test(W) && /e\.settings\.kind === 'review' && <div className="mt-2"><ThumbBox/.test(U))

  if (fails.length) { console.error(`\n❌ creator-thumb: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
  console.log('✅ creator-thumb: a still from the kept parts, words in the serif with the red bar, the head in front only when it hides a sliver, made by itself and carried to Liftoff')
}
main().catch((e) => { console.error(e); process.exit(1) })
