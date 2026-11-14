// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE CAPTION LOOK THE CREATOR PICKS IS THE LOOK THE RENDER SERVER DRAWS (Seb,
// 2026-11-14: "yes", to drawing Bold white, Yellow pop, Outline, Hype and
// Brand on MVP's own render server; the choice never reached it, and every
// clip came out Bold white).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const RF = require_('../ingest-service/render-filters.js') as {
  buildAss: (cues: unknown[], opts?: Record<string, unknown>) => string
  LOOKS: Record<string, { words: number }>
  lookFor: (style: string, brand?: string | null) => { fill: string; edge: string }
  assColour: (hex: string) => string
}
const { buildAss, LOOKS, lookFor, assColour } = RF

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail).slice(0, 300)}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')

const W3 = [{ startSec: 0.2, endSec: 0.6, text: 'costs' }, { startSec: 0.6, endSec: 1.0, text: '$40', hl: true }]
const capOf = (a: string) => (a.match(/^Style: Cap,.*$/m) || [''])[0]

check('the five looks Clip Factory offers are the five the server draws', JSON.stringify(Object.keys(LOOKS).sort()) === JSON.stringify(['bold-white', 'brand', 'hype', 'outline', 'yellow-pop']))
const caps = Object.keys(LOOKS).map((st) => capOf(buildAss(W3, { style: st, brandColor: '#0E7C66' })))
check('each look draws its own caption style', new Set(caps).size === 5, caps)
check('Bold white is the look every clip had, exactly; an unknown or missing style is Bold white',
  capOf(buildAss(W3)) === 'Style: Cap,Anton,108,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,0,0,0,0,100,100,2,0,1,8,4,2,120,120,520,1'
  && buildAss(W3, { style: 'bold-white' }) === buildAss(W3) && buildAss(W3, { style: 'nope' }) === buildAss(W3))
check('Yellow pop is yellow on a dark box', /^Style: Cap,Anton,100,&H0000D4FF,&H000000FF,&H00111111,&H90000000,(\d+,){8}3,/m.test(buildAss(W3, { style: 'yellow-pop' })))
const outline = buildAss(W3, { style: 'outline' })
check('Outline is white with a black outline in Poppins, as spoken, power words not coloured',
  /^Style: Cap,Poppins ExtraBold,98,&H00FFFFFF,&H000000FF,&H00000000,/m.test(outline) && outline.includes('}costs{\\r}') && !outline.includes('&H0066FF33&'))
const hype = buildAss(W3, { style: 'hype' })
check('Hype is big yellow capitals, two words a line, the spoken word white', /^Style: Cap,Anton,128,&H0000D4FF,/m.test(hype) && hype.includes('\\c&H00FFFFFF&\\fscx130') && LOOKS.hype.words === 2)
const brand = buildAss(W3, { style: 'brand', brandColor: '#0E7C66', hook: 'hi' })
check('Brand is a box in the creator’s colour with text that reads on it, the hook card too',
  /^Style: Cap,Poppins ExtraBold,94,&H00FFFFFF,&H000000FF,&H00667C0E,/m.test(brand) && /^Style: Hook,Poppins ExtraBold,84,&H00FFFFFF,&H000000FF,&H00667C0E,/m.test(brand), capOf(brand))
check('in Brand the words not being spoken are see-through', brand.includes('{\\1a&H60&}'))
check('dark text on a light brand colour, MVP violet with none saved, nothing but a colour is used',
  lookFor('brand', '#FFE14D').fill === '#111111' && lookFor('brand', null).edge === '#7C3AED' && lookFor('brand', 'red').edge === '#7C3AED' && assColour('#0E7C66') === '&H00667C0E')

const S = read('ingest-service/server.js')
check('the clip render passes the creator’s look and brand colour to the captions',
  /buildAss\(words, \{ hook, style: typeof body\?\.style === 'string' \? body\.style : undefined, brandColor: typeof body\?\.brandColor === 'string' \? body\.brandColor : undefined \}\)/.test(S))
check('the server image installs both caption fonts', /Anton-Regular\.ttf/.test(read('ingest-service/Dockerfile')) && /Poppins-ExtraBold\.ttf/.test(read('ingest-service/Dockerfile')))

if (fails.length) { console.error(`❌ caption-looks: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
console.log('✅ caption-looks: Bold white, Yellow pop, Outline, Hype and Brand are each drawn by the render server, Bold white unchanged, Brand in the creator’s colour')
