/* MVP Affiliate — CC Scout content script
 *
 * Runs on Amazon Creator Connections pages. On a CC_SCAN message it
 * walks the campaigns list and returns:
 *   [{ asin, campaignName, epc, endsAt }]
 *
 * ── SELECTOR CALIBRATION ────────────────────────────────────────────
 * Amazon's CC markup is obfuscated and changes. The parser below is a
 * HEURISTIC starting point: it finds ASINs anywhere on the page and
 * walks up to the nearest "row" container to scavenge a campaign name,
 * EPC/boost %, and an end date. Once we have the real CC DOM, replace
 * the marked CALIBRATE blocks with exact selectors for accuracy.
 */

const ASIN_RE = /\b(B0[A-Z0-9]{8})\b/
const ASIN_RE_G = /\b(B0[A-Z0-9]{8})\b/g
const EPC_RE = /(\d{1,2}(?:\.\d+)?)\s*%/
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/
const DATE_TXT_RE = /\b([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})\b/

function asinFromNode(root) {
  // 1. Any /dp/ASIN or /gp/product/ASIN link
  for (const a of root.querySelectorAll('a[href]')) {
    const m = a.getAttribute('href').match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i)
    if (m) return m[1].toUpperCase()
  }
  // 2. data attributes commonly carrying the ASIN
  for (const el of root.querySelectorAll('[data-asin],[data-csa-c-item-id]')) {
    const v = (el.getAttribute('data-asin') || el.getAttribute('data-csa-c-item-id') || '')
    const m = v.match(/(B0[A-Z0-9]{8})/i)
    if (m) return m[1].toUpperCase()
  }
  // 3. Fallback: bare ASIN token in text
  const m = (root.textContent || '').match(ASIN_RE)
  return m ? m[1].toUpperCase() : null
}

function rowContainer(el) {
  // Climb to the nearest plausible "card / table row" ancestor.
  let n = el
  for (let i = 0; i < 8 && n && n.parentElement; i++) {
    n = n.parentElement
    const role = (n.getAttribute && n.getAttribute('role')) || ''
    if (n.tagName === 'TR' || role === 'row' || role === 'listitem' || n.tagName === 'LI') return n
    if (n.className && /(card|row|campaign|tile|item)/i.test(n.className)) return n
  }
  return el.closest('tr, li, [role="row"], [role="listitem"]') || el.parentElement || el
}

function textOf(node) {
  return (node?.textContent || '').replace(/\s+/g, ' ').trim()
}

function parseCampaigns() {
  const out = []
  const seen = new Set()

  // Anchor on ASIN-bearing links/elements, then scavenge each row.
  const anchors = new Set()
  document.querySelectorAll('a[href*="/dp/"],a[href*="/product/"],[data-asin]').forEach(e => anchors.add(e))
  // Also catch ASINs that only appear as text.
  if (anchors.size === 0) {
    document.querySelectorAll('*').forEach(e => {
      if (e.children.length === 0 && ASIN_RE.test(e.textContent || '')) anchors.add(e)
    })
  }

  for (const a of anchors) {
    const asin = asinFromNode(a.closest('a') ? a : a)
      || (a.getAttribute && (a.getAttribute('href') || '').match(/([A-Z0-9]{10})/)?.[1])
    if (!asin || !/^B0[A-Z0-9]{8}$/.test(asin) || seen.has(asin)) continue

    const row = rowContainer(a)
    const rowText = textOf(row)

    // CALIBRATE: campaign name. Heuristic = the longest non-ASIN,
    // non-numeric text line in the row (usually the product/campaign).
    let campaignName = null
    const candidates = [...row.querySelectorAll('h1,h2,h3,h4,strong,b,[class*="title"],[class*="name"],td,span,div')]
      .map(textOf)
      .filter(t => t && t.length >= 6 && t.length <= 140 && !ASIN_RE.test(t) && !/^\d/.test(t))
    if (candidates.length) campaignName = candidates.sort((x, y) => y.length - x.length)[0]

    // CALIBRATE: EPC / commission boost percentage.
    const epcM = rowText.match(EPC_RE)
    const epc = epcM ? `${epcM[1]}%` : null

    // CALIBRATE: campaign end date.
    const dM = rowText.match(DATE_RE)
    let endsAt = dM ? dM[1] : null
    if (!endsAt) {
      const dt = rowText.match(DATE_TXT_RE)
      if (dt) {
        const parsed = new Date(dt[1])
        if (!isNaN(parsed)) endsAt = parsed.toISOString().slice(0, 10)
      }
    }

    seen.add(asin)
    out.push({ asin, campaignName, epc, endsAt })
  }

  return out
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'CC_SCAN') {
    try {
      sendResponse({ campaigns: parseCampaigns() })
    } catch (e) {
      sendResponse({ error: e?.message || 'parse failed', campaigns: [] })
    }
  }
  return true
})
