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

const ASIN_RE = /^B0[A-Z0-9]{8}$/
const PRICE_RE = /\$\s?\d[\d.,]*/
const RATING_RE = /^\d(?:\.\d)?\s*(?:out of|★|stars)/i
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/
const DATE_TXT_RE = /\b([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})\b/

const NOISE_RE = /^(recommended|accept|accept all|new|sponsored|estimated epc|budget availability|no end date|add to|save|open product|ask creator|view details|learn more|see details|\$|\d)/i

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const textOf = (n) => (n?.textContent || '').replace(/\s+/g, ' ').trim()

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

  // EPC — "Estimated EPC: Up to $0.38"
  let epc = null
  const epcM = full.match(/Estimated EPC[:\s]*((?:Up to\s*)?\$\s?\d[\d.,]*)/i)
  if (epcM) epc = epcM[1].replace(/\s+/g, ' ').trim()

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

  return { asin, campaignName, brand, epc, endsAt, image }
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
      else if (prev && !prev.image && fresh.image) prev.image = fresh.image
    }
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

// Guard: this file may be (re)injected by the popup on every scan.
// Register the message listener only once per page.
if (!window.__ccScoutListener) {
  window.__ccScoutListener = true
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'CC_SCAN') {
      parseCampaigns()
        .then(campaigns => sendResponse({ campaigns }))
        .catch(e => sendResponse({ error: e?.message || 'parse failed', campaigns: [] }))
      return true // async response
    }
  })
}
