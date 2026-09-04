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
      // `video`, `media` and `content` bring in the Creator Hub video list, whose
      // own request is the reliable way to read a 7,000 video library. Clicking
      // Next through its grid stalls long before the end.
      return /messag|conversation|thread|spcc|creator|connect|outreach|contact|video|media|content/.test(hay)
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

  const emit = (kind, rec) => {
    try { window.postMessage({ __mvpNet: true, kind, rec }, location.origin) } catch (e) {}
  }
  // Endpoints whose RESPONSE we want to see (not just the request): chat/search
  // carries the contextToken; collaboration/campaign/spcc search resolve an ASIN /
  // brand → the campaignId; accept/opt-in confirms a brand chat now exists.
  const wantResponse = (url) => { try { return /\/connect\/api\/(chat\/(search|message\/send)|collaboration\/search|campaign\/search|spcc\/search|.*(accept|opt-?in))/i.test(new URL(url, location.href).pathname) } catch (e) { return false } }

  // ── fetch ──────────────────────────────────────────────────────────────────
  const origFetch = window.fetch
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      let url = '', method = 'GET'
      try {
        url = typeof input === 'string' ? input : (input && input.url) || ''
        method = (init && init.method) || (input && input.method) || 'GET'
        const body = init && init.body
        if (looksLikeSend(url, method, body)) {
          emit('send-capture', { via: 'fetch', url, method, headers: headersToObj(init && init.headers), body: typeof body === 'string' ? body : null, ts: Date.now() })
        }
      } catch (e) {}
      const p = origFetch.apply(this, arguments)
      try {
        if (/^post$/i.test(String(method)) && wantResponse(url)) {
          p.then((resp) => {
            try { resp.clone().text().then((t) => emit('send-response', { url, status: resp.status, body: (t || '').slice(0, 8000), ts: Date.now() })).catch(() => {}) } catch (e) {}
          }).catch(() => {})
        }
      } catch (e) {}
      return p
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
          emit('send-capture', { via: 'xhr', url: m.url, method: m.method, headers: m.headers, body: typeof body === 'string' ? body : null, ts: Date.now() })
        }
      } catch (e) {}
      return XS.apply(this, arguments)
    }
  } catch (e) {}
})()
