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
