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

// Phase 1: injected while the YouTube tab is still FOREGROUND.
// Waits for any pre-roll ad to fully complete before returning.
// Chrome pauses ads in background tabs, so we MUST do this before switching
// focus to MVP — otherwise the ad never ends and all captures return null.
async function waitForAdInPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const vDeadline = Date.now() + 15000
  let video = null
  while (Date.now() < vDeadline) {
    video = document.querySelector('video.html5-main-video') || document.querySelector('video')
    if (video && isFinite(video.duration) && video.duration > 0) break
    await sleep(300)
  }
  if (!video) return
  video.muted = true
  try { await video.play() } catch (e) {}

  // Sleep 2.5s so the pre-roll ad has time to appear — it starts 1-2s after the
  // player initialises, so checking immediately gives a false "no ad" result.
  await sleep(2500)

  const isAd = () => {
    const p = document.querySelector('.html5-video-player')
    if (p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))) return true
    if (document.querySelector('.ytp-ad-module, .ytp-ad-duration-remaining, .ytp-ad-player-overlay')) return true
    return false
  }
  if (!isAd()) return // no pre-roll, nothing to wait for

  // Ad is confirmed. Click skip as soon as it appears; for non-skippable ads
  // (max 30s on YouTube) just wait them out — 60s gives plenty of buffer.
  const until = Date.now() + 60000
  while (Date.now() < until) {
    if (!isAd()) return
    const skip = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button')
    if (skip) { try { skip.click() } catch (e) {} }
    await sleep(500)
  }
}

// Phase 2: injected after the tab switches to background (ad already gone).
// Seeks to each fraction and captures a frame. Must not reference anything
// outside its own scope (it is serialized + injected).
async function grabFramesInPage(fractions) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const deadline = Date.now() + 15000

  // 1. Re-find the video (still playing from Phase 1).
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

  // Ad-detection used for mid-roll guards inside the seek loop below.
  const isAdShowingFull = () => {
    const p = document.querySelector('.html5-video-player')
    if (p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))) return true
    if (document.querySelector('.ytp-ad-module, .ytp-ad-duration-remaining, .ytp-ad-player-overlay')) return true
    return false
  }
  const waitOutAds = async (ms) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if (!isAdShowingFull()) return true
      const skip = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button')
      if (skip) { try { skip.click() } catch (e) {} }
      await sleep(500)
    }
    return !isAdShowingFull()
  }

  // 2. Wait for the player to ramp to HD. A freshly-opened tab serves low-res
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
    if (isAdShowingFull()) return null // never capture an ad frame
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
    if (isAdShowingFull()) {
      const cleared = await waitOutAds(50000)
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
  // &autoplay=0 prevents YouTube starting playback before our script mutes
  // the video element; &mute=1 is a belt-and-suspenders guard; &vq=hd1080
  // nudges YouTube to load the HD stream. Our grabFramesInPage script sets
  // video.muted = true and calls play() explicitly, so capture still works.
  const url = `https://www.youtube.com/watch?v=${youtubeVideoId}&autoplay=0&mute=1&vq=hd1080`
  try {
    // Open in the BACKGROUND so the user's current tab keeps focus.
    // Draft/private videos have no pre-roll ads, so the old foreground
    // ad-clearing phase is not needed. If Chrome doesn't render the video
    // in the background the frame array will be empty and the caller falls
    // back to the maxres storyboard thumbnail automatically.
    const tab = await chrome.tabs.create({ url, active: false })
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

// ── Amazon video discovery (Manage Content) ────────────────────────────────
// For the "Share with brand" recap: a creator's Amazon Influencer videos live
// on their Manage Content page (in their logged-in session — a server can't
// reach it). We open/focus that page, scroll to load the full list, and
// harvest every video's /vdp/ link + the product ASIN embedded in the URL
// (...&product=B0XXXXXXXX). MVP matches that ASIN to the post and includes the
// real Amazon video link in the recap. All in the user's own session.
const AMZ_MANAGE_URL = 'https://www.amazon.com/manage-content'

// Injected into the Manage Content page. Scrolls to load everything, then
// harvests each video link + its product ASIN. Self-contained (serialized).
async function harvestAmazonVideosInPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // Lazy-loaded list — scroll until the page height stops growing.
  let last = -1
  for (let i = 0; i < 50; i++) {
    window.scrollTo(0, document.body.scrollHeight)
    await sleep(500)
    const h = document.body.scrollHeight
    if (h === last) break
    last = h
  }
  window.scrollTo(0, 0)

  const out = []
  const seen = new Set()
  const asinFrom = (href) => {
    try { const a = new URL(href, location.origin).searchParams.get('product'); if (a) return a.toUpperCase() } catch (e) {}
    const m = href.match(/[?&]product=([A-Za-z0-9]{10})/) || href.match(/\/dp\/([A-Z0-9]{10})/)
    return m ? m[1].toUpperCase() : null
  }
  // Primary signal: anchors pointing at a video detail page (/vdp/).
  for (const a of document.querySelectorAll('a[href*="/vdp/"]')) {
    const href = a.href
    if (!href || seen.has(href)) continue
    seen.add(href)
    out.push({
      vdpUrl: href,
      asin: asinFrom(href),
      title: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 140),
    })
  }
  return { ok: true, videos: out, count: out.length, signedOut: /ap\/signin/.test(location.href) }
}

async function scanAmazonVideos(callerTabId) {
  // Reuse an open Manage Content / storefront tab; else open Manage Content
  // FOREGROUND (Amazon's content list is client-rendered + session-scoped, and
  // background tabs throttle rendering — same trade-off as the CC scout).
  const open = await chrome.tabs.query({
    url: ['https://www.amazon.com/manage-content*', 'https://www.amazon.com/shop/*'],
  })
  let tab = open.find((t) => t.active) || open[0] || null
  let opened = false
  try {
    if (!tab || tab.id == null) {
      tab = await chrome.tabs.create({ url: AMZ_MANAGE_URL, active: true })
      opened = true
      await waitForTabLoad(tab.id, 25000)
      await _sleep(3500)
    } else {
      try { await chrome.tabs.update(tab.id, { active: true }) } catch (e) {}
      await _sleep(800)
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: harvestAmazonVideosInPage,
    })
    return (results && results[0] && results[0].result) || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: opened ? 'scan-failed' : 'content-script-unreachable' }
  } finally {
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
  if (msg.type === 'MVP_AMZ_SCAN') {
    // Open/focus Manage Content + scroll + harvest — allow up to 2 minutes.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 120000)
    scanAmazonVideos(callerTabId)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
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
