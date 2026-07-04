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

// ── SCOUT campaign → ASIN resolver ─────────────────────────────────────────
// Amazon's 2026-07 Creator Connections redesign hides the ASIN on the card; it
// only appears on the campaign's own "View details" page (a full navigation).
// To ground a pushed campaign on its REAL ASIN without disturbing the user's
// search list, we open that details URL in a BACKGROUND tab, read the ASIN off
// the rendered page, and close the tab. Same background-tab pattern as the
// YouTube frame capture above.
function harvestAsinsInPage() {
  const set = new Set()
  // Reject placeholders/junk: our own SCOUT panel's ASIN input is literally
  // "B0XXXXXXXX", and gets serialized into the page HTML. Real ASINs never
  // contain a run of X's or 6+ identical chars.
  const isJunk = (a) => /X{4,}/.test(a) || /(.)\1{5,}/.test(a)
  const push = (v) => {
    const m = String(v || '').toUpperCase().match(/\bB0[A-Z0-9]{8}\b/g)
    if (m) m.forEach((x) => { if (!isJunk(x)) set.add(x) })
  }
  document.querySelectorAll('[data-asin]').forEach((e) => push(e.getAttribute('data-asin')))
  document.querySelectorAll('a[href]').forEach((a) => { const m = (a.getAttribute('href') || '').match(/\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})/i); if (m) push(m[1]) })
  // Scan the page HTML but EXCLUDE the SCOUT panel (its placeholder is B0XXXXXXXX).
  let html = ''
  try {
    const b = document.body ? document.body.cloneNode(true) : null
    if (b) { const p = b.querySelector('#mvp-scout-cc-panel'); if (p) p.remove(); html = b.innerHTML }
  } catch (e) { html = document.body ? document.body.innerHTML : '' }
  push(html)
  return Array.from(set)
}

async function resolveCampaignAsin(detailsUrl) {
  if (!detailsUrl) return { ok: false, error: 'no-url' }
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url: detailsUrl, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 20000)
    // The product renders async (React) — poll a few times before giving up.
    let asins = []
    for (let i = 0; i < 12; i++) {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: harvestAsinsInPage })
      asins = (results && results[0] && results[0].result) || []
      if (asins.length) break
      await _sleep(500)
    }
    return { ok: true, asins }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'resolve-exception' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// Read a product's Amazon page for the import signals: monthly sales
// ("X bought in past month") and WHERE the product has a carousel video —
// 'top' (the main image gallery, the high-value placement), 'bottom' (a lower
// "Videos for this product" / related-videos shoppable carousel), or 'none'.
function readDpSignalsInPage() {
  const bodyText = document.body ? (document.body.innerText || '') : ''
  // "1K+ bought in past month" / "500+ bought in past month" / "50 bought…"
  let sales = null
  const m = bodyText.match(/([\d][\d.,]*)\s*([kmKM])?\+?\s*bought in past month/i)
  if (m) {
    let n = parseFloat(m[1].replace(/,/g, ''))
    const unit = (m[2] || '').toLowerCase()
    if (unit === 'k') n *= 1000
    else if (unit === 'm') n *= 1000000
    if (!isNaN(n)) sales = Math.round(n)
  }

  // Amazon marks video thumbnails/players many ways across layouts.
  const VIDEO_SEL = 'li.videoBlockIngress, .videoThumbnail, .videoThumbnailContainer, ' +
    '[data-video-url], video, button[aria-label*="video" i], [aria-label*="Play video" i], ' +
    '.vjs-tech, #vse-player, .vse-video-container'
  let topVideo = false
  let bottomVideo = false
  try {
    // TOP — the main image gallery (#altImages / #imageBlock). A video here shows
    // in the hero media carousel: the most valuable placement for a creator.
    const top = document.querySelector('#altImages') || document.querySelector('#imageBlock') || document.querySelector('#main-image-container')
    if (top && (top.querySelector(VIDEO_SEL) || /\b\d+\s+videos?\b/i.test(top.textContent || ''))) topVideo = true

    // BOTTOM — Amazon's lower "Videos for this product" / related-videos widgets.
    const BOTTOM_SCOPES = [
      '#vse-related-videos_feature_div', '#va-related-videos-widget_feature_div',
      '#videoblock_feature_div', '#vseVideosPerProduct', '#videos_feature_div',
      '[id*="relatedVideo" i]', '[id*="videosPerProduct" i]', '[data-cel-widget*="video" i]',
    ]
    for (const s of BOTTOM_SCOPES) {
      let el = null
      try { el = document.querySelector(s) } catch (e) { continue }
      if (el && (el.querySelector(VIDEO_SEL) || /videos? for this|related videos?/i.test(el.textContent || ''))) { bottomVideo = true; break }
    }
    // Heading-text fallback for the bottom section when the widget id is unknown.
    if (!bottomVideo && /videos for this product/i.test(bodyText)) bottomVideo = true
  } catch (e) {}

  // Top wins when both exist (report the strongest placement). hasVideo kept for
  // back-compat with callers that only need the boolean.
  const carouselPos = topVideo ? 'top' : (bottomVideo ? 'bottom' : 'none')
  return { sales, hasVideo: carouselPos !== 'none', carouselPos }
}

// Deep import check for one campaign: resolve its ASIN (from the details page),
// then reuse the SAME tab to open the /dp page and read sales + carousel video.
async function resolveProductDeep(detailsUrl) {
  if (!detailsUrl) return { ok: false, error: 'no-url' }
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url: detailsUrl, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 20000)
    let asin = null
    for (let i = 0; i < 12; i++) {
      const r = await chrome.scripting.executeScript({ target: { tabId }, func: harvestAsinsInPage })
      const a = (r && r[0] && r[0].result) || []
      if (a.length) { asin = a[0]; break }
      await _sleep(500)
    }
    if (!asin) return { ok: true, asin: null, sales: null, hasVideo: false }
    // Navigate the same tab to the product page and read the signals.
    await chrome.tabs.update(tabId, { url: `https://www.amazon.com/dp/${asin}` })
    await waitForTabLoad(tabId, 20000)
    await _sleep(1200)
    let out = { sales: null, hasVideo: false, carouselPos: 'none' }
    for (let i = 0; i < 8; i++) {
      const r = await chrome.scripting.executeScript({ target: { tabId }, func: readDpSignalsInPage })
      const v = r && r[0] && r[0].result
      if (v) { out = v; if (v.hasVideo || v.sales != null) break }
      await _sleep(600)
    }
    return { ok: true, asin, sales: out.sales, hasVideo: out.hasVideo, carouselPos: out.carouselPos || 'none' }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'deep-exception' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// Internal messages from the on-page SCOUT panel (content.js). Kept separate
// from the onMessageExternal handler (which serves the MVP web app).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'SCOUT_RESOLVE_ASIN') {
    resolveCampaignAsin(msg.detailsUrl).then(sendResponse)
    return true // async response
  }
  if (msg && msg.type === 'SCOUT_DEEP_CHECK') {
    resolveProductDeep(msg.detailsUrl).then(sendResponse)
    return true // async response
  }
  return false
})

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

// ── Live "is this a Creator Connections campaign?" finder ───────────────────
// The Product Finder surfaces raw Amazon products. For each one MVP first checks
// its OWN imported campaigns (instant, /api/campaigns/find-by-asin). When there's
// no local hit, this does the live version: search Amazon's CC catalogue by the
// product's brand/keyword and resolve each result card's real ASIN until one
// matches the target — then the caller can auto-send a brand message.
//
// First attempt runs the CC page in a BACKGROUND tab (the user asked, repeatedly,
// never to be moved off MVP). ASIN resolution already opens its own background
// tabs. BUT Amazon's virtualized CC grid often refuses to render in a hidden tab
// (paint throttling → the card list never mounts → "checked 0"). So when the
// background pass returns zero candidates, ccFindCampaign escalates to a brief
// FOREGROUND pass and hands focus straight back — the only reliable way to read
// the grid, matching the existing Campaign Search scan.
async function findCampaignOnTab(tabId, query, asin) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: 'CC_FIND', query, asin, maxResolve: 15, maxCards: 120 })
  try {
    return await ask()
  } catch (e) {
    // Content script not injected yet — inject once and retry.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    return await ask()
  }
}

// True when a find result means "the grid never gave us anything to check" (as
// opposed to "checked N cards, none matched") — the signal to retry foreground.
function ccFoundNothingToCheck(res) {
  return !!(res && res.ok && !res.found && !res.scanned)
}

async function ccFindCampaign(query, asin, callerTabId) {
  const want = String(asin || '').toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(want)) return { ok: false, error: 'no-asin' }
  const open = await chrome.tabs.query({
    url: [
      'https://www.amazon.com/creatorconnections/*',
      'https://affiliate-program.amazon.com/*',
    ],
  })
  let tab = open[0] || null
  let opened = false
  try {
    if (!tab || tab.id == null) {
      tab = await chrome.tabs.create({ url: CC_OPPORTUNITIES_URL, active: false })
      opened = true
      await waitForTabLoad(tab.id, 25000)
      await _sleep(3500) // let the SPA + grid mount before searching
    }
    // Creator Connections is blocked on an onsite ("onamz…") store id — flip to
    // the offsite store in this tab so the campaign grid unlocks.
    try {
      const sres = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: ensureOffsiteStoreInPage })
      const sw = sres && sres[0] && sres[0].result
      if (sw && sw.switched) { await _sleep(1500); await waitForTabLoad(tab.id, 25000); await _sleep(2500) }
    } catch (e) {}

    let res = await findCampaignOnTab(tab.id, query, want)

    // Background yielded no cards to check → the hidden grid didn't render.
    // Escalate to a short foreground pass, then hand focus back to MVP.
    if (ccFoundNothingToCheck(res)) {
      try {
        await chrome.tabs.update(tab.id, { active: true })
        await _sleep(2800) // let the now-visible grid paint + settle
        const fg = await findCampaignOnTab(tab.id, query, want)
        if (fg) { res = fg; res.foreground = true }
      } catch (e) { /* keep the background result */ }
      finally {
        // Return the user to where they were — never leave them on the CC tab.
        if (callerTabId != null) { try { await chrome.tabs.update(callerTabId, { active: true }) } catch (e) {} }
      }
    }
    return res || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: opened ? 'cc-find-failed' : 'content-script-unreachable' }
  } finally {
    // Only close tabs WE opened — never a CC tab the user had open themselves.
    if (opened && tab && tab.id != null) { try { await chrome.tabs.remove(tab.id) } catch (e) {} }
  }
}

// ── Batch "which of these products are CC campaigns?" (Check all CC) ─────────
// One CC search by keyword, resolve the result cards' ASINs once, match against
// the whole target set. Same background-first-then-foreground grid strategy as
// ccFindCampaign. Returns { matches: [{asin, detailsUrl, brand, commissionPct}] }.
async function matchCampaignsOnTab(tabId, keyword, asins) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: 'CC_MATCH', keyword, asins, maxResolve: 40, maxCards: 200 })
  try {
    return await ask()
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    return await ask()
  }
}

async function ccMatchCampaigns(keyword, asins, callerTabId) {
  const want = Array.from(new Set((asins || []).map((a) => String(a || '').toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a))))
  if (!want.length) return { ok: true, matches: [], scanned: 0 }
  const open = await chrome.tabs.query({
    url: [
      'https://www.amazon.com/creatorconnections/*',
      'https://affiliate-program.amazon.com/*',
    ],
  })
  let tab = open[0] || null
  let opened = false
  try {
    if (!tab || tab.id == null) {
      tab = await chrome.tabs.create({ url: CC_OPPORTUNITIES_URL, active: false })
      opened = true
      await waitForTabLoad(tab.id, 25000)
      await _sleep(3500)
    }
    try {
      const sres = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: ensureOffsiteStoreInPage })
      const sw = sres && sres[0] && sres[0].result
      if (sw && sw.switched) { await _sleep(1500); await waitForTabLoad(tab.id, 25000); await _sleep(2500) }
    } catch (e) {}

    let res = await matchCampaignsOnTab(tab.id, keyword, want)
    // No cards resolved → the hidden grid didn't render; retry foreground once.
    if (res && res.ok && !res.scanned) {
      try {
        await chrome.tabs.update(tab.id, { active: true })
        await _sleep(2800)
        const fg = await matchCampaignsOnTab(tab.id, keyword, want)
        if (fg) { res = fg; res.foreground = true }
      } catch (e) { /* keep the background result */ }
      finally {
        if (callerTabId != null) { try { await chrome.tabs.update(callerTabId, { active: true }) } catch (e) {} }
      }
    }
    return res || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: opened ? 'cc-match-failed' : 'content-script-unreachable' }
  } finally {
    if (opened && tab && tab.id != null) { try { await chrome.tabs.remove(tab.id) } catch (e) {} }
  }
}

// ── Accept a campaign on Amazon, from MVP ───────────────────────────────────
// The /epc "Accept on Amazon" button: open the campaign's details page in the
// user's own session and click its Accept button — so accepting is a deliberate
// choice made in MVP, never a side effect of importing. Background-first (the
// user asked never to be moved off MVP); foreground fallback only if the details
// page's React didn't render the button headless.
function acceptCampaignInPage() {
  const norm = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim()
  const controls = () => [...document.querySelectorAll('button,a,[role="button"],input[type="submit"]')]
  // Exact accept labels first; then a loose match that EXCLUDES "Accept all"
  // (which would accept every campaign) and "Accepted"/"Accept Sponsored…".
  const exact = (t) => /^(accept|accept campaign|accept this campaign|accept affiliate\+? campaign|accept offer|accept & continue)$/i.test(t)
  const loose = (t) => /\baccept\b/i.test(t) && !/accept all|accepted|accept sponsored/i.test(t)
  const bodyTxt = document.body ? (document.body.innerText || '') : ''
  let btn = controls().find((e) => exact(norm(e)))
  if (!btn) btn = controls().find((e) => loose(norm(e)))
  if (!btn) {
    // No accept control — if the page already reads as accepted, call it done.
    if (/\baccepted\b/i.test(bodyTxt) && !/accept\b/i.test(bodyTxt)) return { ok: true, accepted: true, already: true }
    return { ok: false, reason: 'accept-button-not-found', sample: controls().map((e) => norm(e)).filter(Boolean).slice(0, 14) }
  }
  const label = norm(btn)
  try { btn.scrollIntoView({ block: 'center' }) } catch (e) {}
  btn.click()
  return { ok: true, accepted: true, clicked: label }
}

async function acceptCampaignByUrl(detailsUrl, callerTabId) {
  if (!detailsUrl) return { ok: false, error: 'no-url' }
  let tabId = null
  let opened = false
  const tryAccept = async () => {
    for (let i = 0; i < 6; i++) {
      const res = await chrome.scripting.executeScript({ target: { tabId }, func: acceptCampaignInPage })
      const r = res && res[0] && res[0].result
      if (r && r.ok) return r
      await _sleep(700)
    }
    return null
  }
  try {
    const tab = await chrome.tabs.create({ url: detailsUrl, active: false })
    tabId = tab.id; opened = true
    await waitForTabLoad(tabId, 25000)
    await _sleep(2500)
    // Creator Connections is blocked on an onsite store id — flip if needed.
    try {
      const sres = await chrome.scripting.executeScript({ target: { tabId }, func: ensureOffsiteStoreInPage })
      const sw = sres && sres[0] && sres[0].result
      if (sw && sw.switched) { await _sleep(1500); await waitForTabLoad(tabId, 25000); await _sleep(2000) }
    } catch (e) {}

    let r = await tryAccept()
    // Button never rendered headless → bring the tab forward once, retry, return.
    if (!r) {
      try {
        await chrome.tabs.update(tabId, { active: true })
        await _sleep(2500)
        r = await tryAccept()
      } catch (e) { /* keep null */ }
      finally {
        if (callerTabId != null) { try { await chrome.tabs.update(callerTabId, { active: true }) } catch (e) {} }
      }
    }
    if (r && r.ok) await _sleep(1500) // let the click commit before we close
    return r || { ok: false, error: 'accept-button-not-found' }
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : 'accept-exception' }
  } finally {
    if (opened && tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
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
// harvests each video link + its product ASIN. Robust: pulls /vdp/ links from
// anchors AND from the raw rendered HTML (data-attrs, inline JSON, onclick),
// and returns a diag block so a 0-result is debuggable. Self-contained.
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
  await sleep(400)

  const out = []
  const seen = new Set()
  const asinFrom = (href) => {
    try { const a = new URL(href, location.origin).searchParams.get('product'); if (a) return a.toUpperCase() } catch (e) {}
    const m = href.match(/[?&]product=([A-Za-z0-9]{10})/) ||
              href.match(/%26product%3D([A-Za-z0-9]{10})/i) ||
              href.match(/\/dp\/([A-Z0-9]{10})/)
    return m ? m[1].toUpperCase() : null
  }
  const push = (url, title) => {
    if (!url) return
    const clean = url.replace(/&amp;/g, '&').replace(/\\u002F/gi, '/').replace(/\\\//g, '/')
    if (seen.has(clean)) return
    seen.add(clean)
    out.push({ vdpUrl: clean, asin: asinFrom(clean), title: (title || '').trim().slice(0, 140) })
  }

  // 1) Anchors anywhere whose href contains /vdp/.
  const anchors = [...document.querySelectorAll('a[href]')]
  let vdpAnchorCount = 0
  for (const a of anchors) {
    const href = a.href || a.getAttribute('href') || ''
    if (/\/vdp\//.test(href)) { vdpAnchorCount++; push(href, a.getAttribute('aria-label') || a.textContent) }
  }

  // 2) Raw HTML scan — catches vdp URLs in data-* attrs, inline React/JSON
  //    state, or onclick handlers that never become real anchors.
  const html = document.documentElement.innerHTML
  const re = /https?:(?:\\?\/){2}(?:www\.)?amazon\.[a-z.]+(?:\\?\/)vdp(?:\\?\/)[A-Za-z0-9]+[^"'\\\s)<>]*/gi
  let m, htmlVdpHits = 0
  while ((m = re.exec(html)) !== null) { htmlVdpHits++; push(m[0], '') }

  return {
    ok: true,
    videos: out,
    count: out.length,
    signedOut: /\/ap\/signin/.test(location.href),
    diag: {
      url: location.href.slice(0, 160),
      title: (document.title || '').slice(0, 100),
      htmlLen: html.length,
      anchorCount: anchors.length,
      vdpAnchorCount,
      vdpHtmlHits: (html.match(/\/vdp\//g) || []).length,
      vdpHtmlMatched: htmlVdpHits,
    },
  }
}

// ── Piggyback on OINK: read the creator's video off the PRODUCT page ────────
// Manage Content has 0 vdp links in its HTML (loaded via private API). But the
// PRODUCT page DOES — the OINK extension injects a "Content Made" anchor whose
// href is the creator's /vdp/ video. So open the product page for the post's
// ASIN, wait for OINK to inject, and harvest that link. Also detect whether
// OINK is present so the app can recommend it when it isn't.
async function harvestProductVideoInPage(asin) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const want = (asin || '').toUpperCase()
  const asinOf = (href) => {
    try { const a = new URL(href, location.origin).searchParams.get('product'); if (a) return a.toUpperCase() } catch (e) {}
    const m = href.match(/[?&]product=([A-Za-z0-9]{10})/)
    return m ? m[1].toUpperCase() : null
  }
  const findVdp = () => {
    const anchors = [...document.querySelectorAll('a[href*="/vdp/"]')]
    // 1. Strongest signal: the vdp link OINK injected lives inside its own
    //    container. That's the CREATOR'S OWN video for this product — exactly
    //    what we want, even on OINK builds that omit the product= param.
    const oinkScope = document.querySelector('[class*="oink" i],[id*="oink" i],[data-oink]')
    if (oinkScope) {
      const inOink = oinkScope.querySelector('a[href*="/vdp/"]')
      if (inOink) return inOink.href
    }
    // 2. Amazon's NATIVE "Content Made" link — the creator's OWN video for this
    //    product, shown to the signed-in creator WITHOUT OINK. This is the exact
    //    link the manual-paste hint tells users to right-click → Copy, so
    //    matching it makes auto-detect work even when OINK isn't installed.
    //    Matched by its "Content Made" label (on the anchor or a close
    //    ancestor) so we never grab a stranger's video from the public "Videos
    //    for this product" carousel.
    const isContentMade = (a) => {
      let el = a, depth = 0
      while (el && depth < 4) {
        const label = ((el.getAttribute && el.getAttribute('aria-label')) || '') + ' ' +
          (el === a ? (a.textContent || '') : '')
        if (/content made/i.test(label)) return true
        el = el.parentElement; depth++
      }
      return false
    }
    const labelled = anchors.find(isContentMade)
    if (labelled) return labelled.href
    // 3. Else, a vdp anchor whose product= matches THIS product's ASIN.
    //    We deliberately do NOT fall back to "any vdp on the page" — Amazon's
    //    native "Videos for this product" carousel surfaces OTHER creators'
    //    videos, and attaching one of those to the brand recap would tell the
    //    brand "here's our review" pointing at a stranger's content. Better to
    //    find nothing and let the user paste their link than to guess wrong.
    if (want) {
      for (const a of anchors) { if (asinOf(a.href) === want) return a.href }
    }
    return null
  }
  // Two DISTINCT page signals so the app can message accurately:
  //  - oinkEl:     the OINK extension is genuinely installed (its element exists).
  //  - contentMade: Amazon's native "Content Made" label is on the page — true
  //    even WITHOUT OINK, so it must NOT be reported as "OINK is installed".
  const oinkEl = () => !!document.querySelector('[class*="oink" i],[id*="oink" i],[data-oink]')
  const contentMade = () => /content made/i.test(document.body ? document.body.innerText : '')

  // OINK / Amazon inject asynchronously (an Amazon content API call first) —
  // poll up to ~14s, and keep going a beat after the signal appears so the link
  // can paint.
  let vdp = null, sawOink = false, sawContentMade = false
  for (let i = 0; i < 28; i++) {
    if (!sawOink) sawOink = oinkEl()
    if (!sawContentMade) sawContentMade = contentMade()
    vdp = findVdp()
    if (vdp) break
    await sleep(500)
  }
  return {
    ok: true,
    video: vdp ? { vdpUrl: vdp, asin: asinOf(vdp) || want } : null,
    oinkDetected: sawOink,
    contentMadeSeen: sawContentMade || contentMade(),
    signedOut: /\/ap\/signin/.test(location.href),
    diag: {
      url: location.href.slice(0, 140),
      vdpAnchors: document.querySelectorAll('a[href*="/vdp/"]').length,
      oink: sawOink,
      contentMade: sawContentMade,
    },
  }
}

async function scanAmazonVideoForAsin(asin, callerTabId) {
  if (!/^[A-Za-z0-9]{10}$/.test(asin || '')) return { ok: false, error: 'bad-asin' }
  const url = `https://www.amazon.com/dp/${asin}`
  let tabId = null
  try {
    // FOREGROUND so OINK's content script + its API-driven injection run
    // reliably (same trade-off as the CC scout). Focus returns to the caller.
    const tab = await chrome.tabs.create({ url, active: true })
    tabId = tab.id
    await waitForTabLoad(tabId, 25000)
    await _sleep(2000) // give OINK a head start before we poll
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: harvestProductVideoInPage,
      args: [asin],
    })
    return (results && results[0] && results[0].result) || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: 'scan-failed' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
    if (callerTabId != null) { try { await chrome.tabs.update(callerTabId, { active: true }) } catch (e) {} }
  }
}

// ── Read the Amazon PRODUCT page (title / bullets / description / image) ─────
// Runs in the user's logged-in browser, so it succeeds where the MVP server's
// scrape is blocked (Amazon hard-blocks datacenter IPs). Self-contained — runs
// in the page context via executeScript, no access to extension scope.
async function harvestAmazonProductInPage(wantAsin) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const txt = (sel) => { try { const e = document.querySelector(sel); return e ? clean(e.textContent) : '' } catch (e) { return '' } }

  // Amazon /dp pages are server-rendered, but give a slow interstitial a beat.
  let title = ''
  for (let i = 0; i < 14; i++) {
    title = txt('#productTitle')
    if (title) break
    await sleep(500)
  }

  const bodyText = document.body ? document.body.innerText : ''
  const captcha = /Enter the characters you see below|Robot Check|api-services-support@amazon|To discuss automated access/i.test(bodyText)
  const signedOut = /\/ap\/signin/.test(location.href)

  // Bullets — skip Amazon's hidden / template list items.
  const bullets = []
  try {
    document.querySelectorAll('#feature-bullets li, #feature-bullets ul li').forEach((li) => {
      if (li.classList && (li.classList.contains('aok-hidden') || li.id === 'replacementPartsFitmentBulletInner')) return
      const t = clean(li.textContent)
      if (t && t.length > 4 && !/^see more/i.test(t)) bullets.push(t)
    })
  } catch (e) {}

  let description = txt('#productDescription') || txt('#bookDescription_feature_div')

  // Price — the offscreen node holds the clean formatted price.
  let price = txt('#corePrice_feature_div .a-offscreen') || txt('#corePriceDisplay_desktop_feature_div .a-offscreen') || txt('.a-price .a-offscreen') || ''
  price = price ? price.split(/\s/)[0] : ''

  // Rating
  let rating = ''
  try {
    const rEl = document.querySelector('#acrPopover')
    const rTxt = (rEl ? (rEl.getAttribute('title') || rEl.textContent) : '') || txt('[data-hook="rating-out-of-text"]') || txt('.a-icon-star .a-icon-alt')
    const m = (rTxt || '').match(/(\d+(?:\.\d+)?)\s*out of\s*5/i)
    if (m) rating = m[1]
  } catch (e) {}

  // Images — main hi-res first, then the dynamic-image set + gallery.
  const images = []
  try {
    const main = document.querySelector('#landingImage') || document.querySelector('#imgTagWrapperId img')
    const mainUrl = main ? (main.getAttribute('data-old-hires') || main.getAttribute('src') || '') : ''
    if (/^https/.test(mainUrl)) images.push(mainUrl)
    const dyn = main && main.getAttribute('data-a-dynamic-image')
    if (dyn) { try { Object.keys(JSON.parse(dyn)).forEach((u) => { if (/^https/.test(u)) images.push(u) }) } catch (e) {} }
    // hi-res gallery URLs embedded in the page's image-block JSON
    const hi = (document.documentElement.innerHTML.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+\.jpg[^"]*)"/g) || [])
    hi.forEach((s) => { const u = s.match(/"(https:\/\/[^"]+)"/); if (u) images.push(u[1]) })
  } catch (e) {}
  const uniqImages = Array.from(new Set(images)).filter(Boolean).slice(0, 8)

  return {
    ok: !!title,
    product: title ? {
      asin: wantAsin,
      title: title,
      bullets: bullets.slice(0, 12),
      description: description.slice(0, 1500),
      price: price || null,
      rating: rating || null,
      imageUrl: uniqImages[0] || null,
      images: uniqImages,
    } : null,
    signedOut: signedOut,
    captcha: captcha,
    diag: { url: location.href.slice(0, 140), titleLen: title.length, bullets: bullets.length },
  }
}

async function scanAmazonProductForAsin(asin, callerTabId) {
  if (!/^[A-Za-z0-9]{10}$/.test(asin || '')) return { ok: false, error: 'bad-asin' }
  const url = `https://www.amazon.com/dp/${asin}`
  let tabId = null
  try {
    // BACKGROUND tab (active:false) — the /dp page is SERVER-RENDERED, so we can
    // read its title/bullets/image without an active, focused tab. Opening it in
    // the background means SCOUT never steals focus or pops a window to the front
    // — it loads quietly, gets read, and closes. (The video-finder path still
    // opens foreground because OINK's API-driven injection needs an active tab;
    // this product read does not.) A little extra settle time covers any
    // background-tab throttling of the page's late-loading bits.
    const tab = await chrome.tabs.create({ url, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 25000)
    await _sleep(1200)
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: harvestAmazonProductInPage,
      args: [asin],
    })
    return (results && results[0] && results[0].result) || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: 'scan-failed' }
  } finally {
    // Only close our background tab. We never stole focus, so there's nothing to
    // restore — and re-activating the caller here would itself yank the user
    // back if they'd switched tabs while generation ran.
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// ── Generic non-Amazon product scrape (MVP_SCRAPE_URL) ──────────────────────
// MVP's "Post from a link" flow can't scrape most stores server-side — Walmart,
// Target, etc. block datacenter IPs. SCOUT reads the page from the user's own
// browser (residential IP, their session) instead. This is a GENERIC reader:
// it leans on structured data every major store already ships — JSON-LD Product
// schema first (name/description/price/image/brand/rating), then Open Graph +
// microdata + visible-DOM fallbacks — so one function covers Walmart, Target,
// Best Buy, Etsy, eBay, and the rest without per-store selectors.
function harvestGenericProductInPage() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const abs = (u) => { try { return new URL(u, location.href).href } catch (e) { return '' } }
  const meta = (sel) => { try { const e = document.querySelector(sel); return e ? clean(e.getAttribute('content')) : '' } catch (e) { return '' } }

  let title = '', description = '', price = '', brand = '', rating = ''
  const images = []
  const bullets = []

  // 1) JSON-LD Product schema — the cleanest cross-store source.
  let ld = null
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      let data
      try { data = JSON.parse(s.textContent) } catch (e) { continue }
      const nodes = []
      const push = (d) => {
        if (!d || typeof d !== 'object') return
        if (Array.isArray(d)) { d.forEach(push); return }
        nodes.push(d)
        if (Array.isArray(d['@graph'])) d['@graph'].forEach(push)
      }
      push(data)
      for (const node of nodes) {
        const t = node && node['@type']
        const isProduct = t === 'Product' || (Array.isArray(t) && t.includes('Product'))
        if (isProduct) { ld = node; break }
      }
      if (ld) break
    }
  } catch (e) {}

  if (ld) {
    title = clean(typeof ld.name === 'string' ? ld.name : '')
    if (typeof ld.description === 'string') description = clean(ld.description)
    const b = ld.brand
    brand = clean(typeof b === 'string' ? b : (b && (b.name || b['@name'])) || '')
    const img = ld.image
    const pushImg = (u) => { if (typeof u === 'string') { const a = abs(u); if (a) images.push(a) } else if (u && u.url) { const a = abs(u.url); if (a) images.push(a) } }
    if (Array.isArray(img)) img.forEach(pushImg); else pushImg(img)
    let offers = ld.offers
    if (Array.isArray(offers)) offers = offers[0]
    if (offers && typeof offers === 'object') {
      const p = offers.price != null ? offers.price : (offers.lowPrice != null ? offers.lowPrice : (offers.priceSpecification && offers.priceSpecification.price))
      if (p != null && String(p).trim()) {
        price = String(p).trim()
        const cur = offers.priceCurrency || (offers.priceSpecification && offers.priceSpecification.priceCurrency)
        if (cur === 'USD' && !/^\$/.test(price)) price = '$' + price
      }
    }
    const ar = ld.aggregateRating
    if (ar && (ar.ratingValue != null)) rating = String(ar.ratingValue).trim()
  }

  // 2) Open Graph / meta fallbacks for anything JSON-LD didn't cover.
  if (!title) title = meta('meta[property="og:title"]') || clean((document.querySelector('h1') || {}).textContent) || clean(document.title)
  if (!description) description = meta('meta[property="og:description"]') || meta('meta[name="description"]')
  if (!images.length) { const og = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'); if (og) { const a = abs(og); if (a) images.push(a) } }
  if (!brand) brand = meta('meta[property="og:brand"]') || meta('meta[property="product:brand"]')
  if (!price) price = meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]')

  // 3) Bullets — short list items in the main content (spec/feature lists).
  try {
    const lists = document.querySelectorAll('main ul li, [id*="feature" i] li, [class*="feature" i] li, [class*="highlight" i] li, [class*="about" i] li')
    for (const li of lists) {
      const t = clean(li.textContent)
      if (t && t.length > 8 && t.length < 220 && !/^(sign in|add to|see more|view|shop|home\b)/i.test(t)) bullets.push(t)
      if (bullets.length >= 12) break
    }
  } catch (e) {}

  // 4) Price regex fallback — first $NN(.NN) in the visible body, near the top.
  if (!price) {
    try {
      const bt = (document.body ? document.body.innerText : '').slice(0, 6000)
      const m = bt.match(/\$\s?\d{1,4}(?:[.,]\d{2})?/)
      if (m) price = m[0].replace(/\s/g, '')
    } catch (e) {}
  }
  if (price && /^\d/.test(price)) price = '$' + price

  const uniqImages = Array.from(new Set(images)).filter((u) => /^https?:\/\//.test(u)).slice(0, 6)
  const ok = !!(title && title.length > 3)
  return {
    ok: ok,
    product: ok ? {
      title: title.slice(0, 200),
      description: (description || '').slice(0, 1600),
      bullets: bullets.slice(0, 12),
      brand: brand || null,
      price: price || null,
      rating: rating || null,
      imageUrl: uniqImages[0] || null,
      images: uniqImages,
      sourceUrl: location.href,
    } : null,
    diag: { url: location.href.slice(0, 140), hadLd: !!ld, titleLen: (title || '').length, bullets: bullets.length },
  }
}

// Retailers SCOUT is allowed to open + read (must mirror manifest host_permissions).
const SCRAPE_HOSTS = [
  'walmart.com', 'target.com', 'bestbuy.com', 'homedepot.com', 'lowes.com',
  'wayfair.com', 'etsy.com', 'ebay.com', 'chewy.com', 'costco.com',
  'macys.com', 'kohls.com', 'newegg.com', 'ulta.com', 'sephora.com', 'nike.com',
]

function scrapeHostAllowed(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '')
    return SCRAPE_HOSTS.some((d) => h === d || h.endsWith('.' + d))
  } catch (e) { return false }
}

async function scanGenericProduct(url, callerTabId) {
  if (!/^https?:\/\//i.test(url || '')) return { ok: false, error: 'bad-url' }
  if (!scrapeHostAllowed(url)) return { ok: false, error: 'store-not-supported' }
  let tabId = null
  try {
    // BACKGROUND tab (active:false) — never steals the user's view; it loads
    // quietly in the tab strip and closes. Store pages ship their product data
    // as JSON-LD in the SERVER HTML, and JS still EXECUTES in hidden tabs (Chrome
    // throttles painting/rAF, not script or DOM parsing), so the DOM we read is
    // complete without a visible tab. Generous settle + extra retries cover any
    // client-injected JSON-LD that lands late under background timer throttling.
    const tab = await chrome.tabs.create({ url, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    await _sleep(3000)
    let out = null
    for (let i = 0; i < 4; i++) {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: harvestGenericProductInPage })
      out = (results && results[0] && results[0].result) || null
      if (out && out.ok) break
      await _sleep(1800)
    }
    return out || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message).slice(0, 120) : 'scan-failed' }
  } finally {
    // We never stole focus, so there's nothing to restore — just close our tab.
    // (Re-activating the caller here could itself yank the user if they switched
    // tabs while the scrape ran.) callerTabId is kept for signature parity.
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// ── Product Finder (MVP_PRODUCT_SEARCH) ─────────────────────────────────────
// Keyword + rules → live Amazon results scraped in the user's own browser, each
// deep-checked for monthly sales + carousel-video position, filtered by the
// rules, returned to MVP to Generate content on. The "ViralVue but live + in
// MVP" flow; reuses readDpSignalsInPage (same signals as the CC deep-check).
function harvestAmazonSearchInPage() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const out = []
  const seen = new Set()
  const cards = document.querySelectorAll('div[data-component-type="s-search-result"][data-asin], div.s-result-item[data-asin]')
  for (const el of cards) {
    const asin = (el.getAttribute('data-asin') || '').trim()
    if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) continue
    const titleEl = el.querySelector('h2 a span, h2 span, [data-cy="title-recipe"] span, .a-size-medium.a-color-base')
    const title = clean(titleEl ? titleEl.textContent : '')
    if (!title) continue
    const priceEl = el.querySelector('.a-price .a-offscreen')
    const price = priceEl ? clean(priceEl.textContent).split(/\s/)[0] : null
    const img = el.querySelector('img.s-image')
    const image = img ? (img.getAttribute('src') || null) : null
    let rating = null
    const rEl = el.querySelector('[aria-label*="out of 5 stars" i], i.a-icon-star-small, .a-icon-alt')
    const rTxt = rEl ? (rEl.getAttribute('aria-label') || rEl.textContent) : ''
    const rm = (rTxt || '').match(/(\d(?:\.\d)?)\s*out of 5/i)
    if (rm) rating = rm[1]
    const sponsored = /sponsored/i.test(clean(el.textContent).slice(0, 40))
    seen.add(asin)
    out.push({ asin, title: title.slice(0, 180), price, image, rating, sponsored })
  }
  return { ok: out.length > 0, products: out, url: location.href.slice(0, 140) }
}

async function productFinderSearch(query, opts) {
  opts = opts || {}
  const maxDeep = Math.min(50, Math.max(1, opts.maxResults || 15))
  const minSales = typeof opts.minSales === 'number' ? opts.minSales : 0
  const mustVideo = !!opts.mustVideo
  const q = String(query || '').trim()
  if (!q) return { ok: false, error: 'no-query' }
  // The candidate POOL to consider: at least the top ~100 results (cheap — just
  // reading search-page HTML), never fewer than the deep-check budget. One
  // Amazon search page is only ~60 items, so we paginate (&page=N) until the pool
  // fills or the results run out. Deep-checking (a /dp visit each) still happens
  // for only the first `maxDeep` of the pool — that's the slow, capped part.
  const poolTarget = Math.max(100, maxDeep)
  const pageUrl = (n) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}${n > 1 ? `&page=${n}` : ''}`
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url: pageUrl(1), active: false })
    tabId = tab.id
    const pooled = []
    const seen = new Set()
    for (let page = 1; page <= 6 && pooled.length < poolTarget; page++) {
      if (page > 1) { try { await chrome.tabs.update(tabId, { url: pageUrl(page) }) } catch (e) { break } }
      await waitForTabLoad(tabId, 25000)
      await _sleep(page === 1 ? 1600 : 1200)
      let list = null
      for (let i = 0; i < 4; i++) {
        const r = await chrome.scripting.executeScript({ target: { tabId }, func: harvestAmazonSearchInPage })
        list = (r && r[0] && r[0].result) || null
        if (list && list.ok) break
        await _sleep(1300)
      }
      if (!list || !list.products || !list.products.length) break
      let added = 0
      for (const p of list.products) { if (!seen.has(p.asin)) { seen.add(p.asin); pooled.push(p); added++ } }
      if (added === 0) break // no new results on this page → end of pagination
    }
    if (!pooled.length) return { ok: false, error: 'no-results', products: [] }
    // Prefer organic results; deep-check up to maxDeep of them.
    const candidates = pooled.filter((p) => !p.sponsored).concat(pooled.filter((p) => p.sponsored)).slice(0, maxDeep)
    const results = []
    for (const p of candidates) {
      let sig = { sales: null, hasVideo: false, carouselPos: 'none' }
      try {
        await chrome.tabs.update(tabId, { url: `https://www.amazon.com/dp/${p.asin}` })
        await waitForTabLoad(tabId, 20000)
        await _sleep(900)
        for (let i = 0; i < 6; i++) {
          const r = await chrome.scripting.executeScript({ target: { tabId }, func: readDpSignalsInPage })
          const v = r && r[0] && r[0].result
          if (v) { sig = v; if (v.hasVideo || v.sales != null) break }
          await _sleep(600)
        }
      } catch (e) { /* keep the search-page basics; signals stay null */ }
      results.push({ asin: p.asin, title: p.title, price: p.price, image: p.image, rating: p.rating, monthlySales: sig.sales, carouselPos: sig.carouselPos || 'none', hasVideo: !!sig.hasVideo })
    }
    const filtered = results.filter((r) => {
      if (mustVideo && !r.hasVideo) return false
      if (minSales > 0 && (r.monthlySales == null || r.monthlySales < minSales)) return false
      return true
    })
    return { ok: true, products: filtered, scanned: results.length, totalFound: pooled.length }
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message).slice(0, 120) : 'exception' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
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

// ── Studio schedule scrape (MVP_STUDIO_SCHEDULE) ────────────────────────────
// The YouTube Data API can't enumerate a large channel's full library (the
// uploads playlist truncates ~2,575 and search caps ~500), so it misses most
// SCHEDULED videos on big channels. Studio itself knows them all — its Content
// page calls an internal endpoint, /youtubei/v1/creator/list_creator_videos,
// which returns every video with its scheduled-publish time. SCOUT opens a
// background studio.youtube.com tab and calls that same endpoint from the
// page (so the user's session cookies + ytcfg auth apply), paginating until
// done, and returns just the scheduled ones: [{ videoId, title, publishAt }].
//
// This is an UNOFFICIAL endpoint — the request/response shape can change, so
// the harvester returns a `debug` blob (config presence, HTTP status, sample
// keys) to make the inevitable shape-tuning fast.
const STUDIO_URL = 'https://studio.youtube.com/'

function harvestStudioScheduleInPage() {
  return (async () => {
    const out = { ok: false, videos: [], debug: {} }
    try {
      const cfg = (window.ytcfg && (window.ytcfg.data_ || {})) || {}
      const get = (k) => { try { return window.ytcfg && window.ytcfg.get ? window.ytcfg.get(k) : cfg[k] } catch (e) { return cfg[k] } }
      const apiKey = get('INNERTUBE_API_KEY')
      const context = get('INNERTUBE_CONTEXT')
      const channelId = get('CHANNEL_ID') || (context && context.user && context.user.delegationContext && context.user.delegationContext.externalChannelId) || null
      out.debug.hasApiKey = !!apiKey
      out.debug.hasContext = !!context
      out.debug.channelId = channelId
      if (!apiKey || !context) { out.error = 'no-ytcfg'; return out }

      const origin = 'https://studio.youtube.com'
      const cookie = (name) => { const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)')); return m ? m[1] : '' }
      const sapisid = cookie('SAPISID') || cookie('__Secure-3PAPISID') || cookie('__Secure-1PAPISID')
      out.debug.hasSapisid = !!sapisid
      const authHeader = async () => {
        const ts = Math.floor(Date.now() / 1000)
        const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sapisid} ${origin}`))
        const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
        return `SAPISIDHASH ${ts}_${hex}`
      }
      const auth = await authHeader()

      // Mask format (learned from the 400s): SCALAR fields take `true`; MESSAGE
      // fields (visibility, scheduledPublishingDetails) take a sub-mask object
      // — `{ all: true }`. scheduledPublishingDetails is the one we actually
      // need (it carries the scheduled timestamp).
      const mask = {
        videoId: true,
        title: true,
        status: true,
        timeCreatedSeconds: true,
        timePublishedSeconds: true,
        draftStatus: true,
        visibility: { all: true },
        scheduledPublishingDetails: { all: true },
      }

      // Find a plausible epoch-SECONDS value anywhere in an object (scheduled
      // timestamp). Keys vary (startTimeSeconds / timeSeconds / …); match any
      // time-ish key whose value is in the 2001–2128 range, recursing into
      // nested messages. Excludes ms values (they'd be > 5e9).
      const findEpochSeconds = (obj, depth) => {
        if (!obj || typeof obj !== 'object' || depth > 4) return null
        for (const k in obj) {
          const val = obj[k]
          if ((typeof val === 'string' || typeof val === 'number') && /(sec|time|stamp)/i.test(k)) {
            const n = Number(val)
            if (n > 1000000000 && n < 5000000000) return n
          } else if (val && typeof val === 'object') {
            const nested = findEpochSeconds(val, depth + 1)
            if (nested) return nested
          }
        }
        return null
      }

      const scheduled = []
      const seenIds = {}
      const allSeen = {}
      let itemsSeen = 0
      let uniqueCount = 0
      let looksCount = 0
      let dryStreak = 0
      let pageToken
      let pages = 0
      for (let i = 0; i < 60; i++) {
        const body = { context, pageSize: 100, mask }
        if (pageToken) body.pageToken = pageToken
        const res = await fetch(`${origin}/youtubei/v1/creator/list_creator_videos?alt=json&key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': auth, 'X-Origin': origin },
          credentials: 'include',
          body: JSON.stringify(body),
        })
        if (!res.ok) { out.error = 'http-' + res.status; out.debug.httpBody = (await res.text()).slice(0, 400); break }
        const data = await res.json()
        const items = data.videos || data.items || []
        if (i === 0) {
          out.debug.responseKeys = Object.keys(data || {})
          out.debug.firstPageCount = items.length
        }
        itemsSeen += items.length
        let newThisPage = 0
        for (const v of items) {
          // Dedup ALL videos by id — if Studio re-serves duplicates across pages
          // (the uploads-playlist cycling pattern), process each video once.
          if (v.videoId) { if (allSeen[v.videoId]) continue; allSeen[v.videoId] = 1; uniqueCount++; newThisPage++ }
          const det = v.scheduledPublishingDetails || v.scheduledPublishingDetail || null
          const vis = v.visibility ? (v.visibility.effectiveStatus || v.visibility.userSetVisibility || '') : ''
          const looksScheduled = !!det || (typeof vis === 'string' && vis.indexOf('SCHEDULED') >= 0)
          if (!looksScheduled) continue
          looksCount++
          // Capture the first real scheduled item so we can see its exact shape
          // if extraction still comes up empty.
          if (!out.debug.sampleScheduled) out.debug.sampleScheduled = JSON.stringify(v).slice(0, 1200)
          let secs = det ? findEpochSeconds(det, 0) : null
          if (!secs) { const n = Number(v.timePublishedSeconds); if (n > 1000000000 && n < 5000000000) secs = n }
          if (secs && v.videoId && !seenIds[v.videoId]) {
            seenIds[v.videoId] = 1
            const title = typeof v.title === 'string'
              ? v.title
              : (v.title && (v.title.text || v.title.simpleText || (v.title.runs && v.title.runs.map((r) => r.text).join('')))) || ''
            scheduled.push({ videoId: v.videoId, title, publishAt: new Date(secs * 1000).toISOString() })
          }
        }
        pages = i + 1
        // Stall guard: if pages stop adding any NEW unique video, Studio is
        // re-serving the same set (cycling) — bail so we don't spin.
        if (items.length > 0 && newThisPage === 0) { if (++dryStreak >= 3) { out.debug.stalled = true; break } } else { dryStreak = 0 }
        pageToken = data.nextPageToken
        if (!pageToken) break
      }
      out.debug.pages = pages
      out.debug.itemsSeen = itemsSeen
      out.debug.uniqueVideos = uniqueCount
      out.debug.looksScheduled = looksCount
      out.debug.scheduledFound = scheduled.length
      out.videos = scheduled
      // Only a clean run (no HTTP/parse error) counts as ok — otherwise a 400/401
      // would masquerade as "0 scheduled".
      out.ok = !out.error
      return out
    } catch (e) {
      out.error = (e && e.message) || 'exception'
      return out
    }
  })()
}

async function scanStudioSchedule() {
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url: STUDIO_URL, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    // Studio is an SPA — ytcfg is in the initial document but give the session
    // a moment to settle so cookies/auth are fully available.
    await _sleep(2500)
    // MAIN world is REQUIRED: ytcfg (INNERTUBE_API_KEY/CONTEXT) and the
    // SAPISID cookie live on the PAGE's window, which the default isolated
    // world can't see — that's the 'no-ytcfg' failure. MAIN runs in the page
    // context so window.ytcfg, document.cookie + a same-origin youtubei fetch
    // all work. (Chrome 111+; manifest requires 114.)
    const results = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: harvestStudioScheduleInPage })
    return (results && results[0] && results[0].result) || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'scan-failed' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// ── Studio FULL video list scrape (MVP_STUDIO_VIDEOS) ───────────────────────
// The Data API can't enumerate a big channel's full library cheaply (the
// uploads playlist walk is quota-heavy and truncates). Studio's own Content
// page already lists EVERY video via the same internal endpoint the schedule
// scrape uses — /youtubei/v1/creator/list_creator_videos — free of the Data
// API quota (it runs in the user's Studio session). This harvester is the
// schedule scrape generalized: don't filter to "scheduled", extract each
// video's privacy status + published/scheduled time + thumbnail, and hand the
// whole list back so MVP can serve the Co-Pilot draft list without spending a
// single YouTube API unit. Returns { ok, videos:[{videoId,title,status,
// publishedAt,publishAt,thumbnailUrl}], debug }.
function harvestStudioVideosInPage() {
  return (async () => {
    const out = { ok: false, videos: [], debug: {} }
    try {
      const cfg = (window.ytcfg && (window.ytcfg.data_ || {})) || {}
      const get = (k) => { try { return window.ytcfg && window.ytcfg.get ? window.ytcfg.get(k) : cfg[k] } catch (e) { return cfg[k] } }
      const apiKey = get('INNERTUBE_API_KEY')
      const context = get('INNERTUBE_CONTEXT')
      out.debug.hasApiKey = !!apiKey
      out.debug.hasContext = !!context
      if (!apiKey || !context) { out.error = 'no-ytcfg'; return out }

      const origin = 'https://studio.youtube.com'
      const cookie = (name) => { const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)')); return m ? m[1] : '' }
      const sapisid = cookie('SAPISID') || cookie('__Secure-3PAPISID') || cookie('__Secure-1PAPISID')
      out.debug.hasSapisid = !!sapisid
      const authHeader = async () => {
        const ts = Math.floor(Date.now() / 1000)
        const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sapisid} ${origin}`))
        const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
        return `SAPISIDHASH ${ts}_${hex}`
      }
      const auth = await authHeader()

      // Same mask shape as the schedule scrape (scalar → true; MESSAGE fields →
      // { all: true }), plus thumbnailDetails for the list's poster.
      const mask = {
        videoId: true,
        title: true,
        status: true,
        timeCreatedSeconds: true,
        timePublishedSeconds: true,
        draftStatus: true,
        visibility: { all: true },
        scheduledPublishingDetails: { all: true },
        thumbnailDetails: { all: true },
      }

      const findEpochSeconds = (obj, depth) => {
        if (!obj || typeof obj !== 'object' || depth > 4) return null
        for (const k in obj) {
          const val = obj[k]
          if ((typeof val === 'string' || typeof val === 'number') && /(sec|time|stamp)/i.test(k)) {
            const n = Number(val)
            if (n > 1000000000 && n < 5000000000) return n
          } else if (val && typeof val === 'object') {
            const nested = findEpochSeconds(val, depth + 1)
            if (nested) return nested
          }
        }
        return null
      }
      const titleText = (t) => typeof t === 'string' ? t : (t && (t.text || t.simpleText || (t.runs && t.runs.map((r) => r.text).join('')))) || ''
      const bestThumb = (td, videoId) => {
        try {
          const arr = (td && (td.thumbnails || td.thumbnail)) || []
          if (Array.isArray(arr) && arr.length) {
            const sorted = arr.slice().sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0))
            const u = sorted[0] && sorted[0].url
            if (typeof u === 'string' && u) return u
          }
        } catch (e) {}
        // Fallback: the standard i.ytimg URL works for most videos.
        return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
      }

      const videos = []
      const allSeen = {}
      let itemsSeen = 0, uniqueCount = 0, dryStreak = 0, pages = 0
      let pageToken
      for (let i = 0; i < 80; i++) {
        const body = { context, pageSize: 100, mask }
        if (pageToken) body.pageToken = pageToken
        const res = await fetch(`${origin}/youtubei/v1/creator/list_creator_videos?alt=json&key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': auth, 'X-Origin': origin },
          credentials: 'include',
          body: JSON.stringify(body),
        })
        if (!res.ok) { out.error = 'http-' + res.status; out.debug.httpBody = (await res.text()).slice(0, 400); break }
        const data = await res.json()
        const items = data.videos || data.items || []
        if (i === 0) {
          out.debug.responseKeys = Object.keys(data || {})
          out.debug.firstPageCount = items.length
          if (items[0]) out.debug.sampleVideo = JSON.stringify(items[0]).slice(0, 1500)
        }
        itemsSeen += items.length
        let newThisPage = 0
        for (const v of items) {
          if (!v.videoId) continue
          if (allSeen[v.videoId]) continue
          allSeen[v.videoId] = 1; uniqueCount++; newThisPage++
          const det = v.scheduledPublishingDetails || v.scheduledPublishingDetail || null
          const vis = v.visibility ? (v.visibility.effectiveStatus || v.visibility.userSetVisibility || '') : ''
          const visStr = String(vis || '').toUpperCase()
          const scheduledSecs = det ? findEpochSeconds(det, 0) : null
          const isScheduled = !!scheduledSecs || visStr.indexOf('SCHEDULED') >= 0
          // Map Studio visibility → the app's privacyStatus. A scheduled video is
          // private-until-publish, so status stays 'private' but publishAt is set.
          let status = 'private'
          if (!isScheduled) {
            if (visStr.indexOf('PUBLIC') >= 0) status = 'public'
            else if (visStr.indexOf('UNLISTED') >= 0) status = 'unlisted'
            else status = 'private'
          }
          const pubSecs = Number(v.timePublishedSeconds)
          const publishedAt = (status === 'public' && pubSecs > 1000000000 && pubSecs < 5000000000)
            ? new Date(pubSecs * 1000).toISOString() : ''
          const publishAt = scheduledSecs ? new Date(scheduledSecs * 1000).toISOString() : null
          videos.push({
            videoId: v.videoId,
            title: titleText(v.title),
            status,
            publishedAt,
            publishAt,
            thumbnailUrl: bestThumb(v.thumbnailDetails, v.videoId),
          })
        }
        pages = i + 1
        // Stall guard: pages that add no new unique video mean Studio is cycling.
        if (items.length > 0 && newThisPage === 0) { if (++dryStreak >= 3) { out.debug.stalled = true; break } } else { dryStreak = 0 }
        pageToken = data.nextPageToken
        if (!pageToken) break
      }
      out.debug.pages = pages
      out.debug.itemsSeen = itemsSeen
      out.debug.uniqueVideos = uniqueCount
      out.videos = videos
      out.ok = !out.error
      return out
    } catch (e) {
      out.error = (e && e.message) || 'exception'
      return out
    }
  })()
}

async function scanStudioVideos() {
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url: STUDIO_URL, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    await _sleep(2500)
    const results = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: harvestStudioVideosInPage })
    return (results && results[0] && results[0].result) || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'scan-failed' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// ── Studio "finish" automation (MVP_STUDIO_FINISH) ──────────────────────────
// After MVP pushes a video's metadata through the public Data API, a few
// Studio-only fields remain that the API can't set: per-video Monetization, the
// ad-suitability self-certification, and end screens. The user OPTS IN (an
// explicit checkbox in Co-Pilot that spells out each action), then SCOUT opens
// Studio in their own logged-in session and drives the real UI controls —
// exactly the clicks they'd do by hand.
//
// We deliberately DRIVE THE DOM rather than POST to undocumented internal write
// endpoints: a missing control safely no-ops, whereas a malformed write to a
// guessed endpoint could corrupt a real video field. Studio is a Polymer SPA
// (shadow DOM), so the in-page helpers pierce shadow roots, match controls by
// visible/aria text, and return a `debug` map of the controls they saw — so the
// inevitable selector tuning is fast (same philosophy as the schedule read).
//
// NOT touched here: the notify-subscribers bell. MVP already sends
// notifySubscribers=false through the Data API, so it's off by construction.
const STUDIO_VIDEO = (id, panel) => `https://studio.youtube.com/video/${id}/${panel}`

// Shared, self-contained in-page toolkit. Injected functions can't reference
// outer scope, so each one rebuilds these from this source via .toString()
// concatenation is overkill — instead we just duplicate the tiny helpers inline
// in each function below. (Kept identical on purpose.)

function studioFinishMonetizeInPage() {
  return (async () => {
    const out = { step: 'monetization', ok: false, certOk: false, detail: '', debug: {} }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const deepAll = () => {
      const acc = []
      const walk = (root) => {
        let els
        try { els = root.querySelectorAll('*') } catch (e) { return }
        for (const el of els) { acc.push(el); if (el.shadowRoot) walk(el.shadowRoot) }
      }
      walk(document)
      return acc
    }
    const visText = (el) => {
      try {
        const a = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))
        return (a || el.textContent || '').replace(/\s+/g, ' ').trim()
      } catch (e) { return '' }
    }
    const clickable = (el) => {
      const t = (el.tagName || '').toLowerCase()
      if (/^(button|a)$/.test(t)) return true
      if (/button|paper-item|dropdown|listbox|radio|menu-item|option/.test(t)) return true
      const r = el.getAttribute && el.getAttribute('role')
      return r === 'button' || r === 'option' || r === 'menuitem' || r === 'radio'
    }
    const click = (el) => {
      if (!el) return false
      try { el.scrollIntoView({ block: 'center' }) } catch (e) {}
      try { el.click() } catch (e) {}
      try { ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))) } catch (e) {}
      return true
    }
    // Find the shortest-text clickable matching any regex (prefers the leaf
    // control, not an enclosing wrapper that also contains the label).
    const find = (res) => {
      let best = null, bestLen = 1e9
      for (const el of deepAll()) {
        if (!clickable(el)) continue
        const tx = visText(el)
        if (!tx || tx.length > 60) continue
        for (const re of res) { if (re.test(tx)) { if (tx.length < bestLen) { best = el; bestLen = tx.length }; break } }
      }
      return best
    }
    const waitFind = async (res, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = find(res); if (v) return v; await sleep(300) } return null }
    const sample = () => Array.from(new Set(deepAll().filter(clickable).map(visText).filter((t) => t && t.length < 45))).slice(0, 70)

    try {
      await sleep(2000) // let the monetization panel render
      out.debug.url = location.href.slice(0, 160)
      out.debug.controlsBefore = sample()

      // Non-monetized / not-in-YPP channels have no On toggle and no ad-rating
      // here — the page invites you to APPLY to the Partner Program instead.
      // Detect that so we report "not monetized" (neutral) rather than a failure.
      const bodyTxt = (document.body ? document.body.innerText : '').toLowerCase()
      out.debug.notMonetizedSignal = /partner program|isn'?t eligible|not eligible|monetization (is )?(not|isn'?t) available|apply (now|to join)|join the youtube partner|once you'?re eligible/i.test(bodyTxt)

      // 1) Open the Monetization on/off dropdown (currently reads "Off") and
      //    choose the "On" option.
      const trigger = find([/monetization (is )?off/i, /^off$/i, /turn on monetization/i, /watch page ads/i])
      out.debug.triggerText = trigger ? visText(trigger) : null
      if (!trigger) {
        // No toggle. If the page is clearly a not-monetized invite, that's
        // expected for this channel — neutral skip, not an error.
        out.skipped = !!out.debug.notMonetizedSignal
        out.detail = out.skipped
          ? 'Channel isn’t monetized — nothing to turn on (end screen still applies)'
          : 'Monetization toggle not found — see debug'
        out.debug.controlsAfter = sample()
        return out
      }
      click(trigger)
      await sleep(1000)
      const onOpt = find([/^on$/i, /monetization on/i, /turn on/i])
      out.debug.onOptText = onOpt ? visText(onOpt) : null
      if (onOpt) { click(onOpt); await sleep(1000) }

      // 2) Ad-suitability self-certification. The questionnaire defaults to
      //    "None" → "Safe for ads", so the action is to submit the rating.
      const submitCert = await waitFind([/submit rating/i, /^submit$/i], 6000)
      out.debug.submitCertText = submitCert ? visText(submitCert) : null
      if (submitCert) { click(submitCert); out.certOk = true; await sleep(1000) }

      // 3) Save the monetization change.
      const save = await waitFind([/^save$/i, /^done$/i], 6000)
      out.debug.saveText = save ? visText(save) : null
      if (save) {
        click(save); await sleep(1500); out.ok = true
        out.detail = 'Monetization set; ' + (out.certOk ? 'rating submitted' : 'rating control not found')
      } else {
        out.detail = out.certOk ? 'Rating submitted; Save not found' : 'Controls not found — see debug'
      }
      out.debug.controlsAfter = sample()
      return out
    } catch (e) {
      out.error = (e && e.message) || 'exception'
      return out
    }
  })()
}

function studioFinishEndScreenInPage() {
  return (async () => {
    const out = { step: 'endscreen', ok: false, partial: false, detail: '', debug: {} }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const deepAll = () => {
      const acc = []
      const walk = (root) => {
        let els
        try { els = root.querySelectorAll('*') } catch (e) { return }
        for (const el of els) { acc.push(el); if (el.shadowRoot) walk(el.shadowRoot) }
      }
      walk(document)
      return acc
    }
    const visText = (el) => {
      try {
        const a = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))
        return (a || el.textContent || '').replace(/\s+/g, ' ').trim()
      } catch (e) { return '' }
    }
    const clickable = (el) => {
      const t = (el.tagName || '').toLowerCase()
      if (/^(button|a)$/.test(t)) return true
      if (/button|paper-item|dropdown|listbox|menu-item|option|card|template/.test(t)) return true
      const r = el.getAttribute && el.getAttribute('role')
      return r === 'button' || r === 'option' || r === 'menuitem'
    }
    const click = (el) => {
      if (!el) return false
      try { el.scrollIntoView({ block: 'center' }) } catch (e) {}
      try { el.click() } catch (e) {}
      try { ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))) } catch (e) {}
      return true
    }
    const find = (res) => {
      let best = null, bestLen = 1e9
      for (const el of deepAll()) {
        if (!clickable(el)) continue
        const tx = visText(el)
        if (!tx || tx.length > 70) continue
        for (const re of res) { if (re.test(tx)) { if (tx.length < bestLen) { best = el; bestLen = tx.length }; break } }
      }
      return best
    }
    const waitFind = async (res, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = find(res); if (v) return v; await sleep(300) } return null }
    const sample = () => Array.from(new Set(deepAll().filter(clickable).map(visText).filter((t) => t && t.length < 50))).slice(0, 70)

    try {
      await sleep(2200) // end-screen editor is heavy
      out.debug.url = location.href.slice(0, 160)
      out.debug.controlsBefore = sample()

      // Prefer the "Import from video" / copy-from-previous template — that's
      // the "same as last video" action.
      const importBtn = await waitFind([/import from video/i, /copy from.*video/i, /apply template/i, /most recent upload/i, /from a recent video/i], 7000)
      out.debug.importText = importBtn ? visText(importBtn) : null
      if (!importBtn) { out.detail = 'Import-from-video control not found — see debug'; out.debug.controlsAfter = sample(); return out }

      click(importBtn)
      await sleep(1800)
      // A picker may open listing recent videos; the top item is the most recent.
      const pick = (() => {
        const items = deepAll().filter((el) => {
          const r = el.getAttribute && el.getAttribute('role')
          const cls = (el.className || '').toString()
          return r === 'option' || /video-row|video-list-item|endscreen-template|video-card/i.test(cls)
        })
        return items[0] || null
      })()
      if (pick) { click(pick); await sleep(1400) } else { out.partial = true }

      const save = await waitFind([/^save$/i, /^done$/i, /^apply$/i], 6000)
      out.debug.saveText = save ? visText(save) : null
      if (save) {
        click(save); await sleep(1500); out.ok = true
        out.detail = out.partial ? 'Import opened — pick last video & save in Studio' : 'End screen copied from last video'
      } else {
        out.partial = true
        out.detail = 'Import opened; finish & save in Studio'
      }
      out.debug.controlsAfter = sample()
      return out
    } catch (e) {
      out.error = (e && e.message) || 'exception'
      return out
    }
  })()
}

// Details page (/edit): the disclosures + feed settings the Data API can't set.
// Sets paid-promotion ON, AI-use = No (genuine footage — the user owns this in
// the opt-in copy), Allow embedding ON, and FORCES "Publish to subscriptions
// feed and notify subscribers" OFF (YouTube defaults it ON — the user
// explicitly wants no bell on this persistent setting too). Then Saves.
function studioFinishDetailsInPage() {
  return (async () => {
    const out = { step: 'details', ok: false, detail: '', actions: {}, debug: {} }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const deepAll = () => {
      const acc = []
      const walk = (root) => {
        let els
        try { els = root.querySelectorAll('*') } catch (e) { return }
        for (const el of els) { acc.push(el); if (el.shadowRoot) walk(el.shadowRoot) }
      }
      walk(document)
      return acc
    }
    const visText = (el) => {
      try {
        const a = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))
        return (a || el.textContent || '').replace(/\s+/g, ' ').trim()
      } catch (e) { return '' }
    }
    const click = (el) => {
      if (!el) return false
      try { el.scrollIntoView({ block: 'center' }) } catch (e) {}
      try { el.click() } catch (e) {}
      try { ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))) } catch (e) {}
      return true
    }
    const isBtn = (el) => { const t = (el.tagName || '').toLowerCase(); return /button|ytcp-button/.test(t) || (el.getAttribute && el.getAttribute('role') === 'button') }
    const isCtrl = (el) => {
      const t = (el.tagName || '').toLowerCase()
      const r = el.getAttribute && el.getAttribute('role')
      return /checkbox|radio/.test(t) || r === 'checkbox' || r === 'radio'
    }
    const isChecked = (el) => {
      if (!el) return false
      const ac = el.getAttribute && el.getAttribute('aria-checked')
      if (ac === 'true') return true
      if (ac === 'false') return false
      if (el.checked === true) return true
      const cls = (el.className || '').toString()
      if (/(^|[\s-])(checked|selected|active)([\s-]|$)/.test(cls)) return true
      try { if (el.querySelector && el.querySelector('[aria-checked="true"]')) return true } catch (e) {}
      return false
    }
    // Ancestor text up to N levels — used to scope a control to its section.
    const ctx = (el, n) => { let s = '', e = el; for (let i = 0; i < n && e; i++) { s += ' ' + (e.textContent || ''); e = e.parentElement } return s.replace(/\s+/g, ' ').toLowerCase() }
    const findCtrl = (labelRe, ownTextRe) => {
      const ctrls = deepAll().filter(isCtrl)
      if (ownTextRe) { for (const el of ctrls) { if (ownTextRe.test(visText(el)) && labelRe.test(ctx(el, 8))) return el } }
      for (const el of ctrls) { if (labelRe.test(visText(el)) || labelRe.test(ctx(el, 5))) return el }
      return null
    }
    const setCheckbox = (labelRe, desired, key) => {
      const el = findCtrl(labelRe)
      if (!el) { out.actions[key] = 'not-found'; return }
      const cur = isChecked(el)
      if (cur !== desired) { click(el); out.actions[key] = desired ? 'turned-on' : 'turned-off' }
      else { out.actions[key] = desired ? 'already-on' : 'already-off' }
    }
    const snapshot = () => Array.from(new Set(deepAll().filter(isCtrl).map((el) => `${visText(el).slice(0, 40)}=${isChecked(el) ? 'on' : 'off'}`))).slice(0, 60)

    try {
      await sleep(2200)
      out.debug.url = location.href.slice(0, 160)
      // Embedding + subs-feed live under "Show more" — expand it first.
      const showMore = deepAll().filter(isBtn).find((el) => /show more/i.test(visText(el)))
      out.debug.showMore = !!showMore
      if (showMore) { click(showMore); await sleep(1200) }
      out.debug.controlsBefore = snapshot()

      // 1) Paid promotion ON
      setCheckbox(/paid promotion|product placement|sponsorship|endorsement/i, true, 'paidPromotion')
      await sleep(300)
      // 2) Allow embedding ON
      setCheckbox(/allow embedding/i, true, 'embedding')
      await sleep(300)
      // 3) Publish to subscriptions feed & notify subscribers — OFF (critical)
      setCheckbox(/publish to subscriptions feed|notify subscribers/i, false, 'notify')
      await sleep(300)
      // 4) AI use / altered content → "No"
      const noRadio = findCtrl(/\bai\b|alter|synthetic|realistic-looking|didn'?t actually occur|generate or edit/i, /^no$/i)
      if (noRadio) { if (!isChecked(noRadio)) click(noRadio); out.actions.aiUse = 'no' } else { out.actions.aiUse = 'not-found' }
      await sleep(400)

      // Save
      let save = null, len = 1e9
      for (const el of deepAll().filter(isBtn)) { const tx = visText(el); if (/^save$/i.test(tx) && tx.length < len) { save = el; len = tx.length } }
      out.debug.saveText = save ? visText(save) : null
      if (save) { click(save); await sleep(1500) }
      out.debug.controlsAfter = snapshot()

      // Count it done when the critical notify-off control was found + we saved.
      const notifyHandled = out.actions.notify && out.actions.notify !== 'not-found'
      out.ok = !!save && !!notifyHandled
      out.detail = `paid:${out.actions.paidPromotion || '?'} · embed:${out.actions.embedding || '?'} · notify:${out.actions.notify || '?'} · AI-use:${out.actions.aiUse || '?'}`
      if (!save) out.detail += ' · Save not found'
      return out
    } catch (e) {
      out.error = (e && e.message) || 'exception'
      return out
    }
  })()
}

async function scanStudioFinish(videoId, opts, callerTabId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) return { ok: false, error: 'bad-video-id', steps: [] }
  const want = opts || { details: true, monetize: true, selfCert: true, endScreen: true }
  const steps = []
  let tabId = null
  // First panel we need to land on (open the tab there directly).
  const startPanel = want.details ? 'edit' : (want.monetize || want.selfCert) ? 'monetization' : 'endscreens'
  let current = startPanel
  // Navigate the SAME tab between Studio panels, only reloading when the panel
  // actually changes (re-assigning the same URL wouldn't fire 'complete').
  const goto = async (panel) => {
    if (current === panel) return
    await chrome.tabs.update(tabId, { url: STUDIO_VIDEO(videoId, panel) })
    await waitForTabLoad(tabId, 30000)
    current = panel
  }
  try {
    // FOREGROUND: Studio is a heavy SPA and DOM interaction is far more reliable
    // in a focused tab (background tabs throttle timers/rendering). We restore
    // the caller's tab in `finally` so MVP stays in front afterward.
    const tab = await chrome.tabs.create({ url: STUDIO_VIDEO(videoId, startPanel), active: true })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    if (want.details) {
      await goto('edit')
      const r = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: studioFinishDetailsInPage })
      steps.push((r && r[0] && r[0].result) || { step: 'details', ok: false, error: 'no-result' })
    }
    if (want.monetize || want.selfCert) {
      await goto('monetization')
      const r = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: studioFinishMonetizeInPage })
      steps.push((r && r[0] && r[0].result) || { step: 'monetization', ok: false, error: 'no-result' })
    }
    if (want.endScreen) {
      await goto('endscreens')
      const r = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: studioFinishEndScreenInPage })
      steps.push((r && r[0] && r[0].result) || { step: 'endscreen', ok: false, error: 'no-result' })
    }
    return { ok: steps.some((s) => s && s.ok), steps }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'finish-failed', steps }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
    if (callerTabId != null) { try { await chrome.tabs.update(callerTabId, { active: true }) } catch (e) {} }
  }
}

// ── Messages from the MVP dashboard (externally_connectable) ────────────────
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return
  if (msg.type === 'MVP_STUDIO_SCHEDULE') {
    // Scraping Studio + paginating the internal API can take a bit; allow 2 min.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 120000)
    scanStudioSchedule()
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_STUDIO_VIDEOS') {
    // Full-library list scrape (quota-free) that feeds the Co-Pilot draft list.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 120000)
    scanStudioVideos()
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version })
    return // sync response
  }
  if (msg.type === 'MVP_AMZ_SCAN') {
    // With an ASIN → piggyback on OINK via the product page (the reliable path).
    // Without → legacy Manage Content scrape. Allow up to 2 minutes.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 120000)
    const job = msg.asin ? scanAmazonVideoForAsin(msg.asin, callerTabId) : scanAmazonVideos(callerTabId)
    job
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_AMZ_PRODUCT') {
    // Open the product page in the user's logged-in browser and read its
    // details — the fallback when MVP's server scrape is IP-blocked.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 60000)
    scanAmazonProductForAsin(msg.asin, callerTabId)
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
  if (msg.type === 'MVP_MESSAGE_BRAND') {
    // MVP asks us to open a campaign's Amazon page (the user's session), open
    // its "Message Brand" box and DROP IN a draft. We never click Send — the
    // user reviews the FOREGROUND tab and sends it themselves.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 60000)
    openAndPlaceBrandMessage(msg.detailsUrl, msg.message || '')
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_SEND_BRAND') {
    // Compose-and-send from the MVP modal: the user already reviewed the exact
    // text and clicked Send, so we open the campaign in a BACKGROUND tab, fill
    // the message and submit it — all inside the user's session, no visible tab.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 75000)
    sendBrandMessage(msg.detailsUrl, msg.message || '', callerTabId)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_SCRAPE_URL') {
    // "Post from a link" for non-Amazon stores. MVP's server can't scrape
    // Walmart/Target/etc. (datacenter IPs are blocked), so SCOUT opens the page
    // in the user's own browser and reads its structured product data.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 70000)
    scanGenericProduct(msg.url, callerTabId)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_CC_FIND') {
    // Live "is this product a Creator Connections campaign?" lookup: CC search by
    // brand/keyword + resolve each result's ASIN until the target matches. A
    // search plus up to ~15 background ASIN resolves — allow up to 3 minutes.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 180000)
    ccFindCampaign(msg.query || '', msg.asin || '', callerTabId)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_CC_MATCH') {
    // "Check all CC": one CC search by keyword, resolve result-card ASINs once,
    // match against the whole target set. Up to ~40 background ASIN resolves +
    // a possible foreground grid pass — allow up to 5 minutes.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 300000)
    ccMatchCampaigns(msg.keyword || '', msg.asins || [], callerTabId)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_CC_ACCEPT') {
    // /epc "Accept on Amazon": open the campaign's details page + click Accept,
    // background-first with a foreground fallback. Allow up to 90s.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 90000)
    acceptCampaignByUrl(msg.detailsUrl, callerTabId)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_PRODUCT_SEARCH') {
    // Product Finder: keyword + rules → live Amazon results, each deep-checked
    // (monthly sales + carousel-video position) and filtered, in a hidden tab.
    // Paginates the search to a ~100 pool + deep-checks up to 50 (a /dp visit
    // each), so allow up to ~7 minutes.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 420000)
    productFinderSearch(msg.query, msg.opts || {})
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
}
)

// Runs IN the Amazon campaign page: open the Message Brand box (if needed) and
// place `message` in the textarea. Returns once the text is in — never sends.
// Matches ONLY "Message Brand" (never a bare "Message" nav link, which would
// navigate away), and keeps retrying the click for ~16s since the campaign page
// is a slow React SPA whose button/box can render late.
function placeBrandMessageInPage(message) {
  const textOf = (el) => (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim()
  const findTextarea = () => [...document.querySelectorAll('textarea')].find((t) => /message/i.test(t.getAttribute('placeholder') || '')) || document.querySelector('textarea')
  const findMsgBtn = () => [...document.querySelectorAll('button,a,[role="button"]')].find((e) => /message brand|message the brand/i.test(textOf(e)))
  const setVal = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
    if (d && d.set) d.set.call(el, v); else el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.focus()
    try { el.scrollIntoView({ block: 'center' }) } catch (e) {}
  }
  return new Promise((resolve) => {
    let tries = 0, everClicked = false
    const iv = setInterval(() => {
      tries++
      const t = findTextarea()
      if (t) { clearInterval(iv); setVal(t, message); resolve({ ok: true, tries }); return }
      const b = findMsgBtn()
      if (b) { b.click(); everClicked = true }
      if (tries >= 40) { clearInterval(iv); resolve({ ok: false, reason: everClicked ? 'message-box-never-opened' : 'no-message-brand-button' }) }
    }, 400)
  })
}

async function openAndPlaceBrandMessage(detailsUrl, message) {
  if (!detailsUrl) return { ok: false, error: 'no-url' }
  try {
    // Foreground so the user sees the message box and can review + Send.
    const tab = await chrome.tabs.create({ url: detailsUrl, active: true })
    await waitForTabLoad(tab.id, 25000)
    await _sleep(3000) // let the campaign SPA render the "Message Brand" button
    let r = null
    for (let i = 0; i < 2; i++) {
      const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: placeBrandMessageInPage, args: [message] })
      r = res && res[0] && res[0].result
      if (r && r.ok) break
      await _sleep(1500)
    }
    return r || { ok: false, reason: 'place-failed' }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'exception' }
  }
}

// Runs IN the campaign page: open the Message Brand box (robustly — synthetic
// click, contenteditable fallback, long polling), fill the message, VERIFY the
// full text is in, then click Send. Returns { ok, steps, reason } so failures
// are diagnosable. Only submits when our exact text is present — never a partial.
async function sendBrandMessageInPage(message) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const textOf = (el) => norm(el && (el.innerText || el.textContent))
  const attrText = (el) => norm((el.innerText || el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || ''))
  const findMsgBtn = () => {
    const c = [...document.querySelectorAll('button,a,[role="button"]')]
    return c.find((e) => /message brand|message the brand/i.test(textOf(e)))
      || c.find((e) => /message/i.test(textOf(e)) && /brand/i.test(textOf(e)))
  }
  // NO visibility check — a just-loaded / background tab may not lay out
  // (getBoundingClientRect is 0×0), yet the box's textarea exists in the DOM
  // once React opens it. Require the message placeholder so we never fill an
  // unrelated textarea.
  const findInput = () => {
    const ta = [...document.querySelectorAll('textarea')].find((t) => /message/i.test(t.getAttribute('placeholder') || ''))
    if (ta) return { el: ta, kind: 'ta' }
    const ce = [...document.querySelectorAll('[contenteditable="true"]')].find((c) => /message/i.test((c.getAttribute('aria-label') || '') + ' ' + (c.getAttribute('data-placeholder') || '')))
    if (ce) return { el: ce, kind: 'ce' }
    return null
  }
  const realClick = (el) => {
    try { ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))) }
    catch (e) { try { el.click() } catch (e2) {} }
  }
  const setInput = (input, v) => {
    try { input.el.focus() } catch (e) {}
    if (input.kind === 'ta') {
      const d = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      if (d && d.set) d.set.call(input.el, v); else input.el.value = v
    } else {
      const esc = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      input.el.innerHTML = esc.replace(/\n/g, '<br>')
    }
    // FULL event burst so React's onChange fires + the Send button un-disables
    // (a bare 'input' event left Send disabled → "send-button-not-found").
    try { input.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: v })) }
    catch (e) { input.el.dispatchEvent(new Event('input', { bubbles: true })) }
    input.el.dispatchEvent(new Event('change', { bubbles: true }))
    input.el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }))
    input.el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }))
  }
  const readInput = (input) => input.kind === 'ta' ? input.el.value : textOf(input.el)
  // Amazon's Send button — matched TOLERANTLY: enabled (checks disabled prop AND
  // aria-disabled), label "send" as a word (covers "Send", "Send message"), by
  // text/aria/title, shortest label first. Also accepts input[type=submit].
  const findSend = (scope) => {
    const cands = [...(scope || document).querySelectorAll('button,[role="button"],input[type="submit"]')]
    const ok = cands.filter((b) => {
      if (b.disabled === true || b.getAttribute('aria-disabled') === 'true') return false
      const t = attrText(b); return /(^|\s)send(\b|$)/i.test(t) && t.length <= 24
    })
    ok.sort((a, z) => ((a.textContent || '').trim().length) - ((z.textContent || '').trim().length))
    return ok[0] || null
  }
  const sendCandidatesDump = () => [...document.querySelectorAll('button,[role="button"],input[type="submit"]')]
    .filter((b) => /send/i.test((b.innerText || b.textContent || b.value || '') + ' ' + (b.getAttribute('aria-label') || '')))
    .slice(0, 8)
    .map((b) => ({
      text: ((b.innerText || b.textContent || b.value || '')).replace(/\s+/g, ' ').trim().slice(0, 30),
      aria: (b.getAttribute('aria-label') || '').slice(0, 30),
      disabled: b.disabled === true || b.getAttribute('aria-disabled') === 'true',
    }))
  // After Send, Amazon pops "Potential Personal Information was detected …" with
  // a CONTINUE button. It's a PLAIN modal (not role="dialog"), so find it by its
  // TEXT, then click Continue/OK. NO visibility check — a background tab has no
  // layout (offsetParent/getBoundingClientRect are 0), which is what stalled the
  // send on this dialog before.
  const findConfirmOk = () => {
    const isConfirm = (t) => /^(continue|ok|okay|i understand|understood|got it|proceed|agree|accept|acknowledge|confirm|send( message| anyway)?)$/i.test(t)
    const scopes = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"]')]
    const pi = [...document.querySelectorAll('div,section,form')].find((e) => {
      const tx = e.textContent || ''
      return /personal information (was )?detected|share personal information/i.test(tx) && tx.length < 900
    })
    if (pi) scopes.push(pi)
    const roots = scopes.length ? scopes : [document.body || document]
    for (let i = roots.length - 1; i >= 0; i--) {
      const btn = [...roots[i].querySelectorAll('button,[role="button"],input[type="submit"],a')].find((b) => {
        if (b.disabled === true || b.getAttribute('aria-disabled') === 'true') return false
        return isConfirm(attrText(b))
      })
      if (btn) return btn
    }
    return null
  }
  // Split on the ---- Add to Message Group ---- markers (fallback: blank lines).
  const splitSegments = (msg) => {
    const s = String(msg || '').trim()
    const hasMarker = /-{2,}\s*add to message group\s*-{2,}/i.test(s)
    const parts = hasMarker ? s.split(/\s*-{2,}\s*add to message group\s*-{2,}\s*/i) : s.split(/\n\s*\n+/)
    return parts.map((x) => x.trim()).filter(Boolean)
  }
  const url0 = location.href
  const steps = { opened: false, filled: false, sent: false }

  // Open the message box (poll: React may render the box a beat after the click).
  let input = findInput()
  for (let t = 0; t < 60 && !input; t++) {
    const b = findMsgBtn(); if (b) { realClick(b); steps.opened = true }
    await sleep(350)
    input = findInput()
  }
  if (!input) {
    return { ok: false, steps, reason: steps.opened ? 'box-never-opened' : 'no-message-button',
      diag: { clickedMsgBtn: steps.opened, navigated: location.href !== url0, url: location.href.slice(0, 120), textareas: document.querySelectorAll('textarea').length, ce: document.querySelectorAll('[contenteditable="true"]').length } }
  }
  steps.opened = true

  // Send the group as SEPARATE messages: fill a segment → click Send → it posts
  // → the box clears → fill the next → Send again. ONE Send per marker, NOT a
  // queue (this is how OINK / ViralVue do it). readInput isn't relied on here —
  // we just fill, wait for Send to enable, click it, and move on.
  void readInput
  const segments = splitSegments(message)
  let sent = 0
  for (let i = 0; i < segments.length; i++) {
    const inp = findInput() || input
    setInput(inp, segments[i]); steps.filled = true
    await sleep(650)                                 // let React register the text + enable Send
    let send = null
    for (let t = 0; t < 20 && !send; t++) {          // wait up to ~5s for Send to enable
      send = findSend(inp.el.closest('[role="dialog"],form,section,div') || document) || findSend(document)
      if (!send) await sleep(250)
    }
    if (!send) break                                 // Send never enabled — stop (segment is placed)
    realClick(send); sent++; steps.sent = true
    // Amazon pops "Personal Information detected" (with a Continue button) on
    // messages with an address/email/phone — click it, then wait for it to close.
    await sleep(500)
    for (let k = 0; k < 16; k++) { const ok = findConfirmOk(); if (ok) { realClick(ok); await sleep(700); break } await sleep(300) }
    await sleep(1300)                                // wait for the message to post + the box to clear
  }
  if (sent === 0) {
    return { ok: false, steps, reason: 'send-button-not-found', groups: 0,
      diag: { filled: steps.filled, sendCandidates: sendCandidatesDump() } }
  }
  return { ok: true, steps, groups: sent }
}

// Runs IN a campaign tab: if the session is on an ONSITE store-id (the "onamz…"
// prefix), Creator Connections is blocked — flip the StoreID switcher to the
// OFFSITE store (same tag without onamz) so CC unlocks. Returns { switched } —
// a switch reloads the page, so the caller re-opens the details URL after.
function ensureOffsiteStoreInPage() {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const bodyText = document.body ? (document.body.innerText || '') : ''
  const onsiteError = /onsite store[- ]?id/i.test(bodyText)
  const curM = bodyText.match(/store\s?id:\s*([a-z0-9]+-\d{2})/i)
  const cur = curM ? curM[1] : null
  const needs = onsiteError || (!!cur && /^onamz/i.test(cur))
  if (!needs) return { onsite: false, switched: false, store: cur }
  const looksLikeStoreId = (s) => /[a-z0-9]+-\d{2}\b/i.test(s || '')
  const clickEl = (el) => { ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => { try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })) } catch (e) {} }) }
  // Native <select> switcher.
  for (const s of document.querySelectorAll('select')) {
    const opts = [...s.options]
    if (!opts.some((o) => looksLikeStoreId(o.value || o.textContent))) continue
    const target = opts.find((o) => { const v = (o.value || o.textContent || ''); return looksLikeStoreId(v) && !/onamz/i.test(v) })
    if (target) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')
      if (setter && setter.set) setter.set.call(s, target.value); else s.value = target.value
      s.dispatchEvent(new Event('input', { bubbles: true }))
      s.dispatchEvent(new Event('change', { bubbles: true }))
      return { onsite: true, switched: true, store: norm(target.value || target.textContent) }
    }
  }
  // Custom dropdown: open it, wait for the menu, click the non-onamz store.
  const ctrl = [...document.querySelectorAll('button,[role="button"],[aria-haspopup],a,span,div')]
    .find((e) => /store\s?id:/i.test(e.innerText || e.textContent || '') && norm(e.innerText || e.textContent).length < 60)
  if (ctrl) {
    clickEl(ctrl)
    return new Promise((resolve) => setTimeout(() => {
      const items = [...document.querySelectorAll('[role="option"],[role="menuitem"],li,button,a,div')]
        .filter((e) => { const t = norm(e.innerText || e.textContent); return looksLikeStoreId(t) && t.length < 60 })
      const target = items.find((e) => !/onamz/i.test(e.innerText || e.textContent || ''))
      if (target) { clickEl(target); resolve({ onsite: true, switched: true, store: norm(target.innerText || target.textContent) }) }
      else resolve({ onsite: true, switched: false, store: cur, reason: 'no-offsite-option' })
    }, 800))
  }
  return { onsite: true, switched: false, store: cur, reason: 'no-switcher' }
}

// Send the brand message entirely in a HIDDEN BACKGROUND tab — the user stays on
// the MVP page and never gets moved to Amazon. React executes in background tabs
// (only paint is throttled) and every step reads/writes the DOM, so no visible
// layout is needed. If the campaign page is blocked by an onsite store-id, we
// auto-switch to the offsite store (still in the background) and re-open it.
async function sendBrandMessage(detailsUrl, message, callerTabId) {
  if (!detailsUrl) return { ok: false, error: 'no-url' }
  if (!message || !message.trim()) return { ok: false, error: 'no-message' }
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url: detailsUrl, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 25000)
    await _sleep(2500)
    // Auto-fix the store-id if CC is blocked (all in this background tab).
    try {
      const sres = await chrome.scripting.executeScript({ target: { tabId }, func: ensureOffsiteStoreInPage })
      const sw = sres && sres[0] && sres[0].result
      if (sw && sw.switched) {
        await _sleep(1500)
        try { await waitForTabLoad(tabId, 25000) } catch (e) {}
        // The store switch may bounce us to the Associates home — re-open the
        // campaign details page, now on the eligible offsite store.
        await chrome.tabs.update(tabId, { url: detailsUrl })
        await waitForTabLoad(tabId, 25000)
        await _sleep(2500)
      }
    } catch (e) { /* non-fatal — try the send anyway */ }
    let r = null
    for (let i = 0; i < 2; i++) {
      const res = await chrome.scripting.executeScript({ target: { tabId }, func: sendBrandMessageInPage, args: [message] })
      r = res && res[0] && res[0].result
      if (r && r.ok) break
      await _sleep(1500)
    }
    return r || { ok: false, reason: 'send-failed' }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'exception' }
  } finally {
    // Opened in the background — nothing to restore, and re-activating the caller
    // could itself flicker the user's tab. Just close our hidden tab.
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}
