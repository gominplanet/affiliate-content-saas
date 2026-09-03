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
        if (ready.length > 0) setFacePick(ready[0].id)
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
  //   2) A TEXT-FREE render of the same brief for non-English storefronts, run in
  //      parallel so it adds no wait. Not pixel-identical to #1 (a separate render),
  //      by design: the creator prefers the richer baked look for English.
  //   If #2 fails, the master builds its own clean variant, so nothing blocks.
  async function genThumbnail(titleArg?: string) {
    const t = (titleArg || chosenTitle || workingTitle || 'My video').trim()
    setThumbBusy(true)
    try {
      const call = (textMode: 'graphic' | 'clean', noHuman: boolean) => fetch('/api/youtube/generate-thumbnail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // textMode 'graphic' is REQUIRED to match Co-Pilot — the designed gpt-image
        // path at a clean 1280×720 with safe margins. 'clean' = same engine, zero text.
        body: JSON.stringify({
          videoTitle: t, asin: asinClean || undefined, textMode,
          // Quick style / Match a look / Fine-tune — the same fields Co-Pilot sends.
          ...boost.requestFields(),
          // The creator's pick: a specific saved face, or product-only.
          ...((noHuman || facePick === 'no-human') ? { noHuman: true } : { faceModelId: facePick }),
        }),
      })
      const pickUrl = (j: { thumbnailUrl?: string; thumbnailUrls?: string[] }): string | null =>
        j.thumbnailUrl || (Array.isArray(j.thumbnailUrls) ? j.thumbnailUrls[0] : null) || null

      // Kick off the text-free twin for non-English stores right away (best-effort).
      const cleanPromise: Promise<string | null> = (async () => {
        try {
          let r = await call('clean', false)
          let j = await r.json().catch(() => ({}))
          if (!r.ok && j?.needsFaceModel) { r = await call('clean', true); j = await r.json().catch(() => ({})) }
          return r.ok ? pickUrl(j) : null
        } catch { return null }
      })()

      // The main baked thumbnail. First try WITH the creator's own face; if they
      // have no saved face the route asks for one — Launchpad shouldn't hard-block
      // on that, so retry PRODUCT-ONLY so there's always something.
      let r = await call('graphic', false)
      let j = await r.json().catch(() => ({}))
      if (!r.ok && j?.needsFaceModel) { r = await call('graphic', true); j = await r.json().catch(() => ({})) }
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
          })
          const dOk = !finishDetails || !!fin.steps.find(s => s.step === 'details')?.ok
          const mStep = fin.steps.find(s => s.step === 'monetization')
          const mOk = !finishMonetize || !!mStep?.ok || !!mStep?.skipped
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
        body: JSON.stringify({ title: (chosenTitle || workingTitle || 'My video'), videoUrl: cleanUrl || renderedUrl, asin: asinClean, durationSec, thumbnailUrl: thumbUrl || undefined, thumbnailCleanUrl: thumbCleanUrl || undefined }),
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
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current) return
    const ytResolved = !!publishedUrl || ytOpen === 'skipped'
    if (!renderedUrl || !asinClean || !ytResolved || masterId || creatingMaster) return
    autoStarted.current = true
    void toStorefronts()
    // toStorefronts is a stable function declaration in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedUrl, asinClean, publishedUrl, ytOpen, masterId, creatingMaster])

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
  const s3: StepState = !renderedUrl ? 'locked' : (publishedUrl || ytOpen === 'skipped') ? 'done' : 'active'
  // Amazon waits for the YouTube step to be resolved (published or skipped), so
  // only ONE step is ever "active" — no more two purple nodes at once.
  const s4: StepState = !(renderedUrl && asinOk && s3 === 'done') ? 'locked' : masterId ? 'done' : 'active'
  const s5: StepState = !masterId ? 'locked' : ccAccepted ? 'done' : 'active'
  // Step 6 is a handoff (blog + social), so it's "active" once the video is on
  // its way to Amazon and never marks itself done here.
  const s6: StepState = !masterId ? 'locked' : 'active'

  return (
    <>
      <PageHero
        title="Video Launchpad"
        subtitle="Upload your edited video once. MVP finishes it with the Co-Pilot, publishes to YouTube (optional, CTA burned in), then takes the clean copy to your Amazon storefronts across every geo where the product sells, dubbed for non-English markets."
      />

      <div className="max-w-3xl pb-28">
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
        </StepRow>

        {/* 3. YouTube — optional */}
        <StepRow n={3} state={s3} last={false}
          icon={<Youtube size={15} style={{ color: '#FF0000' }} />}
          title={<>Publish to YouTube <span className="font-normal" style={muted}>(optional)</span></>}
          hint="Unlocks once your video is uploaded."
          actions={
            ytOpen === 'choose' ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setYtOpen('prepare'); if (!meta) void prepare() }} className="text-[12px] font-medium px-3 py-1.5 rounded-lg text-white" style={{ background: '#7C3AED' }}>Prepare & publish</button>
                <button type="button" onClick={() => setYtOpen('skipped')} className="text-[12px] underline" style={muted}>Skip YouTube</button>
              </div>
            ) : ytOpen === 'skipped' ? (
              <button type="button" onClick={() => setYtOpen('choose')} className="text-[12px] underline" style={muted}>Changed my mind</button>
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
                      <div>
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

                      {/* Thumbnail — AI-generated, the same engine the Co-Pilot uses */}
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="text-[12px] font-medium" style={muted}>Thumbnail</label>
                          <button type="button" onClick={() => void genThumbnail()} disabled={thumbBusy}
                            className="text-[11px] font-medium inline-flex items-center gap-1 disabled:opacity-50" style={{ color: '#7C3AED' }}>
                            {thumbBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} {thumbUrl ? 'Regenerate' : 'Generate'}
                          </button>
                        </div>
                        {/* One design, two thumbnails: with the headline (YouTube + English
                            stores) and the identical image with zero text (non-English stores). */}
                        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <div className="rounded-lg border overflow-hidden aspect-video flex items-center justify-center" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                              {thumbUrl
                                ? <img src={thumbUrl} alt="Thumbnail with headline" className="w-full h-full object-cover" />
                                : thumbBusy
                                  ? <span className="text-[12px] inline-flex items-center gap-1.5" style={muted}><Loader2 size={13} className="animate-spin" /> Designing…</span>
                                  : (
                                    // Nothing yet: set the style above, then generate on purpose.
                                    <button type="button" onClick={() => void genThumbnail()}
                                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: '#7C3AED' }}>
                                      <Sparkles size={15} /> Generate thumbnail
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
                        <p className="text-[11px] mt-1.5" style={muted}>The non-English one is a text-free render of the same design. Add a few selfies under Face Models to put yourself on it; otherwise MVP makes a clean product-only one. Custom thumbnails need a phone-verified YouTube channel; if yours isn&apos;t, the video still publishes with everything else.</p>
                      </div>

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
                            <a href={`https://studio.youtube.com/video/${publishedVideoId}/edit`} target="_blank" rel="noreferrer" className="underline font-medium">Open in Studio to schedule or go live</a>
                          )}
                          <a href={publishedUrl} target="_blank" rel="noreferrer" className="underline" style={muted}>watch page</a>
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
          </>
        </StepRow>

        {/* 4. Amazon storefronts — the uploaded file is the master */}
        <StepRow n={4} state={s4} last={false}
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
        <StepRow n={5} state={s5} last={false}
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
        <StepRow n={6} state={s6} last={true}
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
