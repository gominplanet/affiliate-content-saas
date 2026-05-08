'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import Header from '@/components/layout/Header'
import {
  Youtube, Wand2, ExternalLink, CheckCircle, AlertCircle,
  RefreshCw, Loader2, ChevronRight, Sparkles, X, Facebook, Pin, Edit3, MessageCircle,
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
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Finish setup to generate posts</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-6">Complete these steps before your first blog post.</p>
        <div className="flex flex-col gap-3">
          <GateItem done={checks.brandReady} label="Brand profile" desc="Set your brand name, niche, tone, and writing sample" href="/brand" />
          <GateItem done={checks.wpReady} label="WordPress connected" desc="Connect your WordPress site in Setup" href="/setup" />
          <GateItem done={checks.videosReady} label="YouTube videos synced" desc="Videos will sync automatically once your channel is linked" href="/settings" />
        </div>
      </div>
    </div>
  )
}

function GateItem({ done, label, desc, href }: { done: boolean; label: string; desc: string; href: string }) {
  return (
    <a href={done ? '#' : href} className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${done ? 'bg-[#34c759]/5 border-[#34c759]/20 cursor-default' : 'bg-white dark:bg-[#1c1c1e] border-gray-200 dark:border-white/10 hover:border-[#0071e3]/40'}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-[#34c759]' : 'bg-gray-100'}`}>
        {done ? <CheckCircle size={15} className="text-white" /> : <ChevronRight size={13} className="text-[#86868b] dark:text-[#8e8e93]" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${done ? 'text-[#34c759]' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>{label}</p>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-0.5">{desc}</p>
      </div>
    </a>
  )
}

// ── Pinterest preview modal ───────────────────────────────────────────────────
interface PinPreviewData {
  postId: string
  title: string
  description: string
  disclaimer: string
  imageBase64: string | null
  mediaType: string | null
  fallbackImageUrl: string | null
  boardName: string
}

function PinterestPreviewModal({
  data,
  onPublish,
  onClose,
}: {
  data: PinPreviewData
  onPublish: (description: string) => void
  onClose: () => void
}) {
  const [description, setDescription] = useState(data.description)
  const [publishing, setPublishing] = useState(false)

  const imageSrc = data.imageBase64
    ? `data:${data.mediaType};base64,${data.imageBase64}`
    : data.fallbackImageUrl || null

  async function publish() {
    setPublishing(true)
    onPublish(description + '\n\n' + data.disclaimer)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: '#E60023' }}>
              <Pin size={12} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Preview your Pin</span>
            <span className="text-xs text-[#86868b] dark:text-[#8e8e93] ml-1">→ {data.boardName}</span>
          </div>
          <button onClick={onClose} className="text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:text-[#f5f5f7] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex gap-6 p-6">
          {/* Pin image preview — 9:16 aspect ratio */}
          <div className="flex-shrink-0 w-[160px]">
            <div className="w-[160px] rounded-xl overflow-hidden bg-gray-100" style={{ aspectRatio: '9/16' }}>
              {imageSrc ? (
                <img src={imageSrc} alt={data.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#86868b] dark:text-[#8e8e93]">
                  <Pin size={24} />
                </div>
              )}
            </div>
            {data.imageBase64 && (
              <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] text-center mt-1.5">AI-generated image</p>
            )}
          </div>

          {/* Pin details */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            {/* Title */}
            <div>
              <p className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide mb-1">Title</p>
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] leading-snug">{data.title}</p>
            </div>

            {/* Description — editable */}
            <div className="flex-1">
              <div className="flex items-center gap-1.5 mb-1">
                <p className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">Description</p>
                <Edit3 size={10} className="text-[#86868b] dark:text-[#8e8e93]" />
                <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">editable</span>
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full text-sm text-[#1d1d1f] dark:text-[#f5f5f7] border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-[#E60023]/50 focus:ring-1 focus:ring-[#E60023]/20 transition-colors"
              />
            </div>

            {/* Disclaimer */}
            <div className="rounded-lg p-3" style={{ background: '#fff8f0', border: '1px solid #ffe4cc' }}>
              <p className="text-[10px] font-semibold text-[#ff9500] uppercase tracking-wide mb-0.5">Affiliate disclaimer — auto-appended</p>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">{data.disclaimer}</p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={publish}
                disabled={publishing}
                className="flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
                style={{ background: publishing ? '#c0001a' : '#E60023' }}
              >
                {publishing
                  ? <><Loader2 size={14} className="animate-spin" /> Publishing…</>
                  : <><Pin size={14} /> Publish Pin</>
                }
              </button>
              <button onClick={onClose} className="text-sm text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:text-[#f5f5f7] transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Generation status badge ───────────────────────────────────────────────────
type GenStatus = 'idle' | 'generating' | 'done' | 'error'

const GEN_STEPS = ['Reading transcript…', 'Generating blog post…', 'Publishing to WordPress…']

function GenerateButton({
  videoId, existingPost, onDone,
}: {
  videoId: string
  existingPost?: { url: string; title: string; postId?: string } | null
  onDone: (url: string, title: string, postId: string) => void
}) {
  const [status, setStatus] = useState<GenStatus>(existingPost ? 'done' : 'idle')
  const [stepIdx, setStepIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState(existingPost || null)

  useEffect(() => {
    if (status !== 'generating') return
    const interval = setInterval(() => setStepIdx((i) => (i < GEN_STEPS.length - 1 ? i + 1 : i)), 9000)
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
      let data: Record<string, unknown> = {}
      try { data = await res.json() } catch { throw new Error(`Server error (${res.status}) — check Vercel logs`) }
      if (!res.ok) {
        if (data.limitReached) {
          window.location.href = '/pricing'
          return
        }
        throw new Error((data.error as string) || 'Generation failed')
      }
      setResult({ url: data.wordpressUrl as string, title: data.title as string })
      setStatus('done')
      onDone(data.wordpressUrl as string, data.title as string, data.postId as string)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('error')
    }
  }

  if (status === 'done' && result) {
    return (
      <a href={result.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-[#34c759] hover:underline">
        <CheckCircle size={13} /> View post <ExternalLink size={11} />
      </a>
    )
  }
  if (status === 'generating') {
    return (
      <div className="flex items-center gap-2 text-xs text-[#6e6e73] dark:text-[#ebebf0]">
        <Loader2 size={13} className="animate-spin text-[#0071e3]" />
        <span>{GEN_STEPS[stepIdx]}</span>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-[#ff3b30] line-clamp-3">{error}</p>
        <button onClick={generate} className="text-xs text-[#0071e3] hover:underline text-left">Retry →</button>
      </div>
    )
  }
  return (
    <button onClick={generate} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0071e3] text-white text-xs font-semibold rounded-lg hover:bg-[#0071e3]/90 transition-colors">
      <Wand2 size={12} /> Generate post
    </button>
  )
}

// ── Video card ────────────────────────────────────────────────────────────────
function VideoCard({
  video, post, wpSiteUrl, fbConnected, pinterestConnected, threadsConnected,
  onGenerated, onDismiss, onDelete, onPinPreview,
}: {
  video: Record<string, unknown>
  post?: { url: string; title: string; postId?: string; wpPostId?: number; facebookPostId?: string; pinterestPinId?: string; threadsPostId?: string } | null
  wpSiteUrl: string
  fbConnected: boolean
  pinterestConnected: boolean
  threadsConnected: boolean
  onGenerated: (videoId: string, url: string, title: string, postId: string) => void
  onDismiss: () => void
  onDelete: (postId: string) => void
  onPinPreview: (data: PinPreviewData) => void
}) {
  const thumb = video.thumbnail_url as string
  const title = video.title as string
  const views = video.view_count as number | null
  const publishedAt = video.published_at as string
  const id = video.id as string

  const [deleting, setDeleting] = useState(false)
  const [fbPosting, setFbPosting] = useState(false)
  const [fbPosted, setFbPosted] = useState(!!post?.facebookPostId)
  const [pinLoading, setPinLoading] = useState(false)
  const [pinPosted, setPinPosted] = useState(!!post?.pinterestPinId)
  const [thPosting, setThPosting] = useState(false)
  const [thPosted, setThPosted] = useState(!!post?.threadsPostId)

  async function handleFacebookPost() {
    if (!post?.postId) return
    setFbPosting(true)
    try {
      const res = await fetch('/api/blog/facebook-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.postId }),
      })
      if (res.ok) setFbPosted(true)
      else { const d = await res.json(); alert(d.error || 'Facebook post failed') }
    } finally { setFbPosting(false) }
  }

  async function handleThreadsPost() {
    if (!post?.postId) return
    setThPosting(true)
    try {
      const res = await fetch('/api/blog/threads-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.postId }),
      })
      const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (res.ok) setThPosted(true)
      else alert(d.error || 'Threads post failed')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Threads post failed')
    } finally { setThPosting(false) }
  }

  async function handlePinPreview() {
    if (!post?.postId) return
    setPinLoading(true)
    try {
      const res = await fetch('/api/blog/pinterest-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.postId }),
      })
      const d = await res.json()
      if (!res.ok) { alert(d.error || 'Failed to generate pin preview'); return }
      onPinPreview({ postId: post.postId, ...d })
    } catch { alert('Failed to generate pin preview') }
    finally { setPinLoading(false) }
  }

  async function handleDelete() {
    if (!post?.postId) return
    if (!confirm('Delete this post from WordPress and remove it here?')) return
    setDeleting(true)
    try {
      await fetch('/api/blog/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: post.postId }) })
      onDelete(post.postId)
    } finally { setDeleting(false) }
  }

  const editorUrl = wpSiteUrl && post?.wpPostId ? `${wpSiteUrl}/wp-admin/post.php?post=${post.wpPostId}&action=edit` : null

  return (
    <div className="card p-4 flex gap-4 items-start">
      {thumb && (
        <div className="w-28 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100" style={{ height: '72px' }}>
          <img src={thumb} alt={title} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] leading-snug line-clamp-2 mb-1">{title}</p>
        <div className="flex items-center gap-3 text-xs text-[#86868b] dark:text-[#8e8e93] mb-3">
          {views != null && <span>{views.toLocaleString()} views</span>}
          <span>{new Date(publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <GenerateButton videoId={id} existingPost={post} onDone={(url, t, pid) => onGenerated(id, url, t, pid)} />
          {post ? (
            <>
              {editorUrl && (
                <a href={editorUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:bg-gray-200 dark:hover:bg-white/20 transition-colors">
                  <ExternalLink size={11} /> Edit in WP
                </a>
              )}
              {fbConnected && (
                fbPosted ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1877F2]/10 text-[#1877F2]">
                    <CheckCircle size={11} /> Posted to FB
                  </span>
                ) : (
                  <button onClick={handleFacebookPost} disabled={fbPosting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1877F2] text-white hover:bg-[#166fe5] disabled:opacity-60 transition-colors">
                    {fbPosting ? <Loader2 size={11} className="animate-spin" /> : <Facebook size={11} />}
                    {fbPosting ? 'Posting…' : 'Post to FB'}
                  </button>
                )
              )}
              {pinterestConnected && (
                pinPosted ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#E60023]/10 text-[#E60023]">
                    <CheckCircle size={11} /> Pinned
                  </span>
                ) : (
                  <button onClick={handlePinPreview} disabled={pinLoading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#E60023] text-white hover:bg-[#cc001f] disabled:opacity-60 transition-colors">
                    {pinLoading ? <Loader2 size={11} className="animate-spin" /> : <Pin size={11} />}
                    {pinLoading ? 'Generating…' : 'Pin it'}
                  </button>
                )
              )}
              {threadsConnected && (
                thPosted ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-black/10 dark:bg-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]">
                    <CheckCircle size={11} /> Threaded
                  </span>
                ) : (
                  <button onClick={handleThreadsPost} disabled={thPosting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-black text-white hover:bg-[#333] disabled:opacity-60 transition-colors">
                    {thPosting ? <Loader2 size={11} className="animate-spin" /> : <MessageCircle size={11} />}
                    {thPosting ? 'Posting…' : 'Thread it'}
                  </button>
                )
              )}
              <button onClick={handleDelete} disabled={deleting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#ff3b30] text-white hover:bg-[#e02d22] disabled:opacity-60 transition-colors">
                {deleting ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </>
          ) : (
            <button onClick={onDismiss} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-white/10 text-[#86868b] dark:text-[#ebebf0] hover:bg-red-50 dark:hover:bg-red-500/20 hover:text-[#ff3b30] dark:hover:text-[#ff453a] transition-colors">
              <X size={11} /> Ignore
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const DISMISSED_KEY = 'affiliateos_dismissed_videos'
function getDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')) } catch { return new Set() }
}
function saveDismissed(set: Set<string>) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set])) } catch {}
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ContentPage() {
  const supabase = createBrowserClient()
  const [videos, setVideos] = useState<Record<string, unknown>[]>([])
  const [posts, setPosts] = useState<Record<string, { url: string; title: string; postId?: string; wpPostId?: number; facebookPostId?: string; pinterestPinId?: string; threadsPostId?: string }>>({})
  const [wpSiteUrl, setWpSiteUrl] = useState('')
  const [fbConnected, setFbConnected] = useState(false)
  const [pinterestConnected, setPinterestConnected] = useState(false)
  const [threadsConnected, setThreadsConnected] = useState(false)
  const [checks, setChecks] = useState<ReadinessCheck | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [pinPreview, setPinPreview] = useState<PinPreviewData | null>(null)
  const [pinPublishingFor, setPinPublishingFor] = useState<string | null>(null)

  useEffect(() => { setDismissed(getDismissed()) }, [])

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const [{ data: vids }, { data: brand }, { data: integration }, { data: blogPosts }] = await Promise.all([
      sb.from('youtube_videos').select('*').eq('user_id', user.id).order('published_at', { ascending: false }),
      sb.from('brand_profiles').select('name,author_name,niches,tone').eq('user_id', user.id).single(),
      sb.from('integrations').select('wordpress_url,wordpress_username,wordpress_app_password,facebook_page_id,pinterest_access_token,pinterest_board_id,threads_access_token').eq('user_id', user.id).single(),
      sb.from('blog_posts').select('id,video_id,wordpress_url,title,wordpress_post_id,facebook_post_id,pinterest_pin_id,threads_post_id').eq('user_id', user.id).eq('status', 'published'),
    ])

    const b = brand as Record<string, unknown> | null
    const i = integration as Record<string, unknown> | null

    setChecks({
      brandReady: !!(b?.name && (b.niches as string[] || []).length > 0),
      wpReady: !!(i?.wordpress_url && i?.wordpress_username),
      videosReady: (vids?.length ?? 0) > 0,
    })
    setWpSiteUrl((i?.wordpress_url as string) || '')
    setFbConnected(!!(i as Record<string, unknown>)?.facebook_page_id)
    setPinterestConnected(!!(i as Record<string, unknown>)?.pinterest_access_token && !!(i as Record<string, unknown>)?.pinterest_board_id)
    setThreadsConnected(!!(i as Record<string, unknown>)?.threads_access_token)
    setVideos((vids as Record<string, unknown>[]) ?? [])

    const postMap: Record<string, { url: string; title: string; postId?: string; wpPostId?: number; facebookPostId?: string; pinterestPinId?: string }> = {}
    for (const p of blogPosts as Record<string, unknown>[] ?? []) {
      if (p.video_id && p.wordpress_url) {
        postMap[p.video_id as string] = {
          url: p.wordpress_url as string,
          title: p.title as string,
          postId: p.id as string,
          wpPostId: p.wordpress_post_id as number | undefined,
          facebookPostId: p.facebook_post_id as string | undefined,
          pinterestPinId: p.pinterest_pin_id as string | undefined,
          threadsPostId: p.threads_post_id as string | undefined,
        }
      }
    }
    setPosts(postMap)
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function handlePublishPin(description: string) {
    if (!pinPreview) return
    setPinPublishingFor(pinPreview.postId)
    try {
      const res = await fetch('/api/blog/pinterest-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: pinPreview.postId,
          description,
          imageBase64: pinPreview.imageBase64,
          mediaType: pinPreview.mediaType,
          fallbackImageUrl: pinPreview.fallbackImageUrl,
        }),
      })
      const d = await res.json()
      if (!res.ok) { alert(d.error || 'Pinterest post failed'); return }
      // Mark as pinned in local state
      setPosts((prev) => {
        const next = { ...prev }
        for (const vid in next) {
          if (next[vid].postId === pinPreview.postId) {
            next[vid] = { ...next[vid], pinterestPinId: d.pinId }
          }
        }
        return next
      })
      setPinPreview(null)
    } finally {
      setPinPublishingFor(null)
    }
  }

  async function syncVideos() {
    setSyncing(true)
    const res = await fetch('/api/youtube/sync', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setNextPageToken(data.nextPageToken ?? null)
    await load()
    setSyncing(false)
  }

  async function loadMore() {
    if (!nextPageToken) return
    setLoadingMore(true)
    const res = await fetch('/api/youtube/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageToken: nextPageToken }),
    })
    const data = await res.json().catch(() => ({}))
    setNextPageToken(data.nextPageToken ?? null)
    await load()
    setLoadingMore(false)
  }

  function dismissVideo(videoId: string) {
    const next = new Set(dismissed)
    next.add(videoId)
    setDismissed(next)
    saveDismissed(next)
  }

  const allReady = checks?.brandReady && checks?.wpReady
  const visibleVideos = videos.filter(v => !dismissed.has(v.id as string))
  const generatedCount = Object.keys(posts).length

  return (
    <>
      <Header
        title="Content"
        subtitle={
          loading ? 'Loading…' :
          visibleVideos.length > 0
            ? `${visibleVideos.length} video${visibleVideos.length !== 1 ? 's' : ''} · ${generatedCount} post${generatedCount !== 1 ? 's' : ''} published`
            : 'Sync your YouTube channel to get started.'
        }
        actions={
          <button onClick={syncVideos} disabled={syncing} className="btn-secondary text-sm">
            {syncing ? <><Loader2 size={14} className="animate-spin" /> Syncing…</> : <><RefreshCw size={14} /> Sync videos</>}
          </button>
        }
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : !allReady ? (
        <SetupGate checks={checks!} />
      ) : visibleVideos.length === 0 && videos.length === 0 ? (
        <div className="card p-8 max-w-md flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <Youtube size={22} className="text-red-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">No videos yet</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">Click "Sync videos" above to pull your latest YouTube uploads.</p>
          </div>
          <button onClick={syncVideos} disabled={syncing} className="btn-primary text-sm">
            {syncing ? <><Loader2 size={14} className="animate-spin" /> Syncing…</> : 'Sync now'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-6 mb-2">
            <div className="flex items-center gap-2 text-sm">
              <Sparkles size={14} className="text-[#0071e3]" />
              <span className="text-[#6e6e73] dark:text-[#ebebf0]">{generatedCount} of {visibleVideos.length} videos published as blog posts</span>
            </div>
          </div>
          {visibleVideos.map((video) => (
            <VideoCard
              key={video.id as string}
              video={video}
              post={posts[video.id as string] || null}
              wpSiteUrl={wpSiteUrl}
              fbConnected={fbConnected}
              pinterestConnected={pinterestConnected}
              threadsConnected={threadsConnected}
              onGenerated={(vid, url, title, postId) => setPosts((prev) => ({ ...prev, [vid]: { url, title, postId } }))}
              onDismiss={() => dismissVideo(video.id as string)}
              onDelete={(postId) => {
                setPosts((prev) => {
                  const next = { ...prev }
                  const vid = video.id as string
                  if (next[vid]?.postId === postId) delete next[vid]
                  return next
                })
              }}
              onPinPreview={setPinPreview}
            />
          ))}
          {nextPageToken && (
            <button onClick={loadMore} disabled={loadingMore} className="btn-secondary text-sm self-center mt-2">
              {loadingMore ? <><Loader2 size={14} className="animate-spin" /> Loading…</> : <><RefreshCw size={14} /> Load more videos</>}
            </button>
          )}
        </div>
      )}

      {/* Pinterest preview modal */}
      {pinPreview && (
        <PinterestPreviewModal
          data={pinPreview}
          onPublish={handlePublishPin}
          onClose={() => { if (!pinPublishingFor) setPinPreview(null) }}
        />
      )}
    </>
  )
}
