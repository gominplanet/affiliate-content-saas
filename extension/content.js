/* MVP Affiliate — CC Scout content script
 *
 * Runs on Amazon Creator Connections. On a CC_SCAN message it scrolls
 * the (react-virtualized) campaign grid top-to-bottom, harvesting every
 * cell, and returns:
 *   [{ asin, campaignName, epc, endsAt }]
 *
 * ── DOM (calibrated against the live CC "New Opportunities" page) ────
 * Scroll container : div.ReactVirtualized__Grid__RequestList
 *                     (fixed height, overflow:auto, virtualized)
 * Inner sizer      : div.ReactVirtualized__Grid__innerScrollContainer
 * Campaign cell    : div[aria-label="B0XXXXXXXX"]  ← the ASIN itself
 *                     (absolutely positioned; only ~viewport rendered)
 * Card text        : brand + product title, "Estimated EPC: Up to $X",
 *                     "No end date" / an end date, price, rating.
 *
 * Because the grid is virtualized we must scroll it in steps and dedupe
 * by ASIN — a single snapshot only holds the visible rows.
 */

// Run-once guard. This file is auto-injected by the manifest AND re-injected by
// background.js's scan-retry (executeScript files:['content.js']), so it can
// load twice in the same page. The IIFE gives the top-level `const`s below
// function scope — otherwise the 2nd load redeclares them and throws
// "Identifier 'ASIN_RE' has already been declared". The flag makes the 2nd
// injection a clean no-op (and avoids a duplicate message listener).
;(function () {
  if (window.__mvpCcScoutLoaded) return
  window.__mvpCcScoutLoaded = true

  // ── SCOUT network hook wiring ────────────────────────────────────────────────
  // Inject net-hook.js into the PAGE'S OWN JS context (MAIN world) so it can see
  // the page's fetch/XHR — a content script (this file) runs in an isolated world
  // and cannot. The hook posts any Creator Connections message-send request back
  // via window.postMessage; we relay it to the background worker, which learns the
  // send "recipe" and replays it for future sends (no DOM clicking). Best-effort:
  // wrapped so a CSP that blocks the injected script never breaks the scanner.
  try {
    const s = document.createElement('script')
    s.src = chrome.runtime.getURL('net-hook.js')
    s.async = false
    ;(document.head || document.documentElement).appendChild(s)
    s.onload = () => { try { s.remove() } catch (e) {} }
  } catch (e) {}
  window.addEventListener('message', (ev) => {
    try {
      if (ev.source !== window) return
      const d = ev.data
      if (!d || d.__mvpNet !== true || !d.rec || (d.kind !== 'send-capture' && d.kind !== 'send-response')) return
      const p = chrome.runtime.sendMessage({ type: 'MVP_CC_NET_CAPTURE', kind: d.kind, rec: d.rec })
      if (p && p.catch) p.catch(() => {})
    } catch (e) {}
  })

const ASIN_RE = /^B0[A-Z0-9]{8}$/
const PRICE_RE = /\$\s?\d[\d.,]*/
const RATING_RE = /^\d(?:\.\d)?\s*(?:out of|★|stars)/i
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/
const DATE_TXT_RE = /\b([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})\b/

const NOISE_RE = /^(recommended|accept|accept all|new|sponsored|estimated epc|budget availability|no end date|add to|save|open product|ask creator|view details|learn more|see details|\$|\d)/i

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// Decode HTML entities — Amazon double-encodes some titles ("Wall &amp;").
const _dec = document.createElement('textarea')
function decodeEntities(s) {
  if (!s || s.indexOf('&') === -1) return s
  _dec.innerHTML = s
  let out = _dec.value
  if (out.indexOf('&') !== -1 && /&[a-z#0-9]+;/i.test(out)) { _dec.innerHTML = out; out = _dec.value }
  return out
}
const textOf = (n) => decodeEntities((n?.textContent || '').replace(/\s+/g, ' ').trim())

function findGrid() {
  // Prefer the requests list grid; fall back to any virtualized grid
  // that actually contains ASIN-labelled cells.
  const grids = [
    ...document.querySelectorAll(
      '.ReactVirtualized__Grid__RequestList, .ReactVirtualized__Grid',
    ),
  ]
  for (const g of grids) {
    if (g.querySelector('[aria-label]') &&
        [...g.querySelectorAll('[aria-label]')].some(e => ASIN_RE.test(e.getAttribute('aria-label') || ''))) {
      return g
    }
  }
  return grids[0] || null
}

function cellsIn(grid) {
  const out = []
  for (const el of grid.querySelectorAll('[aria-label]')) {
    const al = (el.getAttribute('aria-label') || '').trim().toUpperCase()
    if (ASIN_RE.test(al)) out.push({ asin: al, el })
  }
  return out
}

function extractCard(asin, el) {
  const full = textOf(el)

  // EPC — "Estimated EPC: Up to $0.38" → display string + numeric value
  let epc = null
  let epcValue = null
  const epcM = full.match(/Estimated EPC[:\s]*((?:Up to\s*)?\$\s?\d[\d.,]*)/i)
  if (epcM) {
    epc = epcM[1].replace(/\s+/g, ' ').trim()
    const n = epc.match(/\$\s?([\d.,]+)/)
    if (n) { const v = parseFloat(n[1].replace(/,/g, '')); if (!isNaN(v)) epcValue = v }
  }

  // Budget availability score — "Budget availability score: Medium"
  let budget = null
  const bM = full.match(/Budget availability(?:\s*score)?[:\s]*\b(Low|Medium|High)\b/i)
  if (bM) budget = bM[1].toLowerCase()

  // Commission % — the campaign's commission RATE (distinct from EPC, which is
  // earnings-per-click). Best-guess; tune from the "Debug" dump on the live page.
  // e.g. "Up to 20% commission" / "20% Commission".
  let commissionPct = null
  // ONLY accept a % that's anchored to the word "commission". A bare "any % on
  // the card" last-resort used to grab discount/promo chips ("Save 25%", "20%
  // off") and mislabel them as commission — corrupting the /epc Min-commission
  // filter and sort. Better to return null than a wrong number.
  const cM = full.match(/(?:up to\s*)?(\d{1,2}(?:\.\d)?)\s*%\s*commission/i)
    || full.match(/commission[:\s]*(?:up to\s*)?(\d{1,2}(?:\.\d)?)\s*%/i)
  if (cM) { const v = parseFloat(cM[1]); if (!isNaN(v)) commissionPct = v }

  // Days remaining — "30+ Days Remaining" / "12 Days Remaining".
  let daysRemaining = null
  const dR = full.match(/(\d{1,3})\+?\s*days?\s*remaining/i)
  if (dR) daysRemaining = parseInt(dR[1], 10)

  // End date — "No end date" → none; else a date if present
  let endsAt = null
  if (!/no end date/i.test(full)) {
    const d = full.match(DATE_RE)
    if (d) endsAt = d[1]
    else {
      const dt = full.match(DATE_TXT_RE)
      if (dt) {
        const p = new Date(dt[1].replace('.', ''))
        if (!isNaN(p)) endsAt = p.toISOString().slice(0, 10)
      }
    }
  }

  // Product name — prefer the text of the product link (the title is an
  // <a href=".../dp/ASIN">), else the longest non-noise leaf line.
  let campaignName = null
  const link = el.querySelector(`a[href*="/dp/${asin}"], a[href*="/dp/"], a[href*="/product/"]`)
  const linkTxt = textOf(link)
  if (linkTxt && linkTxt.length >= 6 && !NOISE_RE.test(linkTxt) && !ASIN_RE.test(linkTxt.toUpperCase())) {
    campaignName = linkTxt
  }
  if (!campaignName) {
    let best = 0
    for (const node of el.querySelectorAll('h1,h2,h3,h4,h5,p,span,div,a')) {
      if (node.children.length) continue // leaf text only
      const t = textOf(node)
      if (!t || t.length < 6 || t.length > 200) continue
      if (NOISE_RE.test(t) || PRICE_RE.test(t) || RATING_RE.test(t)) continue
      if (ASIN_RE.test(t.toUpperCase())) continue
      if (/^\(?\d[\d,]*\)?$/.test(t)) continue // review counts
      if (t.length > best) { best = t.length; campaignName = t }
    }
  }

  // Brand — short line near the top that isn't the title/price/badge.
  let brand = null
  for (const node of el.querySelectorAll('span,div,a,h3,h4')) {
    if (node.children.length) continue
    const t = textOf(node)
    if (!t || t.length < 2 || t.length > 40) continue
    if (t === campaignName || NOISE_RE.test(t) || PRICE_RE.test(t) || RATING_RE.test(t)) continue
    if (ASIN_RE.test(t.toUpperCase()) || /^\(?\d/.test(t)) continue
    brand = t
    break
  }

  // Thumbnail (nice-to-have) — the product image in the card.
  let image = null
  const img = el.querySelector('img[src]')
  if (img && /^https?:/.test(img.src) && !/sprite|icon|logo/i.test(img.src)) image = img.src

  return { asin, campaignName, brand, epc, epcValue, commissionPct, daysRemaining, budget, endsAt, image }
}

async function parseCampaigns() {
  const grid = findGrid()
  if (!grid) return []

  const byAsin = new Map()
  const isThin = (c) => !c || !c.campaignName || c.campaignName === c.asin
  const harvest = () => {
    for (const { asin, el } of cellsIn(grid)) {
      const fresh = extractCard(asin, el)
      const prev = byAsin.get(asin)
      // First sighting, or upgrade a name-less snapshot once the card
      // has actually painted its title/image.
      if (!prev || (isThin(prev) && !isThin(fresh))) byAsin.set(asin, fresh)
      else if (prev) {
        // Fill in fields that may have painted after the first sighting.
        if (!prev.image && fresh.image) prev.image = fresh.image
        if (prev.epcValue == null && fresh.epcValue != null) { prev.epcValue = fresh.epcValue; prev.epc = fresh.epc }
        if (!prev.budget && fresh.budget) prev.budget = fresh.budget
      }
    }
    // Stream live progress to the popup so it can show a running count while
    // the grid scrolls (best-effort — the popup may be closed). Swallow the
    // async rejection too (no receiver → "Unchecked runtime.lastError" spam).
    try { const p = chrome.runtime.sendMessage({ type: 'CC_SCAN_PROGRESS', found: byAsin.size }); if (p && p.catch) p.catch(() => {}) } catch (e) {}
  }

  // Scroll the virtualized grid in viewport-sized steps, harvesting at
  // each rest point until we reach the bottom (or stop making progress).
  const step = Math.max(300, grid.clientHeight - 80)
  let pos = 0
  let lastTop = -1
  let stalls = 0
  grid.scrollTop = 0
  await sleep(120)
  harvest()

  for (let i = 0; i < 400; i++) {
    pos += step
    grid.scrollTop = pos
    await sleep(140)
    harvest()
    const top = grid.scrollTop
    if (top === lastTop) {
      if (++stalls >= 2) break // hit the bottom
    } else {
      stalls = 0
      lastTop = top
    }
    if (top + grid.clientHeight >= grid.scrollHeight - 2) {
      await sleep(140); harvest(); break
    }
  }

  // Enrichment pass: some cells were scrolled past before they painted
  // their title/image. Re-walk top→bottom (slower) to fill the gaps.
  const thin = () => [...byAsin.values()].filter(isThin).length
  if (thin() > 0) {
    pos = 0
    grid.scrollTop = 0
    await sleep(180)
    harvest()
    for (let i = 0; i < 400; i++) {
      pos += step
      grid.scrollTop = pos
      await sleep(220)
      harvest()
      const top = grid.scrollTop
      if (top + grid.clientHeight >= grid.scrollHeight - 2) { await sleep(220); harvest(); break }
      if (top === lastTop) break
      lastTop = top
      if (thin() === 0) break
    }
  }

  grid.scrollTop = 0
  return [...byAsin.values()]
}

// Drive Amazon's OWN search box so SCOUT queries the full catalogue, not just
// the campaigns already rendered. The input is React-controlled, so we set it
// via the native value setter + an input event, then wait for the grid to
// re-render before the caller scrapes. No-ops (and reports why) if there's no
// search box or the query is already applied.
// Find the Affiliate+ CAMPAIGNS search box specifically — the one whose
// placeholder is "Search brand, keyword, or ASIN" — and NOT the global Amazon
// nav search or the Sponsored Products (SPC) box, which also match a generic
// "search" selector and would leave the campaign grid unfiltered (forcing a
// slow full-grid scroll). Prefer an input that mentions ASIN / brand+keyword.
function findCampaignSearchBox() {
  const inputs = [...document.querySelectorAll('input')]
  const hint = (i) => `${i.placeholder || ''} ${i.getAttribute('aria-label') || ''}`.toLowerCase()
  // 1) The exact CC campaigns box: placeholder names ASIN (and usually brand/keyword).
  const byAsin = inputs.find((i) => /\basin\b/.test(hint(i)))
  if (byAsin) return byAsin
  const byBrandKw = inputs.find((i) => /brand.*keyword|keyword.*brand/.test(hint(i)))
  if (byBrandKw) return byBrandKw
  // 2) Fallback: the first generic search input (previous behaviour).
  return document.querySelector('input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i]')
}

async function applyAmazonSearch(keyword) {
  const kw = (keyword || '').trim()
  if (!kw) return { searched: false }
  const input = findCampaignSearchBox()
  if (!input) return { searched: false, reason: 'no-search-box' }
  const setNativeValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(el, v); else el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // ALWAYS clear then re-type — never short-circuit on "value already matches".
  // A throttled BACKGROUND pass often sets the ASIN in the box WITHOUT the grid
  // ever filtering; on the foreground retry the value already equals the ASIN, so
  // re-setting the same value won't refire React's onChange and the filter would
  // never run — the grid stays on the stale default cards and the find loops
  // forever. Clearing to '' first forces a real change event every time.
  try { input.focus() } catch (e) {}
  setNativeValue(input, '')
  await sleep(150)
  setNativeValue(input, kw)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))

  // Amazon debounces the query, BLANKS the grid, fetches, then repaints. If we
  // scrape during that blank gap we get nothing ("No campaigns detected"). So
  // wait for the results to actually POPULATE and SETTLE — ASIN cells present
  // and their (virtualized) count stable across several polls — before the
  // caller scrapes. Bails after ~16s (treated as a genuinely empty result set).
  // Count BOTH card layouts: the old ASIN-cell grid AND the 2026 redesign's
  // [data-testid="campaign-card-container"] cards. The old counter only saw the
  // ASIN cells, which the redesign dropped — so it always read 0 and every search
  // just timed out (~16s) instead of settling when the filtered results landed.
  const countCards = () => {
    const nu = document.querySelectorAll('[data-testid="campaign-card-container"]').length
    if (nu) return nu
    const g = findGrid(); return g ? cellsIn(g).length : 0
  }
  await sleep(900)            // let the debounced fetch kick off
  let last = -1
  let stable = 0
  for (let i = 0; i < 40; i++) {
    await sleep(300)
    const n = countCards()
    if (n > 0 && n === last) {
      if (++stable >= 3) { await sleep(400); return { searched: true, count: n } } // populated + steady
    } else {
      stable = 0
      last = n
    }
  }
  return { searched: true, settled: false, count: last < 0 ? 0 : last }
}

// Guard: this file may be (re)injected by the popup on every scan.
// Register the message listener only once per page.
// Snapshot of WHY a scan returned what it did — surfaced in the app so a 0
// result tells us the cause (wrong page, not signed in, stale selectors)
// instead of looking like an empty opportunities list.
function collectDiag() {
  const grid = findGrid()
  const ariaCount = document.querySelectorAll('[aria-label]').length
  const asinCount = [...document.querySelectorAll('[aria-label]')]
    .filter(e => ASIN_RE.test((e.getAttribute('aria-label') || '').trim().toUpperCase())).length
  const signedOut = /\bap\/signin\b/i.test(location.href) ||
    !!document.querySelector('#ap_email, form[name="signIn"]')
  return {
    url: location.href,
    title: (document.title || '').slice(0, 120),
    gridFound: !!grid,
    ariaLabelCount: ariaCount,
    asinCellCount: asinCount,
    signedOut,
  }
}

// Click a Creator Connections status tab (New Opportunities / Active / Completed)
// by its visible label, then wait for the grid to re-render. Best-effort: returns
// false when no matching tab exists (the caller just skips that tab), so if
// Amazon renames a tab this degrades to "current tab only" instead of breaking.
// Powers Check CC's sweep beyond New Opportunities — so an already-ACCEPTED
// campaign (Active tab) is detected live, not only from MVP's imported list.
async function clickCcTab(re) {
  try {
    const el = [...document.querySelectorAll('button,a,[role="tab"],[role="button"]')]
      .find((e) => re.test((textOf(e) || '').trim()))
    if (!el) return false
    el.click()
    await sleep(1800) // let the tab's grid mount before we search it
    return true
  } catch (e) { return false }
}

// FULL background-send pipeline, run in this content script's own (persistent,
// first-party) context. Ported from background's ccResolveSendInPage — kept here
// because an executeScript-injected function can't reliably fetch or message back
// on the connect page. opts carries the request templates + identity from the
// background; returns a plain result object delivered over sendResponse.
async function ccSendInPage(opts) {
  const fetchT = async (url, init, ms) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => { try { ctrl.abort() } catch (e) {} }, ms || 12000)
    try { return await fetch(url, Object.assign({}, init, { signal: ctrl.signal })) }
    finally { clearTimeout(timer) }
  }
  try {
    const { asin, segments, campaignIdsHint, headers, sendTemplate, searchTemplate, MSG, CTX, CAMP, CREATOR, ACTOR } = opts
    let creatorId = opts.creatorId
    if (!creatorId) {
      try { const html = (document.documentElement && document.documentElement.innerHTML) || ''; const m = html.match(/amzn1\.creator\.[a-z0-9-]+/i); if (m) creatorId = m[0] } catch (e) {}
    }
    const hdr = () => { const o = Object.assign({}, headers || {}); if (!o['Content-Type'] && !o['content-type']) o['Content-Type'] = 'application/json'; if (!o['Accept'] && !o['accept']) o['Accept'] = 'application/json'; return o }
    const jinner = (s) => { try { return JSON.stringify(String(s == null ? '' : s)).slice(1, -1) } catch (e) { return String(s || '') } }
    let creatorName = String(opts.creatorName || '')
    const fillId = (tpl, nm) => String(tpl)
      .split(CREATOR || ' ').join(jinner(creatorId || ''))
      .split(ACTOR || ' ').join(jinner(nm || creatorName || creatorId || ''))
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
        const chosen = ads.filter(hasAsin)
        for (const a of chosen) { if (a.campaignId && !campaignIds.includes(a.campaignId)) campaignIds.push(a.campaignId); if (!brand && a.brandName) brand = a.brandName }
      } catch (e) { resolveErr = e && e.message ? e.message : String(e) }
    }
    if (!campaignIds.length) return { ok: false, reason: (A && !creatorId) ? 'no-creator-id' : 'no-campaign-for-asin', error: resolveErr || undefined, creatorId: creatorId || undefined, via: 'content' }
    const findToken = (j) => {
      try { const abs = (j && j.responses && j.responses[0] && j.responses[0].addressBook) || []; for (const e of abs) { const t = e.contextValidatorToken || e.contextToken; if (t && t.length > 20) return t } } catch (e) {}
      return null
    }
    let lastReason = 'no-context-token'
    for (const cid of campaignIds) {
      try {
        const sBody = fillId(searchTemplate.split(CAMP).join(cid))
        const sr = await fetchT('/connect/api/chat/search', { method: 'POST', headers: hdr(), body: sBody, credentials: 'include' }, 12000)
        const sj = await sr.json().catch(() => null)
        const token = findToken(sj)
        if (!token) { lastReason = 'no-context-token'; continue }
        if (!creatorName) { const n = findCreatorName(sj); if (n) creatorName = n }
        let groups = 0
        for (const seg of segments) {
          const mBody = fillId(sendTemplate, creatorName).split(CTX).join(jinner(token)).split(MSG).join(jinner(seg))
          const mr = await fetchT('/connect/api/chat/message/send', { method: 'POST', headers: hdr(), body: mBody, credentials: 'include' }, 15000)
          let txt = ''
          try { txt = (await mr.text()).slice(0, 300) } catch (e) {}
          if (mr.ok && /"status"\s*:\s*"SUCCESS"/i.test(txt)) groups++
          else { lastReason = 'send-rejected'; break }
          await new Promise((r) => setTimeout(r, 400))
        }
        if (groups > 0) return { ok: groups === segments.length, reason: groups === segments.length ? undefined : 'partial', groups, campaignId: cid, brand, creatorName: creatorName || undefined, creatorId: creatorId || undefined, via: 'content' }
      } catch (e) { lastReason = 'exception' }
    }
    return { ok: false, reason: lastReason, campaignIds, brand, error: resolveErr || undefined, creatorName: creatorName || undefined, creatorId: creatorId || undefined, via: 'content' }
  } catch (e) {
    return { ok: false, reason: 'exception', error: e && e.message ? e.message : String(e), via: 'content' }
  }
}

if (!window.__ccScoutListener) {
  window.__ccScoutListener = true
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // Run the FULL Creator Connections send pipeline (resolve ASIN → campaign →
    // chat token → send) HERE, in the persistent declared content script, instead
    // of via chrome.scripting.executeScript. On the connect page an injected
    // function's fetch/messaging silently dies (no return, no message, no throw —
    // proven by diagnostics); a real content script's fetch + sendResponse work.
    if (msg?.type === 'MVP_CC_SEND_INPAGE') {
      ccSendInPage(msg.payload || {})
        .then((r) => { try { sendResponse(r) } catch (e) {} })
        .catch((e) => { try { sendResponse({ ok: false, reason: 'exception', error: (e && e.message) || String(e) }) } catch (e2) {} })
      return true // async
    }
    if (msg?.type === 'CC_SCAN') {
      // CC_SCAN powers the EPC library scan ONLY (Affiliate+ uses CC_SMART/CC_FIND).
      // So this reads the "Sponsored Products for Creators" grid: the product, its
      // price, Estimated EPC and Budget score are ON the card, a DIFFERENT model
      // from Affiliate+ campaign cards. The background navigates the tab to the
      // spcc view; if we still aren't on it, try clicking that program tab once.
      ;(async () => {
        if (detectCcTab() !== 'sponsored') {
          try { await clickCcTab(/sponsored products( for creators)?/i) } catch (e) {}
          await sleep(1800)
        }
        if (detectCcTab() !== 'sponsored') {
          // Not on the EPC grid — return empty + a flag so the app can tell the
          // user to open their Sponsored Products opportunities.
          // eslint-disable-next-line no-console
          console.log('[MVP SCOUT] EPC scan — NOT on the Sponsored Products grid. url:', location.href)
          sendResponse({ campaigns: [], diag: { ...collectDiag(), sponsored: false } })
          return
        }
        // Switch to the "Accepted" sub-tab ourselves. When SCOUT opens the page
        // (no CC tab was open) it lands on "New Opportunities", which is EMPTY once
        // you've accepted all — the accepted products live under the Accepted tab.
        // Always click it (idempotent if already there; a no-op if the tab doesn't
        // exist) and let its virtualized grid mount, so the scan works whether or
        // not the user already had that tab open.
        try {
          const clicked = await clickCcTab(/^\s*accepted\b/i)
          if (clicked) await sleep(2200)
        } catch (e) {}
        // Count the raw ASIN nodes the sponsored reader keys on, so a 0-parse is
        // explainable (page has cards vs selectors missed them). Logged to the
        // scanned tab's console AND returned in diag for the MVP panel to show.
        let asinNodes = 0
        try {
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
          let n; while ((n = w.nextNode())) { const v = n.nodeValue || ''; if (v.length < 80 && /\bB0[A-Z0-9]{8}\b/.test(v)) asinNodes++ }
        } catch (e) {}
        // Deep harvest: Sponsored Products has no export, and a creator can have
        // 20k+ accepted, so grab as large a slice as fits under the message
        // timeout (~95s of scrolling) instead of the old 300 cap. Re-scanning
        // upserts, so what we read is added to the growing library.
        // Resume from where the last scan left off so each scan reaches NEW
        // products instead of re-reading the same top ~2,700. Depth persists in
        // extension storage; wraps back to the top once the whole list is covered.
        const prevDepth = await new Promise((res) => {
          try { chrome.storage.local.get('mvp_epc_scan_depth', (o) => res(Number(o && o.mvp_epc_scan_depth) || 0)) } catch (e) { res(0) }
        })
        const rows = await parseSponsoredCards({ maxCards: 8000, maxMs: 95000, skipToDepth: prevDepth })
        // Persist the new depth for the next scan (wrap to the top when we hit the end).
        const nextDepth = rows.endReached ? 0 : (Number(rows.depth) || 0)
        try { chrome.storage.local.set({ mvp_epc_scan_depth: nextDepth }) } catch (e) {}
        // eslint-disable-next-line no-console
        console.log('[MVP SCOUT] EPC scan — ASIN nodes:', asinNodes, '· parsed cards:', rows.length, '· resumedFrom:', prevDepth, '· depth:', rows.depth, '· end:', rows.endReached, '· url:', location.href)
        const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : null
        const campaigns = rows.map((r) => ({
          asin: r.asin,
          campaignName: r.campaignName || r.asin,
          brand: null,
          epc: r.epc != null ? `Up to $${r.epc.toFixed(2)}` : null,
          epcValue: r.epc != null ? r.epc : null,
          price: r.price != null ? `$${r.price.toFixed(2)}` : null,
          priceValue: r.price != null ? r.price : null,
          rating: r.rating || null,
          budget: cap(r.budgetScore),
          image: r.image || null,
          endsAt: null,
        }))
        sendResponse({ campaigns, diag: { ...collectDiag(), sponsored: true, asinNodes, parsed: rows.length } })
      })().catch(e => sendResponse({ error: e?.message || 'parse failed', campaigns: [], diag: collectDiag() }))
      return true // async response
    }
    // CC_FIND — "is THIS product a live Creator Connections campaign?" Rule (per
    // how CC actually works): SEARCH THE CC GRID BY THE ASIN. Amazon's CC search
    // matches ASINs, so an exact query returns that product's campaign card if one
    // exists — no keyword guessing, no opening each card's details page to resolve
    // its ASIN. The campaign id lives right on the card (Accept button testid), so
    // we hand it straight back to MVP. Powers the Product Finder's "Check CC" row.
    if (msg?.type === 'CC_FIND') {
      ;(async () => {
        try {
          const want = String(msg.asin || '').toUpperCase()
          if (!/^[A-Z0-9]{10}$/.test(want)) { sendResponse({ ok: false, error: 'no-asin' }); return }
          // The brand our shared catalog says owns this ASIN — the CHEAP, reliable
          // verifier: a rendered card whose brand matches is the right campaign,
          // no details-page ASIN read needed. Normalize both sides (case/spacing).
          const normBrand = (b) => String(b || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
          const wantBrand = normBrand(msg.brand)
          // The exact campaign ids our catalog says carry this ASIN — the STRONGEST
          // signal: match a card's id directly, no ambiguity even when the brand
          // runs 40 campaigns. (Cheap, no details-page reads.)
          const wantIds = new Set((Array.isArray(msg.campaignIds) ? msg.campaignIds : []).filter(Boolean))
          // Sweep tabs in priority order: New Opportunities (actionable — you can
          // accept + auto-send) FIRST, then Active (already accepted) and Completed
          // so we can say "you already have this one" live. re=null means "the tab
          // that's already loaded" (Opportunities) — no click. A missing tab is
          // skipped, so this never regresses below Opportunities-only.
          const tabs = [{ re: null, status: 'opportunity' }]
          if (msg.sweep !== false) tabs.push({ re: /^(active|accepted)$/i, status: 'active' }, { re: /^completed$/i, status: 'completed' })
          let rendered = false
          let found = null
          // Diagnostics surfaced back to MVP so a miss is explainable (what tabs we
          // checked, how many cards, which brands) instead of a silent failure.
          const diag = { wantBrand: wantBrand || null, tabs: [] }
          // A REUSED CC tab can be parked on the "Sponsored Products for Creators"
          // program — a different grid/search than Affiliate+ campaigns. Force the
          // Affiliate+ program tab first (harmless no-op when already there), or we
          // search the wrong program and never find the campaign.
          try { await clickCcTab(/affiliate\+\s*campaigns/i) } catch (e) {}
          // How many card details-pages we may open to verify an ASIN, TOTAL
          // across all tabs — bounds latency while still confirming the match.
          let resolveBudget = Math.max(1, msg.maxResolve || 8)
          for (let t = 0; t < tabs.length && !found; t++) {
            const tab = tabs[t]
            if (tab.re) { const ok = await clickCcTab(tab.re); if (!ok) { diag.tabs.push({ status: tab.status, cards: 0, searched: false, note: 'tab-not-found' }); continue } }
            let rows = [], total = null
            try { const r = await scoutRunSearch({ asin: want, maxCards: msg.maxCards || 40 }); rows = r.rows || []; total = r.total } catch (e) {}
            if (total != null || rows.length > 0) rendered = true
            // VERIFY, never guess. Amazon's ASIN search can silently fall back to
            // an unfiltered grid (or the box may not have taken), so rows[0] is
            // often an UNRELATED brand — sending there is the "wrong brand" bug.
            // (1) trust a card that carries the ASIN on itself; else
            // (2) open the campaign's details page and confirm the ASIN we want
            //     is one of its products — only then is it a match.
            void total   // never gate on the "Campaigns (N)" header — it's the
                         // tab's WHOLE catalog count (704k / 144k), not the matches.
            // (0) EXACT campaign-id match from our catalog — the reliable path when
            //     the brand runs many campaigns for one ASIN (40 GarveeHome cards).
            let hit = wantIds.size ? (rows.find((r) => r.campaignId && wantIds.has(r.campaignId)) || null) : null
            // (1) On-card ASIN.
            if (!hit) hit = rows.find((r) => r.asin === want) || null
            // (2) Brand match from our catalog — cheap and reliable. Among branded
            //     cards, prefer one whose ASIN we can confirm; else the first
            //     branded card (still the RIGHT brand's chat). No row-count gate:
            //     the brand IS the verification.
            if (!hit && wantBrand) {
              const branded = rows.filter((r) => normBrand(r.brand) === wantBrand || normBrand(r.campaignName).includes(wantBrand))
              if (branded.length === 1) hit = branded[0]
              else if (branded.length > 1) {
                for (const r of branded) {
                  if (resolveBudget <= 0) break
                  if (!r.detailsUrl) continue
                  resolveBudget--
                  const asins = await resolveCampaignAsins(r.detailsUrl)
                  if (asins.includes(want)) { hit = r; break }
                }
                if (!hit) hit = branded[0]
              }
            }
            // (3) No brand/id to check against → confirm the ASIN via the details
            //     page (bounded), only when the result set is focused. Never
            //     fall back to rows[0] — that's the wrong-brand bug.
            if (!hit && !wantBrand && !wantIds.size && rows.length > 0 && rows.length <= 20) {
              for (const r of rows) {
                if (resolveBudget <= 0) break
                if (r.asin && r.asin !== want) continue
                if (!r.detailsUrl) continue
                resolveBudget--
                const asins = await resolveCampaignAsins(r.detailsUrl)
                if (asins.includes(want)) { hit = r; break }
              }
            }
            // A hit's status tells the sender whether to accept first: an
            // 'opportunity' card isn't accepted yet (accept → then message);
            // an 'active' card is already accepted (message straight away).
            if (hit) found = { hit, status: tab.status }
            diag.tabs.push({
              status: tab.status,
              cards: rows.length,
              searched: true,
              brands: [...new Set(rows.map((r) => r.brand).filter(Boolean))].slice(0, 6),
              matched: !!hit,
            })
          }
          // Never leave a user's own CC tab parked on Active/Completed — restore it.
          if (msg.sweep !== false) { try { await clickCcTab(/^(new opportunities|opportunities)$/i) } catch (e) {} }
          if (found) {
            const h = found.hit
            sendResponse({
              ok: true, found: true, asin: want, status: found.status,
              campaignId: h.campaignId || null,
              detailsUrl: h.detailsUrl || null,
              campaignName: h.campaignName || null,
              brand: h.brand || null,
              commissionPct: h.commissionPct != null ? h.commissionPct : null,
              endsAt: h.endsAt || null,
              diag,
            })
            return
          }
          // No VERIFIED card in any tab. In a BACKGROUND tab Amazon often won't
          // re-filter the virtualized grid, so the stale default cards linger and
          // we can't confirm a match — that's not a real miss. Report scanned:0 so
          // the orchestrator escalates to a FOREGROUND pass (where the search
          // actually filters). On the foreground pass itself (msg.foreground), a
          // miss IS real → scanned:1, no further retry.
          void rendered
          sendResponse({ ok: true, found: false, scanned: msg.foreground ? 1 : 0, diag })
        } catch (e) {
          sendResponse({ ok: false, error: (e && e.message) || 'cc-find-failed' })
        }
      })()
      return true // async response
    }
    // CC_MATCH — "which of THESE products are Creator Connections campaigns?"
    // Powers "Check all CC". Same rule as CC_FIND, one product at a time: search
    // the CC grid by each ASIN in turn; if a card comes back, that product has a
    // campaign — record it with its campaign id. Paced between searches so we
    // don't hammer Amazon. Caps the batch so a huge list can't run away.
    if (msg?.type === 'CC_MATCH') {
      ;(async () => {
        try {
          const wants = Array.from(new Set((msg.asins || []).map((a) => String(a || '').toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a))))
          if (!wants.length) { sendResponse({ ok: true, matches: [], scanned: 0 }); return }
          const cap = Math.min(wants.length, msg.maxAsins || 25)
          const matches = []
          let scanned = 0
          let rendered = false
          for (let i = 0; i < cap; i++) {
            const asin = wants[i]
            if (i > 0) await new Promise((res) => setTimeout(res, 700 + Math.floor(Math.random() * 500))) // pace Amazon searches
            let rows = [], total = null
            try { const r = await scoutRunSearch({ asin, maxCards: msg.maxCards || 30 }); rows = r.rows || []; total = r.total } catch (e) {}
            if (total != null || rows.length > 0) rendered = true
            scanned++
            // Verify the card is really THIS asin (see CC_FIND): trust an on-card
            // ASIN match, else confirm via the details page (one resolve per asin
            // so a big batch stays fast). Never fall back to rows[0] — a wrong
            // match here would badge the wrong product as a live campaign.
            let hit = rows.find((r) => r.asin === asin) || null
            // Gate on rendered card count, NOT the "Campaigns (N)" header (that's
            // the tab's whole catalog count, not the search matches).
            void total
            if (!hit && rows.length > 0 && rows.length <= 20) {
              for (const r of rows) {
                if (r.asin && r.asin !== asin) continue
                if (!r.detailsUrl) continue
                const asins = await resolveCampaignAsins(r.detailsUrl)
                if (asins.includes(asin)) { hit = r; break }
                break // one resolve per asin — keep the batch scan responsive
              }
            }
            if (hit) {
              matches.push({
                asin,
                campaignId: hit.campaignId || null,
                detailsUrl: hit.detailsUrl || null,
                campaignName: hit.campaignName || null,
                brand: hit.brand || null,
                commissionPct: hit.commissionPct != null ? hit.commissionPct : null,
              })
            }
            // Live progress to the panel (best-effort).
            try { const p = chrome.runtime.sendMessage({ type: 'CC_SCAN_PROGRESS', found: matches.length, scanned }); if (p && p.catch) p.catch(() => {}) } catch (e) {}
          }
          // scanned 0 (nothing ever rendered) → background retries foreground.
          sendResponse({ ok: true, matches, scanned: rendered ? scanned : 0 })
        } catch (e) {
          sendResponse({ ok: false, error: (e && e.message) || 'cc-match-failed' })
        }
      })()
      return true // async response
    }
    // CC_SMART — MVP Smart Scan: sweep the WHOLE Affiliate+ opportunities grid,
    // gate on the MVP rulebook (sent from the app — single source of truth in
    // lib/cc-smart-rules.ts), deep-check the best on-card candidates (price,
    // monthly units, rating, video-carousel placement, breadcrumbs), and return
    // only campaigns that pass EVERY gate. Powers the /epc "Smart Scan" panel.
    if (msg?.type === 'CC_SMART') {
      ;(async () => {
        try {
          const rules = msg.rules || {}
          // ONE clock for the WHOLE handler (tab clicks + grid scan + deep
          // checks). The old budget only timed the deep loop — a slow grid
          // scan pushed the total past the app's message timeout and the run
          // died as a timeout instead of returning partial results (live bug
          // 2026-07-06, "mattress"). Background allows 420s, app 430s; respond
          // by ~330s and there's always headroom.
          const t0 = Date.now()
          // The CC page has TWO tab rows: PROGRAM ("Affiliate+ campaigns" |
          // "Sponsored Products for Creators") and STATUS (New Opportunities |
          // Accepted | Submitted). A REUSED tab can be parked on the Sponsored
          // program — a different grid with commission-less product cards —
          // which made the scan search the wrong program entirely (live bug
          // 2026-07-06: "foot" hit the Sponsored search → zero rows). Click the
          // Affiliate+ PROGRAM tab first (harmless no-op when already active),
          // THEN the actionable STATUS tab.
          try { await clickCcTab(/affiliate\+\s*campaigns/i) } catch (e) {}
          try { await clickCcTab(/^(new opportunities|opportunities)$/i) } catch (e) {}
          // On-card pass, gated by commission % + days-left (both readable on
          // the card, both lenient on unreadable — the deep check is the real
          // filter). An OPTIONAL focus keyword drives Amazon's own CC search
          // box first (applyAmazonSearch inside scoutRunSearch), so the sweep
          // covers the FULL catalog matching it — and the deep-check budget
          // concentrates on that niche instead of spreading across everything.
          const focus = String(msg.keyword || '').trim().slice(0, 80)
          let rows = []
          let rawCount = 0
          let gridTab = null
          try {
            // 400 cards (was 600): the candidates are re-sorted by commission
            // before deep-checking anyway, so the marginal tail past 400 never
            // reaches a deep check — it only burned scan time toward the clock.
            const r = await scoutRunSearch({ keyword: focus, minCommission: rules.minCommissionPct || 0, lastDays: rules.minDaysLeft || 0, maxCards: 400 })
            rows = r.rows || []; rawCount = r.rawCount || rows.length; gridTab = r.tab || null
          } catch (e) {}
          // Still on the Sponsored grid after the program-tab click → these are
          // commission-less product cards, NOT Affiliate+ campaigns. Refuse
          // rather than scan the wrong program; the app tells the user how to fix.
          if (gridTab === 'sponsored') { sendResponse({ ok: false, error: 'sponsored-tab' }); return }
          if (!rows.length) { sendResponse({ ok: true, matches: [], stats: { scannedOnCard: rawCount, passedOnCard: 0, deepChecked: 0 } }); return }
          // Name/brand avoid-list (breadcrumbs re-check after the deep-check —
          // campaign names lie, categories don't).
          const avoid = (rules.avoidPatterns || []).map((s) => String(s).toLowerCase())
          const hitAvoid = (hay) => { const h = String(hay || '').toLowerCase(); return avoid.some((p) => h.includes(p)) }
          const candidates = rows
            .filter((r) => !hitAvoid(`${r.campaignName || ''} ${r.brand || ''}`))
            .sort((a, b) => (b.commissionPct || 0) - (a.commissionPct || 0)) // spend the deep-check budget on the best cards
          const passedOnCard = candidates.length
          const cap = Math.min(candidates.length, rules.deepCheckCap || 25)
          const matches = []
          let deepChecked = 0
          let blocked = false
          // Why each deep-checked candidate dropped — the tuning signal that
          // separates "rules being strict" (drops spread across sales/carousel/
          // price) from "extraction bug" (everything piling into unreadable).
          const drops = { unreadable: 0, price: 0, sales: 0, rating: 0, carousel: 0, category: 0 }
          for (let i = 0; i < cap; i++) {
            // Whole-handler clock (t0 includes the grid scan) — return what we
            // have well before the background/app timeouts (420s/430s) fire.
            if (Date.now() - t0 > 300000) break
            const c = candidates[i]
            if (!c.detailsUrl) continue
            if (i > 0) await new Promise((res) => setTimeout(res, 2500 + Math.floor(Math.random() * 2000))) // pace Amazon
            let deep = null
            try { deep = await chrome.runtime.sendMessage({ type: 'SCOUT_DEEP_CHECK', detailsUrl: c.detailsUrl }) } catch (e) {}
            deepChecked++
            if (deep && deep.blocked) { blocked = true; break } // Amazon interstitial — STOP the batch
            if (!deep || !deep.ok) { drops.unreadable++; continue }
            const price = typeof deep.price === 'number' ? deep.price : null
            const sales = typeof deep.sales === 'number' ? deep.sales : null
            const rating = typeof deep.rating === 'number' ? deep.rating : null
            const crumbs = deep.crumbs || null
            const carouselPos = deep.carouselPos || 'none'
            // ── Hard gates (the rulebook) ──
            const floor = Math.max(rules.minPrice || 0, rules.hardFloorPrice || 0)
            if (price == null) { drops.unreadable++; continue }
            if (price < floor || (rules.maxPrice && price > rules.maxPrice)) { drops.price++; continue }
            // No "bought in past month" badge on the page ≈ Amazon shows it from
            // ~50/mo up — missing means low volume, so a hard minimum FAILS it.
            if (rules.minMonthlySales && (sales == null || sales < rules.minMonthlySales)) { drops.sales++; continue }
            // Rating is on virtually every /dp; lenient only when unreadable.
            if (rules.minRating && rating != null && rating < rules.minRating) { drops.rating++; continue }
            if (rules.requireCarousel && carouselPos === 'none') { drops.carousel++; continue }
            if (crumbs && hitAvoid(crumbs)) { drops.category++; continue }
            const endsAt = c.endsAt || null
            let daysLeftN = null
            try { if (endsAt) daysLeftN = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000)) } catch (e) {}
            matches.push({
              asin: (deep.asin || c.asin || null),
              campaignName: c.campaignName || null,
              brand: c.brand || null,
              detailsUrl: c.detailsUrl || null,
              campaignId: c.campaignId || null,
              image: c.image || null,
              commissionPct: c.commissionPct != null ? c.commissionPct : null,
              endsAt,
              daysLeft: daysLeftN,
              price,
              monthlySales: sales,
              rating,
              carouselPos,
              hasVideo: carouselPos !== 'none',
              crumbs,
            })
          }
          sendResponse({
            ok: true,
            matches,
            stats: { scannedOnCard: rawCount, passedOnCard, deepChecked, blocked, truncated: deepChecked < Math.min(passedOnCard, cap), drops },
          })
        } catch (e) {
          sendResponse({ ok: false, error: (e && e.message) || 'smart-scan-failed' })
        }
      })()
      return true // async response
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// MVP SCOUT — Creator Connections campaign SEARCH panel (Phase 1)
// Injected on the CC page. Searches Amazon's FULL campaign database by driving
// Amazon's own search box (reusing applyAmazonSearch), scrapes the results, and
// filters by commission % / EPC / end date. Accept campaigns (per-item + bulk)
// and search by ASIN. Commission-% extraction + the accept/Track selectors are
// BEST-GUESS — click "Debug" on the live page and share the console output to
// finalise them.
// ═══════════════════════════════════════════════════════════════════════════
const PANEL_ID = 'mvp-scout-cc-panel'

function fmtMeta(r) {
  const bits = []
  // Sponsored Products rows carry product price / EPC / rating on the card.
  if (typeof r.epc === 'number') bits.push('EPC $' + r.epc.toFixed(2))
  if (typeof r.price === 'number') bits.push('$' + r.price.toFixed(2))
  if (r.rating) bits.push('★ ' + r.rating + (r.reviews ? ` (${r.reviews.toLocaleString()})` : ''))
  if (r.budgetScore) bits.push('budget ' + r.budgetScore)
  if (r.asin) bits.push(r.asin)
  if (r.commissionPct != null) bits.push(r.commissionPct + '% commission')
  if (r.startsAt || r.endsAt) bits.push((r.startsAt || '?') + ' → ' + (r.endsAt || '?'))
  if (r.budget) bits.push(r.budget + ' budget')
  return bits.join(' · ')
}

// ── New CC card model (Amazon's 2026-07 /p/connect redesign) ────────────────
// Cards no longer carry an ASIN aria-label. Each card is a
// [data-testid="campaign-card-container"] whose fields live in data-testids, and
// the campaign id is embedded in the Accept button's data-testid:
//   amzn1.campaign.<ID>-campaign-card-accept-btn
function parseUSDate(s) {
  if (!s) return null
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const y = m[3].length === 2 ? '20' + m[3] : m[3]
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`  // YYYY-MM-DD (sortable)
}
function extractNewCard(cont) {
  const txt = (sel) => { const e = cont.querySelector(sel); return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : null }
  const brand = txt('[data-testid="campaign-card-brand-name"]')
  // The name cell often prefixes/embeds the commission ("35% Commission | <product>"),
  // and on some cards it's ONLY the commission. Strip the commission token so we
  // keep a clean product title; if nothing's left, fall back to the brand.
  let campaignName = txt('[data-testid="campaign-card-campaign-name"]')
  if (campaignName) {
    campaignName = campaignName
      .replace(/\b\d+(?:\.\d+)?%\s*commission\b/ig, '')
      .replace(/^[\s|·:–—-]+|[\s|·:–—-]+$/g, '')
      .trim()
  }
  if (!campaignName) campaignName = brand || null
  let commissionPct = null
  const cr = txt('[data-testid="campaign-card-campaign-commission-rate"]')
  if (cr) { const m = cr.match(/(\d+(?:\.\d+)?)/); if (m) commissionPct = parseFloat(m[1]) }
  const budget = txt('[data-testid="campaign-card-campaign-budget"]')
  let startsAt = null, endsAt = null
  const dr = txt('[data-testid="campaign-card-campaign-date-range"]')  // "7/3/26 - 8/2/26"
  if (dr) { const p = dr.split(/\s*[-–—]\s*/); startsAt = parseUSDate(p[0]); endsAt = parseUSDate(p[1]) }
  const imgEl = cont.querySelector('[data-testid="campaign-card-campaign-image"]')
  const image = imgEl ? imgEl.src : null
  const accBtn = cont.querySelector('button[data-testid$="-campaign-card-accept-btn"]')
  let campaignId = null
  if (accBtn) { const m = (accBtn.getAttribute('data-testid') || '').match(/^(.*)-campaign-card-accept-btn$/); if (m) campaignId = m[1] }
  // The card's "View details" link → the campaign's own page, where its real
  // ASIN lives (the redesign hides it on the card). We resolve it lazily, only
  // for campaigns the user actually accepts, via a background tab.
  const detailsEl = cont.querySelector('[data-testid$="campaign-card-view-details-link"], [data-testid*="view-details"], [data-testid*="view_details"]')
  const detailsUrl = detailsEl ? (detailsEl.href || detailsEl.getAttribute('href') || null) : null
  // Accepted (Active/Completed) cards have NO Accept button, so the id above is
  // null — recover it from the "View details" URL, which carries amzn1.campaign.…
  if (!campaignId && detailsUrl) { const m = detailsUrl.match(/amzn1\.campaign\.[A-Za-z0-9._-]+/); if (m) campaignId = m[0] }
  // Cheap on-card ASIN, when Amazon leaves one exposed: a /dp/<ASIN> link or a
  // data-asin attribute. The 2026 redesign usually HIDES it (then we resolve via
  // the details page), but when it's here we can verify a search hit for free —
  // never trust a card whose ASIN we can't confirm matches the one we searched.
  let asin = null
  const dpEl = cont.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]')
  if (dpEl) { const m = (dpEl.getAttribute('href') || '').toUpperCase().match(/\/(?:DP|GP\/PRODUCT)\/([A-Z0-9]{10})/); if (m) asin = m[1] }
  if (!asin) { const da = cont.querySelector('[data-asin]'); const v = da && (da.getAttribute('data-asin') || '').toUpperCase(); if (v && /^[A-Z0-9]{10}$/.test(v)) asin = v }
  return { key: campaignId || campaignName, campaignId, campaignName, brand, asin, commissionPct, budget, startsAt, endsAt, image, detailsUrl }
}
// Amazon's Creator Connections list is INFINITE-SCROLL: it renders ~60 cards,
// then lazy-loads the next batch only when you scroll near the bottom. The old
// reader scrolled once to the first bottom and stopped → always ~60. This one
// keeps hitting the bottom and WAITING for the next batch to append, harvesting
// as it goes, and stops only when the loaded count plateaus (real end of the
// results) or it reaches `maxCards`. `onProgress(n)` fires as the tally grows.
//
// It drives the WINDOW/document scroll (what actually triggers Amazon's fetch —
// confirmed by the user) plus any inner virtualized grid, and harvests
// document-wide so a card is captured wherever it mounts.
async function parseCampaignCards(opts) {
  const maxCards = (opts && opts.maxCards) || 600
  const onProgress = (opts && opts.onProgress) || function () {}
  const byKey = new Map()
  let reported = 0
  const harvest = () => {
    for (const cont of document.querySelectorAll('[data-testid="campaign-card-container"]')) {
      const c = extractNewCard(cont)
      if (c.key && !byKey.has(c.key)) byKey.set(c.key, c)
    }
    if (byKey.size !== reported) { reported = byKey.size; try { onProgress(byKey.size) } catch (e) {} }
  }
  const grid = findGrid() // optional secondary (inner) scroller
  const scroller = document.scrollingElement || document.documentElement
  const reachOf = () => {
    let r = scroller ? (scroller.scrollHeight || 0) : (document.documentElement.scrollHeight || 0)
    if (grid) r = Math.max(r, grid.scrollHeight || 0)
    return r
  }
  const setScroll = (y) => {
    try { window.scrollTo(0, y) } catch (e) {}
    if (scroller) { try { scroller.scrollTop = y } catch (e) {} }
    if (grid) { try { grid.scrollTop = y } catch (e) {} }
  }
  const vh = window.innerHeight || (scroller ? scroller.clientHeight : 800)
  const step = Math.max(400, vh - 100)
  let pos = 0
  let stalls = 0
  setScroll(0); await sleep(150); harvest()
  for (let i = 0; i < 4000 && byKey.size < maxCards; i++) {
    const reach = reachOf()
    if (pos + vh < reach - 4) {
      // More already-loaded content below — step into it and harvest.
      pos += step
      setScroll(pos)
      await sleep(120)
      harvest()
      stalls = 0
    } else {
      // At the current bottom — nudge Amazon to lazy-load the next batch, wait,
      // then check whether the list actually grew.
      setScroll(reach)
      try { window.dispatchEvent(new Event('scroll', { bubbles: true })) } catch (e) {}
      if (grid) { try { grid.dispatchEvent(new Event('scroll', { bubbles: true })) } catch (e) {} }
      await sleep(700)
      harvest()
      if (reachOf() > reach + 4) stalls = 0          // grew → keep going
      else if (++stalls >= 3) break                  // 3 waits, nothing new → end of results
    }
  }
  setScroll(0)
  return [...byKey.values()]
}

// Amazon's "Campaigns (6,619)" header — the TOTAL matches for the current
// search, so the panel can say "loaded N of ~X" and flag when the scan capped.
function readAmazonTotal() {
  try {
    const m = (document.body ? document.body.innerText : '').match(/Campaigns\s*\(([\d,]+)\)/i)
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null
  } catch (e) { return null }
}

// ── Push campaigns into MVP (ASIN-grounded) ─────────────────────────────────
const MVP_ORIGIN = 'https://www.mvpaffiliate.io'

// The MVP ingest token (integrations.cc_ingest_token) is shared with the SCOUT
// popup via chrome.storage.local 'ccToken'. It's how the ingest endpoint knows
// which MVP account to write to (the extension has no MVP cookie on amazon.com).
function getIngestToken() {
  return new Promise((resolve) => {
    try { chrome.storage.local.get(['ccToken'], (o) => resolve(((o && o.ccToken) || '').trim() || null)) }
    catch (e) { resolve(null) }
  })
}

// Ask the background worker to open the campaign's details page in a background
// tab and read its ASIN. Returns the first ASIN or null.
async function resolveCampaignAsin(detailsUrl) {
  if (!detailsUrl) return null
  try {
    const r = await chrome.runtime.sendMessage({ type: 'SCOUT_RESOLVE_ASIN', detailsUrl })
    return (r && r.ok && r.asins && r.asins[0]) || null
  } catch (e) { return null }
}

// Full ASIN LIST for a campaign (its details page can list several products).
// Used to VERIFY a search hit: only accept a card when the ASIN we searched is
// actually one of the campaign's products — never send to a brand we haven't
// confirmed owns the ASIN.
async function resolveCampaignAsins(detailsUrl) {
  if (!detailsUrl) return []
  try {
    const r = await chrome.runtime.sendMessage({ type: 'SCOUT_RESOLVE_ASIN', detailsUrl })
    return (r && r.ok && Array.isArray(r.asins)) ? r.asins.map((a) => String(a || '').toUpperCase()) : []
  } catch (e) { return [] }
}

// POST one accepted campaign into the MVP Creator Campaigns inbox. The row lands
// as `pending`, ready for one-click "Generate post". Maps to the existing ingest
// shape: commission % goes into the free-text `epc` field.
async function pushCampaignToMvp(camp, asin, token, extra) {
  // Sponsored Products = Amazon pays per CLICK (a dollar Estimated EPC on the
  // card) → program 'epc', carry the EPC value. Affiliate+ = extra commission
  // per SALE (a percent) → program 'affiliate_plus', carry commissionPct. Never
  // conflate the two (10% must never be read as $10).
  const sponsored = !!camp.sponsored
  const priceVal = (extra && typeof extra.price === 'number') ? extra.price
    : (typeof camp.price === 'number' ? camp.price : null)
  const payload = {
    asin,
    campaignName: camp.campaignName || camp.brand || null,
    // The REAL brand name — kept separate from the product-ish campaignName so
    // brand messages greet the brand, not the product.
    brandName: camp.brand || null,
    program: sponsored ? 'epc' : 'affiliate_plus',
    epc: sponsored && camp.epc != null ? String(camp.epc) : null,
    commissionPct: (!sponsored && camp.commissionPct != null) ? camp.commissionPct : null,
    endsAt: camp.endsAt || null,
    monthlySales: extra && typeof extra.monthlySales === 'number' ? extra.monthlySales : null,
    hasCarouselVideo: extra && typeof extra.hasVideo === 'boolean' ? extra.hasVideo : null,
    // Where the carousel video sits: 'top' (hero gallery), 'bottom'
    // (related-videos section) or 'none'. Shown per-row in MVP /epc.
    carouselVideoPos: extra && typeof extra.carouselPos === 'string' ? extra.carouselPos : null,
    // Product (Buy Box) price — on the Sponsored card directly, or read off the
    // /dp during a deep check. Powers the price sort on /epc.
    price: priceVal,
    detailsUrl: camp.detailsUrl || null,
  }
  // Push via the background service worker FIRST: a content-script fetch from
  // amazon.com to mvpaffiliate.io is subject to Amazon's page CSP `connect-src`
  // and can be silently blocked (looks like "nothing pushed"). The worker isn't.
  try {
    const r = await chrome.runtime.sendMessage({ type: 'SCOUT_PUSH_CAMPAIGN', token, campaigns: [payload] })
    if (r && r.reached) {
      if (r.ok) return { ok: true }
      console.warn('[MVP SCOUT] push failed (bg):', r.error)
      return { ok: false, error: r.error }
    }
    // reached:false → worker couldn't complete the request; fall through to a
    // direct fetch (covers a cold/asleep worker or an old build with no handler).
  } catch (e) { /* no handler / worker asleep → direct fetch below */ }
  try {
    const res = await fetch(`${MVP_ORIGIN}/api/campaigns/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ campaigns: [payload] }),
    })
    if (res.ok) return { ok: true }
    let error = `HTTP ${res.status}`
    try { const j = await res.json(); if (j && j.error) error = j.error } catch (e) {}
    console.warn('[MVP SCOUT] push failed:', error)
    return { ok: false, error }
  } catch (e) {
    console.warn('[MVP SCOUT] push error:', e)
    return { ok: false, error: (e && e.message) || 'network error (page CSP may be blocking amazon.com→mvp; reload SCOUT)' }
  }
}

// Accept a campaign on Amazon AND push it (with its resolved ASIN) into MVP.
// Drives the given Accept button through visible stages so the user sees
// progress. Returns { accepted, pushed }.
// Import ONE campaign into MVP (resolve its ASIN + push). Deliberately does NOT
// accept it on Amazon — a SCOUT import never commits you to a campaign; accepting
// is a choice you make in MVP.
async function importOne(camp, btn) {
  const set = (t, color) => { if (btn) { btn.textContent = t; if (color) btn.style.color = color } }
  if (!camp) { set('Retry', '#dc2626'); return { pushed: false } }
  if (btn) btn.disabled = true
  const token = await getIngestToken()
  if (!token) { set('· connect MVP', '#b45309'); showTokenRow(); if (btn) btn.disabled = false; return { pushed: false } }
  // Sponsored Products cards already carry the ASIN (+ price) — push instantly, no
  // /dp resolve. Affiliate+ cards hide the ASIN → resolve it from the details page.
  let asin = camp.asin || null
  if (!asin) { set('Finding ASIN…', '#6b7280'); asin = await resolveCampaignAsin(camp.detailsUrl) }
  if (!asin) { set('· no ASIN', '#b45309'); if (btn) btn.disabled = false; return { pushed: false } }
  set('Sending…', '#6b7280')
  const push = await pushCampaignToMvp(camp, asin, token, typeof camp.price === 'number' ? { price: camp.price } : undefined)
  set(push.ok ? '✓ In MVP' : '· push failed', push.ok ? '#059669' : '#b45309')
  if (btn) btn.title = push.ok ? '' : ('Push failed: ' + (push.error || 'unknown') + ' (hover shows why; see console)')
  if (btn) btn.disabled = false
  return { pushed: push.ok }
}

// Reveal the "MVP ingest token" input in the panel (only surfaced when a push
// needs a token that isn't set yet).
function showTokenRow() {
  const p = document.getElementById(PANEL_ID)
  const r = p && p.querySelector('.mvp-token-row')
  if (r) r.classList.add('show')
}

// Harvest every Amazon ASIN reachable from a single card's own DOM, trying the
// cheap in-card sources first (data-asin attrs, /dp/ links, image URLs) and
// finally a regex over the card's raw HTML. Returns [] if the card carries no
// ASIN — the signal that we must open its "View details" to get one.
function harvestCardAsins(cont) {
  const set = new Set()
  const push = (v) => { const m = String(v || '').toUpperCase().match(/\bB0[A-Z0-9]{8}\b/g); if (m) m.forEach(x => set.add(x)) }
  cont.querySelectorAll('[data-asin]').forEach(e => push(e.getAttribute('data-asin')))
  cont.querySelectorAll('a[href]').forEach(a => { const m = (a.getAttribute('href') || '').match(/\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})/i); if (m) push(m[1]) })
  cont.querySelectorAll('img[src],img[alt]').forEach(img => { push(img.getAttribute('src')); push(img.getAttribute('alt')) })
  push(cont.outerHTML)  // last resort: any B0-ASIN anywhere in the card markup
  return [...set]
}

// Locate the control that expands a campaign's product/ASIN details, if any.
function findDetailsControl(cont) {
  const cands = [...cont.querySelectorAll('button,a,[role="button"],[data-testid]')]
  const hit = cands.find(e =>
    /view details|see details|\bdetails\b|view product|see product/i.test(textOf(e)) ||
    /details|products?\b/i.test((e.getAttribute && e.getAttribute('data-testid')) || ''))
  return hit ? { text: textOf(hit).slice(0, 40), testid: (hit.getAttribute && hit.getAttribute('data-testid')) || null, tag: hit.tagName } : null
}

// Dump a campaign card's parsed fields, its discoverable ASINs, the details
// control (if any) and raw DOM — the calibration probe for ASIN grounding.
function dumpCardDebug() {
  const conts = [...document.querySelectorAll('[data-testid="campaign-card-container"]')]
  const cont = conts[0] || null
  const parsed = cont ? extractNewCard(cont) : null
  const asins = cont ? harvestCardAsins(cont) : []
  const cardsWithAsin = conts.filter(c => harvestCardAsins(c).length > 0).length
  const details = cont ? findDetailsControl(cont) : null
  const testids = cont ? [...cont.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).slice(0, 60) : []
  const submitFound = [...document.querySelectorAll('button,a,[role="button"]')].some(b => /submit accepted campaigns/i.test(textOf(b)))
  console.log('%c[MVP SCOUT] cards:', 'color:#7C3AED;font-weight:bold', conts.length, '| with ASIN in own HTML:', cardsWithAsin)
  console.log('%c[MVP SCOUT] first card parsed:', 'color:#7C3AED;font-weight:bold', parsed)
  console.log('%c[MVP SCOUT] first card ASINs:', 'color:#7C3AED;font-weight:bold', asins)
  console.log('%c[MVP SCOUT] details control:', 'color:#7C3AED;font-weight:bold', details)
  console.log('%c[MVP SCOUT] first card data-testids:', 'color:#7C3AED', testids)
  console.log('%c[MVP SCOUT] first card outerHTML:', 'color:#7C3AED', cont?.outerHTML?.slice(0, 8000) || '(no card found)')
  return { cardFound: !!cont, cardCount: conts.length, cardsWithAsin, asins, details, submitFound, parsed }
}

// ── Brand-messaging probe (calibration for "message brands from MVP") ────────
// Every Affiliate+/EPC campaign has a "Message Brand" chat. We can draft the
// outreach in MVP and place it in that box for the user to review + Send. First
// we need the modal's selectors — this probe opens it and dumps them.
function findMessageButton() {
  return [...document.querySelectorAll('button,a,[role="button"]')]
    .find(e => /message brand|message the brand|^\s*message\s*$/i.test(textOf(e)))
}
async function probeMessageModal() {
  const btn = findMessageButton()
  if (!btn) return { ok: false, reason: 'no-message-button (open a campaign\'s details first)' }
  btn.click()
  await sleep(1600)
  // The message box: a textarea (placeholder "Enter a message"), plus a Send button.
  const textarea = [...document.querySelectorAll('textarea')].find(t => /message/i.test(t.getAttribute('placeholder') || '')) || document.querySelector('textarea')
  const scope = (textarea && (textarea.closest('[role="dialog"]') || textarea.closest('section'))) || document
  const sendBtn = [...scope.querySelectorAll('button,[role="button"]')].find(e => /^\s*send\s*$/i.test(textOf(e)))
  const ta = textarea ? {
    placeholder: textarea.getAttribute('placeholder'),
    testid: textarea.getAttribute('data-testid'),
    name: textarea.getAttribute('name'),
    id: textarea.id || null,
    maxlength: textarea.getAttribute('maxlength'),
  } : null
  const send = sendBtn ? {
    text: textOf(sendBtn).slice(0, 24),
    testid: sendBtn.getAttribute('data-testid'),
    disabled: !!sendBtn.disabled,
  } : null
  const container = (textarea && (textarea.closest('[role="dialog"]') || textarea.closest('[data-testid]'))) || null
  console.log('%c[MVP SCOUT] message probe — textarea:', 'color:#7C3AED;font-weight:bold', ta)
  console.log('%c[MVP SCOUT] message probe — send btn:', 'color:#7C3AED;font-weight:bold', send)
  console.log('%c[MVP SCOUT] message container testids:', 'color:#7C3AED', container ? [...container.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).slice(0, 80) : '(none)')
  console.log('%c[MVP SCOUT] message container HTML:', 'color:#7C3AED', (container || (textarea && textarea.parentElement))?.outerHTML?.slice(0, 8000) || '(no container)')
  return { ok: true, textarea: ta, send, modalFound: !!container }
}

// ── Draft & place a brand-outreach message ──────────────────────────────────
function findMessageTextarea() {
  return [...document.querySelectorAll('textarea')].find(t => /message/i.test(t.getAttribute('placeholder') || '')) || document.querySelector('textarea')
}

// React controls the message textarea, so a plain `.value =` is ignored. Use the
// native value setter + a FULL event burst so React's onChange fires and the
// Send button un-disables — a bare 'input' event wasn't always enough (Send
// stayed disabled → "send-button-not-found").
function setReactTextareaValue(el, value) {
  try { el.focus() } catch (e) {}
  const proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype
  const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value')
  if (desc && desc.set) desc.set.call(el, value); else el.value = value
  try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })) }
  catch (e) { el.dispatchEvent(new Event('input', { bubbles: true })) }
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }))
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }))
}

// Amazon's message Send button — matched TOLERANTLY: enabled (checks both the
// `disabled` prop and aria-disabled), label is "send" as a word (covers "Send",
// "Send message", "Send now"), by text/aria/title, shortest label first (closest
// to a bare "Send"). Also accepts input[type=submit].
function findSendButton(scope) {
  const root = scope || document
  const cands = [...root.querySelectorAll('button,[role="button"],input[type="submit"]')]
  const ok = cands.filter(b => {
    if (b.disabled === true || b.getAttribute('aria-disabled') === 'true') return false
    const t = ((b.innerText || b.textContent || b.value || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).replace(/\s+/g, ' ').trim()
    return /(^|\s)send(\b|$)/i.test(t) && t.length <= 24
  })
  ok.sort((a, z) => ((a.textContent || '').trim().length) - ((z.textContent || '').trim().length))
  return ok[0] || null
}

// After Send, Amazon pops "Potential Personal Information was detected …" with a
// CONTINUE button. It's a PLAIN modal (not role="dialog"), so we find it by its
// TEXT, then click Continue/OK. No visibility check — a background tab has no
// layout (offsetParent/getBoundingClientRect are 0), which is exactly what made
// the send stall on this dialog before.
function findConfirmOk() {
  const isConfirm = (t) => /^(continue|ok|okay|i understand|understood|got it|proceed|agree|accept|acknowledge|confirm|send( message| anyway)?)$/i.test(t)
  const scopes = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"]')]
  const pi = [...document.querySelectorAll('div,section,form')].find(e => {
    const tx = e.textContent || ''
    return /personal information (was )?detected|share personal information/i.test(tx) && tx.length < 900
  })
  if (pi) scopes.push(pi)
  const roots = scopes.length ? scopes : [document.body || document]
  for (let i = roots.length - 1; i >= 0; i--) {
    const btn = [...roots[i].querySelectorAll('button,[role="button"],input[type="submit"],a')].find(b => {
      if (b.disabled === true || b.getAttribute('aria-disabled') === 'true') return false
      const t = ((b.innerText || b.textContent || b.value || '') + ' ' + (b.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim()
      return isConfirm(t)
    })
    if (btn) return btn
  }
  return null
}

// Every send-ish button (text/aria), with disabled state — for the failure diag.
function sendCandidatesDump() {
  return [...document.querySelectorAll('button,[role="button"],input[type="submit"]')]
    .filter(b => /send/i.test((b.innerText || b.textContent || b.value || '') + ' ' + (b.getAttribute('aria-label') || '')))
    .slice(0, 8)
    .map(b => ({
      text: ((b.innerText || b.textContent || b.value || '')).replace(/\s+/g, ' ').trim().slice(0, 30),
      aria: (b.getAttribute('aria-label') || '').slice(0, 30),
      disabled: b.disabled === true || b.getAttribute('aria-disabled') === 'true',
    }))
}

// Read the campaign context from the details page so MVP can personalise the
// pitch. Best-effort; the brief carries the brand name even if we can't isolate it.
function readCampaignDetailsContext() {
  const main = document.querySelector('main') || document.body
  const heads = [...main.querySelectorAll('h1,h2,h3')].map(h => textOf(h)).filter(Boolean)
  const product = heads.find(t => !/^(campaign details|campaign brief|messages|profile|affiliate\+|all new opportunities|sponsored products)/i.test(t)) || ''
  let brief = ''
  const briefHead = [...main.querySelectorAll('h1,h2,h3,h4,strong,b')].find(e => /^\s*campaign brief\s*$/i.test(textOf(e)))
  if (briefHead) {
    let node = briefHead.closest('h1,h2,h3,h4') || briefHead
    let acc = '', sib = node.nextElementSibling
    for (let i = 0; i < 14 && sib && acc.length < 3000; i++) { acc += ' ' + textOf(sib); sib = sib.nextElementSibling }
    brief = (acc.trim() || textOf(briefHead.parentElement || briefHead)).slice(0, 3000)
  }
  const pageText = (main.innerText || '').slice(0, 6000)
  const asinM = (product + ' ' + brief + ' ' + pageText).toUpperCase().match(/\bB0[A-Z0-9]{8}\b/)
  const asin = asinM ? asinM[0] : ''
  const commM = pageText.match(/commission\s*rate[\s\S]{0,24}?(\d{1,2}(?:\.\d+)?)\s*%/i) || pageText.match(/(\d{1,2}(?:\.\d+)?)\s*%\s*commission/i)
  const commissionPct = commM ? parseFloat(commM[1]) : null
  let brand = ''
  const withHdr = [...main.querySelectorAll('h1,h2,h3,h4,span')].map(e => textOf(e)).find(t => /^messages with .+/i.test(t.trim()))
  if (withHdr) brand = withHdr.replace(/^messages with /i, '').trim()
  return { brand, product, asin, commissionPct, brief }
}

async function fetchOutreachDraft(ctx, token) {
  const payload = { brand: ctx.brand, product: ctx.product, asin: ctx.asin, commissionPct: ctx.commissionPct, brief: ctx.brief }
  // Draft via the background worker FIRST: a content-script fetch from amazon.com
  // to mvpaffiliate.io is subject to Amazon's page CSP `connect-src` and can be
  // silently blocked (the ✍️ Draft button would just fail). The worker isn't.
  try {
    const r = await chrome.runtime.sendMessage({ type: 'SCOUT_OUTREACH', token, ctx: payload })
    if (r && r.reached) {
      if (r.ok) return { ok: true, message: r.message || '' }
      console.warn('[MVP SCOUT] draft failed (bg):', r.error)
      return { ok: false, error: r.error }
    }
    // reached:false → worker couldn't complete (cold/asleep worker, or an old
    // build with no SCOUT_OUTREACH handler); fall through to a direct fetch.
  } catch (e) { /* no handler / worker asleep → direct fetch below */ }
  try {
    const res = await fetch(`${MVP_ORIGIN}/api/campaigns/outreach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      let error = `HTTP ${res.status}`
      try { const j = await res.json(); if (j && j.error) error = j.error } catch (e) {}
      console.warn('[MVP SCOUT] draft failed:', error)
      return { ok: false, error }
    }
    const j = await res.json()
    return { ok: true, message: (j && j.message) || '' }
  } catch (e) { return { ok: false, error: (e && e.message) || 'network error (page CSP may be blocking amazon.com→mvp; reload SCOUT)' } }
}

// Split an outreach draft into Amazon "message group" segments. PRIMARY: the
// literal "---- Add to Message Group ----" marker (OINK's format — what Amazon's
// chat uses to break one outreach into several messages). FALLBACK: blank lines.
// The markers themselves are stripped; each returned segment becomes its own
// Amazon message.
function splitMessageSegments(msg) {
  const s = String(msg || '').trim()
  const hasMarker = /-{2,}\s*add to message group\s*-{2,}/i.test(s)
  const parts = hasMarker
    ? s.split(/\s*-{2,}\s*add to message group\s*-{2,}\s*/i)
    : s.split(/\n\s*\n+/)
  return parts.map(x => x.trim()).filter(Boolean)
}

// Open the brand message box (if needed), draft a pitch from the campaign brief,
// PLACE it in the box, and click Amazon's Send. The box is open on the page the
// creator is actively viewing (in their own session), so the send is reliable
// here — unlike a freshly-loaded background tab.
async function scoutDraftMessage() {
  const token = await getIngestToken()
  if (!token) { showTokenRow(); return { ok: false, reason: 'connect MVP first (paste your token below, then retry)' } }
  let ta = findMessageTextarea()
  if (!ta) { const mb = findMessageButton(); if (mb) { mb.click(); await sleep(1600); ta = findMessageTextarea() } }
  if (!ta) return { ok: false, reason: "open a campaign's details page (no Message Brand box found)" }
  const ctx = readCampaignDetailsContext()
  if (!ctx.product && !ctx.brand) return { ok: false, reason: "couldn't read the campaign details" }
  const d = await fetchOutreachDraft(ctx, token)
  if (!d.ok) return { ok: false, reason: d.error || 'draft failed' }
  if (!d.message) return { ok: false, reason: 'draft came back empty' }
  // Amazon sends a message GROUP as SEPARATE messages: type a segment → click
  // Send → it posts → the box clears → type the next → Send again. ONE Send per
  // "---- Add to Message Group ----" break, NOT a queue (this is how OINK /
  // ViralVue do it). We loop the segments doing exactly that.
  const clickEl = (el) => { ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => { try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })) } catch (e) {} }) }
  const segments = splitMessageSegments(d.message)
  let sent = 0
  for (let i = 0; i < segments.length; i++) {
    const box = findMessageTextarea(); if (!box) break
    setReactTextareaValue(box, segments[i])
    await sleep(650)
    // Wait up to ~5s for Amazon to enable the Send button after the fill.
    let btn = null
    for (let t = 0; t < 20 && !btn; t++) { btn = findSendButton(); if (!btn) await sleep(250) }
    if (!btn) break
    clickEl(btn)
    sent++
    // Amazon pops "Personal Information detected" (with a Continue button) on
    // messages with an address/email/phone — click it, then wait for it to close.
    await sleep(500)
    for (let k = 0; k < 16; k++) { const ok = findConfirmOk(); if (ok) { clickEl(ok); await sleep(700); break } await sleep(300) }
    await sleep(1300)                                 // let the message post + the box clear
  }
  if (sent === 0) {
    const cands = sendCandidatesDump()
    console.warn('[MVP SCOUT] send failed — no enabled Send button. Candidates:', cands)
    return { ok: true, chars: d.message.length, sent: false, groups: 0, reason: `placed — no enabled Send button (${cands.length} send-ish; see console)`, sendCandidates: cands }
  }
  return { ok: true, chars: d.message.length, sent: true, groups: sent }
}

// ── "Sponsored Products for Creators" tab — a DIFFERENT card model ──────────
// Unlike Affiliate+ campaign cards (commission %/budget/dates, ASIN hidden), the
// Sponsored Products cards show the PRODUCT itself: ASIN, price, Estimated EPC and
// rating are ON the card. So SCOUT can read price + ASIN at scrape time (no /dp
// visits, no Amazon block) — which is what lets us SORT BY PRICE before importing
// and import instantly. Selectors are text/attribute-based (robust to Amazon's
// class churn); if a scan comes back empty on this tab, click Debug and share the
// console so the anchors can be tightened.
function detectCcTab() {
  try {
    // Most reliable signal: the Sponsored Products program URL (type=spcc).
    if (/[?&]type=spcc\b/i.test(location.href)) return 'sponsored'
    const t = (document.body ? document.body.innerText : '') || ''
    // The Sponsored tab's cards carry "Estimated EPC" + a visible "ASIN: B0…"
    // (the price can glue to the label — "$104.00ASIN:" — so no leading \b).
    if (/estimated epc/i.test(t) && /ASIN:?\s*B0[A-Z0-9]{8}/i.test(t)) return 'sponsored'
    // The Sponsored Products program heading + product ASIN cards — covers the
    // Accepted tab, where a card may not print "Estimated EPC" on its face.
    if (/sponsored products for creators/i.test(t) && /ASIN:?\s*B0[A-Z0-9]{8}/i.test(t)) return 'sponsored'
    return 'affiliate'
  } catch (e) { return 'affiliate' }
}

function extractSponsoredCard(cont) {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const all = clean(cont.textContent)
  // Amazon jams cells together with no whitespace, e.g. "$104.00ASIN: B00KFE0A2OEstimated" —
  // so we can't require a word boundary before "ASIN" (glued to the price) or after the
  // code (glued to "Estimated"). Match the ASIN label loosely, else a bare B0 code.
  const am = all.match(/ASIN:?\s*(B0[A-Z0-9]{8})/i) || all.match(/(B0[A-Z0-9]{8})/)
  const asin = am ? am[1].toUpperCase() : null
  if (!asin) return null
  // Current price — prefer the buy-box price node; else the first "$X.XX" that
  // isn't the strikethrough List Price or the Estimated-EPC figure.
  let price = null
  const priceEl = cont.querySelector('.a-price:not(.a-text-price) .a-offscreen') || cont.querySelector('.a-price .a-offscreen')
  let pm = (priceEl ? clean(priceEl.textContent) : '').match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)
  if (!pm) {
    const stripped = all.replace(/list price:?\s*\$\s*[\d,.]+/ig, '').replace(/estimated epc[^$]*\$\s*[\d,.]+/ig, '')
    pm = stripped.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)
  }
  if (pm) { const n = parseFloat(pm[1].replace(/,/g, '')); if (!isNaN(n) && n > 0) price = n }
  // Estimated EPC ("Estimated EPC: Up to $2.47").
  let epc = null
  const em = all.match(/estimated epc[^$]*\$\s*([\d,]+(?:\.\d{1,2})?)/i)
  if (em) { const n = parseFloat(em[1].replace(/,/g, '')); if (!isNaN(n)) epc = n }
  // Rating + review count. On the CC card the stars show as "4.4 (31,940)" with no
  // "out of 5" text and often glued to the title ("Foam,White4.4 (31,940)"), so also
  // accept a X.X immediately before a (review-count) parenthesis.
  let rating = null, reviews = null
  const rm = all.match(/\b([0-5](?:\.\d)?)\s*(?:out of 5|stars)/i) || all.match(/([0-5]\.\d)\s*\(\s*[\d,]{2,}\s*\)/)
  if (rm) rating = rm[1]
  const rc = all.match(/\(([\d,]{2,})\)/); if (rc) reviews = parseInt(rc[1].replace(/,/g, ''), 10)
  // Budget availability score (Low / Medium / High).
  let budgetScore = null
  const bm = all.match(/budget availability score:?\s*(low|medium|high)/i)
  if (bm) budgetScore = bm[1].toLowerCase()
  // Product image. Amazon lazy-loads, so a card <img> may hold a 1x1 spacer in
  // src with the real image in data-src / srcset. Prefer a genuine Amazon media
  // URL; skip spacers, sprites and icons.
  let image = null
  for (const im of cont.querySelectorAll('img')) {
    const cand = im.getAttribute('src') || im.getAttribute('data-src') ||
      (im.getAttribute('srcset') || '').split(/\s+/)[0] || ''
    if (/(?:media-amazon|images-amazon|ssl-images-amazon)\.com/i.test(cand) &&
        !/sprite|grey-pixel|transparent|1x1|\/G\//i.test(cand)) { image = cand; break }
  }
  if (!image) { const f = cont.querySelector('img[src]'); image = f ? (f.getAttribute('src') || null) : null }
  // Title: the longest LEAF text line that isn't a metadata line (price / ASIN /
  // EPC / budget / rating). The product name is the strongest such line.
  let campaignName = null, best = ''
  cont.querySelectorAll('a,span,div,p,h1,h2,h3,h4').forEach((e) => {
    if (e.children.length) return
    const t = clean(e.textContent)
    if (t.length >= 12 && t.length <= 200 && t.length > best.length &&
        !/\$|\bASIN\b|estimated epc|budget availability|out of 5|^\(?\d[\d,]*\)?$|^\s*accept\s*$/i.test(t)) best = t
  })
  if (best) campaignName = best
  const dpEl = cont.querySelector('a[href*="/dp/"]')
  const detailsUrl = dpEl ? (dpEl.href || `https://www.amazon.com/dp/${asin}`) : `https://www.amazon.com/dp/${asin}`
  return {
    key: asin, campaignId: null, asin, campaignName: campaignName || asin, brand: null,
    commissionPct: null, budget: null, startsAt: null, endsAt: null,
    image, detailsUrl, price, epc, rating, reviews, budgetScore, sponsored: true,
  }
}

// Scrape the sponsored product cards, scrolling to lazy-load more. Self-contained
// (doesn't touch the Affiliate+ campaign-card walker). Anchors on the "ASIN: B0…"
// text every card shows (robust — the Accept CTA is an Amazon a-button <input>
// with no text) and walks up to the card container.
async function parseSponsoredCards(opts) {
  const maxCards = (opts && opts.maxCards) || 300
  // Wall-clock budget. The Sponsored grid is React-virtualized, so cards are the
  // only way in (no export) and we harvest them as they scroll into view. On a
  // huge list (20k+) we can't fit them all under the message timeout, so we grab
  // as deep a slice as `maxMs` allows and return it — the upsert de-dupes, so
  // the library keeps whatever it already had. Default well under the 120s bridge.
  const maxMs = (opts && opts.maxMs) || 30000
  // RESUME: skip past the depth a previous scan already covered, so each scan
  // reaches NEW territory instead of re-reading the same top products. The grid
  // is virtualized infinite-scroll (you can't jump — you must scroll through to
  // load), so "skip" means fast-scroll WITHOUT the full harvest, then slow-harvest
  // onward. 0 = start from the top (first scan, or after we wrapped past the end).
  const skipToDepth = Math.max(0, (opts && opts.skipToDepth) || 0)
  const startedAt = Date.now()
  const onProgress = (opts && opts.onProgress) || function () {}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const byKey = new Map()
  const seenAsins = new Set() // EVERY asin streamed past (skip + harvest) → depth reached
  let endReached = false
  let reported = 0
  const harvest = () => {
    // Amazon splits the "ASIN:" label and the code into separate elements, so a
    // single text node rarely has both. Find any SHORT text node holding a bare
    // "B0XXXXXXXX" (the ASIN cell), walk up to the product-card container, extract.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
    const hits = []
    let n
    while ((n = walker.nextNode())) { const v = n.nodeValue || ''; if (v.length < 80 && /\bB0[A-Z0-9]{8}\b/.test(v)) hits.push(n) }
    for (const tn of hits) {
      // Walk up to the TIGHTEST ancestor that reads like a single product card:
      // it has a $ price (so it wraps the ASIN + price together) but isn't so big
      // it's swallowed the whole grid.
      let cont = tn.parentElement, card = null
      for (let i = 0; i < 14 && cont && cont.parentElement; i++) {
        const t = cont.textContent || ''
        // Card = tightest ancestor that has a $ AND a digit (price lives here) and
        // isn't the whole grid. $ and number are often in separate elements, so we
        // DON'T require them adjacent.
        if (t.indexOf('$') !== -1 && /\d/.test(t) && t.length < 1600) { card = cont; break }
        cont = cont.parentElement
      }
      if (!card) continue
      const c = extractSponsoredCard(card)
      if (c && c.asin) { seenAsins.add(c.asin); if (!byKey.has(c.asin)) byKey.set(c.asin, c) }
    }
    if (byKey.size !== reported) { reported = byKey.size; try { onProgress(byKey.size) } catch (e) {} }
  }
  const scroller = document.scrollingElement || document.documentElement
  // The sponsored grid can scroll INSIDE a virtualized container, not the window,
  // and/or reveal more behind a "Load more" button — so window-scroll alone stops
  // at the first ~30 cards. Also drive inner scrollers + click any load button.
  const innerScrollers = () => {
    try {
      return [...document.querySelectorAll('div,main,section,ul')].filter((e) => {
        const s = getComputedStyle(e)
        return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 200
      })
    } catch (e) { return [] }
  }
  // NOTE: we deliberately do NOT click any "Load" button. A bare "Load" on this
  // page is Amazon's "Campaign Count: Load", and clicking it clears the grid —
  // which zeroed out the whole scan. Scrolling only.
  await sleep(1000) // let the product grid render after the search before harvesting
  // SKIP PHASE — fast-scroll past the previously-covered depth without the full
  // (expensive) harvest, just counting distinct ASINs streaming past to gauge how
  // deep we are. Capped at 60% of the time budget so we always leave time to
  // actually harvest new cards. If the list ends before we reach skipToDepth, the
  // saved depth was past the end → mark endReached so the caller wraps to the top.
  if (skipToDepth > 0) {
    const countSeen = () => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
      let n
      while ((n = w.nextNode())) { const v = n.nodeValue || ''; if (v.length < 80) { const m = v.match(/\bB0[A-Z0-9]{8}\b/); if (m) seenAsins.add(m[0]) } }
    }
    countSeen()
    let skipStalls = 0
    for (let i = 0; i < 4000 && seenAsins.size < skipToDepth; i++) {
      if (Date.now() - startedAt > maxMs * 0.6) break
      window.scrollTo(0, scroller.scrollHeight)
      for (const el of innerScrollers()) { try { el.scrollTop = el.scrollHeight } catch (e) {} }
      await sleep(400)
      const before = seenAsins.size
      countSeen()
      if (seenAsins.size > before) skipStalls = 0
      else if (++skipStalls >= 8) { endReached = true; break }
    }
  }
  harvest()
  let last = -1, stalls = 0
  for (let i = 0; i < 4000 && byKey.size < maxCards; i++) {
    if (Date.now() - startedAt > maxMs) break // out of time — return what we have
    window.scrollTo(0, scroller.scrollHeight)
    for (const el of innerScrollers()) { try { el.scrollTop = el.scrollHeight } catch (e) {} }
    await sleep(650)
    harvest()
    // Progress = total scrollable height across window + inner containers + how
    // many cards we've found. Keep going while ANY of those grows. A virtualized
    // grid recycles nodes, so height can plateau while new ASINs still stream in —
    // give it a generous stall tolerance before deciding we've hit the bottom.
    const h = scroller.scrollHeight + innerScrollers().reduce((a, e) => a + e.scrollHeight, 0) + byKey.size * 1000
    if (h > last) { last = h; stalls = 0 } else if (++stalls >= 8) { endReached = true; break }
  }
  window.scrollTo(0, 0)
  // Return the harvested cards (array, as before) with the depth reached + whether
  // we hit the end attached, so the caller can resume the NEXT scan deeper (or wrap
  // back to the top once the whole list has been covered).
  const out = [...byKey.values()]
  try { out.depth = seenAsins.size; out.endReached = endReached } catch (e) {}
  return out
}

async function scoutRunSearch(f, onProgress) {
  // Keyword OR ASIN both drive Amazon's own search box (it searches by ASIN too),
  // so we scan the FULL catalogue's matches, then read + filter the cards.
  const query = (f.asin || f.keyword || '').trim()
  if (query) { try { await applyAmazonSearch(query) } catch (e) {} }
  const maxCards = (f.maxCards && f.maxCards > 0) ? f.maxCards : 600
  const tab = detectCcTab()
  // Sponsored Products tab: product cards carry ASIN + price on the card, so we
  // read those directly (and skip the commission/date filters, which don't apply).
  if (tab === 'sponsored') {
    let rows = await parseSponsoredCards({ maxCards: Math.min(maxCards, 300), onProgress })
    const rawCount = rows.length
    // Value metric on this tab is Estimated EPC (higher = better). Filters are LENIENT:
    // a card whose price/EPC we couldn't read is kept, like the campaign filters.
    if (f.minPrice) rows = rows.filter(r => r.price == null || r.price >= f.minPrice)
    if (f.minEpc) rows = rows.filter(r => r.epc == null || r.epc >= f.minEpc)
    return { rows, rawCount, total: rawCount, capped: rawCount >= 300, tab }
  }
  let rows = await parseCampaignCards({ maxCards, onProgress })
  const rawCount = rows.length
  const total = readAmazonTotal()
  const capped = rawCount >= maxCards && (total == null || total > rawCount)
  // Filters are LENIENT on missing fields (a card whose value we couldn't read is
  // kept, not dropped). An open-ended campaign (no end date) lasts indefinitely,
  // so it always satisfies a "lasts at least N days" minimum.
  if (f.minCommission) rows = rows.filter(r => r.commissionPct == null || r.commissionPct >= f.minCommission)
  if (f.lastDays > 0) {
    // Keep only campaigns still running at least N days FROM TODAY: their end
    // date must be on/after (today + N days).
    const cutoff = dateNDaysFromToday(f.lastDays)
    rows = rows.filter(r => !r.endsAt || r.endsAt >= cutoff)
  }
  return { rows, rawCount, total, capped, tab }
}

// today + n days, as a sortable "YYYY-MM-DD" string (local time).
function dateNDaysFromToday(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// ── Store-ID switcher ───────────────────────────────────────────────────────
// Creator Connections is blocked on an ONSITE store-id (the "onamz…" prefix);
// the eligible one is the OFFSITE store (same tag WITHOUT the onamz prefix, e.g.
// onamzgomin0e-20 → gomin0e-20). SCOUT reads the current store and, if it's an
// onsite one, flips the StoreID dropdown to the offsite store so CC unlocks.
function looksLikeStoreId(s) { return /[a-z0-9]+-\d{2}\b/i.test(s || '') }
function readCurrentStoreId() {
  try {
    const m = (document.body ? document.body.innerText : '').match(/store\s?id:\s*([a-z0-9]+-\d{2})/i)
    return m ? m[1] : null
  } catch (e) { return null }
}
function hasOnsiteStoreError() {
  try { return /onsite store[- ]?id/i.test(document.body ? document.body.innerText : '') } catch (e) { return false }
}
function storeNeedsSwitch() {
  const cur = readCurrentStoreId()
  return hasOnsiteStoreError() || (!!cur && /^onamz/i.test(cur))
}
function findStoreSwitcher() {
  // Native <select> of store ids.
  for (const s of document.querySelectorAll('select')) {
    const opts = [...s.options].map(o => (o.value || o.textContent || '').trim())
    if (opts.some(o => looksLikeStoreId(o))) return { kind: 'select', el: s }
  }
  // Custom dropdown: a control that shows "StoreID:".
  const ctrl = [...document.querySelectorAll('button,[role="button"],[aria-haspopup],a,span,div')]
    .find(e => /store\s?id:/i.test(e.innerText || e.textContent || '') && (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim().length < 60)
  return ctrl ? { kind: 'custom', el: ctrl } : null
}
async function switchToOffsiteStore() {
  const clickEl = (el) => { ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => { try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })) } catch (e) {} }) }
  const sw = findStoreSwitcher()
  if (!sw) return { ok: false, reason: 'store switcher not found (click Debug near the StoreID dropdown, share the console)' }
  if (sw.kind === 'select') {
    const target = [...sw.el.options].find(o => { const v = (o.value || o.textContent || ''); return looksLikeStoreId(v) && !/onamz/i.test(v) })
    if (!target) return { ok: false, reason: 'no offsite (non-onamz) store in the dropdown' }
    if ((sw.el.value || '') === (target.value || '')) return { ok: true, already: true, store: (target.value || target.textContent || '').trim() }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')
    if (setter && setter.set) setter.set.call(sw.el, target.value); else sw.el.value = target.value
    sw.el.dispatchEvent(new Event('input', { bubbles: true }))
    sw.el.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, store: (target.value || target.textContent || '').trim() }
  }
  // Custom dropdown: open it, then click the non-onamz store item.
  clickEl(sw.el)
  await sleep(700)
  const items = [...document.querySelectorAll('[role="option"],[role="menuitem"],li,button,a,div')]
    .filter(e => { const t = (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim(); return looksLikeStoreId(t) && t.length < 60 })
  const target = items.find(e => !/onamz/i.test(e.innerText || e.textContent || ''))
  if (!target) return { ok: false, reason: 'opened the dropdown but found no offsite store option' }
  clickEl(target)
  await sleep(500)
  return { ok: true, store: (target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim() }
}
function storeDebugDump() {
  const sw = findStoreSwitcher()
  const selects = [...document.querySelectorAll('select')].map(s => ({ value: s.value, opts: [...s.options].map(o => (o.value || o.textContent || '').trim()).slice(0, 12) }))
  const info = { current: readCurrentStoreId(), onsiteError: hasOnsiteStoreError(), switcher: sw ? sw.kind : null, selects }
  console.log('%c[MVP SCOUT] store switcher:', 'color:#7C3AED;font-weight:bold', info)
  console.log('%c[MVP SCOUT] switcher outerHTML:', 'color:#7C3AED', sw ? (sw.el.outerHTML || '').slice(0, 5000) : '(none)')
  return info
}

// Private-beta gate. The campaign-search panel is published to ALL store users
// (it ships in the extension), so gate it behind an access code until it's ready
// for everyone. NOTE: this is a soft feature-flag, not real security — the code
// lives in the extension source, so it only keeps casual users out, not anyone
// determined. Unlock persists in the page's localStorage (amazon.com origin).
const SCOUT_PW = 'walter'
const SCOUT_UNLOCK_KEY = 'mvp_scout_search_unlocked_v1'
function scoutUnlocked() { try { return localStorage.getItem(SCOUT_UNLOCK_KEY) === '1' } catch (e) { return false } }
function scoutSetUnlocked() { try { localStorage.setItem(SCOUT_UNLOCK_KEY, '1') } catch (e) {} }

// The locked state: a tiny panel asking for the access code. On the right code it
// removes itself and re-mounts the full search panel.
function buildGate() {
  const el = document.createElement('div')
  el.id = PANEL_ID
  el.innerHTML = `
    <div class="mvp-hd"><b>🔒 MVP SCOUT — Campaign Search</b></div>
    <div class="mvp-body">
      <label>Access code</label>
      <input class="mvp-pw" type="password" autocomplete="off" placeholder="Enter code" style="margin-bottom:8px">
      <button class="mvp-btn mvp-unlock" style="width:100%">Unlock</button>
      <div class="mvp-note">SCOUT campaign search is in private beta.</div>
    </div>`
  redock(el)
  const pw = el.querySelector('.mvp-pw')
  const attempt = () => {
    if ((pw.value || '').trim().toLowerCase() === SCOUT_PW) {
      scoutSetUnlocked(); el.remove(); try { mountSearchPanel() } catch (e) {}
    } else { pw.style.borderColor = '#dc2626'; pw.value = ''; pw.placeholder = 'Wrong code — try again' }
  }
  el.querySelector('.mvp-unlock').addEventListener('click', attempt)
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt() })
  setTimeout(() => { try { pw.focus() } catch (e) {} }, 60)
}

// Is this a Creator Connections campaigns page? The URL can be
// "creatorconnections" OR "creator-connections", on www.amazon.com OR
// affiliate-program.amazon.com — so match both spellings AND feature-detect the
// campaign grid (ASIN-labelled cells) so we don't depend on the exact URL shape.
function isCCPage() {
  const u = location.href
  // The live Creator Connections "Affiliate+" campaigns page is:
  //   affiliate-program.amazon.com/p/connect/requests?...&type=affiliate-plus...
  // (older paths used creatorconnections / creator-connections). Match those,
  // and fall back to feature-detecting the campaign grid (ASIN-labelled cells).
  if (/\/p\/connect\b/i.test(u) || /creator[-_ ]?connections/i.test(u)) return true
  try {
    return [...document.querySelectorAll('[aria-label]')]
      .some(e => ASIN_RE.test((e.getAttribute('aria-label') || '').trim().toUpperCase()))
  } catch (e) { return false }
}

// The Amazon campaigns toolbar row (Filters / New Opportunities / Accepted /
// Submitted content links). We inject MVP SCOUT just ABOVE it — the in-flow spot
// other creator tools (e.g. ViralVue) use — rather than a floating panel. Returns
// the toolbar container to insert before, or null (→ floating fallback).
function findToolbarAnchor() {
  try {
    // Preferred: dock right ABOVE the "Filters" button's row. Climb from the
    // Filters button until the parent ALSO contains the campaign tabs — that
    // parent is the shared toolbar column, so `el` is the Filters-row block and
    // inserting SCOUT before it lands it just above Filters.
    const filters = [...document.querySelectorAll('button,[role="button"],a')]
      .find(e => /^\s*filters\s*$/i.test(textOf(e)))
    if (filters) {
      let el = filters
      for (let i = 0; i < 6 && el.parentElement; i++) {
        const p = el.parentElement
        if (/new opportunities|submitted content links|campaigns\s*\(/i.test(p.textContent || '')) return el
        el = p
      }
      return filters.parentElement || filters
    }
    // Fallback: the campaign-tabs row (Filters button not found).
    const tab = [...document.querySelectorAll('button,a,[role="tab"],[role="button"]')]
      .find(e => /^\s*(new opportunities|submitted content links|accepted)\s*$/i.test(textOf(e)))
    if (!tab) return null
    let el = tab
    for (let i = 0; i < 8 && el && el.parentElement; i++) {
      el = el.parentElement
      const t = el.textContent || ''
      if (/submitted content links/i.test(t) && /opportunit/i.test(t)) return el
    }
    return tab.parentElement
  } catch (e) { return null }
}

// Dock the panel in the page flow, right ABOVE Amazon's CC toolbar row (the
// Filters / New Opportunities / Accepted / Submitted content links row).
// NEVER shows a floating panel: until the toolbar renders (CC is a React app, it
// can mount late), the panel sits in the DOM but HIDDEN — so it only ever appears
// already-embedded, no floating flash. Safe to call repeatedly.
// The bottom Y of whatever fixed/sticky bar sits at the very top of the page
// (Oink / ViralVue's banner, or Amazon's own sticky nav) so the SCOUT top-bar can
// pin itself right below it. Ignores the SCOUT panel. 0 when nothing's up there.
function topStickyBottom(selfEl) {
  try {
    let bottom = 0
    const pts = document.elementsFromPoint(Math.floor((window.innerWidth || 1200) / 2), 4)
    for (const node of pts) {
      let n = node
      for (let i = 0; i < 6 && n && n !== document.body; i++) {
        if (n === selfEl || n.id === PANEL_ID) break
        const cs = getComputedStyle(n)
        if (cs.position === 'fixed' || cs.position === 'sticky') {
          const r = n.getBoundingClientRect()
          if (r.top <= 6 && r.bottom > bottom && r.bottom < (window.innerHeight || 800) * 0.5) bottom = r.bottom
          break
        }
        n = n.parentElement
      }
    }
    return Math.round(bottom)
  } catch (e) { return 0 }
}

// The top-bar is position:fixed, so on its own it OVERLAYS the first row of the
// page (Amazon's My Storefront / Creator Connections nav sat right under Oink and
// got covered). Reserve its height with an in-flow spacer at the top of <body> —
// exactly how Oink makes room for its own banner — so SCOUT stacks BELOW Oink and
// ABOVE the nav. A spacer (vs. overriding body padding) never fights Oink's own
// reservation and survives its late mount. Height tracks the bar (shrinks when
// collapsed). Kept as body.firstChild even across React re-renders.
function ensureTopSpacer(el) {
  try {
    const body = document.body
    if (!body || !el || !el.isConnected || el.classList.contains('mvp-hidden')) { removeTopSpacer(); return }
    let sp = document.getElementById('mvp-scout-spacer')
    if (!sp) {
      sp = document.createElement('div')
      sp.id = 'mvp-scout-spacer'
      sp.setAttribute('aria-hidden', 'true')
      sp.style.cssText = 'width:100%;flex:0 0 auto;pointer-events:none'
      body.insertBefore(sp, body.firstChild)
    } else if (body.firstChild !== sp) {
      body.insertBefore(sp, body.firstChild)
    }
    sp.style.height = (el.offsetHeight || 0) + 'px'
  } catch (e) {}
}
function removeTopSpacer() {
  try { const sp = document.getElementById('mvp-scout-spacer'); if (sp) sp.remove() } catch (e) {}
}

// Remove the panel AND its side-effects: stop its timers/observer (they close over
// the old element — leaving them running would fight a freshly-mounted panel's
// reservation) and drop the spacer so the page reclaims the space.
function removePanel(el) {
  try { if (el && el._mvpTimer) clearInterval(el._mvpTimer) } catch (e) {}
  try { if (el && el._mvpRO) el._mvpRO.disconnect() } catch (e) {}
  try { if (el) el.remove() } catch (e) {}
  removeTopSpacer()
}

function redock(el) {
  if (!el) return
  // Top-bar mode owns its own placement — never dock it into the page flow.
  if (el.classList.contains('mvp-topbar')) return
  try {
    const anchor = findToolbarAnchor()
    if (anchor && anchor.parentElement && anchor !== el && !el.contains(anchor)) {
      // Dock inline + reveal. No-op if already parked right above the anchor.
      if (el.nextElementSibling === anchor && el.classList.contains('mvp-inline') && !el.classList.contains('mvp-hidden')) return
      el.classList.add('mvp-inline')
      el.classList.remove('mvp-hidden')
      anchor.parentElement.insertBefore(el, anchor)
    } else if (!el.isConnected) {
      // Toolbar not ready yet — park it in the DOM but HIDDEN (no floating flash);
      // it reveals inline once an anchor appears and redock runs again.
      el.classList.remove('mvp-inline')
      el.classList.add('mvp-hidden')
      document.body.appendChild(el)
    }
  } catch (e) {
    if (!el.isConnected && document.body) { el.classList.add('mvp-hidden'); document.body.appendChild(el) }
  }
}

// Reconfigure the panel for the active Amazon tab: Affiliate+ (campaigns —
// commission/date filters, Draft) vs Sponsored Products (products — EPC/price/
// units filters). CSS (.mvp-only-aff / .mvp-only-spon) does the show/hide; this
// just flips the root class + the header title. Cheap + safe to call repeatedly.
function applyTabUi() {
  const p = document.getElementById(PANEL_ID)
  if (!p) return
  const spon = detectCcTab() === 'sponsored'
  if (p.classList.contains('mvp-sponsored') !== spon) p.classList.toggle('mvp-sponsored', spon)
  const b = p.querySelector('.mvp-hd b')
  if (b) { const t = spon ? '🛒 MVP SCOUT — Product Search' : '🔍 MVP SCOUT — Campaign Search'; if (b.textContent !== t) b.textContent = t }
}

function mountSearchPanel() {
  if (!isCCPage()) return
  if (document.getElementById(PANEL_ID) || !document.body) return

  const style = document.createElement('style')
  style.textContent = `
    #${PANEL_ID}{position:fixed !important;right:16px !important;top:50% !important;transform:translateY(-50%) !important;z-index:2147483000 !important;width:340px !important;max-width:calc(100vw - 24px) !important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif !important;font-size:12px !important;line-height:1.4 !important;background:#fff !important;color:#111 !important;border:1px solid #e5e7eb !important;border-radius:14px !important;box-shadow:0 12px 40px -8px rgba(0,0,0,.28) !important;overflow:hidden !important;box-sizing:border-box !important}
    #${PANEL_ID} *{box-sizing:border-box !important;max-width:100% !important}
    /* Inline mode: sit in the page flow above Amazon's toolbar (like ViralVue) */
    #${PANEL_ID}.mvp-inline{position:static !important;right:auto !important;top:auto !important;left:auto !important;transform:none !important;width:100% !important;max-width:100% !important;margin:0 0 10px !important;border-radius:10px !important;box-shadow:0 2px 12px -4px rgba(124,58,237,.28) !important}
    /* Top-bar mode: a FULL-WIDTH bar pinned to the top, just under the Oink /
       ViralVue sticky banner (top offset set live via --mvp-top). Like Oink. */
    #${PANEL_ID}.mvp-topbar{position:fixed !important;left:0 !important;right:0 !important;top:var(--mvp-top,0px) !important;transform:none !important;width:100vw !important;max-width:100vw !important;border-radius:0 !important;box-shadow:0 3px 10px -3px rgba(0,0,0,.25) !important}
    #${PANEL_ID}.mvp-topbar .mvp-body{max-height:44vh}
    #${PANEL_ID} .mvp-hd{display:flex !important;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;background:linear-gradient(135deg,#7C3AED,#9D6BFF);color:#fff;cursor:pointer;user-select:none}
    #${PANEL_ID} .mvp-hd b{font-size:11.5px;font-weight:700;color:#fff}
    #${PANEL_ID} .mvp-body{padding:9px 10px;max-height:60vh;overflow-y:auto;overflow-x:hidden}
    #${PANEL_ID} .mvp-row{display:flex !important;gap:6px;margin-bottom:6px}
    #${PANEL_ID} .mvp-row>div{flex:1 1 0 !important;min-width:0 !important}
    #${PANEL_ID} input{width:100% !important;padding:5px 8px;border:1px solid #d1d5db;border-radius:7px;font-size:11.5px;background:#fff;color:#111}
    #${PANEL_ID} label{display:block;font-size:9px;font-weight:600;color:#6b7280;margin:0 0 2px 2px;text-transform:uppercase;letter-spacing:.04em}
    #${PANEL_ID} .mvp-btn{padding:6px 9px;border:0;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer;color:#fff;background:#7C3AED;white-space:nowrap}
    #${PANEL_ID} .mvp-btn.sec{background:#fff;color:#7C3AED;border:1px solid #d6c6fb}
    #${PANEL_ID} .mvp-btn.dbg{background:#f3f4f6;color:#374151;border:1px solid #e5e7eb}
    #${PANEL_ID} .mvp-res{margin-top:8px;border-top:1px solid #eee;padding-top:7px}
    #${PANEL_ID} .mvp-card{display:flex !important;gap:8px;align-items:flex-start;padding:8px;border:1px solid #eee;border-radius:10px;margin-bottom:6px}
    #${PANEL_ID} .mvp-sel{flex:0 0 auto !important;width:14px !important;height:14px !important;margin:2px 0 0 !important}
    #${PANEL_ID} .mvp-card img{width:40px !important;height:40px !important;object-fit:cover;border-radius:6px;flex:0 0 40px !important;background:#f3f4f6}
    #${PANEL_ID} .mvp-cardbody{flex:1 1 auto !important;min-width:0 !important;overflow:hidden}
    #${PANEL_ID} .mvp-card .t{font-size:12px;font-weight:600;color:#111;line-height:1.25;overflow-wrap:anywhere;word-break:break-word;white-space:normal !important}
    #${PANEL_ID} .mvp-card .m{font-size:11px;color:#6b7280;margin-top:2px;overflow-wrap:anywhere;white-space:normal !important}
    #${PANEL_ID} .mvp-acc{font-size:11px;font-weight:700;color:#7C3AED;background:none;border:1px solid #d6c6fb;border-radius:6px;padding:3px 7px;cursor:pointer;flex:0 0 auto !important;white-space:nowrap}
    #${PANEL_ID} .mvp-note{font-size:10px;color:#6b7280;margin-top:5px;line-height:1.35}
    #${PANEL_ID} .mvp-token-row{display:none !important;gap:8px;margin:4px 0 8px}
    #${PANEL_ID} .mvp-token-row.show{display:flex !important}
    #${PANEL_ID} .mvp-token-row>div{flex:1 1 0 !important;min-width:0 !important}
    #${PANEL_ID}.mvp-min .mvp-body{display:none}
    #${PANEL_ID}.mvp-hidden{display:none !important}
    /* Tab-aware controls: .mvp-only-aff shows on Affiliate+, .mvp-only-spon on Sponsored Products. */
    #${PANEL_ID}.mvp-sponsored .mvp-only-aff{display:none !important}
    #${PANEL_ID}:not(.mvp-sponsored) .mvp-only-spon{display:none !important}
  `
  document.head.appendChild(style)

  // Private beta: show the access-code gate until unlocked.
  if (!scoutUnlocked()) { buildGate(); return }

  const el = document.createElement('div')
  el.id = PANEL_ID
  el.innerHTML = `
    <div class="mvp-hd"><b>🔍 MVP SCOUT — Campaign Search</b><span class="mvp-tog">–</span></div>
    <div class="mvp-body">
      <div class="mvp-row"><div style="flex:3"><label>Keyword or brand</label><input class="mvp-kw" placeholder="e.g. knee brace"></div><div style="flex:1" class="mvp-only-aff"><label>Min commission %</label><input class="mvp-comm" type="number" min="0" max="100" placeholder="20"></div><div style="flex:1" class="mvp-only-aff"><label>Lasts ≥ (days)</label><input class="mvp-lastdays" type="number" min="0" step="1" placeholder="100"></div><div style="flex:1" class="mvp-only-spon"><label>Min price $</label><input class="mvp-minprice" type="number" min="0" step="1" placeholder="10"></div><div style="flex:1" class="mvp-only-spon"><label>Min Est. EPC $</label><input class="mvp-minepc" type="number" min="0" step="0.05" placeholder="0.50"></div></div>
      <div class="mvp-row"><button class="mvp-btn mvp-search" style="flex:3">Search</button><button class="mvp-btn dbg mvp-draft mvp-only-aff" style="flex:1" title="On a campaign details page: draft a brand-outreach message from the brief">✍️ Draft</button></div>
      <div class="mvp-row mvp-only-spon" style="align-items:center;gap:6px"><span style="font-size:9px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;flex:0 0 auto">Units sold / mo</span><select class="mvp-units" title="Only import products whose monthly units-sold falls in this band — SCOUT reads it during the import deep-check (units aren't on the card)" style="flex:1;padding:5px 8px;border:1px solid #d1d5db;border-radius:7px;font-size:11px;background:#fff;color:#111"><option value="">Any</option><option value="200-500">200 – 500</option><option value="500-1500">500 – 1,500</option><option value="1500-">Over 1,500</option></select></div>
      <div class="mvp-res"></div>
      <div class="mvp-row" style="margin-top:8px"><button class="mvp-btn sec mvp-accsel" style="flex:1" title="Import the ticked picks into MVP — does not accept on Amazon">Import selected into MVP</button></div>
      <div class="mvp-conn" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0 2px;font-size:10px;color:#6b7280"><span class="mvp-conn-status">Checking MVP connection…</span><a class="mvp-conn-change" href="#" style="color:#7c3aed;font-weight:600;text-decoration:none;flex:0 0 auto">Change token</a></div>
      <div class="mvp-token-row"><div><label>MVP ingest token</label><input class="mvp-token" placeholder="CC_..."></div><button class="mvp-btn sec mvp-token-save" style="flex:0 0 auto;align-self:flex-end">Save</button></div>
      <div class="mvp-note mvp-only-aff">Tick campaigns → <b>Import selected into MVP</b> (deep-checks price · monthly sales · video slot, adds to your /epc list — never accepts on Amazon). <b>✍️ Draft</b> writes a brand message on a campaign's page.</div>
      <div class="mvp-note mvp-only-spon"><b>Products</b> (ASIN · price · Est. EPC on the card). Filter by min price / EPC, sort by EPC or price, tick → <b>Import selected into MVP</b> (instant). Set a <b>Units sold / mo</b> band to import only that sales range. Never accepts on Amazon.</div>
    </div>`
  const q = (s) => el.querySelector(s)

  // Dock as a FULL-WIDTH bar pinned to the top of the page, right under the Oink /
  // ViralVue sticky banner — measured live so it always sits just below whatever's
  // fixed up there (falls back to the very top). Replaces the old floating/inline
  // panel, which got stuck at the bottom and wouldn't reopen.
  el.classList.add('mvp-topbar')
  el.classList.remove('mvp-hidden')
  if (document.body && !el.isConnected) document.body.appendChild(el)
  // Pin under Oink AND reserve the bar's height (spacer) so it stacks below Oink and
  // above the page's nav row instead of overlaying it. Both re-run live: Oink mounts
  // late, and the bar's own height changes on collapse / when results render.
  const positionTopbar = () => { try { el.style.setProperty('--mvp-top', topStickyBottom(el) + 'px'); ensureTopSpacer(el) } catch (e) {} }
  positionTopbar()
  window.addEventListener('scroll', positionTopbar, { passive: true })
  window.addEventListener('resize', positionTopbar)
  // Height changes (collapse, results) → resync the spacer + offset immediately.
  try { el._mvpRO = new ResizeObserver(() => positionTopbar()); el._mvpRO.observe(el) } catch (e) {}
  // Oink mounts late / changes height as you scroll; keep re-measuring cheaply.
  el._mvpTimer = setInterval(positionTopbar, 1500)
  applyTabUi()
  const res = q('.mvp-res')
  const selected = new Set()
  let rowsByKey = new Map()  // key → full campaign object, for accept/push
  // Cached result set + current sort, so Sort / Select-all re-render without re-scanning.
  let lastRows = [], lastRawCount = 0, lastMeta = null, lastTab = 'affiliate', sortMode = ''

  // Click the header to collapse / expand the top-bar; re-reserve space (a collapsed
  // bar is shorter, so the page reclaims the difference).
  q('.mvp-hd').addEventListener('click', () => {
    el.classList.toggle('mvp-min')
    q('.mvp-tog').textContent = el.classList.contains('mvp-min') ? '+' : '–'
    positionTopbar()
  })

  function sortRows(rows) {
    const arr = rows.slice()
    const num = (v, d) => (typeof v === 'number' ? v : d)
    if (sortMode === 'price-asc') arr.sort((a, b) => num(a.price, Infinity) - num(b.price, Infinity))
    else if (sortMode === 'price-desc') arr.sort((a, b) => num(b.price, -1) - num(a.price, -1))
    else if (sortMode === 'epc-desc') arr.sort((a, b) => num(b.epc, -1) - num(a.epc, -1))
    else if (sortMode === 'rating-desc') arr.sort((a, b) => (parseFloat(b.rating) || -1) - (parseFloat(a.rating) || -1))
    else if (sortMode === 'comm-desc') arr.sort((a, b) => num(b.commissionPct, -1) - num(a.commissionPct, -1))
    else if (sortMode === 'comm-asc') arr.sort((a, b) => num(a.commissionPct, Infinity) - num(b.commissionPct, Infinity))
    else if (sortMode === 'ends-asc') arr.sort((a, b) => String(a.endsAt || '9999-99-99').localeCompare(String(b.endsAt || '9999-99-99')))
    return arr
  }

  // New result set → reset selection + sort, cache, draw.
  function render(rows, rawCount, meta) {
    selected.clear()
    lastRows = rows; lastRawCount = rawCount; lastMeta = meta || {}; lastTab = (meta && meta.tab) || 'affiliate'
    // Sponsored Products default to Estimated EPC high→low (the value metric).
    sortMode = lastTab === 'sponsored' ? 'epc-desc' : ''
    draw()
  }

  // (Re)paint the results from the cache — applies the current sort, keeps ticks.
  function draw() {
    rowsByKey = new Map(lastRows.map(r => [String(r.key), r]))
    const total = lastMeta && lastMeta.total
    const capped = lastMeta && lastMeta.capped
    const noun = lastTab === 'sponsored' ? 'product' : 'campaign'
    const scanNote = `loaded <b>${lastRawCount}</b>${total && total > lastRawCount ? ` of ~${total.toLocaleString()}` : ''}${capped ? ' · scan cap reached (Search again to keep going, or narrow the keyword)' : ''}`
    if (!lastRows.length) {
      res.innerHTML = lastRawCount > 0
        ? `<div class="mvp-note">Scraped <b>${lastRawCount}</b> ${noun}${lastRawCount === 1 ? '' : 's'} (${scanNote}), but none passed your filters. Clear the filter boxes and Search again.</div>`
        : `<div class="mvp-note">No ${noun}s detected on the page. Try a broader keyword, or click Debug to check the selectors.</div>`
      return
    }
    const sorted = sortRows(lastRows)
    // Sort options differ by tab: Sponsored Products carry price/EPC/rating on the
    // card; Affiliate+ campaigns carry commission/date.
    const opt = (v, label) => `<option value="${v}"${sortMode === v ? ' selected' : ''}>${label}</option>`
    const sortOpts = lastTab === 'sponsored'
      ? opt('epc-desc', 'Est. EPC: high → low') + opt('price-asc', 'Price: low → high') + opt('price-desc', 'Price: high → low') + opt('rating-desc', 'Rating: high → low') + opt('', 'Amazon order')
      : opt('', 'Sort: Amazon') + opt('comm-desc', 'Commission: high → low') + opt('comm-asc', 'Commission: low → high') + opt('ends-asc', 'Ending soonest')
    const bar = `<div class="mvp-note" style="margin:0 0 5px">${lastRows.length}${lastRawCount > lastRows.length ? ` of ${lastRawCount}` : ''} ${noun}${lastRows.length === 1 ? '' : 's'} · ${scanNote}</div>` +
      `<div class="mvp-row" style="align-items:center;gap:6px;margin:0 0 6px">` +
        `<button class="mvp-btn sec mvp-selall" style="flex:0 0 auto;padding:4px 8px;font-size:10.5px">Select all</button>` +
        `<button class="mvp-btn dbg mvp-selnone" style="flex:0 0 auto;padding:4px 8px;font-size:10.5px">Clear</button>` +
        `<select class="mvp-sort" style="flex:1;margin-left:auto;padding:5px 8px;border:1px solid #d1d5db;border-radius:7px;font-size:11px;background:#fff;color:#111">${sortOpts}</select>` +
      `</div>`
    res.innerHTML = bar + sorted.map(r => {
      const key = String(r.key || '')
      return `<div class="mvp-card" data-key="${key.replace(/"/g, '&quot;')}">
        <input type="checkbox" class="mvp-sel"${selected.has(key) ? ' checked' : ''}>
        ${r.image ? `<img src="${r.image}">` : ''}
        <div class="mvp-cardbody">
          <div class="t">${String(r.campaignName || r.brand || 'Product').replace(/</g, '&lt;')}</div>
          <div class="m">${fmtMeta(r) || (r.brand || '')}</div>
        </div>
        <button class="mvp-acc" title="Import just this one into MVP (does not accept it on Amazon)">Import</button>
      </div>`
    }).join('')
    res.querySelectorAll('.mvp-sel').forEach(cb => cb.addEventListener('change', (e) => {
      const key = e.target.closest('.mvp-card').dataset.key
      if (e.target.checked) selected.add(key); else selected.delete(key)
    }))
    res.querySelectorAll('.mvp-acc').forEach(b => b.addEventListener('click', (e) => {
      const key = e.target.closest('.mvp-card').dataset.key
      importOne(rowsByKey.get(key), e.target)
    }))
    const selall = res.querySelector('.mvp-selall'); if (selall) selall.addEventListener('click', () => { lastRows.forEach(r => selected.add(String(r.key))); draw() })
    const selnone = res.querySelector('.mvp-selnone'); if (selnone) selnone.addEventListener('click', () => { selected.clear(); draw() })
    const sortSel = res.querySelector('.mvp-sort'); if (sortSel) sortSel.addEventListener('change', (e) => { sortMode = e.target.value; draw() })
  }

  q('.mvp-search').addEventListener('click', async () => {
    const btn = q('.mvp-search'); const prev = btn.textContent; btn.textContent = 'Searching…'; btn.disabled = true
    res.innerHTML = '<div class="mvp-note">Loading campaigns — scrolling Amazon\'s list to load more…</div>'
    try {
      // Amazon lazy-loads as we scroll, so this can take a moment on a big result
      // set — show the running tally so it never looks stuck.
      const onProgress = (n) => {
        btn.textContent = `Loading ${n}…`
        res.innerHTML = `<div class="mvp-note">Loading campaigns from Amazon… <b>${n}</b> loaded so far (scrolling to pull more).</div>`
      }
      const epcEl = q('.mvp-minepc')
      const priceEl = q('.mvp-minprice')
      const { rows, rawCount, total, capped, tab } = await scoutRunSearch({
        keyword: q('.mvp-kw').value,
        minCommission: parseFloat(q('.mvp-comm').value) || 0,
        lastDays: parseInt(q('.mvp-lastdays').value, 10) || 0,
        minEpc: epcEl ? (parseFloat(epcEl.value) || 0) : 0,
        minPrice: priceEl ? (parseFloat(priceEl.value) || 0) : 0,
      }, onProgress)
      render(rows, rawCount, { total, capped, tab })
    } catch (e) { res.innerHTML = `<div class="mvp-note">Search error: ${e?.message || e}</div>` }
    btn.textContent = prev; btn.disabled = false
  })
  // Debug is no longer a user-facing button (it cluttered the bar). It stays reachable
  // for support: DOUBLE-CLICK the "MVP SCOUT" title to dump card/selector diagnostics.
  q('.mvp-hd b').addEventListener('dblclick', (e) => {
    e.stopPropagation() // don't also toggle collapse
    // Passive card dump only — never navigates the user's tab. (ASIN resolution
    // for the real push happens in a hidden background tab via the worker.)
    // On the Sponsored Products tab, dump what the sponsored reader sees so the
    // ASIN/price/EPC selectors can be tightened from a real page.
    if (detectCcTab() === 'sponsored') {
      const cleanT = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
      const hits = []
      let node
      while ((node = walker.nextNode())) {
        const v = node.nodeValue || ''
        if (v.length < 80 && /\bB0[A-Z0-9]{8}\b/.test(v)) hits.push(node)
      }
      // Run the REAL parser path over every ASIN node — walk up to the card, extract,
      // dedupe by ASIN — so this reports exactly what a Scan would harvest (not just
      // the first node, which may be a stray example/tooltip).
      const parsed = new Map()
      const fails = []
      for (const tn of hits) {
        let cont = tn.parentElement, card = null
        for (let i = 0; i < 14 && cont && cont.parentElement; i++) {
          const t = cont.textContent || ''
          if (t.indexOf('$') !== -1 && /\d/.test(t) && t.length < 1600) { card = cont; break }
          cont = cont.parentElement
        }
        if (!card) { if (fails.length < 3) fails.push({ why: 'no $-container', asinNode: cleanT(tn.nodeValue).slice(0, 40) }); continue }
        const c = extractSponsoredCard(card)
        if (c && c.asin) { if (!parsed.has(c.asin)) parsed.set(c.asin, c) }
        else if (fails.length < 3) {
          const all = cleanT(card.textContent)
          fails.push({
            why: 'extract null',
            asinRe: /\bASIN:?\s*(B0[A-Z0-9]{8})/i.test(all) || /(B0[A-Z0-9]{8})/.test(all),
            len: all.length, tag: card.tagName, cls: (card.className || '').toString().slice(0, 50),
            text: all.slice(0, 260),
          })
        }
      }
      const list = [...parsed.values()]
      // eslint-disable-next-line no-console
      console.log('[MVP SCOUT] sponsored debug — ASIN nodes:', hits.length, '· unique parsed:', list.length, '· sample:', list.slice(0, 3), '· failures:', fails)
      const sample = list[0]
      res.innerHTML = `<div class="mvp-note">Sponsored tab. ASIN nodes: <b>${hits.length}</b> → parsed <b>${list.length}</b> cards.${sample ? ` First: <b>${String(sample.campaignName || sample.asin).replace(/</g, '&lt;')}</b> — $${sample.price ?? '?'} · EPC $${sample.epc ?? '?'} · ★${sample.rating ?? '?'}` : ''}${list.length === 0 && fails.length ? ` <b>Why 0:</b> ${String(fails[0].why)}${fails[0].text ? ` · asinRe=${fails[0].asinRe} · «${String(fails[0].text).replace(/</g, '&lt;').slice(0, 160)}»` : ''}` : ''} <br>Full sample + failures logged to console (⌥⌘J).</div>`
      return
    }
    const d = dumpCardDebug()
    const st = storeDebugDump()
    const first = d.parsed ? String(d.parsed.campaignName || d.parsed.brand || d.parsed.key) : 'none — run a Search or scroll the campaign list into view'
    const dc = d.details ? (d.details.testid || d.details.text || d.details.tag) : 'n/a'
    res.innerHTML = `<div class="mvp-note">Dumped to the console (⌥⌘J). cards=<b>${d.cardCount}</b>, with ASIN in card=<b>${d.cardsWithAsin}</b>.<br>First card: ${String(first).replace(/</g, '&lt;')}.<br>Details link: ${String(dc).replace(/</g, '&lt;')}.<br>Store: <b>${String(st.current || '?').replace(/</g, '&lt;')}</b>${st.onsiteError ? ' (onsite error)' : ''} · switcher=${st.switcher || 'none'}.</div>`
  })
  q('.mvp-draft').addEventListener('click', async () => {
    const btn = q('.mvp-draft'); const prev = btn.textContent; btn.textContent = 'Drafting…'; btn.disabled = true
    try {
      const r = await scoutDraftMessage()
      const groupNote = r.groups > 1 ? ` as ${r.groups} separate messages` : ''
      res.innerHTML = r.ok
        ? (r.sent
            ? `<div class="mvp-note">✅ Sent to the brand${groupNote}. Check the chat above.</div>`
            : `<div class="mvp-note">✍️ Draft placed in the brand's message box (${r.chars} chars) — ${String(r.reason || 'review it and hit Amazon\'s Send').replace(/</g, '&lt;')}.</div>`)
        : `<div class="mvp-note">Couldn't draft: ${String(r.reason).replace(/</g, '&lt;')}.</div>`
    } catch (e) { res.innerHTML = `<div class="mvp-note">Draft error: ${String(e?.message || e).replace(/</g, '&lt;')}</div>` }
    btn.textContent = prev; btn.disabled = false
  })
  q('.mvp-accsel').addEventListener('click', async () => {
    const btn = q('.mvp-accsel'); const keys = [...selected]
    if (!keys.length) { btn.textContent = 'Select some first'; setTimeout(() => { btn.textContent = 'Import selected' }, 1600); return }
    const token = await getIngestToken()
    if (!token) { showTokenRow(); res.innerHTML = '<div class="mvp-note">Connect MVP first — paste your ingest token below, then Import selected again.</div>'; return }
    btn.disabled = true
    let imported = 0
    const dropped = []
    // Optional "Units sold / mo" band. Monthly units are NOT on the card, so when
    // a band is set SCOUT deep-checks each ticked product (opens its /dp, reads
    // "X bought in past month") and imports only those in the band. Without a band,
    // sponsored rows import instantly (ASIN + price already on the card, no /dp).
    const unitsVal = (q('.mvp-units') && q('.mvp-units').value) || ''
    let uMin = 0, uMax = Infinity
    if (unitsVal) { const p = unitsVal.split('-'); uMin = parseInt(p[0], 10) || 0; uMax = p[1] ? (parseInt(p[1], 10) || Infinity) : Infinity }
    const wantSales = !!unitsVal
    for (let i = 0; i < keys.length; i++) {
      const camp = rowsByKey.get(keys[i])
      const label = camp ? (camp.campaignName || camp.brand || camp.key) : keys[i]
      if (!camp) { dropped.push(`${keys[i]}: missing`); continue }
      // Fast path: sponsored card already has ASIN + price, and no sales gate → push
      // straight in, NO /dp visit (that's what triggers Amazon blocks).
      if (camp.asin && !wantSales) {
        btn.textContent = `Importing ${i + 1}/${keys.length}…`
        res.innerHTML = `<div class="mvp-note">Importing ${i + 1}/${keys.length}: ${String(label).slice(0, 46).replace(/</g, '&lt;')}…</div>`
        const push = await pushCampaignToMvp(camp, camp.asin, token, typeof camp.price === 'number' ? { price: camp.price } : undefined)
        if (push.ok) imported++; else dropped.push(`${label}: push failed (${push.error || '?'})`)
        continue
      }
      // Deep-check path (Affiliate+ always; sponsored only when a sales band is set).
      btn.textContent = `Checking ${i + 1}/${keys.length}…`
      res.innerHTML = `<div class="mvp-note">Deep-checking ${i + 1}/${keys.length}: ${String(label).slice(0, 42).replace(/</g, '&lt;')}… <br>(opening its Amazon page for price${wantSales ? ' + monthly units sold' : ''} + carousel video)</div>`
      const durl = camp.detailsUrl || (camp.asin ? `https://www.amazon.com/dp/${camp.asin}` : null)
      if (!durl) { dropped.push(`${label}: no product link`); continue }
      let deep = null
      try { deep = await chrome.runtime.sendMessage({ type: 'SCOUT_DEEP_CHECK', detailsUrl: durl }) } catch (e) {}
      const asin = (deep && deep.asin) || camp.asin
      if (!asin) { dropped.push(`${label}: couldn't read ASIN`); continue }
      const sales = deep && typeof deep.sales === 'number' ? deep.sales : null
      if (wantSales) {
        if (sales == null) { dropped.push(`${label}: units unknown`); continue }
        if (sales < uMin || (uMax !== Infinity && sales > uMax)) { dropped.push(`${label}: ${sales}/mo outside band`); continue }
      }
      const price = (deep && typeof deep.price === 'number') ? deep.price : (typeof camp.price === 'number' ? camp.price : null)
      // NOTE: importing never accepts on Amazon — accepting stays your choice in MVP.
      const push = await pushCampaignToMvp(camp, asin, token, { monthlySales: sales, hasVideo: deep && deep.hasVideo, carouselPos: deep && deep.carouselPos, price })
      if (push.ok) imported++; else dropped.push(`${label}: push failed (${push.error || '?'})`)
    }
    btn.textContent = 'Import selected into MVP'; btn.disabled = false
    const dropHtml = dropped.length
      ? `<br>Skipped ${dropped.length}:<br>• ${dropped.slice(0, 8).map(s => String(s).replace(/</g, '&lt;')).join('<br>• ')}${dropped.length > 8 ? '<br>• …' : ''}`
      : ''
    res.innerHTML = `<div class="mvp-note"><b>Imported ${imported}</b> to your MVP /epc list, ready to Generate + Message (not accepted on Amazon — accept from MVP when you're ready).${dropHtml}</div>`
  })
  // ── MVP connection status ──────────────────────────────────────────────────
  // Validates the stored token against MVP and shows which account it maps to +
  // that account's queued count. This is the fix for "✓ In MVP but /epc empty":
  // if the token maps to a DIFFERENT account (a stale token from earlier), the
  // push lands there — the queued number here won't match what /epc shows, making
  // the mismatch obvious so the user can paste the token from THEIR /epc page.
  async function refreshConnStatus() {
    const el = q('.mvp-conn-status'); if (!el) return
    const token = await getIngestToken()
    if (!token) { el.innerHTML = '⚠️ <b>Not connected</b> — paste your MVP ingest token'; el.style.color = '#b45309'; q('.mvp-token-row').classList.add('show'); return }
    el.textContent = 'Checking MVP connection…'; el.style.color = '#6b7280'
    let r = null
    try { r = await chrome.runtime.sendMessage({ type: 'SCOUT_VALIDATE_TOKEN', token }) } catch (e) {}
    const tail = '…' + token.slice(-4)
    if (r && r.ok) {
      el.innerHTML = `✓ <b>Connected</b> to MVP (token ${tail}) · this account has <b>${r.queued ?? '?'}</b> campaign${r.queued === 1 ? '' : 's'}${r.pro ? '' : ' · <span style="color:#b45309">not Pro — import is Pro-only</span>'}`
      el.style.color = r.pro ? '#059669' : '#b45309'
    } else if (r && r.error) {
      el.innerHTML = `⚠️ Token ${tail} <b>invalid</b> (${String(r.error).replace(/</g, '&lt;')}) — paste the token from your /epc page`
      el.style.color = '#b45309'
    } else {
      el.innerHTML = `Token ${tail} saved — couldn't reach MVP to verify (reload SCOUT if pushes fail)`
      el.style.color = '#6b7280'
    }
  }
  const connChange = q('.mvp-conn-change')
  if (connChange) connChange.addEventListener('click', (e) => {
    e.preventDefault()
    const row = q('.mvp-token-row'); row.classList.toggle('show')
    if (row.classList.contains('show')) { const inp = q('.mvp-token'); if (inp) inp.focus() }
  })
  const tokenSave = q('.mvp-token-save')
  if (tokenSave) tokenSave.addEventListener('click', () => {
    const t = ((q('.mvp-token').value) || '').trim()
    if (t) { try { chrome.storage.local.set({ ccToken: t }) } catch (e) {} q('.mvp-token-row').classList.remove('show'); tokenSave.textContent = '✓ Saved'; refreshConnStatus() }
  })
  refreshConnStatus()

  // Store-ID guard — CC is blocked on an onsite (onamz…) store. When we detect
  // the wrong store (banner error OR an onamz-prefixed StoreID), AUTO-switch to
  // the offsite store — no click. Guarded to one attempt per page load (a switch
  // reloads the page, so we never loop) via a window flag that survives panel
  // re-mounts but resets on the fresh injection after reload.
  async function autoFixStore() {
    if (!storeNeedsSwitch() || window.__mvpStoreAutoFixed) return
    window.__mvpStoreAutoFixed = true
    const cur = readCurrentStoreId() || 'onsite store'
    res.innerHTML = `<div class="mvp-note">Wrong Store ID (${String(cur).replace(/</g, '&lt;')}) for Creator Connections — switching to your offsite store…</div>`
    let r
    try { r = await switchToOffsiteStore() } catch (e) { r = { ok: false, reason: (e && e.message) || 'error' } }
    if (r.ok) {
      res.innerHTML = `<div class="mvp-note">✅ Switched to <b>${String(r.store || 'offsite store').replace(/</g, '&lt;')}</b>${r.already ? ' (already selected).' : ' — reloading with Creator Connections access…'}</div>`
    } else {
      res.innerHTML = `<div class="mvp-note" style="border:1px solid #fca5a5;background:#fef2f2;color:#991b1b;border-radius:8px;padding:8px">Couldn't auto-switch the Store ID (${String(r.reason || 'unknown').replace(/</g, '&lt;')}). Pick your offsite store (no "onamz" prefix) from the StoreID dropdown, or <button class="mvp-btn mvp-fixstore" style="width:100%;margin-top:6px">Retry auto-switch</button></div>`
      const fx = q('.mvp-fixstore'); if (fx) fx.addEventListener('click', () => { window.__mvpStoreAutoFixed = false; autoFixStore() })
    }
  }
  try { autoFixStore() } catch (e) {}
}

// SCOUT is INVISIBLE on Amazon (2026-07-06): the on-page Campaign Search panel
// is RETIRED. Every scan / deep-check / import is driven headlessly from the
// MVP app (Smart Scan on /epc, Product Finder, Check CC) via the background
// message handlers above — nothing renders on Amazon's pages anymore. The
// popup (token + connect) is the extension's only UI. mountSearchPanel & co
// below are dormant; kept for now in case an on-page surface returns.
try { const stale = document.getElementById(PANEL_ID); if (stale) removePanel(stale) } catch (e) {}

// Learn the creator's own Creator Connections id from any CC page they visit and
// hand it to the background worker to cache. That's what lets "Check CC" deep-link
// to the working campaign grid even when the user has NO CC tab open — without it,
// SCOUT could only scan a CC tab that happened to already be open, and opening its
// own tab landed on Amazon's dead legacy shell. Sends once per distinct id.
let _ccIdSent = null
function captureCreatorId() {
  try {
    const m = location.href.match(/creatorId=(amzn1\.creator\.[a-z0-9-]+)/i)
    const id = m && m[1]
    if (id && id !== _ccIdSent) {
      _ccIdSent = id
      const p = chrome.runtime.sendMessage({ type: 'CC_CREATOR_ID', creatorId: id })
      if (p && p.catch) p.catch(() => {})
    }
  } catch (e) {}
}
try { captureCreatorId() } catch (e) {}

// Keep the creator id fresh across SPA navigation (CC is a React app), and
// sweep away any panel a stale pre-invisible build might have left behind.
setInterval(() => {
  try {
    captureCreatorId() // cheap + self-guarded; the id can appear after SPA nav
    const existing = document.getElementById(PANEL_ID)
    if (existing) removePanel(existing)
  } catch (e) {}
}, 2000)
})();

// ─── Storefront Stats v2: Amazon Influencer earnings scraper ─────────────────
// Self-contained (runs after the main IIFE). On affiliate-program.amazon.com
// report pages, finds the earnings/orders table by HEADER TEXT, parses per-ASIN
// rows, detects the period (weekly|monthly) + date range, and pushes to
// /api/storefront/ingest via the worker. Auto-syncs (throttled) whenever the
// user is on a report page — no button.
//
// NOTE: the table/column selectors are HEURISTIC (matched on header words like
// "ASIN", "Earnings", "Shipped Items"), because Amazon's report markup isn't
// fixed. It never throws and no-ops when it can't confidently find a table or a
// date range — so a markup change degrades to "no sync", never bad data. Needs
// one validation pass against the live report DOM to confirm the header words.
;(function mvpEarningsScout() {
  try {
    if (!/affiliate-program\.amazon\.com/.test(location.host)) return
    if (!/report|earning|order|performance/i.test(location.href)) return
  } catch (e) { return }

  const num = (s) => { const n = parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null }
  const ASIN_RE = /\b([A-Z0-9]{10})\b/
  const toISO = (s) => { const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }

  function pickPeriod() {
    const txt = document.body.innerText || ''
    // Range type from the report's OWN selector wording (beats guessing off the
    // span — a partial "This Month" can be only a few days wide).
    const sel = (txt.match(/\b(This Week|Last Week|This Month|Last Month|Year to Date|Last \d+ Days?)\b/i) || [])[1] || ''
    let type = /week/i.test(sel) ? 'weekly' : /month|year/i.test(sel) ? 'monthly' : ''
    // Date range like "Jul 26 - Aug 04 2026" (the year may sit only on the END).
    let start = null, end = null
    const m = txt.match(/([A-Z][a-z]{2})\s+(\d{1,2})(?:,?\s*(\d{4}))?\s*(?:-|–|—|to)\s*([A-Z][a-z]{2})\s+(\d{1,2}),?\s*(\d{4})/)
    if (m) {
      const year = m[6]
      start = toISO(`${m[1]} ${m[2]} ${m[3] || year}`)
      end = toISO(`${m[4]} ${m[5]} ${year}`)
    }
    if (!type) type = (start && end && Math.round((Date.parse(end) - Date.parse(start)) / 86400000) <= 10) ? 'weekly' : 'monthly'
    return { type, start, end }
  }

  // Per-product earnings table = the one whose header carries BOTH "Total
  // Earnings" and "Items Shipped" (verified against the live report DOM).
  function findEarningsTable() {
    for (const t of document.querySelectorAll('table')) {
      const head = ((t.querySelector('thead') || t).innerText || '').toLowerCase()
      if (/total earnings/.test(head) && /items shipped/.test(head)) return t
    }
    return null
  }

  // Columns by exact header wording. units = Items Shipped, revenue = Items
  // Shipped Revenue, earnings = Total Earnings. "Commission Rate" is a %, NOT
  // money, so it's deliberately skipped.
  function colMap(table) {
    const ths = [...table.querySelectorAll('thead th, thead td')]
    const map = {}
    ths.forEach((th, i) => {
      const h = (th.innerText || '').toLowerCase().replace(/\s+/g, ' ').trim()
      if (h === 'clicks' && map.clicks == null) map.clicks = i
      else if (/items shipped revenue/.test(h) && map.revenue == null) map.revenue = i
      else if (/total earnings/.test(h) && map.commission == null) map.commission = i
      else if (/^items shipped$/.test(h) && map.units == null) map.units = i
    })
    return map
  }

  function parse() {
    const table = findEarningsTable(); if (!table) return []
    const map = colMap(table)
    const { type, start, end } = pickPeriod()
    if (!start || !end) return [] // no confident date range → skip
    const out = []
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = [...tr.children]
      if (!cells.length) continue
      // The report has NO ASIN text column — the ASIN lives in the product link
      // (/dp/ASIN or /gp/product/ASIN). That's the only reliable key.
      const asin = (tr.innerHTML.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/) || [])[1]
      if (!asin) continue
      const cell = (i) => (i != null && cells[i]) ? (cells[i].innerText || '').trim() : ''
      const link = tr.querySelector('a[href*="/product/"], a[href*="/dp/"]')
      const title = ((link && (link.getAttribute('title') || link.textContent)) || '').trim().slice(0, 300)
      const rec = { asin, periodType: type, periodStart: start, periodEnd: end }
      if (title) rec.productTitle = title
      if (map.revenue != null) rec.revenue = num(cell(map.revenue))
      if (map.commission != null) rec.commission = num(cell(map.commission))
      if (map.units != null) rec.units = num(cell(map.units))
      if (map.clicks != null) rec.clicks = num(cell(map.clicks))
      if (rec.revenue == null && rec.commission == null && rec.units == null) continue
      out.push(rec)
    }
    return out
  }

  async function syncIfDue() {
    const earnings = parse()
    if (!earnings.length) { console.debug('[SCOUT earnings] no rows parsed yet (waiting for the report table)'); return }
    const key = 'mvpEarnSync:' + earnings[0].periodType + ':' + earnings[0].periodStart
    const last = await new Promise((r) => { try { chrome.storage.local.get([key], (o) => r((o && o[key]) || 0)) } catch (e) { r(0) } })
    if (Date.now() - last < 4 * 3600 * 1000) { console.debug('[SCOUT earnings] throttled (synced within the last 4h for', key + ')'); return }
    try {
      // Pushed over the session bridge — the worker fetch carries the MVP cookie,
      // so /api/storefront/ingest authenticates via the signed-in session (no token).
      const res = await chrome.runtime.sendMessage({ type: 'SCOUT_PUSH_EARNINGS', earnings })
      if (res && res.ok) {
        console.debug('[SCOUT earnings] synced', earnings.length, 'products →', res.upserted, 'upserted')
        try { chrome.storage.local.set({ [key]: Date.now() }) } catch (e) {}
      } else {
        console.debug('[SCOUT earnings] push failed', res)
      }
    } catch (e) { console.debug('[SCOUT earnings] push error', e) }
  }

  let t = null
  const kick = () => { clearTimeout(t); t = setTimeout(() => { try { syncIfDue() } catch (e) {} }, 2500) }
  kick()
  try { new MutationObserver(kick).observe(document.body, { childList: true, subtree: true }) } catch (e) {}
})();

// ─── Idea Lists ─────────────────────────────────────────────────────────────
// Moved to its own content script (idea-lists.js) so a failure anywhere else
// in this file can never stop the idea-list sync from running. See manifest.
