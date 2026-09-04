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

// Where SCOUT pushes imported campaigns. Doing the ingest POST from the service
// worker (not the content script) means it's NOT subject to amazon.com's page
// CSP `connect-src` — a content-script fetch to a third-party origin can be
// silently blocked by a strict host CSP, which looks like "nothing pushed".
const MVP_ORIGIN = 'https://www.mvpaffiliate.io'

// POST campaigns into the MVP ingest endpoint from the background context.
// Returns { ok, error, status, inserted, skipped }. `reached:true` means we got
// an HTTP response back (so the caller should trust this result and NOT retry
// via its own fetch); a thrown/network failure returns reached:false.
async function pushCampaignsToMvp(token, campaigns) {
  if (!token) return { reached: false, ok: false, error: 'no token' }
  try {
    const res = await fetch(`${MVP_ORIGIN}/api/campaigns/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ campaigns }),
    })
    let body = null
    try { body = await res.json() } catch (e) {}
    if (res.ok) return { reached: true, ok: true, inserted: body && body.inserted, skipped: body && body.skipped }
    return { reached: true, ok: false, status: res.status, error: (body && body.error) || `HTTP ${res.status}` }
  } catch (e) {
    return { reached: false, ok: false, error: (e && e.message) || 'network error' }
  }
}

// POST scraped Amazon Influencer earnings into MVP (Storefront Stats v2), from
// the worker (same CSP-avoidance reason as pushCampaignsToMvp). Returns
// { reached, ok, upserted, error }.
async function pushEarningsToMvp(earnings, totals) {
  const rows = Array.isArray(earnings) ? earnings : []
  const tot = Array.isArray(totals) ? totals : []
  if (rows.length === 0 && tot.length === 0) return { reached: true, ok: true, upserted: 0 }
  // Session bridge: the worker fetch carries the user's mvpaffiliate.io cookie
  // so the revived /api/storefront/ingest authenticates via the signed-in
  // session. Try BOTH origins: the app is served on the apex mvpaffiliate.io,
  // and a POST to www.mvpaffiliate.io 301-redirects to apex — a cross-origin
  // credentialed redirect Chrome blocks as "Failed to fetch". Hitting the apex
  // first (then www) avoids that. Both hosts are in host_permissions.
  const origins = ['https://mvpaffiliate.io', 'https://www.mvpaffiliate.io']
  let lastErr = 'network error'
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}/api/storefront/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        redirect: 'follow',
        body: JSON.stringify({ earnings: rows, totals: tot }),
      })
      let body = null
      try { body = await res.json() } catch (e) {}
      if (res.ok) return { reached: true, ok: true, upserted: body && body.upserted }
      lastErr = (body && body.error) || `HTTP ${res.status}`
      // A real HTTP response (e.g. 401) means we reached MVP — don't try the
      // other origin, the session/endpoint is the issue, not the host.
      return { reached: true, ok: false, status: res.status, error: lastErr }
    } catch (e) {
      lastErr = (e && e.message) || 'network error'
      // Network-level failure (redirect/CORS/host) — try the next origin.
    }
  }
  return { reached: false, ok: false, error: lastErr }
}

// POST idea-list metadata / captured items into MVP, from the worker (same
// session-cookie bridge as earnings). One helper, two shapes (lists | list).
async function pushIdeaListToMvp(payload) {
  try {
    const res = await fetch(`${MVP_ORIGIN}/api/idea-list/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })
    let body = null
    try { body = await res.json() } catch (e) {}
    if (res.ok) { try { console.debug('[SCOUT] idea-list sync ok →', body) } catch (e) {} ; return { reached: true, ok: true, upserted: body && body.upserted } }
    try { console.warn('[SCOUT] idea-list sync failed', res.status, body) } catch (e) {}
    return { reached: true, ok: false, status: res.status, error: (body && body.error) || `HTTP ${res.status}` }
  } catch (e) {
    try { console.warn('[SCOUT] idea-list sync network error', e && e.message) } catch (er) {}
    return { reached: false, ok: false, error: (e && e.message) || 'network error' }
  }
}

// POST the full public-storefront catalog (asin/title/image/shelf) into MVP.
// Same apex-first origin fallback as the earnings push (the app is on the apex
// mvpaffiliate.io; www 301-redirects a credentialed POST → "Failed to fetch").
async function pushCatalogToMvp(products) {
  const rows = Array.isArray(products) ? products : []
  if (!rows.length) return { reached: true, ok: true, upserted: 0 }
  const origins = ['https://mvpaffiliate.io', 'https://www.mvpaffiliate.io']
  let lastErr = 'network error'
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}/api/storefront/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        redirect: 'follow',
        body: JSON.stringify({ products: rows }),
      })
      let body = null
      try { body = await res.json() } catch (e) {}
      if (res.ok) return { reached: true, ok: true, upserted: body && body.upserted }
      return { reached: true, ok: false, status: res.status, error: (body && body.error) || `HTTP ${res.status}` }
    } catch (e) { lastErr = (e && e.message) || 'network error' }
  }
  return { reached: false, ok: false, error: lastErr }
}

// POST the ASINs the creator has Creator Hub videos for. Apex-first, same as
// the other storefront pushes.
async function pushVideosToMvp(asins) {
  const rows = Array.isArray(asins) ? asins : []
  if (!rows.length) return { reached: true, ok: true, upserted: 0 }
  const origins = ['https://mvpaffiliate.io', 'https://www.mvpaffiliate.io']
  let lastErr = 'network error'
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}/api/storefront/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        redirect: 'follow',
        body: JSON.stringify({ videos: rows }),
      })
      let body = null
      try { body = await res.json() } catch (e) {}
      if (res.ok) return { reached: true, ok: true, upserted: body && body.upserted }
      return { reached: true, ok: false, status: res.status, error: (body && body.error) || `HTTP ${res.status}` }
    } catch (e) { lastErr = (e && e.message) || 'network error' }
  }
  return { reached: false, ok: false, error: lastErr }
}

// POST a batch of EPC opportunities (from the API loader) into MVP's EPC library.
// Same session-cookie bridge + apex-first origin fallback as the storefront
// pushes. The ingest endpoint upserts on (user_id, asin), so re-flushing a batch
// is safe (dupes collapse). Returns { reached, ok, added, saved, error }.
async function pushEpcToMvp(products) {
  const rows = Array.isArray(products) ? products : []
  if (!rows.length) return { reached: true, ok: true, added: 0, saved: 0 }
  const origins = ['https://mvpaffiliate.io', 'https://www.mvpaffiliate.io']
  let lastErr = 'network error'
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}/api/epc/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        redirect: 'follow',
        body: JSON.stringify({ products: rows }),
      })
      let body = null
      try { body = await res.json() } catch (e) {}
      if (res.ok) return { reached: true, ok: true, added: body && body.added, saved: body && body.saved }
      return { reached: true, ok: false, status: res.status, error: (body && body.error) || `HTTP ${res.status}` }
    } catch (e) { lastErr = (e && e.message) || 'network error' }
  }
  return { reached: false, ok: false, error: lastErr }
}

// Draft an outreach message via MVP, from the WORKER (not the content script):
// a content-script fetch amazon.com→mvpaffiliate.io is subject to Amazon's page
// CSP `connect-src` and can be silently blocked. Same worker-first pattern as
// pushCampaignsToMvp — `reached:false` tells the caller to try a direct fetch.
async function fetchOutreachFromMvp(token, ctx) {
  if (!token) return { reached: false, ok: false, error: 'no token' }
  try {
    const res = await fetch(`${MVP_ORIGIN}/api/campaigns/outreach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(ctx || {}),
    })
    let body = null
    try { body = await res.json() } catch (e) {}
    if (res.ok) return { reached: true, ok: true, message: (body && body.message) || '' }
    return { reached: true, ok: false, status: res.status, error: (body && body.error) || `HTTP ${res.status}` }
  } catch (e) {
    return { reached: false, ok: false, error: (e && e.message) || 'network error' }
  }
}

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

// ── YouTube transcript fetch (browser IP + the user's own YT session) ───────
// MVP's server can't reliably pull captions: its datacenter IP is throttled,
// and the Data API costs 200 quota units per download. SCOUT opens the watch
// page in the user's own browser — which reaches even their PRIVATE / unlisted
// DRAFTS because it rides their logged-in session — and reads the caption track
// straight off the page. Best-effort: a still-processing draft with no captions
// yet returns ok:false and the app falls back cleanly (no fabricated titles).
async function fetchYouTubeTranscript({ youtubeVideoId, callerTabId }) {
  if (!youtubeVideoId || !/^[a-zA-Z0-9_-]{6,20}$/.test(youtubeVideoId)) {
    return { ok: false, error: 'bad-video-id' }
  }
  let tabId = null
  const url = `https://www.youtube.com/watch?v=${youtubeVideoId}&autoplay=0&mute=1`
  try {
    const tab = await chrome.tabs.create({ url, active: false })
    tabId = tab.id
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
    // MAIN world so we can read the page's ytInitialPlayerResponse global.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: grabTranscriptInPage,
    })
    const out = results && results[0] && results[0].result
    return out || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'transcript-exception' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// Runs in the PAGE (MAIN world) on a youtube.com/watch page. Reads the caption
// track off ytInitialPlayerResponse and fetches the timedtext (json3) with the
// user's cookies. Self-contained — executeScript serializes it, so no outer refs.
async function grabTranscriptInPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // ytInitialPlayerResponse is set during page load; poll briefly for it.
  let pr = null
  for (let i = 0; i < 30; i++) {
    pr = window.ytInitialPlayerResponse || null
    if (!pr && window.ytplayer && window.ytplayer.config && window.ytplayer.config.args) {
      try { pr = JSON.parse(window.ytplayer.config.args.player_response) } catch (e) { pr = null }
    }
    if (pr && pr.captions) break
    await sleep(100)
  }
  try {
    const tracks = pr && pr.captions
      && pr.captions.playerCaptionsTracklistRenderer
      && pr.captions.playerCaptionsTracklistRenderer.captionTracks
    if (!tracks || !tracks.length) return { ok: false, error: 'no-captions' }
    // Prefer an English track, manual over auto-generated (asr); else the first.
    const en = tracks.filter((t) => (t.languageCode || '').toLowerCase().indexOf('en') === 0)
    const pick = en.find((t) => t.kind !== 'asr') || en[0] || tracks[0]
    let baseUrl = pick && pick.baseUrl
    if (!baseUrl) return { ok: false, error: 'no-base-url' }
    baseUrl += (baseUrl.indexOf('?') >= 0 ? '&' : '?') + 'fmt=json3'
    const res = await fetch(baseUrl, { credentials: 'include' })
    if (!res.ok) return { ok: false, error: 'timedtext-' + res.status }
    const data = await res.json()
    const parts = []
    // TIMESTAMPED cues — the json3 events already carry per-line timing
    // (tStartMs / dDurationMs). We keep it so Clip Factory can cut real 15–30s
    // windows; the flat `transcript` string is still returned for the metadata
    // generator, which doesn't need timings.
    const cues = []
    for (const ev of (data.events || [])) {
      if (!ev.segs) continue
      let line = ''
      for (const s of ev.segs) { if (s.utf8) { parts.push(s.utf8); line += s.utf8 } }
      line = line.replace(/\s+/g, ' ').trim()
      const offset = Number(ev.tStartMs)
      if (line && Number.isFinite(offset)) {
        cues.push({ text: line, offset, duration: Number(ev.dDurationMs) || 0 })
      }
    }
    let text = parts.join('').replace(/\s+/g, ' ').trim()
    if (text.length < 20) return { ok: false, error: 'empty-transcript' }
    if (text.length > 50000) text = text.slice(0, 50000)
    return { ok: true, transcript: text, cues, lang: (pick && pick.languageCode) || null }
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : 'parse-error' }
  }
}

// ── Creator Connections scout (scraper-only) ───────────────────────────────
// The MVP "EPC" page drives this via externally_connectable. One click: we
// FOCUS the user's already-open Creator Connections tab (or open the
// opportunities view ourselves if none is open), run the existing CC_SCAN
// content script in their own logged-in session, hand the RAW campaigns back,
// and return focus to the MVP tab. We never open more than one CC tab — repeat
// scouts reuse it. All filtering / ranking / selection happens in the app.
// The REAL Creator Connections app (Amazon's 2026 redesign) lives here — NOT the
// legacy https://www.amazon.com/creatorconnections/ URL, which is a dead shell
// that renders no campaign grid. Opening that shell was why "Check CC" only
// worked when the user ALREADY had their own CC tab open: with no tab, SCOUT
// navigated to the shell and scanned nothing. The real app is per-creator — the
// grid only mounts on a URL carrying the caller's creatorId. We LEARN that id
// from any CC page the user visits (content.js → CC_CREATOR_ID), cache it, and
// deep-link straight to the working grid even when no CC tab is open.
const CC_BASE = 'https://affiliate-program.amazon.com/p/connect/requests'
let _ccCreatorId = null
try { chrome.storage.local.get(['ccCreatorId'], (o) => { if (o && o.ccCreatorId) _ccCreatorId = o.ccCreatorId }) } catch (e) {}
// The creator's DISPLAY NAME (e.g. "Gominplanet"), needed to fill the default
// send/search recipe on a fresh install. Learned from a chat/search response (or
// the learned recipe's own actorName) and persisted so it survives worker cycles.
let _ccCreatorName = null
try { chrome.storage.local.get(['ccCreatorName'], (o) => { if (o && o.ccCreatorName) _ccCreatorName = o.ccCreatorName }) } catch (e) {}
// The creator's STORE id / associate tag (e.g. "gomin0e-20") — the connect chat
// APIs require it as a header (missing it → 401). Sniffed from the page's own
// captured requests and persisted.
let _ccStoreId = null
try { chrome.storage.local.get(['ccStoreId'], (o) => { if (o && o.ccStoreId) _ccStoreId = o.ccStoreId }) } catch (e) {}

function ccOpportunitiesUrl() {
  const q = _ccCreatorId ? `creatorId=${encodeURIComponent(_ccCreatorId)}&` : ''
  // status=opportunity + type=affiliate-plus = the "New Opportunities / Affiliate+"
  // grid SCOUT scans. With no known creatorId the app resolves it from the
  // logged-in session on load; we cache it as soon as the page reports it back.
  return `${CC_BASE}?${q}status=opportunity&type=affiliate-plus`
}

// The "Sponsored Products for Creators" opportunities grid — the EPC view. Same
// base as Affiliate+, but type=spcc (Sponsored Products Creator Connections;
// matches lib/cc-urls ccRequestUrl). This is what the EPC library scan needs;
// the Affiliate+ URL above never shows the EPC product cards.
function ccSponsoredUrl() {
  const q = _ccCreatorId ? `creatorId=${encodeURIComponent(_ccCreatorId)}&` : ''
  return `${CC_BASE}?${q}status=opportunity&type=spcc`
}

// Deep-link straight to ONE campaign's page by its id — the reliable path that
// skips the whole grid search. Mirrors a real campaign link:
//   /p/connect/request?creatorId=…&campaignId=amzn1.campaign.…&type=…&status=…
// creatorId is filled from the session when omitted; type/status just set the
// initial view — the campaignId is what loads the specific campaign. We build it
// straight from the catalog's campaign_id (ASIN → campaign_id → this URL).
const CC_REQUEST_BASE = 'https://affiliate-program.amazon.com/p/connect/request'
function ccCampaignUrl(campaignId, type) {
  const cid = String(campaignId || '').trim()
  const creator = _ccCreatorId ? `creatorId=${encodeURIComponent(_ccCreatorId)}&` : ''
  const t = type || 'affiliate-plus'
  return `${CC_REQUEST_BASE}?${creator}campaignId=${encodeURIComponent(cid)}&type=${encodeURIComponent(t)}&status=opportunity`
}

// The creator's ACTIVE / joined campaigns view. This is the tab that lists the
// campaigns the user has already joined (status=active, type=affiliate-plus) —
// confirmed from a real creator's URL. Opening THIS (not the opportunity grid) is
// what makes the page fire the collaboration/search query for joined campaigns,
// which SCOUT then replays. creatorId is filled from the session when omitted.
function ccActiveUrl() {
  const q = _ccCreatorId ? `creatorId=${encodeURIComponent(_ccCreatorId)}&` : ''
  // status=active lists ALL joined campaigns. We deliberately DON'T pin
  // type=affiliate-plus — that narrows to one campaign type (e.g. 44 of 666). The
  // creator's joined list spans multiple types, so we want the unfiltered active
  // view and then broaden the replayed query's campaignType too.
  return `${CC_BASE}?${q}status=active&sortBy=alphabetical`
}

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── LEARN-AND-REPLAY the Creator Connections send API ─────────────────────────
// Amazon's CC chat is a plain JSON API (learned from the net-hook capture):
//   1) POST /connect/api/chat/search  { requestingActor, searchOption:{campaignId}, … }
//        → returns the brand's chat, which carries a `contextToken`.
//   2) POST /connect/api/chat/message/send  { actorName, contextToken, content }
// The contextToken is what targets a specific BRAND, so we CAN'T just replay a
// stored send — we must fetch the token for the target campaign first, then send.
// Both requests are cookie-authed (no CSRF header). We learn each request's exact
// shape (headers + body) from the page's own calls, parameterize the bits that
// change (campaignId, contextToken, content), and replay them for any brand — no
// DOM at all. Recipes persist so it's learned once per account.
const MSG_PLACEHOLDER = '__MVP_MSG__'
const CTX_PLACEHOLDER = '__MVP_CTX__'
const CAMPAIGN_PLACEHOLDER = '__MVP_CAMPAIGN__'
const CREATOR_PLACEHOLDER = '__MVP_CREATOR__'   // the creator's amzn1.creator id
const ACTOR_PLACEHOLDER = '__MVP_ACTOR__'       // the creator's display name

// BUILT-IN default body shapes for Amazon's chat/search + chat/message/send, so a
// fresh install with NO learned recipe can send FULLY IN THE BACKGROUND on the
// very first try — no manual "learning" send, ever. These are the EXACT shapes a
// real send/search uses (reverse-engineered from a live capture), with the
// per-account bits parameterized: the creator's id + display name and the target
// campaignId. chat/search needs the full requestingActor + filterOption.interestTags
// allowlist + maxSize/nextToken — the minimal {searchOption:{campaignId}} we used
// before was rejected, which is why fresh accounts got "no chat". A REAL captured
// recipe still overrides these the moment the net-hook sees one. All cookie-authed
// (no anti-CSRF header); a non-SUCCESS reply is reported honestly, never faked.
const CC_INTEREST_TAGS = ['ALLOWLIST#BULK_ACTIONS_WAVE_3', 'tercero-accessories', 'tercero-automotive', 'tercero-electronics', 'tercero-garden-and-outdoor', 'tercero-handbags-and-wallets', 'tercero-health-and-wellness', 'tercero-home', 'tercero-kitchen-and-dining', 'tercero-luggage-and-travel', 'tercero-mens-fashion', 'tercero-office-products', 'tercero-outdoor-sports', 'tercero-personal-care', 'tercero-pets', 'tercero-shoes', 'tercero-sports-and-fitness', 'tercero-tools-and-home-improvement', 'tercero-videos', 'tercero-wearable-technology', 'tercero-womens-fashion']
const DEFAULT_SEARCH_BODY = JSON.stringify({
  requestingActor: { name: ACTOR_PLACEHOLDER, id: CREATOR_PLACEHOLDER, type: 'CREATOR' },
  searchOption: { actorName: null, campaignId: CAMPAIGN_PLACEHOLDER },
  filterOption: { fullyClaimed: null, providingSamples: null, interestTags: CC_INTEREST_TAGS },
  maxSize: 1, nextToken: null,
})
const DEFAULT_SEND_BODY = JSON.stringify({ actorName: ACTOR_PLACEHOLDER, contextToken: CTX_PLACEHOLDER, content: MSG_PLACEHOLDER })
let _ccNetRing = []           // recent captured request POSTs (in-memory)
let _earnNetRing = []         // the reporting page's OWN /connect/api/report/ POSTs
let _ccRespRing = []          // recent captured RESPONSES (in-memory, for diag)
let _ccLastSendDiag = null    // diagnostic of the most recent background send (for MVP_CC_DEBUG)
let _ccSendTabId = null       // ONE reused hidden tab for the whole bulk run (no open/close churn)
let _ccSendTabCloseTimer = null // closes the reused send tab after a spell of inactivity
let _ccSendRecipe = null      // /chat/message/send template (persisted)
let _ccSearchRecipe = null    // /chat/search template (persisted)
// collaboration/search browse query learned from the active view — {body,headers}.
// Persisted so repeat "Joined only" searches work even when the SPA loads from
// cache and doesn't re-fire its query (no fresh capture that run → would 401).
let _ccListRecipe = null
try { chrome.storage.local.get(['ccListRecipe'], (o) => { if (o && o.ccListRecipe) _ccListRecipe = o.ccListRecipe }) } catch (e) {}
// Separate recipe for the OPPORTUNITIES grid (new campaigns to accept) — its
// collaboration/search filter differs from the joined/active view, so a live
// brand search of opportunities must not reuse the joined-view recipe.
let _ccOppListRecipe = null
try { chrome.storage.local.get(['ccOppListRecipe'], (o) => { if (o && o.ccOppListRecipe) _ccOppListRecipe = o.ccOppListRecipe }) } catch (e) {}
try {
  chrome.storage.local.get(['ccSendRecipe', 'ccSearchRecipe'], (o) => {
    if (!o) return
    // Only accept a NEW-format send recipe (parameterizes contextToken). A recipe
    // learned by an older build lacks that and would message the wrong brand — drop
    // it so the next real send re-teaches it correctly.
    if (o.ccSendRecipe && typeof o.ccSendRecipe.bodyTemplate === 'string' && o.ccSendRecipe.bodyTemplate.includes(CTX_PLACEHOLDER) && o.ccSendRecipe.bodyTemplate.includes(MSG_PLACEHOLDER)) _ccSendRecipe = o.ccSendRecipe
    if (o.ccSearchRecipe) _ccSearchRecipe = o.ccSearchRecipe
  })
} catch (e) {}

// Ensure the persisted recipes are loaded into memory before a send checks them —
// on a cold MV3 worker the storage.get above is still in flight, so an immediate
// send could wrongly see null and report "not-learned". Reads storage on demand.
async function ensureRecipesLoaded() {
  if (_ccSendRecipe && _ccSearchRecipe) return
  try {
    const o = await chrome.storage.local.get(['ccSendRecipe', 'ccSearchRecipe'])
    if (o) {
      if (!_ccSendRecipe && o.ccSendRecipe && typeof o.ccSendRecipe.bodyTemplate === 'string' && o.ccSendRecipe.bodyTemplate.includes(CTX_PLACEHOLDER) && o.ccSendRecipe.bodyTemplate.includes(MSG_PLACEHOLDER)) _ccSendRecipe = o.ccSendRecipe
      if (!_ccSearchRecipe && o.ccSearchRecipe) _ccSearchRecipe = o.ccSearchRecipe
    }
  } catch (e) {}
}

function recordNetCapture(rec) {
  if (!rec || !rec.url) return
  _ccNetRing.push(rec)
  if (_ccNetRing.length > 12) _ccNetRing.shift()
  // Reporting calls get their own ring. The earnings page fires enough requests
  // to flush a 12-slot buffer before we ever read it, and these are the ones the
  // per-product sync replays.
  try {
    if (/\/connect\/api\/report\//i.test(String(rec.url))) {
      _earnNetRing.push(rec)
      if (_earnNetRing.length > 12) _earnNetRing.shift()
    }
  } catch (e) {}
}

// The reporting requests the page made itself since this run started, newest
// first, one per distinct body. We do NOT guess these endpoints: a path invented
// from the summary call's shape came back "TypeError: Failed to fetch" on every
// month, which is Amazon's edge refusing a route that does not exist. So SCOUT
// learns the real one the same way it learned the EPC grid query, by watching
// what the page asks for.
function earningsReportCalls(sinceTs) {
  const out = []
  const seen = Object.create(null)
  for (let i = _earnNetRing.length - 1; i >= 0; i--) {
    const rec = _earnNetRing[i]
    if (!rec || typeof rec.body !== 'string' || !rec.body) continue
    if (sinceTs && rec.ts && rec.ts < sinceTs) continue
    if (seen[rec.body]) continue
    seen[rec.body] = 1
    let path = rec.url
    try { path = new URL(rec.url, 'https://affiliate-program.amazon.com').pathname } catch (e) {}
    out.push({ url: rec.url, path, body: rec.body, headers: rec.headers || {} })
  }
  return out
}

function recordNetResponse(rec) {
  if (!rec || !rec.url) return
  _ccRespRing.push(rec)
  if (_ccRespRing.length > 10) _ccRespRing.shift()
}

// The most recent collaboration/search POST the page fired. When SCOUT opens the
// creator's ACTIVE view (status=active&type=affiliate-plus), this is the exact
// query Amazon uses to list joined campaigns — body AND headers. We replay it
// (paginated) instead of guessing filterOptions; crucially the captured HEADERS
// carry Amazon's anti-CSRF token, without which collaboration/search returns 401.
// sinceTs limits to captures from THIS run's page load, so we never replay a stale
// (or our own tokenless) request left in the ring. Skips ASIN-scoped searches
// (those are per-product message lookups, not the browse-all-joined query).
function latestCollabSearch(sinceTs) {
  for (let i = _ccNetRing.length - 1; i >= 0; i--) {
    const rec = _ccNetRing[i]
    if (!rec || typeof rec.body !== 'string' || !rec.body) continue
    if (sinceTs && rec.ts && rec.ts < sinceTs) continue
    if (!/\/connect\/api\/collaboration\/search/i.test(rec.url || '')) continue
    if (/"fieldName"\s*:\s*"asin"/i.test(rec.body)) continue
    return { body: rec.body, headers: rec.headers || {} }
  }
  return null
}

// The most recent SPCC / Sponsored-Products list query the page fired. When SCOUT
// opens the EPC opportunities grid (type=spcc), the page issues its own list
// request to Amazon's connect API — body AND anti-CSRF headers. We capture and
// replay it (paginated) instead of DOM-scraping the virtualized grid, which is
// how a clean, dedup-free, fully-counted load is possible even though EPC has no
// export. We DON'T assume the exact endpoint name: we take the most recent
// /connect/api search POST after this run's page load, preferring one that reads
// like the sponsored-products view (spcc / budget-availability / EPC), and replay
// that same URL verbatim. Skips per-ASIN message lookups.
function latestSpccSearch(sinceTs) {
  let fallback = null
  for (let i = _ccNetRing.length - 1; i >= 0; i--) {
    const rec = _ccNetRing[i]
    if (!rec || typeof rec.body !== 'string' || !rec.body) continue
    if (sinceTs && rec.ts && rec.ts < sinceTs) continue
    const url = String(rec.url || '')
    // ONLY the Sponsored-Products (EPC) endpoint — never affiliate-plus.
    if (!/\/connect\/api\/spcc\//i.test(url)) continue
    if (/"fieldName"\s*:\s*"asin"/i.test(rec.body)) continue
    return { url: rec.url, body: rec.body, headers: rec.headers || {} }
  }
  return fallback
}

// ALL distinct spcc/list queries captured since sinceTs (newest first). Navigating
// or clicking through the EPC tabs fires a different query per view; we collect
// every one so we can test each and keep whichever returns the most rows —
// resilient to the background tab firing them in any order / dropping some.
function allSpccSearches(sinceTs) {
  const out = []
  const seenBodies = Object.create(null)
  for (let i = _ccNetRing.length - 1; i >= 0; i--) {
    const rec = _ccNetRing[i]
    if (!rec || typeof rec.body !== 'string' || !rec.body) continue
    if (sinceTs && rec.ts && rec.ts < sinceTs) continue
    const url = String(rec.url || '')
    // ONLY the Sponsored-Products (EPC) endpoint. This deliberately excludes
    // affiliate-plus /connect/api/collaboration/search (the 136k/780k catalog) —
    // that's a different program handled separately.
    if (!/\/connect\/api\/spcc\//i.test(url)) continue
    if (/"fieldName"\s*:\s*"asin"/i.test(rec.body)) continue
    if (seenBodies[rec.body]) continue
    seenBodies[rec.body] = 1
    // Label by the statuses filter so the diagnostic is readable.
    let label = 'list'
    try { const st = (JSON.parse(rec.body).filterOptions || {}).statuses; if (st) label = Array.isArray(st) ? st.join('+') : String(st); else label = 'no-status' } catch (e) {}
    out.push({ url: rec.url, body: rec.body, headers: rec.headers || {}, label })
  }
  return out
}

// Runs IN the page (MAIN world): click an EPC tab by its visible label (e.g.
// "Accepted") so the SPA fires that tab's list query, which net-hook then
// captures. Returns whether a matching tab was found + clicked.
function clickSpccTabInPage(labelRe) {
  try {
    const re = new RegExp(labelRe, 'i')
    const nodes = Array.from(document.querySelectorAll('a,button,[role="tab"],[role="button"],li,span'))
    for (const el of nodes) {
      const t = (el.textContent || '').trim()
      if (t && t.length < 40 && re.test(t)) {
        try { el.scrollIntoView() } catch (e) {}
        el.click()
        return { clicked: true, text: t }
      }
    }
  } catch (e) {}
  return { clicked: false }
}

// Replace the STRING value of a top-level-ish JSON key with a placeholder, leaving
// the surrounding JSON intact. Handles escaped chars in the value. Only the first
// non-null string value matches (so "campaignId":null elsewhere is left alone).
function paramJsonStr(json, key, placeholder) {
  try {
    const re = new RegExp('("' + key + '"\\s*:\\s*")((?:[^"\\\\]|\\\\.)*)(")')
    return json.replace(re, '$1' + placeholder + '$3')
  } catch (e) { return json }
}

// Learn /chat/message/send: parameterize `content` (the message) and `contextToken`
// (the per-brand target) so replay can swap both.
function learnSendRecipe(rec) {
  const body = typeof rec.body === 'string' ? rec.body : ''
  if (!body || !/"content"\s*:/.test(body)) return false
  let t = paramJsonStr(body, 'content', MSG_PLACEHOLDER)
  t = paramJsonStr(t, 'contextToken', CTX_PLACEHOLDER)
  // Reject a template that didn't parameterize BOTH the message and the token —
  // otherwise replay would resend the captured message verbatim (message
  // placeholder missing) or to a fixed brand (token placeholder missing).
  if (!t.includes(MSG_PLACEHOLDER) || !t.includes(CTX_PLACEHOLDER)) return false
  _ccSendRecipe = { url: rec.url, method: rec.method || 'POST', headers: rec.headers || {}, bodyTemplate: t, learnedAt: Date.now() }
  try { chrome.storage.local.set({ ccSendRecipe: _ccSendRecipe }) } catch (e) {}
  // Capture the creator's display name from the real send's actorName — it's what
  // the default recipe needs to fill for other/fresh installs.
  try {
    const m = body.match(/"actorName"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (m && m[1] && !_ccCreatorName) { _ccCreatorName = m[1]; chrome.storage.local.set({ ccCreatorName: m[1] }) }
  } catch (e) {}
  return true
}

// Learn /chat/search: parameterize the searchOption.campaignId so replay can look
// up the contextToken for any target campaign/brand.
function learnSearchRecipe(rec) {
  const body = typeof rec.body === 'string' ? rec.body : ''
  if (!body || !/"campaignId"\s*:\s*"amzn1\.campaign/.test(body)) return false
  const t = paramJsonStr(body, 'campaignId', CAMPAIGN_PLACEHOLDER)
  _ccSearchRecipe = { url: rec.url, method: rec.method || 'POST', headers: rec.headers || {}, bodyTemplate: t, learnedAt: Date.now() }
  try { chrome.storage.local.set({ ccSearchRecipe: _ccSearchRecipe }) } catch (e) {}
  return true
}

// Route a capture to the right learner (and always ring it for diagnostics).
function learnFromCapture(rec) {
  try {
    recordNetCapture(rec)
    // Learn the creator id from ANY captured CC request — its URL or body carries
    // amzn1.creator.…. This is how SCOUT gets the id from a page it opened itself
    // (the CC grid's own collaboration/search POST), with no dependency on the
    // user having visited a URL that happens to include it.
    if (!_ccCreatorId && rec) {
      const hay = String(rec.url || '') + ' ' + (typeof rec.body === 'string' ? rec.body : '')
      const m = hay.match(/amzn1\.creator\.[a-z0-9-]+/i)
      if (m) { _ccCreatorId = m[0]; try { chrome.storage.local.set({ ccCreatorId: m[0] }) } catch (e) {} }
    }
    if (/\/chat\/message\/send/i.test(rec.url)) learnSendRecipe(rec)
    else if (/\/chat\/search/i.test(rec.url)) learnSearchRecipe(rec)
  } catch (e) {}
}

// Runs IN the page (MAIN world): search the brand's chat by campaignId to get its
// contextToken, then POST each message group to /chat/message/send. One search,
// N sends. Same origin as the API → cookies apply. Returns { ok, groups, … }.
function ccApiSendInPage(sendRecipe, searchRecipe, segments, campaignId, MSG, CTX, CAMP) {
  return (async () => {
    try {
      if (!sendRecipe || !sendRecipe.bodyTemplate) return { ok: false, reason: 'no-send-recipe' }
      if (!searchRecipe || !searchRecipe.bodyTemplate) return { ok: false, reason: 'no-search-recipe' }
      const jinner = (s) => { try { return JSON.stringify(String(s == null ? '' : s)).slice(1, -1) } catch (e) { return String(s || '') } }
      const hdr = (h) => { const o = Object.assign({}, h || {}); if (!o['Content-Type'] && !o['content-type']) o['Content-Type'] = 'application/json'; if (!o['Accept'] && !o['accept']) o['Accept'] = 'application/json'; return o }
      // Deep-search a parsed JSON object for the first `contextToken`-ish string.
      const deepToken = (obj) => {
        const seen = []
        const walk = (o) => {
          if (!o || typeof o !== 'object') return null
          for (const k of Object.keys(o)) {
            const v = o[k]
            // The token field in chat/search's reply is "contextValidatorToken"
            // (the send body calls it "contextToken") — match both.
            if (typeof v === 'string' && /context\w*token/i.test(k) && v.length > 20) return v
            if (v && typeof v === 'object') seen.push(v)
          }
          return null
        }
        let hit = walk(obj)
        while (!hit && seen.length) hit = walk(seen.shift())
        return hit
      }
      // 1) contextToken for this campaign's brand.
      const sBody = searchRecipe.bodyTemplate.split(CAMP).join(campaignId)
      const sResp = await fetch(searchRecipe.url, { method: searchRecipe.method || 'POST', headers: hdr(searchRecipe.headers), body: sBody, credentials: 'include' })
      let sJson = null
      try { sJson = await sResp.json() } catch (e) {}
      const contextToken = deepToken(sJson)
      if (!contextToken) return { ok: false, reason: 'no-context-token', status: sResp.status }
      // 2) send each group. Amazon replies { responses:[{ status:"SUCCESS", … }] }.
      let groups = 0, lastStatus = null, lastSample = ''
      for (const seg of segments) {
        // Token first, message last (so a message can't clobber a placeholder).
        const body = sendRecipe.bodyTemplate.split(CTX).join(jinner(contextToken)).split(MSG).join(jinner(seg))
        const mResp = await fetch(sendRecipe.url, { method: sendRecipe.method || 'POST', headers: hdr(sendRecipe.headers), body, credentials: 'include' })
        lastStatus = mResp.status
        let txt = ''
        try { txt = (await mResp.text()).slice(0, 300) } catch (e) {}
        lastSample = txt
        // Only an explicit SUCCESS counts as a delivered group.
        if (mResp.ok && /"status"\s*:\s*"SUCCESS"/i.test(txt)) groups++
        else break
        await new Promise((r) => setTimeout(r, 500))
      }
      return { ok: groups > 0 && groups === segments.length, groups, partial: groups > 0 && groups < segments.length, status: lastStatus, sample: lastSample }
    } catch (e) {
      return { ok: false, reason: 'exception', error: e && e.message ? e.message : String(e) }
    }
  })()
}

// Split a recap into its message groups (the ---- Add to Message Group ---- marker).
function splitCcGroups(message) {
  const parts = String(message || '').split(/\s*-{2,}\s*add to message group\s*-{2,}\s*/i).map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts : [String(message || '')]
}

// Replay the send API for ONE campaignId against a tab already on affiliate-program
// .amazon.com (same origin → cookies apply). Best-effort.
async function ccApiReplayOne(tabId, message, campaignId) {
  if (!_ccSendRecipe || !_ccSearchRecipe || tabId == null || !campaignId) return { ok: false, reason: 'no-recipe' }
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: ccApiSendInPage,
      args: [_ccSendRecipe, _ccSearchRecipe, splitCcGroups(message), campaignId, MSG_PLACEHOLDER, CTX_PLACEHOLDER, CAMPAIGN_PLACEHOLDER],
    })
    return (res && res[0] && res[0].result) || { ok: false, reason: 'no-result' }
  } catch (e) {
    return { ok: false, reason: 'exec-failed', error: e && e.message ? e.message : String(e) }
  }
}

// Runs IN the page (MAIN world): the FULL background pipeline, learned from the
// live capture — resolve the ASIN to the creator's accepted campaign, look up the
// brand chat's token, and post each message group. No catalog, no DOM. Steps:
//   1) POST /connect/api/collaboration/search {searchOptions:[asin…], creatorId,
//      statuses:[SCHEDULED,DELIVERING]} → responses[0].ads[] (accepted campaigns);
//      pick the ad whose campaignAsins include the ASIN → campaignId (+ brand).
//   2) POST /connect/api/chat/search {searchOption:{campaignId}} →
//      responses[0].addressBook[0].contextValidatorToken.
//   3) POST /connect/api/chat/message/send {actorName, contextToken, content}.
function ccResolveSendInPage(opts) {
  // Early ping so the background can confirm the message channel works AND that
  // this function actually started — independently of whether any fetch resolves.
  try { chrome.runtime.sendMessage({ __mvpCcPing: true, nonce: opts && opts.nonce, phase: 'start' }) } catch (e) {}
  const __p = (async () => {
    // A fetch on this page can HANG in the isolated world (no resolve, no reject),
    // which silently strands the whole send (no return, no message). Wrap every
    // fetch with an abort timeout so a stuck request becomes a real, reportable
    // error instead of an infinite hang.
    const fetchT = async (url, init, ms) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => { try { ctrl.abort() } catch (e) {} }, ms || 12000)
      try { return await fetch(url, Object.assign({}, init, { signal: ctrl.signal })) }
      finally { clearTimeout(timer) }
    }
    try {
      const { asin, segments, campaignIdsHint, headers, sendTemplate, searchTemplate, MSG, CTX, CAMP, CREATOR, ACTOR } = opts
      // creatorId may arrive empty on a brand-new install; self-discover it from the
      // open affiliate-program page (same trick the campaign-list step uses) so the
      // ASIN → campaign resolve still works with zero prior setup.
      let creatorId = opts.creatorId
      if (!creatorId) {
        try {
          const html = (document.documentElement && document.documentElement.innerHTML) || ''
          const m = html.match(/amzn1\.creator\.[a-z0-9-]+/i)
          if (m) creatorId = m[0]
        } catch (e) {}
      }
      const hdr = () => { const o = Object.assign({}, headers || {}); if (!o['Content-Type'] && !o['content-type']) o['Content-Type'] = 'application/json'; if (!o['Accept'] && !o['accept']) o['Accept'] = 'application/json'; return o }
      const jinner = (s) => { try { return JSON.stringify(String(s == null ? '' : s)).slice(1, -1) } catch (e) { return String(s || '') } }
      // The default recipe carries __MVP_CREATOR__ / __MVP_ACTOR__ placeholders (a
      // learned recipe has the real values baked in, so these are no-ops there).
      // creatorName may be empty on a brand-new install; we discover it from the
      // chat/search response below and use it for the SEND so the brand sees the
      // creator's real name, not their id.
      let creatorName = String(opts.creatorName || '')
      const fillId = (tpl, nm) => String(tpl)
        .split(CREATOR || ' ').join(jinner(creatorId || ''))
        .split(ACTOR || ' ').join(jinner(nm || creatorName || creatorId || ''))
      // Deep-scan a JSON reply for the creator's own display name (an actor whose
      // type/actorType is CREATOR).
      const findCreatorName = (obj) => {
        const seen = []; const walk = (o) => {
          if (!o || typeof o !== 'object') return null
          const ty = String(o.type || o.actorType || '').toUpperCase()
          if (ty === 'CREATOR' && typeof (o.name || o.actorName) === 'string' && (o.name || o.actorName)) return o.name || o.actorName
          for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') seen.push(v) }
          return null
        }
        let hit = walk(obj); while (!hit && seen.length) hit = walk(seen.shift()); return hit
      }
      const A = String(asin || '').toUpperCase()
      const campaignIds = Array.isArray(campaignIdsHint) ? campaignIdsHint.filter(Boolean).slice() : []
      let brand = null
      let resolveErr = null

      // 1) Resolve ASIN → accepted campaign(s). Requires the creatorId to scope the
      //    search; without it collaboration/search returns nothing, so skip it (we
      //    can still try any catalog campaignId hints below).
      if (A && creatorId) {
        try {
          const body = JSON.stringify({
            campaignId: null, brandId: null,
            filterOptions: { campaignType: 'BOUNTY_BOARD', availableSlotsOnly: null, interestTags: null, providingSamplesOnly: null, statuses: ['SCHEDULED', 'DELIVERING'], commissionPercentageFilters: null, dateRange: null, campaignBrowseNodes: null, earlyAccessOnly: null, gcorIdList: null, campaignQualifiers: null, contentTypes: null, adId: null, storeIds: null, creatorIds: null, flatFeeRanges: null, rangeFilters: null, socialChannels: null, premiumCreator: null, contractStatus: null, ratingStar: null, reviewCount: null, priceRange: null, budgetAvailabilityScoreList: null, dealMetadata: null },
            sortOptions: [{ name: 'CAMPAIGN_TITLE', order: 'ASCENDING' }],
            nextToken: null, pageNumber: 1, pageSize: 30, creatorId,
            searchOptions: [{ fieldName: 'brandName', searchString: A }, { fieldName: 'campaignName', searchString: A }, { fieldName: 'asin', searchString: A }],
          })
          const r = await fetchT('/connect/api/collaboration/search', { method: 'POST', headers: hdr(), body, credentials: 'include' }, 12000)
          const j = await r.json().catch(() => null)
          const ads = (j && j.responses && j.responses[0] && j.responses[0].ads) || []
          const hasAsin = (a) => Array.isArray(a.campaignAsins) && a.campaignAsins.map((x) => String(x).toUpperCase()).includes(A)
          // WRONG-BRAND GUARD: only take ads whose campaignAsins actually contain the
          // target ASIN. NEVER fall back to every returned ad — a fuzzy brand/name
          // match would message a brand that doesn't sell this product.
          const chosen = ads.filter(hasAsin)
          for (const a of chosen) { if (a.campaignId && !campaignIds.includes(a.campaignId)) campaignIds.push(a.campaignId); if (!brand && a.brandName) brand = a.brandName }
        } catch (e) { resolveErr = e && e.message ? e.message : String(e) }
      }
      if (!campaignIds.length) return { ok: false, reason: (A && !creatorId) ? 'no-creator-id' : 'no-campaign-for-asin', error: resolveErr || undefined, creatorId: creatorId || undefined }

      // token finder (contextValidatorToken in the reply, or contextToken).
      const findToken = (j) => {
        try {
          const abs = (j && j.responses && j.responses[0] && j.responses[0].addressBook) || []
          for (const e of abs) { const t = e.contextValidatorToken || e.contextToken; if (t && t.length > 20) return t }
        } catch (e) {}
        return null
      }

      // 2+3) For each candidate: chat/search → token → send each group.
      let lastReason = 'no-context-token'
      for (const cid of campaignIds) {
        try {
          const sBody = fillId(searchTemplate.split(CAMP).join(cid))
          const sr = await fetchT('/connect/api/chat/search', { method: 'POST', headers: hdr(), body: sBody, credentials: 'include' }, 12000)
          const sj = await sr.json().catch(() => null)
          const token = findToken(sj)
          if (!token) { lastReason = 'no-context-token'; continue }
          // Learn the creator's real display name from the reply (first time only),
          // so the send shows it and future sends have it up front.
          if (!creatorName) { const n = findCreatorName(sj); if (n) creatorName = n }
          let groups = 0
          for (const seg of segments) {
            // Substitute the token FIRST, then the message LAST — so a message that
            // happens to contain a placeholder token can't corrupt the body.
            const mBody = fillId(sendTemplate, creatorName).split(CTX).join(jinner(token)).split(MSG).join(jinner(seg))
            const mr = await fetchT('/connect/api/chat/message/send', { method: 'POST', headers: hdr(), body: mBody, credentials: 'include' }, 15000)
            let txt = ''
            try { txt = (await mr.text()).slice(0, 300) } catch (e) {}
            // Only an explicit SUCCESS counts — a 2xx interstitial / throttle page
            // must NOT be read as delivered.
            if (mr.ok && /"status"\s*:\s*"SUCCESS"/i.test(txt)) groups++
            else { lastReason = 'send-rejected'; break }
            await new Promise((r) => setTimeout(r, 400))
          }
          // Once ANY group has been delivered to this brand, STOP — never fan out to
          // another candidate (the next is often the same brand chat → duplicates).
          if (groups > 0) return { ok: groups === segments.length, reason: groups === segments.length ? undefined : 'partial', groups, campaignId: cid, brand, creatorName: creatorName || undefined, creatorId: creatorId || undefined }
        } catch (e) { lastReason = 'exception' }
      }
      return { ok: false, reason: lastReason, campaignIds, brand, error: resolveErr || undefined, creatorName: creatorName || undefined, creatorId: creatorId || undefined }
    } catch (e) {
      return { ok: false, reason: 'exception', error: e && e.message ? e.message : String(e) }
    }
  })()
  // executeScript on this page hands back an EMPTY result for a promise-returning
  // injected function (proven: a sync probe returns fine, this async one comes back
  // with result:undefined, no throw). So don't rely on the executeScript return —
  // ALSO deliver the result to the background over the runtime message channel,
  // keyed by nonce. The background takes whichever arrives first.
  try { __p.then((r) => { try { chrome.runtime.sendMessage({ __mvpCcSendResult: true, nonce: opts && opts.nonce, result: r }) } catch (e) {} }).catch(() => {}) } catch (e) {}
  return __p
}

// Full background send by ASIN: open a hidden affiliate-program tab and run the
// resolve → chat-lookup → send pipeline in the user's own session. No catalog,
// no visible tab. campaignIdsHint (from our catalog, if any) is tried alongside
// the ASIN-resolved ones. Needs the learned send + search recipes.
// Read the Creator Connections brand-chat inbox. GET /connect/api/chat/get in a
// hidden tab on the creator's affiliate-program.amazon.com session, parse the
// address book, and flag threads with a new (unread) brand reply — i.e. the last
// message is newer than the last one the creator read. Best-effort.
function fetchChatInboxInPage() {
  return (async () => {
    try {
      // The offsite store id is required on this call. Read it from the store
      // switcher if present; omit it otherwise (cookie auth may still suffice).
      let storeId = ''
      try {
        const m = (document.body && document.body.innerText || '').match(/Store\s*ID:\s*([a-z0-9-]+-\d{2})/i)
        if (m) storeId = m[1]
      } catch (e) {}
      const r = await fetch('/connect/api/chat/get?maxSize=100', {
        method: 'GET', credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-request-bamf': 'T1', ...(storeId ? { storeid: storeId } : {}) },
      })
      if (!r.ok) return { ok: false, error: 'http ' + r.status }
      const j = await r.json()
      const addr = (((j.responses || [])[0] || {}).addresses || [])[0] || {}
      const book = addr.addressBook || []
      const chats = book.filter(b => b && b.actorType === 'BRAND' && b.actorName).map(b => ({
        brand: String(b.actorName || '').trim(),
        lastMsgTs: Number(b.lastMsgTimeStamp) || 0,
        lastReadTs: Number(b.lastReadMsgTimeStamp) || 0,
        unread: (Number(b.lastMsgTimeStamp) || 0) > (Number(b.lastReadMsgTimeStamp) || 0),
      }))
      return { ok: true, chats }
    } catch (e) { return { ok: false, error: String(e && e.message || e) } }
  })()
}
async function getBrandChats() {
  let tab = null
  const ka = startKeepAlive()
  try {
    tab = await chrome.tabs.create({ url: 'https://affiliate-program.amazon.com/p/connect/requests?status=opportunity&type=affiliate-plus', active: false })
    await waitForTabLoad(tab.id, 15000)
    await _sleep(700)
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: fetchChatInboxInPage })
    return (res && res[0] && res[0].result) || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) }
  } finally {
    if (tab != null) { try { await chrome.tabs.remove(tab.id) } catch (e) {} }
    stopKeepAlive(ka)
  }
}

// Acquire the shared hidden send tab — REUSED across every brand + retry in a
// bulk run so we don't open/close a tab per message (the visible churn). Creates
// it (and waits for the connect SPA to boot + go quiet) only when there isn't one
// alive already; otherwise hands back the existing warm tab instantly.
async function acquireSendTab() {
  if (_ccSendTabCloseTimer) { clearTimeout(_ccSendTabCloseTimer); _ccSendTabCloseTimer = null }
  // Hydrate from storage — the MV3 worker can sleep between brands in a run and
  // lose the in-memory id; reuse the same tab instead of opening a fresh one.
  if (_ccSendTabId == null) { try { const st = await chrome.storage.local.get('ccSendTabId'); if (st && st.ccSendTabId != null) _ccSendTabId = st.ccSendTabId } catch (e) {} }
  if (_ccSendTabId != null) {
    try {
      const t = await chrome.tabs.get(_ccSendTabId)
      if (t && /affiliate-program\.amazon\.com/i.test(t.url || '')) {
        if (/\/ap\/signin|\/gp\/sign-in/i.test(t.url || '')) return { tabId: _ccSendTabId, fresh: false, signIn: true, finalUrl: t.url }
        return { tabId: _ccSendTabId, fresh: false, finalUrl: t.url }
      }
    } catch (e) { /* tab gone */ }
    _ccSendTabId = null
  }
  const openedAt = Date.now()
  const tab = await chrome.tabs.create({ url: ccActiveUrl(), active: false })
  _ccSendTabId = tab.id
  try { chrome.storage.local.set({ ccSendTabId: tab.id }) } catch (e) {}
  await waitForTabLoad(tab.id, 15000)
  // Wait for the SPA to boot (net-hook saw a connect call after we opened) AND the
  // URL to stop changing for two reads, or ~15s — so content.js is mounted and the
  // page is quiet before the first send.
  let lastUrl = '', stable = 0, booted = false, signIn = false
  for (let i = 0; i < 25; i++) {
    let u = ''
    try { const t = await chrome.tabs.get(tab.id); u = (t && t.url) || '' } catch (e) {}
    if (u && /\/ap\/signin|\/gp\/sign-in/i.test(u)) { signIn = true; lastUrl = u; break }
    if (!booted) { try { booted = (_ccNetRing || []).some((r) => r && r.ts >= openedAt) } catch (e) {} }
    if (u && u === lastUrl) stable++; else { stable = 0; lastUrl = u }
    if (booted && stable >= 2 && _ccCreatorId) break
    await _sleep(600)
  }
  return { tabId: tab.id, fresh: true, booted, signIn, finalUrl: lastUrl }
}

// Close the shared send tab after a spell of no sends (the bulk run has finished).
// Each send pushes this out, so the tab lives for the whole run and then goes away.
function releaseSendTabSoon(ms) {
  if (_ccSendTabCloseTimer) clearTimeout(_ccSendTabCloseTimer)
  _ccSendTabCloseTimer = setTimeout(async () => {
    _ccSendTabCloseTimer = null
    const id = _ccSendTabId; _ccSendTabId = null
    try { chrome.storage.local.remove('ccSendTabId') } catch (e) {}
    if (id != null) { try { await chrome.tabs.remove(id) } catch (e) {} }
  }, ms || 45000)
}

async function sendByAsinApi(asin, message, campaignIdsHint) {
  if (!message || !message.trim()) return { ok: false, error: 'no-message' }
  await ensureRecipesLoaded()
  // Use the learned recipe when we have one; otherwise fall back to the built-in
  // default shapes so a fresh install still sends fully in the background (no
  // manual "prime" send, no visible tab). Cookie auth covers the headers.
  const sendTemplate = (_ccSendRecipe && _ccSendRecipe.bodyTemplate) || DEFAULT_SEND_BODY
  const searchTemplate = (_ccSearchRecipe && _ccSearchRecipe.bodyTemplate) || DEFAULT_SEARCH_BODY
  const sendHeaders = (_ccSendRecipe && _ccSendRecipe.headers) || {}
  const keepAlive = startKeepAlive()
  // ONE attempt: fresh hidden tab → wait for load + settle → run the in-page
  // resolve/search/send. `settleMs` grows on retry because the connect page is a
  // heavy SPA; if executeScript runs before it's settled (or the SPA client-
  // navigates mid-run) the injection context is torn down and Chrome hands back
  // an empty result ("no-result"), which is transient — a fresh, longer-settled
  // tab clears it.
  // Per-send diagnostic (exposed via MVP_CC_DEBUG.lastSend). Records WHY a send
  // failed so a "no-result" is never opaque again — which attempt, the tab's
  // final url, the executeScript result shape, and any thrown error.
  const diag = {
    asin: asin || null, ts: Date.now(),
    usedDefaultSend: !(_ccSendRecipe && _ccSendRecipe.bodyTemplate),
    usedDefaultSearch: !(_ccSearchRecipe && _ccSearchRecipe.bodyTemplate),
    creatorIdAtStart: _ccCreatorId ? String(_ccCreatorId).slice(0, 22) + '…' : null,
    creatorNameAtStart: _ccCreatorName || null,
    attempts: [],
  }
  const attempt = async (settleMs) => {
    const a = { settleMs, finalUrl: null, reason: null }
    // Reuse the shared warm tab (created once per bulk run). No per-send open/close.
    const tab = await acquireSendTab()
    const tabId = tab.tabId
    a.finalUrl = tab.finalUrl ? String(tab.finalUrl).slice(0, 160) : null
    a.fresh = tab.fresh
    a.booted = tab.booted
    if (tab.signIn) { a.reason = 'not-signed-in'; diag.attempts.push(a); return { ok: false, reason: 'not-signed-in' } }
    // A short settle only matters the first time (fresh tab still warming); a reused
    // tab is already quiet.
    if (tab.fresh) await _sleep(settleMs)
    // SEND VIA THE PERSISTENT CONTENT SCRIPT (content.js) — an executeScript-injected
    // function on this page can neither return nor message back (proven). Message the
    // tab and await sendResponse, retrying briefly while content.js mounts.
    // The connect chat APIs need the creator's STORE id as a header (else 401).
    // Sniff it from the page's OWN captured requests (net-hook stored their headers)
    // or from a captured accept/campaign body; content.js also reads it off the page
    // as a fallback.
    const sniffStoreId = () => {
      try {
        for (let i = (_ccNetRing || []).length - 1; i >= 0; i--) {
          const r = _ccNetRing[i]; if (!r) continue
          const h = r.headers || {}
          const k = Object.keys(h).find((k) => k.toLowerCase() === 'storeid')
          if (k && h[k]) return String(h[k])
          const bm = String(r.body || '').match(/"storeId"\s*:\s*"([^"]+)"/)
          if (bm) return bm[1]
        }
      } catch (e) {}
      return _ccStoreId || ''
    }
    const storeId = sniffStoreId()
    if (storeId && storeId !== _ccStoreId) { _ccStoreId = storeId; try { chrome.storage.local.set({ ccStoreId: storeId }) } catch (e) {} }
    a.storeId = storeId || null
    const payload = {
      asin: asin || '', segments: splitCcGroups(message), campaignIdsHint: campaignIdsHint || [],
      creatorId: _ccCreatorId, creatorName: _ccCreatorName || '', headers: sendHeaders, storeId,
      sendTemplate, searchTemplate,
      MSG: MSG_PLACEHOLDER, CTX: CTX_PLACEHOLDER, CAMP: CAMPAIGN_PLACEHOLDER,
      CREATOR: CREATOR_PLACEHOLDER, ACTOR: ACTOR_PLACEHOLDER,
    }
    let out = null
    a.viaContent = true
    for (let i = 0; i < 12 && !out; i++) {
      try {
        out = await chrome.tabs.sendMessage(tabId, { type: 'MVP_CC_SEND_INPAGE', payload })
      } catch (e) {
        a.contentErr = String(e && e.message || e).slice(0, 160)
        await _sleep(700)
      }
    }
    a.contentReplied = !!out
    out = out || { ok: false, reason: 'no-content-reply' }
    a.reason = out.reason || (out.ok ? 'ok' : 'unknown')
    if (out && out.searchDbg) a.searchDbg = out.searchDbg
    if (out && out.campaignIds) a.campaignIds = out.campaignIds
    diag.attempts.push(a)
    try { if (out && out.creatorId && out.creatorId !== _ccCreatorId) { _ccCreatorId = out.creatorId; chrome.storage.local.set({ ccCreatorId: out.creatorId }) } } catch (e) {}
    return out
  }
  try {
    // Only retry a plumbing failure (tab/content not ready). A real reason from the
    // send pipeline (no-campaign-for-asin, no-context-token, send-rejected, ok) is
    // authoritative and must NOT be retried.
    const empty = (o) => !o || o.reason === 'no-result' || o.reason === 'exec-threw' || o.reason === 'no-content-reply'
    let out = await attempt(1500)
    if (empty(out)) { await _sleep(1200); out = await attempt(3500) }
    if (empty(out)) { await _sleep(1500); out = await attempt(6000) }
    // Cache the creator's display name the first time we learn it (from the chat
    // search reply), so every later default send fills actorName up front.
    try { if (out && out.creatorName && !_ccCreatorName) { _ccCreatorName = out.creatorName; chrome.storage.local.set({ ccCreatorName: out.creatorName }) } } catch (e) {}
    diag.finalReason = out && out.reason ? out.reason : (out && out.ok ? 'ok' : 'unknown')
    diag.ok = !!(out && out.ok)
    _ccLastSendDiag = diag
    // Persist — the MV3 service worker sleeps after ~30s idle and wipes in-memory
    // state, so without this the diagnostic is gone by the time the app reads it.
    try { chrome.storage.local.set({ ccLastSendDiag: diag }) } catch (e) {}
    return out
  } catch (e) {
    diag.finalReason = 'exception'; diag.error = e && e.message ? e.message : String(e); _ccLastSendDiag = diag
    try { chrome.storage.local.set({ ccLastSendDiag: diag }) } catch (e) {}
    return { ok: false, error: e && e.message ? e.message : 'exception' }
  } finally {
    stopKeepAlive(keepAlive)
    // Keep the shared tab alive a bit for the next brand in the run; close it once
    // the run has clearly gone quiet. This is what stops the open/close-per-brand
    // churn — one tab serves the whole bulk send.
    releaseSendTabSoon(45000)
  }
}

// Runs IN the page (MAIN world): list ALL of the creator's accepted/active
// Creator Connections campaigns via Amazon's own API, paginating the
// collaboration/search endpoint (statuses SCHEDULED + DELIVERING = joined). No
// ASIN filter — returns everything the creator has joined, so MVP can show them
// under "Joined only" even for campaigns joined directly on Amazon. Self-
// contained (executeScript serializes it — no outer refs).
function ccListMyCampaignsInPage(opts) {
  return (async () => {
    const diag = { variants: [], creatorId: null }
    try {
      let creatorId = opts.creatorId
      const headers = opts.headers
      // Self-discover the creator id from the OPEN page if the background didn't
      // have it yet — try the page HTML first, then any inline JSON. Amazon's SPA
      // usually loads it via its own API (which net-hook captures for the
      // background), but scan here too as a fallback.
      if (!creatorId) {
        try {
          const html = (document.documentElement && document.documentElement.innerHTML) || ''
          const m = html.match(/amzn1\.creator\.[a-z0-9-]+/i)
          if (m) creatorId = m[0]
        } catch (e) {}
      }
      if (!creatorId) return { ok: false, reason: 'no-creator-id', diag }
      diag.creatorId = String(creatorId).slice(0, 22) + '…'
      // Prefer the headers captured from the page's OWN collaboration/search call —
      // they carry Amazon's anti-CSRF token (anti-csrftoken-a2z / x-amz-*). Without
      // it the endpoint returns 401 (the exact failure the diagnostic showed). Drop
      // headers the fetch layer must set itself (content-length/host) or that would
      // break the replay. Fall back to the send-recipe headers if nothing captured.
      const baseHeaders = opts.capturedHeaders && Object.keys(opts.capturedHeaders).length ? opts.capturedHeaders : (headers || {})
      diag.usedCapturedHeaders = !!(opts.capturedHeaders && Object.keys(opts.capturedHeaders).length)
      const DROP = { 'content-length': 1, 'host': 1, 'connection': 1, 'accept-encoding': 1 }
      const hdr = () => {
        const o = {}
        for (const k in baseHeaders) { if (!DROP[String(k).toLowerCase()]) o[k] = baseHeaders[k] }
        if (!o['Content-Type'] && !o['content-type']) o['Content-Type'] = 'application/json'
        if (!o['Accept'] && !o['accept']) o['Accept'] = 'application/json'
        return o
      }

      const FILTER_BASE = { availableSlotsOnly: null, interestTags: null, providingSamplesOnly: null, commissionPercentageFilters: null, dateRange: null, campaignBrowseNodes: null, earlyAccessOnly: null, gcorIdList: null, campaignQualifiers: null, contentTypes: null, adId: null, storeIds: null, creatorIds: null, flatFeeRanges: null, rangeFilters: null, socialChannels: null, premiumCreator: null, contractStatus: null, ratingStar: null, reviewCount: null, priceRange: null, budgetAvailabilityScoreList: null, dealMetadata: null }

      // A keyword narrows the query server-side (Amazon's own search) so we can find
      // any of a creator's joined campaigns — even at 100k+ — without pulling them
      // all. Matches brand OR product OR ASIN, mirroring Amazon's search box.
      const kw = String(opts.keyword || '').trim()
      const searchOptionsFor = () => kw
        ? [{ fieldName: 'brandName', searchString: kw }, { fieldName: 'campaignName', searchString: kw }, { fieldName: 'asin', searchString: kw }]
        : []

      const buildBody = (v, pageNumber, nextToken) => {
        // Authoritative path: replay the page's OWN active-view query, only swapping
        // the pagination cursor. This is the exact filter Amazon uses for the joined
        // list, so it matches regardless of how the API names campaignType/statuses.
        if (v.capturedBody) {
          try {
            const o = JSON.parse(v.capturedBody)
            o.nextToken = nextToken
            // Cursor pagination: the nextToken alone fixes the position. Advancing
            // pageNumber AND the token together confuses Amazon's server, which then
            // replays an earlier page — so the dedup loop sees "no new" and stops
            // early (the 45-of-133 gap). Pin pageNumber to 1 whenever a token is
            // carried; only token-less responses use the incrementing pageNumber.
            o.pageNumber = nextToken ? 1 : pageNumber
            if (!o.pageSize || o.pageSize < 30) o.pageSize = 30
            if (!o.creatorId && creatorId) o.creatorId = creatorId
            // Broaden the type so we get EVERY joined campaign, not just the type the
            // active tab happened to default to (that's the 44-vs-666 gap).
            if (o.filterOptions && typeof o.filterOptions === 'object') o.filterOptions.campaignType = null
            // Apply the keyword search (or clear it) on the replayed query.
            o.searchOptions = searchOptionsFor()
            return JSON.stringify(o)
          } catch (e) { /* fall through to synthetic body */ }
        }
        const filterOptions = Object.assign({ campaignType: v.campaignType, statuses: v.statuses }, FILTER_BASE)
        const b = { campaignId: null, brandId: null, filterOptions, sortOptions: [{ name: 'CAMPAIGN_TITLE', order: 'ASCENDING' }], nextToken, pageNumber: nextToken ? 1 : pageNumber, pageSize: 30, creatorId }
        if (!v.omitSearch) b.searchOptions = kw ? searchOptionsFor() : (v.searchOptions || [])
        return JSON.stringify(b)
      }

      const runPage = async (v, pageNumber, nextToken) => {
        const r = await fetch('/connect/api/collaboration/search', { method: 'POST', headers: hdr(), body: buildBody(v, pageNumber, nextToken), credentials: 'include' })
        let j = null, errText = ''
        try { const t = await r.text(); j = JSON.parse(t); if (!r.ok) errText = t.slice(0, 200) } catch (e) { errText = 'parse' }
        const resp = j && j.responses && j.responses[0]
        const ads = (resp && resp.ads) || []
        // Amazon reports the full match count under a few possible field names —
        // grab whichever exists so the diagnostic shows total vs fetched.
        const total = (resp && (resp.totalResultCount ?? resp.totalCount ?? resp.total ?? (resp.pagination && (resp.pagination.totalCount ?? resp.pagination.total)))) ?? null
        return { status: r.status, ads, nextToken: (resp && resp.nextToken) || null, errText, total }
      }

      // Filter variants to try, in order — Amazon's list query is fiddly: an empty
      // searchOptions can return nothing, and a too-narrow campaignType/status set
      // hides affiliate-plus joins. We use the FIRST variant that returns ads, and
      // record every variant's outcome in diag so a still-empty result is
      // debuggable (HTTP status + count per variant) instead of a silent zero.
      const variants = [
        // First: replay the active-view query the page just fired (if captured). This
        // is Amazon's own joined-campaigns filter, so it's the reliable path.
        ...(opts.capturedBody ? [{ label: 'captured-active-view', capturedBody: opts.capturedBody }] : []),
        { label: 'bounty+sched/deliv', campaignType: 'BOUNTY_BOARD', statuses: ['SCHEDULED', 'DELIVERING'] },
        { label: 'any-type+sched/deliv', campaignType: null, statuses: ['SCHEDULED', 'DELIVERING'] },
        { label: 'any-type+accepted/active', campaignType: null, statuses: ['ACCEPTED', 'ACTIVE', 'IN_PROGRESS', 'LIVE', 'SCHEDULED', 'DELIVERING', 'COMPLETED'] },
        // Diagnostic-only: no status filter. Runs ONLY if the real variants above
        // came back empty, and its ads are NOT written as "joined" (they could be
        // plain opportunities). We just read the status field off each ad so the
        // diagnostic shows which real statuses this account's campaigns carry —
        // that's what we need to pin the exact "joined" filter next.
        { label: 'any-type+no-status', campaignType: null, statuses: null, diagOnly: true },
      ]

      const out = []
      const seen = {}
      const statusCounts = {}
      const num = (...xs) => { for (const x of xs) { const n = Number(x); if (isFinite(n) && x != null && x !== '') return n } return null }
      const collect = (ads) => {
        let added = 0
        for (const a of ads) {
          if (!a || !a.campaignId || seen[a.campaignId]) continue
          seen[a.campaignId] = 1
          added++
          const asins = Array.isArray(a.campaignAsins) ? a.campaignAsins.map((x) => String(x).toUpperCase()) : []
          const st = a.campaignStatus || a.status || a.collaborationStatus || a.contractStatus || null
          if (st) statusCounts[st] = (statusCounts[st] || 0) + 1
          // Map extra fields defensively (names vary across ad shapes) so the joined
          // cards can show commission / image / rating without another lookup.
          // Slots / dates / budget vary in name across ad shapes — map defensively
          // so an ingested opportunity carries what the catalog needs (open spots +
          // an end date, which the catalog query filters on).
          const availSlot = num(a.availableSlots, a.availableSlot, a.remainingSlots, a.slotsRemaining, a.openSlots)
          const totSlot = num(a.totalSlots, a.totalSlot, a.maxSlots, a.slotCount)
          const endsAt = a.endDate || a.endsAt || a.campaignEndDate || a.endDateTime || a.availabilityEndDate || null
          out.push({
            campaignId: a.campaignId,
            asin: asins[0] || null,
            asins,
            asinCount: asins.length,
            brand: a.brandName || a.brand || null,
            name: a.campaignName || a.title || null,
            image: a.campaignImageUrl || a.imageUrl || a.image || (Array.isArray(a.campaignImages) ? a.campaignImages[0] : null) || null,
            commissionPct: num(a.commissionPercentage, a.commissionPercent, a.commission),
            rating: num(a.averageRating, a.rating, a.ratingStar),
            reviewCount: num(a.reviewCount, a.totalReviews),
            availableSlot: availSlot,
            totalSlot: totSlot,
            endsAt: endsAt,
            budget: num(a.budget, a.totalBudget),
            budgetRemaining: num(a.budgetRemaining, a.remainingBudget, a.availableBudget),
            status: st,
          })
        }
        return added
      }

      // Read the status field off ads WITHOUT adding them to the written list.
      const tallyStatuses = (ads) => {
        for (const a of ads) {
          if (!a) continue
          const st = a.campaignStatus || a.status || a.collaborationStatus || a.contractStatus || null
          if (st) statusCounts[st] = (statusCounts[st] || 0) + 1
        }
      }

      let picked = null
      for (const v of variants) {
        // Skip the diagnostic-only probe unless every real variant came up empty.
        if (v.diagOnly && out.length) continue
        try {
          const first = await runPage(v, 1, null)
          diag.variants.push({ label: v.label, status: first.status, ads: first.ads.length, err: first.errText || undefined })
          if (first.ads.length) {
            if (v.diagOnly) { tallyStatuses(first.ads); continue }
            picked = v
            collect(first.ads)
            if (first.total != null) diag.total = first.total
            let nextToken = first.nextToken
            let pages = 1
            let lastPageFull = first.ads.length >= 30
            // Paginate up to maxPages (default 60 ≈ 1800; the keyword search caps
            // lower for a fast, responsive query). Do NOT stop just because nextToken
            // is absent — some responses paginate by pageNumber with no token. Carry
            // the token when present, always bump pageNumber, and stop only when a
            // page adds NO new campaigns (dedup-aware) so token-less and token-based
            // pagination both terminate correctly.
            const maxPages = Math.max(1, opts.maxPages || 60)
            for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
              const p = await runPage(v, pageNumber, nextToken)
              const added = collect(p.ads)
              pages = pageNumber
              nextToken = p.nextToken
              lastPageFull = p.ads.length >= 30
              if (p.total != null) diag.total = p.total
              if (!added) break
            }
            diag.pagesFetched = pages
            diag.fetched = out.length
            // More may exist if we stopped at the page cap while pages were still
            // full (or Amazon's total exceeds what we fetched).
            diag.hasMore = (typeof diag.total === 'number' && out.length < diag.total) || (pages >= maxPages && !!(nextToken || lastPageFull))
            break
          }
        } catch (e) {
          diag.variants.push({ label: v.label, err: (e && e.message) || 'exception' })
        }
      }

      diag.picked = picked ? picked.label : null
      diag.statusCounts = statusCounts
      return { ok: true, campaigns: out, creatorId, total: (typeof diag.total === 'number' ? diag.total : out.length), hasMore: !!diag.hasMore, diag }
    } catch (e) { return { ok: false, error: e && e.message ? e.message : 'exception', diag } }
  })()
}

// Background driver for the above: opens a hidden affiliate-program tab (the
// creator's own session) and runs the list-in-page function.
async function listMyCampaignsApi(params) {
  const keyword = (params && params.keyword) || ''
  const maxPages = params && params.maxPages
  // Opportunities mode: search NEW (un-joined) campaigns instead of the creator's
  // joined ones — opens the opportunity grid + uses its own captured filter.
  const opportunities = !!(params && params.opportunities)
  await ensureRecipesLoaded()
  const keepAlive = startKeepAlive()
  let tabId = null
  try {
    // Only trust captures from THIS run's page load (not our own tokenless calls
    // left in the ring by a previous sync).
    const openedAt = Date.now()
    // Open the ACTIVE / joined view (status=active&type=affiliate-plus) — the tab
    // that lists campaigns the user has joined. Opening this (not the opportunity
    // grid) makes the page fire the exact collaboration/search query for joined
    // campaigns, which we capture and replay.
    const tab = await chrome.tabs.create({ url: opportunities ? ccOpportunitiesUrl() : ccActiveUrl(), active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 15000)
    // Give Amazon's React app a moment, then POLL for BOTH the creator id AND the
    // page's own collaboration/search capture. Amazon's SPA does NOT put the id in
    // the page HTML — it loads it via its own connect API calls, whose bodies carry
    // amzn1.creator.… and the joined-view filter, and whose HEADERS carry the
    // anti-CSRF token collaboration/search needs (else 401). net-hook.js captures
    // those POSTs. So we wait for the page to fire them (up to ~14s).
    await _sleep(1500)
    // Wait for the creator id AND a fresh capture — but if we already have a
    // persisted list recipe, don't block on a fresh capture (cached SPA loads may
    // not re-fire the query). Once creatorId is known we can proceed on the recipe.
    const existingRecipe = opportunities ? _ccOppListRecipe : _ccListRecipe
    for (let i = 0; i < 26 && (!_ccCreatorId || (!latestCollabSearch(openedAt) && !existingRecipe)); i++) await _sleep(500)
    const captured = latestCollabSearch(openedAt)
    // Persist a fresh capture as the reusable recipe (separate store per view); fall
    // back to the persisted one when this run captured nothing (so repeat searches
    // don't 401 on missing CSRF).
    if (captured) {
      const rec = { body: captured.body, headers: captured.headers, learnedAt: Date.now() }
      if (opportunities) { _ccOppListRecipe = rec; try { chrome.storage.local.set({ ccOppListRecipe: rec }) } catch (e) {} }
      else { _ccListRecipe = rec; try { chrome.storage.local.set({ ccListRecipe: rec }) } catch (e) {} }
    }
    const recipeNow = opportunities ? _ccOppListRecipe : _ccListRecipe
    const useBody = captured ? captured.body : (recipeNow && recipeNow.body) || null
    const useHeaders = captured ? captured.headers : (recipeNow && recipeNow.headers) || null
    const res = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: ccListMyCampaignsInPage,
      args: [{
        creatorId: _ccCreatorId,
        headers: (_ccSendRecipe && _ccSendRecipe.headers) || {},
        capturedBody: useBody,
        capturedHeaders: useHeaders,
        keyword,
        maxPages,
      }],
    })
    const out = (res && res[0] && res[0].result) || { ok: false, reason: 'no-result' }
    // Persist a newly-discovered creator id so every later call has it instantly.
    if (out && out.creatorId && out.creatorId !== _ccCreatorId) {
      _ccCreatorId = out.creatorId
      try { chrome.storage.local.set({ ccCreatorId: out.creatorId }) } catch (e) {}
    }
    return out
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'exception' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
    stopKeepAlive(keepAlive)
  }
}

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

// ── Amazon earnings sync ────────────────────────────────────────────────────
// Nowhere in Amazon shows a creator what they actually earned. CC reporting
// shows Creator Connections and EPC but scoped to whichever store is selected;
// the Associates page shows commissions and bounties but only for the offsite
// tracking id; and the same CC figure appears in both at wildly different values.
// Every CSV export we tested came back short — one month's file held 0.4% of the
// earnings its own dashboard showed — and Amazon's footnote says the detail is
// not meant to reconcile to the totals.
//
// So we do what the pages do: replay their own calls in the creator's session.
//   POST /connect/api/report/earnings/summary   reportType DATEWISE_ASIN  → CC
//                                               reportType SPONSORED_PRODUCTS → EPC
//                                               storeIds picks onsite / offsite
//   GET  /reporting/summary                     → Associates commissions + bounties
//
// The CC/EPC shape is verified against the creator's own screen. The Associates
// response shape is NOT yet known, so this fetches it and returns it RAW for
// inspection rather than guessing at a mapping and storing invented numbers.
// US only, on purpose. Other marketplaces run their own Associates portals on
// their own hosts, and Creator Connections is a US program. Scope is the US
// store until that changes, not an oversight to be widened casually.
const EARN_HOST = 'affiliate-program.amazon.com'
const EARN_PAGE = `https://${EARN_HOST}/p/connect/earnings`

let _earnJob = null

function earningsJobStatus() {
  if (!_earnJob) return { running: false }
  return {
    running: !_earnJob.done,
    done: !!_earnJob.done,
    error: _earnJob.error || null,
    months: _earnJob.months || 0,
    monthsDone: _earnJob.monthsDone || 0,
    savedPeriods: _earnJob.savedPeriods || 0,
    savedProducts: _earnJob.savedProducts || 0,
    diag: _earnJob.diag || null,
  }
}

// First day of each month between two YYYY-MM-DD dates, inclusive.
function monthStarts(fromIso, toIso) {
  const out = []
  const a = new Date(`${fromIso}T00:00:00Z`)
  const b = new Date(`${toIso}T00:00:00Z`)
  if (isNaN(a) || isNaN(b) || a > b) return out
  let y = a.getUTCFullYear(), m = a.getUTCMonth()
  for (let i = 0; i < 120; i++) {
    const start = new Date(Date.UTC(y, m, 1))
    if (start > b) break
    out.push(start)
    m++; if (m > 11) { m = 0; y++ }
  }
  return out
}
const isoDay = (d) => d.toISOString().slice(0, 10)

// Runs INSIDE the page so the request carries the creator's cookies and origin,
// exactly like the reporting page's own calls. executeScript serializes this, so
// it closes over nothing — every helper is defined inside.
function earningsFetchInPage(params) {
  return (async () => {
    const { months, stores, host, recipe } = params
    const out = { periods: [], products: [], assoc: [], errors: [], sample: null, mapping: null }
    // These endpoints carry NO csrf token. Auth is the same-origin session cookie
    // plus a `storeid` header naming the creator's base store. The token we were
    // guessing at was never the missing piece; the `storeid` header was, and that
    // is what every 401 was telling us.
    const baseStore = (stores.find((s) => s.scope === 'offsite') || stores[0] || {}).storeId || ''

    // The exact filterOptions shape the page sends. Sent verbatim (nulls included)
    // rather than trimmed, because an API that ignores unknown keys today can
    // start requiring known ones tomorrow.
    const emptyFilters = () => ({
      campaignType: null, availableSlotsOnly: null, interestTags: null,
      providingSamplesOnly: null, statuses: null, commissionPercentageFilters: null,
      campaignBrowseNodes: null, earlyAccessOnly: null, dateRange: null,
      gcorIdList: null, campaignQualifiers: null, contentTypes: null, adId: null,
      storeIds: null, creatorIds: null, flatFeeRanges: null, rangeFilters: null,
      socialChannels: null, premiumCreator: null, campaignId: null,
      contractStatus: null, ratingStar: null, reviewCount: null, priceRange: null,
      budgetAvailabilityScoreList: null, dealMetadata: null,
    })

    const ccSummary = async (fromMs, toMs, storeId, reportType) => {
      const filterOptions = emptyFilters()
      filterOptions.dateRange = { fromDate: fromMs, toDate: toMs }
      filterOptions.storeIds = [storeId]
      const res = await fetch(`https://${host}/connect/api/report/earnings/summary`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'accept': 'application/json', ...(baseStore ? { storeid: baseStore } : {}) },
        body: JSON.stringify({ aggregationOption: 'MONTH', reportType, filterOptions, searchOptions: null, sortOptions: null }),
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) return { ok: false, status: res.status }
      const j = await res.json().catch(() => null)
      const r = j && Array.isArray(j.responses) ? j.responses[0] : null
      if (!r) return { ok: false, status: res.status, shape: 'unexpected' }
      return {
        ok: true,
        clicks: r.totalClicks ?? null,
        orders: r.totalOrderCount ?? null,
        quantity: r.totalOrderedQuantity ?? null,
        earnings: r.totalEarningsAmount ?? null,
        revenue: r.totalRevenue ?? null,
      }
    }

    // ── per-ASIN breakdown ──────────────────────────────────────────────────
    // The totals say how much the month made. This says WHICH products made it,
    // which is the only version of the number a creator can act on.
    //
    // We have not seen this endpoint's response shape, so nothing here is
    // hardcoded to field names we guessed. It finds the array of records by
    // looking for objects that carry an ASIN under an asin-named key, then reads
    // each figure from the key Amazon itself named it. The first raw record and
    // the key mapping come back in `sample`/`mapping` so the mapping can be
    // checked against Amazon rather than believed.
    const ASIN_RE = /^[A-Z0-9]{10}$/
    // Amazon's reporting responses are not always a list of objects. This one
    // answered 200 with a table: a column list plus rows as bare arrays. Zip them
    // back into objects by column name so the same field-name mapping works on
    // either shape, rather than walking past a perfectly good answer.
    const zipTable = (root) => {
      const q = [root]
      let steps = 0
      while (q.length && steps++ < 20000) {
        const n = q.shift()
        if (!n || typeof n !== 'object') continue
        if (Array.isArray(n)) { for (const x of n) q.push(x); continue }
        let cols = null
        let rows = null
        for (const k in n) {
          const v = n[k]
          if (!Array.isArray(v) || !v.length) continue
          // Column definitions: strings, or objects carrying a name-ish field.
          if (!cols && v.every((x) => typeof x === 'string')) cols = v.slice()
          else if (!cols && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
            const named = v.map((x) => {
              for (const kk of Object.keys(x)) {
                if (/name|label|key|column|field|id$/i.test(kk) && typeof x[kk] === 'string') return x[kk]
              }
              return null
            })
            if (named.every(Boolean)) cols = named
          }
          if (!rows && v.every((x) => Array.isArray(x))) rows = v
        }
        if (cols && rows && rows.length && rows[0].length === cols.length) {
          return rows.map((r) => {
            const o = {}
            for (let i = 0; i < cols.length; i++) o[cols[i]] = r[i]
            return o
          })
        }
        for (const k in n) q.push(n[k])
      }
      return null
    }

    const findRecords = (root) => {
      const q = [root]
      let steps = 0
      while (q.length && steps++ < 20000) {
        const n = q.shift()
        if (!n || typeof n !== 'object') continue
        if (Array.isArray(n)) {
          const first = n.find((x) => x && typeof x === 'object' && !Array.isArray(x))
          if (first && Object.keys(first).some((k) => /asin/i.test(k) && typeof first[k] === 'string' && ASIN_RE.test(first[k].toUpperCase()))) return n
          for (const x of n) q.push(x)
        } else {
          for (const k in n) q.push(n[k])
        }
      }
      return null
    }
    // Pick the key holding a figure. `avoid` keeps us off the lookalikes: a
    // percentage, a rate, a currency code or an id is never the number we want.
    const pickKey = (obj, want, avoid) => {
      for (const k of Object.keys(obj)) {
        if (avoid && avoid.test(k)) continue
        if (!want.test(k)) continue
        const v = obj[k]
        if (typeof v === 'number' || typeof v === 'string') return k
      }
      return null
    }
    const numOf = (v) => {
      if (v == null) return null
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''))
      return Number.isFinite(n) ? n : null
    }

    // Replays the request the page itself made for its product table, with only
    // the date window and the store swapped. `recipe` is captured by net-hook
    // while the page loads; when there is none we do not fall back to a guessed
    // URL, we report that we have no recipe. Guessing is what produced
    // "TypeError: Failed to fetch" on every month.
    // Replays the request the page itself made for its product table, with only
    // the date window changed, and follows the pagination token to the end.
    //
    // The store filter is NOT set. Amazon accepts it on this report and then
    // ignores it, returning the same all-store rows for whichever store we ask
    // about. Asking twice and adding the answers together is what doubled every
    // figure on the page. So it is asked once per month, and the rows are filed
    // under store "all" with no scope, which is what they actually are.
    const ccProducts = async (fromMs, toMs) => {
      if (!recipe || !recipe.url || !recipe.body) return { ok: false, status: 'no captured product query' }
      const DROP = { 'content-length': 1, host: 1, connection: 1, 'accept-encoding': 1 }
      const headers = {}
      for (const k in (recipe.headers || {})) { if (!DROP[String(k).toLowerCase()]) headers[k] = recipe.headers[k] }
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json'
      if (baseStore && !Object.keys(headers).some((k) => k.toLowerCase() === 'storeid')) headers.storeid = baseStore

      const items = []
      let token = null
      let pages = 0
      // Body-offset pagination, learned by experiment when there is no cursor.
      let offsetKey = null
      let offsetStep = 0
      let offsetValue = 0
      // A competitor pulls 1,200 rows from this report, so 40 pages of 100 was a
      // ceiling I had guessed rather than measured. This clears that with room,
      // and a wall clock stops a runaway instead of a low cap silently truncating
      // the month.
      const productsStarted = Date.now()
      while (pages < 400 && Date.now() - productsStarted < 90000) {
        let body
        try {
          const o = JSON.parse(recipe.body)
          const fo = o.filterOptions && typeof o.filterOptions === 'object' ? o.filterOptions : (o.filterOptions = {})
          fo.dateRange = { fromDate: fromMs, toDate: toMs }
          // DATEWISE_ASIN is the type the working summary call uses for Creator
          // Connections, and its name says what it returns: per date, per ASIN.
          o.reportType = 'DATEWISE_ASIN'
          // aggregationOption is left exactly as the page sends it. Forcing
          // "MONTH" here, which is the summary endpoint's vocabulary, made Amazon
          // drop the connection rather than answer, and read as a network fault.
          if (!o.pageSize) o.pageSize = 100
          if (offsetKey) o[offsetKey] = offsetValue
          else { o.nextPageToken = token; o.nextToken = token }
          body = JSON.stringify(o)
        } catch (e) {
          return { ok: false, status: 'captured query was not JSON' }
        }

        let res = null
        let lastErr = null
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 1200))
          try {
            res = await fetch(recipe.url, {
              method: 'POST', credentials: 'include', headers, body,
              signal: AbortSignal.timeout(30000),
            })
            lastErr = null
            break
          } catch (e) {
            lastErr = (e && (e.name ? `${e.name}: ${e.message}` : e.message)) || String(e)
            res = null
          }
        }
        if (!res) return { ok: false, status: lastErr || 'no response', items }
        if (!res.ok) return { ok: false, status: res.status, items }
        const j = await res.json().catch(() => null)

        // Amazon names this list itself. Take it rather than making the generic
        // walk guess which array matters.
        let recs = null
        let holder = null
        try {
          for (const r of (j && Array.isArray(j.responses) ? j.responses : [])) {
            for (const k in r) {
              if (Array.isArray(r[k]) && r[k].length && /report|record|detail|item|row/i.test(k)) { recs = r[k]; holder = r; break }
            }
            if (recs) break
          }
        } catch (e) {}
        if (!recs || !recs.length) {
          const zipped = j ? zipTable(j) : null
          if (zipped && zipped.length && zipped.some((r) => Object.keys(r).some((k) => /asin/i.test(k)))) recs = zipped
        }
        if (!recs || !recs.length) {
          if (!out.sample && pages === 0) out.sample = `no ASIN records in ${recipe.url}: ${JSON.stringify(j).slice(0, 4000)}`
          break
        }

        const first = recs.find((x) => x && typeof x === 'object') || {}
        const K = {
          asin: pickKey(first, /asin/i, /list|count/i),
          title: pickKey(first, /title|productname|itemname|name$/i, /id$|store|campaign/i),
          clicks: pickKey(first, /click/i, /percent|rate|through/i),
          orders: pickKey(first, /order/i, /quantity|percent|rate|amount|value|id$/i),
          quantity: pickKey(first, /quantity|shipped/i, /percent|rate/i),
          earnings: pickKey(first, /earning|commission/i, /percent|rate|currency|id$/i),
          revenue: pickKey(first, /revenue|sales/i, /percent|rate|currency|id$/i),
        }
        if (!out.sample) {
          out.sample = JSON.stringify(first).slice(0, 1800)
          out.mapping = { ...K, _allKeys: Object.keys(first).join(', ').slice(0, 600) }
        }
        if (!K.asin) break
        for (const r of recs) {
          if (!r || typeof r !== 'object') continue
          const asin = String(r[K.asin] || '').toUpperCase()
          if (!ASIN_RE.test(asin)) continue
          items.push({
            asin,
            productTitle: K.title ? String(r[K.title] || '').slice(0, 300) : null,
            clicks: K.clicks ? numOf(r[K.clicks]) : null,
            orders: K.orders ? numOf(r[K.orders]) : null,
            quantity: K.quantity ? numOf(r[K.quantity]) : null,
            earnings: K.earnings ? numOf(r[K.earnings]) : null,
            revenue: K.revenue ? numOf(r[K.revenue]) : null,
          })
        }
        pages++
        let next = holder ? (holder.nextPageToken || holder.nextToken || null) : null
        // No cursor does not mean no more rows.
        //
        // A competitor's extension pulls 1,200 rows out of this same report while
        // we were stopping at ten, and the video list turned out to paginate by a
        // startIndex field inside the request body with no cursor in sight. So
        // when there is no cursor, look for that field the same way: ask for a
        // window past the first page under each plausible name and keep whichever
        // one returns different products.
        if (!next && !offsetKey && recs.length) {
          const firstAsin = String(recs[0][K.asin] || '').toUpperCase()
          const size = recs.length
          for (const key of ['startIndex', 'offset', 'from', 'skip', 'pageNumber', 'page', 'pageIndex']) {
            try {
              const o = JSON.parse(body)
              o[key] = /^(page|pageNumber|pageIndex)$/i.test(key) ? 2 : size
              const probe = await fetch(recipe.url, {
                method: 'POST', credentials: 'include', headers, body: JSON.stringify(o),
                signal: AbortSignal.timeout(25000),
              })
              if (!probe.ok) continue
              const pj = await probe.json().catch(() => null)
              let prs = null
              for (const r2 of (pj && Array.isArray(pj.responses) ? pj.responses : [])) {
                for (const k2 in r2) {
                  if (Array.isArray(r2[k2]) && r2[k2].length && /report|record|detail|item|row/i.test(k2)) { prs = r2[k2]; break }
                }
                if (prs) break
              }
              const a2 = prs && prs[0] ? String(prs[0][K.asin] || '').toUpperCase() : null
              if (a2 && a2 !== firstAsin) {
                offsetKey = key
                offsetStep = /^(page|pageNumber|pageIndex)$/i.test(key) ? 1 : size
                offsetValue = offsetStep * 2
                out.productPaging = key
                for (const r of prs) {
                  const asin = String(r[K.asin] || '').toUpperCase()
                  if (!ASIN_RE.test(asin)) continue
                  items.push({
                    asin,
                    productTitle: K.title ? String(r[K.title] || '').slice(0, 300) : null,
                    clicks: K.clicks ? numOf(r[K.clicks]) : null,
                    orders: K.orders ? numOf(r[K.orders]) : null,
                    quantity: K.quantity ? numOf(r[K.quantity]) : null,
                    earnings: K.earnings ? numOf(r[K.earnings]) : null,
                    revenue: K.revenue ? numOf(r[K.revenue]) : null,
                  })
                }
                break
              }
            } catch (e) { /* try the next name */ }
            await new Promise((r) => setTimeout(r, 150))
          }
        }
        if (!next && offsetKey) { offsetValue += offsetStep; next = null }
        else if (!next || next === token) break
        else token = next
        if (!next && !offsetKey) break
        await new Promise((r) => setTimeout(r, 200))
      }
      // The same ASIN appears once per day inside a month, so fold the days up.
      const byAsin = new Map()
      for (const it of items) {
        const a = byAsin.get(it.asin)
        if (!a) { byAsin.set(it.asin, { ...it }); continue }
        if (!a.productTitle && it.productTitle) a.productTitle = it.productTitle
        for (const f of ['clicks', 'orders', 'quantity', 'earnings', 'revenue']) {
          if (it[f] == null) continue
          a[f] = (a[f] == null ? 0 : a[f]) + it[f]
        }
      }
      return { ok: true, items: Array.from(byAsin.values()), pages, paging: out.productPaging || null }
    }

    for (const mth of months) {
      for (const st of stores) {
        for (const rt of [['cc', 'DATEWISE_ASIN'], ['epc', 'SPONSORED_PRODUCTS']]) {
          try {
            const r = await ccSummary(mth.fromMs, mth.toMs, st.storeId, rt[1])
            if (r.ok) {
              out.periods.push({
                periodStart: mth.start, periodType: 'month', stream: rt[0],
                storeId: st.storeId, storeScope: st.scope,
                clicks: r.clicks, orders: r.orders, quantity: r.quantity,
                earnings: r.earnings, revenue: r.revenue,
              })
            } else {
              out.errors.push(`${rt[0]} ${mth.start} ${st.storeId}: HTTP ${r.status}${r.shape ? ' ' + r.shape : ''}`)
            }
          } catch (e) {
            out.errors.push(`${rt[0]} ${mth.start} ${st.storeId}: ${(e && e.message) || e}`)
          }
          await new Promise(r => setTimeout(r, 250))
          // Then the per-ASIN breakdown for the same window. There is ONE captured
          // recipe and it belongs to the Creator Connections table, so this runs on
          // the cc pass only; running it again under the epc label would file the
          // same rows twice under a stream they didn't come from. A failure here
          // never costs us the total we already have, so it's caught separately.
          try {
            // Once per month. The report covers every store regardless of what we
            // ask, so running it per store returned the same rows twice and
            // doubled every figure on the page.
            const firstStore = st.storeId === stores[0].storeId
            const pr = (rt[0] === 'cc' && firstStore) ? await ccProducts(mth.fromMs, mth.toMs) : { ok: true, items: [] }
            if (pr.ok) {
              for (const it of pr.items) {
                out.products.push({
                  periodStart: mth.start, periodType: 'month', stream: rt[0],
                  // These rows cover every store at once. Filing them under one
                  // store's id would be a claim the data does not make.
                  storeId: 'all',
                  storeScope: null,
                  ...it,
                })
              }
            } else {
              out.errors.push(`${rt[0]} products ${mth.start} ${st.storeId}: HTTP ${pr.status}`)
            }
          } catch (e) {
            out.errors.push(`${rt[0]} products ${mth.start} ${st.storeId}: ${(e && e.message) || e}`)
          }
          await new Promise(r => setTimeout(r, 250))
        }
      }
    }

    // Associates commissions + bounties. We do NOT know this response's shape yet,
    // so it is captured raw for one month and never stored as earnings. Guessing a
    // mapping here is exactly how a dashboard ends up confidently wrong.
    try {
      const m0 = months[months.length - 1]
      const st = stores.find(s => s.scope === 'offsite') || stores[0]
      if (m0 && st) {
        const q = new URLSearchParams()
        q.set('query[start_date]', m0.start)
        q.set('query[end_date]', m0.end)
        q.set('query[type]', 'earning')
        q.set('query[storeId]', st.storeId)
        q.set('query[locale]', 'US')
        q.set('store_id', st.storeId)
        const res = await fetch(`https://${host}/reporting/summary?${q.toString()}`, {
          credentials: 'include', signal: AbortSignal.timeout(45000),
          headers: { accept: 'application/json', ...(baseStore ? { storeid: baseStore } : {}) },
        })
        const text = await res.text().catch(() => '')
        out.assoc.push({ url: `/reporting/summary?${q.toString()}`, status: res.status, body: text.slice(0, 4000) })
      }
    } catch (e) {
      out.errors.push(`assoc: ${(e && e.message) || e}`)
    }

    return out
  })()
}


// Push a batch to MVP from the worker (it holds the mvpaffiliate.io cookie).
async function pushEarningsToMvp(periods, products) {
  const origins = ['https://mvpaffiliate.io', 'https://www.mvpaffiliate.io']
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}/api/amazon-earnings/ingest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', redirect: 'follow',
        body: JSON.stringify({ periods: periods || [], products: products || [] }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok) return {
        ok: true,
        savedPeriods: (body && body.savedPeriods) || 0,
        savedProducts: (body && body.savedProducts) || 0,
        // Rows MVP refused to file. From 2026-09-09 Amazon groups low-activity
        // products under "Others", which has no ASIN and cannot be keyed, so
        // this count is about to mean real money that the breakdown drops. It
        // is carried back rather than swallowed.
        skipped: (body && body.skipped) || 0,
        skippedReasons: (body && body.skippedReasons) || [],
      }
      return { ok: false, error: (body && body.error) || `HTTP ${res.status}` }
    } catch (e) { /* try the other origin */ }
  }
  return { ok: false, error: 'could not reach MVP' }
}

async function syncAmazonEarnings(opts) {
  const from = (opts && opts.from) || `${new Date().getUTCFullYear()}-01-01`
  const to = (opts && opts.to) || isoDay(new Date())
  const job = { done: false, error: null, months: 0, monthsDone: 0, savedPeriods: 0, savedProducts: 0, diag: null }
  _earnJob = job
  const keepAlive = startKeepAlive()
  let tabId = null
  try {
    const starts = monthStarts(from, to)
    if (!starts.length) { job.error = 'bad date range'; job.done = true; return }
    job.months = starts.length
    const months = starts.map((d) => {
      const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
      const endMs = Math.min(next.getTime() - 1, new Date(`${to}T23:59:59Z`).getTime())
      return { start: isoDay(d), end: isoDay(new Date(endMs)), fromMs: d.getTime(), toMs: endMs }
    })

    const tab = await chrome.tabs.create({ url: EARN_PAGE, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    await _sleep(3500)
    // The creator can supply the id (it's printed in Amazon's own header as
    // "StoreID: …"), and that always wins over anything we scrape.
    let stores = []
    const given = Array.isArray(opts && opts.stores) ? opts.stores.filter((x) => /^(?:onamz)?[a-z0-9]{3,}-\d{2}$/i.test(String(x))) : []
    if (given.length) {
      for (const id of given) {
        const offsite = String(id).replace(/^onamz/i, '')
        if (!stores.some((x) => x.storeId === offsite)) stores.push({ storeId: offsite, scope: 'offsite' })
        const twin = `onamz${offsite}`
        if (!stores.some((x) => x.storeId === twin)) stores.push({ storeId: twin, scope: 'onsite' })
      }
    } else {
      // This page is a SPA, so the id often isn't in the markup at the moment we
      // first look. Retry while it hydrates, and search the places Amazon actually
      // puts it rather than pattern-matching the whole document (which previously
      // turned every `col-12` in the stylesheet into a fake store).
      for (let attempt = 0; attempt < 6 && stores.length === 0; attempt++) {
        if (attempt > 0) await _sleep(2000)
        let found = []
        try {
          const r = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: () => {
              const ids = new Set()
              const ok = (v) => typeof v === 'string' && /^(?:onamz)?[a-z0-9]{3,}-\d{2}$/i.test(v)
              const add = (v) => { if (ok(v)) ids.add(v) }
              try {
                // 1. The address bar, which carries store_id on most of these pages.
                const q = new URLSearchParams(location.search)
                add(q.get('store_id')); add(q.get('storeId')); add(q.get('tag'))
                // 2. Links the page renders that carry it.
                document.querySelectorAll('a[href*="store_id="],a[href*="storeId="],a[href*="tag="]').forEach((a) => {
                  try {
                    const u = new URL(a.getAttribute('href'), location.href)
                    const p = new URLSearchParams(u.search)
                    add(p.get('store_id')); add(p.get('storeId')); add(p.get('tag'))
                  } catch (e) {}
                })
                // 3. Amazon prints it in the header as "StoreID: gomin0e-20".
                const text = document.body ? document.body.innerText : ''
                const m = text.match(/store\s*id[:\s]+((?:onamz)?[a-z0-9]{3,}-\d{2})\b/i)
                if (m) add(m[1])
                // 4. Inline JSON state, anchored on the key name.
                for (const sc of document.querySelectorAll('script')) {
                  const t = sc.textContent || ''
                  if (t.length > 400000) continue
                  const re = /["'](?:store_?Id|trackingId|defaultStoreId)["']\s*:\s*["']((?:onamz)?[a-z0-9]{3,}-\d{2})["']/gi
                  let mm
                  while ((mm = re.exec(t)) && ids.size < 8) add(mm[1])
                }
              } catch (e) {}
              return Array.from(ids)
            },
          })
          found = (r && r[0] && r[0].result) || []
        } catch (e) { /* try again while it hydrates */ }
        for (const id of found) {
          const offsite = String(id).replace(/^onamz/i, '')
          if (!stores.some((x) => x.storeId === offsite)) stores.push({ storeId: offsite, scope: 'offsite' })
          const twin = `onamz${offsite}`
          if (!stores.some((x) => x.storeId === twin)) stores.push({ storeId: twin, scope: 'onsite' })
        }
      }
    }
    if (!stores.length) { job.error = 'Could not read your Amazon store id automatically. Enter it on the Earnings page (Amazon prints it in its own header as "StoreID: …") and sync again.'; job.done = true; return }
    // Cap it: a creator with several stores shouldn't fan out into hundreds of calls.
    stores = stores.slice(0, 4)
    job.diag = { stores: stores.map((s) => `${s.storeId}(${s.scope})`) }

    // Learn the product query before backfilling. The page fires its own
    // /connect/api/report/earnings/search for the table it renders, and we replay
    // that with the window, the store and the report type swapped.
    //
    // We do NOT click the page any more. The last attempt scanned the whole
    // document for an option matching /product/i, hit the "Sponsored Products for
    // Creators" nav tab, and switched the page to a report that has no data. The
    // request body is the thing that decides what comes back, so it is the thing
    // to change.
    let recipe = null
    const learnFrom = Date.now()
    await _sleep(4000)
    const calls = earningsReportCalls(learnFrom - 12000)
    recipe = calls.find((c) => /\/search$/i.test(c.path)) || null
    job.diag.reportCalls = calls.map((c) => c.path).slice(0, 6)
    job.diag.recipe = recipe ? recipe.path : 'none captured'
    // The captured body, so the fields that steer this report are visible rather
    // than inferred. It is the page's own request, not anything we composed.
    if (recipe) job.diag.recipeBody = String(recipe.body || '').slice(0, 1200)

    // A month at a time, pushing as we go, so a long backfill shows progress and
    // an interrupted run keeps what it already earned.
    for (let i = 0; i < months.length; i++) {
      if (job.canceled) break
      const res = await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN', func: earningsFetchInPage,
        args: [{ months: [months[i]], stores, host: EARN_HOST, recipe }],
      })
      const r = (res && res[0] && res[0].result) || null
      if (r) {
        if ((r.periods && r.periods.length) || (r.products && r.products.length)) {
          const pushed = await pushEarningsToMvp(r.periods || [], r.products || [])
          if (pushed.ok) {
            job.savedPeriods += pushed.savedPeriods
            job.savedProducts += pushed.savedProducts
            if (pushed.skipped) {
              job.diag.skipped = (job.diag.skipped || 0) + pushed.skipped
              job.diag.skippedReasons = Array.from(new Set((job.diag.skippedReasons || []).concat(pushed.skippedReasons || []))).slice(0, 5)
            }
          } else job.error = job.error || pushed.error
        }
        // The first record Amazon returned and the keys we read it by. Kept so the
        // per-ASIN mapping can be checked against Amazon's own screen instead of
        // taken on faith.
        if (r.sample && !job.diag.sample) { job.diag.sample = r.sample; job.diag.mapping = r.mapping || null }
        if (r.assoc && r.assoc.length && !job.diag.assoc) job.diag.assoc = r.assoc[0]
        if (r.errors && r.errors.length) job.diag.errors = (job.diag.errors || []).concat(r.errors).slice(0, 12)
      }
      job.monthsDone = i + 1
    }
    job.done = true
  } catch (e) {
    job.error = job.error || ((e && e.message) || 'earnings sync failed')
    job.done = true
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
    stopKeepAlive(keepAlive)
  }
}

// ── EPC API loader ──────────────────────────────────────────────────────────
// The ViralVue-style path: instead of DOM-scraping the virtualized Sponsored
// Products grid (partial, dupes, no trustworthy count), replay the page's OWN
// list query paginated. EPC has no export button, but the grid IS backed by a
// connect-API search that returns 30 items + a nextToken per page — so paging it
// yields every opportunity exactly once, with a real running count. Long job
// (tens of thousands at ~30/page, paced to stay under Amazon's throttle), so it
// runs in the background, ingests batches into MVP live, and the MVP tab polls
// for progress.

// Runs IN the page (MAIN world): fetch ONE page of the captured spcc query,
// swapping only the pagination cursor. Returns the raw items + nextToken + total.
// Self-contained (executeScript serializes it — no outer refs).
function epcFetchPageInPage(opts) {
  return (async () => {
    try {
      const DROP = { 'content-length': 1, 'host': 1, 'connection': 1, 'accept-encoding': 1 }
      const hdr = () => {
        const o = {}
        const h = opts.headers || {}
        for (const k in h) { if (!DROP[String(k).toLowerCase()]) o[k] = h[k] }
        if (!o['Content-Type'] && !o['content-type']) o['Content-Type'] = 'application/json'
        if (!o['Accept'] && !o['accept']) o['Accept'] = 'application/json'
        return o
      }
      // Take the captured body and set the pagination cursor. Field names vary, so
      // set every plausible one; harmless extras are ignored server-side.
      let body = opts.body
      try {
        const o = JSON.parse(opts.body)
        // Cursor pagination: nextToken fully specifies the position, so pageNumber
        // must stay at 1 once we're following a cursor. Incrementing pageNumber
        // AND advancing nextToken together confuses the server and it returns an
        // empty page early (the 866-then-stop symptom).
        o.pageNumber = opts.nextToken ? 1 : (opts.pageNumber || 1)
        o.nextToken = opts.nextToken || null
        if (o.pageSize == null) o.pageSize = 30
        if (o.pagination && typeof o.pagination === 'object') {
          o.pagination.pageNumber = o.pageNumber
          o.pagination.nextToken = opts.nextToken || null
        }
        // Status override: the grid's "New Opportunities" query filters to
        // OFFER_AVAILABLE, which is empty once a creator has accepted everything.
        // To reach the ACCEPTED set (what we actually want) we retry with other
        // status filters until one returns rows. null = no status filter (all).
        if (opts.hasStatusOverride) {
          if (!o.filterOptions || typeof o.filterOptions !== 'object') o.filterOptions = {}
          o.filterOptions.statuses = opts.statusesValue == null ? null : opts.statusesValue
        }
        // Generic filter patch (e.g. budgetAvailabilityScoreList) merged into
        // filterOptions — used to partition a query past the 2048 deep-paging cap.
        if (opts.filterPatch && typeof opts.filterPatch === 'object') {
          if (!o.filterOptions || typeof o.filterOptions !== 'object') o.filterOptions = {}
          for (const k in opts.filterPatch) o.filterOptions[k] = opts.filterPatch[k]
        }
        body = JSON.stringify(o)
      } catch (e) { /* non-JSON body — replay verbatim */ }

      const r = await fetch(opts.url, { method: 'POST', headers: hdr(), body, credentials: 'include' })
      let text = ''
      try { text = await r.text() } catch (e) {}
      let j = null
      try { j = JSON.parse(text) } catch (e) {}
      if (!r.ok || !j) return { status: r.status, items: [], nextToken: null, total: null, errText: (text || '').slice(0, 200), raw: (text || '').slice(0, 1500), topKeys: [] }

      // Find the item array + total + nextToken across the shapes Amazon uses for
      // these search endpoints (responses[0].ads is the collaboration shape; spcc
      // may name it items/results/campaigns or nest it directly). When none of the
      // known keys hit, fall back to the largest array of objects anywhere in the
      // response so we still page SOMETHING and the diagnostic shows the real shape.
      const resp = (j.responses && j.responses[0]) || j
      let items = (resp && (resp.asinInfoList || resp.ads || resp.items || resp.results || resp.campaigns || resp.opportunities || resp.records)) || j.asinInfoList || j.items || j.results || null
      let itemsKey = items ? 'known' : null
      if (!Array.isArray(items)) {
        // Deep-scan for the biggest array of objects (the product/opportunity list).
        let best = null, bestKey = null
        const walk = (o, path, depth) => {
          if (!o || depth > 4) return
          if (Array.isArray(o)) { if (o.length && typeof o[0] === 'object' && (!best || o.length > best.length)) { best = o; bestKey = path } return }
          if (typeof o === 'object') for (const k in o) walk(o[k], path ? path + '.' + k : k, depth + 1)
        }
        try { walk(j, '', 0) } catch (e) {}
        items = best || []
        itemsKey = bestKey || 'none'
      }
      const total = (resp && (resp.totalResults ?? resp.totalResultCount ?? resp.totalCount ?? resp.total ?? (resp.pagination && (resp.pagination.totalCount ?? resp.pagination.total))))
        ?? (j.totalResults ?? j.totalResultCount ?? j.totalCount ?? j.total) ?? null
      const nextToken = (resp && (resp.nextToken || (resp.pagination && resp.pagination.nextToken))) || j.nextToken || null
      const topKeys = []
      try { for (const k in j) topKeys.push(k); if (resp && resp !== j) { topKeys.push('responses[0]:'); for (const k in resp) topKeys.push(k) } } catch (e) {}
      return { status: r.status, items: Array.isArray(items) ? items : [], nextToken, total, errText: '', raw: (text || '').slice(0, 1500), topKeys, itemsKey }
    } catch (e) {
      return { status: 0, items: [], nextToken: null, total: null, errText: (e && e.message) || 'exception' }
    }
  })()
}

// Runs IN the page (MAIN world): fetch a BURST of consecutive pages, following the
// cursor back-to-back inside the page. One executeScript round-trip pulls many
// batches instead of one, which is the difference between ~30 items / 12s and a
// few hundred items in the same time. Returns the combined items + the final
// cursor. Stops the burst on a null cursor or a throttle/error (so the caller can
// back off). Self-contained (serialized by executeScript — no outer refs).
function epcFetchBurstInPage(opts) {
  return (async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const DROP = { 'content-length': 1, 'host': 1, 'connection': 1, 'accept-encoding': 1 }
    const hdr = () => {
      const o = {}; const h = opts.headers || {}
      for (const k in h) { if (!DROP[String(k).toLowerCase()]) o[k] = h[k] }
      if (!o['Content-Type'] && !o['content-type']) o['Content-Type'] = 'application/json'
      if (!o['Accept'] && !o['accept']) o['Accept'] = 'application/json'
      return o
    }
    const buildBody = (nextToken) => {
      try {
        const o = JSON.parse(opts.body)
        o.pageNumber = 1
        o.nextToken = nextToken || null
        if (o.pageSize == null) o.pageSize = 30
        if (o.pagination && typeof o.pagination === 'object') { o.pagination.pageNumber = 1; o.pagination.nextToken = nextToken || null }
        if (opts.filterPatch && typeof opts.filterPatch === 'object') {
          if (!o.filterOptions || typeof o.filterOptions !== 'object') o.filterOptions = {}
          for (const k in opts.filterPatch) o.filterOptions[k] = opts.filterPatch[k]
        }
        return JSON.stringify(o)
      } catch (e) { return opts.body }
    }
    const extract = (j) => {
      const resp = (j.responses && j.responses[0]) || j
      let items = (resp && (resp.asinInfoList || resp.ads || resp.items || resp.results || resp.campaigns || resp.opportunities || resp.records)) || j.asinInfoList || j.items || j.results || null
      let itemsKey = items ? 'known' : null
      if (!Array.isArray(items)) {
        let best = null, bestKey = null
        const walk = (o, path, depth) => {
          if (!o || depth > 4) return
          if (Array.isArray(o)) { if (o.length && typeof o[0] === 'object' && (!best || o.length > best.length)) { best = o; bestKey = path } return }
          if (typeof o === 'object') for (const k in o) walk(o[k], path ? path + '.' + k : k, depth + 1)
        }
        try { walk(j, '', 0) } catch (e) {}
        items = best || []; itemsKey = bestKey || 'none'
      }
      const nextToken = (resp && (resp.nextToken || (resp.pagination && resp.pagination.nextToken))) || j.nextToken || null
      return { items: Array.isArray(items) ? items : [], nextToken, itemsKey }
    }

    let nextToken = opts.nextToken || null
    const allItems = []
    let lastStatus = 200, pages = 0, throttled = false, itemsKey = null, raw = ''
    const burst = opts.burst || 8
    for (let i = 0; i < burst; i++) {
      let r
      try { r = await fetch(opts.url, { method: 'POST', headers: hdr(), body: buildBody(nextToken), credentials: 'include' }) } catch (e) { lastStatus = 0; break }
      lastStatus = r.status
      if (r.status === 429 || r.status >= 500) { throttled = true; break }
      if (r.status === 401 || r.status === 403) break
      let text = ''
      try { text = await r.text() } catch (e) {}
      let j = null
      try { j = JSON.parse(text) } catch (e) {}
      if (!j) { if (!raw) raw = (text || '').slice(0, 1500); break }
      const ex = extract(j)
      if (!itemsKey) itemsKey = ex.itemsKey
      for (const it of ex.items) allItems.push(it)
      pages++
      nextToken = ex.nextToken || null
      if (!nextToken) break
      if (i < burst - 1) await sleep(opts.inPageDelay || 300)
    }
    return { status: lastStatus, items: allItems, nextToken, pages, throttled, itemsKey, raw }
  })()
}

// Defensive map of ONE raw API item → the EPC ingest row shape
// (matches app/api/epc/ingest IncomingRow). Field names differ across Amazon's
// item shapes, so try a spread of candidates and deep-search for the ASIN.
function mapEpcApiItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const firstStr = (...xs) => { for (const x of xs) { if (typeof x === 'string' && x.trim()) return x.trim() } return null }
  const firstNum = (...xs) => { for (const x of xs) { const n = Number(x); if (x != null && x !== '' && isFinite(n)) return n } return null }
  const deepAsin = (o, depth) => {
    if (!o || depth > 4) return null
    if (typeof o === 'string') { const m = o.toUpperCase().match(/\bB0[A-Z0-9]{8}\b/); return m ? m[0] : null }
    if (Array.isArray(o)) { for (const v of o) { const a = deepAsin(v, depth + 1); if (a) return a } return null }
    if (typeof o === 'object') { for (const k in o) { const a = deepAsin(o[k], depth + 1); if (a) return a } }
    return null
  }
  // amount out of a { amount, currencyCode } money object (or a bare number).
  const money = (m) => { if (m == null) return null; if (typeof m === 'number') return isFinite(m) ? m : null; if (typeof m === 'object' && m.amount != null) { const n = Number(m.amount); return isFinite(n) ? n : null } return firstNum(m) }
  // Field names confirmed from a live spcc/search item (asin, asinBrand,
  // displayTitle, buyingPrice.amount, expectedRevenuePerClick, numberOfReviewStars,
  // budgetAvailabilityScore, imageUrl). Fallbacks kept in case the shape drifts.
  let asin = firstStr(raw.asin, raw.ASIN, raw.productAsin, Array.isArray(raw.campaignAsins) && raw.campaignAsins[0], Array.isArray(raw.asinList) && raw.asinList[0])
  asin = (asin || deepAsin(raw, 0) || '').toUpperCase()
  if (!/^B0[A-Z0-9]{8}$/.test(asin)) return null
  const budgetRaw = firstStr(raw.budgetAvailabilityScore, raw.budgetScore, raw.budget, raw.budgetAvailability)
  const budget = budgetRaw ? (/(^|\W)?(high)/i.test(budgetRaw) ? 'High' : /(^|\W)?(medium)/i.test(budgetRaw) ? 'Medium' : /(^|\W)?(low)/i.test(budgetRaw) ? 'Low' : null) : null
  const epcValue = firstNum(raw.expectedRevenuePerClick, raw.epc, raw.epcValue, raw.estimatedEpc, raw.estimatedEpcValue, raw.estimatedEarningsPerClick, raw.maxEpc, raw.epcUpTo)
  const priceValue = money(raw.buyingPrice) ?? money(raw.listPrice) ?? firstNum(raw.price, raw.priceValue, raw.priceAmount, raw.priceCents != null ? Number(raw.priceCents) / 100 : null, raw.amount)
  const rating = firstNum(raw.numberOfReviewStars, raw.rating, raw.starRating, raw.averageRating, raw.averageStarRating, raw.reviewRating)
  const endsAtRaw = firstStr(raw.dealMetadata && raw.dealMetadata.endDate, raw.endDate, raw.endsAt, raw.campaignEndDate, raw.endTime, raw.expiresAt)
  const reviewCount = firstNum(raw.reviewCount, raw.numberOfReviews, raw.totalReviews, raw.reviewsCount)
  // Availability → a short, friendly label (Amazon uses IN_STOCK / IN_STOCK_SCARCE
  // / LEADTIME / AVAILABLE_DATE).
  const availRaw = firstStr(raw.availability, raw.stockStatus, raw.inventoryStatus)
  const availability = availRaw ? (
    /scarce|low/i.test(availRaw) ? 'Low stock'
    : /out|unavailable/i.test(availRaw) ? 'Out of stock'
    : /leadtime|available_date|backorder/i.test(availRaw) ? 'Ships later'
    : /in_?stock/i.test(availRaw) ? 'In stock' : null
  ) : null
  return {
    asin,
    campaignName: firstStr(raw.displayTitle, raw.dedupeString, raw.title, raw.productTitle, raw.campaignName, raw.name, raw.productName, raw.itemName),
    brand: firstStr(raw.asinBrand, raw.brand, raw.brandName, raw.vendorName, raw.merchantName),
    epc: epcValue != null ? `Up to $${epcValue.toFixed(2)}` : firstStr(raw.epcDisplay, raw.epcLabel),
    epcValue,
    price: priceValue != null ? `$${priceValue.toFixed(2)}` : firstStr(raw.priceDisplay),
    priceValue,
    rating,
    reviewCount,
    availability,
    category: firstStr(raw.category, raw.productCategory, raw.categoryName),
    budget,
    endsAt: endsAtRaw,
    image: firstStr(raw.imageUrl, raw.image, raw.productImage, raw.mainImageUrl, raw.imageLink, raw.thumbnailUrl, Array.isArray(raw.images) && raw.images[0]),
  }
}

// In-memory job state for the EPC API load. Single job at a time; the MVP tab
// polls MVP_EPC_LOAD_POLL for the running count while the background paginates.
let _epcJob = null // { id, loaded, total, done, error, canceled, startedAt, finishedAt, pages, sample, addedTotal }

function _epcSnapshot() {
  if (!_epcJob) return { running: false }
  return {
    running: !_epcJob.done, id: _epcJob.id, loaded: _epcJob.loaded, total: _epcJob.total,
    done: _epcJob.done, error: _epcJob.error || null, pages: _epcJob.pages,
    addedTotal: _epcJob.addedTotal, sample: _epcJob.sample || null,
    diag: _epcJob.diag || null,
  }
}

// Background driver: open the spcc grid, learn its list query, paginate it,
// ingest batches into MVP, and keep _epcJob updated for polling. Paced to stay
// under Amazon's throttle (ViralVue runs ~one page / 3s; we go a touch faster
// with backoff on any non-OK). Best-effort; never throws (updates job.error).
async function loadEpcViaApi() {
  const job = { id: 'epc_' + Date.now(), loaded: 0, total: null, done: false, error: null, canceled: false, startedAt: Date.now(), finishedAt: null, pages: 0, sample: null, addedTotal: 0 }
  _epcJob = job
  const keepAlive = startKeepAlive()
  let tabId = null
  const seen = Object.create(null)
  let pending = []
  const flush = async () => {
    if (!pending.length) return
    const batch = pending; pending = []
    try { const r = await pushEpcToMvp(batch); if (r && r.ok && typeof r.added === 'number') job.addedTotal += r.added } catch (e) {}
  }
  try {
    const openedAt = Date.now()
    const tab = await chrome.tabs.create({ url: ccSponsoredUrl(), active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 15000)
    await _sleep(1500)
    // Wait for the page to fire (and net-hook to capture) its spcc list query.
    for (let i = 0; i < 30 && !latestSpccSearch(openedAt) && !job.canceled; i++) await _sleep(500)
    // Provoke each EPC tab's query. The opportunities tab fires an OFFER_AVAILABLE
    // query (a handful of not-yet-accepted offers); the Accepted view fires a
    // different one holding the full set. Clicking the tab in-page is the reliable
    // way to make the SPA fire it; URL navigation is a backup. We collect EVERY
    // distinct list query that fires and test them all — so the real accepted
    // query is found regardless of order/naming, and we never guess the enum.
    for (const t of [{ re: 'accepted', st: 'accepted' }, { re: 'active|joined|enrolled', st: 'active' }]) {
      if (job.canceled) break
      const t0 = Date.now()
      try { await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: clickSpccTabInPage, args: [t.re] }) } catch (e) {}
      await _sleep(1800)
      for (let i = 0; i < 10 && !latestSpccSearch(t0) && !job.canceled; i++) await _sleep(500)
      // Backup provocation: navigate the URL to that view.
      const navUrl = `${CC_BASE}?${_ccCreatorId ? `creatorId=${encodeURIComponent(_ccCreatorId)}&` : ''}status=${t.st}&type=spcc`
      try { await chrome.tabs.update(tabId, { url: navUrl }) } catch (e) {}
      await waitForTabLoad(tabId, 12000); await _sleep(1500)
      for (let i = 0; i < 10 && !latestSpccSearch(t0) && !job.canceled; i++) await _sleep(500)
    }
    // Every distinct list query captured this whole run, newest first, labeled by
    // its statuses filter (so the diagnostic literally shows Amazon's enum).
    const caps = allSpccSearches(openedAt)
    if (!caps.length) {
      const seen = []
      try {
        for (let i = _ccNetRing.length - 1; i >= 0 && seen.length < 12; i--) {
          const rec = _ccNetRing[i]
          if (!rec || (openedAt && rec.ts && rec.ts < openedAt)) continue
          if (/\/connect\/api\//i.test(String(rec.url || ''))) seen.push(String(rec.url).slice(0, 140))
        }
      } catch (e) {}
      job.error = 'no-capture'; job.diag = { capUrl: null, seenPosts: seen }; job.done = true; job.finishedAt = Date.now(); return
    }
    job.diag = { capSources: caps.map((c) => c.label), capBody: String(caps[0].body || '').slice(0, 800) }

    // Run one page of a specific captured query, with an optional filter patch.
    const fetchPageFor = async (capX, page, nextToken, filterPatch) => {
      try {
        const out = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN', func: epcFetchPageInPage,
          args: [{ url: capX.url, headers: capX.headers, body: capX.body, pageNumber: page, nextToken, filterPatch: filterPatch || null }],
        })
        return (out && out[0] && out[0].result) || null
      } catch (e) { return null }
    }
    // Fetch a burst of consecutive pages in one in-page round-trip (much faster).
    const fetchBurstFor = async (capX, nextToken, filterPatch, burst) => {
      try {
        const out = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN', func: epcFetchBurstInPage,
          args: [{ url: capX.url, headers: capX.headers, body: capX.body, nextToken, filterPatch: filterPatch || null, burst: burst || 8, inPageDelay: 300 }],
        })
        return (out && out[0] && out[0].result) || null
      } catch (e) { return null }
    }

    // Probe each captured spcc query (page 1) so we know which have rows. All caps
    // are spcc-only now, so any with items is a real grid feed.
    const probe = []
    const liveCaps = []
    for (const c of caps) {
      if (job.canceled || job.error) break
      const r = await fetchPageFor(c, 1, null, null)
      const items = r && Array.isArray(r.items) ? r.items : []
      // Count how many rows in this feed are ACTUALLY opted in. The panel prints
      // this as "Noi", and it was never populated here, so it always read 0 and
      // made a healthy OPTED_IN feed look broken. Amazon's status enum is the
      // label; this is the row-level truth.
      const optedInCount = items.reduce((n, x) => n + (x && x.optedIn === true ? 1 : 0), 0)
      probe.push({ try: `cap:${c.label}`, http: r ? r.status : 0, total: r ? r.total : null, items: items.length, optedIn: optedInCount })
      if (r && (r.status === 401 || r.status === 403)) { job.error = 'unauthorized'; break }
      if (items.length) { liveCaps.push(c); if (!job.sample) { try { job.sample = JSON.stringify(items[0]).slice(0, 1800) } catch (e) {} } }
      await _sleep(250)
    }
    job.diag.probe = probe
    if (!liveCaps.length) { job.error = job.error || 'no-rows'; job.done = true; job.finishedAt = Date.now(); return }
    job.total = null // no reliable total; show "Loaded N" only

    let pace = 700   // between bursts (each burst already spaces its own pages)
    const MAX_PAGES = 8000

    // Paginate ONE query (cap + optional filter patch) by cursor until the feed
    // ends, unioning rows into the shared seen/pending. Returns how many NEW rows
    // it added. Records the stop reason per query.
    const paginateQuery = async (cap, filterPatch, label) => {
      let nextToken = null, errStreak = 0, emptyStreak = 0, added = 0, stop = 'cursor-end'
      for (let round = 0; round < MAX_PAGES; round++) {
        if (job.canceled) { stop = 'canceled'; break }
        const res = await fetchBurstFor(cap, nextToken, filterPatch, 8)
        if (!res || res.status === 0) { if (++errStreak >= 4) { stop = 'fetch-failed'; break } await _sleep(pace * 2); continue }
        if (res.throttled || res.status === 429 || res.status >= 500) {
          pace = Math.min(6000, pace + 800)
          // Ingest what the burst got before backing off.
          for (const raw of (res.items || [])) { const row = mapEpcApiItem(raw); if (!row || seen[row.asin]) continue; seen[row.asin] = 1; pending.push(row); job.loaded++; added++ }
          nextToken = res.nextToken || nextToken
          if (++errStreak >= 10) { stop = 'throttled'; break }
          await _sleep(pace); continue
        }
        if (res.status === 401 || res.status === 403) { job.error = 'unauthorized'; stop = 'unauthorized'; break }
        errStreak = 0
        const items = Array.isArray(res.items) ? res.items : []
        for (const raw of items) {
          const row = mapEpcApiItem(raw)
          if (!row || seen[row.asin]) continue
          seen[row.asin] = 1; pending.push(row); job.loaded++; added++
        }
        job.pages += res.pages || 1
        if (pending.length >= 300) await flush()
        nextToken = res.nextToken || null
        if (!nextToken) { stop = 'cursor-end'; break }
        if (!items.length) { if (++emptyStreak >= 4) { stop = 'empty-streak'; break } } else emptyStreak = 0
        await _sleep(pace)
      }
      job.diag.parts = job.diag.parts || []
      job.diag.parts.push({ q: label, added, stop })
      return { added, stop }
    }

    // Paginate every live query and union the rows. The Accepted (OPTED_IN) feed
    // is NOT subject to the 2048 ranked-feed cap and returns the whole set on its
    // own, so we don't bother splitting the capped New-Opportunities feed by budget
    // (that just churns dupes and trips Amazon's throttle for ~zero new rows).
    for (const c of liveCaps) {
      if (job.canceled || job.error) break
      await paginateQuery(c, null, c.label)
    }
    job.diag.stop = 'done'
    job.diag.stopLoaded = job.loaded
    await flush()
    job.done = true
    job.finishedAt = Date.now()
  } catch (e) {
    job.error = job.error || ((e && e.message) || 'exception')
    job.done = true
    job.finishedAt = Date.now()
    try { await flush() } catch (er) {}
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
    stopKeepAlive(keepAlive)
  }
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

// Shared Amazon throttle state. When any ASIN/dp read hits the "Temporarily
// Unavailable" / robot-check interstitial we stamp a short cooldown so every
// subsequent resolve short-circuits WITHOUT opening another Amazon tab. This
// honors the SCOUT throttle contract (stop hammering the instant Amazon pushes
// back) even for the ASIN-harvest loops, which previously had no STOP signal.
// The service worker stays alive across a single CC batch (active messaging),
// so this cooldown reliably covers the risky rapid-fire window.
let _amazonBlockedUntil = 0
const AMAZON_BLOCK_COOLDOWN_MS = 90000

// ── SCOUT campaign → ASIN resolver ─────────────────────────────────────────
// Amazon's 2026-07 Creator Connections redesign hides the ASIN on the card; it
// only appears on the campaign's own "View details" page (a full navigation).
// To ground a pushed campaign on its REAL ASIN without disturbing the user's
// search list, we open that details URL in a BACKGROUND tab, read the ASIN off
// the rendered page, and close the tab. Same background-tab pattern as the
// YouTube frame capture above.
function harvestAsinsInPage() {
  // STOP-on-throttle: if Amazon is serving the "Temporarily Unavailable" /
  // robot-check interstitial, bail immediately with a blocked sentinel so the
  // caller can set a cooldown and stop opening more tabs. Same detection the
  // /dp reader uses (readDpSignalsInPage) — kept inline because this function
  // is injected into the page via executeScript and can't close over outer refs.
  const _bodyText = document.body ? (document.body.innerText || '') : ''
  if (/website temporarily unavailable|we just need to make sure you'?re not a robot|enter the characters you see below|api-services-support@amazon|to discuss automated access|type the characters you see in this image|robot check/i.test(_bodyText)) {
    return { asins: [], blocked: true }
  }
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
  // Object shape { asins, blocked } — the blocked path above returns the same,
  // and every caller reads r.asins / r.blocked. (Returning a bare array here
  // silently made resolveCampaignAsin + the /dp reader see zero ASINs.)
  return { asins: Array.from(set), blocked: false }
}

async function resolveCampaignAsin(detailsUrl) {
  if (!detailsUrl) return { ok: false, error: 'no-url' }
  // Amazon just blocked us — don't open another tab until the cooldown lapses.
  if (Date.now() < _amazonBlockedUntil) return { ok: false, blocked: true, asins: [] }
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url: detailsUrl, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 20000)
    // The product renders async (React) — poll a few times before giving up.
    let asins = []
    for (let i = 0; i < 12; i++) {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: harvestAsinsInPage })
      const r = (results && results[0] && results[0].result) || { asins: [], blocked: false }
      // Interstitial → set the cooldown and bail so callers stop the batch.
      if (r.blocked) { _amazonBlockedUntil = Date.now() + AMAZON_BLOCK_COOLDOWN_MS; return { ok: false, blocked: true, asins: [] } }
      asins = r.asins || []
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
  // Amazon rate-limit / bot-check / maintenance interstitial — the signal to STOP
  // hammering. Detected off the page text so callers can abort the batch.
  const blocked = /website temporarily unavailable|we just need to make sure you'?re not a robot|enter the characters you see below|api-services-support@amazon|to discuss automated access|type the characters you see in this image|robot check/i.test(bodyText)
  if (blocked) return { sales: null, hasVideo: false, carouselPos: 'none', blocked: true }
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

  // Product price — the Buy Box price on the /dp page. This is the sortable
  // "product price" (the campaign card has no price). Prefer the core price
  // block; fall back to the first sensible "$X.XX" in the buy-box area.
  let price = null
  try {
    const priceEl = document.querySelector(
      '#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen, ' +
      '#price_inside_buybox, #priceblock_ourprice, #priceblock_dealprice, .a-price .a-offscreen'
    )
    const raw = priceEl ? (priceEl.textContent || '') : ''
    const pm = raw.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/)
    if (pm) { const n = parseFloat(pm[1].replace(/,/g, '')); if (!isNaN(n) && n > 0) price = n }
  } catch (e) {}

  // Star rating — "4.3 out of 5 stars" (title attr or visible text near the top).
  let rating = null
  try {
    const rEl = document.querySelector('#acrPopover, [data-hook="rating-out-of-text"], i[class*="a-icon-star"] .a-icon-alt')
    const rTxt = rEl ? ((rEl.getAttribute && rEl.getAttribute('title')) || rEl.textContent || '') : ''
    const rm = (rTxt || bodyText.slice(0, 4000)).match(/([\d.]+)\s*out of 5/i)
    if (rm) { const n = parseFloat(rm[1]); if (!isNaN(n) && n > 0 && n <= 5) rating = n }
  } catch (e) {}

  // Breadcrumb / category trail — the reliable input for category avoid-rules
  // ("never supplements / food / pharmacy / clothing"), since campaign names lie.
  let crumbs = null
  try {
    const bc = document.querySelector('#wayfinding-breadcrumbs_feature_div, #wayfinding-breadcrumbs_container')
    if (bc) crumbs = (bc.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null
  } catch (e) {}

  // Main product image — the hero thumbnail for the Saved shelf / Finder rows.
  // Prefer the landing image's hi-res data attr, then its src, then og:image.
  let image = null
  try {
    const img = document.querySelector('#landingImage, #imgTagWrapperId img, #main-image, #ivLargeImage img')
    if (img) {
      let src = img.getAttribute('data-old-hires') || ''
      if (!src) {
        // data-a-dynamic-image is a JSON map of {url: [w,h]} — take the first url.
        const dyn = img.getAttribute('data-a-dynamic-image')
        if (dyn) { try { src = Object.keys(JSON.parse(dyn))[0] || '' } catch (e) {} }
      }
      if (!src) src = img.getAttribute('src') || ''
      if (src && /^https?:\/\//.test(src) && !/^data:/.test(src)) image = src
    }
    if (!image) {
      const og = document.querySelector('meta[property="og:image"]')
      const c = og && og.getAttribute('content')
      if (c && /^https?:\/\//.test(c)) image = c
    }
  } catch (e) {}

  return { sales, hasVideo: carouselPos !== 'none', carouselPos, price, rating, crumbs, image }
}

// Deep import check for one campaign: resolve its ASIN (from the details page),
// then reuse the SAME tab to open the /dp page and read sales + carousel video.
async function resolveProductDeep(detailsUrl) {
  if (!detailsUrl) return { ok: false, error: 'no-url' }
  // Respect the shared Amazon cooldown — don't open a tab while blocked.
  if (Date.now() < _amazonBlockedUntil) return { ok: false, blocked: true, asin: null, sales: null, hasVideo: false, price: null }
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url: detailsUrl, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 20000)
    let asin = null
    for (let i = 0; i < 12; i++) {
      const r = await chrome.scripting.executeScript({ target: { tabId }, func: harvestAsinsInPage })
      const a = (r && r[0] && r[0].result) || { asins: [], blocked: false }
      if (a.blocked) { _amazonBlockedUntil = Date.now() + AMAZON_BLOCK_COOLDOWN_MS; return { ok: false, blocked: true, asin: null, sales: null, hasVideo: false, price: null } }
      if (a.asins && a.asins.length) { asin = a.asins[0]; break }
      await _sleep(500)
    }
    if (!asin) return { ok: true, asin: null, sales: null, hasVideo: false, price: null }
    // Navigate the same tab to the product page and read the signals.
    await chrome.tabs.update(tabId, { url: `https://www.amazon.com/dp/${asin}` })
    await waitForTabLoad(tabId, 20000)
    await _sleep(1200)
    let out = { sales: null, hasVideo: false, carouselPos: 'none', price: null }
    for (let i = 0; i < 8; i++) {
      const r = await chrome.scripting.executeScript({ target: { tabId }, func: readDpSignalsInPage })
      const v = r && r[0] && r[0].result
      if (v) { out = v; if (v.hasVideo || v.sales != null || v.price != null) break }
      await _sleep(600)
    }
    return { ok: true, asin, sales: out.sales, hasVideo: out.hasVideo, carouselPos: out.carouselPos || 'none', price: out.price != null ? out.price : null, rating: out.rating != null ? out.rating : null, crumbs: out.crumbs || null }
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
  if (msg && msg.type === 'SCOUT_PUSH_CAMPAIGN') {
    pushCampaignsToMvp(msg.token, msg.campaigns).then(sendResponse)
    return true // async response
  }
  if (msg && msg.type === 'SCOUT_PUSH_EARNINGS') {
    pushEarningsToMvp(msg.earnings).then(sendResponse)
    return true // async response
  }
  if (msg && msg.type === 'SCOUT_PUSH_IDEA_LISTS') {
    pushIdeaListToMvp({ lists: msg.lists }).then(sendResponse)
    return true // async response
  }
  if (msg && msg.type === 'SCOUT_PUSH_IDEA_LIST_ITEMS') {
    pushIdeaListToMvp({ list: msg.list }).then(sendResponse)
    return true // async response
  }
  if (msg && msg.type === 'SCOUT_OUTREACH') {
    fetchOutreachFromMvp(msg.token, msg.ctx).then(sendResponse)
    return true // async response
  }
  if (msg && msg.type === 'SCOUT_VALIDATE_TOKEN') {
    validateMvpToken(msg.token).then(sendResponse)
    return true // async response
  }
  // A CC page reported the creator's own id — cache it so ccOpportunitiesUrl()
  // can deep-link to the working grid later, even with no CC tab open.
  if (msg && msg.type === 'CC_CREATOR_ID' && msg.creatorId) {
    if (msg.creatorId !== _ccCreatorId) {
      _ccCreatorId = msg.creatorId
      try { chrome.storage.local.set({ ccCreatorId: msg.creatorId }) } catch (e) {}
    }
    sendResponse({ ok: true })
    return false
  }
  // The net-hook (MAIN world) forwarded a Creator Connections API request. Route it
  // to the learners: /chat/message/send teaches the send recipe, /chat/search the
  // search recipe. The user's own manual sends teach both automatically.
  if (msg && msg.type === 'MVP_CC_NET_CAPTURE' && msg.rec) {
    // Route: request captures → learners; response captures → the response ring
    // (so we can SEE chat/search's reply and confirm the contextToken field).
    try {
      if (msg.kind === 'send-response') recordNetResponse(msg.rec)
      // An api-capture is a plain GET the page made. It carries no message to
      // learn from, so it goes straight into the ring for the scanners to read.
      else if (msg.kind === 'api-capture') recordNetCapture(msg.rec)
      else {
        learnFromCapture(msg.rec)
        // A POST to a reporting or content API is ALSO a request worth replaying,
        // and only learnFromCapture used to see it. That is why the video scan
        // only ever found a parameterless GET: the page pages with a POST body,
        // and the POST never reached the ring the scanner reads.
        try {
          if (/\/(manage-content|connect)\/api\//i.test(String(msg.rec.url || ''))) recordNetCapture(msg.rec)
        } catch (e) {}
      }
    } catch (e) {}
    sendResponse({ ok: true })
    return false
  }
  return false
})

// Validate an ingest token against MVP and report the account's queued count.
// `queued` is the decisive diagnostic for "pushed but not showing": it counts
// the campaigns on WHICHEVER account this token maps to, so a mismatch with what
// the user sees on /epc means the token belongs to a different MVP account.
async function validateMvpToken(token) {
  if (!token) return { ok: false, error: 'no token' }
  try {
    const res = await fetch(`${MVP_ORIGIN}/api/campaigns/ingest`, {
      headers: { 'Authorization': 'Bearer ' + token },
    })
    let body = null
    try { body = await res.json() } catch (e) {}
    if (res.ok && body && body.ok) return { ok: true, pro: !!body.pro, queued: body.queued }
    return { ok: false, error: (body && body.error) || `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'network error' }
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
    // The EPC library scan reads the "Sponsored Products for Creators" grid only
    // (type=spcc), NOT the Affiliate+ opportunities. Make sure the tab is on that
    // view — that's why an earlier scan "did nothing": it landed on Affiliate+.
    if (!tab || tab.id == null) {
      // None open — open the SPONSORED PRODUCTS (EPC) grid, FOREGROUND so the
      // React/virtualized grid renders reliably (background tabs throttle).
      tab = await chrome.tabs.create({ url: ccSponsoredUrl(), active: true })
      opened = true
      await waitForTabLoad(tab.id, 25000)
      await _sleep(3500) // let the SPA + grid paint before scrolling/harvesting
    } else {
      // A CC tab is open — scan whatever the user has on screen. They're told to
      // be on Sponsored Products → Accepted. Do NOT navigate the tab: forcing it
      // to the "New Opportunities" spcc URL threw away their Accepted products and
      // read 0. The content script detects the sponsored grid (by heading + ASIN
      // cards, not just the URL) and guides them if they're on the wrong view.
      try { await chrome.tabs.update(tab.id, { active: true }) } catch (e) {}
      await _sleep(800)
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
async function findCampaignOnTab(tabId, query, asin, brand, foreground, campaignIds, sweep) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: 'CC_FIND', query, asin, brand: brand || null, campaignIds: campaignIds || null, foreground: !!foreground, sweep: sweep !== false, maxResolve: 12, maxCards: 120 })
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

async function ccFindCampaign(query, asin, callerTabId, brand, campaignIds) {
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
      tab = await chrome.tabs.create({ url: ccOpportunitiesUrl(), active: false })
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

    // Quick BACKGROUND attempt on Opportunities only (sweep=false) — fast, and it
    // catches the common un-accepted case without a slow hidden 3-tab sweep. A
    // background tab usually can't re-filter its virtualized grid, so most real
    // hits come from the foreground pass below.
    let res = await findCampaignOnTab(tab.id, query, want, brand, false, campaignIds, false)

    // Not verified in the background → do the RELIABLE foreground pass, which
    // actually filters the grid, and sweeps all status tabs (an accepted campaign
    // lives in Active, not Opportunities). Then hand focus back to MVP.
    if (ccFoundNothingToCheck(res)) {
      try {
        await chrome.tabs.update(tab.id, { active: true })
        await _sleep(2800) // let the now-visible grid paint + settle
        const fg = await findCampaignOnTab(tab.id, query, want, brand, true, campaignIds, true)
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

// ── MVP Smart Scan (CC_SMART) ────────────────────────────────────────────────
// Full-grid Affiliate+ sweep gated by the MVP rulebook the app sends (single
// source of truth in the app's lib/cc-smart-rules.ts). The content script does
// the scan + paced deep-checks; this orchestrator owns the tab: reuse an open
// CC tab or open one hidden, unlock the offsite store, escalate to a short
// foreground pass when the virtualized grid won't render hidden, and never
// close a tab the user had open themselves. Mirrors ccFindCampaign's strategy.
async function smartScanOnTab(tabId, rules, keyword) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: 'CC_SMART', rules, keyword: keyword || '' })
  try {
    return await ask()
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    return await ask()
  }
}

async function ccSmartScan(rules, keyword, callerTabId) {
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
      tab = await chrome.tabs.create({ url: ccOpportunitiesUrl(), active: false })
      opened = true
      await waitForTabLoad(tab.id, 25000)
      await _sleep(3500) // let the SPA + grid mount
    }
    // CC is blocked on an onsite ("onamz…") store id — flip to offsite first.
    try {
      const sres = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: ensureOffsiteStoreInPage })
      const sw = sres && sres[0] && sres[0].result
      if (sw && sw.switched) { await _sleep(1500); await waitForTabLoad(tab.id, 25000); await _sleep(2500) }
    } catch (e) {}

    let res = await smartScanOnTab(tab.id, rules, keyword)

    // Hidden grid never rendered → brief foreground pass, then give focus back.
    if (!res || !res.ok || (res.stats && res.stats.scannedOnCard === 0)) {
      try {
        await chrome.tabs.update(tab.id, { active: true })
        await _sleep(2800)
        const fg = await smartScanOnTab(tab.id, rules, keyword)
        if (fg && fg.ok) { res = fg; res.foreground = true }
      } catch (e) { /* keep the background result */ }
      finally {
        if (callerTabId != null) { try { await chrome.tabs.update(callerTabId, { active: true }) } catch (e) {} }
      }
    }
    return res || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: opened ? 'smart-scan-failed' : 'content-script-unreachable' }
  } finally {
    if (opened && tab && tab.id != null) { try { await chrome.tabs.remove(tab.id) } catch (e) {} }
  }
}

// ── Batch "which of these products are CC campaigns?" (Check all CC) ─────────
// One CC search by keyword, resolve the result cards' ASINs once, match against
// the whole target set. Same background-first-then-foreground grid strategy as
// ccFindCampaign. Returns { matches: [{asin, detailsUrl, brand, commissionPct}] }.
async function matchCampaignsOnTab(tabId, keyword, asins) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: 'CC_MATCH', keyword, asins, maxResolve: 25, maxCards: 200 })
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
      tab = await chrome.tabs.create({ url: ccOpportunitiesUrl(), active: false })
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

// ── Idea Lists: BACKGROUND capture (no foreground tab) ───────────────────────
// The MVP app used to window.open() the Amazon list in the FOREGROUND, stealing
// focus and forcing the user to babysit the tab. These handlers do it the SCOUT
// way instead: open the list/storefront in a BACKGROUND tab (active:false), read
// it via an injected harvest, push to MVP, and CLOSE the tab. The user never
// leaves MVP. Same pattern as the CC/video background scans above.

// Injected into a single idea-list page. Scrolls to load every product tile,
// then collects asin/title/image + the list title/declared count. Self-contained
// (runs in page world — no chrome APIs).
async function harvestIdeaListInPage(maxPasses) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  let last = -1, stable = 0
  // Scroll to lazy-load every tile. A dedicated idea-list PAGE can hold hundreds
  // of products, so the catalog walk passes a bigger budget (see caller); the
  // root shelf harvest keeps the smaller default so it doesn't eat the whole
  // crawl. Stop after 3 stable reads (the grid finished loading).
  const passes = (typeof maxPasses === 'number' && maxPasses > 0) ? maxPasses : 24
  for (let i = 0; i < passes && stable < 3; i++) {
    try { window.scrollTo(0, document.body.scrollHeight) } catch (e) {}
    await sleep(800)
    const n = document.querySelectorAll('[data-asin]').length
    if (n === last) stable++; else { stable = 0; last = n }
  }
  try { window.scrollTo(0, 0) } catch (e) {}
  await sleep(300)
  const seen = new Set(), items = []
  const cleanTitle = (s) => (s || '')
    .replace(/\s+/g, ' ')
    .replace(/^\$\s?[\d.,]+\s*/, '')                         // leading price
    .replace(/^only \d+ left in stock[^.]*\.?\s*/i, '')      // "Only 5 left in stock - order soon."
    .replace(/\border soon\.?\s*/i, '')
    .replace(/\bquantity is[\d\s]+/i, '')                    // "Quantity is 1 1 1"
    .replace(/^(best ?seller|amazon['’]?s choice|overall pick|editor['’]?s pick|limited time deal|sponsored|new|popular pick)\s*/i, '')
    .trim()
  document.querySelectorAll('[data-asin]').forEach((el) => {
    const asin = (el.getAttribute('data-asin') || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) return
    seen.add(asin)
    const img = el.querySelector('img')
    // Prefer the product image's alt text (the clean product name) or a link
    // title/aria-label; fall back to the tile's text with price/stock stripped.
    let title = cleanTitle((img && img.getAttribute('alt')) || '')
    if (!title || title.length < 5) {
      const link = el.querySelector('a[title], a[aria-label]')
      title = cleanTitle((link && (link.getAttribute('title') || link.getAttribute('aria-label'))) || '')
    }
    if (!title || title.length < 5) {
      let t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
      const price = t.search(/\$\s?\d/); if (price > 0) t = t.slice(0, price)
      title = cleanTitle(t)
    }
    const src = img && (img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src'))
    items.push({ asin, title: title.slice(0, 200) || null, image: (src && /\.(jpg|jpeg|png|webp)/i.test(src)) ? src : null })
  })
  const h1 = document.querySelector('h1')
  const title = ((h1 && h1.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 160) || null
  const cm = ((document.body && document.body.innerText) || '').match(/([\d,]+)\s+Items?\b/i)
  return { ok: true, items, title, itemCount: cm ? parseInt(cm[1].replace(/,/g, ''), 10) : null, signedOut: /\/ap\/signin/.test(location.href) }
}

async function scanIdeaListBackground(rawUrl) {
  const url = String(rawUrl || '')
  const idM = url.match(/\/list\/([A-Za-z0-9]{6,})/)
  if (!/amazon\./i.test(url) || !idM) return { ok: false, error: 'bad-url' }
  const listId = idM[1]
  const full = url + (url.indexOf('#') >= 0 ? '' : '#mvp-sync')
  let tabId = null
  try {
    // BACKGROUND — the user stays in MVP; we never steal focus.
    const tab = await chrome.tabs.create({ url: full, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    await _sleep(2500) // let the SPA grid paint before scrolling
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: harvestIdeaListInPage })
    const r = (results && results[0] && results[0].result) || null
    if (!r || !r.ok) return { ok: false, error: 'no-result' }
    if (r.signedOut) return { ok: false, error: 'signed-out' }
    // Only a wrong page if EVERY frame says so. One frame being chrome while
    // another holds the grid is normal.
    if (frames.every((f) => f.wrongPage)) {
      const p = (r.probe || {})
      return {
        ok: false,
        error: 'wrong-page',
        landedOn: p.url || url,
        pageTitle: p.title || null,
        heading: p.heading || null,
        probe: describeProbe(frames),
      }
    }
    if (!r.items || !r.items.length) return { ok: true, count: 0 }
    const cleanUrl = url.split('#')[0].split('?')[0]
    const push = await pushIdeaListToMvp({ list: {
      amazonListId: listId, title: r.title, url: cleanUrl,
      itemCount: r.itemCount, coverImage: (r.items[0] && r.items[0].image) || null, items: r.items,
    } })
    return { ok: !!(push && push.ok), count: r.items.length, upserted: push && push.upserted, error: (push && push.ok) ? undefined : (push && push.error) }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'scan-failed' }
  } finally {
    // active:false the whole time, so there's no focus to restore — just close.
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// Injected into the storefront root. Clicks the "Idea Lists" tab, scrolls, and
// collects every list's id/title/url/count/cover. Self-contained.
async function harvestStorefrontListsInPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const JUNK = /^(subtotal|total|cart|checkout|save[d]? for later|buy again|your orders?|wish ?list|see more|view all|add to list)$/i
  const idFrom = (h) => { const m = String(h || '').match(/\/(?:shop\/[^/]+\/)?list\/([A-Za-z0-9]{6,})/i); return m ? m[1] : null }
  const hm = location.pathname.match(/\/shop\/([^/?#]+)/i); const handle = hm ? hm[1] : null
  const urlFor = (id) => handle ? `https://www.amazon.com/shop/${handle}/list/${id}` : `https://www.amazon.com/list/${id}`
  // Click the "Idea Lists" (or just "Lists") tab so the full list index renders.
  // Match a little more loosely than an exact "idea lists" so a layout tweak or
  // an item-count suffix ("Idea Lists (12)") doesn't hide every list.
  try {
    for (const el of document.querySelectorAll('a,button,[role="tab"],[role="button"],li,span')) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (/^idea lists\b/i.test(t) || /^lists\b/i.test(t)) {
        if (el.offsetParent !== null) { try { el.click() } catch (e) {} break }
      }
    }
  } catch (e) {}
  await sleep(1500)
  // Scroll until the list index stops growing. Big storefronts have many lists,
  // so give this real room (was 15 passes / capped at 20 downstream, which is
  // exactly how a store with hundreds of products only synced its root shelf).
  let last = -1, stable = 0
  for (let i = 0; i < 30 && stable < 3; i++) {
    try { window.scrollTo(0, document.body.scrollHeight) } catch (e) {}
    await sleep(1000)
    const n = document.querySelectorAll('a[href*="/list/"]').length
    if (n === last) stable++; else { stable = 0; last = n }
  }
  try { window.scrollTo(0, 0) } catch (e) {}
  const byId = new Map()
  document.querySelectorAll('a[href*="/list/"]').forEach((a) => {
    const id = idFrom(a.getAttribute('href') || a.href); if (!id || byId.has(id)) return
    const card = a.closest('li,[role="listitem"],[data-testid],article') || a.parentElement || a
    let label = (a.textContent || '').replace(/\s+/g, ' ').trim() || (((card.querySelector('h2,h3,[class*=title]')) || {}).textContent || '')
    label = (label || '').replace(/\s+/g, ' ').trim()
    if (JUNK.test(label)) return
    const cnt = (card.innerText || '').match(/([\d,]+)\s+Items?\b/i)
    const img = card.querySelector('img')
    const src = img && (img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src'))
    byId.set(id, {
      amazonListId: id, title: label.slice(0, 200) || null, url: urlFor(id),
      itemCount: cnt ? parseInt(cnt[1].replace(/,/g, ''), 10) : null,
      coverImage: (src && /\.(jpg|jpeg|png|webp)/i.test(src)) ? src : null,
    })
  })
  return { ok: true, handle, lists: Array.from(byId.values()).slice(0, 80), signedOut: /\/ap\/signin/.test(location.href) }
}

async function scanStorefrontBackground(rawUrl) {
  const url = String(rawUrl || '')
  const hm = url.match(/\/shop\/([^/?#\s]+)/i)
  if (!/amazon\./i.test(url) || !hm) return { ok: false, error: 'bad-url' }
  const full = url + (url.indexOf('#') >= 0 ? '' : '#mvp-sync')
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url: full, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    await _sleep(2500)
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: harvestStorefrontListsInPage })
    const r = (results && results[0] && results[0].result) || null
    if (!r || !r.ok) return { ok: false, error: 'no-result' }
    if (r.signedOut) return { ok: false, error: 'signed-out' }
    // Teach SCOUT the owner handle so later manual storefront visits still sync
    // (matches the content-script behaviour on an #mvp-sync visit).
    if (r.handle) { try { chrome.storage.local.set({ mvpOwnerHandle: r.handle }) } catch (e) {} }
    if (!r.lists || !r.lists.length) return { ok: true, count: 0 }
    const push = await pushIdeaListToMvp({ lists: r.lists })
    return { ok: !!(push && push.ok), count: r.lists.length, error: (push && push.ok) ? undefined : (push && push.error) }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'scan-failed' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// ── Creator Hub VIDEOS: read the creator's video table (each row is tied to a
// product ASIN — the page fetches per-ASIN) and record which products they have
// a video for. Self-contained: collect ASINs on the page, page through, return.
async function harvestCreatorHubVideosInPage(opts) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const vis = (el) => { if (!el || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect(); return (r.width > 0 || r.height > 0) }
  const rClick = (el) => {
    try { el.scrollIntoView({ block: 'center' }) } catch (e) {}
    const o = { bubbles: true, cancelable: true, view: window }
    try { el.dispatchEvent(new MouseEvent('mousedown', o)) } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', o)) } catch (e) {}
    try { el.click() } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('click', o)) } catch (e) {}
  }
  // ASINs on the current page: data-asin attrs, /dp//product/ links, and bare
  // B0-style tokens (Creator Hub rows reference the ASIN even when they show a
  // video title). Paired with the nearest row title where we can find one.
  // Regions that hold products the creator did not put there: the cart sidebar
  // (ewc), the classic cart, and recommendation carousels. Their ASINs are real
  // products and they are nothing to do with this creator's videos, which is how
  // an ice maker and a mattress topper ended up filed as their library.
  const CART_SKIP = '#ewc,[id^=ewc],[class*=ewc-],#sc-active-cart,[class*=sc-list-item],[data-name="Active Items"],#nav-cart,#nav-flyout-ewc,[data-testid*=recommend],[class*=recommend],[id*=similarities],[class*=carousel]'
  const inSkippedRegion = (el) => {
    try { return !!(el && el.closest && el.closest(CART_SKIP)) } catch (e) { return false }
  }
  // A cart link says so in its ref token. This is taken from the live page, not
  // guessed: ref=ewc_pr_img_1 and ref=ewc_title_delete1 are what the sidebar
  // renders.
  const isCartHref = (h) => /[?&#]|\/ref=/.test(h) && /ref=ewc|sc_product|\/gp\/cart/i.test(h)

  function collect(into) {
    document.querySelectorAll('[data-asin]').forEach((el) => {
      if (inSkippedRegion(el)) return
      const a = (el.getAttribute('data-asin') || '').trim().toUpperCase()
      if (/^[A-Z0-9]{10}$/.test(a)) into.set(a, into.get(a) || rowTitle(el))
    })
    document.querySelectorAll('a[href*="/dp/"], a[href*="/product/"]').forEach((a) => {
      if (inSkippedRegion(a)) return
      const href = a.getAttribute('href') || ''
      if (isCartHref(href)) return
      const m = href.match(/\/(?:dp|product)\/([A-Z0-9]{10})/)
      if (m && !into.has(m[1].toUpperCase())) into.set(m[1].toUpperCase(), rowTitle(a))
    })
    // Raw ASIN tokens out of the page HTML are the last resort, not the first.
    // Structured hits (a data-asin attribute, a product link) belong to a row.
    // A bare token in the markup belongs to anything at all, including a
    // recommendation carousel or, as we found out, a shopping cart. So this only
    // runs when the structured passes found almost nothing, which means the page
    // is built in a way we do not understand rather than a page full of products
    // we are about to mislabel.
    if (into.size >= 5) return
    // Same rule for the fallback: strip the cart and carousel regions out of the
    // HTML before scanning it, or the last resort quietly re-imports exactly what
    // the structured passes were careful to skip.
    let root = document.body
    try {
      const clone = document.body.cloneNode(true)
      clone.querySelectorAll(CART_SKIP).forEach((n) => { try { n.remove() } catch (e) {} })
      root = clone
    } catch (e) {}
    const html = root.innerHTML
    const re = /\b(B0[0-9A-Z]{8})\b/g; let mm
    while ((mm = re.exec(html)) !== null) { const a = mm[1].toUpperCase(); if (!into.has(a)) into.set(a, null) }
  }
  function rowTitle(el) {
    const row = el.closest('tr,li,[role="row"],[data-testid]') || el.parentElement
    let t = (row && (row.querySelector('a,h2,h3,[class*=title]') || {}).textContent) || ''
    return (t || '').replace(/\s+/g, ' ').trim().slice(0, 200) || null
  }
  // A fingerprint of what's on screen NOW — the first few ASINs plus the row
  // count. Used to tell when a "Next" click actually loaded a different page
  // (vs. re-rendering the same one). Deliberately does NOT include
  // innerHTML.length: ads/timers change that constantly and would make every
  // page look "changed".
  function sig() {
    // Fingerprint what COLLECT actually sees, not just [data-asin]. The Creator
    // Hub grid does not use that attribute, so this returned the same empty
    // string on every page, every page turn looked like nothing had happened,
    // and the crawl reported "page stopped turning" while the page was turning
    // perfectly well.
    const seen = []
    try {
      document.querySelectorAll('[data-asin]').forEach((e) => {
        const a = (e.getAttribute('data-asin') || '').toUpperCase()
        if (/^[A-Z0-9]{10}$/.test(a)) seen.push(a)
      })
      document.querySelectorAll('a[href*="/dp/"], a[href*="/product/"]').forEach((a) => {
        const m = (a.getAttribute('href') || '').match(/\/(?:dp|product)\/([A-Z0-9]{10})/)
        if (m) seen.push(m[1].toUpperCase())
      })
      if (seen.length < 2) {
        const re = /\b(B0[0-9A-Z]{8})\b/g
        const html = document.body ? document.body.innerHTML : ''
        let mm, n = 0
        while ((mm = re.exec(html)) !== null && n++ < 400) seen.push(mm[1])
      }
    } catch (e) {}
    const uniq = Array.from(new Set(seen))
    return uniq.slice(0, 8).join(',') + '|' + uniq.length
  }
  // Bump a "results per page" dropdown to its max so a 5,000-video account
  // needs far fewer Next clicks (one reload vs. hundreds of page turns).
  function setMaxPageSize() {
    for (const sel of document.querySelectorAll('select')) {
      if (!vis(sel)) continue
      const opts = [...sel.options]
      const nums = opts.map((o) => parseInt(String(o.value || o.textContent || '').replace(/[^0-9]/g, ''), 10)).filter((n) => isFinite(n) && n > 0)
      if (nums.length >= 2 && Math.max(...nums) >= 25 && Math.max(...nums) <= 1000) {
        const max = Math.max(...nums)
        const idx = opts.findIndex((o) => parseInt(String(o.value || o.textContent || '').replace(/[^0-9]/g, ''), 10) === max)
        if (idx >= 0 && sel.selectedIndex !== idx) {
          sel.selectedIndex = idx; sel.value = opts[idx].value
          sel.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        }
      }
    }
    return false
  }
  // A "load more" style control, which is not the same thing as pagination: it
  // appends to the list in place rather than turning a page.
  function findMore() {
    for (const el of document.querySelectorAll('button,a,[role="button"]')) {
      if (!vis(el)) continue
      if (el.hasAttribute && el.hasAttribute('disabled')) continue
      const label = ((el.textContent || '') + ' ' + ((el.getAttribute && el.getAttribute('aria-label')) || '')).replace(/\s+/g, ' ').trim().toLowerCase()
      if (label.length > 24) continue
      if (/\b(load more|show more|see more|view more)\b/.test(label)) return el
    }
    return null
  }
  // Everything clickable, including inside open shadow roots. Amazon's pagination
  // sits at the bottom right of the Creator Hub grid and the old finder walked
  // past it, so this looks in more places and describes what it saw.
  function clickables() {
    const out = []
    const walk = (root, depth) => {
      if (!root || depth > 6) return
      let els = []
      try { els = [...root.querySelectorAll('button,a,[role="button"],[role="link"],li,[aria-label],[class*=pagination] *,[class*=Pagination] *')] } catch (e) { return }
      for (const el of els) {
        out.push(el)
        if (el.shadowRoot) walk(el.shadowRoot, depth + 1)
      }
      try { for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) walk(el.shadowRoot, depth + 1) } } catch (e) {}
    }
    walk(document, 0)
    return out
  }
  const labelOf = (el) => (((el.getAttribute && el.getAttribute('aria-label')) || '') + ' ' + (el.textContent || '')).replace(/\s+/g, ' ').trim().toLowerCase()
  const dead = (el) => {
    if (el.hasAttribute && el.hasAttribute('disabled')) return true
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true
    const cls = (el.className && el.className.toString ? el.className.toString() : '').toLowerCase()
    return /disabled/.test(cls)
  }
  // A structural description of the clickable things in the BOTTOM THIRD of the
  // page, which is where the pager lives. The label-based diagnostic was useless
  // here: it reported "21 items in cart" and a list of video durations, because
  // the pager carries no text at all. Tag, classes, aria-label, title and whether
  // it holds an icon is what actually identifies it.
  function pagerLabels() {
    const out = []
    const cut = Math.max(0, document.body.scrollHeight - Math.max(600, window.innerHeight))
    for (const el of clickables()) {
      if (!vis(el)) continue
      let top = 0
      try { top = el.getBoundingClientRect().top + window.scrollY } catch (e) { continue }
      if (top < cut) continue
      const tag = (el.tagName || '').toLowerCase()
      if (tag !== 'button' && tag !== 'a' && !(el.getAttribute && el.getAttribute('role'))) continue
      const cls = (el.className && el.className.toString ? el.className.toString() : '').slice(0, 40)
      const aria = (el.getAttribute && (el.getAttribute('aria-label') || '')) || ''
      const title = (el.getAttribute && (el.getAttribute('title') || '')) || ''
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20)
      const icon = el.querySelector && el.querySelector('svg,i,[class*=icon]') ? '+icon' : ''
      out.push(`${tag}${cls ? '.' + cls : ''}${aria ? `[${aria}]` : ''}${title ? `{${title}}` : ''}${txt ? ` "${txt}"` : ''}${icon}`)
    }
    return Array.from(new Set(out)).slice(0, 25)
  }
  function findNext() {
    const all = clickables().filter((el) => vis(el) && !dead(el))
    // 1. An explicit next control. The old code capped the label at 20
    //    characters, which threw away Amazon's own "next page, page 2 of 280".
    for (const el of all) {
      const label = labelOf(el)
      if (!label || label.length > 60) continue
      if (/prev/.test(label)) continue
      if (/\bnext\b/.test(label)) return el
      if (/\b(load more|show more|see more|view more)\b/.test(label)) return el
    }
    // 2. A bare arrow glyph.
    for (const el of all) {
      const label = labelOf(el)
      if (label === '›' || label === '→' || label === '»' || label === '>' || label === '❯') return el
    }
    // 3. A pager container. Amazon's control here carries no text, so nothing
    //    label-based will ever find it. Take the last enabled clickable inside
    //    anything that calls itself a pager, which is the next arrow in every
    //    pagination widget ever built.
    let containers = []
    try {
      containers = [...document.querySelectorAll('[class*=pagination i],[class*=Pagination],[class*=pager i],[data-testid*=pagination i],nav[aria-label*=pag i],[role="navigation"]')]
    } catch (e) {}
    for (const box of containers) {
      if (!vis(box)) continue
      const kids = [...box.querySelectorAll('button,a,[role="button"]')].filter((el) => vis(el) && !dead(el))
      if (kids.length < 2) continue
      const last = kids[kids.length - 1]
      if (!/prev/.test(labelOf(last))) return last
    }
    // 4. Numbered pagination with no next button: find the current page and
    //    click the one after it.
    let current = null
    for (const el of all) {
      const cls = (el.className && el.className.toString ? el.className.toString() : '').toLowerCase()
      const isCurrent = (el.getAttribute && (el.getAttribute('aria-current') === 'page' || el.getAttribute('aria-current') === 'true')) || /selected|active|current/.test(cls)
      if (!isCurrent) continue
      const n = parseInt(labelOf(el).replace(/[^0-9]/g, ''), 10)
      if (Number.isFinite(n)) { current = n; break }
    }
    if (current != null) {
      for (const el of all) {
        const l = labelOf(el)
        if (!/^\d+$/.test(l)) continue
        if (parseInt(l, 10) === current + 1) return el
      }
    }
    return null
  }
  async function waitForChange(before, ms) {
    const start = Date.now()
    while (Date.now() - start < ms) {
      await sleep(350)
      if (sig() !== before) { await sleep(400); return true } // settle after the turnover
    }
    return false
  }
  // Refuse to harvest the wrong page.
  //
  // The last run scraped 266 "products with a video" out of the shopping cart:
  // Delete buttons, quantity steppers and recommendation carousels. The
  // collector takes any B0 token in the page HTML, so on the wrong page it
  // returns confident nonsense that then gets written to the database as fact.
  // A scraper with no idea where it is standing is worse than no scraper.
  // Only the cart PAGE is refused, and only by its URL, which cannot be wrong.
  //
  // The previous check looked for cart-like markup anywhere on the page and so
  // refused Manage content, because Amazon renders its cart sidebar (ewc) on it.
  // A cart widget on a page is not a cart page. The fix for a cart widget is to
  // skip it, which is what CART_SKIP below does, not to throw away the page it
  // sits on.
  function looksLikeCart() {
    try { return /\/(gp\/)?cart|\/gp\/aws\/cart/i.test(location.pathname) } catch (e) { return false }
  }
  // There was a looksLikeVideoList() heuristic here and it was the bug. It
  // rejected Manage content, a page carrying 1,320 ASINs and 358 rows, because
  // the wording did not match what I imagined a video list says. The cart guard
  // stays: it is built from a page we actually saw and names things only a cart
  // has. Guessing what the RIGHT page looks like is how a correct page gets
  // thrown away, so that guess is gone.
  await sleep(1500)
  // What this page actually contains, reported whenever the harvest comes back
  // empty. "no-videos" on its own is useless: it cannot tell "your library is
  // empty" from "the rows do not carry ASINs where we look" from "the grid is in
  // an iframe we never reached".
  function probe() {
    const count = (sel) => { try { return document.querySelectorAll(sel).length } catch (e) { return -1 } }
    let b0 = 0
    try {
      const m = (document.body ? document.body.innerHTML : '').match(/\bB0[0-9A-Z]{8}\b/g)
      b0 = m ? m.length : 0
    } catch (e) {}
    let frames = []
    try { frames = [...document.querySelectorAll('iframe')].map((f) => (f.getAttribute('src') || '(no src)').slice(0, 80)).slice(0, 5) } catch (e) {}
    return {
      url: location.href,
      title: (document.title || '').slice(0, 100),
      heading: ((document.querySelector('h1,h2') || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      dataAsin: count('[data-asin]'),
      dpLinks: count('a[href*="/dp/"], a[href*="/product/"]'),
      b0Tokens: b0,
      iframes: frames,
      rows: count('tr,[role="row"],[class*=row]'),
      // Counts told us the products were there and the extractor still returned
      // nothing, which means the values themselves are not what the extractor
      // expects. So show the values. Guessing why a regex fails, against markup
      // nobody has looked at, is what the last four versions were.
      sampleAsins: (() => {
        try {
          return [...document.querySelectorAll('[data-asin]')].slice(0, 6)
            .map((e) => JSON.stringify(e.getAttribute('data-asin'))).join(' ')
        } catch (e) { return '?' }
      })(),
      sampleHrefs: (() => {
        try {
          return [...document.querySelectorAll('a[href*="/dp/"], a[href*="/product/"]')].slice(0, 3)
            .map((a) => (a.getAttribute('href') || '').slice(0, 70)).join('  ')
        } catch (e) { return '?' }
      })(),
      wrongPage: false,
      text: ((document.body ? document.body.innerText : '') || '').replace(/\s+/g, ' ').slice(0, 200),
    }
  }
  if (looksLikeCart()) {
    return {
      ok: true,
      wrongPage: true,
      probe: { ...probe(), wrongPage: true },
      asins: [],
    }
  }

  const map = new Map()
  await sleep(1200)
  // Max out the page size before the first read (fewer round-trips).
  try { if (setMaxPageSize()) { const s = sig(); await waitForChange(s, 6000) } } catch (e) {}
  collect(map)

  // ── infinite scroll ────────────────────────────────────────────────────────
  // The grid has no pagination at all: the last run reported "0 pages, no Next
  // control" after finding 258 of a ~7,000 video library. It loads as you scroll,
  // and it is virtualised, so rows unmount once they leave the viewport. The old
  // code scrolled first and collected once at the end, which threw away every row
  // that had already scrolled past. So: collect on EVERY step, and keep going
  // while either new ASINs or new height keep arriving.
  let scrollStalls = 0
  let lastHeight = 0
  const SCROLL_MAX_MS = 200000
  const scrollStart = Date.now()
  for (let step = 0; step < 1200; step++) {
    if (Date.now() - scrollStart > SCROLL_MAX_MS) break
    const before = map.size
    try { window.scrollTo(0, document.body.scrollHeight) } catch (e) {}
    await sleep(450)
    collect(map)
    // Some grids need a nudge rather than a scroll.
    const more = findMore()
    if (more) { rClick(more); await sleep(900); collect(map) }
    const h = document.body.scrollHeight
    const grew = map.size > before || h > lastHeight
    lastHeight = Math.max(lastHeight, h)
    // Ten quiet rounds, not one. A slow fetch mid-list looks identical to the
    // end of the list for a second or two, and calling it early is exactly the
    // mistake that reported 258 as a final answer.
    scrollStalls = grew ? 0 : scrollStalls + 1
    if (scrollStalls >= 10) break
  }
  try { window.scrollTo(0, 0) } catch (e) {}
  await sleep(600)
  collect(map)

  // Page through EVERY page. The old code stopped the moment a page added no
  // NEW asin — fatal for a creator who re-features products across thousands of
  // videos (the very first repeat page killed the crawl at ~86). Now we advance
  // as long as the page genuinely turns over (sig changes) and a Next control
  // exists; a repeated-product page no longer ends it. Bounded by a wall-clock
  // (so we always return before the message timeout) and a page cap.
  const startedAt = Date.now()
  const MAX_MS = 255000 // ~4¼ min in-page; the message timeout sits above this
  let partial = false
  let pages = 0
  let stopped = 'end'
  let nextHref = null
  for (let page = 0; page < 600; page++) {
    if (Date.now() - startedAt > MAX_MS) { partial = true; stopped = 'out of time'; break }
    const next = findNext()
    // No pagination is normal on this grid: it scrolls. Say that, rather than
    // naming a missing control as though something went wrong.
    if (!next) {
      stopped = pages === 0
        ? `no pagination control found. Controls on the page: ${pagerLabels().join(' | ') || 'none'}`
        : 'end of pages'
      break
    }
    const before = sig()
    rClick(next)
    // A slow page turn is not the end of the list. 8 seconds was enough on a
    // small library and not on a large one, and one unlucky click ended the
    // whole crawl. Now a stall gets a second click and a longer wait before we
    // conclude there is nothing after this page.
    let changed = await waitForChange(before, 15000)
    if (!changed) {
      await sleep(1200)
      rClick(next)
      changed = await waitForChange(before, 15000)
    }
    if (!changed) {
      // Some pagers are plain links that reload the page. Clicking one from a
      // background tab is unreliable; navigating the tab to it is not. Hand the
      // href back and let the worker drive.
      try {
        const href = next.getAttribute && next.getAttribute('href')
        if (href) {
          const abs = new URL(href, location.href).href
          if (abs && abs !== location.href) nextHref = abs
        }
      } catch (e) {}
      stopped = nextHref ? 'pager is a link, handing it to the worker' : 'page stopped turning'
      partial = true
      break
    }
    pages++
    // Some video grids lazy-load rows within a page; scroll to pull them in.
    for (let i = 0; i < 4; i++) { try { window.scrollTo(0, document.body.scrollHeight) } catch (e) {} await sleep(350) }
    collect(map)
  }
  return {
    ok: true,
    partial,
    pages,
    stopped,
    nextHref,
    pagerSeen: pagerLabels(),
    probe: { ...probe(), collected: map.size },
    asins: [...map.entries()].map(([asin, title]) => ({ asin, title })),
    signedOut: /\/ap\/signin/.test(location.href),
  }
}


// Replays Manage content's OWN list request, paginated, inside the page.
//
// Eight versions of DOM scraping produced a shopping cart and a few hundred rows
// off a library of thousands. The page fetches /manage-content/api/get-content-list
// and that answer is complete, ordered and free of cart widgets. This is the same
// move that turned the earnings sync from broken into exact: read what the page
// reads, not what it renders.
//
// The request shape is captured from the page rather than guessed, and the
// pagination key is discovered from the response.
function fetchContentListInPage(rec) {
  return (async () => {
    const out = { items: [], pages: 0, error: null, sample: null, total: null, pageKey: null, queryKeys: null, sizeKey: null }
    const ASIN_RE = /^[A-Z0-9]{10}$/
    // Every object anywhere in the payload that carries an ASIN under an
    // asin-named key. Shape-agnostic on purpose: we have not seen this response.
    // The list's real payload: one record per video, with Amazon's own engagement
    // figures. It carries contentDetail.totalProductCount but never the products
    // themselves, so this reads what is there and the product links come from a
    // second call per video.
    const readVideos = (j, into) => {
      const rows = (j && Array.isArray(j.result)) ? j.result : []
      for (const r of rows) {
        if (!r || typeof r !== 'object') continue
        const d = r.contentDetail || {}
        const m = (Array.isArray(d.mediaList) && d.mediaList[0]) || {}
        const e = d.customerEngagementMetrics || {}
        const aci = d.mediaACI || r.mediaACI || null
        if (!aci || into.has(aci)) continue
        into.set(aci, {
          aci,
          description: d.description || null,
          state: d.state || null,
          program: r.program || null,
          marketplaceId: r.marketplaceId || null,
          durationSec: typeof m.videoDuration === 'number' ? m.videoDuration : null,
          mediaUrl: m.mediaCentralUrl || m.uri || null,
          views: typeof e.totalViews === 'number' ? e.totalViews : null,
          hearts: typeof e.hearts === 'number' ? e.hearts : null,
          avgPctViewed: typeof e.averagePctViewed === 'number' ? e.averagePctViewed : null,
          avgViewSec: typeof e.averageViewDuration === 'number' ? e.averageViewDuration : null,
          productCount: typeof d.totalProductCount === 'number' ? d.totalProductCount : null,
          publishedAtMs: d.versionCreationTimestamp || null,
          modifiedAtMs: d.versionModificationTimestamp || null,
        })
      }
    }

    const harvest = (root, into) => {
      const q = [root]
      let steps = 0
      while (q.length && steps++ < 200000) {
        const n = q.shift()
        if (!n || typeof n !== 'object') continue
        if (Array.isArray(n)) { for (const x of n) q.push(x); continue }
        // A record's title, used for whichever ASINs hang off it. Amazon's video
        // rows carry a description rather than a title.
        let title = null
        for (const k in n) {
          const v = n[k]
          if (typeof v === 'string' && !title && /title|description|name/i.test(k) && v.length > 3) title = v.slice(0, 200)
        }
        for (const k in n) {
          const v = n[k]
          if (!/asin/i.test(k)) continue
          // An ASIN under an asin-named key arrives in three shapes here: a bare
          // string, a list of strings, or an object wrapping a value. Only the
          // first was handled, which is why a payload full of them read as empty.
          const take = (x) => {
            if (typeof x !== 'string') return
            const a = x.toUpperCase()
            if (ASIN_RE.test(a) && !into.has(a)) into.set(a, title)
          }
          if (typeof v === 'string') take(v)
          else if (Array.isArray(v)) for (const x of v) { take(x); if (x && typeof x === 'object') for (const kk in x) take(x[kk]) }
          else if (v && typeof v === 'object') for (const kk in v) take(v[kk])
        }
        for (const k in n) q.push(n[k])
      }
    }
    const found = new Map()
    const videos = new Map()
    let token = null
    let page = 1
    // Learned from the captured URL and the first response, never assumed.
    let tokenKey = null
    let pageKey = null
    let bodyKey = null
    let sizeKey = null
    let pageSize = 10
    try {
      const qk = [...new URL(rec.url, location.href).searchParams.keys()]
      out.queryKeys = `${(rec.method || 'GET').toUpperCase()}${rec.body ? ' with a body' : ' with no body'}, query keys: ${qk.length ? qk.join(', ') : 'none'}`
    } catch (e) {}
    try {
      const u0 = new URL(rec.url, location.href)
      for (const k of u0.searchParams.keys()) {
        if (/token|cursor/i.test(k)) tokenKey = tokenKey || k
        if (/^(page|pageNumber|pageIndex|offset|start)$/i.test(k)) pageKey = pageKey || k
      }
      if (pageKey) page = (parseInt(u0.searchParams.get(pageKey), 10) || 1) + 1
    } catch (e) {}
    try {
      // 6,763 videos at ten a page is 677 requests. The cap has to clear that
      // with room to spare, and a wall clock stops a runaway rather than a low
      // page limit silently truncating the library, which is what "2,010 across
      // 200 pages" was.
      const started = Date.now()
      for (let i = 0; i < 1500; i++) {
        if (Date.now() - started > 240000) { out.error = 'ran out of time before the end of the library'; break }
        const u = new URL(rec.url, location.href)
        // The FIRST call is the page's own request, untouched. Adding parameters
        // an endpoint does not expect is how a working request becomes a 400, and
        // the earnings sync lost a day to exactly that. Pagination is only
        // applied once we have seen a response and know what it uses.
        if (i > 0) {
          if (token) {
            u.searchParams.set(tokenKey || 'nextToken', token)
          } else if (pageKey) {
            u.searchParams.set(pageKey, String(page))
          }
        }
        const init = {
          method: rec.method || 'GET',
          credentials: 'include',
          headers: rec.headers && Object.keys(rec.headers).length ? rec.headers : { accept: 'application/json' },
          signal: AbortSignal.timeout(30000),
        }
        if (rec.body && /^post$/i.test(init.method)) {
          // Pagination lives in the body for a POST. Same rule as the query
          // string: the first call goes out exactly as the page sent it, and a
          // key is only set once we have learned which one moves the window.
          let b = rec.body
          if (i > 0 && (bodyKey || tokenKey)) {
            try {
              const o = JSON.parse(rec.body)
              const set = (obj, key, val) => {
                if (obj && typeof obj === 'object' && key in obj) { obj[key] = val; return true }
                for (const k in obj) {
                  if (obj[k] && typeof obj[k] === 'object' && set(obj[k], key, val)) return true
                }
                return false
              }
              if (token && tokenKey) { if (!set(o, tokenKey, token)) o[tokenKey] = token }
              else if (bodyKey) { if (!set(o, bodyKey, page)) o[bodyKey] = page }
              if (sizeKey) o[sizeKey] = pageSize
              b = JSON.stringify(o)
            } catch (e) { b = rec.body }
          }
          init.body = b
        }
        const res = await fetch(u.toString(), init)
        if (!res.ok) { out.error = `HTTP ${res.status} on page ${i + 1}`; break }
        const j = await res.json().catch(() => null)
        if (!j) { out.error = 'not JSON'; break }
        if (!out.sample) {
          // A raw dump truncates inside the first long description and never
          // reaches the fields that matter. A map of key paths says where an
          // ASIN lives, or proves this response has none, in a fraction of the
          // characters.
          const paths = []
          const walkPaths = (o, prefix, depth) => {
            if (!o || typeof o !== 'object' || depth > 6 || paths.length > 120) return
            if (Array.isArray(o)) { if (o.length) walkPaths(o[0], `${prefix}[0]`, depth + 1); return }
            for (const k in o) {
              const v = o[k]
              const path = prefix ? `${prefix}.${k}` : k
              if (v && typeof v === 'object') walkPaths(v, path, depth + 1)
              else {
                const isAsin = typeof v === 'string' && /^[A-Z0-9]{10}$/.test(v.toUpperCase()) && /^B0/i.test(v)
                paths.push(isAsin ? `${path}=ASIN(${v})` : path)
              }
            }
          }
          try {
            const first = j && Array.isArray(j.result) ? j.result[0] : j
            walkPaths(first, '', 0)
          } catch (e) {}
          // Put anything product-shaped first. The list was printed in document
          // order and cut off mid-word at 700 characters, so an ASIN sitting
          // further down the record would never have been seen.
          const hot = paths.filter((x) => /asin|product|item|catalog/i.test(x))
          const rest = paths.filter((x) => !/asin|product|item|catalog/i.test(x))
          out.sample = `${hot.length ? `PRODUCT FIELDS: ${hot.join(', ')} || ` : 'NO product or asin field in this record. '}all keys: ${rest.join(', ')}`
        }
        // Amazon states the library size. Reading fewer than that is a partial
        // read and must say so rather than passing as the whole library.
        try {
          const t = j && j.metadata && j.metadata.totalResults
          if (Number.isFinite(t)) out.total = t
        } catch (e) {}
        const before = found.size + videos.size
        harvest(j, found)
        readVideos(j, videos)
        out.pages = i + 1

        // Ten per page is Amazon's UI default, not a limit we have to accept.
        // Try once for a bigger window: if it returns more records the whole
        // crawl gets an order of magnitude shorter, and if it does not, nothing
        // is lost but one request.
        if (i === 0 && post && !sizeKey) {
          const got = (j && Array.isArray(j.result)) ? j.result.length : 0
          for (const k of ['pageSize', 'size', 'limit', 'count', 'maxResults', 'numberOfResults']) {
            try {
              const o = JSON.parse(rec.body)
              o[k] = 100
              const probe = await fetch(new URL(rec.url, location.href).toString(), {
                method: rec.method || 'POST', credentials: 'include',
                headers: rec.headers && Object.keys(rec.headers).length ? rec.headers : { accept: 'application/json' },
                body: JSON.stringify(o),
                signal: AbortSignal.timeout(25000),
              })
              if (!probe.ok) continue
              const pj = await probe.json().catch(() => null)
              const n = (pj && Array.isArray(pj.result)) ? pj.result.length : 0
              if (n > got) {
                sizeKey = k
                pageSize = n
                readVideos(pj, videos)
                out.sizeKey = `${k}=${n}`
                break
              }
            } catch (e) { /* try the next name */ }
            await new Promise((r) => setTimeout(r, 150))
          }
        }
        // Stop when a page adds nothing. With a real cursor this is the end; with
        // page numbers it means we have run past the last one.
        if (found.size + videos.size === before) break
        let next = null
        const seek = (o, d) => {
          if (!o || typeof o !== 'object' || d > 6) return
          for (const k in o) {
            if (/nexttoken|nextpagetoken|cursor/i.test(k) && typeof o[k] === 'string' && o[k]) {
              next = o[k]
              if (!tokenKey) tokenKey = k
              return
            }
            seek(o[k], d + 1)
          }
        }
        seek(j, 0)
        if (next && next !== token) token = next
        else if (pageKey || bodyKey) {
          const k = pageKey || bodyKey
          token = null
          page += /^(page|pageNumber|pageIndex)$/i.test(k) ? 1 : (j && Array.isArray(j.result) ? j.result.length : pageSize)
        }
        else {
          // No cursor in the response and no page parameter in the captured URL,
          // yet Amazon says there are thousands of records. So find the parameter
          // by experiment rather than by another round of asking: ask for a
          // window past the first page under each plausible name and keep
          // whichever one actually returns different records.
          const firstAci = (() => {
            try { return (j.result[0].contentDetail || {}).mediaACI || null } catch (e) { return null }
          })()
          const size = (() => { try { return j.result.length || 10 } catch (e) { return 10 } })()
          const candidates = ['startIndex', 'offset', 'start', 'from', 'skip', 'page', 'pageNumber', 'pageIndex', 'nextToken', 'nextPageToken', 'paginationToken']
          const isPageStyle = (k) => /^(page|pageNumber|pageIndex)$/i.test(k)
          let learned = null
          let learnedInBody = false
          const post = !!(rec.body && /^post$/i.test(String(rec.method || '')))
          for (const key of candidates) {
            try {
              const t = new URL(rec.url, location.href)
              let probeBody = rec.body || null
              if (post) {
                // For a POST the key almost certainly belongs in the body, and
                // the body is the page's own, so we only change the one field.
                try {
                  const o = JSON.parse(rec.body)
                  o[key] = isPageStyle(key) ? 2 : size
                  probeBody = JSON.stringify(o)
                } catch (e) { probeBody = rec.body }
              } else {
                t.searchParams.set(key, isPageStyle(key) ? '2' : String(size))
              }
              const probe = await fetch(t.toString(), {
                method: rec.method || 'GET', credentials: 'include',
                headers: rec.headers && Object.keys(rec.headers).length ? rec.headers : { accept: 'application/json' },
                ...(post ? { body: probeBody } : {}),
                signal: AbortSignal.timeout(20000),
              })
              if (!probe.ok) continue
              const pj = await probe.json().catch(() => null)
              const a2 = (() => {
                try { return (pj.result[0].contentDetail || {}).mediaACI || null } catch (e) { return null }
              })()
              // Different first record means the window moved. Same record means
              // the parameter was ignored, which is not an error, just a no.
              if (a2 && firstAci && a2 !== firstAci) {
                learned = key
                learnedInBody = post
                readVideos(pj, videos)
                break
              }
            } catch (e) { /* try the next candidate */ }
            await new Promise((r) => setTimeout(r, 200))
          }
          if (!learned) {
            out.error = `no pagination: response carries no cursor and none of ${candidates.join(', ')} moved the window`
            break
          }
          if (learnedInBody) bodyKey = learned
          else pageKey = learned
          out.pageKey = `${learned}${learnedInBody ? ' (in the request body)' : ''}`
          // Index-style keys count rows, page-style keys count pages.
          page = isPageStyle(learned) ? 3 : size * 2
          pageSize = size
          token = null
        }
        await new Promise((r) => setTimeout(r, 120))
      }
    } catch (e) {
      out.error = (e && e.message) || String(e)
    }
    out.items = [...found.entries()].map(([asin, title]) => ({ asin, title }))
    out.videos = [...videos.values()]
    return out
  })()
}


// Push a batch of the creator's Amazon videos to MVP. Same shape as the other
// pushers: the worker holds the mvpaffiliate.io cookie, the page does not.
async function pushVideoLibraryToMvp(videos, products, aciDone) {
  const origins = ['https://mvpaffiliate.io', 'https://www.mvpaffiliate.io']
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}/api/amazon-videos/ingest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', redirect: 'follow',
        body: JSON.stringify({ videos: videos || [], products: products || [], aciDone: aciDone || [] }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok) return { ok: true, savedVideos: (body && body.savedVideos) || 0, savedProducts: (body && body.savedProducts) || 0 }
      return { ok: false, error: (body && body.error) || `HTTP ${res.status}` }
    } catch (e) { /* try the other origin */ }
  }
  return { ok: false, error: 'could not reach MVP' }
}

// Turns the per-frame probes into one sentence a person can act on, and I can
// debug from, without another round of guessing.
function describeProbe(frames) {
  const parts = []
  for (const f of (frames || [])) {
    const p = f && f.probe
    if (!p) continue
    parts.push([
      p.url ? p.url.slice(0, 90) : '?',
      p.title ? `titled "${p.title}"` : null,
      p.wrongPage ? 'REFUSED as wrong page' : `collected ${p.collected != null ? p.collected : '?'}`,
      `${p.dataAsin} data-asin, ${p.dpLinks} product links, ${p.b0Tokens} ASIN tokens, ${p.rows} rows`,
      p.sampleAsins ? `data-asin values: ${p.sampleAsins}` : null,
      p.sampleHrefs ? `hrefs: ${p.sampleHrefs}` : null,
      p.iframes && p.iframes.length ? `iframes: ${p.iframes.join(' , ')}` : null,
      p.text ? `text starts: ${p.text.slice(0, 120)}` : null,
    ].filter(Boolean).join(' — '))
  }
  return parts.slice(0, 4).join('  ||  ')
}

async function scanCreatorHubVideosBackground(userUrl) {
  // The creator can supply the exact page. Guessing a URL and harvesting
  // whatever loads is how the cart ended up in the database.
  // Creator Studio's Manage content page is the video list. /creatorhub was my
  // guess and it was wrong: it is not the video table, and harvesting it picked
  // up the shopping cart.
  const userGave = /^https:\/\/(www\.)?amazon\.com\//i.test(String(userUrl || ''))
  const url = userGave ? String(userUrl) : 'https://www.amazon.com/manage-content?ref=ive_cp'
  const startedAt = Date.now()
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    // Long enough for the page to fire its own list request, which net-hook then
    // captures. Everything good depends on catching that one call.
    await _sleep(6000)
    // The page's own list API first. Its answer is complete and carries no cart
    // widgets, so the DOM crawl below is now only a fallback for when we cannot
    // capture that request.
    // Prefer a POST with a body: that is the one that can carry pagination. A
    // parameterless GET returns the first page and nothing else, which is exactly
    // where the last two runs stopped.
    const listRecs = (_ccNetRing || []).slice().reverse()
      .filter((x) => x && /\/manage-content\/api\/get-content-list/i.test(String(x.url || '')))
    const apiRec = listRecs.find((x) => x.body && /^post$/i.test(String(x.method || ''))) || listRecs[0]
    // Why the API route did or did not work. The first version fell through to
    // the DOM crawl in silence, so a failing API attempt was indistinguishable
    // from never having tried, and the panel reported a scrape as if that were
    // the plan.
    let apiNote = apiRec ? 'captured the list request' : 'never saw the list request'
    if (apiRec) {
      try {
        const viaApi = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN', func: fetchContentListInPage,
          args: [{ url: apiRec.url, method: apiRec.method || 'GET', headers: apiRec.headers || {}, body: apiRec.body || null }],
        })
        const a = (viaApi && viaApi[0] && viaApi[0].result) || null
        // The video library is the answer now. The list carries every video with
        // Amazon's own engagement on it, which is what says which video is
        // working; the products each one sells come from a second call.
        if (a && a.videos && a.videos.length) {
          const pushed = await pushVideoLibraryToMvp(a.videos, [], [])
          const short = Number.isFinite(a.total) && a.videos.length < a.total
          return {
            ok: !!(pushed && pushed.ok),
            count: a.videos.length,
            pages: a.pages || 0,
            partial: short,
            stopped: a.error
              ? `list API stopped: ${a.error}${a.queryKeys ? `. The captured request's parameters were: ${a.queryKeys}` : ''}`
              : short ? `Amazon reports ${a.total.toLocaleString()} videos and we read ${a.videos.length.toLocaleString()}` : 'end',
            source: `Amazon's own video list${a.pageKey ? ` (paging by ${a.pageKey}${a.sizeKey ? `, ${a.sizeKey} per page` : ''})` : ''}`,
            error: (pushed && pushed.ok) ? undefined : (pushed && pushed.error),
          }
        }
        if (a && a.items && a.items.length) {
          const push = await pushVideosToMvp(a.items)
          // Amazon states the library size in the response. Reporting our count
          // without it lets a partial read pass as the whole library, which is
          // the failure this scanner has repeated all afternoon.
          const short = Number.isFinite(a.total) && a.items.length < a.total
          return {
            ok: !!(push && push.ok),
            count: a.items.length,
            pages: a.pages || 0,
            partial: short,
            stopped: a.error
              ? `list API stopped: ${a.error}`
              : short ? `Amazon reports ${a.total.toLocaleString()} items and we read ${a.items.length.toLocaleString()}` : 'end',
            source: "Amazon's own list API",
            error: (push && push.ok) ? undefined : (push && push.error),
          }
        }
        apiNote = `list API returned nothing${a && a.error ? `: ${a.error}` : ''}${a && a.total ? `, though Amazon reports ${a.total} items` : ''}${a && a.sample ? `. ${String(a.sample).slice(0, 1600)}` : ''}`
      } catch (e) {
        apiNote = `list API call failed: ${(e && e.message) || e}`
      }
      // Do NOT fall back to scraping this page.
      //
      // Capturing the list request proves we are on the right page and that
      // Amazon serves the library properly. If reading it failed, that is a bug
      // to fix, not a reason to go back to the rendered markup, which on this
      // page yields the cart flyout and has written an ice maker into this
      // creator's video library three times today. Returning nothing is the
      // correct outcome; writing something wrong is not.
      return { ok: false, error: 'list-api-empty', probe: apiNote, source: "Amazon's own list API" }
    }

    // allFrames, because an Amazon console panel is often an iframe and the main
    // frame then holds nothing but chrome. Prefer whichever frame actually found
    // products; fall back to the main frame's answer for its diagnostics.
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: harvestCreatorHubVideosInPage,
      // When the creator pasted the URL themselves, do not second-guess the page
      // shape. Only refuse a cart, which is a mistake rather than a preference.
      args: [{ trusted: userGave }],
    })
    const frames = (results || []).map((x) => x && x.result).filter(Boolean)
    let r = frames.slice().sort((a, b) => ((b.asins || []).length - (a.asins || []).length))[0] || null
    if (!r || !r.ok) return { ok: false, error: 'no-result' }
    if (r.signedOut) return { ok: false, error: 'signed-out' }

    // Merge across however many page loads it takes. Everything found so far is
    // kept even if a later page fails, because a partial answer that says it is
    // partial beats losing the lot.
    const merged = new Map()
    const take = (res) => { for (const x of (res.asins || [])) { if (x && /^[A-Z0-9]{10}$/.test(x.asin) && !merged.has(x.asin)) merged.set(x.asin, x.title || null) } }
    take(r)
    let pagesTurned = r.pages || 0
    let stopped = r.stopped || null

    // Link pagination: the in-page crawl cannot follow a full page load, so the
    // worker navigates the tab and re-runs the harvest on each new page.
    let href = r.nextHref || null
    const navStart = Date.now()
    const seenHrefs = new Set()
    while (href && !seenHrefs.has(href) && Date.now() - navStart < 240000) {
      seenHrefs.add(href)
      try {
        await chrome.tabs.update(tabId, { url: href })
        await waitForTabLoad(tabId, 30000)
        await _sleep(2500)
        const next = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true }, func: harvestCreatorHubVideosInPage, args: [{ trusted: userGave }],
        })
        const nr = ((next || []).map((x) => x && x.result).filter(Boolean)
          .sort((a, b) => ((b.asins || []).length - (a.asins || []).length))[0]) || null
        if (!nr || !nr.ok) { stopped = 'a page failed to load'; break }
        const before = merged.size
        take(nr)
        pagesTurned += 1 + (nr.pages || 0)
        stopped = nr.stopped || stopped
        // A page that adds nothing new is not itself the end (a creator can
        // re-feature the same product), but several in a row means we are going
        // in circles.
        if (merged.size === before && seenHrefs.size > 3) { stopped = 'pages stopped adding products'; break }
        href = nr.nextHref || null
      } catch (e) {
        stopped = `navigation failed: ${(e && e.message) || e}`
        break
      }
    }
    r = { ...r, pages: pagesTurned, stopped, partial: r.partial || !!href, pagerSeen: r.pagerSeen }
    const asins = [...merged.entries()].map(([asin, title]) => ({ asin, title }))
    if (!asins.length) {
      // Say what the page held instead of a bare code. This is the difference
      // between "your library is empty" and "the rows do not carry ASINs".
      return { ok: false, error: 'no-videos', probe: `${apiNote}. DOM crawl: ${describeProbe(frames)}` }
    }
    if (!asins.length) return { ok: false, error: 'no-videos' }
    const push = await pushVideosToMvp(asins)
    // What the page's own code asked Amazon for while we were clicking. A DOM
    // crawl of a 7,000 video grid is never going to be reliable; this is how we
    // learn the request to replay instead, the same way the earnings sync was
    // fixed.
    let apiCalls = []
    try {
      apiCalls = Array.from(new Set((_ccNetRing || [])
        .filter((rec) => rec && rec.ts >= startedAt && /amazon\.com/i.test(String(rec.url || '')))
        .map((rec) => { try { return new URL(rec.url, 'https://www.amazon.com').pathname } catch (e) { return String(rec.url).slice(0, 120) } })))
        .slice(0, 8)
    } catch (e) {}
    return {
      ok: !!(push && push.ok),
      count: asins.length,
      partial: !!r.partial,
      pages: r.pages || 0,
      stopped: r.stopped || null,
      pagerSeen: r.pagerSeen || [],
      source: `the page's rendered rows (${apiNote})`,
      apiCalls,
      error: (push && push.ok) ? undefined : (push && push.error),
    }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'scan-failed' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// ── Storefront CATALOG: walk the creator's PUBLIC storefront and record every
// product they feature (past the ~100-row earnings cap). Enumerate the idea
// lists, then open each in the same hidden tab and harvest its product tiles.
// Pushes the full ASIN/title/image set to MVP, which overlays real earnings.
async function scanStorefrontCatalogBackground(rawUrl) {
  const url = String(rawUrl || '')
  const hm = url.match(/\/shop\/([^/?#\s]+)/i)
  if (!/amazon\./i.test(url) || !hm) return { ok: false, error: 'bad-url' }
  const root = url.split('#')[0]
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url: root + '#mvp-sync', active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    await _sleep(2500)
    const seen = new Set(); const products = []
    const addItems = (items, listTitle) => {
      for (const it of (items || [])) {
        if (!it.asin || seen.has(it.asin)) continue
        seen.add(it.asin)
        products.push({ asin: it.asin, title: it.title || null, image: it.image || null, listTitle: listTitle || null })
      }
    }
    // 1) Harvest products shown DIRECTLY on the storefront root — many stores
    //    show their products on the main page and have no /list/ idea-list
    //    shelves at all (harvestIdeaListInPage scrolls + reads [data-asin]).
    try {
      const rootRes = await chrome.scripting.executeScript({ target: { tabId }, func: harvestIdeaListInPage })
      const rr = (rootRes && rootRes[0] && rootRes[0].result) || null
      if (rr && rr.signedOut) return { ok: false, error: 'signed-out' }
      if (rr && rr.items) addItems(rr.items, 'Storefront')
    } catch (e) {}
    // 2) Enumerate idea lists (where most products live) and walk each fully.
    const listRes = await chrome.scripting.executeScript({ target: { tabId }, func: harvestStorefrontListsInPage })
    const lr = (listRes && listRes[0] && listRes[0].result) || null
    if (lr && lr.signedOut) return { ok: false, error: 'signed-out' }
    const allLists = (lr && lr.lists) || []
    const cleanListTitle = (t) => (t || '').replace(/\s*[\d,]+\s*items?$/i, '').replace(/\s+/g, ' ').trim() || null
    // Time-box the walk: a storefront with hundreds of products across many lists
    // can't always finish inside one message-channel window, so we walk lists
    // until the budget runs low, then stop and report `partial`. Every product is
    // upserted, so clicking Import again resumes where the count left off instead
    // of stalling on the root shelf. (Deadline leaves headroom before the 175s
    // handler timeout + the push.)
    const DEADLINE = Date.now() + 150000
    let walked = 0, partial = false
    for (const list of allLists) {
      if (!list || !list.url) continue
      if (Date.now() > DEADLINE) { partial = true; break }
      try {
        await chrome.tabs.update(tabId, { url: list.url })
        await waitForTabLoad(tabId, 30000)
        await _sleep(1000)
        // A dedicated list page can hold hundreds of tiles — give the scroller a
        // bigger budget so a big list loads fully instead of its first screen.
        const iRes = await chrome.scripting.executeScript({ target: { tabId }, func: harvestIdeaListInPage, args: [40] })
        const ir = (iRes && iRes[0] && iRes[0].result) || null
        if (ir && ir.items) addItems(ir.items, cleanListTitle(list.title))
        walked++
      } catch (e) { /* skip a list that won't load */ }
    }
    if (walked < allLists.length) partial = true
    if (!products.length) return { ok: false, error: 'no-products' }
    const push = await pushCatalogToMvp(products)
    return { ok: !!(push && push.ok), count: products.length, lists: walked, partial, error: (push && push.ok) ? undefined : (push && push.error) }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'scan-failed' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// ── Storefront earnings: one-click BACKGROUND sync (the "Load more history"
// button on /storefront calls this). Opens the Amazon Associates report in a
// hidden tab, scrapes the per-ASIN earnings table for the current view AND the
// standard quick-ranges (Last Week / This Month / Last Month), pushes to MVP,
// and closes. Self-contained scraper ported from content.js mvpEarningsScout.
async function harvestEarningsInPage(opts) {
  const currentOnly = !!(opts && opts.currentOnly)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const num = (s) => { const n = parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null }
  const toISO = (s) => { const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }
  function pickPeriod() {
    const txt = document.body.innerText || ''
    const sel = (txt.match(/\b(This Week|Last Week|This Month|Last Month|Year to Date|This Year|Last \d+ Days?)\b/i) || [])[1] || ''
    // 'ytd' = a whole-year view (the creator set "This Year" / "Year to Date").
    // Amazon caps the CSV download at 31 days, but the on-screen per-product
    // table honors the selected range, so reading it is how we get the year.
    let type = /week/i.test(sel) ? 'weekly'
      : /year to date|this year/i.test(sel) ? 'ytd'
      : /month/i.test(sel) ? 'monthly' : ''
    let start = null, end = null
    const m = txt.match(/([A-Z][a-z]{2})\s+(\d{1,2})(?:,?\s*(\d{4}))?\s*(?:-|–|—|to)\s*([A-Z][a-z]{2})\s+(\d{1,2}),?\s*(\d{4})/)
    if (m) { const year = m[6]; start = toISO(`${m[1]} ${m[2]} ${m[3] || year}`); end = toISO(`${m[4]} ${m[5]} ${year}`) }
    // Classify by span when the label was ambiguous: >45d reads as a year view.
    if (!type && start && end) {
      const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000)
      type = days <= 10 ? 'weekly' : days <= 45 ? 'monthly' : 'ytd'
    }
    if (!type) type = 'monthly'
    // A year view with no parseable range on the page → assume calendar YTD.
    if (type === 'ytd' && (!start || !end)) {
      const now = new Date()
      start = `${now.getFullYear()}-01-01`
      end = now.toISOString().slice(0, 10)
    }
    return { type, start, end }
  }
  // Two earnings tables share this report page, one per summary tab:
  //   • Commissions ("Total Earnings" + "Items Shipped Revenue") → source 'scout'
  //   • Creator Connections ("Commission Income" + "Revenue", per campaign) →
  //     source 'creator_connections'
  // They're separate income streams (CC is usually the bigger half), so we tag
  // each row with its source; MVP sums both per ASIN.
  function findEarningsTables() {
    const found = []
    for (const t of document.querySelectorAll('table')) {
      const head = ((t.querySelector('thead') || t).innerText || '').toLowerCase()
      if (/commission income/.test(head)) found.push({ table: t, source: 'creator_connections' })
      else if (/total earnings/.test(head) && /items shipped/.test(head)) found.push({ table: t, source: 'scout' })
    }
    return found
  }
  function colMap(table) {
    const ths = [...table.querySelectorAll('thead th, thead td')]; const map = {}
    ths.forEach((th, i) => {
      // Sortable headers carry a sort caret / icon, so exact-match ("clicks",
      // "items shipped") failed and those columns came through as 0. Strip
      // everything but letters+spaces first, then match on the clean label.
      const h = (th.innerText || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
      if (/\bclicks\b/.test(h) && map.clicks == null) map.clicks = i
      else if (h === 'items shipped revenue' && map.revenue == null) map.revenue = i     // Commissions
      else if (h === 'revenue' && map.revenue == null) map.revenue = i                   // Creator Connections
      else if (h === 'total earnings' && map.commission == null) map.commission = i      // Commissions
      else if (/commission income/.test(h) && map.commission == null) map.commission = i // Creator Connections
      // Units = the "Items Shipped" COUNT, not the Revenue/Earnings columns that
      // start with the same words, and not "Items Returned".
      else if (h === 'items shipped' && map.units == null) map.units = i
    })
    return map
  }
  function scrapeCurrent() {
    const { type, start, end } = pickPeriod(); if (!start || !end) return []
    const out = []
    for (const { table, source } of findEarningsTables()) {
      const map = colMap(table)
      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = [...tr.children]; if (!cells.length) continue
        const asin = (tr.innerHTML.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/) || [])[1]; if (!asin) continue
        const cell = (i) => (i != null && cells[i]) ? (cells[i].innerText || '').trim() : ''
        const link = tr.querySelector('a[href*="/product/"], a[href*="/dp/"]')
        const title = ((link && (link.getAttribute('title') || link.textContent)) || '').trim().slice(0, 300)
        const rec = { asin, periodType: type, periodStart: start, periodEnd: end, source }
        if (title) rec.productTitle = title
        if (map.revenue != null) rec.revenue = num(cell(map.revenue))
        if (map.commission != null) rec.commission = num(cell(map.commission))
        if (map.units != null) rec.units = num(cell(map.units))
        if (map.clicks != null) rec.clicks = num(cell(map.clicks))
        if (rec.revenue == null && rec.commission == null && rec.units == null) continue
        out.push(rec)
      }
    }
    return out
  }
  // Visibility WITHOUT offsetParent — offsetParent is null for position:fixed /
  // sticky elements (Amazon's pager can be pinned), which made us skip a Next
  // button that's plainly on screen. Use the layout box instead.
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false
    const r = el.getBoundingClientRect()
    return (r.width > 0 || r.height > 0)
  }
  // Fire a real click sequence — some SPA buttons ignore a bare .click() and
  // only respond to pointer/mouse events.
  function robustClick(el) {
    try { el.scrollIntoView({ block: 'center' }) } catch (e) {}
    const opts = { bubbles: true, cancelable: true, view: window }
    try { el.dispatchEvent(new MouseEvent('pointerdown', opts)) } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)) } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)) } catch (e) {}
    try { el.click() } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('click', opts)) } catch (e) {}
  }
  // Click a summary tab / control by its visible text (used to reveal the CC
  // earnings table without changing the date range). Returns true if clicked.
  function clickByText(label) {
    for (const el of document.querySelectorAll('a,button,[role="button"],[role="tab"],span,li,label')) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (t.toLowerCase() === label.toLowerCase() && visible(el)) { robustClick(el); return true }
    }
    return false
  }
  // Amazon paginates the per-product report (a "25 results per page" dropdown +
  // "Prev / Next →" buttons), so a single scrape only sees page 1. Bump the page
  // size to its max first (fewer round-trips), then advance with Next.
  function setMaxPageSize() {
    for (const sel of document.querySelectorAll('select')) {
      if (!visible(sel)) continue
      const opts = [...sel.options]
      const nums = opts.map((o) => parseInt(String(o.value || o.textContent || '').replace(/[^0-9]/g, ''), 10)).filter((n) => isFinite(n) && n > 0)
      // A "results per page" select: several numeric options, all sane sizes.
      if (nums.length >= 2 && Math.max(...nums) >= 50 && Math.max(...nums) <= 1000) {
        const max = Math.max(...nums)
        const idx = opts.findIndex((o) => parseInt(String(o.value || o.textContent || '').replace(/[^0-9]/g, ''), 10) === max)
        if (idx >= 0 && sel.selectedIndex !== idx) {
          sel.selectedIndex = idx
          sel.value = opts[idx].value
          sel.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        }
      }
    }
    return false
  }
  function findNextPageControl() {
    for (const el of document.querySelectorAll('button,a,[role="button"],li[role="button"],[aria-label]')) {
      if (!visible(el)) continue
      if (el.hasAttribute && el.hasAttribute('disabled')) continue
      if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') continue
      const cls = (el.className && el.className.toString ? el.className.toString() : '').toLowerCase()
      if (/disabled/.test(cls)) continue
      const label = (((el.getAttribute && el.getAttribute('aria-label')) || '') + ' ' + (el.textContent || '')).replace(/\s+/g, ' ').trim().toLowerCase()
      // Match the pager "Next" (renders as "Next →") but not longer unrelated
      // text; also accept a bare arrow. Skip "previous"/"prev".
      if (/prev/.test(label)) continue
      if ((/\bnext\b/.test(label) && label.length <= 16) || label === '›' || label === '→' || label === '»') return el
    }
    return null
  }
  const seen = new Set(); const all = []
  const add = (rows) => { for (const r of rows) { const k = r.asin + '|' + r.periodType + '|' + r.periodStart + '|' + (r.source || 'scout'); if (!seen.has(k)) { seen.add(k); all.push(r) } } }
  // Scrape the current view, then page through the rest of the table so we
  // capture EVERY product, not just the first ~25. Stops when a page adds no
  // new rows or there's no enabled Next control (bounded so it can't spin).
  // A fingerprint of the rows currently on screen (first ASINs of each table),
  // so we can tell when a Next click has actually loaded the next page rather
  // than guessing with a fixed delay.
  function tableSignature() {
    let sig = ''
    for (const { table } of findEarningsTables()) {
      const trs = table.querySelectorAll('tbody tr')
      for (let i = 0; i < Math.min(4, trs.length); i++) {
        sig += (trs[i].innerHTML.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/) || [])[1] || ''
      }
      sig += '#' + trs.length
    }
    return sig
  }
  async function waitForTableChange(prevSig, ms) {
    const start = Date.now()
    while (Date.now() - start < ms) {
      await sleep(300)
      if (tableSignature() !== prevSig) { await sleep(400); return true } // settle after change
    }
    return false
  }
  async function scrapeAllPages() {
    // Bump "results per page" to its max first — one reload, far fewer clicks.
    try { if (setMaxPageSize()) { const s = tableSignature(); await waitForTableChange(s, 6000) } } catch (e) {}
    add(scrapeCurrent())
    let last = all.length
    for (let page = 0; page < 120; page++) {
      const next = findNextPageControl()
      if (!next) break
      const prevSig = tableSignature()
      robustClick(next)
      // Wait until the table actually turns over (next page can take a few
      // seconds to fetch); if it never changes, we're on the last page.
      const changed = await waitForTableChange(prevSig, 8000)
      if (!changed) break
      add(scrapeCurrent())
      if (all.length === last) break // safety: no genuinely new rows
      last = all.length
    }
  }
  // Give the SPA a beat, then scrape the current view. In currentOnly mode we
  // read the range the creator already set (e.g. "This Year") and DON'T touch
  // the date range — but we DO click the "Creator Connections" summary tab to
  // reveal that table (the tab switch keeps the selected date range), so one
  // sync captures both commissions AND CC. Then click back to Commissions.
  // Read Amazon's SUMMARY numbers — the real totals for the whole period, not
  // just the ~100 rows the product table caps at. The per-product table can't
  // page past 100 from an extension, so these summary figures are what makes the
  // storefront headline correct. Source = which tab is showing (CC table present
  // → creator_connections, else the regular Commissions summary).
  function readSummaryTotals() {
    const txt = (document.body.innerText || '').replace(/ /g, ' ')
    const { type, start, end } = pickPeriod()
    if (!start) return null
    const source = findEarningsTables().some((t) => t.source === 'creator_connections') ? 'creator_connections' : 'scout'
    // For each metric take the LARGEST value that follows its label anywhere on
    // the page. The summary total is always bigger than any single product row
    // (or a chart-legend label with no nearby number), so max-after-label lands
    // the summary figure without needing the exact DOM layout.
    const maxAfter = (labelSrc, currency) => {
      const re = new RegExp(labelSrc + (currency ? '[\\s\\S]{0,30}?\\$\\s*([\\d,]+\\.\\d{2})' : '[\\s\\S]{0,25}?([\\d][\\d,]{0,11})'), 'gi')
      let m, best = null
      while ((m = re.exec(txt)) !== null) {
        const v = parseFloat(m[1].replace(/,/g, ''))
        if (isFinite(v) && (best == null || v > best)) best = v
      }
      return best
    }
    const earnings = maxAfter('Total Earnings', true)
    const revenue = maxAfter('Total Revenue', true)
    const units = maxAfter('Shipped Items', false)
    const clicks = maxAfter('Clicks', false)
    if (earnings == null && revenue == null) return null
    return { source, periodType: type, periodStart: start, periodEnd: end, earnings, revenue, units, clicks }
  }
  const totals = []
  const addTotal = (t) => { if (t) { const k = t.source + '|' + t.periodType + '|' + t.periodStart; if (!totals.some((x) => (x.source + '|' + x.periodType + '|' + x.periodStart) === k)) totals.push(t) } }

  await sleep(500)
  // Scrape whatever earnings tables are on the current view, paging through the
  // WHOLE table (not just the first ~25). scrapeCurrent reads BOTH the
  // Commissions and Creator Connections tables if the page has them rendered,
  // so the creator syncs once per summary tab to capture both. (We deliberately
  // don't auto-click the "Creator Connections" tab: that text also matches the
  // top-nav link, which navigated the whole report away.)
  await scrapeAllPages()
  addTotal(readSummaryTotals())
  if (!currentOnly) {
    for (const label of ['Last Week', 'This Month', 'Last Month']) {
      try {
        let clicked = false
        for (const el of document.querySelectorAll('a,button,[role="button"],[role="tab"],span,li,label')) {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
          if (t.toLowerCase() === label.toLowerCase() && el.offsetParent !== null) { el.click(); clicked = true; break }
        }
        if (clicked) { await sleep(2800); await scrapeAllPages(); addTotal(readSummaryTotals()) }
      } catch (e) {}
    }
  }
  return { ok: true, rows: all, totals, signedOut: /\/ap\/signin/.test(location.href) }
}

async function scanStorefrontEarningsBackground() {
  // Amazon's live earnings report (Commissions + Creator Connections tabs). The
  // legacy /home/reports path no longer renders the per-product table, so a
  // background scan there found nothing and surfaced as "Couldn't read your
  // report". Open the current report URL instead.
  const url = 'https://affiliate-program.amazon.com/p/reporting/earnings'

  // PRIMARY: read a reports tab the creator already has open. Amazon caps the
  // CSV download at 31 days, but the on-screen per-product table honors the
  // selected range — so if the creator set "This Year" + grouped by Linked
  // Product, reading THAT tab captures the whole year in one pass. We scrape
  // current-view-only so we never disturb their selection.
  try {
    // Match either report URL: the classic /home/reports and the newer
    // /p/reporting/earnings (where the Commissions + Creator Connections tabs live).
    const tabs = [
      ...(await chrome.tabs.query({ url: 'https://affiliate-program.amazon.com/home/reports*' })),
      ...(await chrome.tabs.query({ url: 'https://affiliate-program.amazon.com/p/reporting/earnings*' })),
    ]
    const open = (tabs || []).find((t) => t && t.id != null)
    if (open) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: open.id }, func: harvestEarningsInPage, args: [{ currentOnly: true }],
      })
      const r = (results && results[0] && results[0].result) || null
      if (r && r.ok && !r.signedOut && ((r.rows && r.rows.length) || (r.totals && r.totals.length))) {
        const push = await pushEarningsToMvp(r.rows, r.totals)
        return { ok: !!(push && push.ok), count: (r.rows && r.rows.length) || 0, upserted: push && push.upserted, error: (push && push.ok) ? undefined : (push && push.error) }
      }
      if (r && r.signedOut) return { ok: false, error: 'signed-out' }
      // Open tab had no table yet (still loading, or a non-report sub-page) —
      // fall through to the background scan.
    }
  } catch (e) { /* fall through to background scan */ }

  // FALLBACK: no usable open tab — open our own background tab. This lands on
  // Amazon's default range (recent period), so it can't reach the full year;
  // it's the best-effort path when the creator hasn't opened the report.
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    await _sleep(3500) // the report SPA needs time to render the table
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: harvestEarningsInPage })
    const r = (results && results[0] && results[0].result) || null
    if (!r || !r.ok) return { ok: false, error: 'no-result' }
    if (r.signedOut) return { ok: false, error: 'signed-out' }
    if ((!r.rows || !r.rows.length) && (!r.totals || !r.totals.length)) return { ok: true, count: 0 }
    const push = await pushEarningsToMvp(r.rows, r.totals)
    return { ok: !!(push && push.ok), count: (r.rows && r.rows.length) || 0, upserted: push && push.upserted, error: (push && push.ok) ? undefined : (push && push.error) }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'scan-failed' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CC CATALOG AUTO-REFRESH — replace the weekly manual CSV upload.
//
// Amazon's Creator Connections page has two native "Download all …" buttons
// (available opportunities + accepted campaigns) that, after a server-side
// build, deliver a ZIP of CSV parts. Today the admin downloads both by hand,
// unzips, and loads the CSVs into the shared catalog staging table. SCOUT does
// the same, hands-off: clicks each button in a background tab, captures the ZIP
// via chrome.downloads, unzips + parses it IN THE WORKER (Chrome 114+ ships
// DecompressionStream('deflate-raw'), so no library), POSTs the rows to the
// existing /api/admin/import-cc-catalog/stage endpoint, and arms the background
// drain. One admin operation → the whole user base gets the refreshed catalog.
//
// Everything below is self-contained worker code. The only page interaction is
// clicking a tab + a download button (clickCcDownloadInPage).
// ════════════════════════════════════════════════════════════════════════════

const CC_REQUESTS_URL = 'https://affiliate-program.amazon.com/p/connect/requests'

// Inflate a raw-DEFLATE byte array (ZIP method 8) using the platform stream.
async function _inflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Response(u8).body.pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

// Minimal ZIP reader: walk the central directory and return [{name, text}] for
// every entry. Handles stored (method 0) + deflate (method 8); bails clearly on
// ZIP64 (sizes we can't represent here). Enough for Amazon's CSV export ZIPs.
async function _unzipToTexts(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  const dv = new DataView(arrayBuffer)
  // Find End Of Central Directory (sig 0x06054b50), scanning back from the end.
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65536; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip (no EOCD)')
  const cdCount = dv.getUint16(eocd + 10, true)
  let cdOffset = dv.getUint32(eocd + 16, true)
  const out = []
  let p = cdOffset
  for (let n = 0; n < cdCount; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break // central dir header
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const fnLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOff = dv.getUint32(p + 42, true)
    if (compSize === 0xffffffff || localOff === 0xffffffff) throw new Error('zip64 not supported')
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + fnLen))
    // Jump to the local header to find where the data actually starts.
    if (dv.getUint32(localOff, true) === 0x04034b50) {
      const lFnLen = dv.getUint16(localOff + 26, true)
      const lExtraLen = dv.getUint16(localOff + 28, true)
      const dataStart = localOff + 30 + lFnLen + lExtraLen
      const comp = bytes.subarray(dataStart, dataStart + compSize)
      let raw
      if (method === 0) raw = comp
      else if (method === 8) raw = await _inflateRaw(comp)
      else throw new Error('unsupported zip method ' + method)
      if (/\.csv$/i.test(name)) out.push({ name, text: new TextDecoder('utf-8').decode(raw) })
    }
    p += 46 + fnLen + extraLen + commentLen
  }
  return out
}

// RFC-4180-ish CSV parser → array of {header: value} objects. Handles quoted
// fields, embedded commas/newlines, and doubled-quote escapes.
function _parseCsv(text) {
  const rows = []
  let field = '', row = [], inQ = false
  // Strip a UTF-8 BOM so the first header doesn't carry it.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* swallow — \r\n handled by the \n */ }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  if (!rows.length) return { headers: [], objects: [] }
  const headers = rows[0].map(h => (h || '').trim())
  const objects = []
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === '') continue // blank line
    const o = {}
    for (let c = 0; c < headers.length; c++) o[headers[c]] = rows[r][c]
    objects.push(o)
  }
  return { headers, objects }
}

// Map a CSV row (unknown Amazon header names) onto the staging schema keys the
// /stage endpoint expects. Header matching is fuzzy (lowercased, alnum-only)
// with alias lists, so small header wording changes don't break the import.
const _CC_FIELD_ALIASES = {
  campaign_id: ['campaignid', 'campaign', 'id'],
  campaign_name: ['campaignname', 'campaigntitle', 'name', 'title'],
  brand_name: ['brandname', 'brand'],
  asins: ['asins', 'asin', 'asinlist', 'products', 'productasins'],
  commission_pct: ['commission', 'commissionpct', 'commissionpercent', 'commissionpercentage', 'commissionrate'],
  starts_at: ['startdate', 'startsat', 'start', 'begins', 'begindate'],
  ends_at: ['enddate', 'endsat', 'end', 'expires', 'expiration', 'expirationdate'],
  budget: ['budget', 'totalbudget', 'campaignbudget'],
  budget_remaining: ['budgetremaining', 'remainingbudget', 'remaining'],
  available_slot: ['availableslots', 'slotsavailable', 'availableslot', 'openslots', 'slotsremaining'],
  total_slot: ['totalslots', 'slots', 'slottotal', 'maxslots'],
}
const _ccNorm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

// Build header→field lookup once per CSV (headers are stable across rows).
function _ccHeaderMap(headers) {
  const map = {} // field → header
  const normd = headers.map(h => ({ h, n: _ccNorm(h) }))
  for (const field of Object.keys(_CC_FIELD_ALIASES)) {
    const aliases = _CC_FIELD_ALIASES[field]
    // Exact normalized match first, then contains.
    let hit = normd.find(x => x.n === field || aliases.includes(x.n))
    if (!hit) hit = normd.find(x => aliases.some(a => x.n === a))
    if (!hit) hit = normd.find(x => aliases.some(a => x.n.includes(a)))
    if (hit) map[field] = hit.h
  }
  return map
}

function _ccMapRow(obj, headerMap) {
  const get = (field) => { const h = headerMap[field]; return h == null ? undefined : obj[h] }
  const asinCell = get('asins')
  let asins = []
  if (asinCell != null) {
    asins = String(asinCell)
      .replace(/[{}\[\]"']/g, ' ')
      .split(/[,;|\s]+/)
      .map(a => a.trim().toUpperCase())
      .filter(a => /^[A-Z0-9]{10}$/.test(a))
    asins = Array.from(new Set(asins))
  }
  return {
    campaign_id: get('campaign_id'),
    campaign_name: get('campaign_name'),
    brand_name: get('brand_name'),
    asins,
    commission_pct: get('commission_pct'),
    starts_at: get('starts_at'),
    ends_at: get('ends_at'),
    budget: get('budget'),
    budget_remaining: get('budget_remaining'),
    available_slot: get('available_slot'),
    total_slot: get('total_slot'),
  }
}

// POST staged rows to MVP in chunks (session-cookie bridge; the endpoint is
// admin-gated). reset:true on the very first chunk clears staging.
async function stageCcRowsToMvp(rows, resetFirst) {
  const CHUNK = 2000
  let inserted = 0, reset = !!resetFirst
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const res = await fetch(`${MVP_ORIGIN}/api/admin/import-cc-catalog/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ rows: chunk, reset }),
    })
    reset = false // only the first request resets
    let body = null; try { body = await res.json() } catch (e) {}
    if (!res.ok) return { ok: false, inserted, status: res.status, error: (body && body.error) || `HTTP ${res.status}` }
    inserted += (body && body.inserted) || 0
  }
  return { ok: true, inserted }
}

// Arm the server-side background drain (merge → purge) once staging is loaded.
async function armCcDrainOnMvp() {
  try {
    const res = await fetch(`${MVP_ORIGIN}/api/admin/import-cc-catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ mode: 'background' }),
    })
    let body = null; try { body = await res.json() } catch (e) {}
    if (res.ok) return { ok: true, message: body && body.message }
    return { ok: false, status: res.status, error: (body && body.error) || `HTTP ${res.status}`, needsConfirm: !!(body && body.needsConfirm) }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'network error' }
  }
}

// In-page: get to the view that has the bulk-export button. The CC page opens on
// the "Sponsored Products for Creators" tab by default, but the "Download all …"
// buttons live under "Affiliate+ campaigns" → its New Opportunities / Active
// sub-tab. So we click Affiliate+ first, let it load, then the sub-tab. Async so
// the two clicks are correctly ordered within one injection. Best-effort.
async function ccSelectTabInPage(which) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const pick = (match) => {
    const els = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="button"], span, div, li'))
    const cands = els.filter(el => { const t = norm(el.textContent); return t.length < 60 && match(t) })
    cands.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)
    return cands[0] || null
  }
  const click = (el) => { if (!el) return false; try { (el.closest('button, a, [role="tab"], [role="button"], li') || el).click(); return true } catch (e) { return false } }
  // 1) Top-level: Affiliate+ campaigns (the tab that actually offers the full
  //    catalog export). The '+' survives normalization.
  const onAffiliate = click(pick(t => t === 'affiliate+ campaigns' || (t.includes('affiliate+') && t.includes('campaign'))))
  await sleep(1800) // let the Affiliate+ view + its sub-tabs render
  // 2) Sub-tab: New Opportunities (available) or Active (accepted).
  const wantSub = which === 'accepted' ? 'active' : 'new opportunities'
  const onSub = click(pick(t => t === wantSub))
  return { onAffiliate, onSub, url: location.href.slice(0, 140) }
}

// In-page: find the "Download all …" button. If doClick, click it. ALWAYS
// returns rich diagnostics (what download-ish text was on the page, and the
// campaigns count the header shows) so a miss is debuggable from MVP. Matching
// is contains-based (not exact) and picks the most specific element, so extra
// icons/wrappers/whitespace don't hide the button. `which` = available|accepted.
function ccDownloadButtonInPage(which, doClick) {
  const word = which === 'accepted' ? 'accepted' : 'available'
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()
  // Match on visible text OR aria-label/title (some controls label via attrs).
  const label = (el) => {
    const t = norm(el.textContent)
    if (t) return t
    try { return norm(el.getAttribute('aria-label') || el.getAttribute('title') || '') } catch (e) { return '' }
  }
  const all = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], [onclick]'))
  // The real export: "download all <available|accepted> campaigns", NOT the
  // post-click "preparing download for all … campaigns" state.
  const isExport = (t) => t.includes('download all') && t.includes('campaign') && t.includes(word) && !t.includes('preparing')
  let cands = all.filter(el => isExport(label(el)))
  // Fallback: any "download all … campaigns" (in case the word ordering shifts).
  if (!cands.length) cands = all.filter(el => { const t = label(el); return t.includes('download all') && t.includes('campaign') && !t.includes('preparing') })
  cands.sort((a, b) => label(a).length - label(b).length)
  const btn = cands[0]
  const present = !!btn
  let clicked = false
  if (present && doClick) {
    try { btn.scrollIntoView({ block: 'center' }) } catch (e) {}
    try {
      const target = btn.closest('button, a, [role="button"]') || btn
      target.click(); clicked = true
    } catch (e) {}
  }
  // Rich diagnostics: every clickable whose label mentions download/export.
  const seen = []
  for (const el of all) { const t = label(el); if (t && (t.includes('download') || t.includes('export')) && t.length < 90) seen.push(t) }
  const bodyText = document.body ? document.body.innerText : ''
  return {
    present, clicked,
    url: location.href.slice(0, 160),
    sawDownload: Array.from(new Set(seen)).slice(0, 12),
    campaignsCount: (bodyText.match(/campaigns\s*\(([\d,]+)\)/i) || [])[1] || null,
    hasIframe: document.querySelectorAll('iframe').length,
    signedOut: /\/ap\/signin/.test(location.href),
  }
}

// Wait for a ZIP download to appear after we click, capture its URL, fetch the
// bytes ourselves (so nothing depends on reading the user's disk), then clean up
// the on-disk file. `triggerFn` performs the in-page click. Generation can take
// minutes, so the wait is generous.
async function captureCcDownload(tabId, which, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 300000)
  // Register the listener BEFORE clicking so we never miss a fast download.
  let resolved = null
  const onCreated = (item) => {
    const u = (item && (item.finalUrl || item.url)) || ''
    const fn = (item && item.filename) || ''
    // Heuristic match: a zip, or a filename that smells like a campaign export.
    if (/\.zip($|\?)/i.test(u) || /\.zip$/i.test(fn) || /campaign/i.test(fn) || /campaign/i.test(u)) {
      if (!resolved) resolved = { id: item.id, url: u }
    }
  }
  try { chrome.downloads.onCreated.addListener(onCreated) } catch (e) { return { ok: false, error: 'no-downloads-permission' } }

  // Select the correct tab, then POLL for the download button to appear — the
  // Creator Connections grid holds hundreds of thousands of campaigns and can
  // take a while to render (longer in a throttled background tab), so the button
  // simply isn't there for the first many seconds. We poll up to 2 minutes,
  // re-selecting the tab periodically, and only click once it's actually present.
  try { await chrome.scripting.executeScript({ target: { tabId }, func: ccSelectTabInPage, args: [which] }) } catch (e) {}
  await _sleep(4000)
  // One loop that (a) keeps trying to click the export button until it clicks,
  // AND (b) waits for a download to appear. We DON'T bail when the button can't
  // be clicked: Amazon flips the button to "Preparing download…" once triggered
  // (by us or a prior run) and builds the file for minutes, so the file can
  // still arrive even when the button text no longer matches. We only fail if
  // NO download shows up by the deadline.
  let lastDiag = null, clickedOk = false, tick = 0
  while (Date.now() < deadline && !resolved) {
    if (!clickedOk) {
      try {
        const r = await chrome.scripting.executeScript({ target: { tabId }, func: ccDownloadButtonInPage, args: [which, true] })
        lastDiag = (r && r[0] && r[0].result) || lastDiag
        if (lastDiag && lastDiag.signedOut) {
          try { chrome.downloads.onCreated.removeListener(onCreated) } catch (e) {}
          return { ok: false, error: 'signed-out (open Amazon Creator Connections and sign in, then retry)', diag: lastDiag }
        }
        if (lastDiag && lastDiag.clicked) clickedOk = true
      } catch (e) { /* tab still loading — keep polling */ }
      // Re-assert the tab selection every ~15s until we've clicked.
      if (!clickedOk && ++tick % 5 === 0) { try { await chrome.scripting.executeScript({ target: { tabId }, func: ccSelectTabInPage, args: [which] }) } catch (e) {} }
    }
    await _sleep(3000)
  }
  try { chrome.downloads.onCreated.removeListener(onCreated) } catch (e) {}
  if (!resolved) {
    return {
      ok: false,
      error: clickedOk
        ? 'export-never-delivered (clicked the button, but no file arrived in time)'
        : 'download-button-not-found (grid never showed the export button)',
      diag: lastDiag,
    }
  }

  // Wait for completion.
  const id = resolved.id
  while (Date.now() < deadline) {
    const items = await new Promise(res => { try { chrome.downloads.search({ id }, res) } catch (e) { res([]) } })
    const it = items && items[0]
    if (it && it.state === 'complete') { if (it.finalUrl || it.url) resolved.url = it.finalUrl || it.url; break }
    if (it && it.state === 'interrupted') return { ok: false, error: 'download-interrupted' }
    await _sleep(1500)
  }

  // Fetch the bytes ourselves (host_permissions cover the export origin). Then
  // remove the on-disk copy so we don't litter the admin's Downloads folder.
  let buf = null, fetchErr = null
  try {
    const res = await fetch(resolved.url, { credentials: 'include' })
    if (!res.ok) fetchErr = `HTTP ${res.status}`
    else buf = await res.arrayBuffer()
  } catch (e) { fetchErr = (e && e.message) || 'fetch-failed' }
  try { chrome.downloads.removeFile(id, () => { void chrome.runtime.lastError }) } catch (e) {}
  try { chrome.downloads.erase({ id }) } catch (e) {}
  if (!buf) return { ok: false, error: 'zip-fetch-failed: ' + (fetchErr || 'unknown') + ' (url host: ' + _urlHost(resolved.url) + ')', url: resolved.url }
  return { ok: true, buf }
}

function _urlHost(u) { try { return new URL(u).host } catch (e) { return '?' } }

// Download → unzip → parse → map, for one CC export ('available' | 'accepted').
async function harvestCcExport(tabId, which, timeoutMs) {
  const cap = await captureCcDownload(tabId, which, timeoutMs)
  if (!cap.ok) return { ok: false, which, error: cap.error, diag: cap.diag }
  let csvs
  try { csvs = await _unzipToTexts(cap.buf) } catch (e) { return { ok: false, which, error: 'unzip-failed: ' + ((e && e.message) || e) } }
  if (!csvs.length) return { ok: false, which, error: 'zip-had-no-csv' }
  const rows = []
  let headers = null, headerMap = null, sample = null
  for (const csv of csvs) {
    const parsed = _parseCsv(csv.text)
    if (!parsed.objects.length) continue
    const hm = _ccHeaderMap(parsed.headers)
    if (!headers) { headers = parsed.headers; headerMap = hm }
    for (const o of parsed.objects) { const m = _ccMapRow(o, hm); if (!sample) sample = m; rows.push(m) }
  }
  return { ok: true, which, rows, headers, headerMap, sample, files: csvs.map(c => c.name) }
}

// Full orchestration: both exports → staging → arm drain. Background tab, closed
// at the end. Returns a rich summary so the MVP UI (and we) can verify mapping.
async function scanCcCatalogBackground() {
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url: CC_REQUESTS_URL, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 40000)
    await _sleep(5000) // the CC requests SPA is heavy — let the grid + buttons render

    // 1) Available opportunities (the big one). ~6 min budget for generation.
    const avail = await harvestCcExport(tabId, 'available', 360000)
    // 2) Accepted campaigns.
    const accepted = await harvestCcExport(tabId, 'accepted', 300000)

    if (!avail.ok && !accepted.ok) {
      return { ok: false, error: 'both exports failed', available: _ccSumm(avail), accepted: _ccSumm(accepted) }
    }

    // Stage: available first (reset clears staging), accepted appended.
    let staged = 0, stageErr = null, didReset = false
    if (avail.ok && avail.rows.length) {
      const s = await stageCcRowsToMvp(avail.rows, true); didReset = true
      if (s.ok) staged += s.inserted; else stageErr = 'available: ' + s.error
    }
    if (accepted.ok && accepted.rows.length && !stageErr) {
      const s = await stageCcRowsToMvp(accepted.rows, !didReset)
      if (s.ok) staged += s.inserted; else stageErr = 'accepted: ' + s.error
    }
    if (stageErr) return { ok: false, error: 'staging failed — ' + stageErr, staged, available: _ccSumm(avail), accepted: _ccSumm(accepted) }

    // Arm the background drain (merge → purge overnight). The endpoint's own
    // 85%-staged safety guard refuses to merge if a bad parse staged too few
    // rows, so a mapping mistake fails safe instead of wiping the live catalog.
    const armed = await armCcDrainOnMvp()

    return {
      ok: true,
      staged,
      armed: armed.ok,
      armMessage: armed.message,
      armError: armed.ok ? undefined : armed.error,
      needsConfirm: armed.needsConfirm,
      available: _ccSumm(avail),
      accepted: _ccSumm(accepted),
    }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'cc-catalog-scan-failed' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// Compact per-export summary for the response (verify mapping without dumping
// hundreds of thousands of rows).
function _ccSumm(r) {
  if (!r) return null
  if (!r.ok) return { ok: false, error: r.error, diag: r.diag }
  return { ok: true, rows: r.rows.length, files: r.files, headers: r.headers, headerMap: r.headerMap, sample: r.sample }
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

// ── Cross-marketplace ASIN existence check (MVP_AMZ_ASIN_CHECK) ──────────────
// Video Launchpad's geo check needs to know if a product is listed on a given
// Amazon marketplace. Keepa answers this for its supported domains, but a few
// (e.g. amazon.com.au — Keepa dropped Australia) have no Keepa domain, so MVP's
// server tries a /dp probe that Amazon frequently blocks from datacenter IPs.
// SCOUT reads the real /dp page in the creator's own logged-in session on a
// residential IP, so the answer is definitive: product page renders → 'found';
// Amazon's "page not found" (dogs-of-amazon 404) → 'not-listed'; a captcha,
// sign-in redirect or unreadable page → 'unknown' (the caller keeps it neutral).

// Runs IN the /dp page. Three-state: is this ASIN a live listing on this domain?
function checkAmazonAsinInPage(wantAsin) {
  const bodyText = (document.body && document.body.innerText) || ''
  const html = document.documentElement ? document.documentElement.innerHTML : ''
  const title = (() => { try { const e = document.querySelector('#productTitle'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : '' } catch (e) { return '' } })()
  const captcha = /Enter the characters you see below|Robot Check|api-services-support@amazon|To discuss automated access/i.test(bodyText)
  const signedOut = /\/ap\/signin/.test(location.href)
  // Amazon's 404 surfaces as the "dogs of amazon" page or a localized
  // "we couldn't find that page" — detected by the well-known asset + copy.
  const notFound = /dogs-of-amazon|Sorry! We couldn't find that page|couldn't find that page|no longer available|currently unavailable and we don't know/i.test(bodyText)
    || /images-na\.ssl-images-amazon\.com\/images\/G\/01\/error\//i.test(html)
  let status = 'unknown'
  if (title) status = 'found'
  else if (notFound) status = 'not-listed'
  else if (captcha || signedOut) status = 'unknown'
  return { status: status, diag: { url: location.href.slice(0, 140), hasTitle: !!title, notFound: notFound, captcha: captcha, signedOut: signedOut } }
}

async function checkAmazonAsinListed(asin, domain, callerTabId) {
  if (!/^[A-Za-z0-9]{10}$/.test(asin || '')) return { ok: false, status: 'unknown', error: 'bad-asin' }
  const host = String(domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
  if (!host) return { ok: false, status: 'unknown', error: 'bad-domain' }
  // Non-US /dp origins live in optional_host_permissions (the popup's
  // "International Amazon" toggle). Without the grant, executeScript on the page
  // is denied — surface it as a distinct, actionable reason (not a silent fail).
  if (host !== 'amazon.com') {
    let granted = false
    try { granted = await chrome.permissions.contains({ origins: [`https://*.${host}/*`] }) } catch (e) {}
    if (!granted) return { ok: false, status: 'unknown', error: 'intl-permission-needed' }
  }
  const url = `https://www.${host}/dp/${asin}`
  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 25000)
    await _sleep(1200)
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: checkAmazonAsinInPage,
      args: [asin],
    })
    const r = (results && results[0] && results[0].result) || null
    if (!r) return { ok: false, status: 'unknown', error: 'no-result' }
    return { ok: true, status: r.status, diag: r.diag }
  } catch (e) {
    return { ok: false, status: 'unknown', error: 'check-failed' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// ── Local-ASIN resolution (MVP_AMZ_RESOLVE_ASIN) ────────────────────────────
// Video Launchpad: when a product's US ASIN isn't listed in a marketplace, the
// same product is often relisted there under a DIFFERENT ASIN. SCOUT searches
// that marketplace by brand + title in the creator's own session and returns the
// best-matching local ASIN, so the storefront upload can point at the product
// that actually exists in that geo. Confidence-gated — a weak match returns null
// (the app then lets the creator paste the ASIN by hand).

// Word-level match score of a candidate title against the target, in the
// background (not in-page). Returns 0..1 recall of the target's significant words.
function _asinMatchScore(targetTitle, brand, candTitle) {
  const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'to', 'in', 'on', 'by', 'pack', 'set', 'new', 'size', 'color', 'colour', 'pcs', 'pc', 'x'])
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const toks = (s) => norm(s).split(' ').filter((t) => t.length >= 3 && !STOP.has(t))
  const target = new Set(toks(targetTitle))
  if (!target.size) return 0
  const cand = new Set(toks(candTitle))
  let hit = 0
  target.forEach((t) => { if (cand.has(t)) hit++ })
  return hit / target.size
}

async function resolveLocalAsin(brand, title, sourceAsin, domain, callerTabId) {
  const host = String(domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
  const t = String(title || '').trim()
  if (!host) return { ok: false, error: 'bad-domain' }
  if (!t) return { ok: false, error: 'no-title' }
  // Non-US /dp + /s origins live behind the popup's "International Amazon" grant.
  if (host !== 'amazon.com') {
    let granted = false
    try { granted = await chrome.permissions.contains({ origins: [`https://*.${host}/*`] }) } catch (e) {}
    if (!granted) return { ok: false, error: 'intl-permission-needed' }
  }
  // Query: brand + the first significant title words (Amazon search is lenient;
  // a tighter query beats a 200-word title that returns nothing).
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const titleHead = norm(t).split(' ').filter((w) => w.length >= 3).slice(0, 6).join(' ')
  const query = [String(brand || '').trim(), titleHead].filter(Boolean).join(' ').trim() || titleHead
  const src = String(sourceAsin || '').toUpperCase()
  const brandTok = norm(brand).split(' ').filter((w) => w.length >= 3)
  let tabId = null
  try {
    const url = `https://www.${host}/s?k=${encodeURIComponent(query)}`
    const tab = await chrome.tabs.create({ url, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 25000)
    await _sleep(1600)
    let list = null
    for (let i = 0; i < 4; i++) {
      const r = await chrome.scripting.executeScript({ target: { tabId }, func: harvestAmazonSearchInPage })
      list = (r && r[0] && r[0].result) || null
      if (list && (list.ok || list.blocked)) break
      await _sleep(1300)
    }
    if (list && list.blocked) return { ok: false, error: 'amazon-blocked' }
    const products = (list && list.products) || []
    if (!products.length) return { ok: true, asin: null, reason: 'no-results' }
    // Score every card; require a brand-word present (when a brand is known) so a
    // generic title match to the wrong maker is rejected.
    let best = null
    for (const p of products) {
      if (!p || !p.asin) continue
      if (p.asin.toUpperCase() === src) continue // same code isn't listed here → skip
      const brandOk = brandTok.length === 0 || brandTok.some((b) => norm(p.title).includes(b))
      if (!brandOk) continue
      const score = _asinMatchScore(t, brand, p.title)
      if (!best || score > best.score) best = { asin: p.asin.toUpperCase(), title: p.title, image: p.image || null, score }
    }
    // Confidence gate: at least half the target's significant words must match.
    if (best && best.score >= 0.5) {
      return { ok: true, asin: best.asin, title: best.title, image: best.image, confidence: Math.round(best.score * 100) }
    }
    return { ok: true, asin: null, reason: 'no-confident-match', bestScore: best ? Math.round(best.score * 100) : 0 }
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message).slice(0, 120) : 'exception' }
  } finally {
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

// The retail hosts are OPTIONAL permissions (the user grants them once from the
// SCOUT popup) so the extension isn't disabled on update and the default
// footprint is Amazon-only. Map a URL to its optional origin pattern.
function retailOriginForUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '')
    const d = SCRAPE_HOSTS.find((d) => h === d || h.endsWith('.' + d))
    return d ? `https://*.${d}/*` : null
  } catch (e) { return null }
}

async function scanGenericProduct(url, callerTabId) {
  if (!/^https?:\/\//i.test(url || '')) return { ok: false, error: 'bad-url' }
  if (!scrapeHostAllowed(url)) return { ok: false, error: 'store-not-supported' }
  // Without the (optional) retail-host grant we can't run our reader on the page,
  // and the service worker can't prompt (no user gesture) — so tell MVP to point
  // the user at the "Read non-Amazon product pages" switch in the SCOUT popup.
  const origin = retailOriginForUrl(url)
  if (origin) {
    const granted = await chrome.permissions.contains({ origins: [origin] }).catch(() => false)
    if (!granted) return { ok: false, error: 'permission-needed', needsPermission: true, host: (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch (e) { return '' } })() }
  }
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
  // Rate-limit / bot-check interstitial → stop the scan.
  const bodyText = document.body ? (document.body.innerText || '') : ''
  if (/website temporarily unavailable|we just need to make sure you'?re not a robot|enter the characters you see below|api-services-support@amazon|to discuss automated access|type the characters you see in this image|robot check/i.test(bodyText)) {
    return { ok: false, blocked: true, products: [], url: location.href.slice(0, 140) }
  }
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
    // Review COUNT — the "(1,234)" link next to the stars. Several layouts:
    // an aria-label ending in "ratings", or the underlined count span.
    let reviews = null
    try {
      const cEl = el.querySelector('a[aria-label$="ratings" i], a[aria-label$="rating" i], [data-cy="reviews-block"] .s-underline-text, span.a-size-base.s-underline-text')
      const cTxt = cEl ? (cEl.getAttribute('aria-label') || cEl.textContent || '') : ''
      const cm = cTxt.replace(/,/g, '').match(/([\d.]+)\s*([kK])?/)
      if (cm) { let n = parseFloat(cm[1]); if (cm[2]) n *= 1000; if (!isNaN(n)) reviews = Math.round(n) }
    } catch (e) {}
    const sponsored = /sponsored/i.test(clean(el.textContent).slice(0, 40))
    seen.add(asin)
    out.push({ asin, title: title.slice(0, 180), price, image, rating, reviews, sponsored })
  }
  return { ok: out.length > 0, products: out, url: location.href.slice(0, 140) }
}

// Marketplace hosts for the onsite finder. Non-US hosts are OPTIONAL
// permissions (granted via the popup's "International Amazon" toggle) so the
// default footprint stays US-only and Chrome never disables on update.
const AMZ_MARKETS = {
  us: 'www.amazon.com',
  ca: 'www.amazon.ca',
  uk: 'www.amazon.co.uk',
  au: 'www.amazon.com.au',
}
const INTL_AMZ_ORIGINS = ['https://*.amazon.ca/*', 'https://*.amazon.co.uk/*', 'https://*.amazon.com.au/*']

async function productFinderSearch(query, opts) {
  opts = opts || {}
  // How many VERIFIED PASSERS the caller wants from this call (the app runs
  // multiple waves for bigger targets, excluding already-checked ASINs).
  const wantPassers = Math.min(15, Math.max(1, opts.maxResults || 10))
  const deepBudget = Math.min(25, wantPassers * 2 + 5) // stop even if passers are scarce
  const minSales = typeof opts.minSales === 'number' ? opts.minSales : 0
  const mustVideo = !!opts.mustVideo
  const minRating = typeof opts.minRating === 'number' ? opts.minRating : 0
  const minReviews = typeof opts.minReviews === 'number' ? opts.minReviews : 0
  const minPrice = typeof opts.priceMin === 'number' ? opts.priceMin : 0
  const maxPrice = typeof opts.priceMax === 'number' ? opts.priceMax : 0
  const exclude = new Set((opts.excludeAsins || []).map((a) => String(a || '').toUpperCase()))
  const q = String(query || '').trim()
  if (!q) return { ok: false, error: 'no-query' }
  // Marketplace: non-US needs the optional intl permission (popup grants it).
  const market = AMZ_MARKETS[opts.marketplace] ? opts.marketplace : 'us'
  const host = AMZ_MARKETS[market]
  if (market !== 'us') {
    let granted = false
    try { granted = await chrome.permissions.contains({ origins: INTL_AMZ_ORIGINS }) } catch (e) {}
    if (!granted) return { ok: false, error: 'intl-permission-needed' }
  }
  const parsePrice = (s) => { const m = String(s || '').replace(/,/g, '').match(/([\d.]+)/); const n = m ? parseFloat(m[1]) : NaN; return isNaN(n) ? null : n }
  // The candidate POOL: top ~120 results (cheap — search-page HTML only),
  // paginated. Deep-checks (a /dp visit each) only run on candidates that
  // already pass every CARD-READABLE gate (price / rating / reviews) — the
  // budget goes exclusively to plausible winners.
  const poolTarget = 120
  const pageUrl = (n) => `https://${host}/s?k=${encodeURIComponent(q)}${n > 1 ? `&page=${n}` : ''}`
  // Space out Amazon page hits so a scan doesn't look like a bot burst (which
  // trips "Website Temporarily Unavailable" / robot checks). ~1.2–2.1s + jitter.
  const pace = () => _sleep(1200 + Math.floor(Math.random() * 900))
  let tabId = null
  let blocked = false
  const drops = { card: 0, sales: 0, carousel: 0, rating: 0, unreadable: 0 }
  const checkedAsins = [] // deep-checked this call (pass or fail) — app excludes next wave
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
        if (list && (list.ok || list.blocked)) break
        await _sleep(1300)
      }
      if (list && list.blocked) { blocked = true; break } // Amazon throttled — stop
      if (!list || !list.products || !list.products.length) break
      let added = 0
      for (const p of list.products) { if (!seen.has(p.asin)) { seen.add(p.asin); pooled.push(p); added++ } }
      if (added === 0) break // no new results on this page → end of pagination
      if (page < 6 && pooled.length < poolTarget) await pace() // breathe between pages
    }
    if (!pooled.length) return blocked ? { ok: false, error: 'amazon-blocked', products: [] } : { ok: false, error: 'no-results', products: [] }
    // Card-readable gates FIRST (free), then organic before sponsored. Excluded
    // ASINs (already deep-checked in an earlier wave) are skipped entirely.
    const candidates = []
    for (const p of pooled.filter((x) => !x.sponsored).concat(pooled.filter((x) => x.sponsored))) {
      if (exclude.has(p.asin)) continue
      const priceN = parsePrice(p.price)
      const ratingN = p.rating != null ? parseFloat(p.rating) : null
      if (minPrice && (priceN == null || priceN < minPrice)) { drops.card++; continue }
      if (maxPrice && priceN != null && priceN > maxPrice) { drops.card++; continue }
      if (minRating && ratingN != null && ratingN < minRating) { drops.card++; continue }
      if (minReviews && (p.reviews == null || p.reviews < minReviews)) { drops.card++; continue }
      candidates.push({ ...p, priceN, ratingN })
    }
    const results = []
    let deepChecked = 0
    for (const p of candidates) {
      if (results.length >= wantPassers || deepChecked >= deepBudget) break
      let sig = { sales: null, hasVideo: false, carouselPos: 'none' }
      try {
        await chrome.tabs.update(tabId, { url: `https://${host}/dp/${p.asin}` })
        await waitForTabLoad(tabId, 20000)
        await _sleep(900)
        for (let i = 0; i < 6; i++) {
          const r = await chrome.scripting.executeScript({ target: { tabId }, func: readDpSignalsInPage })
          const v = r && r[0] && r[0].result
          if (v) { sig = v; if (v.blocked || v.hasVideo || v.sales != null) break }
          await _sleep(600)
        }
      } catch (e) { /* keep the search-page basics; signals stay null */ }
      // Amazon started rate-limiting mid-scan → stop now, return what we have.
      if (sig && sig.blocked) { blocked = true; break }
      deepChecked++
      checkedAsins.push(p.asin)
      // Deep gates — only passers make the results list.
      if (minSales > 0 && (sig.sales == null || sig.sales < minSales)) { drops.sales++; await pace(); continue }
      if (mustVideo && !sig.hasVideo) { drops.carousel++; await pace(); continue }
      // The /dp rating is authoritative when the card's was unreadable.
      const dpRating = typeof sig.rating === 'number' ? sig.rating : p.ratingN
      if (minRating && dpRating != null && dpRating < minRating) { drops.rating++; await pace(); continue }
      results.push({
        asin: p.asin, title: p.title, price: p.price, image: p.image,
        rating: p.rating != null ? p.rating : (typeof sig.rating === 'number' ? String(sig.rating) : null),
        reviews: p.reviews != null ? p.reviews : null,
        monthlySales: sig.sales, carouselPos: sig.carouselPos || 'none', hasVideo: !!sig.hasVideo,
        marketplace: market,
      })
      await pace() // breathe between /dp hits
    }
    return { ok: true, products: results, scanned: deepChecked, totalFound: pooled.length, blocked, drops, checkedAsins, poolExhausted: deepChecked >= candidates.length }
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message).slice(0, 120) : 'exception' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// ── Verify catalog campaigns by ASIN (MVP_CC_VERIFY) ─────────────────────────
// The fast half of "Campaigns ON": the app pre-filters the shared CC catalog
// (commission / runway / avoid-list, instant SQL) and hands SCOUT a shortlist
// of {campaignId, asin, …} candidates. SCOUT goes STRAIGHT to each product's
// /dp (no Creator Connections grid, no ASIN resolution — ~3× faster per check)
// and applies the live gates: price band, monthly units, rating, carousel.
// Returns the passers, each enriched with the live signals, so the app can
// score + rank them. Paced + interstitial-aware like every SCOUT Amazon loop.
async function verifyCatalogAsins(candidates, rules) {
  rules = rules || {}
  const list = (Array.isArray(candidates) ? candidates : [])
    .filter(c => c && /^[A-Z0-9]{10}$/.test(String(c.asin || '').toUpperCase()))
  if (!list.length) return { ok: true, results: [], deepChecked: 0 }
  const wantPassers = Math.min(15, Math.max(1, rules.wantPassers || 15))
  const deepBudget = Math.min(25, Math.max(wantPassers, list.length))
  const floor = Math.max(rules.minPrice || 0, rules.hardFloorPrice || 0)
  const pace = () => _sleep(2500 + Math.floor(Math.random() * 2000))
  let tabId = null, blocked = false, deepChecked = 0
  const drops = { unreadable: 0, price: 0, sales: 0, rating: 0, carousel: 0, category: 0 }
  const results = []
  try {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
    tabId = tab.id
    for (const c of list) {
      if (results.length >= wantPassers || deepChecked >= deepBudget) break
      const asin = String(c.asin).toUpperCase()
      let sig = { sales: null, hasVideo: false, carouselPos: 'none', price: null, rating: null, crumbs: null, image: null }
      try {
        await chrome.tabs.update(tabId, { url: `https://www.amazon.com/dp/${asin}` })
        await waitForTabLoad(tabId, 20000)
        await _sleep(900)
        for (let i = 0; i < 6; i++) {
          const r = await chrome.scripting.executeScript({ target: { tabId }, func: readDpSignalsInPage })
          const v = r && r[0] && r[0].result
          if (v) { sig = v; if (v.blocked || v.hasVideo || v.sales != null || v.price != null) break }
          await _sleep(600)
        }
      } catch (e) { /* signals stay null → dropped as unreadable below */ }
      if (sig && sig.blocked) { blocked = true; break }
      deepChecked++
      const price = typeof sig.price === 'number' ? sig.price : null
      const sales = typeof sig.sales === 'number' ? sig.sales : null
      const rating = typeof sig.rating === 'number' ? sig.rating : null
      const carouselPos = sig.carouselPos || 'none'
      if (price == null) { drops.unreadable++; await pace(); continue }
      if (price < floor || (rules.maxPrice && price > rules.maxPrice)) { drops.price++; await pace(); continue }
      if (rules.minMonthlySales && (sales == null || sales < rules.minMonthlySales)) { drops.sales++; await pace(); continue }
      if (rules.minRating && rating != null && rating < rules.minRating) { drops.rating++; await pace(); continue }
      if (rules.requireCarousel && carouselPos === 'none') { drops.carousel++; await pace(); continue }
      // Breadcrumb avoid-list (campaign names lie; categories don't).
      if (sig.crumbs && Array.isArray(rules.avoidPatterns)) {
        const hay = String(sig.crumbs).toLowerCase()
        if (rules.avoidPatterns.some(p => hay.includes(String(p).toLowerCase()))) { drops.category++; await pace(); continue }
      }
      results.push({
        campaignId: c.campaignId || null,
        campaignName: c.campaignName || null,
        brand: c.brand || null,
        asin,
        detailsUrl: c.detailsUrl || null,
        commissionPct: typeof c.commissionPct === 'number' ? c.commissionPct : null,
        endsAt: c.endsAt || null,
        daysLeft: typeof c.daysLeft === 'number' ? c.daysLeft : null,
        price, monthlySales: sales, rating, carouselPos, hasVideo: carouselPos !== 'none',
        crumbs: sig.crumbs || null,
        image: sig.image || null,
      })
      await pace()
    }
    return { ok: true, results, deepChecked, blocked, drops }
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message).slice(0, 120) : 'exception', results, deepChecked, drops }
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
// The notify-subscribers bell follows the user's Yes/No choice: the API publish
// path passes it through to the Data API, and the Details pass below sets the
// Studio "publish to subs feed & notify" checkbox to match.
// Scope the URL to the OWNING channel whenever we know it. A bare
// /video/<id>/<panel> resolves under whatever channel Studio is currently on,
// and Studio throws a generic "something went wrong" when that isn't the owner
// — which silently failed every finish step for creators with more than one
// channel. The channel-scoped form lands on the right channel first time.
let _studioChannelId = null
const STUDIO_VIDEO = (id, panel) => _studioChannelId
  ? `https://studio.youtube.com/channel/${_studioChannelId}/video/${id}/${panel}`
  : `https://studio.youtube.com/video/${id}/${panel}`

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
      // here. Navigating to /monetization on such a channel silently BOUNCES to
      // the Studio dashboard (that's the dashboard chrome we saw in debug), or
      // the page invites you to APPLY to the Partner Program. Detect all three —
      // redirect-away, dashboard chrome, or the YPP-invite copy — so we report
      // "not monetized" (neutral skip) instead of a scary failure.
      const bodyTxt = (document.body ? document.body.innerText : '').toLowerCase()
      out.debug.finalUrl = location.href.slice(0, 160)
      // Navigating to /monetization sometimes BOUNCES to the Studio dashboard
      // (SPA deep-link race) even on a fully monetized channel — that's a
      // transient we should RETRY, not a "not monetized" state. Only the
      // explicit YPP-invite copy means the channel truly can't monetize.
      const redirectedAway = !/\/video\/[^/]+\/monetization/i.test(location.href)
      const dashboardSignal = /your feed|studio dashboard|channel dashboard|latest video performance|analytics for the last/i.test(bodyTxt)
      const yppInvite = /you'?re not in the youtube partner program|not eligible for monetization|apply to the youtube partner|join the youtube partner program|once you'?re eligible/i.test(bodyTxt)
      out.debug.bounced = redirectedAway || dashboardSignal
      out.debug.yppInvite = yppInvite

      // Cold-loading /monetization can also drop you on YouTube's own "something
      // went wrong" page (Retry button). Click it and wait for recovery.
      const errPage = () => /something went wrong/i.test((document.body ? document.body.innerText : '').toLowerCase())
      for (let tries = 0; tries < 3 && errPage(); tries++) {
        out.debug.hitErrorPage = true
        const rb = find([/^retry$/i, /^try again$/i, /^reload$/i])
        out.debug.retryText = rb ? visText(rb) : null
        if (rb) { click(rb); await sleep(2500) } else break
      }
      if (errPage()) { out.needsReload = true; out.detail = 'Monetization page errored — retrying'; out.debug.controlsAfter = sample(); return out }

      // 1) Open the Monetization on/off dropdown (currently reads "Off") and
      //    choose the "On" option.
      const trigger = find([/edit video monetization/i, /monetization status/i, /monetization (is )?off/i, /^off$/i, /turn on monetization/i, /watch page ads/i])
      out.debug.triggerText = trigger ? visText(trigger) : null
      if (!trigger) {
        out.debug.controlsAfter = sample()
        if (yppInvite) {
          // Genuinely not in YPP — neutral note, nothing to do.
          out.skipped = true
          out.detail = 'This channel isn’t in the YouTube Partner Program — nothing to turn on'
        } else if (out.debug.bounced) {
          // Bounced to the dashboard mid-navigation — ask the orchestrator to
          // re-open the monetization page and try again.
          out.needsReload = true
          out.detail = 'Monetization page bounced to the dashboard — retrying'
        } else {
          // Shell loaded but the On/Off toggle never rendered (cold-load race) —
          // retry the whole panel before giving up.
          out.needsReload = true
          out.detail = 'Monetization controls didn’t render — retrying'
        }
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

      // The end-screen editor sometimes throws YouTube's own "Oops, something
      // went wrong" page (SPA deep-link race), which has a Retry button. Click
      // it and wait for the editor to recover before looking for controls.
      const errPage = () => {
        const t = (document.body ? document.body.innerText : '').toLowerCase()
        return /something went wrong/i.test(t)
      }
      for (let tries = 0; tries < 3 && errPage(); tries++) {
        out.debug.hitErrorPage = true
        const retry = find([/^retry$/i, /^try again$/i, /^reload$/i])
        out.debug.retryText = retry ? visText(retry) : null
        if (retry) { click(retry) } else { break }
        await sleep(2500)
      }
      if (errPage()) {
        // Still erroring after retries — bounce it up for a full reload.
        out.needsReload = true
        out.detail = 'YouTube’s end-screen editor errored — retrying'
        out.debug.controlsAfter = sample()
        return out
      }

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
// the opt-in copy), Allow embedding ON, and sets "Publish to subscriptions feed
// and notify subscribers" to the user's Yes/No choice (`notifySubscribers`) —
// the same choice the API publish path uses. Then Saves.
function studioFinishDetailsInPage(notifySubscribers) {
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
      await sleep(1800)
      out.debug.url = location.href.slice(0, 160)

      // Wait for the details form to actually render. Private / first-edit
      // videos render slower, and scanning too early is what made paid-promotion
      // etc. come back "not-found". Poll for a known control before touching it.
      const waitCtrl = async (re, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (findCtrl(re)) return true; await sleep(300) } return false }
      const formReady = await waitCtrl(/made for kids|paid promotion|allow embedding|restrict my video/i, 12000)
      out.debug.formReady = formReady

      // Paid promotion, embedding, subs-feed and AI-use live under "Show more".
      // Previous builds found a "Show more" and clicked it, but nothing
      // expanded — so we were clicking a non-interactive leaf. Collect EVERY
      // plausible toggle (its interactive ancestor), log what they are, and
      // click each visible one until the paid-promotion control appears.
      const isVisible = (el) => { try { return !!(el.offsetParent || (el.getClientRects && el.getClientRects().length)) } catch (e) { return true } }
      const tagId = (el) => `${(el.tagName || '').toLowerCase()}#${el.id || ''}[${(el.getAttribute && el.getAttribute('aria-expanded')) || ''}]`
      const interactiveAncestor = (leaf) => {
        let e = leaf
        for (let i = 0; i < 5 && e; i++) {
          const tag = (e.tagName || '').toLowerCase()
          if (e.id === 'toggle-button' || /ytcp-button|paper-button|tp-yt-paper-button/.test(tag) || tag === 'button' || (e.getAttribute && (e.getAttribute('role') === 'button' || e.getAttribute('aria-expanded') != null))) return e
          e = e.parentElement
        }
        return leaf
      }
      const showMoreToggles = () => {
        const seen = new Set(), out2 = []
        for (const el of deepAll()) {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
          if (!/^show more$/i.test(t)) continue
          const target = interactiveAncestor(el)
          if (target && isVisible(target) && !seen.has(target)) { seen.add(target); out2.push(target) }
        }
        return out2
      }
      // The paid-promotion control label in Studio is long ("This video
      // contains paid promotion like a paid product placement, sponsorship, or
      // endorsement"); match broadly so we know when it's rendered.
      const paidThere = () => !!findCtrl(/paid promotion|product placement|sponsorship|endorsement|contains paid/i)
      let expanded = paidThere()
      for (let tries = 0; tries < 4 && !expanded; tries++) {
        const toggles = showMoreToggles()
        out.debug['smToggles' + tries] = toggles.map(tagId).slice(0, 6)
        for (const tg of toggles) {
          try { tg.scrollIntoView({ block: 'center' }) } catch (e) {}
          click(tg)
          await sleep(700)
          if (paidThere()) break
        }
        expanded = paidThere()
        if (!expanded) { try { (document.scrollingElement || document.body).scrollBy(0, 700) } catch (e) {} ; await sleep(600); expanded = paidThere() }
      }
      out.debug.expanded = expanded
      // On failure, record every button label on the page so we can see what
      // the expander is actually called this layout.
      if (!expanded) out.debug.allButtons = Array.from(new Set(deepAll().filter(isBtn).map(visText).filter((t) => t && t.length < 30))).slice(0, 40)
      out.debug.controlsBefore = snapshot()

      // If the form or its disclosures never rendered, this is the cold-load
      // race — ask the orchestrator to reload and run the whole step again
      // rather than saving a half-empty Details tab.
      if (!formReady || !expanded) {
        out.needsReload = true
        out.detail = !formReady ? 'Details form didn’t render — retrying' : 'Couldn’t open the “Show more” disclosures — retrying'
        out.debug.controlsAfter = snapshot()
        return out
      }

      // 1) Paid promotion ON
      setCheckbox(/paid promotion|product placement|sponsorship|endorsement/i, true, 'paidPromotion')
      await sleep(300)
      // 2) Allow embedding ON
      setCheckbox(/allow embedding/i, true, 'embedding')
      await sleep(300)
      // 3) Publish to subscriptions feed & notify subscribers — match the user's
      //    Yes/No choice (defaults OFF when not supplied).
      setCheckbox(/publish to subscriptions feed|notify subscribers/i, notifySubscribers === true, 'notify')
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

      // Success = paid promotion was actually set (the field that matters for a
      // review) AND we saved. Notify / embedding / AI-use are recorded in detail
      // but a missing notify control must NOT fail the whole step.
      const paidHandled = out.actions.paidPromotion && out.actions.paidPromotion !== 'not-found'
      out.ok = !!save && !!paidHandled
      out.detail = `paid:${out.actions.paidPromotion || '?'} · embed:${out.actions.embedding || '?'} · notify:${out.actions.notify || '?'} · AI-use:${out.actions.aiUse || '?'}`
      if (!save) out.detail += ' · Save not found'
      return out
    } catch (e) {
      out.error = (e && e.message) || 'exception'
      return out
    }
  })()
}

// Tag the reviewed PRODUCT on the video via Studio's "Tag products" flow (only
// works for creators enrolled in YouTube Shopping). Opens the Products area,
// pastes the product URL MVP resolved, adds the first match, and saves. Best-
// effort and self-contained (piercing Studio's shadow DOM); returns a `debug`
// map so the selectors can be tuned against live Studio like the other steps.
function studioFinishTagProductInPage(productUrl) {
  return (async () => {
    const out = { step: 'tagproduct', ok: false, detail: '', debug: {} }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const deepAll = () => {
      const acc = []
      const walk = (root) => { let els; try { els = root.querySelectorAll('*') } catch (e) { return } for (const el of els) { acc.push(el); if (el.shadowRoot) walk(el.shadowRoot) } }
      walk(document); return acc
    }
    const visText = (el) => { try { const a = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title')); return (a || el.textContent || '').replace(/\s+/g, ' ').trim() } catch (e) { return '' } }
    const isBtn = (el) => { const t = (el.tagName || '').toLowerCase(); return /button|ytcp-button/.test(t) || (el.getAttribute && el.getAttribute('role') === 'button') }
    const click = (el) => { if (!el) return false; try { el.scrollIntoView({ block: 'center' }) } catch (e) {} try { el.click() } catch (e) {} try { ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))) } catch (e) {} return true }
    const setInput = (el, val) => {
      try {
        const proto = (el.tagName === 'TEXTAREA') ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
        setter.call(el, val)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      } catch (e) { try { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); return true } catch (e2) { return false } }
    }
    try {
      if (!productUrl) { out.detail = 'no product url'; return out }
      await sleep(1500)
      // 1) Open the "Tag products" / Products area. Scope to Studio's OWN
      //    controls (ytcp-*) so a third-party extension's injected button can't
      //    be mistaken for it.
      const openBtn = deepAll().filter(isBtn).find((el) => /^(tag products|add products|products)$/i.test(visText(el)))
      out.debug.openBtn = openBtn ? visText(openBtn).slice(0, 40) : null
      if (openBtn) { click(openBtn); await sleep(1800) }
      // 2) The product search / paste-a-link input. Must be an ACTUAL product
      //    box — matched by its own placeholder/label. NEVER fall back to
      //    "the first input on the page" (that grabbed the video-title field
      //    and produced a false success). No product box = report it, don't
      //    pretend it worked.
      const inputs = deepAll().filter((el) => { const t = (el.tagName || '').toLowerCase(); return t === 'input' || t === 'textarea' })
      const input = inputs.find((el) => /search (for )?products|paste a product|product link|add a product|find a product/i.test(visText(el)))
      out.debug.foundInput = !!input
      out.debug.inputCandidates = inputs.map((el) => visText(el).slice(0, 40)).filter(Boolean).slice(0, 12)
      if (!input) {
        out.detail = openBtn
          ? 'Opened Products, but couldn’t find the product search box — see debug'
          : 'Couldn’t find the Tag-products control on this page — see debug'
        return out
      }
      try { input.focus() } catch (e) {}
      setInput(input, productUrl)
      try { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })) } catch (e) {}
      await sleep(2800) // let YouTube resolve the pasted link to a product
      // 3) Add the first resolved product. Only a real, short "Add"/"Add
      //    product" button — dropped the loose aria*="add" fallback that
      //    matched the channel's "Add a title that describes you" CTA.
      const addBtn = deepAll().filter(isBtn).find((el) => { const t = visText(el); return /^add$/i.test(t) || /^add product$/i.test(t) || /^tag product$/i.test(t) })
      out.debug.addBtn = addBtn ? visText(addBtn).slice(0, 30) : null
      if (addBtn) { click(addBtn); await sleep(1200) }
      // 4) Next / Done / Save through the confirm step.
      for (let i = 0; i < 2; i++) {
        const go = deepAll().filter(isBtn).find((el) => /^(next|done|save|add products)$/i.test(visText(el)))
        if (!go) break
        out.debug['step' + i] = visText(go)
        click(go); await sleep(1400)
      }
      out.ok = !!(input && addBtn)
      out.detail = out.ok ? 'Product tagged' : `product box found, but the Add button didn’t appear — see debug`
      return out
    } catch (e) { out.detail = (e && e.message) || 'threw'; return out }
  })()
}

// ── Disclosure replay via YouTube's OWN internal API ─────────────────────────
// Runs in the Studio page's MAIN world so it can read fresh INNERTUBE context +
// compute a fresh SAPISIDHASH from the user's cookie, then POST the real
// metadata_update with the disclosure fields set (shapes learned from a captured
// save). This sidesteps the untrusted-click problem entirely. First pass sends
// WITHOUT the BotGuard attestationResponseData — the response tells us whether
// YouTube enforces it (if so we fall back to in-flight injection).
function studioApplyDisclosuresInPage(videoId, opts, readMask) {
  return (async () => {
    const out = { ok: false, step: 'apidisclosures', detail: '', debug: {} }
    try {
      const getCookie = (n) => { const m = document.cookie.match(new RegExp('(^|; )' + n + '=([^;]+)')); return m ? decodeURIComponent(m[2]) : '' }
      const sapisid = getCookie('SAPISID') || getCookie('__Secure-3PAPISID')
      out.debug.hasSapisid = !!sapisid
      const cfg = window.ytcfg
      const get = (k) => { try { return cfg && cfg.get ? cfg.get(k) : (cfg && cfg.data_ ? cfg.data_[k] : undefined) } catch (e) { return undefined } }
      const ictx = get('INNERTUBE_CONTEXT') || {}
      const clientName = get('INNERTUBE_CONTEXT_CLIENT_NAME') || (ictx.client && ictx.client.clientName) || 62
      const clientVersion = get('INNERTUBE_CONTEXT_CLIENT_VERSION') || (ictx.client && ictx.client.clientVersion) || ''
      const visitor = get('VISITOR_DATA') || (ictx.client && ictx.client.visitorData) || ''
      const delegated = get('DELEGATED_SESSION_ID') || ''
      const sessionIndex = String(get('SESSION_INDEX') || '0')
      out.debug.clientVersion = String(clientVersion)
      out.debug.hasCtx = !!(ictx && ictx.client)
      out.debug.hasDelegated = !!delegated
      if (!sapisid || !ictx.client) { out.detail = 'missing auth/context on page'; return out }

      // Fresh SAPISIDHASH — canonical Google format: SHA1("{ts} {SAPISID}
      // {origin}"). (The earlier build appended a stray "_u" copied from the
      // capture, which is NOT part of the hash and caused a 401.) Send the same
      // hash under all three scheme names, as Studio does.
      const origin = 'https://studio.youtube.com'
      const ts = Math.floor(Date.now() / 1000)
      const enc = new TextEncoder().encode(ts + ' ' + sapisid + ' ' + origin)
      const digest = await crypto.subtle.digest('SHA-1', enc)
      const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
      const one = ts + '_' + hex
      const auth = 'SAPISIDHASH ' + one + ' SAPISID1PHASH ' + one + ' SAPISID3PHASH ' + one

      // Build the update body with only the disclosure mutations set.
      const context = Object.assign({}, ictx)
      const body = { encryptedVideoId: videoId, flowType: 'MDE_FLOW_TYPE_UPLOAD', context }
      // The real save request carried a big videoReadMask; a 200 without it may
      // silently drop the mutations. Include the real mask (passed in from a
      // captured save) to test whether that's the gate vs BotGuard attestation.
      if (readMask && typeof readMask === 'object') body.videoReadMask = readMask
      out.debug.hasReadMask = !!(readMask && typeof readMask === 'object')
      if (opts.paidPromotion) body.productPlacement = { newHasPaidProductPlacement: true, newShowPaidProductPlacementOverlay: true, newIsPaidProductPlacementSelfDeclaredDefinitive: true }
      if (opts.aiDisclosure) body.alteredContent = { operation: 'MDE_ALTERED_CONTENT_UPDATE_OPERATION_SET', newCreatorDisclosedHasAlteredContent: opts.hasAlteredContent ? 'MDE_HAS_ALTERED_CONTENT_YES' : 'MDE_HAS_ALTERED_CONTENT_NO' }
      if (opts.monetize) { body.monetizationSettings = { newMonetizeWithAds: true }; body.adSettings = { adBreaks: { newHasPrerolls: 'ENABLED', newHasMidrollAds: 'ENABLED', newHasPostrolls: 'ENABLED' }, autoAdSettings: 'AUTO_AD_SETTINGS_TYPE_OFF' } }
      out.debug.fields = Object.keys(body).filter((k) => k !== 'context' && k !== 'encryptedVideoId' && k !== 'flowType')

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': auth,
        'X-Origin': origin,
        'X-Goog-AuthUser': sessionIndex,
        'X-YouTube-Client-Name': String(clientName),
        'X-YouTube-Client-Version': String(clientVersion),
      }
      if (visitor) headers['X-Goog-Visitor-Id'] = visitor

      const res = await fetch('/youtubei/v1/video_manager/metadata_update?alt=json', { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) })
      out.debug.status = res.status
      const txt = await res.text()
      out.debug.resp = (txt || '').slice(0, 1800)
      out.ok = res.status >= 200 && res.status < 300 && !/"error"/.test(txt.slice(0, 400))
      out.detail = out.ok ? 'Disclosures applied via API ✓' : ('API ' + res.status)
      return out
    } catch (e) { out.error = (e && e.message) || 'threw'; out.detail = 'threw'; return out }
  })()
}

async function ytApplyDisclosures(videoId, opts) {
  if (!videoId || !/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) return { ok: false, error: 'bad-video-id' }
  // Pull the real videoReadMask out of a captured metadata_update save, if we
  // have one, and pass it into the replay.
  let readMask = null
  try {
    const store = await chrome.storage.local.get(['mvp_yt_recipes'])
    const recs = Array.isArray(store.mvp_yt_recipes) ? store.mvp_yt_recipes : []
    for (const r of recs) {
      if (r && /metadata_update/.test(r.url || '') && typeof r.body === 'string') {
        try { const b = JSON.parse(r.body); if (b && b.videoReadMask) { readMask = b.videoReadMask; break } } catch (e) {}
      }
    }
  } catch (e) {}
  let tabId = null
  try {
    // Background tab is fine — this is a direct fetch, no DOM interaction.
    const tab = await chrome.tabs.create({ url: STUDIO_VIDEO(videoId, 'edit'), active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    await new Promise((r) => setTimeout(r, 2500)) // let ytcfg populate
    const r = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: studioApplyDisclosuresInPage, args: [videoId, opts || {}, readMask] })
    return (r && r[0] && r[0].result) || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'apply-failed' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// In-flight injection trigger: set the injection payload, then make Studio dirty
// + Save so it fires its own (signed) metadata_update that our hook rewrites to
// carry the disclosure fields. Dirtying is done by appending a space to the
// description via execCommand (contenteditable bindings read the DOM on input,
// so this registers where a checkbox click doesn't).
function studioInjectSaveInPage(videoId, opts) {
  return (async () => {
    const out = { ok: false, step: 'inject', detail: '', debug: {} }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const deepAll = () => { const acc = []; const w = (r) => { let e; try { e = r.querySelectorAll('*') } catch (x) { return } for (const el of e) { acc.push(el); if (el.shadowRoot) w(el.shadowRoot) } }; w(document); return acc }
    const vis = (el) => { try { return !!(el.offsetParent || (el.getClientRects && el.getClientRects().length)) } catch (e) { return false } }
    const visText = (el) => { try { const a = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title')); return (a || el.textContent || '').replace(/\s+/g, ' ').trim() } catch (e) { return '' } }
    const isBtn = (el) => { const t = (el.tagName || '').toLowerCase(); return /button|ytcp-button/.test(t) || (el.getAttribute && el.getAttribute('role') === 'button') }
    const findSave = () => {
      let save = null, len = 1e9
      for (const el of deepAll().filter(isBtn)) {
        if (!vis(el)) continue
        const tx = visText(el)
        if (/^save$/i.test(tx) && tx.length < len) { const dis = (el.getAttribute && el.getAttribute('aria-disabled')) || (el.disabled ? 'true' : ''); if (dis !== 'true') { save = el; len = tx.length } }
      }
      return save
    }
    const dirtyDescription = () => {
      const editors = deepAll().filter((el) => el.isContentEditable && vis(el))
      out.debug.editors = editors.length
      const desc = editors.find((el) => /description/i.test((el.id || '') + ' ' + ((el.getAttribute && el.getAttribute('aria-label')) || ''))) || editors[1] || editors[0]
      out.debug.foundDesc = !!desc
      if (!desc) return false
      desc.focus()
      try { const sel = window.getSelection(); const rng = document.createRange(); rng.selectNodeContents(desc); rng.collapse(false); sel.removeAllRanges(); sel.addRange(rng) } catch (e) {}
      try { document.execCommand('insertText', false, ' ') } catch (e) {}
      try { desc.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' })) } catch (e) {}
      return true
    }
    try {
      // Arm the hook + reset diagnostics.
      window.__mvpYtInject = { videoId, paidPromotion: !!opts.paidPromotion, aiDisclosure: !!opts.aiDisclosure, hasAlteredContent: !!opts.hasAlteredContent, monetize: !!opts.monetize, notify: (typeof opts.notify === 'boolean' ? opts.notify : undefined) }
      window.__mvpYtInjected = 0
      window.__mvpYtInjectResp = null
      window.__mvpYtSawMeta = 0
      window.__mvpYtSawVideoId = null
      await sleep(2200) // let the editor fully render before touching it

      // Retry dirty → wait-for-enabled-Save → click → wait-for-response, since a
      // freshly-pushed video's editor can be slow to accept the edit.
      let saveFound = false
      for (let attempt = 0; attempt < 3 && !window.__mvpYtInjectResp; attempt++) {
        dirtyDescription()
        let save = null
        for (let i = 0; i < 12 && !save; i++) { save = findSave(); if (!save) await sleep(400) }
        if (save) {
          saveFound = true
          try { save.scrollIntoView({ block: 'center' }) } catch (e) {}
          try { save.click() } catch (e) {}
          try {['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => save.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))) } catch (e) {}
        }
        for (let i = 0; i < 15 && !window.__mvpYtInjectResp; i++) { await sleep(400) }
      }

      out.debug.foundSave = saveFound
      out.debug.injected = window.__mvpYtInjected || 0
      out.debug.sawMeta = window.__mvpYtSawMeta || 0
      out.debug.sawVideoId = window.__mvpYtSawVideoId || null
      out.debug.wantVideoId = videoId
      out.debug.resp = window.__mvpYtInjectResp
      const r = window.__mvpYtInjectResp
      out.ok = !!(r && r.status >= 200 && r.status < 300 && (window.__mvpYtInjected > 0))
      // "Uncertain" = Studio's Save DID fire, but our hook never observed the
      // matching save request (YouTube can send it over a transport we don't see,
      // or complete it just after our wait window). The save itself usually
      // persisted — Studio shows the fields set — so this must NOT read as a hard
      // failure. The page renders it as an amber "check Studio" note, not a red X.
      out.uncertain = !out.ok && saveFound && !window.__mvpYtSawMeta
      out.detail = out.ok ? 'Injected into Studio save ✓'
        : !saveFound ? 'Save never enabled — couldn’t dirty the form'
          : (window.__mvpYtSawMeta && !window.__mvpYtInjected) ? ('save was for a different video id (saw ' + window.__mvpYtSawVideoId + ')')
            : !window.__mvpYtSawMeta ? 'Studio saved, but SCOUT couldn’t confirm the disclosure fields — open the video’s Details tab in Studio to check (it’s usually already set).'
              : ('metadata_update ' + (r ? r.status : 'no-response'))
      window.__mvpYtInject = null
      return out
    } catch (e) { window.__mvpYtInject = null; out.error = (e && e.message) || 'threw'; out.detail = 'threw'; return out }
  })()
}

async function ytInjectDisclosures(videoId, opts, callerTabId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) return { ok: false, error: 'bad-video-id' }
  let tabId = null
  try {
    // Foreground — contenteditable edits + Save are far more reliable focused.
    const tab = await chrome.tabs.create({ url: STUDIO_VIDEO(videoId, 'edit'), active: true })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    await new Promise((r) => setTimeout(r, 2500))
    const r = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: studioInjectSaveInPage, args: [videoId, opts || {}] })
    return (r && r[0] && r[0].result) || { ok: false, error: 'no-result' }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'inject-failed' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
    if (callerTabId != null) { try { await chrome.tabs.update(callerTabId, { active: true }) } catch (e) {} }
  }
}

async function scanStudioFinish(videoId, opts, callerTabId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) return { ok: false, error: 'bad-video-id', steps: [] }
  const want = opts || { details: true, monetize: true, selfCert: true, endScreen: true }
  // Opens Studio on the channel that OWNS the video (see STUDIO_VIDEO).
  _studioChannelId = (want.channelId && /^UC[\w-]{20,}$/.test(String(want.channelId))) ? String(want.channelId) : null
  const steps = []
  let tabId = null
  // First panel we need to land on (open the tab there directly).
  const startPanel = (want.details || want.tagProduct) ? 'edit' : (want.monetize || want.selfCert) ? 'monetization' : 'endscreens'
  let current = startPanel
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // Navigate the SAME tab between Studio panels, only reloading when the panel
  // actually changes (re-assigning the same URL wouldn't fire 'complete').
  // `fresh` forces a real re-navigation even when we think we're already on the
  // panel — used to recover from a bounce (Studio deep-link race dumped us on
  // the dashboard) where our tracked `current` no longer matches the real URL.
  const goto = async (panel, fresh) => {
    if (current === panel && !fresh) return
    await chrome.tabs.update(tabId, { url: STUDIO_VIDEO(videoId, panel) })
    await waitForTabLoad(tabId, 30000)
    await sleep(1500) // let the SPA finish client-side routing + data fetch
    current = panel
  }
  // Run a panel's in-page script, and if it reports needsReload (bounced to the
  // dashboard / hit YouTube's error page), re-navigate fresh and try again.
  const runPanel = async (panel, func, args, stepName) => {
    let res = null
    for (let attempt = 0; attempt < 3; attempt++) {
      await goto(panel, attempt > 0)
      const r = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args: args || [] })
      res = (r && r[0] && r[0].result) || { step: stepName, ok: false, error: 'no-result' }
      if (!res.needsReload) break
    }
    if (res && res.needsReload) { res.detail = (res.detail || '') + ' (still failing after retries)' }
    return res
  }
  try {
    // FOREGROUND: Studio is a heavy SPA and DOM interaction is far more reliable
    // in a focused tab (background tabs throttle timers/rendering). We restore
    // the caller's tab in `finally` so MVP stays in front afterward.
    const tab = await chrome.tabs.create({ url: STUDIO_VIDEO(videoId, startPanel), active: true })
    tabId = tab.id
    await waitForTabLoad(tabId, 30000)
    if (want.details) {
      steps.push(await runPanel('edit', studioFinishDetailsInPage, [want.notifySubscribers === true], 'details'))
    }
    if (want.tagProduct && want.productUrl) {
      // Product tagging lives on the video's edit page (YouTube Shopping only).
      await goto('edit')
      const r = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: studioFinishTagProductInPage, args: [String(want.productUrl)] })
      steps.push((r && r[0] && r[0].result) || { step: 'tagproduct', ok: false, error: 'no-result' })
    }
    if (want.monetize || want.selfCert) {
      steps.push(await runPanel('monetization', studioFinishMonetizeInPage, [], 'monetization'))
    }
    if (want.endScreen) {
      steps.push(await runPanel('endscreens', studioFinishEndScreenInPage, [], 'endscreen'))
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
// Open (or reuse) an Amazon Creator Hub "create" tab for a marketplace domain,
// wait for it to load + our content script to be ready, and return the tab id.
function openCreateTab(domain) {
  const host = `www.${domain || 'amazon.com'}`
  const url = `https://${host}/create/post`
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      const tabId = tab.id
      let settled = false
      const onUpdated = (id, info) => {
        if (id !== tabId || info.status !== 'complete') return
        chrome.tabs.onUpdated.removeListener(onUpdated)
        // Give the SPA + content script a moment to hydrate.
        setTimeout(() => { if (!settled) { settled = true; resolve(tabId) } }, 3500)
      }
      chrome.tabs.onUpdated.addListener(onUpdated)
      setTimeout(() => { if (!settled) { settled = true; chrome.tabs.onUpdated.removeListener(onUpdated); resolve(tabId) } }, 30000)
    })
  })
}

// Run each storefront-upload job on its marketplace's Creator Hub, sequentially.
// Returns [{ targetId, ok, mediaAci?, error? }].
// Deliver one marketplace's jobs: open its Creator Hub tab, upload each job's
// video, then close the tab. Returns a result row per job. Runs standalone so
// several marketplaces can be delivered concurrently (see deliverStorefronts).
async function deliverOneDomain(domain, jobs) {
  const out = []
  let tabId = null
  setSfProgress(domain, { step: 'Opening Amazon', pct: null })
  try { tabId = await openCreateTab(domain) } catch { /* tab open failed */ }
  // Make sure the storefront-upload content script is actually present in the
  // tab before we message it. The declared content_scripts injection can be
  // absent (a still-hydrating SPA, a marketplace redirect, or an install that
  // predates this file), which surfaces as Chrome's "Could not establish
  // connection. Receiving end does not exist." Injecting it here — idempotent,
  // guarded by window.__mvpStorefrontUploadLoaded — self-heals that. Mirrors
  // the scanTab() inject-then-retry pattern.
  if (tabId) {
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['storefront-upload.js'] }) } catch { /* fall through; per-job retry below still tries */ }
  }
  const sendJob = (job) => new Promise((resolve) => {
    const to = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 1500000)
    chrome.tabs.sendMessage(tabId, { action: 'MVP_STOREFRONT_UPLOAD_ONE', job }, (resp) => {
      clearTimeout(to)
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message, _unreachable: true })
      resolve(resp || { ok: false, error: 'no response' })
    })
  })
  for (const job of jobs) {
    if (!tabId) { out.push({ targetId: job.targetId, ok: false, error: 'Could not open the Amazon Creator Hub tab.' }); continue }
    try {
      let r = await sendJob(job)
      // One retry if the content script wasn't reachable: (re)inject and resend.
      if (r && r._unreachable) {
        try { await chrome.scripting.executeScript({ target: { tabId }, files: ['storefront-upload.js'] }) } catch { /* ignore */ }
        r = await sendJob(job)
      }
      out.push({ targetId: job.targetId, ok: !!r.ok, duplicate: !!r.duplicate, mediaAci: r.mediaAci || null, error: r.ok ? null : (r.error || 'upload failed') })
      setSfProgress(domain, { step: r.ok ? 'Published' : (r.duplicate ? 'Already there' : 'Failed'), pct: r.ok ? 100 : null })
    } catch (e) {
      out.push({ targetId: job.targetId, ok: false, error: String(e && e.message || e) })
    }
  }
  try { if (tabId) chrome.tabs.remove(tabId) } catch { /* ignore */ }
  return out
}

async function deliverStorefronts(items) {
  // Fresh run: never reuse an S3 key uploaded for a previous video.
  _sfUploadedKeys = {}
  _sfProgress = {}
  for (const it of items) setSfProgress(it.domain || 'amazon.com', { step: 'Waiting', pct: null })
  // Group by domain so we reuse one create tab per marketplace.
  const byDomain = {}
  for (const it of items) (byDomain[it.domain || 'amazon.com'] ||= []).push(it)
  const domains = Object.keys(byDomain)

  // Deliver several marketplaces at once instead of strictly one after another.
  // Each domain uses its own tab and holds its video in that tab's memory only
  // while uploading, so a bounded pool keeps total memory in check while cutting
  // wall-clock from the sum of every market to roughly the slowest few. Cap at 2:
  // firing 3+ at once made Amazon's credential + publish endpoints return
  // transient 503s and moderation flags, so we trade a little speed for fewer
  // retries (the upload itself also retries those transient errors).
  const POOL = 2
  const results = []
  let next = 0
  const runNext = async () => {
    while (next < domains.length) {
      const domain = domains[next++]
      const rows = await deliverOneDomain(domain, byDomain[domain])
      for (const r of rows) results.push(r)
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, domains.length) }, () => runNext()))
  return results
}

// Pre-flight the storefront upload: for each marketplace, open its Creator Hub
// in a background tab and ask the content script whether the creator is signed
// in and has a Creator session (slateToken). Returns a per-domain status so the
// app can show a checklist instead of failing silently. Closes each tab after.
async function preflightStorefronts(domains) {
  const results = []
  // Check several marketplaces at once. Each check opens a background tab, waits
  // for it to hydrate and probes it, so doing them one after another added the
  // settle time of every store to the run before a single byte was uploaded.
  // Read-only, so a small pool is safe (unlike the upload pool, which Amazon
  // throttles).
  const list = (domains || []).slice()
  const POOL = 3
  const checkOne = async (domain) => {
    let tabId = null, status = 'unknown'
    try { tabId = await openCreateTab(domain) } catch { /* open failed */ }
    if (!tabId) { results.push({ domain, status: 'unknown' }); return }
    try {
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ['storefront-upload.js'] }) } catch { /* declared inject may already be present */ }
      const probe = await new Promise((resolve) => {
        const to = setTimeout(() => resolve(null), 25000)
        chrome.tabs.sendMessage(tabId, { action: 'MVP_STOREFRONT_PROBE' }, (resp) => {
          clearTimeout(to)
          resolve(chrome.runtime.lastError ? null : resp)
        })
      })
      if (probe && probe.ready) status = 'ready'
      else if (probe && probe.signedIn === false) status = 'not_signed_in'
      else if (probe && probe.signedIn === true) status = 'not_enrolled'
      else status = 'unknown'
      // A signed-OUT creator is bounced from /create/* to Amazon's sign-in page,
      // where our content script isn't injected — so the probe above can't answer
      // and we'd wrongly report 'unknown' for the exact case we must catch. Read
      // the tab's final URL: if Amazon redirected it to an auth page, they're not
      // signed in, full stop.
      if (status === 'unknown') {
        try {
          const tab = await chrome.tabs.get(tabId)
          const u = (tab && tab.url) || ''
          if (/\/ap\/signin|\/ap\/register|\/ap\/|\/gp\/(?:sign-in|css\/homepage)|signin\?/i.test(u)) status = 'not_signed_in'
        } catch { /* keep 'unknown' */ }
      }
    } catch { status = 'unknown' }
    try { chrome.tabs.remove(tabId) } catch { /* ignore */ }
    results.push({ domain, status })
  }
  let next = 0
  const runNext = async () => {
    while (next < list.length) await checkOne(list[next++])
  }
  await Promise.all(Array.from({ length: Math.min(POOL, list.length) }, () => runNext()))
  return results
}

// Open one marketplace's Creator Hub in a FOREGROUND tab so the creator can sign
// in / finish enrollment, then retry the sync. Returns the tab id.
function openStorefrontLogin(domain) {
  const host = `www.${domain || 'amazon.com'}`
  return new Promise((resolve) => {
    chrome.tabs.create({ url: `https://${host}/create/post`, active: true }, (tab) => resolve(tab && tab.id))
  })
}

// ── S3 upload from the PAGE'S MAIN WORLD ────────────────────────────────────
// A signed cross-origin PUT to Amazon's creator S3 bucket has to run from the
// SAME context the real Creator Hub uploads from, or it stalls: an isolated
// content-script PUT and a service-worker PUT both failed ("[upload-video]
// timed out"). So we inject the whole download+sign+PUT into the create tab's
// MAIN world (world:'MAIN'), where the origin, cookies and CORS handling are
// exactly Amazon's own uploader's — the bucket already trusts it. This also
// keeps the work in the tab (alive while open) rather than the service worker
// (which Chrome kills mid-upload). Self-contained: executeScript serializes the
// function, so it can close over NOTHING — every helper is defined inside.
function mainWorldS3Put(params) {
  return (async () => {
    const { srcUrl, creds, key, contentType, label } = params
    const log = (...a) => { try { console.log('[SCOUT s3put]', ...a) } catch (e) {} }
    // Progress leaves the page's own world by postMessage; the isolated content
    // script in this same tab picks it up and relays it to the worker, which the
    // app polls. executeScript serializes this function, so it can close over
    // nothing — every helper has to live inside here.
    const post = (phase, pct, loaded, total) => {
      try { window.postMessage({ __mvpS3: 1, label: label || 'video', phase, pct, loaded, total }, '*') } catch (e) {}
    }
    const enc = new TextEncoder()
    const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
    const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s))
    const hmac = async (k, m) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', typeof k === 'string' ? enc.encode(k) : k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc.encode(m)))
    try {
      // Reuse the bytes if this same source was already downloaded into this
      // tab (e.g. several ASINs published to the same marketplace from one
      // video): the fetch is the slow half, so skipping the re-download is a
      // straight speed win. Scoped to this tab's page memory, cleared on reload.
      let bytes = null
      try { const c = window.__mvpS3Cache; if (c && c.url === srcUrl && c.bytes) bytes = c.bytes } catch (e) {}
      if (!bytes) {
        log('download start', String(srcUrl).slice(0, 80))
        let src
        try { src = await fetch(srcUrl, { signal: AbortSignal.timeout(300000) }) }
        catch (e) { return { ok: false, error: `download ${/abort|timeout/i.test(String(e && e.message)) ? 'timed out' : 'failed: ' + (e && e.message || e)}` } }
        if (!src.ok) return { ok: false, error: `download HTTP ${src.status}` }
        // Read it as a stream rather than one arrayBuffer() call, so the creator
        // sees the first half of the wait move instead of a frozen spinner.
        const total = Number(src.headers.get('content-length')) || 0
        if (src.body && src.body.getReader) {
          const reader = src.body.getReader()
          const chunks = []
          let got = 0, lastPct = -1
          for (;;) {
            const r = await reader.read()
            if (r.done) break
            chunks.push(r.value); got += r.value.length
            if (total > 0) {
              const pct = Math.floor((got / total) * 100)
              if (pct !== lastPct) { lastPct = pct; post('download', pct, got, total) }
            } else { post('download', null, got, 0) }
          }
          bytes = new Uint8Array(got)
          let off = 0
          for (const c of chunks) { bytes.set(c, off); off += c.length }
        } else {
          bytes = new Uint8Array(await src.arrayBuffer())
        }
        try { window.__mvpS3Cache = { url: srcUrl, bytes } } catch (e) {}
      } else {
        log('reusing cached bytes for', String(srcUrl).slice(0, 80))
      }
      const host = `${creds.s3Bucket}.s3.${creds.s3BucketRegion}.amazonaws.com`
      log('downloaded', bytes.length, 'bytes → PUT', host)
      const url = `https://${host}/${key}?x-id=PutObject`
      const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
      const dateStamp = amzDate.slice(0, 8)
      const region = creds.s3BucketRegion, service = 's3'
      const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-tagging'
      const canonicalHeaders =
        `content-type:${contentType}\n` + `host:${host}\n` +
        `x-amz-content-sha256:UNSIGNED-PAYLOAD\n` + `x-amz-date:${amzDate}\n` +
        `x-amz-security-token:${creds.awsSessionToken}\n` + `x-amz-tagging:temporary=true\n`
      const canonicalReq = ['PUT', `/${key.split('/').map(encodeURIComponent).join('/')}`, 'x-id=PutObject', canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n')
      const scope = `${dateStamp}/${region}/${service}/aws4_request`
      const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonicalReq)].join('\n')
      let k = await hmac('AWS4' + creds.awsSecretAccessKey, dateStamp)
      k = await hmac(k, region); k = await hmac(k, service); k = await hmac(k, 'aws4_request')
      const signature = hex(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc.encode(stringToSign)))
      const auth = `AWS4-HMAC-SHA256 Credential=${creds.awsAccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
      // XHR, not fetch, for ONE reason: xhr.upload.onprogress is the only way a
      // browser will tell us how much of the body has actually gone out. Same
      // origin, same headers, same signed request — only the transport differs.
      const headers = {
        'Content-Type': contentType, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
        'x-amz-date': amzDate, 'x-amz-security-token': creds.awsSessionToken,
        'x-amz-tagging': 'temporary=true', 'Authorization': auth,
      }
      const res = await new Promise((resolve) => {
        let xhr
        try { xhr = new XMLHttpRequest() } catch (e) { resolve({ status: 0, error: 'xhr-unavailable' }); return }
        try {
          xhr.open('PUT', url, true)
          for (const k in headers) xhr.setRequestHeader(k, headers[k])
          xhr.timeout = 900000
          let lastPct = -1
          xhr.upload.onprogress = (ev) => {
            if (!ev || !ev.lengthComputable) return
            const pct = Math.floor((ev.loaded / ev.total) * 100)
            if (pct !== lastPct) { lastPct = pct; post('upload', pct, ev.loaded, ev.total) }
          }
          xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText || '' })
          xhr.onerror = () => resolve({ status: 0, error: 'network error' })
          xhr.ontimeout = () => resolve({ status: 0, error: 'timed out' })
          xhr.onabort = () => resolve({ status: 0, error: 'aborted' })
          xhr.send(bytes)
        } catch (e) { resolve({ status: 0, error: String((e && e.message) || e) }) }
      })
      if (!res.status) return { ok: false, error: `S3 PUT ${res.error || 'failed'}` }
      if (res.status < 200 || res.status >= 300) return { ok: false, error: `S3 PUT ${res.status}: ${String(res.text || '').slice(0, 150)}` }
      log('PUT ok', res.status)
      return { ok: true, key }
    } catch (e) {
      log('failed', e && e.message || e)
      return { ok: false, error: String(e && e.message || e) }
    }
  })()
}

// Content script → background: run one S3 PUT (video or thumbnail) by injecting
// the upload into the SAME tab's main world.
// ── First run ───────────────────────────────────────────────────────────────
// Chrome forbids an extension from granting itself optional host permissions
// (the grant needs a user gesture + Chrome's own dialog), so "already on at
// install" isn't possible. Opening the welcome page once gets it down to a
// single click instead of two toggles the creator has to find in the popup.
// Install only — never on an update or a browser restart.
chrome.runtime.onInstalled.addListener((details) => {
  if (!details || details.reason !== 'install') return
  try { chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html'), active: true }) } catch (e) { /* never block install */ }
})

// ── Live upload progress, per marketplace ───────────────────────────────────
// A storefront run moves hundreds of megabytes per region and can take minutes,
// and the app could only show a spinner because nothing reported what stage each
// market had reached. Content scripts push a step (and, during a transfer, real
// byte progress) in here; the app polls MVP_STOREFRONT_STATUS while delivering.
// In-memory only and cleared at the start of every run: this is a progress
// readout, not state anything depends on.
let _sfProgress = {}
const _sfHostToDomain = (u) => { try { return new URL(u).host.replace(/^www\./, '') } catch (e) { return '' } }
function setSfProgress(domain, patch) {
  if (!domain) return
  _sfProgress[domain] = Object.assign({}, _sfProgress[domain] || {}, patch, { at: Date.now() })
}
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.action !== 'MVP_STOREFRONT_PROGRESS') return
  const domain = _sfHostToDomain((sender && sender.tab && sender.tab.url) || '')
  setSfProgress(domain, {
    step: typeof msg.step === 'string' ? msg.step : undefined,
    pct: typeof msg.pct === 'number' ? msg.pct : (msg.pct === null ? null : undefined),
  })
})

// ── Uploaded-key reuse across marketplaces ──────────────────────────────────
// Amazon hands each marketplace an S3 bucket named for its REGION
// (creator-studio-prod-us-east-1, creator-studio-prod-eu-west-1, ...), so
// marketplaces in the same region share one bucket. When they do, the same video
// only has to be uploaded ONCE: every market in that region can publish against
// the key we already put there. That's the difference between a four-geo run
// costing four full uploads and costing one per region.
// Keyed by `${bucket}|${srcUrl}` and cleared at the start of every delivery run,
// so nothing is ever reused across videos.
let _sfUploadedKeys = {}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return
  if (msg.action === 'MVP_STOREFRONT_GETKEY') {
    sendResponse({ key: _sfUploadedKeys[`${msg.bucket}|${msg.srcUrl}`] || null })
    return false
  }
  if (msg.action === 'MVP_STOREFRONT_PUTKEY') {
    try { _sfUploadedKeys[`${msg.bucket}|${msg.srcUrl}`] = msg.key } catch (e) { /* ignore */ }
    return false
  }
})

// Diagnostic ring: the create-API calls the REAL Creator Hub made (captured by
// storefront-token-sniffer.js in the page's own world). One manual upload by the
// creator gives us Amazon's exact publish body to diff ours against — the same
// approach that fixed the Creator Connections send. Persisted, because the MV3
// worker sleeps after ~30s and would otherwise lose it before MVP asks.
let _sfCreateLog = []
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.action !== 'MVP_STOREFRONT_CREATE_LOG' || !msg.entry) return
  try {
    _sfCreateLog.unshift(Object.assign({}, msg.entry, { host: msg.host || ((sender && sender.tab && sender.tab.url) || '') }))
    // Keep the globalize / cross-post calls even when routine chatter follows:
    // they're the ones worth learning, and a small ring would evict them.
    const isGold = (e) => /globaliz|cross-?post/i.test(String((e && e.url) || ''))
    if (_sfCreateLog.length > 40) {
      const gold = _sfCreateLog.filter(isGold).slice(0, 20)
      const rest = _sfCreateLog.filter((e) => !isGold(e)).slice(0, 20)
      _sfCreateLog = gold.concat(rest)
    }
    chrome.storage.local.set({ mvpSfCreateLog: _sfCreateLog })
  } catch (e) { /* diagnostics must never break an upload */ }
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'MVP_STOREFRONT_S3PUT') {
    const tabId = sender && sender.tab && sender.tab.id
    if (!tabId) { sendResponse({ ok: false, error: 'no-tab' }); return true }
    // Keep this service worker alive for the length of the (possibly minutes-long)
    // upload: a periodic chrome API call resets the ~30s idle-shutdown timer, so
    // the worker is still around to receive the injected function's result and
    // reply — the "no worker response (SW may have been killed)" failure.
    const keepAlive = setInterval(() => { try { chrome.runtime.getPlatformInfo(() => {}) } catch (e) {} }, 20000)
    let done = false
    const finish = (resp) => { if (done) return; done = true; clearInterval(keepAlive); clearTimeout(guard); sendResponse(resp) }
    // Never leave the content script hanging past its own 260s budget.
    const guard = setTimeout(() => finish({ ok: false, error: 'upload timed out in worker' }), 1260000)
    chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: mainWorldS3Put,
      args: [{ srcUrl: msg.srcUrl, creds: msg.creds, key: msg.key, contentType: msg.contentType, label: msg.label || 'video' }],
    })
      .then((results) => finish((results && results[0] && results[0].result) || { ok: false, error: 'no-result' }))
      .catch((e) => finish({ ok: false, error: String(e && e.message || e) }))
    return true // async
  }
})

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return
  // Storefront delivery: upload each localized/dubbed video to its Amazon
  // storefront via the creator's logged-in Creator Hub. Async.
  if (msg.type === 'MVP_STOREFRONT_DELIVER') {
    const items = Array.isArray(msg.items) ? msg.items : []
    if (items.length === 0) { sendResponse({ ok: true, results: [] }); return false }
    deliverStorefronts(items)
      .then((results) => sendResponse({ ok: true, results }))
      .catch((e) => sendResponse({ ok: false, error: e && e.message ? e.message : 'delivery-failed' }))
    return true // async
  }
  // Pre-flight sign-in / enrollment check across marketplaces (no upload).
  if (msg.type === 'MVP_STOREFRONT_PREFLIGHT') {
    const domains = Array.isArray(msg.domains) ? msg.domains : []
    if (domains.length === 0) { sendResponse({ ok: true, results: [] }); return false }
    preflightStorefronts(domains)
      .then((results) => sendResponse({ ok: true, results }))
      .catch((e) => sendResponse({ ok: false, error: e && e.message ? e.message : 'preflight-failed' }))
    return true // async
  }
  // Start (or check) the Amazon earnings sync — CC and EPC per month per store,
  // read by replaying the reporting page's own calls in the creator's session.
  if (msg.type === 'MVP_EARNINGS_SYNC') {
    if (_earnJob && !_earnJob.done) { sendResponse({ ok: true, already: true, status: earningsJobStatus() }); return false }
    void syncAmazonEarnings({ from: msg.from, to: msg.to, stores: msg.stores })
    sendResponse({ ok: true, started: true })
    return false
  }
  if (msg.type === 'MVP_EARNINGS_STATUS') {
    sendResponse({ ok: true, status: earningsJobStatus() })
    return false
  }
  // Live per-marketplace progress for the app's bars. Synchronous + tiny.
  if (msg.type === 'MVP_STOREFRONT_STATUS') {
    sendResponse({ ok: true, progress: _sfProgress })
    return false
  }
  // DIAGNOSTIC: hand back what the real Creator Hub sent on its own create-API
  // calls, so a rejected publish can be compared against Amazon's own request.
  if (msg.type === 'MVP_STOREFRONT_DEBUG') {
    ;(async () => {
      let log = _sfCreateLog
      if (!log || log.length === 0) {
        try { const s = await chrome.storage.local.get('mvpSfCreateLog'); log = (s && s.mvpSfCreateLog) || [] } catch (e) { log = [] }
      }
      sendResponse({ ok: true, log: log })
    })()
    return true // async
  }
  // Open a marketplace's Creator Hub in the foreground so the user can sign in.
  if (msg.type === 'MVP_STOREFRONT_LOGIN') {
    openStorefrontLogin(String(msg.domain || 'amazon.com'))
      .then((tabId) => sendResponse({ ok: true, tabId }))
      .catch((e) => sendResponse({ ok: false, error: e && e.message ? e.message : 'login-open-failed' }))
    return true // async
  }
  // DIAGNOSTIC (from the MVP app): report what the net-hook captured on Creator
  // Connections and whether a send recipe was learned — so a failed send can be
  // tuned against Amazon's REAL request instead of guessing. Synchronous.
  if (msg.type === 'MVP_CC_DEBUG') {
    // The MV3 worker sleeps after ~30s idle and wipes in-memory state, so the last
    // send's diagnostic (and creatorId) may only survive in storage by the time the
    // app asks. Read storage as the fallback so the debug is never falsely empty.
    ;(async () => {
      try {
        const trunc = (s, n) => { const t = typeof s === 'string' ? s : ''; return t.length > n ? t.slice(0, n) + `…(+${t.length - n})` : t }
        const ring = (_ccNetRing || []).map((r) => ({
          via: r.via, method: r.method, url: trunc(r.url, 220),
          headerKeys: Object.keys(r.headers || {}), body: trunc(r.body, 4000), ts: r.ts,
        }))
        const summ = (r) => r ? { method: r.method, url: trunc(r.url, 220), headerKeys: Object.keys(r.headers || {}), bodyTemplate: trunc(r.bodyTemplate, 900), learnedAt: r.learnedAt } : null
        const responses = (_ccRespRing || []).map((r) => ({ url: trunc(r.url, 160), status: r.status, body: trunc(r.body, 6000), ts: r.ts }))
        let lastSend = _ccLastSendDiag
        let creatorId = _ccCreatorId
        if (!lastSend || !creatorId) {
          try {
            const st = await chrome.storage.local.get(['ccLastSendDiag', 'ccCreatorId'])
            if (!lastSend && st && st.ccLastSendDiag) lastSend = st.ccLastSendDiag
            if (!creatorId && st && st.ccCreatorId) creatorId = st.ccCreatorId
          } catch (e) {}
        }
        sendResponse({
          ok: true,
          hasRecipe: !!(_ccSendRecipe && _ccSearchRecipe),
          recipe: summ(_ccSendRecipe), searchRecipe: summ(_ccSearchRecipe),
          ringCount: ring.length, ring, responses, creatorId,
          creatorName: _ccCreatorName || null,
          lastSend: lastSend || null,
          lastSendFromStorage: (!_ccLastSendDiag && !!lastSend) || undefined,
        })
      } catch (e) { sendResponse({ ok: false, error: e && e.message ? e.message : 'debug-failed' }) }
    })()
    return true // async response
  }
  // Hand the MVP app the learned send/search recipe TEMPLATES so it can back them
  // up to the creator's account (durable across reinstalls + build switches). We
  // return ONLY {url, method, bodyTemplate} — never headers/cookies.
  if (msg.type === 'MVP_CC_GET_RECIPE') {
    ensureRecipesLoaded().then(() => {
      const tpl = (r) => (r && typeof r.bodyTemplate === 'string')
        ? { url: r.url, method: r.method || 'POST', bodyTemplate: r.bodyTemplate } : null
      sendResponse({ ok: true, send: tpl(_ccSendRecipe), search: tpl(_ccSearchRecipe) })
    }).catch(() => sendResponse({ ok: true, send: null, search: null }))
    return true // async
  }
  // Restore a backed-up recipe INTO SCOUT — but only when it has none learned
  // locally, so a fresh real send (always the truest) is never overwritten by a
  // stale server copy. Validates the same new-format placeholders learnSendRecipe
  // requires, so a malformed backup can't poison replay.
  if (msg.type === 'MVP_CC_SET_RECIPE') {
    ensureRecipesLoaded().then(() => {
      let applied = false
      try {
        const okSend = msg.send && typeof msg.send.bodyTemplate === 'string'
          && msg.send.bodyTemplate.includes(CTX_PLACEHOLDER) && msg.send.bodyTemplate.includes(MSG_PLACEHOLDER)
        const okSearch = msg.search && typeof msg.search.bodyTemplate === 'string' && msg.search.bodyTemplate.includes(CAMPAIGN_PLACEHOLDER)
        if (okSend && okSearch && !(_ccSendRecipe && _ccSearchRecipe)) {
          _ccSendRecipe = { url: msg.send.url, method: msg.send.method || 'POST', headers: {}, bodyTemplate: msg.send.bodyTemplate, learnedAt: Date.now(), restored: true }
          _ccSearchRecipe = { url: msg.search.url, method: msg.search.method || 'POST', headers: {}, bodyTemplate: msg.search.bodyTemplate, learnedAt: Date.now(), restored: true }
          try { chrome.storage.local.set({ ccSendRecipe: _ccSendRecipe, ccSearchRecipe: _ccSearchRecipe }) } catch (e) {}
          applied = true
        }
      } catch (e) {}
      sendResponse({ ok: true, applied })
    }).catch(() => sendResponse({ ok: false }))
    return true // async
  }
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
  if (msg.type === 'MVP_STUDIO_FINISH') {
    // Drive the Studio-only fields the Data API can't set (paid promotion,
    // notify-subscribers, monetization + ad self-cert, end screen), on the ONE
    // video, only the items the user ticked. Opens up to 3 Studio panels, so
    // allow the full 185s the dashboard waits.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 185000)
    scanStudioFinish(msg.videoId, msg.opts || {}, callerTabId)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, steps: [], error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version })
    return // sync response
  }
  if (msg.type === 'MVP_SCAN_IDEA_LIST') {
    // Read a full idea list in a BACKGROUND tab (user stays in MVP), then close it.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 120000)
    scanIdeaListBackground(msg.url)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response
  }
  if (msg.type === 'MVP_SCAN_STOREFRONT') {
    // Enumerate the storefront's idea lists in a BACKGROUND tab, then close it.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 120000)
    scanStorefrontBackground(msg.url)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response
  }
  if (msg.type === 'MVP_SCAN_EARNINGS') {
    // One-click storefront sync: scrape the Amazon earnings report (current view
    // + quick-ranges) in a BACKGROUND tab, push to MVP, then close.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 120000)
    scanStorefrontEarningsBackground()
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response
  }
  if (msg.type === 'MVP_SCAN_CREATORHUB_VIDEOS') {
    // Read the Creator Hub video table (each row → a product ASIN) in a
    // BACKGROUND tab and record which products the creator has a video for.
    //
    // This wait must sit ABOVE the in-page wall clock, not below it. At 175s
    // against an in-page budget of 240s, a big library was cut off mid crawl and
    // reported as a timeout even though the scan was still working.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 290000)
    scanCreatorHubVideosBackground(msg.url)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response
  }
  if (msg.type === 'MVP_SCAN_STOREFRONT_CATALOG') {
    // Walk the creator's PUBLIC storefront (idea lists → product tiles) in a
    // BACKGROUND tab and record every product, past the earnings ~100 cap.
    // Bigger crawl (many lists), so allow the full timeout.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 175000)
    scanStorefrontCatalogBackground(msg.url)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response
  }
  if (msg.type === 'MVP_SCAN_CC_CATALOG') {
    // Admin-only: refresh the SHARED CC catalog. Clicks Amazon's two "Download
    // all …" buttons in a BACKGROUND tab, captures + unzips + parses the CSV
    // ZIPs, stages the rows, and arms the server-side drain. Amazon builds the
    // export server-side (can take minutes), so this gets a long channel.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 780000)
    scanCcCatalogBackground()
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response
  }
  if (msg.type === 'MVP_EPC_LOAD_START') {
    // Start (or re-attach to) the EPC API loader — the ViralVue-style paginated
    // load. Long-running, so we DON'T await: kick it off, return the job snapshot
    // immediately, and let the MVP tab poll MVP_EPC_LOAD_POLL for the live count.
    if (_epcJob && !_epcJob.done) { sendResponse({ ok: true, already: true, ..._epcSnapshot() }); return false }
    loadEpcViaApi().catch(() => {}) // fire-and-forget; state lives in _epcJob
    sendResponse({ ok: true, started: true, ..._epcSnapshot() })
    return false
  }
  if (msg.type === 'MVP_EPC_LOAD_POLL') {
    sendResponse({ ok: true, ..._epcSnapshot() })
    return false
  }
  if (msg.type === 'MVP_EPC_LOAD_CANCEL') {
    if (_epcJob && !_epcJob.done) _epcJob.canceled = true
    sendResponse({ ok: true, ..._epcSnapshot() })
    return false
  }
  if (msg.type === 'MVP_YT_INJECT_DISCLOSURES') {
    // Inject disclosures into Studio's OWN signed metadata_update (dirty + Save).
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 60000)
    ytInjectDisclosures(msg.videoId, msg.opts || {}, callerTabId)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true
  }
  if (msg.type === 'MVP_YT_APPLY_DISCLOSURES') {
    // Replay YouTube's own metadata_update to set paid-promotion / AI / monetize
    // via the internal API (no clicking). Admin test path.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 60000)
    ytApplyDisclosures(msg.videoId, msg.opts || {})
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true
  }
  if (msg.type === 'MVP_YT_RECIPE') {
    // Return the Studio save requests the yt-hook captured (newest first), so
    // the co-pilot "Learn Studio save" flow can surface the real request shape
    // we build the disclosure replay from. Truncate bodies so the message stays
    // small.
    try {
      chrome.storage.local.get(['mvp_yt_recipes'], (o) => {
        const list = Array.isArray(o && o.mvp_yt_recipes) ? o.mvp_yt_recipes : []
        const trunc = (s, n) => { const t = typeof s === 'string' ? s : ''; return t.length > n ? t.slice(0, n) + `…(+${t.length - n})` : t }
        sendResponse({ ok: true, recipes: list.map((r) => ({ via: r.via, url: r.url, headerKeys: Object.keys(r.headers || {}), headers: r.headers, body: trunc(r.body, 12000), ts: r.ts })) })
      })
    } catch (e) { sendResponse({ ok: false, error: e && e.message ? e.message : 'recipe-failed' }) }
    return true // async (storage) response
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
  if (msg.type === 'MVP_AMZ_ASIN_CHECK') {
    // Video Launchpad geo check: is this ASIN listed on the given marketplace?
    // Read the real /dp page in the creator's own session (unblockable), for
    // marketplaces Keepa can't answer (e.g. amazon.com.au). One background tab.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, status: 'unknown', error: 'timeout' }), 40000)
    checkAmazonAsinListed(msg.asin, msg.domain, callerTabId)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, status: 'unknown', error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_AMZ_RESOLVE_ASIN') {
    // Video Launchpad: find the product's LOCAL ASIN in a marketplace where the
    // US ASIN isn't listed, by brand + title search in the creator's own session.
    // One background search tab; confidence-gated.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 60000)
    resolveLocalAsin(msg.brand, msg.title, msg.sourceAsin, msg.domain, callerTabId)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_CC_SCAN') {
    // Scraping the virtualized grid (open/focus + deep scroll harvest) can take a
    // while on a huge opportunities list (20k+ with no export), so allow ~2.5 min
    // — the in-page scroll self-limits to ~95s, this sits above it with margin.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 150000)
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
  if (msg.type === 'MVP_YT_TRANSCRIPT') {
    // MVP asks us to pull the video's transcript from the user's own browser
    // session (reaches private drafts; no server quota) so the metadata
    // generator can ground titles in what the video actually says.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 45000)
    fetchYouTubeTranscript({ youtubeVideoId: msg.youtubeVideoId, callerTabId })
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
  if (msg.type === 'MVP_CC_ACCEPT_AND_SEND') {
    // One-tab flow for "Send on Creator Connections": accept the campaign if it
    // isn't already, then send the message — all in a single background tab so
    // there's no cross-tab teardown race. Accept (~up to 90s) + send (~75s) →
    // allow 3 minutes.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 180000)
    acceptAndSendBrand(msg.detailsUrl, msg.message || '', callerTabId, msg.asin || null)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_CC_CHATS') {
    // Read the creator's brand-chat inbox (Creator Connections "Messages") in a
    // hidden tab, so MVP can flag brands that replied.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 40000)
    getBrandChats()
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true
  }
  if (msg.type === 'MVP_CC_SEND_BY_ASIN') {
    // FULLY BACKGROUND, catalog-free: SCOUT resolves the ASIN to the creator's
    // accepted campaign via Amazon's own API, looks up the brand chat token, and
    // posts the recap — all in a hidden tab. campaignIds are optional catalog hints.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 120000)
    sendByAsinApi(msg.asin || '', msg.message || '', msg.campaignIds || [])
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true
  }
  if (msg.type === 'MVP_CC_SEND_BY_CAMPAIGN') {
    // DIRECT path: the app resolved the product's ASIN to campaign_id(s) in the
    // shared catalog and hands them here. We deep-link straight to the campaign
    // and accept+send — no grid search. Same ~3 minute budget as accept+send.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 180000)
    sendByCampaignIds(msg.campaignIds || [], msg.message || '', msg.asin || null, callerTabId, msg.fallbackCampaignIds || [])
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_CC_MY_CAMPAIGNS') {
    // List the creator's accepted/active campaigns from Amazon (their real CC
    // dashboard), so MVP's "Joined only" can show everything they've joined —
    // including campaigns joined directly on Amazon, not just via MVP.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 90000)
    // Optional keyword narrows the query server-side (Amazon's own search) so any
    // of the creator's joined campaigns is findable — even at 100k+ — without
    // pulling them all. maxPages caps the fetch for a responsive live search.
    listMyCampaignsApi({ keyword: msg.keyword || '', maxPages: msg.maxPages })
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_CC_BRAND_SEARCH') {
    // LIVE brand search of NEW opportunities in the creator's own grid — the
    // top-up that makes Browse match Amazon's live count. Opens the opportunity
    // grid, replays its collaboration/search filtered by the brand keyword, and
    // returns the campaigns. Keyword-narrowed, so a few pages ≈ one brand's set.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 95000)
    listMyCampaignsApi({ keyword: msg.keyword || '', opportunities: true, maxPages: msg.maxPages || 20 })
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
    ccFindCampaign(msg.query || '', msg.asin || '', callerTabId, msg.brand || null, msg.campaignIds || null)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_CC_SMART') {
    // MVP Smart Scan: full-grid sweep + up to ~25 paced deep-checks. The content
    // loop self-limits to 270s of deep-checking; scan + tab setup adds ~60-90s,
    // so allow 7 minutes end-to-end.
    const callerTabId = sender && sender.tab ? sender.tab.id : null
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 420000)
    ccSmartScan(msg.rules || {}, msg.keyword || '', callerTabId)
      .then((res) => { clearTimeout(timeout); sendResponse(res) })
      .catch((e) => { clearTimeout(timeout); sendResponse({ ok: false, error: e && e.message ? e.message : 'error' }) })
    return true // async response — keep the channel open
  }
  if (msg.type === 'MVP_CC_VERIFY') {
    // Catalog-first "Campaigns ON": verify a shortlist of {campaignId, asin, …}
    // (pre-filtered by the app from the shared CC catalog) straight on each /dp.
    // Up to 25 paced deep-checks — allow 7 minutes end-to-end.
    const timeout = setTimeout(() => sendResponse({ ok: false, error: 'timeout' }), 420000)
    verifyCatalogAsins(msg.candidates || [], msg.rules || {})
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
    // Paginates the search to a ~100 pool + deep-checks up to `maxDeep` (hard-
    // capped at 25 per the Amazon-throttle rule — a /dp visit each), so allow
    // a generous ceiling; the timeout is a safety net, not the expected runtime.
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
async function sendBrandMessageInPage(message, maxOpenTries) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const textOf = (el) => norm(el && (el.innerText || el.textContent))
  // Include el.value so an <input type="submit" value="Send"> is matchable — its
  // label is in .value, not innerText/textContent, so without this findSend
  // couldn't see the Send button on the brand-chat page (typed but never sent).
  const attrText = (el) => norm((el.innerText || el.textContent || el.value || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || ''))
  const findMsgBtn = () => {
    const c = [...document.querySelectorAll('button,a,[role="button"]')]
    return c.find((e) => /message brand|message the brand/i.test(textOf(e)))
      || c.find((e) => /message/i.test(textOf(e)) && /brand/i.test(textOf(e)))
      // Accepted campaigns sometimes label the chat opener just "Message" (or
      // "Send a message"). Accept a SHORT bare-message label, but only on a real
      // BUTTON/role=button (never an <a> nav link, which would navigate away).
      || c.find((e) => (e.tagName === 'BUTTON' || e.getAttribute('role') === 'button')
        && /^(message|send a message|message seller|contact brand)$/i.test(textOf(e)))
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
  // After Send, Amazon pops a "you're about to share personal information" warning
  // (on messages carrying an address / email / phone) with a Continue button. We
  // MUST click it or the message never posts and the whole send stalls → timeout.
  // It renders as a PLAIN modal (often NOT role="dialog"), and Amazon keeps
  // rewording it, so cast a WIDE net: scope to any element whose text reads like
  // the warning, then click the affirmative button (never Cancel / Edit / Go
  // back). NO visibility check — a background tab has no layout.
  const isConfirmText = (t) => /^(continue|ok|okay|yes|yes,?\s*(continue|send)?|send|send message|send it|send anyway|send now|i understand|understood|got it|proceed|agree|i agree|accept|acknowledge|confirm|share|share anyway)$/i.test(t)
  const isDismissText = (t) => /^(cancel|go back|back|edit|edit message|no|no,?\s*thanks|close|dismiss|review|keep editing|return)$/i.test(t)
  // The CC compose box ALWAYS shows a static advisory under it: "If you choose to
  // share personal information such as your address, email address or phone
  // number in messages, please be aware that subsequent use of this information
  // will not be monitored." That is NOT the confirm popup — matching it made us
  // re-click Send (→ duplicate messages). Exclude it explicitly, and require the
  // text to read like an actual are-you-sure prompt.
  const isStaticAdvisory = (tx) => /if you choose to share|will not be monitored|subsequent use of this information/i.test(tx)
  const looksLikePiModal = (el) => {
    const tx = norm(el && (el.textContent || ''))
    if (!tx || tx.length > 2500) return false
    if (isStaticAdvisory(tx)) return false
    return /personal information|share (personal|sensitive|your (address|contact))|sharing (personal|sensitive|your)|about to share|contains (personal|sensitive)|sensitive information|your (address|phone|email)( |,|\.|\swill)/i.test(tx)
  }
  let lastPiText = ''
  const findConfirmOk = () => {
    // Scope to any container whose TEXT reads like the personal-info warning
    // (covers plain modals AND role=dialog / a-modal / a-popover variants), then
    // pick the affirmative action inside it — explicit confirm word, else the
    // Amazon primary button, else the sole non-dismiss action. Dismiss buttons
    // (Cancel / Edit / Go back) are always excluded so we never abort the send.
    // Scan modal/popover overlays AND generic containers — the personal-info
    // confirm sometimes renders as a plain div, not a role=dialog. This is safe
    // because looksLikePiModal EXCLUDES the always-present static advisory (via
    // isStaticAdvisory), so the compose area — which holds the real Send button —
    // is never matched, and its Send is never re-clicked (the old duplicate bug).
    const roots = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],.a-modal,.a-modal-scroller,.a-popover,.a-popover-wrapper,[data-a-modal],[data-a-popover],div,section,form')]
      .filter(looksLikePiModal)
    // Innermost first (tightest wrapper around the warning, not document.body).
    roots.sort((a, z) => norm(a.textContent).length - norm(z.textContent).length)
    for (const root of roots) {
      const btns = [...root.querySelectorAll('button,[role="button"],input[type="submit"],a')]
        .filter((b) => !(b.disabled === true || b.getAttribute('aria-disabled') === 'true'))
        .filter((b) => { const t = attrText(b); return t && !isDismissText(t) })
      const btn = btns.find((b) => isConfirmText(attrText(b)))
        || btns.find((b) => /a-button-primary/.test(b.className || ''))
        || (btns.length === 1 ? btns[0] : null)
      if (btn) { lastPiText = norm(root.textContent).slice(0, 240); return btn }
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
  // maxOpenTries lets the direct/visible path use a SHORTER poll (~8s vs ~21s) so
  // a page with no message box is reported quickly instead of stalling per attempt.
  const openTries = Math.max(6, maxOpenTries || 60)
  let input = findInput()
  for (let t = 0; t < openTries && !input; t++) {
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
  // → the box clears → fill the next → Send again. ONE Send per marker.
  void readInput
  const boxEmpty = (inp) => { try { return norm(readInput(inp)).length === 0 } catch (e) { return false } }
  // Exactly ONE click gesture. realClick already dispatches a full
  // pointerdown→…→click sequence (one submit). The old clickHard also called
  // el.click() on top → TWO submits → every message posted twice. Never again.
  const segments = splitSegments(message)
  let sent = 0
  const segLog = []
  for (let i = 0; i < segments.length; i++) {
    const inp = findInput() || input
    setInput(inp, segments[i]); steps.filled = true
    await sleep(650)                                 // let React register the text + enable Send
    let send = null
    for (let t = 0; t < 24 && !send; t++) {          // wait up to ~6s for Send to enable
      send = findSend(inp.el.closest('[role="dialog"],form,section,div') || document) || findSend(document)
      if (!send) await sleep(250)
    }
    if (!send) { segLog.push({ seg: i + 1, sent: false, reason: 'send-never-enabled' }); break }
    // Amazon's Send responds to a NATIVE click (a synthetic realClick fills the
    // box fine but never actually submits — that was "types but never sends").
    // ONE native click; the duplicate we had before came from the settle loop
    // re-clicking the static advisory, which is now excluded.
    try { send.click() } catch (e) { realClick(send) }
    sent++; steps.sent = true
    // SETTLE. Amazon may pop a "sharing personal information" confirm (address /
    // email / phone messages). Keep clicking Continue and waiting until the box
    // CLEARS (= message actually posted) or the window elapses — RETRYING the
    // click across ticks because the modal renders a beat after Send and one
    // synthetic click doesn't always take. This is the fix for the send stalling
    // out (→ timeout) on personal-info messages: dismiss the popup and carry on
    // with the rest of the messages until every one is delivered.
    let dismissed = false, cleared = false, quiet = 0
    for (let k = 0; k < 30; k++) {                   // hard ceiling ~11s per message
      const ok = findConfirmOk()
      if (ok) { try { ok.click() } catch (e) { realClick(ok) } dismissed = true; quiet = 0; await sleep(450); continue }
      if (boxEmpty(inp)) { cleared = true; break }
      // Once the PI popup has been dismissed and stays gone for a few ticks, the
      // message has posted even if the box text lingers — don't burn the budget.
      if (dismissed && ++quiet >= 4) { cleared = boxEmpty(inp); break }
      await sleep(350)
    }
    segLog.push({ seg: i + 1, sent: true, dismissedPiDialog: dismissed, boxCleared: cleared, piText: dismissed ? lastPiText : undefined })
    await sleep(700)
  }
  try { console.debug('[MVP SCOUT] brand-send', { groups: sent, segments: segments.length, log: segLog }) } catch (e) {}
  if (sent === 0) {
    return { ok: false, steps, reason: 'send-button-not-found', groups: 0,
      diag: { filled: steps.filled, sendCandidates: sendCandidatesDump(), segLog } }
  }
  return { ok: true, steps, groups: sent, diag: { segLog } }
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
// Combined "accept-if-needed, then send" in ONE background tab. This is the
// reliable path for MVP's "Send on Creator Connections": doing accept and send
// as two separate tab operations (each opens + closes its own tab) raced and
// threw "Frame with ID 0 was removed". Here a single tab is opened on the
// campaign, we accept it when an Accept button is present (an un-accepted
// opportunity has no brand chat until you accept), then send on the SAME tab.
async function acceptAndSendBrand(detailsUrl, message, callerTabId, wantAsin, fast) {
  if (!detailsUrl) return { ok: false, error: 'no-url' }
  if (!message || !message.trim()) return { ok: false, error: 'no-message' }
  const want = String(wantAsin || '').toUpperCase()
  const wantValid = /^[A-Z0-9]{10}$/.test(want)
  // Step log so a stall is diagnosable in the SCOUT background console.
  const t0 = Date.now()
  const step = (s) => { try { console.debug('[MVP SCOUT] send-step', s, `${Date.now() - t0}ms`, detailsUrl.slice(0, 90)) } catch (e) {} }
  let tabId = null
  const runAccept = async () => {
    for (let i = 0; i < 4; i++) {
      const ar = await chrome.scripting.executeScript({ target: { tabId }, func: acceptCampaignInPage })
      const r = ar && ar[0] && ar[0].result
      if (r && r.ok) return true
      await _sleep(700)
    }
    return false
  }
  // ONE send attempt — never a blind retry. sendBrandMessageInPage posts each
  // message-group segment as it goes, so re-running it re-posts everything (the
  // duplicate-message bug). Return whatever it reports (ok or not) so the caller
  // can decide from `groups` whether anything actually went out.
  const runSend = async () => {
    const res = await chrome.scripting.executeScript({ target: { tabId }, func: sendBrandMessageInPage, args: [message] })
    return (res && res[0] && res[0].result) || null
  }
  const reload = async () => {
    try { await chrome.tabs.update(tabId, { url: detailsUrl }); await waitForTabLoad(tabId, 14000); await _sleep(1200) } catch (e) {}
  }
  try {
    step('open')
    const tab = await chrome.tabs.create({ url: detailsUrl, active: false })
    tabId = tab.id
    await waitForTabLoad(tabId, 14000)
    await _sleep(1200)
    step('loaded')
    // Offsite store fix (CC is blocked on an onsite store id).
    try {
      const sres = await chrome.scripting.executeScript({ target: { tabId }, func: ensureOffsiteStoreInPage })
      const sw = sres && sres[0] && sres[0].result
      if (sw && sw.switched) { await _sleep(1500); await reload() }
    } catch (e) {}

    // WRONG-BRAND GUARD. Before we type a single character, confirm the campaign
    // we opened actually sells the ASIN we meant to message about. A stale/mis-
    // keyed cached detailsUrl (or a bad find) would otherwise send the recap to a
    // completely different brand. Read the page's ASINs: if we can read some and
    // ours ISN'T among them, abort. If we can't read any (page didn't expose
    // them), proceed — never block on inability to read, only on a real mismatch.
    if (wantValid) {
      try {
        const ar = await chrome.scripting.executeScript({ target: { tabId }, func: harvestAsinsInPage })
        const r = (ar && ar[0] && ar[0].result) || { asins: [], blocked: false }
        const onPage = (r.asins || []).map((a) => String(a || '').toUpperCase())
        if (!r.blocked && onPage.length > 0 && !onPage.includes(want)) {
          return { ok: false, reason: 'asin-mismatch', diag: { want, onPage: onPage.slice(0, 8) } }
        }
      } catch (e) { /* couldn't read — don't block the send */ }
    }

    // Accept if there's an Accept button (un-accepted opportunity). Not finding
    // one means it's already accepted — fine, go straight to send.
    step('accept')
    let accepted = await runAccept()
    if (accepted) await reload() // let the brand chat open after accepting

    // Send on the same tab.
    step('send')
    let sr = await runSend()
    step('sent:' + (sr && sr.ok ? 'ok' : (sr && sr.reason) || 'no'))
    // Only RE-SEND when nothing at all went out (groups falsy) AND the box never
    // opened — the signature of an un-accepted campaign whose Accept button
    // didn't render headless. If any segment posted, we do NOT resend (that would
    // duplicate). The `fast` path (direct-by-campaign) SKIPS this expensive
    // foreground fallback — it eats ~60s and pushes the whole thing past the
    // timeout; a direct-URL miss is better reported quickly than retried.
    const nothingSent = !sr || (!sr.ok && !(sr.groups > 0))
    if (nothingSent && !accepted && !fast) {
      step('fallback-fg')
      try {
        await chrome.tabs.update(tabId, { active: true }); await _sleep(1500)
        accepted = await runAccept()
      } catch (e) {}
      finally { if (callerTabId != null) { try { await chrome.tabs.update(callerTabId, { active: true }) } catch (e) {} } }
      if (accepted) { await reload(); sr = await runSend() }
    }
    if (sr && sr.ok) return { ...sr, accepted }
    return sr || { ok: false, reason: 'send-failed', accepted }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'exception' }
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId) } catch (e) {} }
  }
}

// Keep the MV3 service worker alive during a long operation. Chrome reclaims an
// idle worker after ~30s; every extension-API call resets that timer, so we ping
// a cheap one every 20s. Returns a token to pass back to stopKeepAlive. Bridges
// any quiet stretch between the send's own chrome.* calls so a reclaim can't kill
// the in-flight reply (which the app would then see as a bare "timeout").
function startKeepAlive() {
  let timer = null
  try {
    timer = setInterval(() => {
      try { chrome.runtime.getPlatformInfo(() => { void chrome.runtime.lastError }) } catch (e) {}
    }, 20000)
  } catch (e) {}
  return timer
}
function stopKeepAlive(token) {
  try { if (token != null) clearInterval(token) } catch (e) {}
}

// DIRECT SEND by catalog campaign id(s) — VISIBLE-TAB approach.
//
// The old invisible/background-tab automation kept dying as "timeout": Amazon's
// Creator Connections chat is React-heavy, and Chrome THROTTLES timers + rendering
// in background tabs, so the Send button often never enabled and the MV3 worker
// got reclaimed mid-send. No amount of budget tuning fixes that — a background tab
// simply isn't a reliable place to drive that UI.
//
// New way: open the campaign chat in ONE REAL, FOCUSED tab (visible tabs render
// normally, so Send actually enables and clicks), walk the candidate campaigns in
// that same tab, pre-fill the recap and auto-send. If auto-send can't complete, we
// LEAVE THE TAB OPEN with the message already typed in, so the user finishes with a
// single click — never a silent timeout. The app looks the ASIN up in the shared
// catalog and hands us the campaign_id(s); we deep-link straight to each.
async function sendByCampaignIds(campaignIds, message, asin, callerTabId, fallbackCampaignIds) {
  const uniq = (a) => [...new Set((a || []).map((c) => String(c || '').trim()).filter(Boolean))]
  const ids = uniq(campaignIds).slice(0, 2)
  // Keep the fan-out SMALL and FAST: at most the product's own campaign(s) + ONE
  // brand-fallback. Walking every brand campaign with a 20s load each is what made
  // this take ~5 minutes for nothing.
  const fbids = uniq(fallbackCampaignIds).filter((id) => !ids.includes(id)).slice(0, 1)
  if (!ids.length && !fbids.length) return { ok: false, error: 'no-campaign' }
  if (!message || !message.trim()) return { ok: false, error: 'no-message' }
  // Candidates: the product's OWN campaign(s) first (ASIN-guarded so we never
  // message the wrong brand), then ONE BRAND-fallback (CC messaging is per brand —
  // any live campaign from the same brand reaches the same chat — so no ASIN
  // guard). All driven through ONE tab, so no tab spam.
  const candidates = [
    ...ids.map((id) => ({ id, wantAsin: asin })),
    ...fbids.map((id) => ({ id, wantAsin: null })),
  ]

  // ── FAST PATH — pure-API replay, no DOM, INVISIBLE. If SCOUT has learned
  // Amazon's send API from a prior send, message the brand by replaying
  // chat/search → chat/message/send in a hidden tab (cookie-authed, same origin).
  // Try each candidate campaignId; the first that resolves a contextToken (an
  // accepted brand chat) and posts wins. Falls through to the visible DOM flow if
  // no recipe yet, or the brand isn't accepted (no contextToken), or a call fails.
  await ensureRecipesLoaded()
  if (_ccSendRecipe && _ccSearchRecipe) {
    const kaFast = startKeepAlive()
    let apiTab = null
    try {
      apiTab = await chrome.tabs.create({ url: 'https://affiliate-program.amazon.com/p/connect/requests?status=opportunity&type=affiliate-plus', active: false })
      await waitForTabLoad(apiTab.id, 15000)
      await _sleep(800)
      for (const c of candidates) {
        const r = await ccApiReplayOne(apiTab.id, message, c.id)
        // Stop on ANY delivery (ok OR partial) — never re-send to another candidate
        // (often the same brand chat), which would duplicate messages.
        if (r && (r.ok || r.groups > 0)) return { ok: !!r.ok, partial: !r.ok && r.groups > 0, reason: r.ok ? undefined : 'partial', groups: r.groups, campaignId: c.id, viaReplay: true }
      }
    } catch (e) { /* fall through to the visible DOM flow */ }
    finally { if (apiTab != null) { try { await chrome.tabs.remove(apiTab.id) } catch (e) {} } stopKeepAlive(kaFast) }
  }

  // Hard ~80s budget with short per-step waits so we hand off quickly instead of
  // grinding. Better to leave a filled tab for a one-click finish than to march.
  const startedAt = Date.now()
  const timeLeft = () => 80000 - (Date.now() - startedAt)
  const keepAlive = startKeepAlive()
  const want = (a) => String(a || '').toUpperCase()
  const wantValid = (a) => /^[A-Z0-9]{10}$/.test(want(a))
  let tabId = null
  let last = null
  const load = async (url) => { await chrome.tabs.update(tabId, { url, active: true }); await waitForTabLoad(tabId, 12000); await _sleep(1200) }
  try {
    // ONE visible, focused tab for the whole flow.
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true })
    tabId = tab.id
    for (const c of candidates) {
      // A campaign is either affiliate-plus or spcc; the type just picks the view.
      // Try affiliate-plus, then spcc for the SAME id only if the box never opened
      // (or the ASIN didn't match) — a real send failure returns straight away with
      // the tab left open for a manual click.
      for (const type of ['affiliate-plus', 'spcc']) {
        if (timeLeft() < 18000) return { ...(last || { ok: false, reason: 'send-failed' }), leftOpen: tabId != null }
        const url = ccCampaignUrl(c.id, type)
        try { await load(url) } catch (e) { last = { ok: false, error: 'nav' }; continue }
        // Offsite-store fix (CC is blocked on an onsite store id).
        try {
          const sres = await chrome.scripting.executeScript({ target: { tabId }, func: ensureOffsiteStoreInPage })
          const sw = sres && sres[0] && sres[0].result
          if (sw && sw.switched) { await _sleep(1200); await load(url) }
        } catch (e) {}
        // WRONG-BRAND GUARD — only for the product's own campaign(s).
        if (wantValid(c.wantAsin)) {
          try {
            const ar = await chrome.scripting.executeScript({ target: { tabId }, func: harvestAsinsInPage })
            const r = (ar && ar[0] && ar[0].result) || { asins: [], blocked: false }
            const onPage = (r.asins || []).map((a) => want(a))
            if (!r.blocked && onPage.length > 0 && !onPage.includes(want(c.wantAsin))) { last = { ok: false, reason: 'asin-mismatch' }; continue }
          } catch (e) {}
        }
        // Accept the opportunity if there's an Accept button (no chat until accepted).
        let accepted = false
        for (let i = 0; i < 3; i++) {
          const ar = await chrome.scripting.executeScript({ target: { tabId }, func: acceptCampaignInPage })
          const r = ar && ar[0] && ar[0].result
          if (r && r.ok) { accepted = true; await load(url); break }
          await _sleep(600)
        }
        // After ACCEPTING here (the API fast path can't accept — it only messages
        // an already-accepted brand), the brand chat now exists, so try the pure-API
        // replay once more on THIS tab before falling back to DOM clicking.
        if (_ccSendRecipe && _ccSearchRecipe) {
          const r = await ccApiReplayOne(tabId, message, c.id)
          // Stop on ANY delivery (ok OR partial) — don't also DOM-send (duplicate).
          if (r && (r.ok || r.groups > 0)) return { ok: !!r.ok, partial: !r.ok && r.groups > 0, groups: r.groups, campaignId: c.id, detailsUrl: url, accepted, viaReplay: true }
        }
        // Fill + auto-send in the FOREGROUND, where the button actually enables.
        // Short box-poll (~8s) so a page with no message box is reported fast. This
        // also (via the net-hook) TEACHES the send/search recipes for next time.
        const sres2 = await chrome.scripting.executeScript({ target: { tabId }, func: sendBrandMessageInPage, args: [message, 24] })
        const sr = (sres2 && sres2[0] && sres2[0].result) || null
        last = sr
        if (sr && sr.ok) return { ...sr, campaignId: c.id, detailsUrl: url, accepted, leftOpen: true }
        // Box never opened → the other type view might be the right one. ASIN
        // mismatch already `continue`d above. Anything else (typed but Send not
        // found / not enabled) → stop here and leave the filled box for a manual
        // click; trying the other type would open a second empty chat.
        if (sr && (sr.reason === 'box-never-opened' || sr.reason === 'no-message-button')) continue
        return { ok: false, reason: (sr && sr.reason) || 'send-failed', campaignId: c.id, detailsUrl: url, accepted, leftOpen: true }
      }
    }
    return { ...(last || { ok: false, reason: 'send-failed' }), leftOpen: tabId != null }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'exception', leftOpen: tabId != null }
  } finally {
    // Intentionally DO NOT close the tab — on success it shows the sent message; on
    // failure it holds the pre-filled chat (or the campaign page to Accept) so the
    // user can finish by hand.
    stopKeepAlive(keepAlive)
  }
}

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
