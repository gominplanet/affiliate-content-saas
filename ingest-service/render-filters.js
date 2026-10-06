// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Pure helpers for the render-short pipeline: the FFmpeg reframe filtergraph.
 * Split out of server.js so it can be unit-tested directly
 * (test-render-filters.js) without spinning up the service or ffmpeg.
 */

// Build the video reframe sub-chain from an input label to [vout], optionally
// burning captions. mode:
//   'center' — center-crop fill to W x H.
//   'split'  — SEAMLESS split: the bottom shows the full 16:9 frame at its
//              natural height, the top is a center-crop zoom filling the rest.
//              No letterbox bars (top+bottom heights sum to H exactly).
// cropX (optional, 0 to 1): where the crop window sits across the frame, 0 the
// left edge, 1 the right. Unset keeps the exact centre, as before.
function cropAt(cropX) {
  const x = Number(cropX)
  return Number.isFinite(x) && x >= 0 && x <= 1 ? `:(iw-ow)*${Math.round(x * 1000) / 1000}:(ih-oh)/2` : ''
}
function reframeChain(inLabel, mode, W, H, assPath, cropX) {
  const cap = assPath ? `,ass=${assPath}` : ''
  const at = cropAt(cropX)
  if (mode === 'split') {
    const bottomH = 2 * Math.round((W * 9 / 16) / 2) // full 16:9 frame at width W
    const topH = H - bottomH                          // zoom crop fills the remainder
    return (
      `${inLabel}split=2[sa][sb];` +
      `[sa]scale=${W}:${topH}:force_original_aspect_ratio=increase,crop=${W}:${topH}${at}[stop];` +
      `[sb]scale=${W}:${bottomH}[sbot];` +
      `[stop][sbot]vstack=inputs=2${cap}[vout]`
    )
  }
  return `${inLabel}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}${at}${cap}[vout]`
}

module.exports = { reframeChain, cropAt }
