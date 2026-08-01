/* MVP Affiliate — SCOUT network hook (MAIN world)
 *
 * WHY: driving Amazon's Creator Connections chat by clicking the DOM (find the
 * message box, click Send, dismiss the "sharing personal information" popup) is
 * hopelessly brittle — background tabs don't render, buttons move, popups race.
 * The reliable way is to REPLAY the exact network request Amazon fires when a
 * message is sent, in the user's own session. But we don't know that endpoint,
 * so SCOUT LEARNS it: this hook runs in the PAGE'S OWN JS context (MAIN world),
 * patches fetch + XMLHttpRequest, and whenever the page POSTs something that looks
 * like a Creator Connections message send, it forwards the request (url, method,
 * headers, body) to the content script via window.postMessage. The content script
 * relays it to the background worker, which turns the FIRST real send it sees into
 * a reusable "recipe" and replays it for every future send — new text, right
 * brand — with no DOM at all.
 *
 * Content scripts run in an ISOLATED world and cannot see the page's own fetch,
 * which is exactly why this must be injected into the MAIN world.
 */
;(function () {
  if (window.__mvpNetHook) return
  window.__mvpNetHook = true

  const AMZ = /(^|\.)amazon\.com$/i
  // A send is a POST to an Amazon host whose URL or body reads like Creator
  // Connections messaging. Kept deliberately loose — the background worker does
  // the real filtering (it knows the message text it just placed), and replay
  // validates the response — but tight enough to skip the flood of analytics /
  // telemetry POSTs the SPA fires.
  const looksLikeSend = (url, method, body) => {
    try {
      if (!/^post$/i.test(String(method || ''))) return false
      const u = new URL(url, location.href)
      if (!AMZ.test(u.hostname)) return false
      const hay = (u.pathname + ' ' + (typeof body === 'string' ? body : '')).toLowerCase()
      return /messag|conversation|thread|spcc|creator|connect|outreach|contact/.test(hay)
    } catch (e) { return false }
  }

  const headersToObj = (h) => {
    const o = {}
    try {
      if (!h) return o
      if (typeof Headers !== 'undefined' && h instanceof Headers) { h.forEach((v, k) => { o[k] = v }) }
      else if (Array.isArray(h)) { h.forEach((pair) => { if (pair && pair.length === 2) o[pair[0]] = pair[1] }) }
      else if (typeof h === 'object') { for (const k in h) { try { o[k] = String(h[k]) } catch (e) {} } }
    } catch (e) {}
    return o
  }

  const emit = (rec) => {
    try { window.postMessage({ __mvpNet: true, kind: 'send-capture', rec }, location.origin) } catch (e) {}
  }

  // ── fetch ──────────────────────────────────────────────────────────────────
  const origFetch = window.fetch
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || ''
        const method = (init && init.method) || (input && input.method) || 'GET'
        const body = init && init.body
        if (looksLikeSend(url, method, body)) {
          emit({ via: 'fetch', url, method, headers: headersToObj(init && init.headers), body: typeof body === 'string' ? body : null, ts: Date.now() })
        }
      } catch (e) {}
      return origFetch.apply(this, arguments)
    }
  }

  // ── XMLHttpRequest ───────────────────────────────────────────────────────────
  try {
    const XO = XMLHttpRequest.prototype.open
    const XS = XMLHttpRequest.prototype.send
    const XH = XMLHttpRequest.prototype.setRequestHeader
    XMLHttpRequest.prototype.open = function (method, url) { try { this.__mvp = { method, url, headers: {} } } catch (e) {} return XO.apply(this, arguments) }
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (this.__mvp) this.__mvp.headers[k] = v } catch (e) {} return XH.apply(this, arguments) }
    XMLHttpRequest.prototype.send = function (body) {
      try {
        const m = this.__mvp
        if (m && looksLikeSend(m.url, m.method, body)) {
          emit({ via: 'xhr', url: m.url, method: m.method, headers: m.headers, body: typeof body === 'string' ? body : null, ts: Date.now() })
        }
      } catch (e) {}
      return XS.apply(this, arguments)
    }
  } catch (e) {}
})()
