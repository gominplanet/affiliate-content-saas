// SCOUT, hashtag trends. Loaded into TikTok Creative Center before its own
// code, only while SCOUT is reading the trending hashtags for MVP (it is
// registered for that read and removed after it).
//
// Creative Center loads its hashtag list from its own backend with a signed
// request SCOUT cannot make itself. This keeps a copy of those answers as the
// page receives them, so SCOUT can hand MVP the list exactly as TikTok sent it.
// It changes nothing: every request and answer goes on as the page made it.
(() => {
  try {
    if (window.__mvpCcHooked) return
    window.__mvpCcHooked = true
    window.__mvpCcHashtags = []
    const wanted = (url) => /creative_radar_api/i.test(url) && /hashtag/i.test(url)
    const keep = (url, text) => {
      try {
        if (!wanted(url) || window.__mvpCcHashtags.length >= 30) return
        const body = text && typeof text === 'object' ? text : JSON.parse(text)
        window.__mvpCcHashtags.push({ url: String(url).slice(0, 600), body })
      } catch (e) {}
    }
    const realFetch = window.fetch
    if (typeof realFetch === 'function') {
      window.fetch = function (input, init) {
        const p = realFetch.apply(this, arguments)
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || ''
          if (wanted(url)) p.then((r) => { try { r.clone().text().then((t) => keep(url, t)).catch(() => {}) } catch (e) {} }).catch(() => {})
        } catch (e) {}
        return p
      }
    }
    if (typeof XMLHttpRequest !== 'undefined') {
      const realOpen = XMLHttpRequest.prototype.open
      XMLHttpRequest.prototype.open = function (method, url) {
        try {
          const u = String(url || '')
          if (wanted(u)) this.addEventListener('load', () => { try { keep(this.responseURL || u, this.responseType === 'json' ? this.response : this.responseText) } catch (e) {} })
        } catch (e) {}
        return realOpen.apply(this, arguments)
      }
    }
  } catch (e) {}
})()
