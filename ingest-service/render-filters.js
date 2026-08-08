// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Pure helpers for the render-short pipeline: silence parsing, kept-range math,
 * caption-timing remap, and FFmpeg filtergraph construction. Split out of
 * server.js so the tricky, non-FFmpeg logic can be unit-tested directly
 * (test-render-filters.js) without spinning up the service or ffmpeg.
 */

// Parse `silencedetect` stderr into CLIP-RELATIVE removed ranges. ffmpeg logs
// `silence_start:` and `silence_end:` on separate lines; we pair them in order
// and clamp to [0, dur]. Micro-gaps (< 0.15s) are ignored.
function parseSilenceStderr(text, dur) {
  const s = String(text || '')
  const starts = [...s.matchAll(/silence_start:\s*([0-9.]+)/g)].map(m => parseFloat(m[1]))
  const ends = [...s.matchAll(/silence_end:\s*([0-9.]+)/g)].map(m => parseFloat(m[1]))
  const ranges = []
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    const a = Math.max(0, starts[i])
    const b = Math.min(dur, ends[i])
    if (b - a > 0.15) ranges.push({ s: a, e: b })
  }
  return ranges
}

// Kept (non-silent) ranges = complement of `removed` within [0, dur], padded so
// cuts don't clip word onsets. Returns [] when trimming would leave < 3s (the
// fail-safe that disables trimming on pathological input).
function keptRanges(removed, dur) {
  const pad = 0.08
  const rem = removed
    .map(r => ({ s: Math.min(dur, r.s + pad), e: Math.max(0, r.e - pad) }))
    .filter(r => r.e - r.s > 0.15)
  const kept = []
  let cursor = 0
  for (const r of rem.sort((a, b) => a.s - b.s)) {
    if (r.s > cursor) kept.push({ s: cursor, e: r.s })
    cursor = Math.max(cursor, r.e)
  }
  if (cursor < dur) kept.push({ s: cursor, e: dur })
  const total = kept.reduce((a, r) => a + (r.e - r.s), 0)
  return total >= 3 ? kept.filter(r => r.e - r.s > 0.05) : []
}

// Total removed-silence duration occurring before clip-time `t`.
function removedBefore(removed, t) {
  let x = 0
  for (const r of removed) { if (r.s < t) x += Math.min(r.e, t) - r.s }
  return Math.max(0, x)
}

// Remap caption words onto the compressed (post-trim) timeline. Words entirely
// inside a removed range are dropped (they were silent anyway).
function remapWords(words, removed) {
  if (!removed.length) return words
  const out = []
  for (const w of words) {
    const inside = removed.some(r => w.startSec >= r.s - 0.01 && w.endSec <= r.e + 0.01)
    if (inside) continue
    const ns = w.startSec - removedBefore(removed, w.startSec)
    const ne = w.endSec - removedBefore(removed, w.endSec)
    if (ne > ns) out.push({ ...w, startSec: Math.max(0, ns), endSec: Math.max(0, ne) })
  }
  return out
}

// A between()-OR expression selecting the kept ranges (for select/aselect).
function keptSelectExpr(kept) {
  return kept.map(r => `between(t,${r.s.toFixed(3)},${r.e.toFixed(3)})`).join('+')
}

// Build the video reframe sub-chain from an input label to [vout], optionally
// burning captions. mode: 'center' (center-crop) or 'split' (top = center-crop
// zoom, bottom = full horizontal frame letterboxed).
function reframeChain(inLabel, mode, W, H, assPath) {
  const cap = assPath ? `,ass=${assPath}` : ''
  if (mode === 'split') {
    const half = Math.round(H / 2 / 2) * 2
    return (
      `${inLabel}split=2[sa][sb];` +
      `[sa]scale=${W}:${half}:force_original_aspect_ratio=increase,crop=${W}:${half}[stop];` +
      `[sb]scale=${W}:-2,pad=${W}:${half}:(ow-iw)/2:(oh-ih)/2:black[sbot];` +
      `[stop][sbot]vstack=inputs=2${cap}[vout]`
    )
  }
  return `${inLabel}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}${cap}[vout]`
}

module.exports = { parseSilenceStderr, keptRanges, removedBefore, remapWords, keptSelectExpr, reframeChain }
