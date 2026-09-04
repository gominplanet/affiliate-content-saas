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
      const to = setTimeout(() => { if (!settled) { settled = true; reject(new Error('no worker response (SW may have been killed)')) } }, 1300000)
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
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  // Normalize a title for duplicate comparison: lowercase, drop a trailing file
  // extension (manual uploads are named "Foo - B0XXXX.mp4"), collapse whitespace.
  function normTitle(s) {
    return String(s || '').toLowerCase().replace(/\.(mp4|mov|m4v|webm)\b/g, '').replace(/\s+/g, ' ').trim()
  }
  function titleTokens(s) {
    return normTitle(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  }
  // Word-set Jaccard similarity (0..1). Robust to the small wording differences a
  // re-generated translation can produce (e.g. "j'ai" vs "j'aie") while staying
  // low for genuinely different videos — MVP does NOT reliably write the exact
  // same title twice, so an exact match alone would miss real duplicates.
  function titleSimilar(a, b) {
    const A = new Set(titleTokens(a)), B = new Set(titleTokens(b))
    if (A.size === 0 || B.size === 0) return 0
    let inter = 0
    for (const x of A) if (B.has(x)) inter++
    return inter / (A.size + B.size - inter)
  }
  const DUP_SIMILARITY = 0.8

  // Is a video with this title already on THIS marketplace's storefront? Replays
  // the Creator Hub's own content-list call (same session) and matches the title
  // — the reliable signal, since the list doesn't expose duration. Best-effort:
  // any failure (CSRF, network, shape change) returns null so we never block a
  // legitimate upload. Returns the matching item or null.
  async function findDuplicateOnStorefront(ctx, job) {
    try {
      const want = normTitle(job.title)
      if (!want) return null
      const body = {
        pageSize: 50, startIndex: 0, contentState: 'LIVE',
        ownerAffiliateId: ctx.ownerAffiliateId || job.ownerAffiliateId || '',
        query: { filters: ['CONTENT_STATE', 'LAST_UPDATE'], sorts: ['LAST_UPDATE'] },
        orderingType: 'DECREASING', retrieveMetrics: false, globalizeStatus: 'notApplicable',
      }
      const r = await fetch(`https://${location.host}/manage-content/api/get-content-list`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(ctx.csrf ? { 'anti-csrftoken-a2z': ctx.csrf } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
      })
      if (!r.ok) return null
      const j = await r.json().catch(() => null)
      const list = j && Array.isArray(j.result) ? j.result : []
      for (const it of list) {
        const cd = it && it.contentDetail
        if (!cd || it.contentType !== 'VIDEO') continue
        const existing = cd.description || ''
        if (normTitle(existing) === want || titleSimilar(existing, job.title) >= DUP_SIMILARITY) {
          return { aci: cd.mediaACI || null, title: existing }
        }
      }
      return null
    } catch { return null }
  }

  // ── The full upload for ONE job ─────────────────────────────────────────────
  async function uploadOne(job) {
    const ctx = await readContext()
    if (!ctx.slateToken) {
      throw new Error(`Could not read your Creator session token. Sign in to Amazon and make sure this account is enrolled in the Creator/Influencer program for this marketplace, then retry. [ctx:${ctx.via.join('|') || 'none'}]`)
    }

    // Duplicate guard: if this marketplace already has a video with the same
    // title, skip rather than create a second copy. Opt out with job.dedupe:false.
    if (job.dedupe !== false && job.title) {
      const dup = await findDuplicateOnStorefront(ctx, job)
      if (dup) return { ok: false, duplicate: true, mediaAci: dup.aci, error: 'Already on this storefront' }
    }

    // csrf is best-effort: if we can't find the anti-csrftoken-a2z the publish
    // call will surface Amazon's own error, which is more precise than guessing.

    // Each step is labelled + time-boxed so a stalled call fails with a clear
    // "[step] …" message instead of running out the background clock as a bare
    // "timeout" (which is exactly what a signed-in-but-hung upload looked like).
    let step = 'session'
    try {
      // 1. temp S3 creds — retry on Amazon's transient 5xx (a 503 here is just
      //    the credential service briefly unavailable, common when several
      //    marketplaces ask at once).
      step = 'credentials'
      let creds = null
      for (let attempt = 0; attempt < 3; attempt++) {
        const credRes = await fetch(`https://${location.host}/create/api/path-and-credentials`, { credentials: 'include', signal: AbortSignal.timeout(30000) })
        if (credRes.ok) { creds = await credRes.json(); break }
        if (credRes.status >= 500 && attempt < 2) { await sleep(1500 * (attempt + 1)); continue }
        throw new Error(`path-and-credentials ${credRes.status}`)
      }
      if (!creds) throw new Error('path-and-credentials unavailable')

      // Diagnostic: record WHERE this marketplace wants the bytes, so we can see
      // whether every marketplace shares one bucket. If they do, a single upload
      // can be referenced by every market's publish instead of re-uploading the
      // whole video per store, which is what makes a 4-geo run take minutes.
      // Bucket / region / folder only. The credentials themselves are secrets and
      // are never recorded.
      try {
        chrome.runtime.sendMessage({
          action: 'MVP_STOREFRONT_CREATE_LOG',
          host: location.host,
          entry: {
            url: `${location.host}/create/api/path-and-credentials`, method: 'GET', status: 200,
            request: null, via: 'mvp',
            response: JSON.stringify({
              s3Bucket: creds.s3Bucket || null,
              s3BucketRegion: creds.s3BucketRegion || null,
              s3Folder: creds.s3Folder || null,
            }),
            ts: Date.now(),
          },
        })
      } catch (e) { /* diagnostics must never break an upload */ }

      // 2. Upload media to S3 — via the BACKGROUND worker. A signed cross-origin
      //    PUT from this Amazon page triggers a CORS preflight that hangs
      //    ("[upload-video] timed out"); the service worker has host_permissions
      //    for *.amazonaws.com so its PUT skips the preflight. It also does the
      //    source download, so the bytes never transit through page messaging.
      // Upload the branded thumbnail FIRST. It's tiny next to the video, so
      // doing it up front means a slow multi-minute video PUT can't starve it
      // (the earlier order let a strained/near-timeout video transfer swallow
      // the thumbnail, and the post published with Amazon's auto-frame instead).
      let thumbKey = null
      if (job.thumbnailUrl) {
        try {
          step = 'thumbnail'
          const tKey = `${creds.s3Folder}/${uuid()}.png`
          await bgS3Put({ srcUrl: job.thumbnailUrl, creds, key: tKey, contentType: 'image/png' })
          thumbKey = tKey
        } catch (e) {
          // Non-fatal, but never silent: without this the post ships with no
          // branded thumbnail and we'd have no idea why.
          try { console.error('[SCOUT] thumbnail upload failed:', e && e.message || e) } catch (_) {}
          thumbKey = null
        }
      }

      // Amazon's upload buckets are named per REGION, so marketplaces in the same
      // region share one. If this video already went into THIS bucket for another
      // market in this run, publish against that key instead of sending the whole
      // file again. Falls back to a real upload if the reuse is rejected later.
      step = 'upload-video'
      let videoKey = null
      let reusedKey = false
      try {
        // Time-boxed: a worker that never answers must not strand the upload. No
        // answer simply means no reuse, and we upload our own copy as before.
        const known = await new Promise((resolve) => {
          let settled = false
          const done = (v) => { if (!settled) { settled = true; resolve(v) } }
          setTimeout(() => done(null), 5000)
          chrome.runtime.sendMessage({ action: 'MVP_STOREFRONT_GETKEY', bucket: creds.s3Bucket, srcUrl: job.videoUrl }, (r) => {
            done(chrome.runtime.lastError ? null : (r && r.key) || null)
          })
        })
        if (known) { videoKey = known; reusedKey = true }
      } catch { /* fall through to a normal upload */ }

      if (!videoKey) {
        videoKey = `${creds.s3Folder}/${uuid()}.mp4`
        await bgS3Put({ srcUrl: job.videoUrl, creds, key: videoKey, contentType: 'video/mp4' })
        try { chrome.runtime.sendMessage({ action: 'MVP_STOREFRONT_PUTKEY', bucket: creds.s3Bucket, srcUrl: job.videoUrl, key: videoKey }) } catch { /* best-effort */ }
      }

      // 3. The PRODUCT. A shoppable video with no product tagged earns nothing,
      //    and Amazon won't let the creator fix it while the post is pending. So
      //    this is a hard gate now, not a best-effort call whose answer we threw
      //    away: no ASIN means no publish, and an ASIN this marketplace rejects
      //    means no publish either.
      step = 'product'
      if (!job.asin) {
        throw new Error('No product ASIN for this marketplace, so the video would publish with nothing tagged. Add this market’s local ASIN and retry.')
      }
      {
        let asinRes = null, asinRaw = ''
        try {
          asinRes = await api('asins', { sourceType: 'REQUEST_BODY', slateToken: ctx.slateToken, asins: [job.asin] }, ctx.csrf)
          asinRaw = await asinRes.text().catch(() => '')
        } catch (e) {
          throw new Error(`Could not check ASIN ${job.asin} on this marketplace: ${(e && e.message) || e}`)
        }
        // Record the answer so the exact shape can be read from a real run.
        try {
          chrome.runtime.sendMessage({
            action: 'MVP_STOREFRONT_CREATE_LOG', host: location.host,
            entry: {
              url: `${location.host}/create/api/asins`, method: 'POST', status: asinRes.status,
              request: JSON.stringify({ asins: [job.asin] }), response: asinRaw.slice(0, 2000),
              ts: Date.now(), via: 'mvp',
            },
          })
        } catch (e) { /* diagnostics must never block an upload */ }

        if (!asinRes.ok) throw new Error(`Amazon rejected ASIN ${job.asin} on this marketplace (${asinRes.status}). Paste this market's local ASIN and retry.`)
        let aj = null
        try { aj = asinRaw ? JSON.parse(asinRaw) : null } catch { /* unparseable — don't block on a shape we can't read */ }
        if (aj && aj.hasError === true) {
          throw new Error(`Amazon rejected ASIN ${job.asin} on this marketplace: ${aj.message || 'not available here'}. Paste this market's local ASIN and retry.`)
        }
        // When Amazon echoes back the products it resolved, ours has to be among
        // them. Only enforced when such a list is actually present, so an
        // unfamiliar response shape can never block a working upload.
        if (aj) {
          const lists = [aj.asins, aj.products, aj.validAsins, aj.result].filter(Array.isArray)
          if (lists.length > 0 && !JSON.stringify(lists).toUpperCase().includes(String(job.asin).toUpperCase())) {
            throw new Error(`ASIN ${job.asin} isn’t available on this marketplace, so the video would publish untagged. Paste this market’s local ASIN and retry.`)
          }
        }
      }

      // 4+5. moderation gate then PUBLISH — both keyed to the SAME mediaId (see
      //      publish(); they used to disagree, which Amazon rejects at validation).
      step = 'publish'
      try {
        return await publish(job, ctx, videoKey, thumbKey)
      } catch (e) {
        // Sharing a bucket doesn't guarantee Amazon accepts another marketplace's
        // key. If a reused key was refused, upload our own copy and publish again
        // so reuse can never make a market worse off than before.
        if (!reusedKey) throw e
        step = 'upload-video'
        const ownKey = `${creds.s3Folder}/${uuid()}.mp4`
        await bgS3Put({ srcUrl: job.videoUrl, creds, key: ownKey, contentType: 'video/mp4' })
        step = 'publish'
        return await publish(job, ctx, ownKey, thumbKey)
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e)
      const timedOut = /abort|timeout|signal/i.test(msg)
      throw new Error(`[${step}] ${timedOut ? 'timed out' : msg}`)
    }
  }

  async function publish(job, ctx, videoKey, thumbKey) {
    // Belt and braces with the gate in uploadOne: never create a shoppable post
    // with an empty products array. It cannot be fixed while Amazon has the post
    // in "pending", so an untagged video is worse than a failed upload.
    if (!job.asin) throw new Error('Refusing to publish: no product ASIN to tag on this video.')
    const body = (mediaId) => ({
      contentType: 'SHOPPABLE_POST',
      mediaId,
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
    })
    // Amazon's publish-time moderation is inconsistent: the identical title can
    // pass on one marketplace and trip a "text moderation issue" on another, and
    // it (plus 5xx / throttling) usually clears on a retry. Back off and retry a
    // couple of times with a fresh mediaId each attempt (a failed publish creates
    // nothing, so a new id avoids any "mediaId already exists" collision).
    let last = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      // ONE id per attempt, used for BOTH the quality check and the publish.
      // Amazon validates the publish against the media it quality-checked, so a
      // publish carrying an id Amazon has never seen fails validation — we used
      // to check with no id at all and then publish a fresh random one.
      const mediaId = uuid()

      // Moderation / quality gate. Its verdict is the real reason a publish gets
      // rejected, so keep it: swallowing it entirely is why a rejection surfaced
      // as an opaque validation error with nothing to act on.
      let qNote = ''
      try {
        const qRes = await api('check-content-quality', {
          slateToken: ctx.slateToken, mediaId, mediaUri: videoKey, mediaAci: null,
          mediaContentInDraft: false, contentType: 'SHOPPABLE_VIDEO',
        }, ctx.csrf)
        const qRaw = await qRes.text().catch(() => '')
        let q = {}
        try { q = qRaw ? JSON.parse(qRaw) : {} } catch { /* keep the raw text */ }
        if (!qRes.ok || (q && (q.hasError || q.isViolating === true))) {
          qNote = ` · quality(${qRes.status}): ${qRaw.slice(0, 200)}`
        }
      } catch { /* non-fatal — the publish below still reports what matters */ }

      const pubRes = await api('shoppable-media', body(mediaId), ctx.csrf)
      // Read the FULL answer, not just `.message`: Amazon's one-liner hides the
      // errorCode and field-level detail that separates an account gate (e.g. a
      // verification Amazon wants you to complete) from a bad payload.
      const raw = await pubRes.text().catch(() => '')
      let pub = {}
      try { pub = raw ? JSON.parse(raw) : {} } catch { /* keep the raw text */ }
      if (pubRes.ok && !pub.hasError) return { ok: true, mediaAci: pub.mediaAci || null }
      last = `${pub.message || `shoppable-media ${pubRes.status}`}${qNote} · amazon(${pubRes.status}): ${raw.slice(0, 300)}`
      const transient = pubRes.status >= 500 || /moderation|throttl|temporar|try again|timeout|rate limit|too many/i.test(last)
      if (transient && attempt < 2) { await sleep(3000 * (attempt + 1)); continue }
      break
    }
    throw new Error(last)
  }

  // Is this a sign-in page? Amazon bounces an unauthenticated Creator Hub to
  // /ap/signin (or /ap/…). Used by the pre-flight to tell "not signed in" from
  // "signed in but not enrolled".
  function looksSignedOut() {
    return /\/ap\/signin|\/ap\/register|\/gp\/(?:sign-in|css\/homepage)/i.test(location.href) ||
      !!document.querySelector('form[name="signIn"], #ap_email, input[name="email"][type="email"]')
  }

  // Relay the MAIN-world create-API capture (storefront-token-sniffer.js) to the
  // worker, so MVP can show what Amazon's own Creator Hub sends and we can diff
  // our publish against it. Diagnostic only.
  try {
    window.addEventListener('message', (ev) => {
      if (ev.source !== window) return
      const d = ev.data
      if (!d || d.__mvpCreateLog !== 1 || !d.entry) return
      try { chrome.runtime.sendMessage({ action: 'MVP_STOREFRONT_CREATE_LOG', entry: d.entry, host: location.host }) } catch (e) { /* worker asleep */ }
    })
  } catch (e) { /* ignore */ }

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
