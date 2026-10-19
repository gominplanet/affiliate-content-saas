// SCOUT, TRYBE outreach (Labs). Loaded into jointrybe.com before TRYBE's own
// code. Since 1.53.2 it is in every TRYBE tab the creator opens (SCOUT works
// through that tab and opens none of its own), and SCOUT adds it to a TRYBE
// tab that was open before.
//
// It notes the sign-in TRYBE's own page attaches to its own requests, so SCOUT
// can ask TRYBE for the brand list exactly as the page does. It changes
// nothing: every request goes on exactly as the page sent it. The sign-in
// stays in this tab; SCOUT never sends it anywhere but back to TRYBE.
// 1.53.2: TRYBE renews its sign-in in memory, so the renewed one is noted
// from the answer to TRYBE's own renewal (auth/v1/token) as well.
(() => {
  try {
    if (window.__mvpTrybeHooked) return
    window.__mvpTrybeHooked = true
    const note = (v) => {
      try {
        const s = String(v || '')
        if (/^Bearer\s+\S+/i.test(s)) window.__mvpTrybeAuth = { token: s.replace(/^Bearer\s+/i, ''), at: Date.now() }
      } catch (e) {}
    }
    const fromHeaders = (h) => {
      if (!h) return
      if (typeof h.get === 'function') { note(h.get('authorization')); return }
      if (Array.isArray(h)) { for (const pair of h) if (pair && /^authorization$/i.test(pair[0])) note(pair[1]); return }
      for (const k of Object.keys(h)) if (/^authorization$/i.test(k)) note(h[k])
    }
    const RENEWAL = /\/auth\/v1\/token/
    const fromRenewal = (text) => {
      try { const j = JSON.parse(String(text || '')); if (j && typeof j.access_token === 'string') note('Bearer ' + j.access_token) } catch (e) {}
    }
    const realFetch = window.fetch
    if (typeof realFetch === 'function') {
      window.fetch = function (input, init) {
        try { fromHeaders(init && init.headers); if (input && typeof input === 'object') fromHeaders(input.headers) } catch (e) {}
        const p = realFetch.apply(this, arguments)
        try {
          const url = String(typeof input === 'string' ? input : (input && input.url) || '')
          if (RENEWAL.test(url)) p.then((r) => { try { r.clone().text().then(fromRenewal, () => {}) } catch (e) {} }, () => {})
        } catch (e) {}
        return p
      }
    }
    if (typeof XMLHttpRequest !== 'undefined') {
      const realSet = XMLHttpRequest.prototype.setRequestHeader
      XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
        try { if (/^authorization$/i.test(String(k))) note(v) } catch (e) {}
        return realSet.apply(this, arguments)
      }
      const realSend = XMLHttpRequest.prototype.send
      XMLHttpRequest.prototype.send = function () {
        try { this.addEventListener('load', () => { try { if (RENEWAL.test(String(this.responseURL || ''))) fromRenewal(this.responseText) } catch (e) {} }) } catch (e) {}
        return realSend.apply(this, arguments)
      }
    }
  } catch (e) {}
})()
