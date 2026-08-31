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

  // ── Read the page's session tokens ─────────────────────────────────────────
  function pageToken(re) {
    // Search inline scripts / html for a "name":"value" token.
    const html = document.documentElement.innerHTML
    const m = html.match(re)
    return m ? m[1] : null
  }
  function readContext() {
    const csrf =
      document.querySelector('meta[name="anti-csrftoken-a2z"]')?.content ||
      pageToken(/anti-?csrftoken-?a2z["'\s:=]+["']([^"']+)["']/i)
    const slateToken = pageToken(/"slateToken"\s*:\s*"([^"]+)"/)
    const ownerAffiliateId =
      pageToken(/"(?:ownerAffiliateId|selectedRootAffiliateId|affiliateId)"\s*:\s*"([^"]+)"/) ||
      (location.search.match(/affiliateId=([^&]+)/) || [])[1] || null
    return { csrf, slateToken, ownerAffiliateId }
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
    })
    if (!res.ok) throw new Error(`S3 PUT ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  }

  const api = (path, body, csrf) => fetch(`https://${location.host}/create/api/${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'anti-csrftoken-a2z': csrf } : {}) },
    body: JSON.stringify(body),
  })

  const uuid = () => crypto.randomUUID()

  // ── The full upload for ONE job ─────────────────────────────────────────────
  async function uploadOne(job) {
    const ctx = readContext()
    if (!ctx.slateToken) throw new Error('Could not read slateToken from the Creator Hub page — open the Create page and retry.')
    if (!ctx.csrf) throw new Error('Could not read the CSRF token from the page.')

    // 1. temp S3 creds
    const credRes = await fetch(`https://${location.host}/create/api/path-and-credentials`, { credentials: 'include' })
    if (!credRes.ok) throw new Error(`path-and-credentials ${credRes.status}`)
    const creds = await credRes.json()

    // 2. fetch the media bytes (from MVP storage) and PUT to S3
    const videoBytes = new Uint8Array(await (await fetch(job.videoUrl)).arrayBuffer())
    const videoKey = `${creds.s3Folder}/${uuid()}.mp4`
    await s3Put(creds, videoKey, videoBytes, 'video/mp4')
    let thumbKey = null
    if (job.thumbnailUrl) {
      try {
        const tb = new Uint8Array(await (await fetch(job.thumbnailUrl)).arrayBuffer())
        thumbKey = `${creds.s3Folder}/${uuid()}.png`
        await s3Put(creds, thumbKey, tb, 'image/png')
      } catch { thumbKey = null }
    }

    // 3. validate our ASIN
    if (job.asin) { try { await api('asins', { sourceType: 'REQUEST_BODY', slateToken: ctx.slateToken, asins: [job.asin] }, ctx.csrf) } catch { /* non-fatal */ } }

    // 4. moderation gate
    try { await api('check-content-quality', { slateToken: ctx.slateToken, mediaUri: videoKey, mediaAci: null, mediaContentInDraft: false, contentType: 'SHOPPABLE_VIDEO' }, ctx.csrf) } catch { /* non-fatal */ }

    // 5. PUBLISH
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

  // Background asks us to run a job on this page.
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg && msg.action === 'MVP_STOREFRONT_UPLOAD_ONE' && msg.job) {
      uploadOne(msg.job).then(r => sendResponse(r)).catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }))
      return true // async
    }
  })
})()
