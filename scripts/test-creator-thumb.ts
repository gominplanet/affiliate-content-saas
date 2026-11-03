// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE CREATOR THUMBNAIL LOOK (Seb, 2026-11-02). Pinned: a look in the
// thumbnail generator (Liftoff uses the same route): the AI draws the
// creator from their headshots with the product and no words, leaving the
// top for them; MVP draws two to four words in the serif with the red bar
// under one, and lays the creator's head in front only when it hides a
// sliver, else the words go beside it or in front, and the result says which.
// 1280 x 720 under YouTube's 2MB. Not from video frames (Seb: "too unstable").
import { readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { alphaBox, cropFor, splitLines, accentIndex, hiddenShare, composeThumb, creatorWords, isStockVerdict, THUMB_W, THUMB_H } from '../lib/creator-thumb'
import { resolvePreset, presetToBriefRules, presetToPrompt } from '../lib/visual-presets'
import { buildGraphicThumbnailPrompt } from '../lib/thumbnail-prompt'

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
  check('the words are cleaned: four at most, no dashes, year, hashtag or emoji', JSON.stringify(creatorWords('the best \u2014 hoodie of 2026 #ad \u{1F525} ever', 'best')) === JSON.stringify({ words: 'the best hoodie of', accent: 'best' }) && creatorWords('', '') === null && creatorWords('so good', 'great')!.accent === 'good')
  check('a headline in capitals comes out lowercase, an acronym or model number kept', creatorWords('THIS USB HUB ROCKS', 'rocks')!.words === 'this USB hub rocks' && creatorWords('BEST X100 YET')!.words === 'best X100 yet' && creatorWords('SO GOOD')!.words === 'so good' && creatorWords("Don't buy this")!.words === "Don't buy this")

  // ── The drawing ────────────────────────────────────────────────────────────
  const f1 = await frame(960, 220, 1.2)
  const r1 = await composeThumb({ still: f1.still, cutout: f1.cut, words: 'surprisingly good', accent: 'good' })
  const meta = await sharp(r1.jpg).metadata()
  check('1280 x 720, a JPEG under YouTube’s 2MB', meta.width === THUMB_W && meta.height === THUMB_H && meta.format === 'jpeg' && r1.jpg.byteLength < 2 * 1024 * 1024, [meta.width, meta.height, r1.jpg.byteLength])
  check('words at the top, the head in front of them, hiding next to nothing', r1.layout === 'top' && r1.depth === true && r1.hidden <= 0.07, r1)
  check('the red bar is drawn, near the top, under the words', (await redShare(r1.jpg, 0, Math.round(THUMB_H * 0.35))) > 0.004 && (await redShare(r1.jpg, Math.round(THUMB_H * 0.5), THUMB_H)) < 0.001)
  const f2 = await frame(960, 60, 1.6)
  const r2 = await composeThumb({ still: f2.still, cutout: f2.cut, words: 'worth every penny', accent: 'penny' })
  check('a head high in the frame never hides a word: beside it, or the words in front, and said', (r2.layout === 'top' && r2.depth && r2.hidden <= 0.07) || (!r2.depth && (r2.layout === 'side' || r2.layout === 'front')), r2)
  const f5 = await frame(1300, 40, 1.4)
  const r5 = await composeThumb({ still: f5.still, cutout: f5.cut, words: 'worth every penny', accent: 'penny', crop: false })
  check('the head goes in front of the words only when they are centred across the top; beside it they stay clear', r5.layout === 'side' ? r5.depth === false && r5.hidden === 0 : true, r5)
  check('and the head is in front only on the top layout', !r1.depth || r1.layout === 'top')
  const r3 = await composeThumb({ still: f1.still, cutout: null, words: 'no cut out', accent: 'out' })
  check('no cut-out: the words in front, and said', r3.depth === false && r3.layout === 'front')
  let refused = ''
  try { await composeThumb({ still: f1.still, cutout: null, words: '  ', accent: '' }) } catch (e) { refused = String(e) }
  check('no words is refused, never an empty thumbnail', /no words/.test(refused))

  const r4 = await composeThumb({ still: f1.still, cutout: f1.cut, words: 'surprisingly good', accent: 'good', crop: false })
  check('a picture made for the words is used whole, not cropped', JSON.stringify(r4.crop) === JSON.stringify({ left: 0, top: 0, width: 1920, height: 1080 }))

  // ── The look in the generator ──────────────────────────────────────────────
  const look = resolvePreset('creator')
  check('the Creator look is one of the looks, quiet, a photograph, and its words drawn by MVP', look.id === 'creator' && look.wordsByMvp === true && look.badges === false && look.family === 'Photographic')
  check('its brief writes two to four lowercase words, all in one line', /two to four words in total, lowercase/.test(presetToBriefRules(look)) && /leave line1 empty/.test(presetToBriefRules(look)))
  const prompt = buildGraphicThumbnailPrompt({ presetId: 'creator', line1: '', line2: 'surprisingly good', concept: 'creator at a desk holding the hoodie' } as never)
  check('the picture is asked for with no words, and room at the top with the head a third down', /LEAVE ROOM FOR THE WORDS/.test(prompt) && /no words, letters, numbers/.test(prompt) && /TYPOGRAPHY: none on the picture/.test(prompt) && !/MAIN HEADLINE/.test(prompt) && !/surprisingly good/.test(prompt))
  check('the fallback path asks the same', /TYPOGRAPHY: none on the picture/.test(presetToPrompt(look, { surface: 'thumbnail' })))
  check('a pin or blog hero still takes the look\u2019s typography, as every other look', presetToPrompt(look, { surface: 'pin' }).includes(look.typography) && presetToPrompt(look, { surface: 'hero' }).includes(look.typography))
  const other = buildGraphicThumbnailPrompt({ presetId: 'bold', line1: '', line2: 'surprisingly good', concept: 'x' } as never)
  check('every other look still has its headline drawn by the model', /MAIN HEADLINE/.test(other) && !/LEAVE ROOM FOR THE WORDS/.test(other))
  check('and says it again as the last thing the AI reads, the headroom the head needs', /FINAL CHECK — HEADROOM/.test(prompt.slice(-600)) && !/FINAL CHECK — HEADROOM/.test(other))
  check('a scene the creator typed gets the same last word', /\.\.\.\(mvpWords \? \['', MVP_WORDS_FINAL_CHECK\] : \[\]\)/.test(read('app/api/youtube/generate-thumbnail/route.ts')))

  // ── Wiring ─────────────────────────────────────────────────────────────────
  const G = read('app/api/youtube/generate-thumbnail/route.ts'), W = read('lib/review-edit-server.ts'), S = read('ingest-service/server.js')
  check('the serif ships with the routes that draw thumbnails', existsSync('node_modules/@fontsource/playfair-display/files/playfair-display-latin-800-normal.woff') && /playfair-display-latin-800-normal\.woff/.test(read('next.config.ts')))
  check('the generator draws the words on the Creator look, YouTube size only', /const mvpWords = resolvePreset\(visualPreset\)\.wordsByMvp === true && Math\.abs\(outW \/ outH - 16 \/ 9\) < 0\.02/.test(G) && (G.match(/finishWithMvpWords\(/g) ?? []).length >= 3)
  check('nothing to spell check when MVP draws the words', /if \(b64 && !mvpWords\) \{/.test(G) && /if \(b64 && !mvpWords\) \{\s*\n\s*const wantP/.test(G))
  check('the creator is cut out to sit in front of the words, the cost counted, a failed cut-out leaves the words in front', /removeBackground\(hosted\)/.test(G) && /feature: 'thumb_creator_cutout', model: 'fal-rembg'/.test(G) && /crop: false/.test(G))
  check('the result says, for each variant, whether the words had to go over the creator', /creatorOverHead: gfxRawUrls\.flatMap/.test(G) && /overHead: withPerson && made\.layout === 'front'/.test(G))
  check('a scene the creator typed gets no words drawn by the model on this look either', /\.\.\.\(mvpWords \? \[MVP_WORDS_LAYOUT, MVP_WORDS_TEXT\] : \[/.test(G))
  check('the look is offered in the picker only to Labs while it is tested; an account that has it keeps it', look.labs === 'creator_look' && /creator_look: 'admin'/.test(read('lib/labs-preview.ts')) && /!p\.labs \|\| current\.includes\(p\.id\) \|\| \(tier !== null && canUsePreview\(p\.labs, tier\)\)/.test(read('components/brand/VisualPresetPicker.tsx')) && /p\.family === family && offered\(p\)/.test(read('components/brand/VisualPresetPicker.tsx')))
  check('Co-Pilot says when the words had to go over the creator', /there was no room for the words behind your head or beside it, so they sit over you/.test(read('app/(dashboard)/co-pilot/page.tsx')))
  check('no thumbnails from video frames any more', !/makeCreatorThumb|pickThumbFrames|edit-thumbsrc/.test(W) && !/app\.post\('\/still'/.test(S))

  // ── The words: this product and this review (Seb, 2026-11-03: "mvp keeps on writing the same title.. we need it to be based on the product and the review") ─
  check('a stock verdict that fits any product is caught, however it is written', isStockVerdict('WORTH EVERY PENNY') && isStockVerdict("Don’t buy this!") && isStockVerdict('game-changer') && isStockVerdict('  must have ') && isStockVerdict('Worth it?'))
  check('words about this product are not', !isStockVerdict('holds 200 lbs') && !isStockVerdict('garage finally clear') && !isStockVerdict('worth every penny for 40 tools') && !isStockVerdict(''))
  const rules = presetToBriefRules(resolvePreset('creator'))
  check('the headline rule shows no phrase to copy, and asks for this product and this review', !/worth every penny/i.test(rules) && !/surprisingly good/i.test(rules) && /about THIS product and THIS review/.test(rules) && /must not fit any other product/.test(rules) && /build it from them/.test(rules))
  const R = readFileSync('app/api/youtube/generate-thumbnail/route.ts', 'utf8')
  check('a stock headline on the creator look is refused, and the art director asked once more, told which', /const stock = \(b: ThumbBrief\) => isStockVerdict\(`\$\{b\.line1\} \$\{b\.line2\}`\)/.test(R) && /resolvePreset\(input\.presetId\)\.wordsByMvp && !input\.lockedHeadline && briefs\.some\(stock\)/.test(R) && /These headlines would fit any product, so they are refused/.test(R) && /briefs = briefs\.map\(\(b\) => \(stock\(b\) \? fresh\.shift\(\) \?\? b : b\)\)/.test(R))
  const GEN = readFileSync('app/(dashboard)/amazon/thumbnails/page.tsx', 'utf8')
  check('the Thumbnail Generator takes the creator’s own take and sends it as their words', /Your take on it/.test(GEN) && /take\.trim\(\)\.length >= 20 \? \{ sourceText: take\.trim\(\)\.slice\(0, 2000\) \}/.test(GEN) && /sourceText/.test(R))

  if (fails.length) { console.error(`\n❌ creator-thumb: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
  console.log('✅ creator-thumb: the Creator look in the generator, the picture without words, MVP draws them in the serif with the red bar, the head in front only when it hides a sliver')
}
main().catch((e) => { console.error(e); process.exit(1) })
