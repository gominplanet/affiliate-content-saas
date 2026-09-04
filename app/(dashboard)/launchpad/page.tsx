// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Launchpad — the origin pipeline for a video that is NOT on YouTube yet.
// Upload the file, design + burn a CTA, optionally publish to YouTube (or skip),
// then take the SAME uploaded video to every Amazon storefront: MVP uses the
// product ASIN to write each market's title and thumbnail, and dubs the video
// (generic voice free; the creator's own voice is the optional upgrade).
'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, Check, Youtube, Sparkles, Globe, Rocket, Handshake, Lock, Upload, Package } from 'lucide-react'
import { toast } from 'sonner'
import UploadStage from '@/components/launchpad/UploadStage'
import StorefrontStage from '@/components/launchpad/StorefrontStage'
import { requestStudioFinish, requestFindCampaign, requestAcceptCampaign, requestAmazonAsinCheck, requestResolveLocalAsin } from '@/lib/extension-frame'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { asinFromAmazonUrl } from '@/lib/product-link'
import ThumbnailBoostPanel, { useThumbnailBoost } from '@/components/thumbnails/ThumbnailBoostPanel'

const label = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

/** Accept a bare ASIN or any Amazon product link and return the clean 10-character
 *  code, or null. The input can hold whatever the creator pasted; everything
 *  downstream (thumbnail, geo-check, master, storefronts) gets the clean ASIN. */
function normalizeAsin(v: string): string | null {
  const s = (v || '').trim()
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase()
  return asinFromAmazonUrl(s)
}

interface Meta { title: string; alternatives: string[]; description: string; tags: string[] }

type StepState = 'done' | 'active' | 'locked'

/** One row of the vertical stepper: a status node + connecting spine on the left,
 *  a titled card on the right. Locked steps show a short "unlocks after" hint
 *  instead of their content, so the whole flow is visible up front. */
function StepRow({ n, title, icon, state, actions, hint, last, children }: {
  n: number
  title: ReactNode
  icon?: ReactNode
  state: StepState
  actions?: ReactNode
  hint?: string
  last?: boolean
  children?: ReactNode
}) {
  const done = state === 'done'
  const active = state === 'active'
  const locked = state === 'locked'
  return (
    <div className="flex gap-3.5">
      {/* Spine: node + connecting line */}
      <div className="flex flex-col items-center pt-0.5">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0"
          style={{
            background: done ? '#10B981' : active ? '#7C3AED' : 'transparent',
            color: done || active ? '#fff' : 'var(--text-3)',
            border: locked ? '1.5px solid var(--border-2)' : 'none',
            boxShadow: active ? '0 0 0 4px rgba(124,58,237,0.14)' : 'none',
          }}>
          {done ? <Check size={16} /> : locked ? <Lock size={13} /> : n}
        </div>
        {!last && <div className="w-px flex-1 mt-1.5" style={{ background: 'var(--border-2)', minHeight: 20 }} />}
      </div>
      {/* Content */}
      <div className={`flex-1 min-w-0 ${last ? '' : 'pb-5'}`}>
        <div className="card p-5" style={locked ? { opacity: 0.65 } : undefined}>
          <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginBottom: locked && !hint ? 0 : 12 }}>
            <h2 className="text-sm font-semibold inline-flex items-center gap-1.5" style={label}>{icon}{title}</h2>
            {!locked && actions}
          </div>
          {locked ? (hint ? <p className="text-[12px]" style={muted}>{hint}</p> : null) : children}
        </div>
      </div>
    </div>
  )
}

export default function LaunchpadPage() {
  // Launchpad (the upload-a-new-video origin pipeline) is Pro-only. Gate the whole
  // page up front so a lower tier sees the upgrade card instead of doing the work
  // and hitting a 403 at publish / storefronts. (YouTube publishing itself is NOT
  // Pro-only elsewhere — the Co-Pilot offers it to other tiers via a different
  // path — this gate is specifically the Launchpad flow.)
  const gateTier = useEffectiveTier()
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null)
  // The CLEAN uploaded video (no CTA). YouTube gets the CTA-burned render;
  // Amazon storefronts get this instead — the CTA is a YouTube-only overlay.
  const [cleanUrl, setCleanUrl] = useState<string | null>(null)
  const [workingTitle, setWorkingTitle] = useState('')
  const [durationSec, setDurationSec] = useState(0)
  const [asin, setAsin] = useState('')

  // YouTube (optional) — prepare metadata + publish, or skip.
  const [ytOpen, setYtOpen] = useState<'choose' | 'prepare' | 'skipped'>('choose')
  const [preparing, setPreparing] = useState(false)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [chosenTitle, setChosenTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [privacy, setPrivacy] = useState<'draft' | 'public'>('draft')
  const [publishing, setPublishing] = useState(false)
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)
  // The channel that owns the upload — needed for a Studio link that lands on the
  // right channel instead of erroring out.
  const [publishedChannelId, setPublishedChannelId] = useState<string | null>(null)
  // What the Studio finish actually managed to set. null = wasn't asked for.
  // Drives the honest "finish these by hand" checklist below the publish button.
  const [studioDone, setStudioDone] = useState<{ details: boolean | null; monetize: boolean | null } | null>(null)
  // The YouTube video id — used for the Studio deep link (schedule / go live).
  const [publishedVideoId, setPublishedVideoId] = useState<string | null>(null)
  // Full Co-Pilot finish: an AI thumbnail + the standard publish options, applied
  // to the uploaded video via /api/youtube/apply (same backend the Co-Pilot uses).
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  // A text-free render (same brief, zero words) for non-English storefronts.
  // Null → the master builds its own clean variant, so nothing blocks on it.
  const [thumbCleanUrl, setThumbCleanUrl] = useState<string | null>(null)
  // Who's on the thumbnail — the creator's saved faces (same picker as Co-Pilot).
  // 'no-human' = product-only. Defaults to the first ready face when they have one.
  const [faceModels, setFaceModels] = useState<Array<{ id: string; name: string }>>([])
  const [facePick, setFacePick] = useState<'no-human' | string>('no-human')
  // Set when a resumed session supplied the face, so the async face-model load
  // below can't land afterwards and overwrite the creator's actual choice.
  const facePickRestored = useRef(false)
  // The same thumbnail controls Co-Pilot has (Quick style, Match a look, Fine-tune),
  // sharing its remembered preferences. Question hook defaults ON here.
  const boost = useThumbnailBoost({ defaultQuestion: true })
  useEffect(() => {
    (async () => {
      try {
        const d = await fetch('/api/face-models').then(r => r.json()).catch(() => ({}))
        const ready = ((d?.models || []) as Array<{ id: string; name: string; status?: string }>)
          .filter(m => m.status === 'ready')
          .map(m => ({ id: m.id, name: m.name }))
        setFaceModels(ready)
        if (ready.length > 0 && !facePickRestored.current) setFacePick(ready[0].id)
      } catch { /* no faces → product-only */ }
    })()
  }, [])
  const [thumbBusy, setThumbBusy] = useState(false)
  const [notifySubs, setNotifySubs] = useState(false)   // never spam the bell by default
  const [madeForKids, setMadeForKids] = useState(false)
  const [embeddable, setEmbeddable] = useState(true)
  // Studio-injection extras (SCOUT drives Studio's signed save — the only path
  // YouTube honors for these). Same opt-ins the Co-Pilot offers.
  const [finishDetails, setFinishDetails] = useState(true)   // paid promotion + AI disclosure
  const [finishMonetize, setFinishMonetize] = useState(true) // monetization + ad rating

  // Amazon — the uploaded file becomes the master (no picker).
  const [creatingMaster, setCreatingMaster] = useState(false)
  const [masterId, setMasterId] = useState<string | null>(null)
  // Phase 1 geo research: where the product looks listed across the English geos.
  const [geoCheck, setGeoCheck] = useState<Array<{ domain: string; code: string; country: string; status: string; browser?: boolean; host?: string }> | null>(null)
  // Per-market LOCAL ASIN resolved by SCOUT when the product is relisted abroad
  // under a different code (keyed by domain). Passed to the storefront step.
  const [marketAsins, setMarketAsins] = useState<Record<string, string>>({})
  // Post-upload Creator Connections (US) step.
  const [ccFinding, setCcFinding] = useState(false)
  const [ccAccepting, setCcAccepting] = useState(false)
  const [ccAccepted, setCcAccepted] = useState(false)
  const [ccCampaign, setCcCampaign] = useState<{ found: boolean; detailsUrl: string | null; name: string | null; brand: string | null; commissionPct: number | null; status: string | null } | null>(null)

  // ── Resume after a reload ───────────────────────────────────────────────────
  // A Launchpad run spans a render, a YouTube publish and a storefront upload that
  // asks you to keep the tab open for many minutes. Holding all of that in page
  // memory meant one stray refresh, closed tab or crash threw the whole session
  // away and sent the creator back to re-uploading the video. The progress is
  // small (urls, ids and text), so it's mirrored to this browser and restored on
  // load. Cleared by "Start over".
  const LS_KEY = 'mvp_launchpad_session_v1'
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      const s = raw ? JSON.parse(raw) : null
      // Only a run that got as far as a rendered video is worth restoring.
      if (s && typeof s.renderedUrl === 'string' && s.renderedUrl) {
        setRenderedUrl(s.renderedUrl)
        if (s.cleanUrl) setCleanUrl(s.cleanUrl)
        if (s.workingTitle) setWorkingTitle(s.workingTitle)
        if (typeof s.durationSec === 'number') setDurationSec(s.durationSec)
        if (s.asin) setAsin(s.asin)
        if (s.ytOpen) setYtOpen(s.ytOpen)
        if (s.meta) setMeta(s.meta)
        if (s.chosenTitle) setChosenTitle(s.chosenTitle)
        if (s.description) setDescription(s.description)
        if (s.tags) setTags(s.tags)
        if (s.thumbUrl) setThumbUrl(s.thumbUrl)
        if (s.thumbCleanUrl) setThumbCleanUrl(s.thumbCleanUrl)
        if (s.facePick) { facePickRestored.current = true; setFacePick(s.facePick) }
        if (s.publishedUrl) setPublishedUrl(s.publishedUrl)
        if (s.publishedVideoId) setPublishedVideoId(s.publishedVideoId)
        if (s.publishedChannelId) setPublishedChannelId(s.publishedChannelId)
        if (s.studioDone) setStudioDone(s.studioDone)
        if (s.masterId) setMasterId(s.masterId)
        if (s.geoCheck) setGeoCheck(s.geoCheck)
        if (s.marketAsins) setMarketAsins(s.marketAsins)
        toast('Picked up where you left off. Start over is at the top if you want a clean run.')
      }
    } catch { /* a corrupt or blocked store just means no resume */ }
    setRestored(true)
  }, [])

  // Mirror progress as it changes. Never writes before the restore has run, so a
  // fresh mount can't blank a saved session.
  useEffect(() => {
    if (!restored || !renderedUrl) return
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        renderedUrl, cleanUrl, workingTitle, durationSec, asin, ytOpen, meta,
        chosenTitle, description, tags, thumbUrl, thumbCleanUrl, facePick,
        publishedUrl, publishedVideoId, publishedChannelId, studioDone,
        masterId, geoCheck, marketAsins, savedAt: Date.now(),
      }))
    } catch { /* private mode / quota — resume is a convenience, never a blocker */ }
  }, [restored, renderedUrl, cleanUrl, workingTitle, durationSec, asin, ytOpen, meta,
      chosenTitle, description, tags, thumbUrl, thumbCleanUrl, facePick,
      publishedUrl, publishedVideoId, publishedChannelId, studioDone,
      masterId, geoCheck, marketAsins])

  function startOver() {
    if (typeof window !== 'undefined' && !window.confirm('Start a new run? This clears the video, thumbnails and storefront progress on this page. Anything already published to YouTube or Amazon stays up.')) return
    try { localStorage.removeItem(LS_KEY); localStorage.removeItem('mvp_storefront_job_v1') } catch { /* ignore */ }
    window.location.reload()
  }

  async function prepare() {
    setPreparing(true)
    try {
      const r = await fetch('/api/youtube/generate-metadata', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoTitle: workingTitle || 'My video', asin: asinClean || undefined, skipAsinCheck: !asinClean }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.generated) throw new Error(j.error || 'Could not prepare the metadata')
      const g = j.generated as { title: string; description: string; tags: string[]; title_alternatives?: string[] }
      const m: Meta = { title: g.title, alternatives: g.title_alternatives || [], description: g.description, tags: g.tags || [] }
      setMeta(m); setChosenTitle(m.title); setDescription(m.description); setTags(m.tags.join(', '))
      toast.success('Metadata ready. Set your thumbnail style, then hit Generate.')
      // Deliberately NOT auto-generating the thumbnail here: it locked the style
      // controls before the creator could touch them. They pick face / Quick style /
      // look first, then press Generate.
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not prepare the metadata')
    } finally { setPreparing(false) }
  }

  // Generate an AI thumbnail from the chosen title + product ASIN (same route the
  // Co-Pilot uses). Non-fatal: a channel can still publish without one.
  // TWO thumbnails, both Art Director quality:
  //   1) The rich BAKED design (headline, callouts, banner) for YouTube + the
  //      English storefronts — textMode 'graphic', the same path the Co-Pilot uses.
  //   2) A TEXT-FREE thumbnail for non-English storefronts: the creator's SAME
  //      picked face next to the real product, zero words. Built by the storefront
  //      thumbnail recipe (not the text engine with the words removed, which kept
  //      dropping the person and shipping a product-only image). Runs in parallel so
  //      it adds no wait, and is not pixel-identical to #1 by design: the creator
  //      prefers the richer baked look for English.
  //   If #2 fails, the master builds its own clean variant, so nothing blocks.
  async function genThumbnail(titleArg?: string) {
    const t = (titleArg || chosenTitle || workingTitle || 'My video').trim()
    setThumbBusy(true)
    try {
      const call = (noHuman: boolean) => fetch('/api/youtube/generate-thumbnail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // textMode 'graphic' is REQUIRED to match Co-Pilot — the designed gpt-image
        // path at a clean 1280×720 with safe margins.
        body: JSON.stringify({
          videoTitle: t, asin: asinClean || undefined, textMode: 'graphic',
          // Quick style / Match a look / Fine-tune — the same fields Co-Pilot sends.
          ...boost.requestFields(),
          // The creator's pick: a specific saved face, or product-only.
          ...((noHuman || facePick === 'no-human') ? { noHuman: true } : { faceModelId: facePick }),
        }),
      })
      const pickUrl = (j: { thumbnailUrl?: string; thumbnailUrls?: string[] }): string | null =>
        j.thumbnailUrl || (Array.isArray(j.thumbnailUrls) ? j.thumbnailUrls[0] : null) || null

      // Kick off the text-free version for non-English stores right away, with the
      // same face the creator picked (best-effort).
      const cleanPromise: Promise<string | null> = (async () => {
        if (!asinClean) return null // the recipe needs the real product photos
        try {
          const r = await fetch('/api/launchpad/clean-thumbnail', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              asin: asinClean, title: t,
              ...(facePick === 'no-human' ? { noHuman: true } : { faceId: facePick }),
            }),
          })
          const j = await r.json().catch(() => ({}))
          return r.ok && typeof j.url === 'string' ? j.url : null
        } catch { return null }
      })()

      // The main baked thumbnail. First try WITH the creator's own face; if they
      // have no saved face the route asks for one — Launchpad shouldn't hard-block
      // on that, so retry PRODUCT-ONLY so there's always something.
      let r = await call(false)
      let j = await r.json().catch(() => ({}))
      if (!r.ok && j?.needsFaceModel) { r = await call(true); j = await r.json().catch(() => ({})) }
      const url = pickUrl(j)
      if (!r.ok || !url) throw new Error(j.error || 'Could not generate a thumbnail')
      setThumbUrl(url)

      const clean = await cleanPromise
      setThumbCleanUrl(clean) // null → the master generates its own text-free variant
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Thumbnail failed')
    } finally { setThumbBusy(false) }
  }

  async function publish() {
    if (!renderedUrl || !chosenTitle.trim()) return
    setPublishing(true)
    try {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean)
      // 1) Upload the render as a PRIVATE draft (metadata set here).
      const r = await fetch('/api/youtube/upload-video', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: renderedUrl, title: chosenTitle.trim(), description,
          tags: tagList, privacyStatus: 'private',
        }),
      })
      // Read the body as text first so a non-JSON error (a crash / 500 HTML page)
      // still surfaces its real content instead of a bare "Publish failed".
      const raw = await r.text().catch(() => '')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let j: any = {}
      try { j = raw ? JSON.parse(raw) : {} } catch { /* non-JSON response */ }
      if (j.notEnabled) { toast.error("Publishing to YouTube isn't switched on yet — Google is verifying our upload access."); return }
      if (j.reconnectRequired) { toast.error('Reconnect YouTube to grant upload permission, then try again.'); return }
      if (!r.ok || !j.videoId || !j.url) {
        const detail = j.error || (raw ? raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : '') || `HTTP ${r.status}`
        throw new Error(detail)
      }
      setPublishedUrl(j.url); setPublishedVideoId(String(j.videoId))
      if (typeof j.channelId === 'string' && j.channelId) setPublishedChannelId(j.channelId)

      // 2) Apply the finishing pass — thumbnail + publish options + final privacy —
      //    via the same route the Co-Pilot uses. Non-fatal: the video is already up,
      //    so any warning (e.g. thumbnail needs a verified channel) is surfaced but
      //    doesn't undo the publish.
      try {
        const ap = await fetch('/api/youtube/apply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId: j.videoId,
            title: chosenTitle.trim(), description, tags: tagList,
            thumbnailDataUri: thumbUrl || undefined,
            madeForKids, notifySubscribers: notifySubs, embeddable,
            privacyStatus: privacy === 'public' ? 'public' : 'private',
          }),
        })
        const aj = await ap.json().catch(() => ({}))
        if (Array.isArray(aj?.warnings) && aj.warnings.length > 0) toast.warning(aj.warnings.join(' '), { duration: 9000 })
      } catch { /* finishing pass is best-effort — the video is already published */ }

      // 3) Studio-only fields — paid promotion + AI-use answer + monetization +
      //    ad rating. YouTube's Data API can't set these, so SCOUT drives the real
      //    Studio controls in the creator's own session and lets Studio's own save
      //    persist them (the reliable path — same as the Co-Pilot). Notify
      //    subscribers is forced OFF. Best-effort: needs SCOUT + a Studio session.
      if (finishDetails || finishMonetize) {
        try {
          const fin = await requestStudioFinish(j.videoId, {
            details: finishDetails,
            monetize: finishMonetize,
            selfCert: finishMonetize,
            endScreen: false,
            notifySubscribers: false,
            channelId: typeof j.channelId === 'string' ? j.channelId : null,
          })
          const dOk = !finishDetails || !!fin.steps.find(s => s.step === 'details')?.ok
          const mStep = fin.steps.find(s => s.step === 'monetization')
          const mOk = !finishMonetize || !!mStep?.ok || !!mStep?.skipped
          // Record what ACTUALLY landed, so the step can show a finish-by-hand
          // checklist instead of a toast that disappears and overstates it.
          setStudioDone({ details: finishDetails ? dOk : null, monetize: finishMonetize ? mOk : null })
          if (dOk && mOk) toast.success('Studio set: paid promotion' + (finishMonetize ? ', monetization + ad rating' : '') + '.')
          else if (fin.error === 'not-installed') toast.warning('SCOUT isn’t installed, so the Studio fields (paid promotion / monetization) were skipped. Install SCOUT and re-run, or set them by hand in Studio.', { duration: 10000 })
          else toast.warning('Couldn’t set every Studio field automatically. Open the video in YouTube Studio to finish paid promotion / monetization.', { duration: 10000 })
        } catch { /* best-effort — the video is already published */ }
      }

      toast.success(privacy === 'public' ? 'Published to YouTube.' : 'Saved to YouTube as a private draft.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publish failed')
    } finally { setPublishing(false) }
  }

  async function toStorefronts() {
    if (!renderedUrl) { toast.error('Render your video first'); return }
    if (!asinClean) { toast.error('Enter a valid product ASIN (or paste the Amazon product link) first'); return }
    setCreatingMaster(true)
    try {
      const r = await fetch('/api/launchpad/master', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Storefronts get the CLEAN upload (no CTA). Fall back to the render
        // only if the clean URL is somehow missing, so the flow never blocks.
        // Seed the thumbnail we already generated so the storefront step doesn't
        // stall on "waiting for thumbnail".
        body: JSON.stringify({ title: (chosenTitle || workingTitle || 'My video'), videoUrl: cleanUrl || renderedUrl, asin: asinClean, durationSec, thumbnailUrl: thumbUrl || undefined, thumbnailCleanUrl: thumbCleanUrl || undefined,
          // Same face pick as the YouTube step, so any thumbnail the master still has
          // to render (e.g. when YouTube was skipped) features the same person.
          ...(facePick === 'no-human' ? { noHuman: true } : facePick ? { faceId: facePick } : {}) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.videoId) throw new Error(j.error || 'Could not set up the storefront sync')
      // Phase 1: research the four English marketplaces for this product BEFORE we
      // reveal the storefront step, so it opens pre-configured (found geos checked,
      // a badge on each). Best-effort — a blocked check just shows "Not confirmed"
      // and the creator decides.
      try {
        const gr = await fetch('/api/launchpad/geo-check', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asin: asinClean }),
        })
        const gj = await gr.json().catch(() => ({}))
        if (gj?.ok && Array.isArray(gj.geos)) {
          setGeoCheck(gj.geos)
          setMarketAsins({})
          const brand: string | null = gj.brand || null
          const title: string | null = gj.title || null
          // Background pass in the creator's own session:
          //  1) Keepa-less markets (e.g. Australia) are flagged browser:true —
          //     read the real /dp page to get a definitive listed/not-listed.
          //  2) For every market the product ISN'T listed in under the US ASIN,
          //     search that marketplace by brand+title for a confident LOCAL ASIN
          //     (products are often relisted abroad under a different code).
          void (async () => {
            const a = asinClean as string
            let intlPrompted = false
            const promptIntl = () => { if (!intlPrompted) { intlPrompted = true; toast.message('Turn on “International Amazon” in the SCOUT popup to confirm and match listings outside the US.') } }
            // 1) Browser existence checks. Mutate the local geo copy so step 2 sees
            //    the resolved status.
            for (const g of gj.geos.filter((x: { browser?: boolean; status: string }) => x.browser && x.status !== 'found')) {
              try {
                const chk = await requestAmazonAsinCheck(a, g.host || g.domain)
                if (chk.status === 'found' || chk.status === 'not-listed') {
                  g.status = chk.status
                  setGeoCheck(prev => prev ? prev.map(x => x.domain === g.domain ? { ...x, status: chk.status } : x) : prev)
                  fetch('/api/launchpad/geo-check', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cache: { asin: a, domain: g.domain, status: chk.status } }),
                  }).catch(() => {})
                } else if (chk.error === 'intl-permission-needed') promptIntl()
              } catch { /* leave "Not confirmed" */ }
            }
            // 2) Local-ASIN resolution for not-listed markets (needs the product's
            //    brand/title from Keepa; without them the creator pastes by hand).
            if (title) {
              for (const g of gj.geos.filter((x: { status: string }) => x.status === 'not-listed')) {
                try {
                  const res = await requestResolveLocalAsin({ brand, title, sourceAsin: a, domain: g.host || g.domain })
                  if (res.asin) setMarketAsins(prev => ({ ...prev, [g.domain]: res.asin! }))
                  else if (res.error === 'intl-permission-needed') promptIntl()
                } catch { /* creator can paste the local ASIN */ }
              }
            }
          })()
        }
      } catch { /* non-fatal */ }
      setMasterId(j.videoId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not set up the storefront sync')
    } finally { setCreatingMaster(false) }
  }

  // Look up a live US Creator Connections campaign for this product (SCOUT resolves
  // the ASIN → campaign in the creator's own session). Accept-only, no message.
  async function findCc() {
    setCcFinding(true)
    try {
      const r = await requestFindCampaign('', asinClean || '', null)
      if (!r.ok) {
        toast.error(r.error === 'not-installed' ? 'Install SCOUT to check Creator Connections.' : 'Could not check Creator Connections.')
        return
      }
      setCcCampaign({ found: !!r.found, detailsUrl: r.detailsUrl ?? null, name: r.campaignName ?? null, brand: r.brand ?? null, commissionPct: r.commissionPct ?? null, status: r.status ?? null })
      if (r.status === 'active') setCcAccepted(true) // already joined
    } catch { toast.error('Could not check Creator Connections.') }
    finally { setCcFinding(false) }
  }
  async function acceptCc() {
    if (!ccCampaign?.detailsUrl) return
    setCcAccepting(true)
    try {
      const r = await requestAcceptCampaign(ccCampaign.detailsUrl)
      if (r.ok || r.already) { setCcAccepted(true); toast.success(r.already ? 'Already accepted.' : 'Campaign accepted.') }
      else toast.error('Could not accept the campaign.')
    } catch { toast.error('Could not accept the campaign.') }
    finally { setCcAccepting(false) }
  }

  // The clean 10-character ASIN (from a bare code or a pasted product link).
  // Every downstream call uses this, never the raw input.
  const asinClean = normalizeAsin(asin)
  const asinOk = !!asinClean

  // Auto-start the Amazon step: the moment YouTube is resolved (published or
  // skipped) and the ASIN is valid, create the master + run the geo check so Step
  // 4 opens already populated instead of behind another button. Runs once.
  // The thumbnail headline is written from the video's title, and the storefronts
  // use that same title, so generate the metadata as soon as Step 3 is reachable
  // instead of waiting for the creator to open the YouTube step. Runs once.
  // Seconds spent writing the titles, so the wait after the ASIN is entered shows
  // real progress instead of looking like nothing is happening.
  const [prepElapsed, setPrepElapsed] = useState(0)
  useEffect(() => {
    if (!preparing) { setPrepElapsed(0); return }
    setPrepElapsed(0)
    const iv = setInterval(() => setPrepElapsed(s => s + 1), 1000)
    return () => clearInterval(iv)
  }, [preparing])

  const autoPrepared = useRef(false)
  useEffect(() => {
    if (!restored) return // never act on half-restored state
    if (autoPrepared.current || meta || preparing) return
    if (!renderedUrl || !asinClean) return
    autoPrepared.current = true
    void prepare()
    // prepare is a stable function declaration in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, renderedUrl, asinClean, meta, preparing])

  const autoStarted = useRef(false)
  useEffect(() => {
    if (!restored || autoStarted.current) return
    const ytResolved = !!publishedUrl || ytOpen === 'skipped'
    if (!renderedUrl || !asinClean || !ytResolved || masterId || creatingMaster) return
    autoStarted.current = true
    void toStorefronts()
    // toStorefronts is a stable function declaration in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, renderedUrl, asinClean, publishedUrl, ytOpen, masterId, creatingMaster])

  // ── Tier gate ──────────────────────────────────────────────────────────────
  if (gateTier !== null && !['pro', 'admin'].includes(gateTier)) {
    return (
      <FeatureLockedCard
        icon={<Rocket size={28} strokeWidth={1.8} />}
        feature="Video Launchpad"
        description="Start with a video that isn't on YouTube yet. Upload it once, add a CTA, and MVP takes it everywhere — YouTube (optional, with the full Co-Pilot finish), then every Amazon storefront, with each market's title localized and the video dubbed for non-English shoppers."
        bullets={[
          'One upload → YouTube + every Amazon geo',
          'AI thumbnail, metadata and the Co-Pilot publish finish',
          'Localized titles + a dub per non-English market',
          'Delivered through your own logged-in Amazon Creator account',
        ]}
        requiredTier="pro"
        currentTier={gateTier}
      />
    )
  }

  // Stepper states — every step is visible up front; locked ones show a hint so
  // the creator sees the whole journey without getting lost.
  const s1: StepState = renderedUrl ? 'done' : 'active'
  const s2: StepState = !renderedUrl ? 'locked' : asinOk ? 'done' : 'active'
  // Thumbnails stand on their own BEFORE YouTube, because Amazon needs them too:
  // a creator who skips YouTube still leaves this step with both images.
  const s3: StepState = !(renderedUrl && asinOk) ? 'locked' : thumbUrl ? 'done' : 'active'
  // YouTube opens as soon as the thumbnails are made. It never hard-blocks on
  // them (the master builds its own if you skip), so a done Step 3 isn't required.
  const s4: StepState = !renderedUrl ? 'locked' : (publishedUrl || ytOpen === 'skipped') ? 'done' : s3 === 'active' ? 'locked' : 'active'
  // Amazon waits for the YouTube step to be resolved (published or skipped), so
  // only ONE step is ever "active" — no more two purple nodes at once.
  const s5: StepState = !(renderedUrl && asinOk && s4 === 'done') ? 'locked' : masterId ? 'done' : 'active'
  const s6: StepState = !masterId ? 'locked' : ccAccepted ? 'done' : 'active'
  // The last step is a handoff (blog + social), so it's "active" once the video is
  // on its way to Amazon and never marks itself done here.
  const s7: StepState = !masterId ? 'locked' : 'active'

  return (
    <>
      <PageHero
        title="Video Launchpad"
        subtitle="Upload your edited video once. MVP finishes it with the Co-Pilot, publishes to YouTube (optional, CTA burned in), then takes the clean copy to your Amazon storefronts across every geo where the product sells, dubbed for non-English markets."
      />

      <div className="max-w-3xl pb-28">
        {/* Resumed runs need an obvious way out, or a half-finished session
            becomes a trap the creator can only escape by clearing site data. */}
        {renderedUrl && (
          <div className="flex justify-end mb-2">
            <button type="button" onClick={startOver} className="text-[12px] underline" style={muted}>
              Start over with a new video
            </button>
          </div>
        )}

        {/* 1. Upload + CTA */}
        <StepRow n={1} state={s1} last={false}
          icon={<Upload size={15} style={{ color: '#7C3AED' }} />}
          title="Upload your video & design the CTA">
          <UploadStage hidePublish onRendered={(url, title, sourceUrl, dur) => { setRenderedUrl(url); setCleanUrl(sourceUrl); setWorkingTitle(title); setDurationSec(dur || 0); if (!chosenTitle) setChosenTitle(title) }} />
        </StepRow>

        {/* 2. Product ASIN — required for titles + thumbnail */}
        <StepRow n={2} state={s2} last={false}
          icon={<Package size={15} style={{ color: '#7C3AED' }} />}
          title="Product ASIN"
          hint="Unlocks once your video is uploaded.">
          <input value={asin} onChange={e => setAsin(e.target.value)} placeholder="B0XXXXXXXX or a product link"
            className="w-full px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: asinOk ? 'var(--border)' : '#e0554b55', color: 'var(--text)' }} />
          <p className="text-[12px] mt-1.5" style={asin.trim() && !asinOk ? { color: '#e0554b' } : asinOk ? { color: '#10B981' } : muted}>
            {asin.trim() && !asinOk
              ? 'That doesn’t look right. Paste the 10-character ASIN (starts with B0…) or the Amazon product link.'
              : asinOk
                ? `Product ${asinClean}. MVP uses it for every market’s title and the thumbnail.`
                : 'Required. Paste the ASIN or the Amazon product link — MVP uses it for every market’s title and the thumbnail.'}
          </p>
          {/* Entering the ASIN kicks off the title writing, which gates the
              thumbnail step. Show it running with a live count so the pause reads
              as work in progress rather than a stuck screen. */}
          {asinOk && preparing && !meta && (
            <p className="text-[12px] mt-1.5 inline-flex items-center gap-1.5" style={{ color: '#7C3AED' }}>
              <Loader2 size={13} className="animate-spin" />
              Looking up the product and writing your titles… {prepElapsed}s <span style={muted}>(usually about 10 seconds, then Thumbnails unlocks)</span>
            </p>
          )}
        </StepRow>

        {/* 3. Thumbnails — BOTH of them, on their own, before YouTube. Amazon needs
            these just as much as YouTube does, so a creator who skips YouTube still
            leaves this step with a thumbnail for every storefront. */}
        <StepRow n={3} state={s3} last={false}
          icon={<Sparkles size={15} style={{ color: '#7C3AED' }} />}
          title="Thumbnails"
          hint="Unlocks once your video is uploaded and the ASIN is set."
          actions={thumbUrl ? (
            <button type="button" onClick={() => void genThumbnail()} disabled={thumbBusy}
              className="text-[12px] font-medium inline-flex items-center gap-1 disabled:opacity-50" style={{ color: '#7C3AED' }}>
              {thumbBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Regenerate
            </button>
          ) : undefined}>
          <>
            <p className="text-[12px] mb-3" style={muted}>MVP makes two: one with the headline for YouTube and the English stores, and a text-free one for the non-English stores. Both use your face and the real product. These go to Amazon whether or not you publish to YouTube.</p>
            {/* The headline is written from the title, so this step waits on it.
                Say so plainly, with a count, instead of showing dead controls. */}
            {!meta && preparing && (
              <p className="text-[12px] mb-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5" style={{ color: '#7C3AED', background: 'rgba(124,58,237,0.07)' }}>
                <Loader2 size={13} className="animate-spin" />
                Writing your title first… {prepElapsed}s <span style={muted}>Usually about 10 seconds. Pick your face and style now, they are ready to use.</span>
              </p>
            )}

            {/* Who's on the thumbnail — same picker as Co-Pilot. Changing it
                regenerates so the choice shows up right away. */}
            <div>
              <label className="text-[12px] font-medium" style={muted}>Who&apos;s on the thumbnail?</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {faceModels.map(m => (
                  <button key={m.id} type="button" disabled={thumbBusy}
                    onClick={() => { if (facePick === m.id) return; setFacePick(m.id); if (thumbUrl || thumbCleanUrl) void genThumbnail() }}
                    className="px-3 py-1 rounded-full text-[11px] font-semibold disabled:opacity-60"
                    style={facePick === m.id ? { background: '#FF9500', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                    {m.name}
                  </button>
                ))}
                <button type="button" disabled={thumbBusy}
                  onClick={() => { if (facePick === 'no-human') return; setFacePick('no-human'); if (thumbUrl || thumbCleanUrl) void genThumbnail() }}
                  className="px-3 py-1 rounded-full text-[11px] font-semibold disabled:opacity-60"
                  style={facePick === 'no-human' ? { background: '#3a3a3c', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                  No face
                </button>
              </div>
              {faceModels.length === 0 && (
                <p className="text-[11px] mt-1" style={muted}>No saved face yet. <a href="/photobooth" className="underline" style={{ color: '#7C3AED' }}>Add your selfies</a> to put yourself on the thumbnail.</p>
              )}
            </div>

            {/* Thumbnail style — the same controls as Co-Pilot (Quick style,
                Match a look, Fine-tune), sharing its remembered preferences. */}
            <div className="mt-3">
              <label className="text-[12px] font-medium" style={muted}>Thumbnail style</label>
              <div className="mt-1.5">
                {/* Stays editable while a render runs — changes apply on the
                    next Generate, so the creator is never locked out. */}
                <ThumbnailBoostPanel
                  boost={boost}
                  face={facePick !== 'no-human' ? (faceModels.find(m => m.id === facePick) || null) : null}
                />
              </div>
            </div>

            {/* One design, two thumbnails: with the headline (YouTube + English
                stores) and a text-free one (non-English stores). */}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <div className="rounded-lg border overflow-hidden aspect-video flex items-center justify-center" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                  {thumbUrl
                    ? <img src={thumbUrl} alt="Thumbnail with headline" className="w-full h-full object-cover" />
                    : thumbBusy
                      ? <span className="text-[12px] inline-flex items-center gap-1.5" style={muted}><Loader2 size={13} className="animate-spin" /> Designing…</span>
                      : (
                        // Nothing yet: set the style above, then generate on purpose.
                        // While the title is still being written the button says so
                        // and counts, rather than looking broken.
                        <button type="button" onClick={() => void genThumbnail()} disabled={!meta && preparing}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: '#7C3AED' }}>
                          {!meta && preparing
                            ? <><Loader2 size={15} className="animate-spin" /> Writing your title… {prepElapsed}s</>
                            : <><Sparkles size={15} /> Generate both thumbnails</>}
                        </button>
                      )}
                </div>
                <p className="text-[11px] mt-1 font-medium" style={label}>YouTube + English stores <span className="font-normal" style={muted}>(US, CA, UK, AU)</span></p>
              </div>
              <div>
                <div className="rounded-lg border overflow-hidden aspect-video flex items-center justify-center" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                  {thumbCleanUrl
                    ? <img src={thumbCleanUrl} alt="Thumbnail with no text" className="w-full h-full object-cover" />
                    : <span className="text-[12px]" style={muted}>{thumbBusy ? '…' : 'No thumbnail yet'}</span>}
                </div>
                <p className="text-[11px] mt-1 font-medium" style={label}>Non-English stores <span className="font-normal" style={muted}>(text-free version)</span></p>
              </div>
            </div>
            <p className="text-[11px] mt-1.5" style={muted}>Skip this if you like and MVP builds both for you when the video goes to Amazon. Custom thumbnails on YouTube need a phone-verified channel; if yours isn’t, the video still publishes with everything else.</p>
          </>
        </StepRow>

        {/* 4. YouTube — optional */}
        <StepRow n={4} state={s4} last={false}
          icon={<Youtube size={15} style={{ color: '#FF0000' }} />}
          title={<>Publish to YouTube <span className="font-normal" style={muted}>(optional)</span></>}
          hint="Unlocks once your thumbnails are made above."
          actions={
            ytOpen === 'choose' ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setYtOpen('prepare'); if (!meta) void prepare() }} className="text-[12px] font-medium px-3 py-1.5 rounded-lg text-white" style={{ background: '#7C3AED' }}>Prepare & publish</button>
                <button type="button" onClick={() => setYtOpen('skipped')} className="text-[12px] underline" style={muted}>Skip YouTube</button>
              </div>
            ) : ytOpen === 'skipped' ? (
              <button type="button" onClick={() => setYtOpen('choose')} className="text-[12px] underline" style={muted}>Changed my mind</button>
            ) : (ytOpen === 'prepare' && !publishedUrl && !publishing) ? (
              // Still available mid-prepare: a creator who opened the YouTube step and
              // changed their mind goes straight to Amazon (this kicks off the geo check).
              <button type="button" onClick={() => setYtOpen('skipped')} className="text-[12px] underline whitespace-nowrap" style={muted}>Skip YouTube, go to Amazon</button>
            ) : undefined
          }>
          <>
              {ytOpen === 'choose' && <p className="text-[12px]" style={muted}>Publish this video to YouTube with the CTA burned in, or skip straight to your Amazon storefronts.</p>}

              {ytOpen === 'skipped' && <p className="text-[12px]" style={muted}>Skipping YouTube. Your video goes straight to Amazon below.</p>}

              {ytOpen === 'prepare' && (
                <div className="space-y-3">
                  {!meta ? (
                    <div className="flex items-center gap-2 text-sm" style={muted}><Loader2 size={15} className="animate-spin" /> Co-Pilot is preparing your title, description and tags…</div>
                  ) : (
                    <>
                      <div>
                        <label className="text-[12px] font-medium" style={muted}>Title</label>
                        <input value={chosenTitle} onChange={e => setChosenTitle(e.target.value)} maxLength={100} className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
                        {meta.alternatives.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {[meta.title, ...meta.alternatives].slice(0, 5).map((t, i) => (
                              <button key={i} type="button" onClick={() => setChosenTitle(t)} className="text-[11px] px-2 py-1 rounded-lg border text-left" style={{ borderColor: chosenTitle === t ? '#7C3AED' : 'var(--border)', color: 'var(--text)' }}>{t.length > 48 ? `${t.slice(0, 48)}…` : t}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-[12px] font-medium" style={muted}>Description</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
                      </div>

                      {/* The thumbnail is made in Step 3 — shown here so the creator
                          can see what YouTube will get without leaving the step. */}
                      {thumbUrl && (
                        <div className="flex items-center gap-2.5">
                          <img src={thumbUrl} alt="Thumbnail" className="w-28 rounded-lg border" style={{ borderColor: 'var(--border)' }} />
                          <p className="text-[11px]" style={muted}>Your thumbnail from Step 3. <button type="button" onClick={() => void genThumbnail()} disabled={thumbBusy} className="underline disabled:opacity-50" style={{ color: '#7C3AED' }}>Regenerate</button></p>
                        </div>
                      )}

                      {/* Publish options — the Co-Pilot defaults */}
                      <div>
                        <label className="text-[12px] font-medium" style={muted}>Options</label>
                        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={label}>
                            <input type="checkbox" checked={notifySubs} onChange={e => setNotifySubs(e.target.checked)} className="accent-[#7C3AED] w-4 h-4" /> Notify subscribers
                          </label>
                          <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={label}>
                            <input type="checkbox" checked={embeddable} onChange={e => setEmbeddable(e.target.checked)} className="accent-[#7C3AED] w-4 h-4" /> Allow embedding
                          </label>
                          <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={label}>
                            <input type="checkbox" checked={madeForKids} onChange={e => setMadeForKids(e.target.checked)} className="accent-[#7C3AED] w-4 h-4" /> Made for kids
                          </label>
                        </div>
                        {/* Studio-injection extras — the same finish the Co-Pilot runs (via SCOUT). */}
                        <div className="mt-2 pt-2 space-y-1.5 border-t" style={{ borderColor: 'var(--border)' }}>
                          <label className="flex items-start gap-2 text-[13px] cursor-pointer" style={label}>
                            <input type="checkbox" checked={finishDetails} onChange={e => setFinishDetails(e.target.checked)} className="mt-0.5 accent-[#7C3AED] w-4 h-4 flex-shrink-0" />
                            <span>Set <strong>paid promotion</strong> + <strong>AI-use disclosure</strong> in Studio</span>
                          </label>
                          <label className="flex items-start gap-2 text-[13px] cursor-pointer" style={label}>
                            <input type="checkbox" checked={finishMonetize} onChange={e => setFinishMonetize(e.target.checked)} className="mt-0.5 accent-[#7C3AED] w-4 h-4 flex-shrink-0" />
                            <span>Turn on <strong>monetization</strong> + submit the <strong>ad-suitability rating</strong> <span style={muted}>(uncheck if this channel isn&apos;t monetized)</span></span>
                          </label>
                          <p className="text-[11px]" style={muted}>SCOUT drives these through YouTube Studio&apos;s own save (the only path YouTube honors); it needs SCOUT installed and a Studio session. End screens can&apos;t be automated, add one by hand in Studio.</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {(['draft', 'public'] as const).map(p => (
                          <button key={p} type="button" onClick={() => setPrivacy(p)} className="px-3 py-2 rounded-lg border text-sm font-medium" style={{ borderColor: privacy === p ? '#7C3AED' : 'var(--border)', borderWidth: privacy === p ? 2 : 1, color: 'var(--text)' }}>{p === 'draft' ? 'Private draft' : 'Public'}</button>
                        ))}
                        <button onClick={() => void publish()} disabled={publishing || !chosenTitle.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60" style={{ background: '#FF0000' }}>
                          {publishing ? <><Loader2 size={15} className="animate-spin" /> Publishing…</> : <><Youtube size={15} /> {privacy === 'public' ? 'Publish public' : 'Save as draft'}</>}
                        </button>
                      </div>
                      {publishedUrl && (
                        <p className="text-[13px] inline-flex items-center gap-1.5 flex-wrap" style={{ color: '#10B981' }}>
                          <Check size={14} /> Done.
                          {publishedVideoId && (
                            // Scope the link to the OWNING channel. A bare
                            // /video/<id>/edit opens under whatever channel Studio is
                            // currently on, and Studio throws a generic "something went
                            // wrong" until it resolves the right one.
                            <a href={publishedChannelId
                              ? `https://studio.youtube.com/channel/${publishedChannelId}/video/${publishedVideoId}/edit`
                              : `https://studio.youtube.com/video/${publishedVideoId}/edit`}
                              target="_blank" rel="noreferrer" className="underline font-medium">Open in Studio to schedule or go live</a>
                          )}
                          <a href={publishedUrl} target="_blank" rel="noreferrer" className="underline" style={muted}>watch page</a>
                        </p>
                      )}
                      {/* Finish in Studio. YouTube's API cannot set paid promotion or
                          the AI-use answer at all, so those only ever happen in Studio:
                          SCOUT drives them, and whatever it couldn't confirm is listed
                          here to do by hand. Never claim a field we didn't verify. */}
                      {publishedUrl && studioDone && (studioDone.details === false || studioDone.monetize === false) && (
                        <div className="rounded-lg border p-3" style={{ borderColor: '#d9770655', background: 'rgba(217,119,6,0.06)' }}>
                          <p className="text-[12px] font-medium mb-1" style={label}>Finish these in Studio</p>
                          <p className="text-[12px] mb-2" style={muted}>MVP could not confirm these, so check them yourself rather than trust it. Everything else (title, description, tags, thumbnail, privacy) is already set.</p>
                          <ul className="text-[12px] space-y-1 mb-2" style={muted}>
                            {studioDone.details === false && (
                              <li>Under <strong>Video details</strong>: tick <strong>Paid promotion</strong>, answer <strong>AI use</strong>, and untick <strong>Publish to subscriptions feed and notify subscribers</strong> if you don&apos;t want the bell.</li>
                            )}
                            {studioDone.monetize === false && (
                              <li>Under <strong>Monetization</strong>: turn it on and submit the <strong>ad-suitability rating</strong>.</li>
                            )}
                          </ul>
                          <a href={publishedChannelId
                            ? `https://studio.youtube.com/channel/${publishedChannelId}/video/${publishedVideoId}/edit`
                            : `https://studio.youtube.com/video/${publishedVideoId}/edit`}
                            target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg text-white" style={{ background: '#d97706' }}>
                            <Youtube size={13} /> Open the video in Studio
                          </a>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
          </>
        </StepRow>

        {/* 4. Amazon storefronts — the uploaded file is the master */}
        <StepRow n={5} state={s5} last={false}
          icon={<Globe size={15} style={{ color: '#0EA5A4' }} />}
          title="Amazon storefronts — every geo"
          hint="Unlocks after the ASIN is set and you’ve published to YouTube (or hit Skip) above.">
          <>
            <p className="text-[12px] mb-3" style={muted}>Your clean video (no CTA) goes to Amazon. MVP checks where this product is listed and pre-selects the English stores where it&apos;s found (US, Canada, UK, Australia). Non-English stores are optional: tick one and MVP adds a free dub in that language (or your own voice, with credits). Uploads run through your logged-in Amazon Creator account, so sign in to each store first.</p>
            {!masterId ? (
              <button onClick={() => void toStorefronts()} disabled={creatingMaster || !asinOk}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}>
                {creatingMaster ? <><Loader2 size={15} className="animate-spin" /> Checking markets…</> : <><Sparkles size={15} /> Continue to storefronts</>}
              </button>
            ) : (
              <StorefrontStage
                presetVideoId={masterId}
                presetAsin={asinClean || ''}
                allowedDomains={geoCheck ? geoCheck.map(g => g.domain) : ['amazon.com']}
                defaultChosen={geoCheck ? geoCheck.filter(g => g.status === 'found').map(g => g.domain) : ['amazon.com']}
                geoBadges={geoCheck ? Object.fromEntries(geoCheck.map(g => [g.domain, g.status === 'found' ? 'Product found' : g.status === 'not-listed' ? 'Not listed here' : 'Not confirmed'])) : undefined}
                marketAsins={marketAsins}
                presetThumbnailUrl={thumbUrl}
              />
            )}
          </>
        </StepRow>

        {/* 5. Creator Connections (US) — after the uploads, offer to accept a
            live US campaign for this product right here. */}
        <StepRow n={6} state={s6} last={false}
          icon={<Handshake size={15} style={{ color: '#7C3AED' }} />}
          title="Creator Connections (US)"
          hint="Unlocks once your video is on its way to your storefronts.">
          <>
            <p className="text-[12px] mb-3" style={muted}>See if this product has a live US Creator Connections campaign, and accept it right here to start earning the commission.</p>
            {!ccCampaign ? (
              <button onClick={() => void findCc()} disabled={ccFinding}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: '#7C3AED' }}>
                {ccFinding ? <><Loader2 size={15} className="animate-spin" /> Checking…</> : <><Handshake size={15} /> Check Creator Connections</>}
              </button>
            ) : ccCampaign.found ? (
              <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{ccCampaign.brand || ccCampaign.name || 'Live campaign'}</p>
                {ccCampaign.commissionPct != null && <p className="text-[12px]" style={muted}>{ccCampaign.commissionPct}% commission{ccCampaign.status === 'active' ? ' · already accepted' : ''}</p>}
                <div className="mt-2.5">
                  {ccAccepted ? (
                    <span className="inline-flex items-center gap-1 text-[13px] font-medium" style={{ color: '#10B981' }}><Check size={14} /> Accepted</span>
                  ) : (
                    <button onClick={() => void acceptCc()} disabled={ccAccepting || !ccCampaign.detailsUrl}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: '#7C3AED' }}>
                      {ccAccepting ? <><Loader2 size={15} className="animate-spin" /> Accepting…</> : <><Handshake size={15} /> Accept campaign</>}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[13px]" style={muted}>No live US Creator Connections campaign found for this product.</p>
            )}
          </>
        </StepRow>

        {/* 6. Blog + social — the natural end of the pipeline. The master video is
            now a row in youtube_videos, so the Blog Post Generator can turn it into
            a post and push it to socials; deep-link straight to that video. */}
        <StepRow n={7} state={s7} last={true}
          icon={<Sparkles size={15} style={{ color: '#7C3AED' }} />}
          title="Blog post & social push"
          hint="Unlocks once your video is on its way to your storefronts.">
          <>
            <p className="text-[12px] mb-3" style={muted}>Your video is live on YouTube and Amazon. Now turn it into a blog post and push it to your socials from the Blog Post Generator, with this video already selected.</p>
            <a href={`/content?tab=horizontal${masterId ? `&video=${encodeURIComponent(masterId)}` : ''}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: '#7C3AED' }}>
              <Sparkles size={15} /> Create the blog post &amp; social push
            </a>
          </>
        </StepRow>
      </div>
    </>
  )
}
