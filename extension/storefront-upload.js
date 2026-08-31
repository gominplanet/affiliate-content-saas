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

  const enc = new TextEncoder()
  const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
  const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s))
  async function hmac(key, msg) {
    const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
  }

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
    const html = document.documentElement.innerHTML

    const mSlate = html.match(/slateToken\s*[:=]\s*"?(?:Optional\[)?([A-Za-z0-9+/=]{40,})\]?"?/)
    if (mSlate) { out.slateToken = mSlate[1]; out.via.push('dom:slate') }

    out.csrf =
      document.querySelector('meta[name="anti-csrftoken-a2z"]')?.content ||
      document.querySelector('input[name="anti-csrftoken-a2z"]')?.value ||
      (html.match(/anti-?csrftoken-?a2z["'\s:=]+["']([^"']+)["']/i) || [])[1] || null
    if (out.csrf) out.via.push('dom:csrf')

    out.ownerAffiliateId =
      (html.match(/"(?:ownerAffiliateId|selectedRootAffiliateId|affiliateId)"\s*:\s*"([^"]+)"/) || [])[1] ||
      (location.search.match(/affiliateId=([^&]+)/) || [])[1] || null
    if (out.ownerAffiliateId) out.via.push('dom:owner')

    // Fallback / cross-marketplace: the SiteStripe render endpoint. Same-origin,
    // credentialed; the `scripts` field holds the amzn-ss-context block.
    if (!out.slateToken || !out.csrf) {
      try {
        const r = await fetch(`https://${location.host}/creators/links/render/ss?pageType=CreatorStudioZaphodUI`, { credentials: 'include' })
        if (r.ok) {
          const j = await r.json().catch(() => null)
          const blob = j && typeof j.scripts === 'string' ? j.scripts : ''
          if (!out.slateToken) { const m = blob.match(/slateToken:\s*"(?:Optional\[)?([^"\]]+)\]?"/); if (m) { out.slateToken = m[1]; out.via.push('render:slate') } }
          if (!out.csrf) { const m = blob.match(/csrfToken:\s*"([^"]+)"/); if (m) { out.csrf = m[1]; out.via.push('render:csrf') } }
          const ms = blob.match(/defaultStoreId:\s*"([^"]+)"/) || blob.match(/getDefaultStoreId:\s*function\s*\(\)\s*\{\s*return\s*"([^"]+)"/)
          if (ms) { out.storeId = ms[1]; out.via.push('render:store') }
        }
      } catch { /* ignore — reported via the slateToken guard below */ }
    }
    return out
  }

  // ── SigV4-sign + PUT bytes to the creator-studio S3 bucket ─────────────────
  async function s3Put(creds, key, bytes, contentType) {
    const host = `${creds.s3Bucket}.s3.${creds.s3BucketRegion}.amazonaws.com`
    const url = `https://${host}/${key}?x-id=PutObject`
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // 20260831T115841Z
    const dateStamp = amzDate.slice(0, 8)
    const region = creds.s3BucketRegion, service = 's3'
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-tagging'
    const canonicalHeaders =
      `content-type:${contentType}\n` +
      `host:${host}\n` +
      `x-amz-content-sha256:UNSIGNED-PAYLOAD\n` +
      `x-amz-date:${amzDate}\n` +
      `x-amz-security-token:${creds.awsSessionToken}\n` +
      `x-amz-tagging:temporary=true\n`
    const canonicalReq = ['PUT', `/${key.split('/').map(encodeURIComponent).join('/')}`, 'x-id=PutObject', canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n')
    const scope = `${dateStamp}/${region}/${service}/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonicalReq)].join('\n')
    let k = await hmac('AWS4' + creds.awsSecretAccessKey, dateStamp)
    k = await hmac(k, region); k = await hmac(k, service); k = await hmac(k, 'aws4_request')
    const signature = hex(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc.encode(stringToSign)))
    const auth = `AWS4-HMAC-SHA256 Credential=${creds.awsAccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    const res = await fetch(url, {
      method: 'PUT', body: bytes,
      headers: {
        'Content-Type': contentType,
        'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
        'x-amz-date': amzDate,
        'x-amz-security-token': creds.awsSessionToken,
        'x-amz-tagging': 'temporary=true',
        'Authorization': auth,
      },
      // Never hang the whole delivery on a stalled PUT — fail with a clear error.
      signal: AbortSignal.timeout(180000),
    })
    if (!res.ok) throw new Error(`S3 PUT ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
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

      // 2. fetch the media bytes (from MVP storage) and PUT to S3
      step = 'download-video'
      const vr = await fetch(job.videoUrl, { signal: AbortSignal.timeout(180000) })
      if (!vr.ok) throw new Error(`could not fetch the source video (${vr.status})`)
      const videoBytes = new Uint8Array(await vr.arrayBuffer())
      step = 'upload-video'
      const videoKey = `${creds.s3Folder}/${uuid()}.mp4`
      await s3Put(creds, videoKey, videoBytes, 'video/mp4')
      let thumbKey = null
      if (job.thumbnailUrl) {
        try {
          step = 'thumbnail'
          const tb = new Uint8Array(await (await fetch(job.thumbnailUrl, { signal: AbortSignal.timeout(60000) })).arrayBuffer())
          thumbKey = `${creds.s3Folder}/${uuid()}.png`
          await s3Put(creds, thumbKey, tb, 'image/png')
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
