'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import Header from '@/components/layout/Header'
import {
  Youtube, Wand2, ExternalLink, CheckCircle, AlertCircle,
  RefreshCw, Loader2, ChevronRight, Sparkles,
} from 'lucide-react'

// ── Readiness gate ────────────────────────────────────────────────────────────
interface ReadinessCheck {
  brandReady: boolean
  wpReady: boolean
  videosReady: boolean
}

function SetupGate({ checks }: { checks: ReadinessCheck }) {
  return (
    <div className="max-w-lg">
      <div className="card p-7">
        <div className="w-12 h-12 rounded-full bg-[#ff9500]/10 flex items-center justify-center mb-4">
          <AlertCircle size={22} className="text-[#ff9500]" />
        </div>
        <h2 className="text-lg font-semibold text-[#1d1d1f] mb-1">Finish setup to generate posts</h2>
        <p className="text-sm text-[#6e6e73] mb-6">Complete these steps before your first blog post.</p>
        <div className="flex flex-col gap-3">
          <GateItem
            done={checks.brandReady}
            label="Brand profile"
            desc="Set your brand name, niche, tone, and writing sample"
            href="/brand"
          />
          <GateItem
            done={checks.wpReady}
            label="WordPress connected"
            desc="Connect your WordPress site in Setup"
            href="/setup"
          />
          <GateItem
            done={checks.videosReady}
            label="YouTube videos synced"
            desc="Videos will sync automatically once your channel is linked"
            href="/settings"
          />
        </div>
      </div>
    </div>
  )
}

function GateItem({ done, label, desc, href }: { done: boolean; label: string; desc: string; href: string }) {
  return (
    <a
      href={done ? '#' : href}
      className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
        done
          ? 'bg-[#34c759]/5 border-[#34c759]/20 cursor-default'
          : 'bg-white border-gray-200 hover:border-[#0071e3]/40'
      }`}
    >
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
        done ? 'bg-[#34c759]' : 'bg-gray-100'
      }`}>
        {done
          ? <CheckCircle size={15} className="text-white" />
          : <ChevronRight size={13} className="text-[#86868b]" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${done ? 'text-[#34c759]' : 'text-[#1d1d1f]'}`}>{label}</p>
        <p className="text-xs text-[#86868b] mt-0.5">{desc}</p>
      </div>
    </a>
  )
}

// ── Generation status badge ───────────────────────────────────────────────────
type GenStatus = 'idle' | 'generating' | 'done' | 'error'

const STATUS_STEPS = [
  'Reading transcript…',
  'Generating blog post…',
  'Creating hero image…',
  'Creating lifestyle image…',
  'Creating setting image…',
  'Uploading to WordPress…',
]

function GenerateButton({
  videoId,
  existingPost,
  onDone,
}: {
  videoId: string
  existingPost?: { url: string; title: string } | null
  onDone: (url: string, title: string) => void
}) {
  const [status, setStatus] = useState<GenStatus>(existingPost ? 'done' : 'idle')
  const [stepIdx, setStepIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState(existingPost || null)

  useEffect(() => {
    if (status !== 'generating') return
    const interval = setInterval(() => {
      setStepIdx((i) => (i < STATUS_STEPS.length - 1 ? i + 1 : i))
    }, 8000)
    return () => clearInterval(interval)
  }, [status])

  async function generate() {
    setStatus('generating')
    setStepIdx(0)
    setError(null)
    try {
      const res = await fetch('/api/blog/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      setResult({ url: data.wordpressUrl, title: data.title })
      setStatus('done')
      onDone(data.wordpressUrl, data.title)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('error')
    }
  }

  if (status === 'done' && result) {
    return (
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs font-medium text-[#34c759] hover:underline"
      >
        <CheckCircle size={13} /> View post <ExternalLink size={11} />
      </a>
    )
  }

  if (status === 'generating') {
    return (
      <div className="flex items-center gap-2 text-xs text-[#6e6e73]">
        <Loader2 size={13} className="animate-spin text-[#0071e3]" />
        <span>{STATUS_STEPS[stepIdx]}</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-[#ff3b30] line-clamp-2">{error}</p>
        <button onClick={generate} className="text-xs text-[#0071e3] hover:underline text-left">
          Retry →
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={generate}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0071e3] text-white text-xs font-semibold rounded-lg hover:bg-[#0071e3]/90 transition-colors"
    >
      <Wand2 size={12} /> Generate post
    </button>
  )
}

// ── Video card ────────────────────────────────────────────────────────────────
function VideoCard({
  video,
  post,
  onGenerated,
}: {
  video: Record<string, unknown>
  post?: { url: string; title: string } | null
  onGenerated: (videoId: string, url: string, title: string) => void
}) {
  const thumb = video.thumbnail_url as string
  const title = video.title as string
  const views = video.view_count as number | null
  const publishedAt = video.published_at as string
  const id = video.id as string

  return (
    <div className="card p-4 flex gap-4 items-start">
      {thumb && (
        <div className="w-28 h-18 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
          <img
            src={thumb}
            alt={title}
            className="w-full h-full object-cover"
            style={{ height: '72px' }}
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1d1d1f] leading-snug line-clamp-2 mb-1">{title}</p>
        <div className="flex items-center gap-3 text-xs text-[#86868b] mb-3">
          {views != null && <span>{views.toLocaleString()} views</span>}
          <span>{new Date(publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
        <GenerateButton
          videoId={id}
          existingPost={post}
          onDone={(url, t) => onGenerated(id, url, t)}
        />
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ContentPage() {
  const supabase = createBrowserClient()
  const [videos, setVideos] = useState<Record<string, unknown>[]>([])
  const [posts, setPosts] = useState<Record<string, { url: string; title: string }>>({})
  const [checks, setChecks] = useState<ReadinessCheck | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: vids }, { data: brand }, { data: integration }, { data: blogPosts }] =
      await Promise.all([
        supabase
          .from('youtube_videos')
          .select('*')
          .eq('user_id', user.id)
          .order('published_at', { ascending: false }),
        supabase.from('brand_profiles').select('name,author_name,niches,tone').eq('user_id', user.id).single(),
        supabase.from('integrations').select('wordpress_url,wordpress_username,wordpress_app_password').eq('user_id', user.id).single(),
        supabase
          .from('blog_posts')
          .select('video_id,wordpress_url,title')
          .eq('user_id', user.id)
          .eq('status', 'published'),
      ])

    const b = brand as Record<string, unknown> | null
    const i = integration as Record<string, unknown> | null

    setChecks({
      brandReady: !!(b?.name && (b.niches as string[] || []).length > 0),
      wpReady: !!(i?.wordpress_url && i?.wordpress_username),
      videosReady: (vids?.length ?? 0) > 0,
    })

    setVideos((vids as Record<string, unknown>[]) ?? [])

    const postMap: Record<string, { url: string; title: string }> = {}
    for (const p of blogPosts as Record<string, unknown>[] ?? []) {
      if (p.video_id && p.wordpress_url) {
        postMap[p.video_id as string] = {
          url: p.wordpress_url as string,
          title: p.title as string,
        }
      }
    }
    setPosts(postMap)
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function syncVideos() {
    setSyncing(true)
    await fetch('/api/youtube/sync', { method: 'POST' })
    await load()
    setSyncing(false)
  }

  const allReady = checks?.brandReady && checks?.wpReady

  const generatedCount = Object.keys(posts).length

  return (
    <>
      <Header
        title="Content"
        subtitle={
          loading ? 'Loading…' :
          videos.length > 0
            ? `${videos.length} video${videos.length !== 1 ? 's' : ''} · ${generatedCount} post${generatedCount !== 1 ? 's' : ''} published`
            : 'Sync your YouTube channel to get started.'
        }
        actions={
          <button
            onClick={syncVideos}
            disabled={syncing}
            className="btn-secondary text-sm"
          >
            {syncing
              ? <><Loader2 size={14} className="animate-spin" /> Syncing…</>
              : <><RefreshCw size={14} /> Sync videos</>
            }
          </button>
        }
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#86868b] py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : !allReady ? (
        <SetupGate checks={checks!} />
      ) : videos.length === 0 ? (
        <div className="card p-8 max-w-md flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <Youtube size={22} className="text-red-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] mb-1">No videos yet</p>
            <p className="text-xs text-[#6e6e73]">Click "Sync videos" above to pull your latest YouTube uploads.</p>
          </div>
          <button onClick={syncVideos} disabled={syncing} className="btn-primary text-sm">
            {syncing ? <><Loader2 size={14} className="animate-spin" /> Syncing…</> : 'Sync now'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Quick stats */}
          <div className="flex items-center gap-6 mb-2">
            <div className="flex items-center gap-2 text-sm">
              <Sparkles size={14} className="text-[#0071e3]" />
              <span className="text-[#6e6e73]">{generatedCount} of {videos.length} videos published as blog posts</span>
            </div>
          </div>
          {videos.map((video) => (
            <VideoCard
              key={video.id as string}
              video={video}
              post={posts[video.id as string] || null}
              onGenerated={(vid, url, title) => {
                setPosts((prev) => ({ ...prev, [vid]: { url, title } }))
              }}
            />
          ))}
        </div>
      )}
    </>
  )
}
