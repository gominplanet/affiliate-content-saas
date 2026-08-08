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

console.log(`\n✓ All reframe-filter tests passed (${pass}).`)
