// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BURN WORKS WITHOUT CLOUDINARY, LOOKING AS IT DID (Seb, 2026-10-28: "just
// make sure that people can do the burn and the stuff with Clip Factory as
// they used to"). Pinned: the caption is drawn in Cloudinary's four looks and
// put on Cloudinary's spots, a preset sticker is scaled as Cloudinary scaled
// it, every burn asks the render server for the 1080x1920 frame, the render
// server makes it, the routes burn there first, the font ships with them, and
// a Pinterest video pin gets its cover from the render server.
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { captionLook, spotOf, topLeftFor, drawCaption, drawableCaption, burnRequest, FRAME_W, FRAME_H, PRESET_STICKER_SCALE } from '../lib/overlay-burn'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

async function run() {
  const CLD = read('services/cloudinary/index.ts')
  // The four looks are Cloudinary's colours.
  check('white on dark, black on white, yellow on dark, white with a shadow', captionLook('white-pill').background === '#111111' && captionLook('white-pill').color === '#ffffff'
    && captionLook('black-pill').background === '#ffffff' && captionLook('yellow-pill').color === '#ffd400' && captionLook('white-shadow').background === null && captionLook('white-shadow').shadow
    && /case 'yellow-pill': return \{ color: '#ffd400', background: '#111111', radius: 20 \}/.test(CLD) && /case 'black-pill': return \{ color: 'black', background: '#ffffff', radius: 24 \}/.test(CLD))
  // The spots are Cloudinary's offsets.
  check('the spots are Cloudinary\'s', /case 'lower-left': return \{ gravity: 'south_west', x: 40, y: 150 \}/.test(CLD) && spotOf('lower-left').x === 40 && spotOf('lower-left').y === 150
    && /case 'upper-left': return \{ gravity: 'north_west', x: 60, y: 240 \}/.test(CLD) && spotOf('upper-left').y === 240 && spotOf('anything').gravity === 'south' && spotOf(null).y === 360)
  const ll = topLeftFor('lower-left', 400, 100), ul = topLeftFor('upper-left', 400, 100), lt = topLeftFor('lower-third', 400, 100), lr = topLeftFor('lower-right', 400, 100)
  check('a corner spot sits where Cloudinary put it', Math.round(ll.xPct * FRAME_W) === 40 && Math.round(ll.yPct * FRAME_H) === FRAME_H - 100 - 150
    && Math.round(ul.xPct * FRAME_W) === 60 && Math.round(ul.yPct * FRAME_H) === 240
    && Math.round(lt.xPct * FRAME_W) === (FRAME_W - 400) / 2 && Math.round(lt.yPct * FRAME_H) === FRAME_H - 100 - 360
    && Math.round(lr.xPct * FRAME_W) === FRAME_W - 400 - 40)
  check('an overlay never runs off the frame', topLeftFor('lower-left', 2000, 100).xPct === 0 && topLeftFor('upper-right', 1080, 3000).yPct === 0)
  check('emoji are dropped as Cloudinary dropped them, accents kept', drawableCaption('LINK 🔗 IN BIO') === 'LINK IN BIO' && drawableCaption('Café') === 'Café' && drawableCaption('🔥') === 'LINK IN BIO')

  // The caption really draws, in each look, as a tight transparent image.
  for (const look of ['white-pill', 'black-pill', 'yellow-pill', 'white-shadow']) {
    const d = await drawCaption('LINK IN BIO', look)
    const m = await sharp(d.png).metadata()
    check(`the ${look} caption draws`, m.format === 'png' && m.hasAlpha === true && d.width > 250 && d.width < 700 && d.height > 40 && d.height < 160)
  }
  const long = await drawCaption('Grab this before the price goes back up, link in my bio', 'white-pill')
  check('a long caption wraps inside the frame', long.width <= FRAME_W && long.height > 120)

  // What the render server is asked for.
  const saved: string[] = []
  const save = async (_png: Buffer, key: string) => { saved.push(key); return `https://x.supabase.co/storage/v1/object/public/instagram-videos/${key}` }
  const text = await burnRequest({ text: 'LINK IN BIO', position: 'upper-left', style: 'yellow-pill', durationSec: 5 }, save, 'u1')
  check('a caption is drawn, saved and placed on the spot picked, in the Reel frame', !('error' in text) && text.frame === 'reel' && /^https:\/\/.+\/u1\/caption-[0-9a-f]{20}\.png$/.test(String(text.stickerUrl)) && text.endSec === 5
    && Math.round((text.xPct ?? 0) * FRAME_W) === 60 && Math.round((text.yPct ?? 0) * FRAME_H) === 240 && saved.length === 1)
  const again = await burnRequest({ text: 'LINK IN BIO', position: 'upper-left', style: 'yellow-pill' }, save, 'u1')
  check('the same caption is saved under the same name, and runs the whole clip by default', !('error' in again) && again.stickerUrl === (text as { stickerUrl?: string }).stickerUrl && again.endSec === 86_400)
  const dragged = await burnRequest({ text: '', stickerUrl: 'https://example.invalid/box.png', stickerWidthPct: 0.5, placement: { xPct: 0.2, yPct: 0.7 } }, save, 'u1')
  check('a dragged sticker goes exactly where the preview showed, at its own size', !('error' in dragged) && dragged.xPct === 0.2 && dragged.yPct === 0.7 && dragged.widthPct === 0.5 && dragged.frame === 'reel')
  const preset = await burnRequest({ text: '', stickerUrl: 'https://example.invalid/box.png', stickerWidthPct: 0.55, position: 'upper-left' }, save, 'u1')
  check('a sticker on a preset spot is scaled as Cloudinary did, and its spot is kept when its size cannot be read', !('error' in preset) && Math.abs((preset.widthPct ?? 0) - 0.55 * PRESET_STICKER_SCALE) < 1e-9 && preset.position === 'upper-left')

  // The render server makes the frame.
  const SRV = read('ingest-service/server.js')
  check('the render server makes the 1080x1920 frame when asked, and says so', /const reel = req\.body\?\.frame === 'reel'/.test(SRV) && /scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920/.test(SRV)
    && /const vwh = reel \? \{ w: 1080, h: 1920 \}/.test(SRV) && /frame: reel \? 'reel' : null/.test(SRV))
  check('the frame is passed through to the render server', /\.\.\.\(cta\.frame \? \{ frame: cta\.frame \} : \{\}\)/.test(read('lib/youtube-ingest.ts')))

  // Every burn screen burns there first, with the font shipped.
  const NC = read('next.config.ts')
  check('every API route ships the caption font', NC.includes(`'/api/**': ['./node_modules/@fontsource/arimo/files/*.woff']`))
  check('the Instagram Burner runs without Cloudinary', /if \(!ingestConfigured\(\) && !cloudinaryConfigured\(\)\)/.test(read('app/api/instagram/burn/route.ts')))
  const PIN = read('app/api/pinterest/video-pin/route.ts')
  check('a Pinterest video pin takes its cover from the render server before Cloudinary', /coverImageUrl = \(await videoFrameUrl\(videoUrl, 0\.5, user\.id\)\) \|\| ''/.test(PIN) && PIN.indexOf('videoFrameUrl(videoUrl') < PIN.indexOf('remoteVideoPosterUrl(videoUrl)'))

  if (fails.length) { console.error('FAIL overlay burn:\n  ' + fails.join('\n  ')); process.exit(1) }
  console.log('✅ overlay-burn: burns run on MVP\'s render server in Cloudinary\'s looks, spots and frame')
}
void run()
