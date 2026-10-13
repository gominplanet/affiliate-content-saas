// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The TikTok window's "also post to" platforms (Seb, 2026-10-13): a Pinterest
// video pin ticked after TikTok never appeared, and the YouTube Short got the
// TikTok caption with no product link.

import { readFileSync } from 'node:fs'
import { composeClipDescription, CLIP_PLATFORM_RULES } from '../lib/clip-description'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const modal = read('components/TikTokDirectModal.tsx')
const cf = read('components/clip-factory/ClipFactory.tsx')
const route = read('app/api/pinterest/video-pin/route.ts')
const lib = read('lib/pinterest-video-pin.ts')

// The window no longer closes on TikTok alone.
check('TikTok going live no longer calls onPosted directly', !/if \(onPosted\) onPosted\(\)/.test(modal) && (modal.match(/setTtLive\(true\)/g) ?? []).length === 2)
check('onPosted waits for every other platform and says if one failed', /if \(results\.includes\('posting'\)\) return/.test(modal) && /onPosted\?\.\(\{ crossFailed: results\.includes\('failed'\) \}\)/.test(modal))
check('Clip Factory and the Shorts studio stay open when one failed', /if \(!o\?\.crossFailed\) setTtOpen\(false\)/.test(cf) && /if \(!o\?\.crossFailed\) setTtPost\(null\)/.test(read('components/content/ShortsStudioModal.tsx')))

// Pinterest's slow processing never ends in a timeout.
check('the route waits about 90 seconds, then answers what is needed to finish', /Date\.now\(\) \+ 90_000/.test(route) && /pending: true, status, finish \}, \{ status: 202 \}/.test(route))
check('finishing keeps the redirect-link rule and the plan check', /function finishPin/.test(route) && /isBlockedPinLink\(link\)/.test(route.slice(route.indexOf('function finishPin'))) && /tierAllowsSocial\(tier, 'pinterest'\)/.test(route.slice(route.indexOf('function finishPin'))))
check('the page keeps finishing for up to 10 minutes and says so when it gives up', /10 \* 60_000/.test(lib) && /still processing the video after 10 minutes, so no pin was made/.test(lib))
check('both video pin buttons use it', /postVideoPin\(/.test(modal) && /postVideoPin\(/.test(read('components/PinterestPreviewModal.tsx')) && !/fetch\('\/api\/pinterest\/video-pin'/.test(modal))
check('no video file is said, not skipped', /MVP has no video file for this clip to send to Pinterest/.test(modal))
check('a pin names its board', /on your "\$\{pinBoard\}" board/.test(modal))

// The Short gets YouTube's own text.
const yt = composeClipDescription({
  platform: 'youtube', writeUp: 'This tripod follows your face.\nLink in bio', include: CLIP_PLATFORM_RULES.youtube.defaults,
  productLink: 'https://amzn.to/abc', amazon: true, videoUrl: 'https://youtu.be/xyz', blogUrl: null, linkHub: null, hashtags: ['tripod'], disclosure: 'As an Amazon Associate I earn from qualifying purchases.',
})
check('the YouTube description carries the product link and the disclosure', yt.includes('https://amzn.to/abc') && /Amazon Associate/.test(yt))
check('Clip Factory hands the TikTok window the Short\'s own text', /prepareYouTube=\{prepareYouTubeFromTikTok\}/.test(cf) && /platform: 'youtube', writeUp: publishCaption, include: CLIP_PLATFORM_RULES\.youtube\.defaults/.test(cf))
check('the window posts that text, and stops the Short when it cannot be written', /description: own\?\.description \?\? caption/.test(modal) && /if \(own && 'error' in own\) throw new Error\(own\.error\)/.test(modal))
check('a Short without a product link says so', /without a product link \(MVP found none for this clip/.test(cf) && /ytNote/.test(modal))
check('the YouTube pill shows posted after the window posts the Short', /onYouTubePosted=\{\(id\) => \{ setPosted\(p => \(\{ \.\.\.p, youtube: true \}\)\)/.test(cf))

if (failures.length) {
  console.error('❌ cross-post guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ cross-post guard passed')
