// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Launchpad — the origin pipeline for a video that is NOT on YouTube yet. One
// linear flow: upload the file, design + burn a CTA, let Co-Pilot prepare the
// YouTube metadata and thumbnail, publish (draft or public), then take it to
// Amazon — US first, then every geo storefront (localized, and dubbed in the
// creator's own voice for non-English markets).
//
// Creators whose video is already on YouTube use the individual tools
// (Co-Pilot, Blog, Clip Factory, Storefront Sync) directly — Launchpad is the
// "start from scratch" path.
'use client'

import { useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, Check, Youtube, Sparkles, Globe, Lock } from 'lucide-react'
import { toast } from 'sonner'
import UploadStage from '@/components/launchpad/UploadStage'
import StorefrontStage from '@/components/launchpad/StorefrontStage'

const label = { color: 'var(--fg)' } as const
const muted = { color: 'var(--fg-muted)' } as const

interface Meta { title: string; alternatives: string[]; description: string; tags: string[] }

function StepCard({ n, title, done, locked, children }: { n: number; title: string; done?: boolean; locked?: boolean; children: React.ReactNode }) {
  return (
    <div className="card p-5" style={{ opacity: locked ? 0.55 : 1 }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-bold text-white"
          style={{ background: done ? '#10B981' : locked ? 'var(--border)' : '#7C3AED' }}>
          {done ? <Check size={13} /> : locked ? <Lock size={12} /> : n}
        </span>
        <h2 className="text-sm font-semibold" style={label}>{title}</h2>
      </div>
      {children}
    </div>
  )
}

export default function LaunchpadPage() {
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null)
  const [workingTitle, setWorkingTitle] = useState('')

  // Step 3 — Co-Pilot YouTube prep.
  const [preparing, setPreparing] = useState(false)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [chosenTitle, setChosenTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')

  // Step 4 — publish.
  const [privacy, setPrivacy] = useState<'draft' | 'public'>('draft')
  const [publishing, setPublishing] = useState(false)
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)

  async function prepare() {
    if (!workingTitle) { toast.error('Render your video first'); return }
    setPreparing(true)
    try {
      const r = await fetch('/api/youtube/generate-metadata', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoTitle: workingTitle, skipAsinCheck: true }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.generated) throw new Error(j.error || 'Could not prepare the metadata')
      const g = j.generated as { title: string; description: string; tags: string[]; title_alternatives?: string[] }
      const m: Meta = { title: g.title, alternatives: g.title_alternatives || [], description: g.description, tags: g.tags || [] }
      setMeta(m); setChosenTitle(m.title); setDescription(m.description); setTags(m.tags.join(', '))
      toast.success('YouTube metadata ready. Review and publish.')
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

  return (
    <>
      <PageHero
        title="Launchpad"
        subtitle="Start with a video that isn't on YouTube yet. Upload it, add a CTA, and MVP takes it all the way — YouTube, then every Amazon storefront you sell in, dubbed in your own voice."
      />

      <div className="max-w-3xl space-y-5 pb-28">
        {/* 1 + 2. Upload + CTA */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-bold text-white" style={{ background: renderedUrl ? '#10B981' : '#7C3AED' }}>
              {renderedUrl ? <Check size={13} /> : '1'}
            </span>
            <h2 className="text-sm font-semibold" style={label}>Upload your video & design the CTA</h2>
          </div>
          <UploadStage hidePublish onRendered={(url, title) => { setRenderedUrl(url); setWorkingTitle(title); if (!chosenTitle) setChosenTitle(title) }} />
        </div>

        {/* 3. Co-Pilot YouTube prep */}
        <StepCard n={3} title="Prepare for YouTube (Co-Pilot)" done={!!meta} locked={!renderedUrl}>
          {!meta ? (
            <div>
              <p className="text-[12px] mb-3" style={muted}>Co-Pilot writes an optimized title (with alternatives), description and tags, and sets the right upload options (audience, made-for-kids off). Thumbnails finish in Co-Pilot once the video is up.</p>
              <button onClick={() => void prepare()} disabled={preparing || !renderedUrl}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#7C3AED,#C026D3)' }}>
                {preparing ? <><Loader2 size={15} className="animate-spin" /> Preparing…</> : <><Sparkles size={15} /> Prepare metadata</>}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-[12px] font-medium" style={muted}>Title (pick one or edit)</label>
                <input value={chosenTitle} onChange={e => setChosenTitle(e.target.value)} maxLength={100}
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }} />
                {meta.alternatives.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {[meta.title, ...meta.alternatives].slice(0, 5).map((t, i) => (
                      <button key={i} type="button" onClick={() => setChosenTitle(t)}
                        className="text-[11px] px-2 py-1 rounded-lg border text-left" style={{ borderColor: chosenTitle === t ? '#7C3AED' : 'var(--border)', color: 'var(--fg)' }}>
                        {t.length > 48 ? `${t.slice(0, 48)}…` : t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-[12px] font-medium" style={muted}>Description</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4}
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }} />
              </div>
              <div>
                <label className="text-[12px] font-medium" style={muted}>Tags (comma-separated)</label>
                <input value={tags} onChange={e => setTags(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }} />
              </div>
            </div>
          )}
        </StepCard>

        {/* 4. Publish */}
        <StepCard n={4} title="Publish to YouTube" done={!!publishedUrl} locked={!meta}>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {(['draft', 'public'] as const).map(p => (
              <button key={p} type="button" onClick={() => setPrivacy(p)}
                className="px-3 py-2 rounded-lg border text-sm font-medium"
                style={{ borderColor: privacy === p ? '#7C3AED' : 'var(--border)', borderWidth: privacy === p ? 2 : 1, color: 'var(--fg)' }}>
                {p === 'draft' ? 'Private draft' : 'Public'}
              </button>
            ))}
          </div>
          <button onClick={() => void publish()} disabled={publishing || !meta || !chosenTitle.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: '#FF0000' }}>
            {publishing ? <><Loader2 size={15} className="animate-spin" /> Publishing…</> : <><Youtube size={15} /> {privacy === 'public' ? 'Publish public' : 'Save as draft'}</>}
          </button>
          {publishedUrl && (
            <p className="text-[13px] mt-3 inline-flex items-center gap-1.5" style={{ color: '#10B981' }}>
              <Check size={14} /> Done. <a href={publishedUrl} target="_blank" rel="noreferrer" className="underline">Open on YouTube</a>
            </p>
          )}
        </StepCard>

        {/* 5-8. Amazon storefronts */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-bold text-white" style={{ background: '#0EA5A4' }}>
              <Globe size={13} />
            </span>
            <h2 className="text-sm font-semibold" style={label}>Amazon storefronts — US + every geo</h2>
          </div>
          <p className="text-[12px] mb-4" style={muted}>Take the same video to Amazon: US first, then MVP matches the ASIN in each geo, writes titles in the local language, and dubs the video in your own voice for non-English markets. Upload happens through your logged-in Amazon Creator account.</p>
          <StorefrontStage />
        </div>
      </div>
    </>
  )
}
