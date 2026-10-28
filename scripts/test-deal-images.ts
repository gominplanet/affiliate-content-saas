// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DEAL PICTURES AND DEAL STORIES ARE DRAWN BY MVP (Seb, 2026-10-28: "move
// those two away from Cloudinary as well"). Pinned: the deal card is drawn
// 1080x1080 and the Story 1080x1920, in Cloudinary's layout and colours; the
// same deal is one stored file; deal posts and deal Stories use MVP's drawing
// first and no longer stop when Cloudinary is off.
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { drawDealCard, drawStoryImage, drawLinkSticker, dealText, dealImageKey } from '../lib/deal-images'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

async function px(img: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data } = await sharp(img).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
  return [data[0], data[1], data[2]]
}
const near = (a: [number, number, number], b: [number, number, number], tol = 24) => a.every((v, i) => Math.abs(v - b[i]) <= tol)
const DARK: [number, number, number] = [14, 14, 17]
const PURPLE: [number, number, number] = [124, 58, 237]
const WHITE: [number, number, number] = [255, 255, 255]

async function run() {
  // A product photo the drawing fetches: a tall red block, so white shows beside it.
  const product = await sharp({ create: { width: 200, height: 600, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 1 } } }).png().toBuffer()
  const realFetch = globalThis.fetch
  // Only the product's address is faked; anything else (the text drawer
  // loads its own engine through fetch) goes through as normal.
  const fake = (body: () => Response) => (async (u: RequestInfo | URL, init?: RequestInit) => String(u).startsWith('https://example.com/') ? body() : realFetch(u, init)) as typeof fetch
  globalThis.fetch = fake(() => new Response(new Uint8Array(product), { status: 200, headers: { 'content-type': 'image/png' } }))
  try {
    const card = await drawDealCard('https://example.com/p.png', { headline: 'HOT DEAL', subline: 'Lowest in 90 days', brandName: 'Anker' })
    const cm = card ? await sharp(card).metadata() : null
    check('the deal card is a 1080x1080 JPEG', cm?.format === 'jpeg' && cm.width === 1080 && cm.height === 1080)
    if (card) {
      check('the card is framed on dark, the product sits on white, the hook is purple at the top', near(await px(card, 10, 10), DARK) && near(await px(card, 90, 540), WHITE) && near(await px(card, 540, 540), [220, 30, 30], 40)
        && near(await px(card, 540, 70), PURPLE, 40))
    }
    const story = await drawStoryImage('https://example.com/p.png', { headline: '50% off today', handle: '@reviewcentralhub' })
    const sm = story ? await sharp(story).metadata() : null
    check('the Story is a 1080x1920 JPEG', sm?.format === 'jpeg' && sm.width === 1080 && sm.height === 1920)
    if (story) {
      check('the Story is framed on dark with the product on white in the middle', near(await px(story, 10, 10), DARK) && near(await px(story, 70, 960), WHITE) && near(await px(story, 540, 960), [220, 30, 30], 40))
    }
    globalThis.fetch = fake(() => new Response('no', { status: 404 }))
    check('a product photo that cannot be read draws nothing, so the caller falls back', (await drawDealCard('https://example.com/gone.png')) === null && (await drawStoryImage('https://example.com/gone.png')) === null)
  } finally { globalThis.fetch = realFetch }

  const sticker = await drawLinkSticker()
  check('the LINK IN BIO sticker is about 520 wide and tilted', sticker.width >= 520 && sticker.width < 560 && sticker.height > 150)
  check('a % is drawn now, emoji are not', dealText('50% OFF 🔥 today', 40) === '50% OFF today' && dealText('x'.repeat(60), 22).length === 22)
  check('the same deal is one stored file, a different one is another', dealImageKey('card', 'u', { headline: 'A' }) === dealImageKey('card', 'u', { headline: 'A' }) && dealImageKey('card', 'u', { headline: 'A' }) !== dealImageKey('story', 'u', { headline: 'A' }) && /^deal-images\/card-[0-9a-f]{24}\.jpg$/.test(dealImageKey('card', 'u', {})))

  const DC = read('lib/deal-card.ts'), DS = read('lib/deal-story-publish.ts')
  check('deal posts draw the card with MVP first, Cloudinary only after', /const drawn = await dealCardUrl\(imageUrl, opts\)/.test(DC) && /return cloudinaryConfigured\(\) \? renderDealCard\(imageUrl, opts\) : null/.test(DC) && !/if \(!imageUrl \|\| !cloudinaryConfigured\(\)\) return null/.test(DC))
  check('deal Stories draw with MVP first and no longer stop when Cloudinary is off', /const storyImage = \(await storyImageUrl\(deal\.imageUrl, look\)\)/.test(DS) && !/if \(!cloudinaryConfigured\(\)\) return/.test(DS))
  check('the Story errors read without dashes', !/[–—]/.test(DS.match(/error: ['"`][^'"`]*['"`]/g)?.join(' ') ?? ''))

  if (fails.length) { console.error('FAIL deal images:\n  ' + fails.join('\n  ')); process.exit(1) }
  console.log('✅ deal-images: deal pictures and deal Stories are drawn by MVP in Cloudinary\'s layout')
}
void run()
