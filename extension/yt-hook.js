/* MVP Affiliate — SCOUT YouTube Studio network hook (MAIN world)
 *
 * WHY: driving YouTube Studio's disclosure controls (paid promotion, altered/AI
 * content) by clicking is a dead end — Studio is a Polymer app and an extension's
 * synthetic clicks are UNTRUSTED (isTrusted:false), so the app ticks the box
 * visually but ignores it in its data model, then Save persists the unchanged
 * model. Nothing sticks.
 *
 * The reliable way is the same one SCOUT uses for Amazon Creator Connections:
 * REPLAY the exact network request Studio fires when the user saves. But the
 * request shape (endpoint + InnerTube field names) is YouTube-internal and drifts,
 * so we LEARN it. This hook runs in the PAGE's own JS context (MAIN world),
 * patches fetch + XMLHttpRequest, and whenever Studio POSTs a video metadata
 * update it forwards {url, headers, body} to the content script (ISOLATED world)
 * via window.postMessage. The content script stores it as a reusable recipe that
 * the replay path swaps the video id + disclosure fields into.
 */
;(function () {
  if (window.__mvpYtHook) return
  window.__mvpYtHook = true

  // A save is a POST to Studio's InnerTube that carries a video id — the
  // metadata_update endpoint is the primary target, but we also keep any
  // youtubei POST whose body references a video so a renamed endpoint is still
  // captured. The content script + human do the real picking.
  const looksLikeSave = (url, method, body) => {
    try {
      if (!/^post$/i.test(String(method || ''))) return false
      const u = new URL(url, location.href)
      if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return false
      const path = u.pathname.toLowerCase()
      if (!/\/youtubei\/v1\//.test(path)) return false
      const b = typeof body === 'string' ? body : ''
      if (/metadata_update|video_manager|update_video|monetization/.test(path)) return true
      // Fallback: any youtubei POST that mentions a video id + a disclosure-ish field.
      return /encryptedvideoid|externalvideoid/i.test(b) && /paid|disclosure|sponsor|altered|synthetic|promotion/i.test(b)
    } catch (e) { return false }
  }

  const headersToObj = (h) => {
    const o = {}
    try {
      if (!h) return o
      if (typeof Headers !== 'undefined' && h instanceof Headers) { h.forEach((v, k) => { o[k] = v }) }
      else if (Array.isArray(h)) { h.forEach((p) => { if (p && p.length === 2) o[p[0]] = p[1] }) }
      else if (typeof h === 'object') { for (const k in h) { try { o[k] = String(h[k]) } catch (e) {} } }
    } catch (e) {}
    return o
  }

  const emit = (rec) => {
    try {
      window.postMessage({ __mvpYt: true, rec }, location.origin)
      // Console breadcrumb so a save can be grabbed straight from DevTools too.
      // eslint-disable-next-line no-console
      console.log('[MVP-SCOUT] captured Studio save request:', rec.url)
    } catch (e) {}
  }

  const origFetch = window.fetch
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || ''
        const method = (init && init.method) || (input && input.method) || 'GET'
        const body = init && init.body
        if (looksLikeSave(url, method, body)) {
          emit({ via: 'fetch', url, method, headers: headersToObj(init && init.headers), body: typeof body === 'string' ? body : null, ts: Date.now() })
        }
      } catch (e) {}
      return origFetch.apply(this, arguments)
    }
  }

  try {
    const XO = XMLHttpRequest.prototype.open
    const XS = XMLHttpRequest.prototype.send
    const XH = XMLHttpRequest.prototype.setRequestHeader
    XMLHttpRequest.prototype.open = function (method, url) { try { this.__mvpYt = { method, url, headers: {} } } catch (e) {} return XO.apply(this, arguments) }
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (this.__mvpYt) this.__mvpYt.headers[k] = v } catch (e) {} return XH.apply(this, arguments) }
    XMLHttpRequest.prototype.send = function (body) {
      try {
        const m = this.__mvpYt
        if (m && looksLikeSave(m.url, m.method, body)) {
          emit({ via: 'xhr', url: m.url, method: m.method, headers: m.headers, body: typeof body === 'string' ? body : null, ts: Date.now() })
        }
      } catch (e) {}
      return XS.apply(this, arguments)
    }
  } catch (e) {}
})()
