'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Shorts Studio (LABS) — pick a long-form YouTube video and cut it into
// captioned vertical Shorts. Lives in Labs so it can be tested safely before it
// graduates to the main Content flow: the sidebar entry is admin-only for now
// (see DashboardShellV2), and the API routes are Pro+ (admin passes).
//
// The heavy lifting is the shared <ShortsStudioModal/> (same component the
// Content page will use once this graduates). This page is just the picker: it
// lists the creator's long-form videos and opens the studio for the one chosen.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShortsStudioGuide } from '@/components/guide/tool-guides'
import Link from 'next/link'
import { toast } from 'sonner'
import { FlaskConical, Scissors, Loader2, Search, Youtube, Link2, Sparkles } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { ShortsStudioModal } from '@/components/content/ShortsStudioModal'
import { dispatchCapReached } from '@/components/CapReachedBanner'
import { errText } from '@/lib/err-text'

const PURPLE = '#7C3AED'

interface VideoLite {
  id: string
  youtubeVideoId: string | null
  title: string
  thumbnailUrl: string | null
  durationSeconds: number | null
}

function fmtDuration(sec: number | null): string {
  if (!sec || sec <= 0) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

export default function ShortsStudioPage() {
  const [loading, setLoading] = useState(true)
  const [videos, setVideos] = useState<VideoLite[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<VideoLite | null>(null)
  // Paste-a-link (vidIQ-style) — generate clips from any YouTube URL.
  const [linkUrl, setLinkUrl] = useState('')
  const [ownership, setOwnership] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    const supabase = createBrowserClient()
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setLoading(false); return }
        // Long-form sources only — a Short is already short. Include rows whose
        // is_vertical is unknown (null) so nothing is hidden by a missing flag.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
          .from('youtube_videos')
          .select('id,youtube_video_id,title,thumbnail_url,duration_seconds,is_vertical,published_at')
          .eq('user_id', user.id)
          .or('is_vertical.is.null,is_vertical.eq.false')
          .order('published_at', { ascending: false })
          .limit(200)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setVideos(((data ?? []) as any[]).map((v) => ({
          id: v.id,
          youtubeVideoId: v.youtube_video_id ?? null,
          title: v.title ?? 'Untitled',
          thumbnailUrl: v.thumbnail_url ?? null,
          durationSeconds: v.duration_seconds ?? null,
        })))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? videos.filter(v => v.title.toLowerCase().includes(q)) : videos
  }, [videos, query])

  const generateFromLink = useCallback(async () => {
    const url = linkUrl.trim()
    if (!url) { toast.error('Paste a YouTube link first.'); return }
    if (!ownership) { toast.error('Confirm you own the video first.'); return }
    setGenerating(true)
    try {
      const res = await fetch('/api/youtube/shorts/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeUrl: url, ownershipConfirmed: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.limitReached) dispatchCapReached(data.error || 'Shorts Studio is a Pro feature.', { cap: data.cap || 'shorts_studio', currentTier: data.currentTier, upgrade: data.upgrade })
        throw new Error(data.error || 'Could not generate clips from that link.')
      }
      if (data.video) {
        setSelected({ id: data.video.id, youtubeVideoId: data.video.youtubeVideoId ?? null, title: data.video.title ?? 'Video', thumbnailUrl: null, durationSeconds: null })
        setLinkUrl(''); setOwnership(false)
        toast.success(`Found ${data.shorts?.length ?? 0} Short${data.shorts?.length === 1 ? '' : 's'}`)
      }
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setGenerating(false)
    }
  }, [linkUrl, ownership])

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Scissors size={20} style={{ color: PURPLE }} />
        <h1 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Shorts Studio</h1>
        <ShortsStudioGuide />
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 text-white bg-[#DC2626]">
          <FlaskConical size={10} /> Labs
        </span>
      </div>
      <p className="text-[13px] text-[#4b4b4f] dark:text-[#b0b0b5] max-w-2xl mb-5">
        Turn one long video into a batch of 15–30s vertical Shorts with burned-in subtitles. We read the
        transcript, pull the strongest moments, and cut them for you — subtitles are word-for-word from what you
        actually said. Pick a video below, or paste a link. <span className="italic">Experimental; still being tested.</span>
      </p>

      {/* Generate from a YouTube link (vidIQ-style) */}
      <div className="rounded-xl border border-black/5 dark:border-white/10 p-4 mb-5 bg-white dark:bg-[#1c1c1e]">
        <div className="flex items-center gap-2 mb-2">
          <Link2 size={15} style={{ color: PURPLE }} />
          <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Paste a YouTube link</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void generateFromLink() }}
            placeholder="https://youtube.com/watch?v=…"
            className="flex-1 rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]"
          />
          <button
            onClick={generateFromLink}
            disabled={generating || !linkUrl.trim() || !ownership}
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: PURPLE }}
          >
            {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {generating ? 'Generating…' : 'Generate Clips'}
          </button>
        </div>
        <label className="flex items-start gap-2 mt-2.5 cursor-pointer select-none">
          <input type="checkbox" checked={ownership} onChange={e => setOwnership(e.target.checked)} className="mt-0.5 accent-[#7C3AED]" />
          <span className="text-[11px] text-[#4b4b4f] dark:text-[#b0b0b5]">I own this video or have the rights to use it.</span>
        </label>
        <p className="text-[10px] text-[#86868b] mt-1.5 leading-relaxed">
          For best results, videos should include faces and speech. Unauthorized videos may violate copyright — by
          proceeding, you confirm ownership. Rendering a link needs the video file; if we can&apos;t fetch it, you&apos;ll be asked to upload it once.
        </p>
      </div>

      {/* Search */}
      {videos.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search your videos…"
            className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent pl-9 pr-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]"
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-[#86868b]"><Loader2 size={22} className="animate-spin" /></div>
      ) : videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3 text-[#86868b]">
          <Youtube size={30} />
          <p className="text-sm max-w-xs">No videos synced yet. Connect YouTube and sync your channel, then come back here.</p>
          <Link href="/content" className="text-sm font-medium" style={{ color: PURPLE }}>Go to Content →</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(v => (
            <button
              key={v.id}
              onClick={() => setSelected(v)}
              className="group text-left rounded-xl border border-black/5 dark:border-white/10 overflow-hidden hover:border-[#7C3AED]/50 transition-colors bg-white dark:bg-[#1c1c1e]"
            >
              <div className="relative aspect-video bg-black/5 dark:bg-white/5">
                {v.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                )}
                {fmtDuration(v.durationSeconds) && (
                  <span className="absolute bottom-1.5 right-1.5 text-[10px] font-medium rounded bg-black/75 text-white px-1.5 py-0.5 tabular-nums">
                    {fmtDuration(v.durationSeconds)}
                  </span>
                )}
                <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white" style={{ backgroundColor: PURPLE }}>
                    <Scissors size={13} /> Make Shorts
                  </span>
                </span>
              </div>
              <p className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] p-2.5 line-clamp-2">{v.title}</p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <ShortsStudioModal
          videoId={selected.id}
          youtubeVideoId={selected.youtubeVideoId}
          videoTitle={selected.title}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
