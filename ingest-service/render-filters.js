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
function reframeChain(inLabel, mode, W, H, assPath) {
  const cap = assPath ? `,ass=${assPath}` : ''
  if (mode === 'split') {
    const bottomH = 2 * Math.round((W * 9 / 16) / 2) // full 16:9 frame at width W
    const topH = H - bottomH                          // zoom crop fills the remainder
    return (
      `${inLabel}split=2[sa][sb];` +
      `[sa]scale=${W}:${topH}:force_original_aspect_ratio=increase,crop=${W}:${topH}[stop];` +
      `[sb]scale=${W}:${bottomH}[sbot];` +
      `[stop][sbot]vstack=inputs=2${cap}[vout]`
    )
  }
  return `${inLabel}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}${cap}[vout]`
}

module.exports = { reframeChain }
