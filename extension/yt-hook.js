/* MVP Affiliate — SCOUT YouTube Studio network hook (MAIN world)
 *
 * Two jobs, both because extension-injected clicks are untrusted and Studio's
 * Polymer app ignores them:
 *
 *  1. CAPTURE — record the real metadata_update save request so we know its
 *     exact InnerTube shape (endpoint + field names).
 *  2. INJECT — when window.__mvpYtInject is set, merge the disclosure fields
 *     (paid promotion / altered-content / monetization) INTO Studio's own
 *     outgoing metadata_update before it's sent. Studio built and SIGNED that
 *     request (fresh SAPISIDHASH + BotGuard attestation + full readMask), so our
 *     fields ride along on a request YouTube actually honors — the thing a
 *     hand-rolled replay can't do (YouTube 200s but silently drops it).
 *
 * A content script (yt-content.js, isolated world) injects this into the MAIN
 * world and relays captures to chrome.storage.
 */
;(function () {
  if (window.__mvpYtHook) return
  window.__mvpYtHook = true

  // The Studio "Details" save family. YouTube periodically renames the endpoint
  // tail (metadata_update → update_video, moves it under a different node), so
  // match the family rather than one exact path. If we only matched the old
  // path, a renamed save would look like "no metadata_update was sent" even
  // though it saved fine — injection is still gated on a video-id match below,
  // so widening this can't corrupt an unrelated request.
  const isMetaUpdate = (url) => {
    try {
      const p = new URL(url, location.href).pathname.toLowerCase()
      return /\/youtubei\/v1\//.test(p) && /metadata_update|update_video|video_manager/.test(p)
    } catch (e) { return false }
  }

  const looksLikeSave = (url, method, body) => {
    try {
      if (!/^post$/i.test(String(method || ''))) return false
      const u = new URL(url, location.href)
      if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return false
      const path = u.pathname.toLowerCase()
      if (!/\/youtubei\/v1\//.test(path)) return false
      const b = typeof body === 'string' ? body : ''
      if (/metadata_update|video_manager|update_video|monetization/.test(path)) return true
      return /encryptedvideoid|externalvideoid/i.test(b) && /paid|disclosure|sponsor|altered|synthetic|promotion/i.test(b)
    } catch (e) { return false }
  }

  const headersToObj = (h) => {
    const o = {}
    try {
      if (!h) return o
      if (typeof Headers !== 'undefined' && h instanceof Headers) { h.forEach((v, k) => { o[k] = v }) }
      else if (Array.isArray(h)) { h.forEach((p) => { if (p && p.length === 2) o[p[0]] = p[1] }) }
      else if (typeof h === 'object') { for (const k in h) { try { o[k] = String(h[k]) } catch (e) {} } }
    } catch (e) {}
    return o
  }

  const emit = (rec) => {
    try {
      window.postMessage({ __mvpYt: true, rec }, location.origin)
      // eslint-disable-next-line no-console
      console.log('[MVP-SCOUT] captured Studio save request:', rec.url)
    } catch (e) {}
  }

  // Merge the disclosure mutations into a metadata_update body, in place, for the
  // targeted video only. Returns the (possibly rewritten) body string.
  const injectDisclosures = (bodyStr) => {
    const inj = window.__mvpYtInject
    if (!inj || typeof bodyStr !== 'string') return bodyStr
    try {
      const b = JSON.parse(bodyStr)
      // Record what we saw so a "nothing injected" can be diagnosed: is the
      // save for a different video id, or did no metadata_update fire at all?
      try { window.__mvpYtSawMeta = (window.__mvpYtSawMeta || 0) + 1; window.__mvpYtSawVideoId = b && b.encryptedVideoId } catch (e) {}
      if (!b || b.encryptedVideoId !== inj.videoId) return bodyStr
      if (inj.paidPromotion) b.productPlacement = { newHasPaidProductPlacement: true, newShowPaidProductPlacementOverlay: true, newIsPaidProductPlacementSelfDeclaredDefinitive: true }
      if (inj.aiDisclosure) b.alteredContent = { operation: 'MDE_ALTERED_CONTENT_UPDATE_OPERATION_SET', newCreatorDisclosedHasAlteredContent: inj.hasAlteredContent ? 'MDE_HAS_ALTERED_CONTENT_YES' : 'MDE_HAS_ALTERED_CONTENT_NO' }
      if (inj.monetize) {
        b.monetizationSettings = { newMonetizeWithAds: true }
        b.adSettings = { adBreaks: { newHasPrerolls: 'ENABLED', newHasMidrollAds: 'ENABLED', newHasPostrolls: 'ENABLED' }, autoAdSettings: 'AUTO_AD_SETTINGS_TYPE_OFF' }
        // Submit the ad-suitability self-certification too — all questions
        // "skipped" (= None of the above → suitable for all advertisers), the
        // default a creator gets by clicking through. Shape from the capture.
        b.selfCertification = {
          newSelfCertificationData: {
            questionnaireAnswers: ['PY', 'SC', 'VG', 'HD', 'DG', 'HH', 'FM', 'SE', 'SK', 'CI', 'DB', 'AT', 'NB', 'SM'].map((q) => ({ question: 'VIDEO_SELF_CERTIFICATION_QUESTION_' + q, answer: 'VIDEO_SELF_CERTIFICATION_ANSWER_SKIPPED' })),
            certificationMethod: 'VIDEO_SELF_CERTIFICATION_METHOD_DEFAULT_NONE',
            questionnaireVersion: 'VIDEO_SELF_CERTIFICATION_QUESTIONNAIRE_VERSION_15',
          },
        }
      }
      // Publish-to-subscriptions-feed & notify subscribers (the API path for this
      // is unreliable, so drive it here too when a choice was passed).
      if (typeof inj.notify === 'boolean') b.publishingOptions = { newPostToFeed: inj.notify }
      window.__mvpYtInjected = (window.__mvpYtInjected || 0) + 1
      return JSON.stringify(b)
    } catch (e) { return bodyStr }
  }

  // ── READ-BACK: what Studio says the video's settings ACTUALLY are ─────────
  //
  // Injection could only ever report whether the SAVE went out, never whether
  // the fields stuck, so a run ended on "Studio saved but SCOUT couldn't
  // confirm" and the creator was told to go and check four things by hand. That
  // is the whole reason this path felt unreliable: it usually worked and could
  // not say so.
  //
  // Studio's editor loads the video's current metadata, and that response
  // carries the real values. Captured here, so after a save we can reload and
  // read the truth instead of inferring it from our own request.
  //
  // Matched on the FIELD NAMES in the body rather than on an endpoint path.
  // YouTube renames these endpoints (the comment on isMetaUpdate says as much),
  // and a response that contains hasPaidProductPlacement is the response we
  // want whatever it is called today.
  const STATE_KEYS = {
    hasPaidProductPlacement: 'paidPromotion',
    creatorDisclosedHasAlteredContent: 'alteredContent',
    monetizeWithAds: 'monetize',
    questionnaireVersion: 'selfCertified',
  }
  const SNIFF = /hasPaidProductPlacement|creatorDisclosedHasAlteredContent|monetizeWithAds/

  const harvestState = (text, videoId) => {
    try {
      if (!text || !SNIFF.test(text)) return
      const json = JSON.parse(text)
      const found = {}
      const walk = (o, depth) => {
        if (!o || typeof o !== 'object' || depth > 14) return
        for (const k in o) {
          const as = STATE_KEYS[k]
          if (as !== undefined && found[as] === undefined) found[as] = o[k]
          const v = o[k]
          if (v && typeof v === 'object') walk(v, depth + 1)
        }
      }
      walk(json, 0)
      if (Object.keys(found).length === 0) return
      // Stamped with the id when the payload names one, so a read for a
      // DIFFERENT video can never be mistaken for confirmation of this one.
      window.__mvpYtState = Object.assign({ ts: Date.now(), videoId: videoId || null }, found)
    } catch (e) {}
  }

  const sniffIdFrom = (text) => {
    try { const m = /"encryptedVideoId"\s*:\s*"([A-Za-z0-9_-]{6,20})"/.exec(text); return m ? m[1] : null } catch (e) { return null }
  }

  const origFetch = window.fetch
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || ''
        const method = (init && init.method) || (input && input.method) || 'GET'
        let body = init && init.body
        if (looksLikeSave(url, method, body)) {
          emit({ via: 'fetch', url, method, headers: headersToObj(init && init.headers), body: typeof body === 'string' ? body : null, ts: Date.now() })
        }
        // Injection: rewrite Studio's own metadata_update body in flight.
        //
        // THE BODY IS NOT ALWAYS ON `init`. fetch(new Request(url, {body})) puts
        // it on the Request instead, and init is then undefined. The old check
        // required `typeof body === 'string'`, so that shape skipped injection
        // in silence: the save went out unmodified, the hook still counted it as
        // seen, and the caller reported the ambiguous "Studio saved but we could
        // not confirm". Whether Studio uses that shape varies by build, which is
        // exactly the sort of thing that makes this work on one day and not the
        // next. Both shapes are handled now.
        const isReq = typeof Request !== 'undefined' && input instanceof Request
        if (window.__mvpYtInject && isMetaUpdate(url) && /^post$/i.test(String(method))
            && (typeof body === 'string' || isReq)) {
          if (typeof body === 'string') {
            const merged = injectDisclosures(body)
            if (merged !== body) {
              const newInit = Object.assign({}, init, { body: merged })
              const p = origFetch.call(this, input, newInit)
              p.then((resp) => { try { window.__mvpYtInjectResp = { status: resp.status, injected: true } } catch (e) {} }).catch(() => {})
              return p
            }
          } else {
            // Reading a Request body consumes it, so clone first and rebuild the
            // Request from the merged text. Async, so this returns a promise
            // that resolves to the real response, which fetch callers accept.
            const self = this
            const args = arguments
            return (async () => {
              let merged = null
              let text = ''
              try { text = await input.clone().text() } catch (e) { text = '' }
              if (text) merged = injectDisclosures(text)
              if (!merged || merged === text) return origFetch.apply(self, args)
              const rebuilt = new Request(input, { body: merged })
              const resp = await origFetch.call(self, rebuilt)
              try { window.__mvpYtInjectResp = { status: resp.status, injected: true } } catch (e) {}
              return resp
            })()
          }
        }
        // Harvest the read-back from ANY youtubei response on this page. Cheap:
        // the clone is only read when the body mentions one of the fields.
        if (/\/youtubei\/v1\//.test(String(url))) {
          const p = origFetch.apply(this, arguments)
          p.then((resp) => {
            try {
              resp.clone().text().then((t) => { harvestState(t, sniffIdFrom(t)) }).catch(() => {})
            } catch (e) {}
          }).catch(() => {})
          return p
        }
      } catch (e) {}
      return origFetch.apply(this, arguments)
    }
  }

  try {
    const XO = XMLHttpRequest.prototype.open
    const XS = XMLHttpRequest.prototype.send
    const XH = XMLHttpRequest.prototype.setRequestHeader
    XMLHttpRequest.prototype.open = function (method, url) { try { this.__mvpYt = { method, url, headers: {} } } catch (e) {} return XO.apply(this, arguments) }
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (this.__mvpYt) this.__mvpYt.headers[k] = v } catch (e) {} return XH.apply(this, arguments) }
    XMLHttpRequest.prototype.send = function (body) {
      try {
        const m = this.__mvpYt
        if (m && looksLikeSave(m.url, m.method, body)) {
          emit({ via: 'xhr', url: m.url, method: m.method, headers: m.headers, body: typeof body === 'string' ? body : null, ts: Date.now() })
        }
        // Same read-back harvest on the XHR transport.
        if (m && /\/youtubei\/v1\//.test(String(m.url || ''))) {
          this.addEventListener('load', function () {
            try { const t = typeof this.responseText === 'string' ? this.responseText : ''; harvestState(t, sniffIdFrom(t)) } catch (e) {}
          })
        }
        // Injection: Studio sends metadata_update over XHR — rewrite the body.
        if (m && window.__mvpYtInject && isMetaUpdate(m.url) && typeof body === 'string') {
          const merged = injectDisclosures(body)
          if (merged !== body) {
            this.addEventListener('load', function () { try { window.__mvpYtInjectResp = { status: this.status, injected: true } } catch (e) {} })
            return XS.apply(this, [merged])
          }
        }
      } catch (e) {}
      return XS.apply(this, arguments)
    }
  } catch (e) {}
})()
