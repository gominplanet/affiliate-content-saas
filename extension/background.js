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

const CAPTURE_TIMEOUT_MS = 120000

// Self-contained capture routine injected into the YouTube tab. Captures a
// frame at EACH fraction in one page visit. Must not reference anything outside
// its own scope (it's serialized + injected).
async function grabFramesInPage(fractions) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const deadline = Date.now() + 15000

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

  // YouTube serves ads (pre-roll AND mid-roll, often triggered by seeking) in
  // the same <video> element, flagged by .ad-showing / .ad-interrupting on the
  // player. We must NEVER capture during an ad — that'd put an advertiser's
  // footage/branding in the thumbnail or article.
  const isAdShowing = () => {
    const p = document.querySelector('.html5-video-player')
    return !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')))
      || !!document.querySelector('.video-ads .ytp-ad-player-overlay, .video-ads .ytp-ad-player-overlay-layout')
  }
  // Click skip if offered, otherwise wait the ad out. Returns true if the ad
  // cleared within `ms`, false if it's still showing.
  const waitOutAds = async (ms) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if (!isAdShowing()) return true
      const skip = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button')
      if (skip) { try { skip.click() } catch (e) {} }
      await sleep(500)
    }
    return !isAdShowing()
  }

  // 2. Break pre-roll ads on monetized / published videos.
  // During a pre-roll, video.currentTime controls the AD's timeline, not the
  // main video — seeking doesn't help. Instead we click the main player's
  // progress bar, which forces YouTube's player to exit the ad and seek into
  // the actual content. We also hammer the skip button every loop iteration.
  const tryBreakAd = () => {
    // Click skip button (fastest path for skippable ads)
    const skip = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button')
    if (skip) { try { skip.click() } catch (e) {} }
    // Click ~5% into the main progress bar — exits the ad and seeks to content
    const bar = document.querySelector('.ytp-progress-bar-container')
    if (bar) {
      try {
        const r = bar.getBoundingClientRect()
        const cx = r.left + r.width * 0.05
        const cy = r.top + r.height / 2
        bar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
        bar.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
        bar.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
      } catch (e) {}
    }
  }
  if (isAdShowing()) {
    tryBreakAd()
    await sleep(1000)
    // If still showing after the click attempt, keep trying — non-skippable ads
    // run up to 30s; skippable ones become skippable after ~5s.
    if (isAdShowing()) await waitOutAds(45000)
  }

  // 2b. Wait for the player to ramp to HD. A freshly-opened tab serves low-res
  // first, and setPlaybackQuality is a no-op now, so just poll videoWidth.
  const hdDeadline = Date.now() + 8000
  while (Date.now() < hdDeadline) {
    if (video.videoWidth >= 1280) break
    await sleep(400)
  }

  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')

  const captureNow = () => {
    if (isAdShowing()) return null // never capture an ad frame
    const vw = video.videoWidth || 0
    const vh = video.videoHeight || 0
    if (vw < 854) return null // reject sub-480p (loading/garbage) frames
    // Crop ~3% off every edge to drop any residual player chrome / letterbox.
    const cropX = vw * 0.03
    const cropY = vh * 0.03
    const sW = vw - cropX * 2
    const sH = vh - cropY * 2
    const scale = Math.max(canvas.width / sW, canvas.height / sH)
    const dw = sW * scale
    const dh = sH * scale
    ctx.drawImage(video, cropX, cropY, sW, sH, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    return dataUrl && dataUrl.length > 2000 ? dataUrl : null
  }

  const frames = []
  for (const f of fractions) {
    // Seek to this fraction, but never within the last 25s — that's the
    // end-screen card zone (the stray blue box). Wait for the frame to settle.
    const tail = 25
    const safeMax = Math.max(1, video.duration - tail)
    const target = Math.min(safeMax, Math.max(1, f * video.duration))
    await new Promise((resolve) => {
      let done = false
      const finish = () => { if (!done) { done = true; resolve() } }
      video.addEventListener('seeked', finish, { once: true })
      try { video.currentTime = target } catch (e) { finish() }
      setTimeout(finish, 5000)
    })
    if (video.requestVideoFrameCallback) {
      await new Promise((resolve) => {
        let settled = false
        video.requestVideoFrameCallback(() => { settled = true; resolve() })
        setTimeout(() => { if (!settled) resolve() }, 1200)
      })
    } else {
      await sleep(600)
    }
    // Seeking can trigger a mid-roll ad — wait it out, and if it won't clear,
    // skip this fraction entirely rather than capture the ad.
    if (isAdShowing()) {
      const cleared = await waitOutAds(8000)
      if (!cleared) continue
      // After an ad, the player may reset to low-res — let it ramp back.
      const reDeadline = Date.now() + 4000
      while (Date.now() < reDeadline) { if (video.videoWidth >= 1280) break; await sleep(400) }
    }
    try {
      const d = captureNow()
      if (d) frames.push(d)
    } catch (e) { /* tainted/blank — skip this fraction */ }
  }

  if (frames.length === 0) return { ok: false, error: 'no-frames' }
  return { ok: true, frames }
}

async function captureYouTubeFrames({ youtubeVideoId, fractions, callerTabId }) {
  if (!youtubeVideoId || !/^[a-zA-Z0-9_-]{6,20}$/.test(youtubeVideoId)) {
    return { ok: false, error: 'bad-video-id' }
  }
  const fracs = Array.isArray(fractions) && fractions.length
    ? fractions.filter((n) => typeof n === 'number' && n > 0 && n < 1).slice(0, 8)
    : [0.5]
  let tabId = null
  // &mute=1 silences the tab immediately; &vq=hd1080 nudges YouTube to HD.
  const url = `https://www.youtube.com/watch?v=${youtubeVideoId}&mute=1&vq=hd1080`
  try {
    // Open foreground so Chrome initialises the video player at full priority
    // (background tabs get throttled timers and deferred media loading).
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

    // Page is loaded — switch the user straight back to MVP. Chrome keeps the
    // video running and allows canvas captures even in a background tab, so all
    // the seeking + frame grabs below happen silently while the user stays on
    // the app. requestVideoFrameCallback fires regardless of tab visibility.
    if (callerTabId != null) {
      try { await chrome.tabs.update(callerTabId, { active: true }) } catch (e) {}
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: grabFramesInPage,
      args: [fracs],
    })
    const out = results && results[0] && results[0].result
    return out || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'capture-exception' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// ── Creator Connections scout (scraper-only) ───────────────────────────────
// The MVP "EPC" page drives this via externally_connectable. One click: we
// FOCUS the user's already-open Creator Connections tab (or open the
// opportunities view ourselves if none is open), run the existing CC_SCAN
// content script in their own logged-in session, hand the RAW campaigns back,
// and return focus to the MVP tab. We never open more than one CC tab — repeat
// scouts reuse it. All filtering / ranking / selection happens in the app.
const CC_OPPORTUNITIES_URL = 'https://www.amazon.com/creatorconnections/'

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function waitForTabLoad(tabId, ms) {
  return new Promise((resolve) => {
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve() }, ms)
  })
}

// Run CC_SCAN on a tab; inject content.js once + retry if it isn't there yet.
async function scanTab(tabId) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: 'CC_SCAN' })
  try {
    const resp = await ask()
    if (resp && Array.isArray(resp.campaigns)) return { ok: true, campaigns: resp.campaigns, diag: resp.diag || null }
    return { ok: false, error: resp?.error || 'scan-failed', diag: resp?.diag || null }
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
      const resp = await ask()
      if (resp && Array.isArray(resp.campaigns)) return { ok: true, campaigns: resp.campaigns, diag: resp.diag || null }
      return { ok: false, error: resp?.error || 'scan-failed', diag: resp?.diag || null }
    } catch (e2) {
      return { ok: false, error: 'content-script-unreachable' }
    }
  }
}

async function scanCreatorConnections(callerTabId) {
  const open = await chrome.tabs.query({
    url: [
      'https://www.amazon.com/creatorconnections/*',
      'https://affiliate-program.amazon.com/*',
    ],
  })
  let tab = open.find((t) => t.active) || open[0] || null
  let opened = false
  try {
    if (!tab || tab.id == null) {
      // None open — open the opportunities view ourselves, FOREGROUND so the
      // React/virtualized grid renders reliably (background tabs throttle).
      tab = await chrome.tabs.create({ url: CC_OPPORTUNITIES_URL, active: true })
      opened = true
      await waitForTabLoad(tab.id, 25000)
      await _sleep(3500) // let the SPA + grid paint before scrolling/harvesting
    } else {
      // Already open — focus it so its (possibly throttled) timers run live.
      try { await chrome.tabs.update(tab.id, { active: true }) } catch (e) {}
    }
    return await scanTab(tab.id)
  } catch (e) {
    return { ok: false, error: opened ? 'scan-failed' : 'content-script-unreachable' }
  } finally {
    // Always hand focus back to MVP so the cockpit is where the user lands.
    if (callerTabId != null) { try { await chrome.tabs.update(callerTabId, { active: true }) } catch (e) {} }
  }
}

// ── Messages from the MVP dashboard (externally_connectable) ────────────────
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return
  if (msg.type === 'MVP_PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version })
    return // sync response
  }
  if (msg.type === 'MVP_CC_SCAN') {
    // Scraping the virtualized grid (open/focus + scroll + enrichment pass) can
    // take a while on a large opportunities list, so allow up to 2 minutes.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 120000)
    scanCreatorConnections(callerTabId)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_CAPTURE_FRAME') {
    // Accept `fractions` (multi-frame, preferred) or legacy single `seekFraction`.
    const fractions = Array.isArray(msg.fractions) && msg.fractions.length
      ? msg.fractions
      : [typeof msg.seekFraction === 'number' ? msg.seekFraction : 0.5]
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), CAPTURE_TIMEOUT_MS)
    captureYouTubeFrames({ youtubeVideoId: msg.youtubeVideoId, fractions, callerTabId })
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
}
)
