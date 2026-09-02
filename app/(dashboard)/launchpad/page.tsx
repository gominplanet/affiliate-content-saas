// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Launchpad — the origin pipeline for a video that is NOT on YouTube yet.
// Upload the file, design + burn a CTA, optionally publish to YouTube (or skip),
// then take the SAME uploaded video to every Amazon storefront: MVP uses the
// product ASIN to write each market's title and thumbnail, and dubs the video
// (generic voice free; the creator's own voice is the optional upgrade).
'use client'

import { useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, Check, Youtube, Sparkles, Globe, Rocket, Handshake } from 'lucide-react'
import { toast } from 'sonner'
import UploadStage from '@/components/launchpad/UploadStage'
import StorefrontStage from '@/components/launchpad/StorefrontStage'
import { requestYtInjectDisclosures, requestFindCampaign, requestAcceptCampaign } from '@/lib/extension-frame'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { useEffectiveTier } from '@/lib/useEffectiveTier'

const label = { color: 'var(--fg)' } as const
const muted = { color: 'var(--fg-muted)' } as const

interface Meta { title: string; alternatives: string[]; description: string; tags: string[] }

function Num({ n, done }: { n: number | string; done?: boolean }) {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-bold text-white shrink-0"
      style={{ background: done ? '#10B981' : '#7C3AED' }}>{done ? <Check size={13} /> : n}</span>
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
  // Full Co-Pilot finish: an AI thumbnail + the standard publish options, applied
  // to the uploaded video via /api/youtube/apply (same backend the Co-Pilot uses).
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
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
  const [geoCheck, setGeoCheck] = useState<Array<{ domain: string; code: string; country: string; status: string }> | null>(null)
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
        body: JSON.stringify({ videoTitle: workingTitle || 'My video', asin: asin.trim() || undefined, skipAsinCheck: !asin.trim() }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.generated) throw new Error(j.error || 'Could not prepare the metadata')
      const g = j.generated as { title: string; description: string; tags: string[]; title_alternatives?: string[] }
      const m: Meta = { title: g.title, alternatives: g.title_alternatives || [], description: g.description, tags: g.tags || [] }
      setMeta(m); setChosenTitle(m.title); setDescription(m.description); setTags(m.tags.join(', '))
      toast.success('Metadata ready.')
      // Kick off the thumbnail right away so the YouTube step is a finished draft,
      // not just text — the same Co-Pilot treatment. Non-blocking.
      void genThumbnail(m.title)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not prepare the metadata')
    } finally { setPreparing(false) }
  }

  // Generate an AI thumbnail from the chosen title + product ASIN (same route the
  // Co-Pilot uses). Non-fatal: a channel can still publish without one.
  async function genThumbnail(titleArg?: string) {
    const t = (titleArg || chosenTitle || workingTitle || 'My video').trim()
    setThumbBusy(true)
    try {
      const call = (noHuman: boolean) => fetch('/api/youtube/generate-thumbnail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // textMode: 'graphic' is REQUIRED to match Co-Pilot — it routes through the
        // designed gpt-image path that downscales to a clean 1280×720 with safe
        // margins. Without it the route fell into a fallback that produced the wrong
        // dimensions and let the headline bleed off the frame.
        body: JSON.stringify({ videoTitle: t, asin: asin.trim() || undefined, textMode: 'graphic', ...(noHuman ? { noHuman: true } : {}) }),
      })
      // First try WITH the creator's own face (their saved selfies, if any). If
      // they haven't added any, the route asks to set up a Face Model — but
      // Launchpad shouldn't hard-block on that: retry as a clean PRODUCT-ONLY
      // thumbnail so there's always something. Selfies added later get used.
      let r = await call(false)
      let j = await r.json().catch(() => ({}))
      if (!r.ok && j?.needsFaceModel) { r = await call(true); j = await r.json().catch(() => ({})) }
      const url = j.thumbnailUrl || (Array.isArray(j.thumbnailUrls) ? j.thumbnailUrls[0] : null)
      if (!r.ok || !url) throw new Error(j.error || 'Could not generate a thumbnail')
      setThumbUrl(url)
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
      const j = await r.json().catch(() => ({}))
      if (j.notEnabled) { toast.error("Publishing to YouTube isn't switched on yet — Google is verifying our upload access."); return }
      if (j.reconnectRequired) { toast.error('Reconnect YouTube to grant upload permission, then try again.'); return }
      if (!r.ok || !j.videoId || !j.url) throw new Error(j.error || 'Publish failed')
      setPublishedUrl(j.url)

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

      // 3) Studio-injection extras — paid promotion + AI disclosure + monetization
      //    + ad rating. YouTube's Data API silently drops these, so SCOUT injects
      //    them into Studio's own signed save (same as the Co-Pilot). Best-effort:
      //    needs SCOUT installed and a YouTube Studio session.
      if (finishDetails || finishMonetize) {
        try {
          const inj = await requestYtInjectDisclosures(j.videoId, {
            paidPromotion: finishDetails,
            aiDisclosure: finishDetails,
            hasAlteredContent: false,
            monetize: finishMonetize,
            notify: notifySubs,
          })
          if (inj.ok) toast.success('Studio details set (paid promotion, AI disclosure' + (finishMonetize ? ', monetization + ad rating' : '') + ').')
          else if (inj.uncertain) toast.message('Studio save fired — confirm the details in YouTube Studio.', { duration: 9000 })
          else if (inj.error === 'not-installed') toast.warning('SCOUT isn’t installed, so the Studio details (paid promotion / monetization) were skipped. Install SCOUT and re-run, or set them by hand in Studio.', { duration: 10000 })
          else toast.warning('Couldn’t set the Studio details automatically: ' + (inj.detail || inj.error || 'unknown') + '. Set them by hand in YouTube Studio.', { duration: 10000 })
        } catch { /* injection is best-effort — the video is already published */ }
      }

      toast.success(privacy === 'public' ? 'Published to YouTube.' : 'Saved to YouTube as a private draft.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publish failed')
    } finally { setPublishing(false) }
  }

  async function toStorefronts() {
    if (!renderedUrl) { toast.error('Render your video first'); return }
    if (!asin.trim()) { toast.error('Enter the product ASIN first'); return }
    setCreatingMaster(true)
    try {
      const r = await fetch('/api/launchpad/master', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Storefronts get the CLEAN upload (no CTA). Fall back to the render
        // only if the clean URL is somehow missing, so the flow never blocks.
        body: JSON.stringify({ title: (chosenTitle || workingTitle || 'My video'), videoUrl: cleanUrl || renderedUrl, asin: asin.trim(), durationSec }),
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
          body: JSON.stringify({ asin: asin.trim() }),
        })
        const gj = await gr.json().catch(() => ({}))
        if (gj?.ok && Array.isArray(gj.geos)) setGeoCheck(gj.geos)
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
      const r = await requestFindCampaign('', asin.trim(), null)
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

  const asinOk = asin.trim().length > 0

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

  return (
    <>
      <PageHero
        title="Video Launchpad"
        subtitle="Upload your edited video once. MVP finishes it with the Co-Pilot, publishes to YouTube (optional, CTA burned in), then takes the clean copy to your Amazon storefronts across every geo where the product sells, dubbed for non-English markets."
      />

      <div className="max-w-3xl space-y-5 pb-28">
        {/* 1. Upload + CTA */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3"><Num n={1} done={!!renderedUrl} /><h2 className="text-sm font-semibold" style={label}>Upload your video & design the CTA</h2></div>
          <UploadStage hidePublish onRendered={(url, title, sourceUrl, dur) => { setRenderedUrl(url); setCleanUrl(sourceUrl); setWorkingTitle(title); setDurationSec(dur || 0); if (!chosenTitle) setChosenTitle(title) }} />
        </div>

        {renderedUrl && (
          <>
            {/* 2. Product ASIN — required for titles + thumbnail */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3"><Num n={2} done={asinOk} /><h2 className="text-sm font-semibold" style={label}>Product ASIN</h2></div>
              <input value={asin} onChange={e => setAsin(e.target.value)} placeholder="B0XXXXXXXX or a product link"
                className="w-full px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: asinOk ? 'var(--border)' : '#e0554b55', color: 'var(--fg)' }} />
              <p className="text-[12px] mt-1.5" style={muted}>Required. MVP uses the product to write every market&apos;s title and build the thumbnail, whether or not you publish to YouTube.</p>
            </div>

            {/* 3. YouTube — optional */}
            <div className="card p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div className="flex items-center gap-2"><Num n={3} done={!!publishedUrl || ytOpen === 'skipped'} /><h2 className="text-sm font-semibold" style={label}>Publish to YouTube <span className="font-normal" style={muted}>(optional)</span></h2></div>
                {ytOpen === 'choose' && (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => { setYtOpen('prepare'); if (!meta) void prepare() }} className="text-[12px] font-medium px-3 py-1.5 rounded-lg text-white" style={{ background: '#7C3AED' }}>Prepare & publish</button>
                    <button type="button" onClick={() => setYtOpen('skipped')} className="text-[12px] font-medium px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}>Skip</button>
                  </div>
                )}
                {ytOpen === 'skipped' && <button type="button" onClick={() => setYtOpen('choose')} className="text-[12px] underline" style={muted}>Changed my mind</button>}
              </div>

              {ytOpen === 'skipped' && <p className="text-[12px]" style={muted}>Skipping YouTube. Your video goes straight to Amazon below.</p>}

              {ytOpen === 'prepare' && (
                <div className="space-y-3">
                  {!meta ? (
                    <div className="flex items-center gap-2 text-sm" style={muted}><Loader2 size={15} className="animate-spin" /> Co-Pilot is preparing your title, description and tags…</div>
                  ) : (
                    <>
                      <div>
                        <label className="text-[12px] font-medium" style={muted}>Title</label>
                        <input value={chosenTitle} onChange={e => setChosenTitle(e.target.value)} maxLength={100} className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }} />
                        {meta.alternatives.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {[meta.title, ...meta.alternatives].slice(0, 5).map((t, i) => (
                              <button key={i} type="button" onClick={() => setChosenTitle(t)} className="text-[11px] px-2 py-1 rounded-lg border text-left" style={{ borderColor: chosenTitle === t ? '#7C3AED' : 'var(--border)', color: 'var(--fg)' }}>{t.length > 48 ? `${t.slice(0, 48)}…` : t}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-[12px] font-medium" style={muted}>Description</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }} />
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
                        <div className="mt-1 rounded-lg border overflow-hidden aspect-video flex items-center justify-center" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                          {thumbUrl
                            ? <img src={thumbUrl} alt="Generated thumbnail" className="w-full h-full object-cover" />
                            : <span className="text-[12px] inline-flex items-center gap-1.5" style={muted}>{thumbBusy ? <><Loader2 size={13} className="animate-spin" /> Designing your thumbnail…</> : 'No thumbnail yet'}</span>}
                        </div>
                        <p className="text-[11px] mt-1" style={muted}>Add a few selfies under Face Models to put yourself on the thumbnail; otherwise MVP makes a clean product-only one. Custom thumbnails need a phone-verified YouTube channel; if yours isn&apos;t, the video still publishes with everything else.</p>
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
                          <button key={p} type="button" onClick={() => setPrivacy(p)} className="px-3 py-2 rounded-lg border text-sm font-medium" style={{ borderColor: privacy === p ? '#7C3AED' : 'var(--border)', borderWidth: privacy === p ? 2 : 1, color: 'var(--fg)' }}>{p === 'draft' ? 'Private draft' : 'Public'}</button>
                        ))}
                        <button onClick={() => void publish()} disabled={publishing || !chosenTitle.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60" style={{ background: '#FF0000' }}>
                          {publishing ? <><Loader2 size={15} className="animate-spin" /> Publishing…</> : <><Youtube size={15} /> {privacy === 'public' ? 'Publish public' : 'Save as draft'}</>}
                        </button>
                      </div>
                      {publishedUrl && <p className="text-[13px] inline-flex items-center gap-1.5" style={{ color: '#10B981' }}><Check size={14} /> Done. <a href={publishedUrl} target="_blank" rel="noreferrer" className="underline">Open on YouTube</a></p>}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 4. Amazon storefronts — the uploaded file is the master */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-1"><Num n={4} done={!!masterId} /><h2 className="text-sm font-semibold inline-flex items-center gap-1.5" style={label}><Globe size={15} style={{ color: '#0EA5A4' }} /> Amazon storefronts — every geo</h2></div>
              <p className="text-[12px] mb-3" style={muted}>Take the same video (clean, no CTA) to Amazon. MVP checks where the product is listed across the English markets first (US, Canada, UK, Australia), then the rest (Germany, France, Spain, Italy, Japan). You pick which stores to upload to, and for non-English markets choose one dub option (upload as-is, a standard AI voice, or your own cloned voice with credits). Upload happens through your logged-in Amazon Creator account for each store.</p>
              {!masterId ? (
                <button onClick={() => void toStorefronts()} disabled={creatingMaster || !asinOk}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}>
                  {creatingMaster ? <><Loader2 size={15} className="animate-spin" /> Checking markets…</> : <><Sparkles size={15} /> Continue to storefronts</>}
                </button>
              ) : (
                <StorefrontStage
                  presetVideoId={masterId}
                  presetAsin={asin.trim()}
                  allowedDomains={geoCheck ? geoCheck.map(g => g.domain) : ['amazon.com']}
                  defaultChosen={geoCheck ? geoCheck.filter(g => g.status === 'found').map(g => g.domain) : ['amazon.com']}
                  geoBadges={geoCheck ? Object.fromEntries(geoCheck.map(g => [g.domain, g.status === 'found' ? 'Product found' : g.status === 'not-listed' ? 'Not listed here' : 'Not confirmed'])) : undefined}
                />
              )}
            </div>

            {/* 5. Creator Connections (US) — after the uploads, offer to accept a
                live US campaign for this product right here. */}
            {masterId && (
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-1"><Num n={5} done={ccAccepted} /><h2 className="text-sm font-semibold inline-flex items-center gap-1.5" style={label}><Handshake size={15} style={{ color: '#7C3AED' }} /> Creator Connections (US)</h2></div>
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
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
