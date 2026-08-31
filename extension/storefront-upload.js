/**
 * SCOUT — Amazon Creator Hub storefront video upload.
 *
 * Runs on https://www.amazon.com/create/* (and the international Creator Hubs).
 * Replays Amazon's OWN shoppable-video upload flow inside the creator's logged-in
 * session, driven by a job from the MVP app:
 *   1. GET  /create/api/path-and-credentials        → temp S3 creds + folder
 *   2. PUT  video (+ thumbnail) to S3                → SigV4, UNSIGNED-PAYLOAD
 *   3. POST /create/api/asins                        → validate our ASIN
 *   4. POST /create/api/check-content-quality        → moderation gate
 *   5. POST /create/api/shoppable-media              → PUBLISH (our title + ASIN)
 *
 * Tokens (slateToken, anti-csrftoken-a2z, ownerAffiliateId) are read from the
 * page. This is v1 — captured from a real upload; expect to iterate on token
 * sourcing / field names per marketplace.
 */
(function () {
  'use strict'
  if (window.__mvpStorefrontUploadLoaded) return
  window.__mvpStorefrontUploadLoaded = true

  // ── Read the Creator session context (slateToken, csrf, affiliate id) ───────
  // The Creator Hub embeds these in an `amzn-ss-context` config the page renders
  // as a JS object literal:  slateToken: "Optional[<token>]"  (UNquoted key, and
  // the value wrapped in Java's Optional[...] serialization). The old
  // /"slateToken":"..."/ scrape missed both the bare key and the wrapper, which
  // is why every marketplace reported "Could not read slateToken". We now match
  // that real shape, and fall back to the SiteStripe render endpoint — which
  // returns the SAME context in a `scripts` blob and exists on every marketplace
  // host — so a page whose DOM hasn't hydrated the token yet still resolves.
  async function readContext() {
    const out = { slateToken: null, csrf: null, ownerAffiliateId: null, storeId: null, via: [] }

    // 1. AUTHORITATIVE: the create app serializes its whole session into the
    //    #pageState element's data-page-state ATTRIBUTE as JSON — the slateToken
    //    the publish actually needs, plus the creator's rootAffiliateId. Read the
    //    attribute (getAttribute + JSON.parse), NOT innerHTML: serializing
    //    innerHTML escapes the attribute's quotes to &quot;, which is exactly why
    //    every earlier regex scrape missed this token.
    try {
      const raw = document.getElementById('pageState')?.getAttribute('data-page-state')
      if (raw) {
        const ps = JSON.parse(raw)
        if (ps && typeof ps.slateToken === 'string') { out.slateToken = ps.slateToken; out.via.push('pageState:slate') }
        const sf = (ps && (ps.defaultStorefront || (Array.isArray(ps.storefronts) ? ps.storefronts[0] : null))) || {}
        if (sf.rootAffiliateId) { out.ownerAffiliateId = sf.rootAffiliateId; out.via.push('pageState:owner') }
        if (sf.offsiteStoreId) out.storeId = sf.offsiteStoreId
      }
    } catch { /* fall through to the scrapes below */ }

    // 2. CSRF: the MAIN-world sniffer records the exact anti-csrftoken-a2z the
    //    create app sends on its own API calls. Amazon fires those on load; give
    //    it up to ~5s to appear.
    let sniffed = document.documentElement.getAttribute('data-mvp-a2z')
    for (let i = 0; !sniffed && i < 25; i++) { await new Promise(r => setTimeout(r, 200)); sniffed = document.documentElement.getAttribute('data-mvp-a2z') }
    if (sniffed) { out.csrf = sniffed; out.via.push('sniff:csrf') }

    // 3. Fallbacks if #pageState was absent (older Creator Hub) or the sniffer
    //    hadn't captured a token yet.
    if (!out.slateToken || !out.csrf || !out.ownerAffiliateId) {
      const html = document.documentElement.innerHTML
      if (!out.slateToken) {
        const m = html.match(/slateToken["'\s:=&quot;]+(?:Optional\[)?([A-Za-z0-9+/=]{60,})/)
        if (m) { out.slateToken = m[1]; out.via.push('dom:slate') }
      }
      if (!out.csrf) {
        out.csrf = document.querySelector('meta[name="anti-csrftoken-a2z"]')?.content ||
          document.querySelector('input[name="anti-csrftoken-a2z"]')?.value || null
        if (out.csrf) out.via.push('dom:csrf')
      }
      if (!out.ownerAffiliateId) {
        const m = html.match(/rootAffiliateId["'\s:=&quot;]+([A-Za-z0-9-]+)/) || html.match(/affiliateId=([^&"']+)/)
        if (m) { out.ownerAffiliateId = m[1]; out.via.push('dom:owner') }
      }
    }

    // 4. Last resort for slate/csrf: the SiteStripe render endpoint (its tokens
    //    are a different generation and may 403 the publish, but better than none).
    if (!out.slateToken || !out.csrf) {
      try {
        const r = await fetch(`https://${location.host}/creators/links/render/ss?pageType=CreatorStudioZaphodUI`, { credentials: 'include' })
        if (r.ok) {
          const j = await r.json().catch(() => null)
          const blob = j && typeof j.scripts === 'string' ? j.scripts : ''
          if (!out.slateToken) { const m = blob.match(/slateToken:\s*"(?:Optional\[)?([^"\]]+)\]?"/); if (m) { out.slateToken = m[1]; out.via.push('render:slate') } }
          if (!out.csrf) { const m = blob.match(/csrfToken:\s*"([^"]+)"/); if (m) { out.csrf = m[1]; out.via.push('render:csrf') } }
        }
      } catch { /* ignore — reported via the slateToken guard below */ }
    }
    return out
  }

  // Delegate the S3 upload to the background worker (host_permissions bypass the
  // CORS preflight that hangs a signed PUT made from this Amazon page). The
  // worker downloads the source and PUTs it, so large bytes never cross the
  // messaging boundary. Resolves on success, throws with the reason otherwise.
  function bgS3Put({ srcUrl, creds, key, contentType }) {
    return new Promise((resolve, reject) => {
      let settled = false
      // Longer than the worker's own step timeouts (download 120s + PUT 120s) so
      // its specific error surfaces instead of this blanket one; still under the
      // 300s per-job budget in deliverStorefronts.
      const to = setTimeout(() => { if (!settled) { settled = true; reject(new Error('no worker response (SW may have been killed)')) } }, 760000)
      chrome.runtime.sendMessage({ action: 'MVP_STOREFRONT_S3PUT', srcUrl, creds, key, contentType }, (resp) => {
        if (settled) return
        settled = true; clearTimeout(to)
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
        if (!resp || !resp.ok) return reject(new Error((resp && resp.error) || 'S3 PUT failed'))
        resolve(resp)
      })
    })
  }

  const api = (path, body, csrf) => fetch(`https://${location.host}/create/api/${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'anti-csrftoken-a2z': csrf } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })

  const uuid = () => crypto.randomUUID()

  // ── The full upload for ONE job ─────────────────────────────────────────────
  async function uploadOne(job) {
    const ctx = await readContext()
    if (!ctx.slateToken) {
      throw new Error(`Could not read your Creator session token. Sign in to Amazon and make sure this account is enrolled in the Creator/Influencer program for this marketplace, then retry. [ctx:${ctx.via.join('|') || 'none'}]`)
    }
    // csrf is best-effort: if we can't find the anti-csrftoken-a2z the publish
    // call will surface Amazon's own error, which is more precise than guessing.

    // Each step is labelled + time-boxed so a stalled call fails with a clear
    // "[step] …" message instead of running out the background clock as a bare
    // "timeout" (which is exactly what a signed-in-but-hung upload looked like).
    let step = 'session'
    try {
      // 1. temp S3 creds
      step = 'credentials'
      const credRes = await fetch(`https://${location.host}/create/api/path-and-credentials`, { credentials: 'include', signal: AbortSignal.timeout(30000) })
      if (!credRes.ok) throw new Error(`path-and-credentials ${credRes.status}`)
      const creds = await credRes.json()

      // 2. Upload media to S3 — via the BACKGROUND worker. A signed cross-origin
      //    PUT from this Amazon page triggers a CORS preflight that hangs
      //    ("[upload-video] timed out"); the service worker has host_permissions
      //    for *.amazonaws.com so its PUT skips the preflight. It also does the
      //    source download, so the bytes never transit through page messaging.
      step = 'upload-video'
      const videoKey = `${creds.s3Folder}/${uuid()}.mp4`
      await bgS3Put({ srcUrl: job.videoUrl, creds, key: videoKey, contentType: 'video/mp4' })
      let thumbKey = null
      if (job.thumbnailUrl) {
        try {
          step = 'thumbnail'
          const tKey = `${creds.s3Folder}/${uuid()}.png`
          await bgS3Put({ srcUrl: job.thumbnailUrl, creds, key: tKey, contentType: 'image/png' })
          thumbKey = tKey
        } catch { thumbKey = null }
      }

      // 3. validate our ASIN (non-fatal)
      if (job.asin) { try { await api('asins', { sourceType: 'REQUEST_BODY', slateToken: ctx.slateToken, asins: [job.asin] }, ctx.csrf) } catch { /* non-fatal */ } }

      // 4. moderation gate (non-fatal)
      try { await api('check-content-quality', { slateToken: ctx.slateToken, mediaUri: videoKey, mediaAci: null, mediaContentInDraft: false, contentType: 'SHOPPABLE_VIDEO' }, ctx.csrf) } catch { /* non-fatal */ }

      // 5. PUBLISH
      step = 'publish'
      return await publish(job, ctx, videoKey, thumbKey)
    } catch (e) {
      const msg = e && e.message ? e.message : String(e)
      const timedOut = /abort|timeout|signal/i.test(msg)
      throw new Error(`[${step}] ${timedOut ? 'timed out' : msg}`)
    }
  }

  async function publish(job, ctx, videoKey, thumbKey) {
    const pubRes = await api('shoppable-media', {
      contentType: 'SHOPPABLE_POST',
      mediaId: uuid(),
      shoppableMedias: [{
        type: 'video', uri: videoKey,
        ...(thumbKey ? { thumbnailUri: thumbKey } : {}),
        products: job.asin ? [{ asin: job.asin }] : [],
      }],
      textContent: '',
      titleContent: (job.title || '').slice(0, 120),
      interests: [], refTag: 'css', isDraftRequest: false,
      creationTypeData: { creationType: 'MANUALLY_CREATED' },
      slateToken: ctx.slateToken,
      ownerAffiliateId: ctx.ownerAffiliateId || job.ownerAffiliateId || '',
      optOutForGlobalizeAsinList: [], containsSyntheticPerformer: false,
    }, ctx.csrf)
    const pub = await pubRes.json().catch(() => ({}))
    if (!pubRes.ok || pub.hasError) throw new Error(pub.message || `shoppable-media ${pubRes.status}`)
    return { ok: true, mediaAci: pub.mediaAci || null }
  }

  // Is this a sign-in page? Amazon bounces an unauthenticated Creator Hub to
  // /ap/signin (or /ap/…). Used by the pre-flight to tell "not signed in" from
  // "signed in but not enrolled".
  function looksSignedOut() {
    return /\/ap\/signin|\/ap\/register|\/gp\/(?:sign-in|css\/homepage)/i.test(location.href) ||
      !!document.querySelector('form[name="signIn"], #ap_email, input[name="email"][type="email"]')
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    // Background asks us to run a job on this page.
    if (msg && msg.action === 'MVP_STOREFRONT_UPLOAD_ONE' && msg.job) {
      uploadOne(msg.job).then(r => sendResponse(r)).catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }))
      return true // async
    }
    // Pre-flight probe: report sign-in + Creator-session status without uploading.
    if (msg && msg.action === 'MVP_STOREFRONT_PROBE') {
      (async () => {
        const signedIn = !looksSignedOut()
        let ctx = {}
        try { ctx = await readContext() } catch { /* treat as no context */ }
        sendResponse({ ready: !!ctx.slateToken, signedIn, href: location.href, via: ctx.via || [] })
      })()
      return true // async
    }
  })
})()
