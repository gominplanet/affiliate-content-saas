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

    const origFetch = window.fetch
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        try { const v = pick(init && init.headers); if (v) stash(v) } catch (e) { /* ignore */ }
        return origFetch.apply(this, arguments)
      }
    }

    const origSet = XMLHttpRequest && XMLHttpRequest.prototype && XMLHttpRequest.prototype.setRequestHeader
    if (origSet) {
      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        try { if (String(name).toLowerCase() === 'anti-csrftoken-a2z' && value) stash(value) } catch (e) { /* ignore */ }
        return origSet.apply(this, arguments)
      }
    }
  } catch (e) { /* never break the page */ }
})()
