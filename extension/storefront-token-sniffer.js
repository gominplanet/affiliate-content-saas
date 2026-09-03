/**
 * SCOUT — Creator Hub CSRF sniffer (MAIN world, document_start).
 *
 * The /create/api/* calls require Amazon's per-page `anti-csrftoken-a2z`. We were
 * scraping one out of the DOM, but the create app uses a DIFFERENT token than the
 * ones sitting in the page markup, so our publish (shoppable-media) came back 403.
 *
 * This runs in the PAGE's own world before the app boots and wraps fetch +
 * XHR.setRequestHeader to record the exact anti-csrftoken-a2z the page sends on
 * its OWN create-API calls (video-influencer-onboarding, trigger-and-record-weblab,
 * etc. all fire on load). It stashes the value on a shared DOM data attribute
 * (data-mvp-a2z) that the isolated-world uploader reads — both worlds see the same
 * DOM, so this is the clean bridge. Read-only: never blocks or alters a request.
 */
(function () {
  'use strict'
  try {
    const stash = (t) => {
      try { if (t && typeof t === 'string') document.documentElement.setAttribute('data-mvp-a2z', t) } catch (e) { /* ignore */ }
    }
    const pick = (headers) => {
      try {
        if (!headers) return null
        if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get('anti-csrftoken-a2z')
        if (Array.isArray(headers)) { for (const pair of headers) if (String(pair[0]).toLowerCase() === 'anti-csrftoken-a2z') return pair[1]; return null }
        if (typeof headers === 'object') { for (const k in headers) if (k.toLowerCase() === 'anti-csrftoken-a2z') return headers[k] }
      } catch (e) { /* ignore */ }
      return null
    }

    // ── Diagnostic: record the create-API calls the REAL Creator Hub makes ─────
    // When Amazon rejects OUR publish with a validation error, the only reliable
    // fix is to match what the page itself sends. So when the creator publishes
    // manually, capture the exact request body + response for the create APIs we
    // replay, and hand it to the isolated world (which relays it to the worker).
    // Read-only, capped, and never blocks the page.
    // Anything the Creator Hub calls that we replay or want to learn. The
    // globalize / cross-post family matters most: Amazon copies an already
    // uploaded video to another marketplace server-side, which is why its own
    // Cross Post finishes in seconds while re-uploading the bytes per store
    // takes minutes. We can only replay that call once we've seen a real one.
    const WATCHED = /\/(create|manage-content|creatorhub)\/api\/|globaliz|cross-?post|shoppable/i
    const relay = (entry) => { try { window.postMessage({ __mvpCreateLog: 1, entry: entry }, '*') } catch (e) { /* ignore */ } }

    const origFetch = window.fetch
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        try { const v = pick(init && init.headers); if (v) stash(v) } catch (e) { /* ignore */ }
        const out = origFetch.apply(this, arguments)
        try {
          let url = ''
          try { url = typeof input === 'string' ? input : (input && input.url) || '' } catch (e) { /* ignore */ }
          if (url && WATCHED.test(url)) {
            const reqBody = init && typeof init.body === 'string' ? init.body : null
            const method = (init && init.method) || 'GET'
            out.then(function (res) {
              try {
                res.clone().text().then(function (txt) {
                  relay({
                    url: String(url).slice(0, 220), method: method, status: res.status,
                    request: reqBody ? reqBody.slice(0, 6000) : null,
                    response: String(txt || '').slice(0, 4000), ts: Date.now(),
                  })
                }).catch(function () { /* ignore */ })
              } catch (e) { /* ignore */ }
            }).catch(function () { /* ignore */ })
          }
        } catch (e) { /* never break the page */ }
        return out
      }
    }

    const origSet = XMLHttpRequest && XMLHttpRequest.prototype && XMLHttpRequest.prototype.setRequestHeader
    if (origSet) {
      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        try { if (String(name).toLowerCase() === 'anti-csrftoken-a2z' && value) stash(value) } catch (e) { /* ignore */ }
        return origSet.apply(this, arguments)
      }
    }

    // Same capture for XHR, since the Creator Hub doesn't use fetch everywhere and
    // a cross-post fired over XHR would otherwise be invisible to us.
    const origOpen = XMLHttpRequest && XMLHttpRequest.prototype && XMLHttpRequest.prototype.open
    const origSend = XMLHttpRequest && XMLHttpRequest.prototype && XMLHttpRequest.prototype.send
    if (origOpen && origSend) {
      XMLHttpRequest.prototype.open = function (method, url) {
        try { this.__mvpMethod = method; this.__mvpUrl = url } catch (e) { /* ignore */ }
        return origOpen.apply(this, arguments)
      }
      XMLHttpRequest.prototype.send = function (bodyArg) {
        try {
          const url = this.__mvpUrl || ''
          if (url && WATCHED.test(String(url))) {
            const reqBody = typeof bodyArg === 'string' ? bodyArg : null
            this.addEventListener('load', function () {
              try {
                relay({
                  url: String(url).slice(0, 220), method: String(this.__mvpMethod || 'GET'), status: this.status,
                  request: reqBody ? reqBody.slice(0, 6000) : null,
                  response: String(this.responseText || '').slice(0, 4000), ts: Date.now(), via: 'xhr',
                })
              } catch (e) { /* ignore */ }
            })
          }
        } catch (e) { /* never break the page */ }
        return origSend.apply(this, arguments)
      }
    }
  } catch (e) { /* never break the page */ }
})()
