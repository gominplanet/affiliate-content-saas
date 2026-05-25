/* MVP Affiliate — Co-Pilot Helper · background service worker
 *
 * Bridges MVP's web dashboard (mvpaffiliate.io) to a real YouTube frame.
 * The dashboard messages us via externally_connectable; we open the watch
 * page, let the player render, grab a frame off the <video> element, and hand
 * the data URL back. This is the "videoStill" the thumbnail generator grounds
 * on — the creator + product as they actually appear in the video.
 *
 * NOTE: the CC-Scout popup/content flow is untouched; this only adds the
 * frame-capture path. The capture tab is opened FOREGROUND on purpose —
 * Chrome throttles video rendering in hidden/background tabs, which yields
 * black frames, so a brief visible tab is the reliable trade-off.
 */

const CAPTURE_TIMEOUT_MS = 30000

// Self-contained capture routine injected into the YouTube tab. Must not
// reference anything outside its own scope (it's serialized + injected).
async function grabFrameInPage(seekFraction) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const deadline = Date.now() + 25000

  // 1. Wait for the player's <video> with real duration.
  let video = null
  while (Date.now() < deadline) {
    video = document.querySelector('video.html5-main-video') || document.querySelector('video')
    if (video && isFinite(video.duration) && video.duration > 0) break
    await sleep(300)
  }
  if (!video || !isFinite(video.duration) || video.duration <= 0) {
    return { ok: false, error: 'no-video' }
  }

  try { video.setAttribute('crossorigin', 'anonymous') } catch (e) {}
  video.muted = true
  try { await video.play() } catch (e) {}

  // 2. Skip / wait out a pre-roll ad so we capture real content.
  const adDeadline = Date.now() + 12000
  while (Date.now() < adDeadline) {
    const player = document.querySelector('.html5-video-player')
    const adShowing = player && player.classList.contains('ad-showing')
    if (!adShowing) break
    const skip = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern')
    if (skip) { try { skip.click() } catch (e) {} }
    await sleep(500)
  }

  // 3. Seek to the requested point and wait for the frame to settle.
  const target = Math.max(1, Math.min(video.duration - 0.5, (seekFraction || 0.5) * video.duration))
  await new Promise((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    video.addEventListener('seeked', finish, { once: true })
    try { video.currentTime = target } catch (e) { finish() }
    setTimeout(finish, 4000)
  })
  // Let the decoded frame actually paint.
  if (video.requestVideoFrameCallback) {
    await new Promise((resolve) => {
      let settled = false
      video.requestVideoFrameCallback(() => { settled = true; resolve() })
      setTimeout(() => { if (!settled) resolve() }, 1200)
    })
  } else {
    await sleep(600)
  }

  // 4. Draw to a 1280×720 canvas and export.
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')
    // Cover-fit the video frame into 16:9.
    const vw = video.videoWidth || 1280
    const vh = video.videoHeight || 720
    const scale = Math.max(canvas.width / vw, canvas.height / vh)
    const dw = vw * scale
    const dh = vh * scale
    ctx.drawImage(video, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    if (!dataUrl || dataUrl.length < 2000) return { ok: false, error: 'blank-frame' }
    return { ok: true, dataUrl }
  } catch (e) {
    // SecurityError = tainted canvas (shouldn't happen for MSE blobs, but guard).
    return { ok: false, error: 'capture-failed:' + (e && e.message ? e.message : 'unknown') }
  }
}

async function captureYouTubeFrame({ youtubeVideoId, seekFraction }) {
  if (!youtubeVideoId || !/^[a-zA-Z0-9_-]{6,20}$/.test(youtubeVideoId)) {
    return { ok: false, error: 'bad-video-id' }
  }
  let tabId = null
  const url = `https://www.youtube.com/watch?v=${youtubeVideoId}`
  try {
    const tab = await chrome.tabs.create({ url, active: true })
    tabId = tab.id

    // Wait for the tab to finish loading.
    await new Promise((resolve) => {
      const onUpdated = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated)
          resolve()
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated)
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve() }, 15000)
    })

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: grabFrameInPage,
      args: [typeof seekFraction === 'number' ? seekFraction : 0.5],
    })
    const out = results && results[0] && results[0].result
    return out || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'capture-exception' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// ── Messages from the MVP dashboard (externally_connectable) ────────────────
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return
  if (msg.type === 'MVP_PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version })
    return // sync response
  }
  if (msg.type === 'MVP_CAPTURE_FRAME') {
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), CAPTURE_TIMEOUT_MS)
    captureYouTubeFrame({ youtubeVideoId: msg.youtubeVideoId, seekFraction: msg.seekFraction })
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
}
)
