// SCOUT, Match my TikTok (1.59.0). Loaded into the creator's TikTok profile
// before TikTok's own code, only while SCOUT is reading their videos for MVP
// (it is registered for that read and removed after it).
//
// TikTok's profile page loads its video grid from its own backend with a
// signed request SCOUT cannot make itself. This keeps a copy of those answers
// as the page receives them, so SCOUT can hand MVP the videos exactly as
// TikTok sent them. It changes nothing: every request and answer goes on as
// the page made it. Only the profile's own video grid is kept, never the
// liked, reposted or saved lists.
(() => {
  try {
    if (window.__mvpTtHooked) return
    window.__mvpTtHooked = true
    window.__mvpTt = { items: [], ids: {}, hasMore: null, answers: 0, lastStatus: null }
    const wanted = (url) => /\/api\/(post|creator)\/item_list\//i.test(String(url || ''))
    const keep = (url, text) => {
      try {
        if (!wanted(url)) return
        const t = window.__mvpTt
        if (t.items.length >= 3000) return
        const body = text && typeof text === 'object' ? text : JSON.parse(text)
        t.answers++
        const list = (body && (body.itemList || body.items)) || []
        for (const it of list) {
          if (it && it.id && !t.ids[it.id]) { t.ids[it.id] = 1; t.items.push(it) }
        }
        if (body && typeof body.hasMore === 'boolean') t.hasMore = body.hasMore
        t.lastStatus = body ? (body.statusCode != null ? body.statusCode : body.status_code != null ? body.status_code : null) : null
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
