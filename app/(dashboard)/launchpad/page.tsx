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
import { Loader2, Check, Youtube, Sparkles, Globe } from 'lucide-react'
import { toast } from 'sonner'
import UploadStage from '@/components/launchpad/UploadStage'
import StorefrontStage from '@/components/launchpad/StorefrontStage'

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
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null)
  // The CLEAN uploaded video (no CTA). YouTube gets the CTA-burned render;
  // Amazon storefronts get this instead — the CTA is a YouTube-only overlay.
  const [cleanUrl, setCleanUrl] = useState<string | null>(null)
  const [workingTitle, setWorkingTitle] = useState('')
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

  // Amazon — the uploaded file becomes the master (no picker).
  const [creatingMaster, setCreatingMaster] = useState(false)
  const [masterId, setMasterId] = useState<string | null>(null)

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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not prepare the metadata')
    } finally { setPreparing(false) }
  }

  async function publish() {
    if (!renderedUrl || !chosenTitle.trim()) return
    setPublishing(true)
    try {
      const r = await fetch('/api/youtube/upload-video', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: renderedUrl, title: chosenTitle.trim(), description,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          privacyStatus: privacy === 'public' ? 'public' : 'private',
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (j.notEnabled) { toast.error("Publishing to YouTube isn't switched on yet — Google is verifying our upload access."); return }
      if (j.reconnectRequired) { toast.error('Reconnect YouTube to grant upload permission, then try again.'); return }
      if (!r.ok || !j.url) throw new Error(j.error || 'Publish failed')
      setPublishedUrl(j.url)
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
        body: JSON.stringify({ title: (chosenTitle || workingTitle || 'My video'), videoUrl: cleanUrl || renderedUrl, asin: asin.trim() }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.videoId) throw new Error(j.error || 'Could not set up the storefront sync')
      setMasterId(j.videoId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not set up the storefront sync')
    } finally { setCreatingMaster(false) }
  }

  const asinOk = asin.trim().length > 0

  return (
    <>
      <PageHero
        title="Launchpad"
        subtitle="Start with a video that isn't on YouTube yet. Upload it, add a CTA, and MVP takes it everywhere — YouTube (optional), then every Amazon storefront, dubbed for each market."
      />

      <div className="max-w-3xl space-y-5 pb-28">
        {/* 1. Upload + CTA */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3"><Num n={1} done={!!renderedUrl} /><h2 className="text-sm font-semibold" style={label}>Upload your video & design the CTA</h2></div>
          <UploadStage hidePublish onRendered={(url, title, sourceUrl) => { setRenderedUrl(url); setCleanUrl(sourceUrl); setWorkingTitle(title); if (!chosenTitle) setChosenTitle(title) }} />
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
              <div className="flex items-center gap-2 mb-1"><Num n={4} done={!!masterId} /><h2 className="text-sm font-semibold inline-flex items-center gap-1.5" style={label}><Globe size={15} style={{ color: '#0EA5A4' }} /> Amazon storefronts — US + every geo</h2></div>
              <p className="text-[12px] mb-3" style={muted}>Take the same video to Amazon. MVP matches the ASIN in each geo, writes titles in the local language, and dubs the video for non-English markets. Upload happens through your logged-in Amazon Creator account.</p>
              {!masterId ? (
                <button onClick={() => void toStorefronts()} disabled={creatingMaster || !asinOk}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}>
                  {creatingMaster ? <><Loader2 size={15} className="animate-spin" /> Setting up…</> : <><Sparkles size={15} /> Continue to storefronts</>}
                </button>
              ) : (
                <StorefrontStage presetVideoId={masterId} presetAsin={asin.trim()} />
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
