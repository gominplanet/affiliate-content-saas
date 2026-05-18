/* MVP Affiliate — CC Scout popup */

const APP_URL = 'https://www.mvpaffiliate.io'
const $ = (id) => document.getElementById(id)
let found = [] // [{ asin, campaignName, epc, endsAt }]

function setStatus(msg, kind) {
  const el = $('status')
  el.textContent = msg
  el.className = kind || ''
}

// ── Token persistence ───────────────────────────────────────────────
chrome.storage.local.get('ccToken', ({ ccToken }) => {
  if (ccToken) $('token').value = ccToken
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
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'CC_SCAN' }).catch(() => null)
    if (!res || !Array.isArray(res.campaigns)) {
      return setStatus('Could not read this page. Open your Amazon Creator Connections campaigns list and try again.', 'err')
    }
    found = res.campaigns
    if (found.length === 0) return setStatus('No campaigns detected on this page.', 'err')
    renderList()
    setStatus(`Found ${found.length} campaign${found.length === 1 ? '' : 's'}.`, 'ok')
  } catch (e) {
    setStatus(e?.message || 'Scan failed.', 'err')
  }
})

function renderList() {
  const list = $('list')
  list.innerHTML = ''
  found.forEach((c, i) => {
    const div = document.createElement('div')
    div.className = 'item'
    const cb = document.createElement('input')
    cb.type = 'checkbox'; cb.checked = true; cb.dataset.i = String(i)
    const body = document.createElement('div')
    body.className = 'grow'
    const title = document.createElement('div')
    title.textContent = c.campaignName || c.asin
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = [c.asin, c.epc, c.endsAt].filter(Boolean).join('  ·  ')
    body.appendChild(title); body.appendChild(meta)
    div.appendChild(cb); div.appendChild(body)
    list.appendChild(div)
  })
  $('pushRow').style.display = 'flex'
}

$('selectAll').addEventListener('click', () => {
  const boxes = $('list').querySelectorAll('input[type=checkbox]')
  const allOn = [...boxes].every(b => b.checked)
  boxes.forEach(b => { b.checked = !allOn })
})

// ── Push selected to MVP Affiliate ──────────────────────────────────
$('push').addEventListener('click', async () => {
  const token = $('token').value.trim()
  if (!token) return setStatus('Paste your ingest token first.', 'err')
  const selected = [...$('list').querySelectorAll('input[type=checkbox]')]
    .filter(b => b.checked)
    .map(b => found[Number(b.dataset.i)])
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
