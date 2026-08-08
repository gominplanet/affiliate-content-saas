// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Unit tests for the render-short pure logic (render-filters.js): silence
 * parsing, kept-range math, caption remap, and filtergraph construction. No
 * ffmpeg / service required. Run: node ingest-service/test-render-filters.js
 */
const assert = require('assert')
const {
  parseSilenceStderr, keptRanges, removedBefore, remapWords, keptSelectExpr, reframeChain,
} = require('./render-filters')

let pass = 0
function ok(name, fn) { fn(); console.log('  ✓ ' + name); pass++ }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

console.log('parseSilenceStderr — ffmpeg silencedetect stderr')
const SAMPLE = [
  '[silencedetect @ 0x1] silence_start: 3.2',
  '[silencedetect @ 0x1] silence_end: 5.6 | silence_duration: 2.4',
  '[silencedetect @ 0x1] silence_start: 12.0',
  '[silencedetect @ 0x1] silence_end: 12.05 | silence_duration: 0.05', // micro-gap → dropped
  '[silencedetect @ 0x1] silence_start: 20.0',
  '[silencedetect @ 0x1] silence_end: 40.0', // clamped to dur
].join('\n')
ok('pairs start/end in order', () => {
  const r = parseSilenceStderr(SAMPLE, 30)
  assert.strictEqual(r.length, 2) // micro-gap dropped
  assert.ok(near(r[0].s, 3.2) && near(r[0].e, 5.6))
})
ok('clamps end to dur', () => {
  const r = parseSilenceStderr(SAMPLE, 30)
  assert.ok(near(r[1].s, 20) && near(r[1].e, 30)) // 40 → 30
})
ok('garbage in → empty out', () => { assert.deepStrictEqual(parseSilenceStderr('no silence here', 30), []) })

console.log('keptRanges — complement, padding, fail-safe')
ok('complement of one middle silence', () => {
  const kept = keptRanges([{ s: 10, e: 15 }], 30)
  // pad shrinks the removed range by 0.08 each side → kept ~[0,10.08] and ~[14.92,30]
  assert.strictEqual(kept.length, 2)
  assert.ok(near(kept[0].s, 0) && near(kept[0].e, 10.08))
  assert.ok(near(kept[1].s, 14.92) && near(kept[1].e, 30))
})
ok('no silence → whole clip kept', () => {
  const kept = keptRanges([], 20)
  assert.strictEqual(kept.length, 1)
  assert.ok(near(kept[0].s, 0) && near(kept[0].e, 20))
})
ok('fail-safe: <3s left → [] (render untrimmed)', () => {
  // Silence covers almost everything, leaving < 3s → disabled.
  const kept = keptRanges([{ s: 2, e: 30 }], 30)
  assert.deepStrictEqual(kept, [])
})
ok('kept ranges are ordered + positive width', () => {
  const kept = keptRanges([{ s: 5, e: 7 }, { s: 15, e: 18 }], 30)
  for (let i = 0; i < kept.length; i++) {
    assert.ok(kept[i].e > kept[i].s)
    if (i) assert.ok(kept[i].s >= kept[i - 1].e - 1e-9)
  }
})

console.log('removedBefore + remapWords — caption timeline shift')
const REMOVED = [{ s: 5, e: 8 }, { s: 12, e: 14 }] // 3s + 2s removed
ok('removedBefore accumulates only prior silence', () => {
  assert.ok(near(removedBefore(REMOVED, 4), 0))
  assert.ok(near(removedBefore(REMOVED, 6), 1))   // inside first silence: 6-5
  assert.ok(near(removedBefore(REMOVED, 10), 3))  // past first silence
  assert.ok(near(removedBefore(REMOVED, 20), 5))  // past both
})
ok('word after both silences shifts back by 5s', () => {
  const out = remapWords([{ startSec: 16, endSec: 17, text: 'hi' }], REMOVED)
  assert.strictEqual(out.length, 1)
  assert.ok(near(out[0].startSec, 11) && near(out[0].endSec, 12))
})
ok('word inside a removed range is dropped', () => {
  const out = remapWords([{ startSec: 6, endSec: 7, text: 'gone' }], REMOVED)
  assert.strictEqual(out.length, 0)
})
ok('remapped words stay monotonic + non-negative', () => {
  const words = [
    { startSec: 1, endSec: 2, text: 'a' },
    { startSec: 9, endSec: 10, text: 'b' },
    { startSec: 16, endSec: 17, text: 'c' },
  ]
  const out = remapWords(words, REMOVED)
  let prev = -1
  for (const w of out) { assert.ok(w.startSec >= 0 && w.endSec > w.startSec && w.startSec >= prev - 1e-9); prev = w.startSec }
})
ok('no removed ranges → words unchanged', () => {
  const words = [{ startSec: 3, endSec: 4, text: 'x' }]
  assert.deepStrictEqual(remapWords(words, []), words)
})

console.log('keptSelectExpr — ffmpeg select expression')
ok('joins between() with +', () => {
  assert.strictEqual(keptSelectExpr([{ s: 0, e: 5 }, { s: 8, e: 12 }]), 'between(t,0.000,5.000)+between(t,8.000,12.000)')
})

console.log('reframeChain — filtergraph construction')
ok('center: single scale+crop to [vout]', () => {
  const g = reframeChain('[0:v]', 'center', 720, 1280, null)
  assert.ok(g.startsWith('[0:v]scale=720:1280'))
  assert.ok(g.includes('crop=720:1280'))
  assert.ok(g.endsWith('[vout]'))
  assert.ok(!g.includes('vstack'))
})
ok('split: vstack of two halves to [vout]', () => {
  const g = reframeChain('[0:v]', 'split', 720, 1280, null)
  assert.ok(g.includes('split=2[sa][sb]'))
  assert.ok(g.includes('crop=720:640')) // half height (1280/2)
  assert.ok(g.includes('pad=720:640'))
  assert.ok(g.includes('vstack=inputs=2'))
  assert.ok(g.endsWith('[vout]'))
})
ok('captions append ass= before [vout]', () => {
  const c = reframeChain('[vsel]', 'center', 720, 1280, '/tmp/x.ass')
  assert.ok(c.includes(',ass=/tmp/x.ass[vout]'))
  const s = reframeChain('[vsel]', 'split', 720, 1280, '/tmp/x.ass')
  assert.ok(s.includes('vstack=inputs=2,ass=/tmp/x.ass[vout]'))
})
ok('every filtergraph balances [ and ]', () => {
  for (const g of [
    reframeChain('[0:v]', 'center', 720, 1280, null),
    reframeChain('[0:v]', 'split', 720, 1280, '/tmp/x.ass'),
  ]) {
    assert.strictEqual((g.match(/\[/g) || []).length, (g.match(/\]/g) || []).length)
  }
})

console.log(`\n✓ All render-filter tests passed (${pass}).`)
