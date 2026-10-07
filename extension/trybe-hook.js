// SCOUT, TRYBE outreach (Labs). Loaded into jointrybe.com before TRYBE's own
// code, only while SCOUT is collecting TRYBE's brand list for MVP (it is
// registered for that run and removed after it).
//
// It notes the sign-in TRYBE's own page attaches to its own requests, so SCOUT
// can ask TRYBE for the brand list exactly as the page does. It changes
// nothing: every request goes on exactly as the page sent it. The sign-in
// stays in this tab; SCOUT never sends it anywhere but back to TRYBE.
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
    const realFetch = window.fetch
    if (typeof realFetch === 'function') {
      window.fetch = function (input, init) {
        try { fromHeaders(init && init.headers); if (input && typeof input === 'object') fromHeaders(input.headers) } catch (e) {}
        return realFetch.apply(this, arguments)
      }
    }
    if (typeof XMLHttpRequest !== 'undefined') {
      const realSet = XMLHttpRequest.prototype.setRequestHeader
      XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
        try { if (/^authorization$/i.test(String(k))) note(v) } catch (e) {}
        return realSet.apply(this, arguments)
      }
    }
  } catch (e) {}
})()
