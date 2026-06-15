/* SCOUT — MVP Affiliate Creator Connections scout (popup) */

const APP_URL = 'https://www.mvpaffiliate.io'
const $ = (id) => document.getElementById(id)

const BUD_RANK = { high: 3, medium: 2, low: 1 }

let found = []                  // [{ asin, campaignName, brand, epc, epcValue, budget, endsAt, image }]
const deleted = new Set()       // asins the user removed from the list entirely
const unchecked = new Set()     // asins the user deselected (but still shown)

// ── helpers ──────────────────────────────────────────────────────────
function setStatus(msg, kind) {
  const el = $('status')
  el.textContent = msg || ''
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
  const terms = $('keyword').value.toLowerCase().split(/[,\n]/).map(s => s.trim()).filter(Boolean)
  return {
    minEpc: isNaN(minEpc) ? 0 : minEpc,
    budgetHigh: $('budgetHigh').checked,
    keyword: $('keyword').value.trim(),
    terms,
  }
}

// A campaign matches the active filters: keyword (campaign/product/brand) AND
// Budget availability = High (if ticked) AND Estimated EPC ≥ the "Up to $".
// EPC-less campaigns can't be confirmed at/above a floor, so they drop out when
// a minimum is set.
function matches(c, cfg = filterCfg()) {
  if (cfg.terms.length) {
    const hay = `${c.campaignName || ''} ${c.brand || ''}`.toLowerCase()
    if (!cfg.terms.some(t => hay.includes(t))) return false
  }
  if (cfg.budgetHigh && c.budget !== 'high') return false
  if (cfg.minEpc > 0) {
    if (c.epcValue == null || c.epcValue < cfg.minEpc) return false
  }
  return true
}

function visibleRows(cfg = filterCfg()) {
  return found.filter(c => !deleted.has(c.asin) && matches(c, cfg))
}

function sortFound() {
  found.sort((a, b) => {
    const ab = BUD_RANK[a.budget] || 0, bb = BUD_RANK[b.budget] || 0
    if (bb !== ab) return bb - ab
    return (b.epcValue ?? -1) - (a.epcValue ?? -1)
  })
}

function persist() {
  chrome.storage.local.set({
    ccScan: { campaigns: found, deleted: [...deleted], unchecked: [...unchecked], ts: Date.now() },
    ccFilter: filterCfg(),
  })
}

// ── token: connected pill (collapsed) vs editable input ──────────────
async function validateToken(token) {
  if (!token) return { ok: false }
  try {
    const res = await fetch(`${APP_URL}/api/campaigns/ingest`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok && !!data.ok, status: res.status, ...data }
  } catch {
    return { ok: false, error: 'network' }
  }
}

function showConnected(v) {
  $('tokenEdit').style.display = 'none'
  $('tokenConnected').style.display = 'flex'
  const bits = []
  if (typeof v.queued === 'number') bits.push(`${v.queued} in your queue`)
  if (v.pro === false) bits.push('⚠ not on Pro — pushing needs Pro')
  $('connMeta').textContent = bits.length ? `· ${bits.join(' · ')}` : ''
}

function showTokenEdit() {
  $('tokenConnected').style.display = 'none'
  $('tokenEdit').style.display = 'block'
  $('token').focus()
}

// ── boot ─────────────────────────────────────────────────────────────
chrome.storage.local.get(['ccToken', 'ccScan', 'ccFilter'], async ({ ccToken, ccScan, ccFilter }) => {
  if (ccFilter) {
    if (typeof ccFilter.minEpc === 'number' && ccFilter.minEpc > 0) $('minEpc').value = ccFilter.minEpc
    if (typeof ccFilter.budgetHigh === 'boolean') $('budgetHigh').checked = ccFilter.budgetHigh
    if (typeof ccFilter.keyword === 'string') $('keyword').value = ccFilter.keyword
  }

  if (ccToken) {
    $('token').value = ccToken
    const v = await validateToken(ccToken)
    if (v.ok) showConnected(v); else showTokenEdit()
  } else {
    showTokenEdit()
  }

  if (ccScan && Array.isArray(ccScan.campaigns) && ccScan.campaigns.length) {
    found = ccScan.campaigns
    sortFound()
    deleted.clear(); (ccScan.deleted || []).forEach(a => deleted.add(a))
    unchecked.clear(); (ccScan.unchecked || []).forEach(a => unchecked.add(a))
    renderList()
    const shown = visibleRows().length
    setStatus(`${found.length} from last scan (${ago(ccScan.ts)}) · ${shown} match your filters. Scan again to refresh.`, 'ok')
  }
})

$('connect').addEventListener('click', async () => {
  const t = $('token').value.trim()
  if (!t) { setStatus('Paste your MVP ingest token first.', 'err'); return }
  setStatus('Checking token…', 'work')
  const v = await validateToken(t)
  if (!v.ok) {
    setStatus(v.status === 401 ? 'That token isn\'t valid — copy a fresh one from EPC Scout in MVP.' : 'Couldn\'t verify the token (network). Try again.', 'err')
    return
  }
  chrome.storage.local.set({ ccToken: t })
  showConnected(v)
  setStatus('Connected to MVP.', 'ok')
})

$('editToken').addEventListener('click', showTokenEdit)

// Live re-filter as the user types / toggles.
;['minEpc', 'budgetHigh', 'keyword'].forEach(id => {
  $(id).addEventListener('input', () => { if (found.length) { persist(); renderList() } })
})

// ── scan ─────────────────────────────────────────────────────────────
let scanFound = 0
let scanLastChange = 0
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'CC_SCAN_PROGRESS' && typeof msg.found === 'number') {
    if (msg.found !== scanFound) scanLastChange = Date.now()
    scanFound = msg.found
  }
})

async function doScan() {
  $('results').style.display = 'none'
  found = []; deleted.clear(); unchecked.clear()
  scanFound = 0; scanLastChange = Date.now()

  const start = Date.now()
  const timer = setInterval(() => {
    const secs = Math.round((Date.now() - start) / 1000)
    const settling = scanFound > 0 && (Date.now() - scanLastChange) > 1000
    setStatus(scanFound > 0
      ? `Scanning the page… ${secs}s · ${scanFound} found${settling ? ' · finishing up' : ''}`
      : `Scanning the page… ${secs}s`, 'work')
  }, 250)

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) throw new Error('No active tab.')
    if (!/^https:\/\/(affiliate-program|www)\.amazon\.com\//.test(tab.url || '')) {
      throw new Error('Open your Amazon Creator Connections opportunities page in this tab first.')
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    } catch (e) {
      throw new Error(`Couldn't read this page (${e?.message || 'injection blocked'}). Reload the Amazon tab and retry.`)
    }
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'CC_SCAN' }).catch(() => null)
    if (!res || !Array.isArray(res.campaigns)) {
      throw new Error('Scanner did not respond. Reload the Amazon tab and try again.')
    }
    found = res.campaigns
    if (found.length === 0) throw new Error('No campaigns detected on this page.')
    sortFound()
    persist()
    renderList()
  } finally {
    clearInterval(timer)
  }
}

$('scan').addEventListener('click', async () => {
  $('scan').disabled = true
  try {
    await doScan()
    const shown = visibleRows().length
    setStatus(`Found ${found.length} campaign${found.length === 1 ? '' : 's'} · ${shown} match your filters.`, 'ok')
  } catch (e) {
    setStatus(e?.message || 'Scan failed.', 'err')
  } finally {
    $('scan').disabled = false
  }
})

// ── list ─────────────────────────────────────────────────────────────
function makePh() {
  const d = document.createElement('div')
  d.className = 'thumb ph'; d.textContent = 'IMG'
  return d
}

function renderList() {
  const cfg = filterCfg()
  const list = $('list')
  list.innerHTML = ''
  const rows = visibleRows(cfg)

  if (!found.length) { $('results').style.display = 'none'; return }
  $('results').style.display = 'block'

  if (rows.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = cfg.terms.length || cfg.budgetHigh || cfg.minEpc > 0
      ? 'No campaigns match these filters. Loosen the keyword, EPC, or budget filter.'
      : 'Nothing to show.'
    list.appendChild(empty)
  }

  rows.forEach((c) => {
    const div = document.createElement('div')
    div.className = 'item' + (unchecked.has(c.asin) ? ' off' : '')

    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = !unchecked.has(c.asin)
    cb.addEventListener('change', () => {
      if (cb.checked) unchecked.delete(c.asin); else unchecked.add(c.asin)
      persist(); renderList()
    })

    let thumb
    if (c.image) {
      thumb = document.createElement('img')
      thumb.className = 'thumb'; thumb.src = c.image; thumb.referrerPolicy = 'no-referrer'
      thumb.onerror = () => thumb.replaceWith(makePh())
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
      const bd = document.createElement('span'); bd.className = 'bud ' + c.budget; bd.textContent = c.budget + ' budget'
      meta.appendChild(bd)
    }
    body.appendChild(name); body.appendChild(meta)

    const del = document.createElement('button')
    del.className = 'del'; del.type = 'button'; del.textContent = '×'; del.title = 'Remove from list'
    del.addEventListener('click', () => {
      deleted.add(c.asin); unchecked.delete(c.asin)
      persist(); renderList()
    })

    div.appendChild(cb); div.appendChild(thumb); div.appendChild(body); div.appendChild(del)
    list.appendChild(div)
  })

  const selected = rows.filter(c => !unchecked.has(c.asin)).length
  $('resCount').textContent = `${selected} selected · ${rows.length} shown${rows.length !== found.length ? ` (of ${found.length})` : ''}`
  $('push').disabled = selected === 0
  $('push').textContent = selected > 0 ? `Push ${selected} to MVP` : 'Push to MVP'
}

$('selectAll').addEventListener('click', () => {
  visibleRows().forEach(c => unchecked.delete(c.asin))
  persist(); renderList()
})
$('clearSel').addEventListener('click', () => {
  visibleRows().forEach(c => unchecked.add(c.asin))
  persist(); renderList()
})

// ── push ─────────────────────────────────────────────────────────────
$('push').addEventListener('click', async () => {
  const token = $('token').value.trim()
  if (!token) { setStatus('Connect your MVP token first.', 'err'); showTokenEdit(); return }
  const selected = visibleRows().filter(c => !unchecked.has(c.asin))
  if (selected.length === 0) { setStatus('Select at least one campaign.', 'err'); return }

  $('push').disabled = true
  setStatus(`Pushing ${selected.length} to MVP…`, 'work')
  try {
    const res = await fetch(`${APP_URL}/api/campaigns/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ campaigns: selected }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Push failed (${res.status})`)
    chrome.storage.local.set({ ccToken: token })
    // Drop the pushed ones from the list so the view reflects what's left.
    selected.forEach(c => deleted.add(c.asin))
    persist(); renderList()
    setStatus(`Done — ${data.inserted} added, ${data.skipped} already in your queue.`, 'ok')
  } catch (e) {
    setStatus(e?.message || 'Push failed.', 'err')
  } finally {
    $('push').disabled = false
  }
})
