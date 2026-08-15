// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SCOUT · Idea Lists (standalone content script)
// ---------------------------------------------------------------------------
// Runs on the creator's Amazon Influencer storefront (www.amazon.com/shop/*).
// It is deliberately its OWN file (not part of content.js) so a failure
// anywhere else in the extension can never stop it from running.
//
// Zero-click: the creator just lands on their storefront. SCOUT then
//   1. discovers every idea list on the page (id, title, count, cover),
//   2. pushes that metadata so the lists appear in MVP immediately,
//   3. for each list, loads it in a hidden, off-screen same-origin iframe,
//      scrolls it to load EVERY product, scrapes asin/title/image, and pushes
//      the full set — all in the background, without navigating the user.
//
// A synced list is skipped for 3 days (chrome.storage.local) so revisiting the
// storefront doesn't re-scrape everything each time. Progress shows as a small
// badge in the corner, so the creator can see it working with no console.
;(function mvpIdeaListsScout() {
  try { if (!/(^|\.)amazon\./i.test(location.hostname)) return } catch (e) { return }

  const MVP = 'SCOUT_PUSH_IDEA_LISTS'
  const MVP_ITEMS = 'SCOUT_PUSH_IDEA_LIST_ITEMS'
  const LOG = '[SCOUT idea-lists]'
  const MAX_LISTS = 30            // safety cap per visit
  const RESCRAPE_MS = 3 * 24 * 60 * 60 * 1000
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const send = (type, payload) => { try { const p = chrome.runtime.sendMessage(Object.assign({ type: type }, payload)); if (p && p.catch) p.catch(() => {}) } catch (e) {} }

  const onStorefront = () => { try { return /\/(shop|list)\//i.test(location.pathname) } catch (e) { return false } }
  const handle = () => { const m = location.pathname.match(/\/shop\/([^/?#]+)/i); return m ? m[1] : null }
  const listIdFromHref = (href) => { const m = String(href || '').match(/\/(?:shop\/[^/]+\/)?list\/([A-Za-z0-9]{6,})/i); return m ? m[1] : null }
  const currentListId = () => listIdFromHref(location.pathname)
  const listUrlFor = (id) => { const h = handle(); return h ? `https://www.amazon.com/shop/${h}/list/${id}` : `https://www.amazon.com/list/${id}` }

  // ── Visible status badge (no console needed) ────────────────────────────────
  function badge(text, kind) {
    try {
      let el = document.getElementById('mvp-scout-badge')
      if (!el) {
        el = document.createElement('div'); el.id = 'mvp-scout-badge'
        el.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:340px;padding:11px 15px;border-radius:11px;font:600 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.28);transition:opacity .3s ease'
        document.documentElement.appendChild(el)
      }
      el.style.background = kind === 'err' ? '#dc2626' : (kind === 'work' ? '#7C3AED' : '#16a34a')
      el.textContent = 'MVP SCOUT · ' + text
      el.style.opacity = '1'
      clearTimeout(el._t); el._t = setTimeout(() => { try { el.style.opacity = '0' } catch (e) {} }, kind === 'work' ? 120000 : 8000)
    } catch (e) {}
  }

  // ── Product-tile parsing (works on a list page OR inside an iframe doc) ──────
  function tileTitle(el) {
    let s = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
    const price = s.search(/\$\s?\d/); if (price > 0) s = s.slice(0, price)
    s = s.replace(/^(Best ?Seller|Amazon['’]?s Choice|Overall Pick|Editor['’]?s Pick|Limited time deal|Sponsored|New|Popular pick)\s*/i, '').trim()
    const w = s.split(' '); if (w.length > 2 && w[0].toLowerCase() === w[1].toLowerCase()) s = w.slice(1).join(' ')
    return s.slice(0, 200)
  }
  function tileImage(el) { const img = el.querySelector('img'); const src = img && (img.getAttribute('src') || img.getAttribute('data-src')); return src && /\.(jpg|jpeg|png|webp)/i.test(src) ? src : null }
  function collectItemsFrom(root) {
    const out = [], seen = new Set()
    ;(root || document).querySelectorAll('[data-asin]').forEach((el) => {
      const asin = (el.getAttribute('data-asin') || '').trim().toUpperCase()
      if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) return
      seen.add(asin)
      out.push({ asin: asin, title: tileTitle(el) || null, image: tileImage(el) })
    })
    return out
  }
  function declaredCountIn(root) { const t = ((root || document).body && (root || document).body.innerText) || ''; const m = t.match(/([\d,]+)\s+Items?\b/i); return m ? parseInt(m[1].replace(/,/g, ''), 10) : null }
  function listTitleIn(root) {
    const h1 = (root || document).querySelector('h1'); let t = (h1 && h1.textContent || '').replace(/\s+/g, ' ').trim()
    const ap = t.search(/Amazon Page/i); if (ap >= 0) t = t.slice(ap + 'Amazon Page'.length)
    return t.replace(/^['’]s\b/i, '').replace(/^[\s\-–—:|,]+/, '').replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').trim().slice(0, 160) || null
  }

  // ── Discover the lists on the storefront (anchors + a raw-HTML fallback) ─────
  function discoverLists() {
    const byId = new Map()
    document.querySelectorAll('a[href*="/list/"]').forEach((a) => {
      const id = listIdFromHref(a.getAttribute('href') || a.href); if (!id || byId.has(id)) return
      const card = a.closest('li, [data-testid], article, div') || a
      const img = card.querySelector('img')
      const label = (a.textContent || '').replace(/\s+/g, ' ').trim() || ((card.querySelector('h2,h3,[class*=title]') || {}).textContent || '')
      const cnt = (card.innerText || '').match(/([\d,]+)\s+Items?\b/i)
      byId.set(id, {
        amazonListId: id,
        title: (label || '').replace(/\s+/g, ' ').trim().slice(0, 200) || null,
        url: listUrlFor(id),
        itemCount: cnt ? parseInt(cnt[1].replace(/,/g, ''), 10) : null,
        coverImage: (img && (img.getAttribute('src') || img.getAttribute('data-src'))) || null,
      })
    })
    // Fallback: some storefront layouts embed list ids in inline JSON, not anchors.
    if (byId.size === 0) {
      try {
        const html = document.documentElement.innerHTML
        const re = /\/(?:shop\/[^/"']+\/)?list\/([A-Za-z0-9]{6,})/g
        let m
        while ((m = re.exec(html)) && byId.size < MAX_LISTS) {
          const id = m[1]; if (!byId.has(id)) byId.set(id, { amazonListId: id, title: null, url: listUrlFor(id), itemCount: null, coverImage: null })
        }
      } catch (e) {}
    }
    return Array.from(byId.values()).slice(0, MAX_LISTS)
  }

  // ── Background capture: load a list in a hidden iframe, scroll, scrape ───────
  function captureListInIframe(meta) {
    return new Promise((resolve) => {
      let done = false
      const iframe = document.createElement('iframe')
      iframe.setAttribute('aria-hidden', 'true')
      iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:2400px;opacity:0;border:0;pointer-events:none'
      const finish = (items) => { if (done) return; done = true; try { iframe.remove() } catch (e) {} ; resolve(items || []) }
      const hardTimeout = setTimeout(() => finish([]), 45000)
      iframe.onload = async () => {
        try {
          const doc = iframe.contentDocument
          const win = iframe.contentWindow
          if (!doc || !win) { clearTimeout(hardTimeout); return finish([]) } // framing blocked
          let last = -1, stable = 0
          for (let i = 0; i < 30 && stable < 3; i++) {
            try { win.scrollTo(0, doc.body.scrollHeight) } catch (e) {}
            await sleep(900)
            const n = doc.querySelectorAll('[data-asin]').length
            if (n === last) stable++; else { stable = 0; last = n }
          }
          const items = collectItemsFrom(doc)
          const title = meta.title || listTitleIn(doc)
          const itemCount = meta.itemCount || declaredCountIn(doc)
          clearTimeout(hardTimeout)
          finish(items.length ? { items, title, itemCount } : [])
        } catch (e) { clearTimeout(hardTimeout); finish([]) } // cross-origin / blocked
      }
      iframe.src = meta.url
      document.documentElement.appendChild(iframe)
    })
  }

  // ── chrome.storage throttle: don't re-scrape a list within RESCRAPE_MS ───────
  function recentlySynced(id) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['mvpIdeaSynced'], (o) => {
          const map = (o && o.mvpIdeaSynced) || {}
          resolve(map[id] && (Date.now() - map[id]) < RESCRAPE_MS)
        })
      } catch (e) { resolve(false) }
    })
  }
  function markSynced(id) {
    try { chrome.storage.local.get(['mvpIdeaSynced'], (o) => { const map = (o && o.mvpIdeaSynced) || {}; map[id] = Date.now(); try { chrome.storage.local.set({ mvpIdeaSynced: map }) } catch (e) {} }) } catch (e) {}
  }

  async function sendItems(list) {
    try {
      const res = await chrome.runtime.sendMessage({ type: MVP_ITEMS, list: list })
      if (res && res.status === 401) { badge('Sign in to mvpaffiliate.io in THIS browser, then reload your storefront.', 'err'); return false }
      if (res && res.ok) { markSynced(list.amazonListId); return true }
      return false
    } catch (e) { return false }
  }

  // ── The zero-click storefront run ───────────────────────────────────────────
  let running = false
  async function runStorefront() {
    if (running) return
    running = true
    try {
      const lists = discoverLists()
      if (!lists.length) { try { console.debug(LOG, 'no lists found on storefront yet') } catch (e) {} ; running = false; return }
      try { console.debug(LOG, 'discovered', lists.length, 'lists') } catch (e) {}
      send(MVP, { lists: lists })   // metadata first — they show in MVP right away

      // Which still need a product scrape?
      const todo = []
      for (const l of lists) { if (!(await recentlySynced(l.amazonListId))) todo.push(l) }
      if (!todo.length) { badge('Your ' + lists.length + ' idea list' + (lists.length === 1 ? '' : 's') + ' are already synced.', 'ok'); running = false; return }

      let ok = 0
      for (let i = 0; i < todo.length; i++) {
        badge('Reading your lists in the background… (' + (i + 1) + '/' + todo.length + ')', 'work')
        const cap = await captureListInIframe(todo[i])
        if (cap && cap.items && cap.items.length) {
          const saved = await sendItems({ amazonListId: todo[i].amazonListId, title: cap.title || todo[i].title, url: todo[i].url, itemCount: cap.itemCount || todo[i].itemCount, coverImage: todo[i].coverImage || (cap.items[0] && cap.items[0].image) || null, items: cap.items })
          if (saved) ok++
        }
      }
      if (ok > 0) badge('Synced ' + ok + ' list' + (ok === 1 ? '' : 's') + ' to MVP. Open MVP → Idea Lists.', 'ok')
      else badge('Found your lists but couldn’t read the products automatically. Tell MVP support.', 'err')
    } catch (e) { try { console.debug(LOG, 'run error', e && e.message) } catch (er) {} }
    running = false
  }

  // ── If the creator IS on a single list page, capture it directly too ────────
  const captured = new Set()
  async function captureCurrentList() {
    const id = currentListId(); if (!id || captured.has(id)) return
    captured.add(id)
    badge('Reading this list…', 'work')
    let last = -1, stable = 0
    for (let i = 0; i < 30 && stable < 3; i++) {
      try { window.scrollTo(0, document.body.scrollHeight) } catch (e) {}
      await sleep(1000)
      if (currentListId() !== id) return
      const n = document.querySelectorAll('[data-asin]').length
      if (n === last) stable++; else { stable = 0; last = n }
    }
    try { window.scrollTo(0, 0) } catch (e) {}
    const items = collectItemsFrom(document)
    if (!items.length) { captured.delete(id); return }
    const saved = await sendItems({ amazonListId: id, title: listTitleIn(document), url: location.href.split('?')[0], itemCount: declaredCountIn(document), coverImage: (items[0] && items[0].image) || null, items: items })
    if (saved) badge('Synced this list · ' + items.length + ' products. Open MVP → Idea Lists.', 'ok')
  }

  // ── Runner: react to SPA navigation, debounce, backstop ─────────────────────
  let lt = null
  const kick = () => { clearTimeout(lt); lt = setTimeout(() => { try { if (!onStorefront()) return; if (currentListId()) captureCurrentList(); else runStorefront() } catch (e) {} }, 2500) }
  let lastHref = location.href
  const onNav = () => { if (location.href !== lastHref) { lastHref = location.href; running = false; kick() } }
  try {
    const wrap = (fn) => function () { const r = fn.apply(this, arguments); try { onNav() } catch (e) {} ; return r }
    history.pushState = wrap(history.pushState)
    history.replaceState = wrap(history.replaceState)
    window.addEventListener('popstate', onNav)
  } catch (e) {}
  try { new MutationObserver(() => onNav()).observe(document.documentElement, { childList: true, subtree: true }) } catch (e) {}
  try { setInterval(() => { onNav() }, 4000) } catch (e) {}
  if (onStorefront()) badge('Active on your storefront — finding your idea lists…', 'work')
  kick()
})();
