/* MVP Affiliate — CC Scout popup */

const APP_URL = 'https://www.mvpaffiliate.io'
const $ = (id) => document.getElementById(id)
let found = []                 // [{ asin, campaignName, epc, endsAt, ... }]
const unchecked = new Set()    // asins the user has deselected

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

// Persist the scan + selection so it survives the popup closing
// (Chrome destroys the popup whenever it loses focus).
function persist() {
  chrome.storage.local.set({
    ccScan: { campaigns: found, unchecked: [...unchecked], ts: Date.now() },
  })
}

// ── Token + last-scan restore ───────────────────────────────────────
chrome.storage.local.get(['ccToken', 'ccScan'], ({ ccToken, ccScan }) => {
  if (ccToken) $('token').value = ccToken
  if (ccScan && Array.isArray(ccScan.campaigns) && ccScan.campaigns.length) {
    found = ccScan.campaigns
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

// ── Scan the active CC tab via the content script ───────────────────
$('scan').addEventListener('click', async () => {
  setStatus('Scanning…')
  $('list').innerHTML = ''
  $('pushRow').style.display = 'none'
  found = []
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return setStatus('No active tab.', 'err')
    if (!/^https:\/\/(affiliate-program|www)\.amazon\.com\//.test(tab.url || '')) {
      return setStatus('Open your Amazon Creator Connections page in this tab first.', 'err')
    }
    // Inject the scanner on demand so it works even if the tab was open
    // before the extension was loaded/updated.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    } catch (e) {
      return setStatus(`Could not access this page (${e?.message || 'injection blocked'}). Reload the Amazon tab and retry.`, 'err')
    }
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'CC_SCAN' }).catch(() => null)
    if (!res || !Array.isArray(res.campaigns)) {
      return setStatus('Scanner did not respond. Reload the Amazon tab and try again.', 'err')
    }
    found = res.campaigns
    if (found.length === 0) return setStatus('No campaigns detected on this page.', 'err')
    unchecked.clear()
    persist()
    renderList()
    setStatus(`Found ${found.length} campaign${found.length === 1 ? '' : 's'}.`, 'ok')
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
  const list = $('list')
  list.innerHTML = ''
  found.forEach((c) => {
    const div = document.createElement('div')
    div.className = 'item'

    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = !unchecked.has(c.asin)
    cb.dataset.asin = c.asin
    cb.addEventListener('change', () => {
      if (cb.checked) unchecked.delete(c.asin)
      else unchecked.add(c.asin)
      persist()
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
    if (c.epc) { meta.appendChild(document.createTextNode('  ·  ')); const e = document.createElement('span'); e.className = 'epc'; e.textContent = c.epc; meta.appendChild(e) }
    meta.appendChild(document.createTextNode('  ·  '))
    const end = document.createElement('span'); end.className = 'ends'; end.textContent = c.endsAt || 'no end date'
    meta.appendChild(end)

    body.appendChild(name); body.appendChild(meta)
    div.appendChild(cb); div.appendChild(thumb); div.appendChild(body)
    list.appendChild(div)
  })
  $('pushRow').style.display = found.length ? 'flex' : 'none'
}

$('selectAll').addEventListener('click', () => {
  const allOn = found.every(c => !unchecked.has(c.asin))
  if (allOn) found.forEach(c => unchecked.add(c.asin))
  else unchecked.clear()
  persist()
  renderList()
})

// ── Push selected to MVP Affiliate ──────────────────────────────────
$('push').addEventListener('click', async () => {
  const token = $('token').value.trim()
  if (!token) return setStatus('Paste your ingest token first.', 'err')
  const selected = found.filter(c => !unchecked.has(c.asin))
  if (selected.length === 0) return setStatus('Select at least one campaign.', 'err')

  $('push').disabled = true
  setStatus(`Pushing ${selected.length}…`)
  try {
    const res = await fetch(`${APP_URL}/api/campaigns/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ campaigns: selected }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Push failed (${res.status})`)
    chrome.storage.local.set({ ccToken: token })
    setStatus(`Done — ${data.inserted} added, ${data.skipped} already in your queue.`, 'ok')
  } catch (e) {
    setStatus(e?.message || 'Push failed.', 'err')
  } finally {
    $('push').disabled = false
  }
})
