/* MVP Affiliate — CC Scout popup */

const APP_URL = 'https://www.mvpaffiliate.io'
const $ = (id) => document.getElementById(id)
let found = []                 // [{ asin, campaignName, epc, epcValue, budget, ... }]
const unchecked = new Set()    // asins the user has deselected

const BUD_RANK = { high: 3, medium: 2, low: 1 }

function setStatus(msg, kind) {
  const el = $('status')
  el.textContent = msg
  el.className = kind || ''
}

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function filterCfg() {
  const minEpc = parseFloat($('minEpc').value)
  // Comma/space separated → OR match (any term present qualifies).
  const terms = $('keyword').value.toLowerCase().split(/[,\n]/)
    .map(s => s.trim()).filter(Boolean)
  return {
    minEpc: isNaN(minEpc) ? 0 : minEpc,
    reqBudget: $('reqBudget').checked,
    keyword: $('keyword').value.trim(),
    terms,
  }
}

// "Smart" rule: budget medium/high (if required) AND EPC at/above the
// minimum. Campaigns missing an EPC value can't be confirmed as "higher
// EPC", so they don't qualify when a minimum is set.
function qualifies(c, cfg = filterCfg()) {
  if (cfg.reqBudget && (BUD_RANK[c.budget] || 0) < 2) return false
  if (cfg.minEpc > 0) {
    if (c.epcValue == null) return false
    if (c.epcValue < cfg.minEpc) return false
  }
  if (cfg.terms && cfg.terms.length) {
    const hay = `${c.campaignName || ''} ${c.brand || ''} ${c.asin || ''}`.toLowerCase()
    if (!cfg.terms.some(t => hay.includes(t))) return false
  }
  return true
}

function persist() {
  const cfg = filterCfg()
  chrome.storage.local.set({
    ccScan: { campaigns: found, unchecked: [...unchecked], ts: Date.now() },
    ccFilter: cfg,
  })
}

function sortFound() {
  found.sort((a, b) => {
    const ab = BUD_RANK[a.budget] || 0, bb = BUD_RANK[b.budget] || 0
    if (bb !== ab) return bb - ab
    return (b.epcValue ?? -1) - (a.epcValue ?? -1)
  })
}

// Default-select only qualifying campaigns (everything else unchecked).
function applySmartSelection() {
  const cfg = filterCfg()
  unchecked.clear()
  for (const c of found) if (!qualifies(c, cfg)) unchecked.add(c.asin)
}

// ── Token + last-scan + filter restore ──────────────────────────────
chrome.storage.local.get(['ccToken', 'ccScan', 'ccFilter'], ({ ccToken, ccScan, ccFilter }) => {
  if (ccToken) $('token').value = ccToken
  if (ccFilter) {
    if (typeof ccFilter.minEpc === 'number') $('minEpc').value = ccFilter.minEpc
    if (typeof ccFilter.reqBudget === 'boolean') $('reqBudget').checked = ccFilter.reqBudget
    if (typeof ccFilter.keyword === 'string') $('keyword').value = ccFilter.keyword
  }
  if (ccScan && Array.isArray(ccScan.campaigns) && ccScan.campaigns.length) {
    found = ccScan.campaigns
    sortFound()
    unchecked.clear()
    ;(ccScan.unchecked || []).forEach(a => unchecked.add(a))
    renderList()
    setStatus(`Showing ${found.length} from last scan (${ago(ccScan.ts)}). Scan again to refresh.`, 'ok')
  }
})

$('saveToken').addEventListener('click', () => {
  const t = $('token').value.trim()
  chrome.storage.local.set({ ccToken: t }, () => setStatus('Token saved.', 'ok'))
})

// Re-derive the default selection whenever the filter changes.
;['minEpc', 'reqBudget', 'keyword'].forEach(id => {
  $(id).addEventListener('input', () => {
    if (found.length) { applySmartSelection(); persist(); renderList() }
  })
})

// ── Scan ────────────────────────────────────────────────────────────
async function doScan() {
  setStatus('Scanning…')
  $('list').innerHTML = ''
  $('pushRow').style.display = 'none'
  found = []
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab.')
  if (!/^https:\/\/(affiliate-program|www)\.amazon\.com\//.test(tab.url || '')) {
    throw new Error('Open your Amazon Creator Connections page in this tab first.')
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
  } catch (e) {
    throw new Error(`Could not access this page (${e?.message || 'injection blocked'}). Reload the Amazon tab and retry.`)
  }
  const res = await chrome.tabs.sendMessage(tab.id, { type: 'CC_SCAN' }).catch(() => null)
  if (!res || !Array.isArray(res.campaigns)) {
    throw new Error('Scanner did not respond. Reload the Amazon tab and try again.')
  }
  found = res.campaigns
  if (found.length === 0) throw new Error('No campaigns detected on this page.')
  sortFound()
  applySmartSelection()
  persist()
  renderList()
}

$('scan').addEventListener('click', async () => {
  try {
    await doScan()
    const q = found.filter(c => qualifies(c)).length
    setStatus(`Found ${found.length} — ${q} qualify (auto-selected). Adjust filters or pick manually.`, 'ok')
  } catch (e) {
    setStatus(e?.message || 'Scan failed.', 'err')
  }
})

function makePh() {
  const d = document.createElement('div')
  d.className = 'thumb ph'; d.textContent = 'IMG'
  return d
}

function renderList() {
  const cfg = filterCfg()
  const list = $('list')
  list.innerHTML = ''
  let q = 0
  found.forEach((c) => {
    const ok = qualifies(c, cfg)
    if (ok) q++
    const div = document.createElement('div')
    div.className = 'item' + (unchecked.has(c.asin) ? ' dim' : '')

    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = !unchecked.has(c.asin)
    cb.dataset.asin = c.asin
    cb.addEventListener('change', () => {
      if (cb.checked) unchecked.delete(c.asin)
      else unchecked.add(c.asin)
      persist(); renderList()
    })

    let thumb
    if (c.image) {
      thumb = document.createElement('img')
      thumb.className = 'thumb'; thumb.src = c.image; thumb.referrerPolicy = 'no-referrer'
      thumb.onerror = () => { thumb.replaceWith(makePh()) }
    } else {
      thumb = makePh()
    }

    const body = document.createElement('div')
    body.className = 'body'

    const name = document.createElement('div')
    name.className = 'name'
    if (c.brand && c.campaignName && !c.campaignName.toLowerCase().startsWith(c.brand.toLowerCase())) {
      const b = document.createElement('span'); b.className = 'brand'; b.textContent = c.brand + ' · '
      name.appendChild(b)
    }
    name.appendChild(document.createTextNode(c.campaignName || '(name not detected)'))

    const meta = document.createElement('div')
    meta.className = 'meta'
    const asin = document.createElement('span'); asin.className = 'asin'; asin.textContent = c.asin
    meta.appendChild(asin)
    if (c.epc) {
      meta.appendChild(document.createTextNode('  ·  '))
      const e = document.createElement('span'); e.className = 'epc'; e.textContent = c.epc; meta.appendChild(e)
    }
    if (c.budget) {
      meta.appendChild(document.createTextNode('  ·  '))
      const bd = document.createElement('span'); bd.className = 'bud ' + c.budget
      bd.textContent = c.budget + ' budget'; meta.appendChild(bd)
    }
    meta.appendChild(document.createTextNode('  ·  '))
    const end = document.createElement('span'); end.className = 'ends'; end.textContent = c.endsAt || 'no end date'
    meta.appendChild(end)

    body.appendChild(name); body.appendChild(meta)
    div.appendChild(cb); div.appendChild(thumb); div.appendChild(body)
    list.appendChild(div)
  })
  $('qualCount').textContent = found.length ? `${q} of ${found.length} qualify` : ''
  $('pushRow').style.display = found.length ? 'flex' : 'none'
}

$('selectAll').addEventListener('click', () => {
  const allOn = found.every(c => !unchecked.has(c.asin))
  if (allOn) found.forEach(c => unchecked.add(c.asin))
  else unchecked.clear()
  persist()
  renderList()
})

// ── Push ────────────────────────────────────────────────────────────
async function doPush(list) {
  const token = $('token').value.trim()
  if (!token) throw new Error('Paste your ingest token first.')
  if (list.length === 0) throw new Error('Nothing to push — no campaigns selected/qualifying.')
  const res = await fetch(`${APP_URL}/api/campaigns/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ campaigns: list }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Push failed (${res.status})`)
  chrome.storage.local.set({ ccToken: token })
  return data
}

$('push').addEventListener('click', async () => {
  const selected = found.filter(c => !unchecked.has(c.asin))
  $('push').disabled = true
  setStatus(`Pushing ${selected.length}…`)
  try {
    const data = await doPush(selected)
    setStatus(`Done — ${data.inserted} added, ${data.skipped} already in your queue.`, 'ok')
  } catch (e) {
    setStatus(e?.message || 'Push failed.', 'err')
  } finally {
    $('push').disabled = false
  }
})

// ── One-click: scan → auto-select qualifying → push ─────────────────
$('oneClick').addEventListener('click', async () => {
  $('oneClick').disabled = true
  try {
    await doScan()
    const qualifying = found.filter(c => qualifies(c))
    setStatus(`Found ${found.length}, pushing ${qualifying.length} qualifying…`)
    const data = await doPush(qualifying)
    setStatus(`Done — ${data.inserted} added, ${data.skipped} already queued (${found.length - qualifying.length} skipped by filter).`, 'ok')
  } catch (e) {
    setStatus(e?.message || 'Scan & push failed.', 'err')
  } finally {
    $('oneClick').disabled = false
  }
})
