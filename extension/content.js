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
  const cM = full.match(/(?:up to\s*)?(\d{1,2}(?:\.\d)?)\s*%\s*commission/i)
    || full.match(/commission[:\s]*(?:up to\s*)?(\d{1,2}(?:\.\d)?)\s*%/i)
    || full.match(/\b(\d{1,2}(?:\.\d)?)\s*%/)   // last-resort: any % on the card
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
    // the grid scrolls (best-effort — the popup may be closed).
    try { chrome.runtime.sendMessage({ type: 'CC_SCAN_PROGRESS', found: byAsin.size }) } catch (e) {}
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
async function applyAmazonSearch(keyword) {
  const kw = (keyword || '').trim()
  if (!kw) return { searched: false }
  const input = document.querySelector(
    'input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i]',
  )
  if (!input) return { searched: false, reason: 'no-search-box' }
  if ((input.value || '').trim().toLowerCase() === kw.toLowerCase()) {
    return { searched: true, already: true }
  }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (setter) setter.call(input, kw); else input.value = kw
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))

  // Amazon debounces the query, BLANKS the grid, fetches, then repaints. If we
  // scrape during that blank gap we get nothing ("No campaigns detected"). So
  // wait for the results to actually POPULATE and SETTLE — ASIN cells present
  // and their (virtualized) count stable across several polls — before the
  // caller scrapes. Bails after ~16s (treated as a genuinely empty result set).
  await sleep(900)            // let the debounced fetch kick off
  let last = -1
  let stable = 0
  for (let i = 0; i < 50; i++) {
    await sleep(300)
    const g = findGrid()
    const n = g ? cellsIn(g).length : 0
    if (n > 0 && n === last) {
      if (++stable >= 3) { await sleep(500); return { searched: true, count: n } } // populated + steady
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

if (!window.__ccScoutListener) {
  window.__ccScoutListener = true
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'CC_SCAN') {
      ;(async () => {
        // When a keyword is supplied, drive Amazon's own search box first so we
        // scan the FULL catalogue's matches, not just the rendered page.
        let search = { searched: false }
        if (msg.keyword) {
          try { search = await applyAmazonSearch(msg.keyword) } catch (e) { search = { searched: false, reason: e?.message || 'search-failed' } }
        }
        const campaigns = await parseCampaigns()
        sendResponse({ campaigns, diag: { ...collectDiag(), search } })
      })().catch(e => sendResponse({ error: e?.message || 'parse failed', campaigns: [], diag: collectDiag() }))
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
  return { key: campaignId || campaignName, campaignId, campaignName, brand, commissionPct, budget, startsAt, endsAt, image, detailsUrl }
}
// Scroll the virtualized grid top→bottom, harvesting every campaign card.
async function parseCampaignCards() {
  const grid = findGrid()
  if (!grid) return []
  const byKey = new Map()
  const harvest = () => {
    for (const cont of document.querySelectorAll('[data-testid="campaign-card-container"]')) {
      const c = extractNewCard(cont)
      if (c.key && !byKey.has(c.key)) byKey.set(c.key, c)
    }
  }
  const step = Math.max(300, grid.clientHeight - 80)
  let pos = 0, lastTop = -1, stalls = 0
  grid.scrollTop = 0; await sleep(120); harvest()
  for (let i = 0; i < 400; i++) {
    pos += step; grid.scrollTop = pos; await sleep(140); harvest()
    const top = grid.scrollTop
    if (top === lastTop) { if (++stalls >= 2) break } else { stalls = 0; lastTop = top }
    if (top + grid.clientHeight >= grid.scrollHeight - 2) { await sleep(140); harvest(); break }
  }
  grid.scrollTop = 0
  return [...byKey.values()]
}

// Click a campaign's Accept button, matched by its campaign id.
function scoutAccept(key) {
  if (!key) return { ok: false, reason: 'no-key' }
  const btn = document.querySelector(`button[data-testid="${key}-campaign-card-accept-btn"]`)
  if (btn) { btn.click(); return { ok: true } }
  return { ok: false, reason: 'accept-btn-not-found' }
}

// Click Amazon's own "Submit accepted campaigns" button to finalise the batch.
function scoutSubmitAccepted() {
  const btn = [...document.querySelectorAll('button,a,[role="button"]')].find(b => /submit accepted campaigns/i.test(textOf(b)))
  if (btn) { btn.click(); return true }
  return false
}

// ── Push accepted campaigns into MVP (ASIN-grounded) ────────────────────────
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

// POST one accepted campaign into the MVP Creator Campaigns inbox. The row lands
// as `pending`, ready for one-click "Generate post". Maps to the existing ingest
// shape: commission % goes into the free-text `epc` field.
async function pushCampaignToMvp(camp, asin, token) {
  try {
    const res = await fetch(`${MVP_ORIGIN}/api/campaigns/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        campaigns: [{
          asin,
          campaignName: camp.campaignName || camp.brand || null,
          // Affiliate+ = extra commission per SALE (a percent), NOT dollar EPC.
          // Send it in its own field so the app never treats 10% as $10.
          program: 'affiliate_plus',
          commissionPct: camp.commissionPct != null ? camp.commissionPct : null,
          endsAt: camp.endsAt || null,
        }],
      }),
    })
    return res.ok
  } catch (e) { return false }
}

// Accept a campaign on Amazon AND push it (with its resolved ASIN) into MVP.
// Drives the given Accept button through visible stages so the user sees
// progress. Returns { accepted, pushed }.
async function acceptAndPush(camp, btn) {
  const set = (t, color) => { if (btn) { btn.textContent = t; if (color) btn.style.color = color } }
  if (!camp) { set('Retry', '#dc2626'); return { accepted: false, pushed: false } }
  if (btn) btn.disabled = true
  const acc = scoutAccept(camp.key)
  if (!acc.ok) { set('Retry', '#dc2626'); if (btn) btn.disabled = false; return { accepted: false, pushed: false } }
  set('✓ Accepted', '#059669')
  const token = await getIngestToken()
  if (!token) { set('✓ · connect MVP', '#b45309'); showTokenRow(); if (btn) btn.disabled = false; return { accepted: true, pushed: false } }
  set('Finding ASIN…', '#6b7280')
  const asin = await resolveCampaignAsin(camp.detailsUrl)
  if (!asin) { set('✓ · no ASIN', '#b45309'); if (btn) btn.disabled = false; return { accepted: true, pushed: false } }
  set('Sending…', '#6b7280')
  const ok = await pushCampaignToMvp(camp, asin, token)
  set(ok ? '✓ In MVP' : '✓ · push failed', ok ? '#059669' : '#b45309')
  if (btn) btn.disabled = false
  return { accepted: true, pushed: ok }
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

async function scoutRunSearch(f) {
  // Keyword OR ASIN both drive Amazon's own search box (it searches by ASIN too),
  // so we scan the FULL catalogue's matches, then read + filter the cards.
  const query = (f.asin || f.keyword || '').trim()
  if (query) { try { await applyAmazonSearch(query) } catch (e) {} }
  let rows = await parseCampaignCards()
  const rawCount = rows.length
  // Filters are LENIENT on missing fields (a card whose value we couldn't read is
  // kept, not dropped). "Ends after" also keeps open-ended campaigns.
  if (f.minCommission) rows = rows.filter(r => r.commissionPct == null || r.commissionPct >= f.minCommission)
  if (f.endsAfter) rows = rows.filter(r => !r.endsAt || r.endsAt >= f.endsAfter)
  if (f.endsBefore) rows = rows.filter(r => !r.endsAt || r.endsAt <= f.endsBefore)
  return { rows, rawCount }
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
  document.body.appendChild(el)
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
    const tab = [...document.querySelectorAll('button,a,[role="tab"],[role="button"]')]
      .find(e => /^\s*(new opportunities|submitted content links|accepted)\s*$/i.test(textOf(e)))
    if (!tab) return null
    // Walk up to the tightest ancestor that wraps the whole tab row (contains
    // both the "Submitted content links" and "…Opportunities" tabs).
    let el = tab
    for (let i = 0; i < 8 && el && el.parentElement; i++) {
      el = el.parentElement
      const t = el.textContent || ''
      if (/submitted content links/i.test(t) && /opportunit/i.test(t)) return el
    }
    return tab.parentElement
  } catch (e) { return null }
}

function mountSearchPanel() {
  if (!isCCPage()) return
  if (document.getElementById(PANEL_ID) || !document.body) return

  const style = document.createElement('style')
  style.textContent = `
    #${PANEL_ID}{position:fixed !important;right:16px !important;top:50% !important;transform:translateY(-50%) !important;z-index:2147483000 !important;width:340px !important;max-width:calc(100vw - 24px) !important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif !important;font-size:12px !important;line-height:1.4 !important;background:#fff !important;color:#111 !important;border:1px solid #e5e7eb !important;border-radius:14px !important;box-shadow:0 12px 40px -8px rgba(0,0,0,.28) !important;overflow:hidden !important;box-sizing:border-box !important}
    #${PANEL_ID} *{box-sizing:border-box !important;max-width:100% !important}
    /* Inline mode: sit in the page flow above Amazon's toolbar (like ViralVue) */
    #${PANEL_ID}.mvp-inline{position:static !important;right:auto !important;top:auto !important;left:auto !important;transform:none !important;width:100% !important;max-width:100% !important;margin:0 0 14px !important;box-shadow:0 2px 14px -4px rgba(124,58,237,.30) !important}
    #${PANEL_ID} .mvp-hd{display:flex !important;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;background:linear-gradient(135deg,#7C3AED,#9D6BFF);color:#fff;cursor:pointer}
    #${PANEL_ID} .mvp-hd b{font-size:13px;font-weight:700;color:#fff}
    #${PANEL_ID} .mvp-body{padding:12px;max-height:70vh;overflow-y:auto;overflow-x:hidden}
    #${PANEL_ID} .mvp-row{display:flex !important;gap:8px;margin-bottom:8px}
    #${PANEL_ID} .mvp-row>div{flex:1 1 0 !important;min-width:0 !important}
    #${PANEL_ID} input{width:100% !important;padding:7px 9px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;background:#fff;color:#111}
    #${PANEL_ID} label{display:block;font-size:10px;font-weight:600;color:#6b7280;margin:0 0 3px 2px;text-transform:uppercase;letter-spacing:.04em}
    #${PANEL_ID} .mvp-btn{padding:8px 10px;border:0;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:#fff;background:#7C3AED;white-space:nowrap}
    #${PANEL_ID} .mvp-btn.sec{background:#fff;color:#7C3AED;border:1px solid #d6c6fb}
    #${PANEL_ID} .mvp-btn.dbg{background:#f3f4f6;color:#374151;border:1px solid #e5e7eb}
    #${PANEL_ID} .mvp-res{margin-top:10px;border-top:1px solid #eee;padding-top:8px}
    #${PANEL_ID} .mvp-card{display:flex !important;gap:8px;align-items:flex-start;padding:8px;border:1px solid #eee;border-radius:10px;margin-bottom:6px}
    #${PANEL_ID} .mvp-sel{flex:0 0 auto !important;width:14px !important;height:14px !important;margin:2px 0 0 !important}
    #${PANEL_ID} .mvp-card img{width:40px !important;height:40px !important;object-fit:cover;border-radius:6px;flex:0 0 40px !important;background:#f3f4f6}
    #${PANEL_ID} .mvp-cardbody{flex:1 1 auto !important;min-width:0 !important;overflow:hidden}
    #${PANEL_ID} .mvp-card .t{font-size:12px;font-weight:600;color:#111;line-height:1.25;overflow-wrap:anywhere;word-break:break-word;white-space:normal !important}
    #${PANEL_ID} .mvp-card .m{font-size:11px;color:#6b7280;margin-top:2px;overflow-wrap:anywhere;white-space:normal !important}
    #${PANEL_ID} .mvp-acc{font-size:11px;font-weight:700;color:#7C3AED;background:none;border:1px solid #d6c6fb;border-radius:6px;padding:3px 7px;cursor:pointer;flex:0 0 auto !important;white-space:nowrap}
    #${PANEL_ID} .mvp-note{font-size:11px;color:#6b7280;margin-top:6px;line-height:1.4}
    #${PANEL_ID} .mvp-token-row{display:none !important;gap:8px;margin:4px 0 8px}
    #${PANEL_ID} .mvp-token-row.show{display:flex !important}
    #${PANEL_ID} .mvp-token-row>div{flex:1 1 0 !important;min-width:0 !important}
    #${PANEL_ID}.mvp-min .mvp-body{display:none}
  `
  document.head.appendChild(style)

  // Private beta: show the access-code gate until unlocked.
  if (!scoutUnlocked()) { buildGate(); return }

  const el = document.createElement('div')
  el.id = PANEL_ID
  el.innerHTML = `
    <div class="mvp-hd"><b>🔍 MVP SCOUT — Campaign Search</b><span class="mvp-tog">–</span></div>
    <div class="mvp-body">
      <div class="mvp-row"><div><label>Keyword or brand</label><input class="mvp-kw" placeholder="e.g. knee brace"></div></div>
      <div class="mvp-row"><div><label>ASIN</label><input class="mvp-asin" placeholder="B0XXXXXXXX"></div><div><label>Min commission %</label><input class="mvp-comm" type="number" min="0" max="100" placeholder="20"></div></div>
      <div class="mvp-row"><div><label>Ends after</label><input class="mvp-after" type="date"></div><div><label>Ends before</label><input class="mvp-before" type="date"></div></div>
      <div class="mvp-row"><button class="mvp-btn mvp-search" style="flex:2">Search</button><button class="mvp-btn dbg mvp-debug" style="flex:1">Debug</button></div>
      <div class="mvp-res"></div>
      <div class="mvp-row" style="margin-top:8px"><button class="mvp-btn sec mvp-accsel" style="flex:1">Accept selected</button><button class="mvp-btn sec mvp-submit" style="flex:1">Submit accepted</button></div>
      <div class="mvp-token-row"><div><label>MVP ingest token</label><input class="mvp-token" placeholder="CC_..."></div><button class="mvp-btn sec mvp-token-save" style="flex:0 0 auto;align-self:flex-end">Save</button></div>
      <div class="mvp-note"><b>Accept</b> accepts on Amazon AND sends the campaign to your MVP Creator Campaigns inbox with its real ASIN (ready to Generate post). Then <b>Submit accepted</b> finalises the batch on Amazon.</div>
    </div>`
  // Prefer sitting IN the page flow, right above Amazon's toolbar row (where
  // ViralVue et al. inject). Fall back to a floating middle-right panel if we
  // can't find the toolbar (e.g. layout changed).
  const anchor = findToolbarAnchor()
  if (anchor && anchor.parentElement) {
    el.classList.add('mvp-inline')
    anchor.parentElement.insertBefore(el, anchor)
  } else {
    document.body.appendChild(el)
  }

  const q = (s) => el.querySelector(s)
  const res = q('.mvp-res')
  const selected = new Set()
  let rowsByKey = new Map()  // key → full campaign object, for accept/push

  q('.mvp-hd').addEventListener('click', () => {
    el.classList.toggle('mvp-min')
    q('.mvp-tog').textContent = el.classList.contains('mvp-min') ? '+' : '–'
  })

  function render(rows, rawCount) {
    selected.clear()
    rowsByKey = new Map(rows.map(r => [String(r.key), r]))
    if (!rows.length) {
      res.innerHTML = rawCount > 0
        ? `<div class="mvp-note">Scraped <b>${rawCount}</b> campaign${rawCount === 1 ? '' : 's'} from the page, but none passed your filters (commission / date). Clear the filter boxes and Search again to see them all.</div>`
        : '<div class="mvp-note">No campaigns detected on the page. Try a broader keyword, or click Debug to check the grid selectors.</div>'
      return
    }
    res.innerHTML = `<div class="mvp-note" style="margin:0 0 6px">${rows.length}${rawCount > rows.length ? ` of ${rawCount}` : ''} campaign${rows.length === 1 ? '' : 's'}</div>` + rows.map(r => `
      <div class="mvp-card" data-key="${String(r.key || '').replace(/"/g, '&quot;')}">
        <input type="checkbox" class="mvp-sel">
        ${r.image ? `<img src="${r.image}">` : ''}
        <div class="mvp-cardbody">
          <div class="t">${String(r.campaignName || r.brand || 'Campaign').replace(/</g, '&lt;')}</div>
          <div class="m">${fmtMeta(r) || (r.brand || '')}</div>
        </div>
        <button class="mvp-acc">Accept</button>
      </div>`).join('')
    res.querySelectorAll('.mvp-sel').forEach(cb => cb.addEventListener('change', (e) => {
      const key = e.target.closest('.mvp-card').dataset.key
      if (e.target.checked) selected.add(key); else selected.delete(key)
    }))
    res.querySelectorAll('.mvp-acc').forEach(b => b.addEventListener('click', (e) => {
      const key = e.target.closest('.mvp-card').dataset.key
      acceptAndPush(rowsByKey.get(key), e.target)
    }))
  }

  q('.mvp-search').addEventListener('click', async () => {
    const btn = q('.mvp-search'); const prev = btn.textContent; btn.textContent = 'Searching…'; btn.disabled = true
    try {
      const { rows, rawCount } = await scoutRunSearch({
        keyword: q('.mvp-kw').value,
        asin: q('.mvp-asin').value,
        minCommission: parseFloat(q('.mvp-comm').value) || 0,
        endsAfter: q('.mvp-after').value || '',
        endsBefore: q('.mvp-before').value || '',
      })
      render(rows, rawCount)
    } catch (e) { res.innerHTML = `<div class="mvp-note">Search error: ${e?.message || e}</div>` }
    btn.textContent = prev; btn.disabled = false
  })
  q('.mvp-debug').addEventListener('click', () => {
    // Passive card dump only — never navigates the user's tab. (ASIN resolution
    // for the real push happens in a hidden background tab via the worker.)
    const d = dumpCardDebug()
    const first = d.parsed ? String(d.parsed.campaignName || d.parsed.brand || d.parsed.key) : 'none — run a Search or scroll the campaign list into view'
    const dc = d.details ? (d.details.testid || d.details.text || d.details.tag) : 'n/a'
    res.innerHTML = `<div class="mvp-note">Dumped to the console (⌥⌘J). cards=<b>${d.cardCount}</b>, with ASIN in card=<b>${d.cardsWithAsin}</b>.<br>First card: ${String(first).replace(/</g, '&lt;')}.<br>Details link: ${String(dc).replace(/</g, '&lt;')}.</div>`
  })
  q('.mvp-accsel').addEventListener('click', async () => {
    const btn = q('.mvp-accsel'); const keys = [...selected]
    if (!keys.length) { btn.textContent = 'Select some first'; setTimeout(() => { btn.textContent = 'Accept selected' }, 1500); return }
    btn.disabled = true
    let done = 0, pushed = 0
    for (const key of keys) {
      btn.textContent = `Sending ${done + 1}/${keys.length}…`
      const sel = (window.CSS && CSS.escape) ? CSS.escape(key) : key
      const accBtn = res.querySelector(`.mvp-card[data-key="${sel}"] .mvp-acc`)
      const r = await acceptAndPush(rowsByKey.get(key), accBtn)
      done++; if (r && r.pushed) pushed++
    }
    btn.textContent = `Done — ${pushed}/${keys.length} in MVP`
    btn.disabled = false
  })
  q('.mvp-submit').addEventListener('click', () => { q('.mvp-submit').textContent = scoutSubmitAccepted() ? '✓ Submitted' : 'Not found' })
  const tokenSave = q('.mvp-token-save')
  if (tokenSave) tokenSave.addEventListener('click', () => {
    const t = ((q('.mvp-token').value) || '').trim()
    if (t) { try { chrome.storage.local.set({ ccToken: t }) } catch (e) {} q('.mvp-token-row').classList.remove('show'); tokenSave.textContent = '✓ Saved' }
  })
}

// Mount now + keep it in sync with SPA navigation (CC is a React app). Cheap
// poll: mount when on a CC page and missing; remove when we navigate away.
try { mountSearchPanel() } catch (e) {}
setInterval(() => {
  try {
    const onCC = isCCPage()
    const existing = document.getElementById(PANEL_ID)
    if (onCC && !existing) mountSearchPanel()
    else if (!onCC && existing) existing.remove()
  } catch (e) {}
}, 2000)
})()
