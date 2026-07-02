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
  if (r.commissionPct != null) bits.push(r.commissionPct + '% comm')
  if (r.epc) bits.push('EPC ' + r.epc)
  if (r.endsAt) bits.push('ends ' + r.endsAt)
  else if (r.daysRemaining != null) bits.push(r.daysRemaining + 'd left')
  if (r.budget) bits.push('budget ' + r.budget)
  return bits.join(' · ')
}

function cardForAsin(asin) {
  const cell = [...document.querySelectorAll('[aria-label]')]
    .find(e => (e.getAttribute('aria-label') || '').trim().toUpperCase() === asin)
  if (!cell) return null
  return cell.closest('[class*="card" i], [class*="Cell" i], [class*="tile" i]') || cell
}

// Click a campaign's Track/accept control. Best-guess — a Track checkbox first
// (matches the visible "Track" boxes), else an Accept/Track button.
function scoutAccept(asin) {
  const card = cardForAsin(asin)
  if (!card) return { ok: false, reason: 'card-not-found' }
  const cb = card.querySelector('input[type="checkbox"]')
  if (cb) { if (!cb.checked) cb.click(); return { ok: true, tracked: true } }
  const btn = [...card.querySelectorAll('button,a,[role="button"]')].find(b => /^\s*(accept|track)\b/i.test(textOf(b)))
  if (btn) { btn.click(); return { ok: true, clicked: textOf(btn).slice(0, 40) } }
  return { ok: false, reason: 'no-accept-control' }
}

// Click Amazon's own "Submit accepted campaigns" button to finalise the batch.
function scoutSubmitAccepted() {
  const btn = [...document.querySelectorAll('button,a,[role="button"]')].find(b => /submit accepted campaigns/i.test(textOf(b)))
  if (btn) { btn.click(); return true }
  return false
}

// Dump the live DOM of a campaign card + the accept/filter controls so we can
// finalise the best-guess selectors above.
function dumpCardDebug() {
  const cell = [...document.querySelectorAll('[aria-label]')].find(e => ASIN_RE.test((e.getAttribute('aria-label') || '').trim().toUpperCase()))
  const card = cell ? (cell.closest('[class*="card" i], [class*="Cell" i], [class*="tile" i]') || cell) : null
  const submit = [...document.querySelectorAll('button,a')].find(b => /submit accepted/i.test(textOf(b)))
  const filters = [...document.querySelectorAll('button,a')].find(b => /^\s*filters\s*$/i.test(textOf(b)))
  console.log('%c[MVP SCOUT] === CARD outerHTML ===', 'color:#7C3AED;font-weight:bold')
  console.log(card?.outerHTML?.slice(0, 6000) || '(no card found)')
  console.log('%c[MVP SCOUT] card text:', 'color:#7C3AED', card ? textOf(card) : null)
  console.log('%c[MVP SCOUT] submit-accepted btn:', 'color:#7C3AED', submit?.outerHTML?.slice(0, 400) || '(none)')
  console.log('%c[MVP SCOUT] filters btn:', 'color:#7C3AED', filters?.outerHTML?.slice(0, 400) || '(none)')
  return { cardFound: !!card, submitFound: !!submit, filtersFound: !!filters }
}

async function scoutRunSearch(f) {
  const q = (f.asin || f.keyword || '').trim()
  if (q) { try { await applyAmazonSearch(q) } catch (e) {} }
  let rows = await parseCampaigns()
  if (f.asin) rows = rows.filter(r => r.asin === f.asin.trim().toUpperCase())
  if (f.minCommission) rows = rows.filter(r => r.commissionPct != null && r.commissionPct >= f.minCommission)
  if (f.minEpc) rows = rows.filter(r => r.epcValue != null && r.epcValue >= f.minEpc)
  if (f.endsAfter) rows = rows.filter(r => r.endsAt && r.endsAt >= f.endsAfter)
  if (f.endsBefore) rows = rows.filter(r => r.endsAt && r.endsAt <= f.endsBefore)
  return rows
}

function mountSearchPanel() {
  if (!/creatorconnections/i.test(location.href)) return
  if (document.getElementById(PANEL_ID) || !document.body) return

  const style = document.createElement('style')
  style.textContent = `
    #${PANEL_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:360px;max-width:92vw;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 40px -8px rgba(0,0,0,.28);overflow:hidden}
    #${PANEL_ID} *{box-sizing:border-box}
    #${PANEL_ID} .mvp-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;background:linear-gradient(135deg,#7C3AED,#9D6BFF);color:#fff;cursor:pointer}
    #${PANEL_ID} .mvp-hd b{font-size:13px;font-weight:700}
    #${PANEL_ID} .mvp-body{padding:12px;max-height:70vh;overflow:auto}
    #${PANEL_ID} .mvp-row{display:flex;gap:8px;margin-bottom:8px}
    #${PANEL_ID} .mvp-row>div{flex:1;min-width:0}
    #${PANEL_ID} input{width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:8px;font-size:12px}
    #${PANEL_ID} label{display:block;font-size:10px;font-weight:600;color:#6b7280;margin:0 0 3px 2px;text-transform:uppercase;letter-spacing:.04em}
    #${PANEL_ID} .mvp-btn{padding:8px 10px;border:0;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:#fff;background:#7C3AED}
    #${PANEL_ID} .mvp-btn.sec{background:#fff;color:#7C3AED;border:1px solid #d6c6fb}
    #${PANEL_ID} .mvp-btn.dbg{background:#f3f4f6;color:#374151;border:1px solid #e5e7eb}
    #${PANEL_ID} .mvp-res{margin-top:10px;border-top:1px solid #eee;padding-top:8px}
    #${PANEL_ID} .mvp-card{display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid #eee;border-radius:10px;margin-bottom:6px}
    #${PANEL_ID} .mvp-card img{width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0;background:#f3f4f6}
    #${PANEL_ID} .mvp-card .t{font-size:12px;font-weight:600;color:#111;line-height:1.25}
    #${PANEL_ID} .mvp-card .m{font-size:11px;color:#6b7280;margin-top:2px}
    #${PANEL_ID} .mvp-acc{font-size:11px;font-weight:700;color:#7C3AED;background:none;border:1px solid #d6c6fb;border-radius:6px;padding:3px 7px;cursor:pointer;flex-shrink:0}
    #${PANEL_ID} .mvp-note{font-size:11px;color:#6b7280;margin-top:6px;line-height:1.4}
    #${PANEL_ID}.mvp-min .mvp-body{display:none}
  `
  document.head.appendChild(style)

  const el = document.createElement('div')
  el.id = PANEL_ID
  el.innerHTML = `
    <div class="mvp-hd"><b>🔍 MVP SCOUT — Campaign Search</b><span class="mvp-tog">–</span></div>
    <div class="mvp-body">
      <div class="mvp-row"><div><label>Keyword or brand</label><input class="mvp-kw" placeholder="e.g. knee brace"></div></div>
      <div class="mvp-row"><div><label>ASIN</label><input class="mvp-asin" placeholder="B0XXXXXXXX"></div><div><label>Min commission %</label><input class="mvp-comm" type="number" min="0" max="100" placeholder="20"></div></div>
      <div class="mvp-row"><div><label>Min EPC $</label><input class="mvp-epc" type="number" min="0" step="0.01" placeholder="0.30"></div><div><label>Ends after</label><input class="mvp-after" type="date"></div><div><label>Ends before</label><input class="mvp-before" type="date"></div></div>
      <div class="mvp-row"><button class="mvp-btn mvp-search" style="flex:2">Search</button><button class="mvp-btn dbg mvp-debug" style="flex:1">Debug</button></div>
      <div class="mvp-res"></div>
      <div class="mvp-row" style="margin-top:8px"><button class="mvp-btn sec mvp-accsel" style="flex:1">Accept selected</button><button class="mvp-btn sec mvp-submit" style="flex:1">Submit accepted</button></div>
      <div class="mvp-note">Commission % + Accept are being calibrated. On a campaign page, click <b>Debug</b> and share the console (⌥⌘J) output so I can finalise the selectors.</div>
    </div>`
  document.body.appendChild(el)

  const q = (s) => el.querySelector(s)
  const res = q('.mvp-res')
  const selected = new Set()

  q('.mvp-hd').addEventListener('click', () => {
    el.classList.toggle('mvp-min')
    q('.mvp-tog').textContent = el.classList.contains('mvp-min') ? '+' : '–'
  })

  function render(rows) {
    selected.clear()
    if (!rows.length) { res.innerHTML = '<div class="mvp-note">No campaigns matched. Try a broader keyword, or Debug to check the selectors.</div>'; return }
    res.innerHTML = `<div class="mvp-note" style="margin:0 0 6px">${rows.length} campaign${rows.length === 1 ? '' : 's'}</div>` + rows.map(r => `
      <div class="mvp-card" data-asin="${r.asin}">
        <input type="checkbox" class="mvp-sel" style="flex:0 0 auto;margin-top:2px">
        ${r.image ? `<img src="${r.image}">` : ''}
        <div style="flex:1;min-width:0">
          <div class="t">${(r.campaignName || r.brand || r.asin).replace(/</g, '&lt;')}</div>
          <div class="m">${fmtMeta(r) || r.asin}</div>
        </div>
        <button class="mvp-acc">Accept</button>
      </div>`).join('')
    res.querySelectorAll('.mvp-sel').forEach(cb => cb.addEventListener('change', (e) => {
      const asin = e.target.closest('.mvp-card').dataset.asin
      if (e.target.checked) selected.add(asin); else selected.delete(asin)
    }))
    res.querySelectorAll('.mvp-acc').forEach(b => b.addEventListener('click', (e) => {
      const asin = e.target.closest('.mvp-card').dataset.asin
      const r = scoutAccept(asin)
      e.target.textContent = r.ok ? '✓ Tracked' : 'Retry'
      e.target.style.color = r.ok ? '#059669' : '#dc2626'
      if (!r.ok) console.warn('[MVP SCOUT] accept failed', asin, r)
    }))
  }

  q('.mvp-search').addEventListener('click', async () => {
    const btn = q('.mvp-search'); const prev = btn.textContent; btn.textContent = 'Searching…'; btn.disabled = true
    try {
      render(await scoutRunSearch({
        keyword: q('.mvp-kw').value,
        asin: q('.mvp-asin').value,
        minCommission: parseFloat(q('.mvp-comm').value) || 0,
        minEpc: parseFloat(q('.mvp-epc').value) || 0,
        endsAfter: q('.mvp-after').value || '',
        endsBefore: q('.mvp-before').value || '',
      }))
    } catch (e) { res.innerHTML = `<div class="mvp-note">Search error: ${e?.message || e}</div>` }
    btn.textContent = prev; btn.disabled = false
  })
  q('.mvp-debug').addEventListener('click', () => {
    const d = dumpCardDebug()
    res.innerHTML = `<div class="mvp-note">Dumped to the console (⌥⌘J). cardFound=${d.cardFound}, submitFound=${d.submitFound}, filtersFound=${d.filtersFound}. Paste it to me and I'll finalise commission % + Accept.</div>`
  })
  q('.mvp-accsel').addEventListener('click', () => { let ok = 0; selected.forEach(a => { if (scoutAccept(a).ok) ok++ }); q('.mvp-accsel').textContent = `Accepted ${ok}/${selected.size}` })
  q('.mvp-submit').addEventListener('click', () => { q('.mvp-submit').textContent = scoutSubmitAccepted() ? '✓ Submitted' : 'Not found' })
}

// Mount now + keep it in sync with SPA navigation (CC is a React app). Cheap
// poll: mount when on a CC page and missing; remove when we navigate away.
try { mountSearchPanel() } catch (e) {}
setInterval(() => {
  try {
    const onCC = /creatorconnections/i.test(location.href)
    const existing = document.getElementById(PANEL_ID)
    if (onCC && !existing) mountSearchPanel()
    else if (!onCC && existing) existing.remove()
  } catch (e) {}
}, 2000)
})()
