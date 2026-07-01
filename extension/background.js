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
}
)
