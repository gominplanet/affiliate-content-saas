/* SCOUT — MVP Affiliate popup.
 * SCOUT is INVISIBLE on Amazon: the on-page panel is retired and every
 * scan/verify is driven headlessly from the signed-in MVP app (session bridge).
 * There is no token to paste anymore (the old ingest token + Amazon earnings
 * sync were removed in 2026-08). This popup is just: a status line, a quick
 * "what SCOUT does" recap, and the two OPTIONAL host-permission toggles (Chrome
 * requires those grants to happen from a click inside extension UI). */

const $ = (id) => document.getElementById(id)

// One-time cleanup: drop any ingest token left in local storage by older
// versions. It's no longer used for anything.
try { chrome.storage.local.remove('ccToken') } catch { /* ignore */ }

// ── Optional retail hosts (Walmart, Target, …) ────────────────────────────
// OPTIONAL host permissions so SCOUT's default footprint is Amazon-only and
// Chrome never disables it on update. The grant needs a user gesture, so it
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

// ── Optional international Amazon marketplaces (CA / UK / AU) ─────────────
// Powers the AMZ Product Finder's marketplace picker. Optional for the same
// reason as the retail hosts: keeps the default footprint amazon.com-only.
const INTL_ORIGINS = ['https://*.amazon.ca/*', 'https://*.amazon.co.uk/*', 'https://*.amazon.com.au/*']
function renderIntl(on) {
  $('intl').checked = on
  $('intlSub').textContent = on
    ? 'On — amazon.ca, .co.uk & .com.au.'
    : 'Off — amazon.com only.'
}
async function refreshIntl() {
  try {
    const on = await chrome.permissions.contains({ origins: INTL_ORIGINS })
    renderIntl(!!on)
  } catch { renderIntl(false) }
}

// ── Passport quick-create ─────────────────────────────────────────────────
// Turn the current tab into a Passport Link. Posts the tab URL to the signed-in
// MVP app (host permission for mvpaffiliate.io lets the popup call it with the
// user's session cookie, no CORS). The app resolves an Amazon link to its ASIN
// (geo-routed) or shortens any other link, and returns the mvpl.ink URL.
const APP_ORIGIN = 'https://www.mvpaffiliate.io'

function ppShowError(msg) {
  const el = $('ppErr')
  el.textContent = msg
  el.classList.add('show')
  $('ppRes').classList.remove('show')
}
function ppShowResult(url) {
  $('ppErr').classList.remove('show')
  const a = $('ppUrl')
  a.textContent = url
  a.href = url
  $('ppRes').classList.add('show')
  const copy = $('ppCopy')
  copy.textContent = 'Copy'
  copy.classList.remove('ok')
}

async function ppCreate() {
  const btn = $('ppCreate')
  $('ppErr').classList.remove('show')
  $('ppRes').classList.remove('show')

  let tab
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }) } catch { /* none */ }
  const url = (tab && tab.url) || ''
  if (!/^https?:\/\//i.test(url)) {
    ppShowError('Open a product page (or any web page) first, then try again.')
    return
  }

  btn.disabled = true
  const label = tab.title ? String(tab.title).slice(0, 300) : null
  try {
    const res = await fetch(`${APP_ORIGIN}/api/passport/link`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title: label }),
    })
    let j = {}
    try { j = await res.json() } catch { /* non-JSON */ }
    if (res.status === 401) { ppShowError('Sign in to MVP Affiliate first, then try again.'); return }
    if (res.status === 403) { ppShowError(j.error || 'Passport Links is available on the Studio and Pro plans.'); return }
    if (!res.ok || !j.ok || !j.url) { ppShowError(j.error || 'Could not create the link. Please try again.'); return }

    ppShowResult(j.url)
    // Auto-copy so the link is ready to paste immediately.
    try {
      await navigator.clipboard.writeText(j.url)
      const copy = $('ppCopy'); copy.textContent = 'Copied'; copy.classList.add('ok')
    } catch { /* clipboard blocked — the Copy button still works */ }
  } catch {
    ppShowError('Network error reaching MVP. Check your connection and try again.')
  } finally {
    btn.disabled = false
  }
}

$('ppCreate').addEventListener('click', ppCreate)
$('ppCopy').addEventListener('click', async () => {
  const url = $('ppUrl').textContent || ''
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    const copy = $('ppCopy'); copy.textContent = 'Copied'; copy.classList.add('ok')
    setTimeout(() => { copy.textContent = 'Copy'; copy.classList.remove('ok') }, 1600)
  } catch { /* clipboard blocked */ }
})

// ── boot ────────────────────────────────────────────────────────────────
refreshRetail()
refreshIntl()

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

$('intl').addEventListener('change', async () => {
  // request() and remove() must run in this click's user gesture.
  if ($('intl').checked) {
    let ok = false
    try { ok = await chrome.permissions.request({ origins: INTL_ORIGINS }) } catch { ok = false }
    if (!ok) { renderIntl(false); return }
    renderIntl(true)
  } else {
    try { await chrome.permissions.remove({ origins: INTL_ORIGINS }) } catch { /* ignore */ }
    renderIntl(false)
  }
})
