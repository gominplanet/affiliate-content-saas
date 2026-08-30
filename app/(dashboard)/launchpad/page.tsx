// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Launchpad — one video, everywhere. The single place a creator takes a finished
// video and gets it out: ready for YouTube (metadata, thumbnail, optional CTA
// burn-in + publish), turned into a blog post and social pushes and a short, and
// distributed to every Amazon storefront they sell in (localized and dubbed in
// their own voice). Every stage also exists on its own page for granular use;
// Launchpad just runs them from one screen.
'use client'

import { useEffect, useState, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { createBrowserClient } from '@/lib/supabase/client'
import { Rocket, Check, Loader2, Circle, ExternalLink, Youtube, Upload, Globe } from 'lucide-react'
import { toast } from 'sonner'
import UploadStage from '@/components/launchpad/UploadStage'
import StorefrontStage from '@/components/launchpad/StorefrontStage'

// Networks the blog job can auto-post to (the runner skips any not connected).
const SOCIAL_KEYS = ['twitter', 'facebook', 'threads', 'linkedin', 'bluesky', 'pinterest', 'telegram']
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Vid { id: string; youtube_video_id: string | null; title: string; thumbnail_url: string | null; duration_seconds: number | null }
type StepState = 'idle' | 'running' | 'done' | 'error' | 'skipped'
interface Step { key: string; label: string; desc: string; on: boolean; state: StepState; note?: string }

const DEFAULT_STEPS: Step[] = [
  { key: 'metadata', label: 'YouTube metadata + thumbnail', desc: 'Optimized title, description, tags and a CTR-tested thumbnail.', on: true, state: 'idle' },
  { key: 'blog', label: 'Blog post', desc: 'A full SEO review on your site, in your voice.', on: true, state: 'idle' },
  { key: 'social', label: 'Social posts', desc: 'Fan out to your connected networks.', on: true, state: 'idle' },
  { key: 'short', label: 'Short for TikTok & Instagram', desc: 'A vertical short cut from the video.', on: true, state: 'idle' },
]

const label = { color: 'var(--fg)' } as const
const muted = { color: 'var(--fg-muted)' } as const

export default function LaunchpadPage() {
  const [mode, setMode] = useState<'synced' | 'file'>('synced')
  const [videos, setVideos] = useState<Vid[]>([])
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<string | null>(null)
  const [steps, setSteps] = useState<Step[]>(DEFAULT_STEPS)
  const [running, setRunning] = useState(false)
  const [showStorefront, setShowStorefront] = useState(false)

  const load = useCallback(async () => {
    try {
      const sb = createBrowserClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { setLoading(false); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (sb as any)
        .from('youtube_videos')
        .select('id,youtube_video_id,title,thumbnail_url,duration_seconds')
        .eq('user_id', user.id)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(24)
      setVideos(Array.isArray(data) ? data : [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const toggle = (key: string) => setSteps(s => s.map(st => st.key === key ? { ...st, on: !st.on } : st))
  const setState = (key: string, state: StepState, note?: string) =>
    setSteps(s => s.map(st => st.key === key ? { ...st, state, note } : st))

  const vid = videos.find(v => v.id === picked) || null

  async function launch() {
    if (!vid) { toast.error('Pick a video first'); return }
    setRunning(true)
    setSteps(s => s.map(st => ({ ...st, state: st.on ? 'idle' : 'skipped', note: undefined })))
    try {
      // 1. Co-Pilot: metadata, then the thumbnail (both ground on the YouTube id).
      if (steps.find(s => s.key === 'metadata')?.on) {
        setState('metadata', 'running')
        try {
          const rm = await fetch('/api/youtube/generate-metadata', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ youtubeVideoId: vid.youtube_video_id, videoTitle: vid.title, videoDescription: '' }),
          })
          setState('metadata', 'running', 'Designing the thumbnail…')
          let thumbOk = false
          try {
            const rt = await fetch('/api/youtube/generate-thumbnail', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ videoTitle: vid.title, youtubeVideoId: vid.youtube_video_id, videoDescription: '' }),
            })
            thumbOk = rt.ok
          } catch { /* thumbnail is best-effort */ }
          if (!rm.ok) setState('metadata', 'error', 'Could not generate metadata')
          else setState('metadata', 'done', thumbOk ? undefined : 'Metadata done. Thumbnail needs a retry in Co-Pilot.')
        } catch { setState('metadata', 'error', 'Could not generate metadata') }
      }
      // 2 + 3. Blog + social run in ONE real generation job.
      const wantBlog = !!steps.find(s => s.key === 'blog')?.on
      const wantSocial = !!steps.find(s => s.key === 'social')?.on
      if (wantBlog || wantSocial) {
        setState('blog', 'running')
        if (wantSocial) setState('social', 'running')
        try {
          const enq = await fetch('/api/blog/enqueue', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoId: vid.id, includeImages: true, autoSocials: wantSocial ? SOCIAL_KEYS : [] }),
          })
          const ej = await enq.json().catch(() => ({}))
          if (!enq.ok || !ej.jobId) throw new Error(ej.error || 'Could not queue the post')
          let done = false
          for (let i = 0; i < 75 && !done; i++) {
            await sleep(4000)
            const jr = await fetch(`/api/blog/job/${ej.jobId}`)
            const jj = await jr.json().catch(() => ({}))
            if (jj.stage) setState('blog', 'running', String(jj.stage))
            if (jj.status === 'done') {
              setState('blog', 'done'); if (wantSocial) setState('social', 'done'); done = true
            } else if (jj.status === 'failed') {
              setState('blog', 'error', jj.error || 'Post failed'); if (wantSocial) setState('social', 'error'); done = true
            }
          }
          if (!done) { setState('blog', 'error', 'Still running — check the Blog Post Generator'); if (wantSocial) setState('social', 'error') }
        } catch (e) {
          setState('blog', 'error', e instanceof Error ? e.message : 'Post failed'); if (wantSocial) setState('social', 'error')
        }
      }
      // 4. Short — plan the best moments, then render the top clip.
      if (steps.find(s => s.key === 'short')?.on) {
        setState('short', 'running', 'Finding the best moment…')
        try {
          const rp = await fetch('/api/youtube/shorts/plan', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoId: vid.id, count: 3 }),
          })
          const pj = await rp.json().catch(() => ({}))
          if (!rp.ok || !Array.isArray(pj.shorts) || pj.shorts.length === 0) {
            const why = pj.noTranscript ? 'No transcript yet — open Clip Factory to add one.'
              : pj.noClips ? 'No strong Short-worthy moments in this video.'
              : (pj.error || 'Open Clip Factory to cut a short.')
            setState('short', 'skipped', why)
          } else {
            const topId = pj.shorts[0]?.id
            setState('short', 'running', 'Rendering your Short…')
            const rr = await fetch('/api/youtube/shorts/render', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ shortId: topId }),
            })
            const rj = await rr.json().catch(() => ({}))
            if (rr.ok && rj.ok) {
              setState('short', 'done', `${pj.shorts.length} moments planned. Top Short rendered — finish the rest in Clip Factory.`)
            } else if (rj.needsUpload) {
              setState('short', 'done', `${pj.shorts.length} moments planned. Upload the source in Clip Factory to render.`)
            } else {
              setState('short', 'done', `${pj.shorts.length} moments planned — render them in Clip Factory.`)
            }
          }
        } catch { setState('short', 'skipped', 'Open Clip Factory to cut a short.') }
      }
      toast.success('Launchpad run finished')
      setShowStorefront(true)
    } finally { setRunning(false) }
  }

  const StateIcon = ({ s }: { s: StepState }) =>
    s === 'running' ? <Loader2 size={15} className="animate-spin text-[#7C3AED]" />
    : s === 'done' ? <Check size={15} className="text-[#10B981]" />
    : s === 'error' ? <span className="text-[#e0554b] text-xs font-bold">!</span>
    : s === 'skipped' ? <Circle size={14} className="text-[#c9c2d6]" />
    : <Circle size={14} style={{ color: 'var(--border)' }} />

  return (
    <>
      <PageHero
        title="Launchpad"
        subtitle="One video, everywhere. Get it ready for YouTube, turn it into a blog, socials and a short, and push it to every Amazon storefront you sell in — from one screen."
      />

      <div className="max-w-4xl space-y-6 pb-28">
        {/* 1. Start with your video */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="text-sm font-semibold" style={label}>1. Start with your video</h2>
            <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <button type="button" onClick={() => setMode('synced')}
                className="px-3 py-1.5 text-[12px] font-medium inline-flex items-center gap-1.5"
                style={{ background: mode === 'synced' ? 'rgba(124,58,237,0.10)' : 'transparent', color: mode === 'synced' ? '#7C3AED' : 'var(--fg-muted)' }}>
                <Youtube size={13} /> Already on YouTube
              </button>
              <button type="button" onClick={() => setMode('file')}
                className="px-3 py-1.5 text-[12px] font-medium inline-flex items-center gap-1.5"
                style={{ background: mode === 'file' ? 'rgba(124,58,237,0.10)' : 'transparent', color: mode === 'file' ? '#7C3AED' : 'var(--fg-muted)' }}>
                <Upload size={13} /> Start from a file
              </button>
            </div>
          </div>

          {mode === 'file' ? (
            <div>
              <p className="text-[12px] mb-3" style={muted}>Upload your edited video, burn in a CTA, and publish it to YouTube. Once it&apos;s live and synced, switch to &ldquo;Already on YouTube&rdquo; to run the rest.</p>
              <UploadStage />
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 text-sm py-6 justify-center" style={muted}>
              <Loader2 size={16} className="animate-spin" /> Loading your videos…
            </div>
          ) : videos.length === 0 ? (
            <p className="text-sm" style={muted}>No videos yet. Connect your channel and sync, then come back — or start from a file above.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {videos.map(v => {
                const on = picked === v.id
                return (
                  <button key={v.id} type="button" onClick={() => { setPicked(v.id); setShowStorefront(false) }}
                    className="text-left rounded-xl border overflow-hidden transition-all"
                    style={{ borderColor: on ? '#7C3AED' : 'var(--border)', borderWidth: on ? 2 : 1, background: 'var(--bg)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" className="w-full aspect-video object-cover" /> : <div className="w-full aspect-video" style={{ background: 'var(--surface)' }} />}
                    <div className="p-2">
                      <p className="text-[12px] font-medium line-clamp-2" style={label}>{v.title}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* The checklist + storefront only apply to a synced video. */}
        {mode === 'synced' && (
          <>
            {/* 2. Choose outputs */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold mb-3" style={label}>2. Choose what to make</h2>
              <div className="space-y-2">
                {steps.map(st => (
                  <label key={st.key} className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer"
                    style={{ borderColor: 'var(--border)', background: st.on ? 'rgba(124,58,237,0.04)' : 'transparent' }}>
                    <input type="checkbox" checked={st.on} onChange={() => toggle(st.key)} disabled={running} className="mt-0.5 accent-[#7C3AED]" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={label}>{st.label}</span>
                        <StateIcon s={st.state} />
                      </div>
                      <p className="text-[12px] mt-0.5" style={muted}>{st.note || st.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* 3. Launch */}
            <div className="flex items-center gap-3">
              <button onClick={() => void launch()} disabled={running || !picked}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#7C3AED,#C026D3)' }}>
                {running ? <><Loader2 size={16} className="animate-spin" /> Launching…</> : <><Rocket size={16} /> Launch</>}
              </button>
              <a href="/co-pilot" className="text-sm inline-flex items-center gap-1" style={muted}>
                or do steps separately <ExternalLink size={12} />
              </a>
            </div>

            {/* 4. Amazon storefronts */}
            <div className="card p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Globe size={16} style={{ color: '#0EA5A4' }} />
                  <h2 className="text-sm font-semibold" style={label}>4. Amazon storefronts (US + your geos)</h2>
                </div>
                {!showStorefront && (
                  <button type="button" onClick={() => setShowStorefront(true)} disabled={!picked}
                    className="text-[12px] font-medium underline disabled:opacity-50" style={muted}>
                    {picked ? 'Set up' : 'Pick a video first'}
                  </button>
                )}
              </div>
              <p className="text-[12px] mt-1" style={muted}>Localize the title and description for every market you sell in, and dub the video in your own voice.</p>
              {showStorefront && picked && (
                <div className="mt-4">
                  <StorefrontStage presetVideoId={picked} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
