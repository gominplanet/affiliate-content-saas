// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Unit tests for the reframe filtergraph (render-filters.js). No ffmpeg / service
 * required. Run: node ingest-service/test-render-filters.js
 */
const assert = require('assert')
const { reframeChain } = require('./render-filters')

let pass = 0
function ok(name, fn) { fn(); console.log('  ✓ ' + name); pass++ }

console.log('reframeChain — center')
ok('single scale+crop to [vout]', () => {
  const g = reframeChain('[0:v]', 'center', 720, 1280, null)
  assert.ok(g.startsWith('[0:v]scale=720:1280'))
  assert.ok(g.includes('crop=720:1280'))
  assert.ok(g.endsWith('[vout]'))
  assert.ok(!g.includes('vstack'))
})

console.log('reframeChain — split (seamless, no bars)')
ok('vstack of two halves to [vout]', () => {
  const g = reframeChain('[0:v]', 'split', 720, 1280, null)
  assert.ok(g.includes('split=2[sa][sb]'))
  assert.ok(g.includes('vstack=inputs=2'))
  assert.ok(g.endsWith('[vout]'))
})
ok('no padding / no black bars', () => {
  const g = reframeChain('[0:v]', 'split', 720, 1280, null)
  assert.ok(!g.includes('pad='), 'split must not letterbox-pad')
  assert.ok(!/black/i.test(g))
})
ok('top + bottom heights sum to H exactly (seamless)', () => {
  const W = 720, H = 1280
  const g = reframeChain('[0:v]', 'split', W, H, null)
  const bottomH = 2 * Math.round((W * 9 / 16) / 2) // 406
  const topH = H - bottomH                          // 874
  assert.ok(g.includes(`crop=${W}:${topH}`), `top crop should be ${W}:${topH}`)
  assert.ok(g.includes(`scale=${W}:${bottomH}[sbot]`), `bottom should be full ${W}:${bottomH}`)
  assert.strictEqual(topH + bottomH, H)
  assert.strictEqual(topH % 2, 0)
  assert.strictEqual(bottomH % 2, 0)
})

console.log('reframeChain — captions')
ok('captions append ass= before [vout] (center + split)', () => {
  assert.ok(reframeChain('[0:v]', 'center', 720, 1280, '/tmp/x.ass').includes(',ass=/tmp/x.ass[vout]'))
  assert.ok(reframeChain('[0:v]', 'split', 720, 1280, '/tmp/x.ass').includes('vstack=inputs=2,ass=/tmp/x.ass[vout]'))
})
ok('every filtergraph balances [ and ]', () => {
  for (const g of [
    reframeChain('[0:v]', 'center', 720, 1280, null),
    reframeChain('[0:v]', 'split', 720, 1280, '/tmp/x.ass'),
  ]) {
    assert.strictEqual((g.match(/\[/g) || []).length, (g.match(/\]/g) || []).length)
  }
})

console.log('reframeChain — crop position')
ok('no cropX keeps the exact centre crop, unchanged', () => {
  assert.ok(reframeChain('[0:v]', 'center', 720, 1280, null).endsWith('crop=720:1280[vout]'))
})
ok('cropX moves the window across the frame (0 left, 1 right)', () => {
  assert.ok(reframeChain('[0:v]', 'center', 720, 1280, null, 0.3).includes('crop=720:1280:(iw-ow)*0.3:(ih-oh)/2[vout]'))
  assert.ok(reframeChain('[0:v]', 'split', 720, 1280, null, 0).includes(':(iw-ow)*0:(ih-oh)/2[stop]'))
})
ok('a cropX outside 0 to 1 is ignored', () => {
  const { cropAt } = require('./render-filters')
  assert.strictEqual(cropAt(1.5), ''); assert.strictEqual(cropAt('x'), ''); assert.strictEqual(cropAt(undefined), '')
})

console.log('buildAss: hook card and power words')
const { buildAss, keepSegments, trimFilters } = require('./render-filters')
const W3 = [{ startSec: 0.2, endSec: 0.6, text: 'costs' }, { startSec: 0.6, endSec: 1.0, text: '$40', hl: true }]
ok('the hook opens the clip on its own style, then fades', () => {
  const a = buildAss(W3, { hook: 'This beats a {500} amp' })
  assert.ok(/Style: Hook,/.test(a))
  assert.ok(/Dialogue: 1,0:00:00\.00,0:00:02\.40,Hook,,0,0,0,,\{\\fad\(120,250\)\}THIS BEATS A 500 AMP/.test(a), 'hook event with braces stripped')
})
ok('no hook, no hook event', () => { assert.ok(!/,Hook,,/.test(buildAss(W3))) })
ok('a hook alone (captions off) still makes a valid script', () => { const a = buildAss([], { hook: 'Hi' }); assert.ok(/,Hook,,/.test(a) && !/,Cap,,/.test(a)) })
ok('a power word is coloured when it is not the spoken word', () => {
  const a = buildAss(W3)
  assert.ok(a.includes('{\\c&H0066FF33&}$40{\\r}'), 'green $40 while "costs" is spoken')
})

console.log('caption looks: the one the creator picked')
{
  const { LOOKS, lookFor, assColour } = require('./render-filters')
  const capOf = (a) => (a.match(/^Style: Cap,.*$/m) || [''])[0]
  ok('the five looks Clip Factory offers each draw their own caption style', () => {
    assert.deepStrictEqual(Object.keys(LOOKS).sort(), ['bold-white', 'brand', 'hype', 'outline', 'yellow-pop'])
    const caps = Object.keys(LOOKS).map((st) => capOf(buildAss(W3, { style: st, brandColor: '#0E7C66' })))
    assert.strictEqual(new Set(caps).size, 5, caps.join('\n'))
  })
  ok('Bold white is the look every clip had, exactly, and an unknown or missing style is Bold white', () => {
    const was = 'Style: Cap,Anton,108,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,0,0,0,0,100,100,2,0,1,8,4,2,120,120,520,1'
    assert.strictEqual(capOf(buildAss(W3)), was)
    assert.strictEqual(buildAss(W3, { style: 'bold-white' }), buildAss(W3))
    assert.strictEqual(buildAss(W3, { style: 'nope' }), buildAss(W3))
  })
  ok('Yellow pop is yellow on a dark box', () => { assert.ok(/^Style: Cap,Anton,100,&H0000D4FF,&H000000FF,&H00111111,&H90000000,(\d+,){8}3,/m.test(buildAss(W3, { style: 'yellow-pop' }))) })
  ok('Outline is white with a black outline in Poppins, as spoken (not capitals), power words not coloured', () => {
    const a = buildAss(W3, { style: 'outline' })
    assert.ok(/^Style: Cap,Poppins ExtraBold,98,&H00FFFFFF,&H000000FF,&H00000000,/m.test(a) && /,costs\{\\r\}|\}costs\{\\r\}/.test(a) && !a.includes('&H0066FF33&'))
  })
  ok('Hype is big yellow capitals, two words a line, the spoken word white', () => {
    const a = buildAss(W3, { style: 'hype' })
    assert.ok(/^Style: Cap,Anton,128,&H0000D4FF,/m.test(a) && a.includes('\\c&H00FFFFFF&\\fscx130') && LOOKS.hype.words === 2)
  })
  ok('Brand is a box in the creator’s brand colour, text that reads on it, and the hook card in it too', () => {
    const a = buildAss(W3, { style: 'brand', brandColor: '#0E7C66', hook: 'hi' })
    assert.ok(/^Style: Cap,Poppins ExtraBold,94,&H00FFFFFF,&H000000FF,&H00667C0E,/m.test(a), capOf(a))
    assert.ok(/^Style: Hook,Poppins ExtraBold,84,&H00FFFFFF,&H000000FF,&H00667C0E,/m.test(a))
    assert.ok(a.includes('{\\1a&H60&}'), 'words not being spoken are see-through')
    assert.strictEqual(lookFor('brand', '#FFE14D').fill, '#111111', 'dark text on a light brand colour')
    assert.strictEqual(lookFor('brand', null).edge, '#7C3AED', 'MVP violet with no brand colour saved')
    assert.strictEqual(lookFor('brand', 'red').edge, '#7C3AED', 'anything but a colour is not used')
    assert.strictEqual(assColour('#0E7C66'), '&H00667C0E')
  })
  const S = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf8')
  ok('the clip render passes the creator’s look and brand colour to the captions', () => {
    assert.ok(/buildAss\(words, \{ hook, style: typeof body\?\.style === 'string' \? body\.style : undefined, brandColor: typeof body\?\.brandColor === 'string' \? body\.brandColor : undefined \}\)/.test(S))
  })
  const DF = require('fs').readFileSync(require('path').join(__dirname, 'Dockerfile'), 'utf8')
  ok('the server image installs both caption fonts', () => { assert.ok(/Anton-Regular\.ttf/.test(DF) && /Poppins-ExtraBold\.ttf/.test(DF)) })
}

console.log('trim silences: keep-segments')
ok('clean ordered segments pass, one segment is nothing to cut', () => {
  assert.deepStrictEqual(keepSegments([[0, 1.5], [2, 4]], 10), [[0, 1.5], [2, 4]])
  assert.strictEqual(keepSegments([[0, 4]], 10), null)
  assert.strictEqual(keepSegments('x', 10), null)
})
ok('overlapping segments are not trusted', () => { assert.strictEqual(keepSegments([[0, 3], [2, 4]], 10), null) })
ok('segments are clamped to the clip', () => { assert.deepStrictEqual(keepSegments([[0, 1], [2, 99]], 10), [[0, 1], [2, 10]]) })
ok('select and aselect keep the same stretches, quoted', () => {
  const t = trimFilters([[0, 1], [2, 3.5]])
  assert.strictEqual(t.v, "select='between(t,0,1)+between(t,2,3.5)',setpts=N/FRAME_RATE/TB")
  assert.strictEqual(t.a, "aselect='between(t,0,1)+between(t,2,3.5)',asetpts=N/SR/TB")
  assert.strictEqual(t.seconds, 2.5)
})

console.log(`\n✓ All reframe-filter tests passed (${pass}).`)
