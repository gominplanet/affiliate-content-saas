/**
 * SCOUT — first-run page (opened once by background.js on install).
 *
 * Chrome does NOT let an extension grant itself optional host permissions: the
 * grant needs a real user gesture and Chrome's own confirm dialog. So the next
 * best thing to "already on" is ONE click that asks for both groups at once,
 * right after install, instead of the creator discovering two toggles buried in
 * the popup later. Everything here is idempotent — a group that's already
 * granted just renders as on.
 */
'use strict'

const RETAIL_ORIGINS = [
  'https://*.walmart.com/*', 'https://*.target.com/*', 'https://*.bestbuy.com/*',
  'https://*.homedepot.com/*', 'https://*.lowes.com/*', 'https://*.wayfair.com/*',
  'https://*.etsy.com/*', 'https://*.ebay.com/*', 'https://*.chewy.com/*',
  'https://*.costco.com/*', 'https://*.macys.com/*', 'https://*.kohls.com/*',
  'https://*.newegg.com/*', 'https://*.ulta.com/*', 'https://*.sephora.com/*',
  'https://*.nike.com/*',
]
const INTL_ORIGINS = ['https://*.amazon.ca/*', 'https://*.amazon.co.uk/*', 'https://*.amazon.com.au/*']

const $ = (id) => document.getElementById(id)

async function has(origins) {
  try { return !!(await chrome.permissions.contains({ origins })) } catch { return false }
}

async function refresh() {
  const [intl, retail] = await Promise.all([has(INTL_ORIGINS), has(RETAIL_ORIGINS)])
  $('intlState').textContent = intl ? 'on' : 'off'
  $('intlState').classList.toggle('on', intl)
  $('retailState').textContent = retail ? 'on' : 'off'
  $('retailState').classList.toggle('on', retail)
  const all = intl && retail
  $('grant').disabled = all
  $('grant').textContent = all ? 'Both are on' : (intl || retail ? 'Turn on the rest' : 'Turn both on')
  $('done').classList.toggle('show', all)
  return all
}

$('grant').addEventListener('click', async () => {
  $('err').classList.remove('show')
  $('grant').disabled = true
  try {
    // ONE dialog for everything still missing. Asking for both groups in a single
    // request means one Chrome prompt instead of two.
    const origins = []
    if (!(await has(INTL_ORIGINS))) origins.push(...INTL_ORIGINS)
    if (!(await has(RETAIL_ORIGINS))) origins.push(...RETAIL_ORIGINS)
    if (origins.length > 0) await chrome.permissions.request({ origins })
  } catch (e) {
    $('err').textContent = 'Chrome would not show the permission prompt: ' + ((e && e.message) || e)
    $('err').classList.add('show')
  }
  // Re-read the real state either way: a declined prompt must not look granted.
  const all = await refresh()
  if (!all) {
    $('err').textContent = 'Not granted. You can turn these on any time from the SCOUT icon in your toolbar.'
    $('err').classList.add('show')
  }
})

void refresh()
