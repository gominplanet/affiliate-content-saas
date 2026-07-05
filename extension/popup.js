/* SCOUT — MVP Affiliate popup: on/off toggle + MVP connection status.
 * The campaign search + import all lives in the inline panel on the Amazon
 * Creator Connections page now, so this popup is just the control switch. */

const APP_URL = 'https://www.mvpaffiliate.io'
const $ = (id) => document.getElementById(id)

function setStatus(msg, kind) {
  const el = $('status')
  el.textContent = msg || ''
  el.className = kind || ''
}

// ── MVP token: green "connected" pill vs editable input ─────────────────
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

// ── On / off ────────────────────────────────────────────────────────────
function renderToggle(on) {
  $('enabled').checked = on
  $('toggleSub').textContent = on
    ? 'On — panel shows on Creator Connections.'
    : 'Off — the panel won’t appear on Amazon.'
}

// ── Optional retail hosts (Walmart, Target, …) ────────────────────────────
// These are OPTIONAL host permissions so SCOUT's default footprint is Amazon-only
// and Chrome never disables it on update. The grant needs a user gesture, so it
// happens right here in the popup (the background can't prompt).
const RETAIL_ORIGINS = [
  'https://*.walmart.com/*', 'https://*.target.com/*', 'https://*.bestbuy.com/*',
  'https://*.homedepot.com/*', 'https://*.lowes.com/*', 'https://*.wayfair.com/*',
  'https://*.etsy.com/*', 'https://*.ebay.com/*', 'https://*.chewy.com/*',
  'https://*.costco.com/*', 'https://*.macys.com/*', 'https://*.kohls.com/*',
  'https://*.newegg.com/*', 'https://*.ulta.com/*', 'https://*.sephora.com/*',
  'https://*.nike.com/*',
]
function renderRetail(on) {
  $('retail').checked = on
  $('retailSub').textContent = on
    ? 'On — Walmart, Target & other stores.'
    : 'Off — Amazon only.'
}
async function refreshRetail() {
  try {
    const on = await chrome.permissions.contains({ origins: RETAIL_ORIGINS })
    renderRetail(!!on)
  } catch { renderRetail(false) }
}

// ── boot ────────────────────────────────────────────────────────────────
chrome.storage.local.get(['ccToken', 'scoutEnabled'], async ({ ccToken, scoutEnabled }) => {
  renderToggle(scoutEnabled !== false) // default ON
  refreshRetail()
  if (ccToken) {
    $('token').value = ccToken
    const v = await validateToken(ccToken)
    if (v.ok) showConnected(v); else showTokenEdit()
  } else {
    showTokenEdit()
  }
})

$('enabled').addEventListener('change', () => {
  const on = $('enabled').checked
  chrome.storage.local.set({ scoutEnabled: on })
  renderToggle(on)
  // content.js reacts to the storage change (shows/hides the panel live).
})

$('retail').addEventListener('change', async () => {
  // request() and remove() must run in this click's user gesture.
  if ($('retail').checked) {
    let ok = false
    try { ok = await chrome.permissions.request({ origins: RETAIL_ORIGINS }) } catch { ok = false }
    if (!ok) { renderRetail(false); return }
    renderRetail(true)
  } else {
    try { await chrome.permissions.remove({ origins: RETAIL_ORIGINS }) } catch { /* ignore */ }
    renderRetail(false)
  }
})

$('connect').addEventListener('click', async () => {
  const t = $('token').value.trim()
  if (!t) { setStatus('Paste your MVP ingest token first.', 'err'); return }
  setStatus('Checking token…', 'work')
  const v = await validateToken(t)
  if (!v.ok) {
    setStatus(v.status === 401
      ? 'That token isn’t valid — copy a fresh one from AMZ+ & EPC in MVP.'
      : 'Couldn’t verify the token (network). Try again.', 'err')
    return
  }
  chrome.storage.local.set({ ccToken: t })
  showConnected(v)
  setStatus('Connected to MVP.', 'ok')
})

$('editToken').addEventListener('click', showTokenEdit)
