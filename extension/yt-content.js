/* MVP Affiliate — SCOUT YouTube Studio content script (ISOLATED world)
 *
 * Runs on studio.youtube.com. Injects yt-hook.js into the page's MAIN world (a
 * content script can't see the page's own fetch/XHR), then listens for the save
 * requests the hook captures and stashes the most recent ones in
 * chrome.storage.local under 'mvp_yt_recipes'. The co-pilot "Learn Studio save"
 * flow reads them back (via the background MVP_YT_RECIPE message) so the replay
 * path is built from YouTube's REAL request, not guessed InnerTube field names.
 */
;(function () {
  try {
    const s = document.createElement('script')
    s.src = chrome.runtime.getURL('yt-hook.js')
    s.async = false
    ;(document.head || document.documentElement).appendChild(s)
    s.onload = () => { try { s.remove() } catch (e) {} }
  } catch (e) {}

  const MAX = 8
  window.addEventListener('message', (ev) => {
    try {
      if (ev.source !== window) return
      const d = ev.data
      if (!d || d.__mvpYt !== true || !d.rec) return
      chrome.storage.local.get(['mvp_yt_recipes'], (o) => {
        try {
          const list = Array.isArray(o && o.mvp_yt_recipes) ? o.mvp_yt_recipes : []
          list.unshift(d.rec)
          chrome.storage.local.set({ mvp_yt_recipes: list.slice(0, MAX) })
        } catch (e) {}
      })
    } catch (e) {}
  })
})()
