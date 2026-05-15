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
          <GateItem done={checks.videosReady} label="YouTube videos synced" desc="Videos will sync automatically once your channel is linked" href="/setup" />
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
      <div className="flex items-center gap-2">
        <a href={result.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-[#34c759] hover:underline">
          <CheckCircle size={13} /> View post <ExternalLink size={11} />
        </a>
        <button
          onClick={generate}
          className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#0071e3] transition-colors"
          title="Rewrite this post with fresh AI content"
        >
          <RefreshCw size={11} /> Rewrite
        </button>
      </div>
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
  video, post, wpSiteUrl, fbConnected, pinterestConnected, threadsConnected, linkedInConnected, twitterConnected, blueskyConnected, telegramConnected, userTier,
  onGenerated, onDismiss, onDelete, onPinPreview,
}: {
  video: Record<string, unknown>
  post?: { url: string; title: string; postId?: string; wpPostId?: number; facebookPostId?: string; pinterestPinId?: string; threadsPostId?: string; linkedInPostId?: string; twitterPostId?: string; blueskyPostUri?: string; telegramMessageId?: string } | null
  wpSiteUrl: string
  fbConnected: boolean
  pinterestConnected: boolean
  threadsConnected: boolean
  linkedInConnected: boolean
  twitterConnected: boolean
  blueskyConnected: boolean
  telegramConnected: boolean
  userTier: 'free' | 'starter' | 'growth' | 'pro' | 'admin'
  onGenerated: (videoId: string, url: string, title: string, postId: string) => void
  onDismiss: () => void
  onDelete: (postId: string) => void
  onPinPreview: (data: PinPreviewData) => void
}) {
  const publishAllUnlocked = userTier === 'pro' || userTier === 'admin'
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
  const [liPosting, setLiPosting] = useState(false)
  const [liPosted, setLiPosted] = useState(!!post?.linkedInPostId)
  const [twPosting, setTwPosting] = useState(false)
  const [twPosted, setTwPosted] = useState(!!post?.twitterPostId)
  const [bsPosting, setBsPosting] = useState(false)
  const [bsPosted, setBsPosted] = useState(!!post?.blueskyPostUri)
  const [tgPosting, setTgPosting] = useState(false)
  const [tgPosted, setTgPosted] = useState(!!post?.telegramMessageId)

  // ── Publish All ───────────────────────────────────────────────────────────
  const [publishingAll, setPublishingAll] = useState(false)
  const [publishAllStep, setPublishAllStep] = useState('')
  const [publishAllError, setPublishAllError] = useState<string | null>(null)

  async function handlePublishAll() {
    setPublishingAll(true)
    setPublishAllError(null)

    let currentPostId = post?.postId

    // Step 1: Generate blog post if it doesn't exist yet
    if (!currentPostId) {
      setPublishAllStep('Generating blog post…')
      try {
        const res = await fetch('/api/blog/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId: id }),
        })
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        if (!res.ok) {
          if (data.limitReached) { window.location.href = '/pricing'; return }
          throw new Error(data.error || 'Blog generation failed')
        }
        currentPostId = data.postId as string
        onGenerated(id, data.wordpressUrl as string, data.title as string, data.postId as string)
      } catch (err) {
        setPublishAllError(err instanceof Error ? err.message : 'Blog generation failed')
        setPublishingAll(false)
        return
      }
    }

    // Step 2: Fire all connected & unposted social platforms in parallel
    setPublishAllStep('Publishing to social media…')
    const tasks: Promise<void>[] = []

    if (fbConnected && !fbPosted) {
      tasks.push(
        fetch('/api/blog/facebook-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId }) })
          .then(r => { if (r.ok) setFbPosted(true) })
          .catch(() => { /* non-fatal */ }),
      )
    }
    if (linkedInConnected && !liPosted) {
      tasks.push(
        fetch('/api/blog/linkedin-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId }) })
          .then(r => { if (r.ok) setLiPosted(true) })
          .catch(() => { /* non-fatal */ }),
      )
    }
    if (threadsConnected && !thPosted) {
      tasks.push(
        fetch('/api/blog/threads-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId }) })
          .then(r => { if (r.ok) setThPosted(true) })
          .catch(() => { /* non-fatal */ }),
      )
    }
    if (twitterConnected && !twPosted) {
      tasks.push(
        fetch('/api/blog/twitter-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId }) })
          .then(r => { if (r.ok) setTwPosted(true) })
          .catch(() => { /* non-fatal */ }),
      )
    }
    if (blueskyConnected && !bsPosted) {
      tasks.push(
        fetch('/api/blog/bluesky-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId }) })
          .then(r => { if (r.ok) setBsPosted(true) })
          .catch(() => { /* non-fatal */ }),
      )
    }
    if (telegramConnected && !tgPosted) {
      tasks.push(
        fetch('/api/blog/telegram-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId }) })
          .then(r => { if (r.ok) setTgPosted(true) })
          .catch(() => { /* non-fatal */ }),
      )
    }

    await Promise.allSettled(tasks)
    setPublishingAll(false)
    setPublishAllStep('')
  }

  const connectedSocialCount = [fbConnected, linkedInConnected, threadsConnected, twitterConnected, blueskyConnected, telegramConnected].filter(Boolean).length
  const hasSocialsToPost = (fbConnected && !fbPosted) || (linkedInConnected && !liPosted) || (threadsConnected && !thPosted) || (twitterConnected && !twPosted) || (blueskyConnected && !bsPosted) || (telegramConnected && !tgPosted)
  const showPublishAll = connectedSocialCount > 0 && (!post || hasSocialsToPost)

  async function handleBlueskyPost() {
    if (!post?.postId) return
    setBsPosting(true)
    try {
      const res = await fetch('/api/blog/bluesky-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.postId }),
      })
      const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (res.ok) setBsPosted(true)
      else alert(d.error || 'Bluesky post failed')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bluesky post failed')
    } finally { setBsPosting(false) }
  }

  async function handleTelegramPost() {
    if (!post?.postId) return
    setTgPosting(true)
    try {
      const res = await fetch('/api/blog/telegram-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.postId }),
      })
      const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (res.ok) setTgPosted(true)
      else alert(d.error || 'Telegram post failed')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Telegram post failed')
    } finally { setTgPosting(false) }
  }

  async function handleTwitterPost() {
    if (!post?.postId) return
    setTwPosting(true)
    try {
      const res = await fetch('/api/blog/twitter-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.postId }),
      })
      const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (res.ok) setTwPosted(true)
      else alert(d.error || 'X post failed')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'X post failed')
    } finally { setTwPosting(false) }
  }

  async function handleLinkedInPost() {
    if (!post?.postId) return
    setLiPosting(true)
    try {
      const res = await fetch('/api/blog/linkedin-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.postId }),
      })
      const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (res.ok) setLiPosted(true)
      else alert(d.error || 'LinkedIn post failed')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'LinkedIn post failed')
    } finally { setLiPosting(false) }
  }

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
      const res = await fetch('/api/blog/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: post.postId }) })
      if (res.ok) onDelete(post.postId)
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
        <div className="flex flex-col gap-2">
          {/* Publish All — shown when ≥1 social platform is connected and unpublished.
              Locked behind Pro tier; non-Pro users see the button but it links to /pricing. */}
          {showPublishAll && (
            <div className="flex items-center gap-2 flex-wrap">
              {publishingAll ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-[#0071e3] to-[#5856d6] text-white opacity-80">
                  <Loader2 size={12} className="animate-spin" />
                  {publishAllStep || 'Working…'}
                </div>
              ) : publishAllUnlocked ? (
                <button
                  onClick={handlePublishAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #0071e3 0%, #5856d6 100%)' }}
                  title={post ? 'Post to all connected platforms that haven\'t been posted yet' : 'Generate blog post and publish to all connected platforms'}
                >
                  <Sparkles size={12} />
                  {post ? 'Publish to all' : 'Generate + publish all'}
                </button>
              ) : (
                <a
                  href="/pricing"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90 relative"
                  style={{ background: 'linear-gradient(135deg, #0071e3 0%, #5856d6 100%)', opacity: 0.85 }}
                  title="Publish All is a Pro feature — click to upgrade"
                >
                  <Sparkles size={12} />
                  {post ? 'Publish to all' : 'Generate + publish all'}
                  <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-yellow-300 text-[#1d1d1f]">Pro</span>
                </a>
              )}
              {publishAllError && (
                <span className="text-xs text-[#ff3b30] line-clamp-1">{publishAllError}</span>
              )}
            </div>
          )}

          {/* Individual platform buttons */}
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
              {linkedInConnected && (
                liPosted ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ backgroundColor: '#0A66C2', opacity: 0.8 }}>
                    <CheckCircle size={11} /> On LinkedIn
                  </span>
                ) : (
                  <button onClick={handleLinkedInPost} disabled={liPosting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-60 transition-colors" style={{ backgroundColor: '#0A66C2' }}>
                    {liPosting ? <Loader2 size={11} className="animate-spin" /> : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>}
                    {liPosting ? 'Posting…' : 'Share on LinkedIn'}
                  </button>
                )
              )}
              {twitterConnected && (
                twPosted ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-black/85 text-white">
                    <CheckCircle size={11} /> Posted to X
                  </span>
                ) : (
                  <button onClick={handleTwitterPost} disabled={twPosting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-black text-white hover:bg-[#1a1a1a] disabled:opacity-60 transition-colors">
                    {twPosting ? <Loader2 size={11} className="animate-spin" /> : <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>}
                    {twPosting ? 'Posting…' : 'Post to X'}
                  </button>
                )
              )}
              {blueskyConnected && (
                bsPosted ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ backgroundColor: '#1185fe', opacity: 0.8 }}>
                    <CheckCircle size={11} /> On Bluesky
                  </span>
                ) : (
                  <button onClick={handleBlueskyPost} disabled={bsPosting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-60 transition-colors" style={{ backgroundColor: '#1185fe' }}>
                    {bsPosting ? <Loader2 size={11} className="animate-spin" /> : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364-3.911.58-7.386 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/></svg>}
                    {bsPosting ? 'Posting…' : 'Post to Bluesky'}
                  </button>
                )
              )}
              {telegramConnected && (
                tgPosted ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ backgroundColor: '#229ED9', opacity: 0.8 }}>
                    <CheckCircle size={11} /> On Telegram
                  </span>
                ) : (
                  <button onClick={handleTelegramPost} disabled={tgPosting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-60 transition-colors" style={{ backgroundColor: '#229ED9' }}>
                    {tgPosting ? <Loader2 size={11} className="animate-spin" /> : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>}
                    {tgPosting ? 'Posting…' : 'Send to Telegram'}
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
          </div>{/* end individual buttons */}
        </div>{/* end flex-col wrapper */}
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
  const [posts, setPosts] = useState<Record<string, { url: string; title: string; postId?: string; wpPostId?: number; facebookPostId?: string; pinterestPinId?: string; threadsPostId?: string; linkedInPostId?: string; twitterPostId?: string; blueskyPostUri?: string; telegramMessageId?: string }>>({})
  const [wpSiteUrl, setWpSiteUrl] = useState('')
  const [fbConnected, setFbConnected] = useState(false)
  const [pinterestConnected, setPinterestConnected] = useState(false)
  const [threadsConnected, setThreadsConnected] = useState(false)
  const [linkedInConnected, setLinkedInConnected] = useState(false)
  const [twitterConnected, setTwitterConnected] = useState(false)
  const [blueskyConnected, setBlueskyConnected] = useState(false)
  const [telegramConnected, setTelegramConnected] = useState(false)
  const [userTier, setUserTier] = useState<'free' | 'starter' | 'growth' | 'pro' | 'admin'>('free')
  const [checks, setChecks] = useState<ReadinessCheck | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [pinPreview, setPinPreview] = useState<PinPreviewData | null>(null)
  const [pinPublishingFor, setPinPublishingFor] = useState<string | null>(null)
  const [fixingCategories, setFixingCategories] = useState(false)
  const [fixCatResult, setFixCatResult] = useState<string | null>(null)
  // Category-fix preview modal — dryRun the recategorize endpoint so the
  // user sees exactly which posts go where before any WP write happens.
  const [catPreview, setCatPreview] = useState<{ title: string; category: string }[] | null>(null)
  const [catPreviewLoading, setCatPreviewLoading] = useState(false)
  const [catApplying, setCatApplying] = useState(false)
  const [activeTab, setActiveTab] = useState<'videos' | 'posts'>('videos')
  const [allBlogPosts, setAllBlogPosts] = useState<{ id: number; title: string; link: string; date: string; thumbnail: string | null; videoId: string | null }[]>([])
  const [rewritingPostId, setRewritingPostId] = useState<number | null>(null)
  const [postsLoading, setPostsLoading] = useState(false)
  const [postsLoaded, setPostsLoaded] = useState(false)
  const [deletingPostId, setDeletingPostId] = useState<number | null>(null)
  const [selectedPostIds, setSelectedPostIds] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkRewriting, setBulkRewriting] = useState(false)
  const [bulkRewriteProgress, setBulkRewriteProgress] = useState<{ done: number; total: number } | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set())
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [bulkGenerateProgress, setBulkGenerateProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => { setDismissed(getDismissed()) }, [])

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const [{ data: vids }, { data: brand }, { data: integration }, { data: blogPosts }] = await Promise.all([
      sb.from('youtube_videos').select('*').eq('user_id', user.id).order('published_at', { ascending: false }),
      sb.from('brand_profiles').select('name,author_name,niches,tone').eq('user_id', user.id).single(),
      sb.from('integrations').select('wordpress_url,wordpress_username,wordpress_app_password,facebook_page_id,pinterest_access_token,pinterest_board_id,threads_access_token,linkedin_access_token,linkedin_person_id,twitter_access_token,twitter_handle,bluesky_handle,bluesky_app_password,telegram_channel_id,tier').eq('user_id', user.id).single(),
      sb.from('blog_posts').select('id,video_id,wordpress_url,title,wordpress_post_id,facebook_post_id,pinterest_pin_id,threads_post_id,linkedin_post_id,twitter_post_id,bluesky_post_uri,telegram_message_id').eq('user_id', user.id).eq('status', 'published'),
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
    setLinkedInConnected(!!(i as Record<string, unknown>)?.linkedin_access_token && !!(i as Record<string, unknown>)?.linkedin_person_id)
    setTwitterConnected(!!(i as Record<string, unknown>)?.twitter_access_token)
    setBlueskyConnected(!!(i as Record<string, unknown>)?.bluesky_handle && !!(i as Record<string, unknown>)?.bluesky_app_password)
    setTelegramConnected(!!(i as Record<string, unknown>)?.telegram_channel_id)
    setUserTier(((i as Record<string, unknown>)?.tier as 'free' | 'starter' | 'growth' | 'pro' | 'admin') ?? 'free')
    setVideos((vids as Record<string, unknown>[]) ?? [])

    const postMap: Record<string, { url: string; title: string; postId?: string; wpPostId?: number; facebookPostId?: string; pinterestPinId?: string; threadsPostId?: string; linkedInPostId?: string; twitterPostId?: string; blueskyPostUri?: string; telegramMessageId?: string }> = {}
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
          linkedInPostId: p.linkedin_post_id as string | undefined,
          twitterPostId: p.twitter_post_id as string | undefined,
          blueskyPostUri: p.bluesky_post_uri as string | undefined,
          telegramMessageId: p.telegram_message_id as string | undefined,
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

  async function loadWpPosts() {
    setPostsLoading(true)
    try {
      // Fetch WP posts + Supabase video_id map in parallel
      const [res, { data: { user } }] = await Promise.all([
        fetch('/api/wordpress/posts'),
        supabase.auth.getUser(),
      ])
      const data = await res.json()
      if (!res.ok || data.error) {
        setFixCatResult(`Failed to load posts: ${data.error || res.status}`)
        setPostsLoaded(true)
        return
      }

      // Build a complete wpPostId → videoId map directly from Supabase
      // (the WP posts API fallback misses many posts due to thumbnail naming)
      const wpPostIds = (data.posts ?? []).map((p: { id: number }) => p.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: sbPosts } = await (supabase as any)
        .from('blog_posts')
        .select('wordpress_post_id,video_id')
        .eq('user_id', user?.id)
        .in('wordpress_post_id', wpPostIds)
        .not('video_id', 'is', null)

      const sbMap: Record<number, string> = {}
      for (const p of (sbPosts ?? []) as { wordpress_post_id: number; video_id: string }[]) {
        if (p.wordpress_post_id && p.video_id) sbMap[p.wordpress_post_id] = p.video_id
      }

      // Merge: prefer Supabase map, fall back to WP API result
      const merged = (data.posts ?? []).map((p: { id: number; videoId: string | null }) => ({
        ...p,
        videoId: sbMap[p.id] ?? p.videoId ?? null,
      }))

      setAllBlogPosts(merged)
      setPostsLoaded(true)
    } catch (e) {
      setFixCatResult(`Failed to load posts: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPostsLoading(false)
    }
  }

  async function rewritePost(wpPostId: number, videoId: string) {
    setRewritingPostId(wpPostId)
    try {
      const res = await fetch('/api/blog/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setFixCatResult(`Rewrite failed: ${data.error || res.status}`)
      } else {
        setFixCatResult(`Rewritten: "${data.title}"`)
        setAllBlogPosts(prev => prev.map(p =>
          p.id === wpPostId ? { ...p, title: data.title, link: data.wordpressUrl ?? p.link } : p
        ))
      }
    } catch {
      setFixCatResult('Rewrite failed.')
    } finally {
      setRewritingPostId(null)
    }
  }

  async function deletePostFromList(wpPostId: number) {
    if (!confirm('Delete this post from WordPress?')) return
    setDeletingPostId(wpPostId)
    try {
      await fetch('/api/blog/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpPostId }),
      })
      setAllBlogPosts(prev => prev.filter(p => p.id !== wpPostId))
    } finally {
      setDeletingPostId(null)
    }
  }

  async function bulkDeleteSelected() {
    if (selectedPostIds.size === 0) return
    if (!confirm(`Delete ${selectedPostIds.size} post${selectedPostIds.size !== 1 ? 's' : ''} from WordPress? This cannot be undone.`)) return
    setBulkDeleting(true)
    const ids = [...selectedPostIds]
    let deleted = 0
    for (const wpPostId of ids) {
      try {
        await fetch('/api/blog/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wpPostId }),
        })
        setAllBlogPosts(prev => prev.filter(p => p.id !== wpPostId))
        deleted++
      } catch { /* continue */ }
    }
    setSelectedPostIds(new Set())
    setFixCatResult(`Deleted ${deleted} post${deleted !== 1 ? 's' : ''}.`)
    setBulkDeleting(false)
  }

  async function bulkRewriteSelected() {
    const toRewrite = allBlogPosts.filter(p => selectedPostIds.has(p.id) && p.videoId)
    const skipped = selectedPostIds.size - toRewrite.length
    if (toRewrite.length === 0) {
      setFixCatResult('No selected posts have a linked video — cannot rewrite.')
      return
    }
    setBulkRewriting(true)
    setBulkRewriteProgress({ done: 0, total: toRewrite.length })
    let success = 0
    let failed = 0
    let firstError = ''
    for (let i = 0; i < toRewrite.length; i++) {
      const post = toRewrite[i]
      setBulkRewriteProgress({ done: i, total: toRewrite.length })
      try {
        const res = await fetch('/api/blog/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId: post.videoId }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          setAllBlogPosts(prev => prev.map(p =>
            p.id === post.id ? { ...p, title: data.title, link: data.wordpressUrl ?? p.link } : p
          ))
          success++
        } else {
          failed++
          if (!firstError) firstError = data.error || `HTTP ${res.status}`
        }
      } catch (e) {
        failed++
        if (!firstError) firstError = e instanceof Error ? e.message : 'Network error'
      }
    }
    setBulkRewriteProgress(null)
    setBulkRewriting(false)
    setSelectedPostIds(new Set())
    const parts = [`${success} rewritten`]
    if (failed > 0) parts.push(`${failed} failed${firstError ? ` (${firstError})` : ''}`)
    if (skipped > 0) parts.push(`${skipped} skipped (no video link)`)
    setFixCatResult(parts.join(' · '))
  }

  function toggleVideoSelect(id: string) {
    setSelectedVideoIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function bulkGenerateSelected() {
    const toGenerate = visibleVideos.filter(v =>
      selectedVideoIds.has(v.id as string) && !posts[v.id as string]
    )
    if (!toGenerate.length) return
    setBulkGenerating(true)
    setBulkGenerateProgress({ done: 0, total: toGenerate.length })
    let success = 0; let failed = 0; let firstError = ''
    for (let i = 0; i < toGenerate.length; i++) {
      const video = toGenerate[i]
      setBulkGenerateProgress({ done: i, total: toGenerate.length })
      try {
        const res = await fetch('/api/blog/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId: video.id }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          setPosts(prev => ({ ...prev, [video.id as string]: { url: data.wordpressUrl ?? '', title: data.title ?? '', postId: data.postId } }))
          success++
        } else {
          failed++
          if (!firstError) firstError = data.error || `HTTP ${res.status}`
        }
      } catch (e) {
        failed++
        if (!firstError) firstError = e instanceof Error ? e.message : 'Network error'
      }
    }
    setBulkGenerateProgress(null)
    setBulkGenerating(false)
    setSelectedVideoIds(new Set())
    if (failed > 0) setFixCatResult(`${success} generated · ${failed} failed${firstError ? ` (${firstError})` : ''}`)
  }

  async function backfillVideoLinks() {
    setBackfilling(true)
    setFixCatResult(null)
    try {
      const res = await fetch('/api/blog/backfill-video-links', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setFixCatResult(`Backfill failed: ${data.error}`); return }
      if (data.linked === 0) {
        setFixCatResult(data.message || 'All posts already have video links.')
      } else {
        setFixCatResult(`Linked ${data.linked} posts to videos (${data.skipped} couldn't be matched). Reload to see Rewrite buttons.`)
        // Reload posts so videoIds populate
        setPostsLoaded(false)
        await loadWpPosts()
      }
    } catch { setFixCatResult('Backfill failed.') }
    finally { setBackfilling(false) }
  }

  function toggleSelect(id: number) {
    setSelectedPostIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function syncVideos() {
    setSyncing(true)
    try {
      const res = await fetch('/api/youtube/sync', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      setNextPageToken(data.nextPageToken ?? null)
      await load()
    } catch { /* non-fatal */ } finally {
      setSyncing(false)
    }
  }

  /**
   * Step 1 of the recategorize flow — runs the bulk-categorize endpoint
   * in dryRun mode and surfaces the proposed mapping in a modal. Nothing
   * is written to WP yet.
   */
  async function previewFixCategories() {
    setCatPreviewLoading(true)
    setFixCatResult(null)
    try {
      const res = await fetch('/api/blog/bulk-categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      })
      const data = await res.json()
      if (data.error) {
        setFixCatResult(`Error: ${data.error}`)
      } else if (!Array.isArray(data.preview) || data.preview.length === 0) {
        setFixCatResult(data.message || 'All posts already have a real niche category.')
      } else {
        setCatPreview(data.preview as { title: string; category: string }[])
      }
    } catch {
      setFixCatResult('Something went wrong.')
    } finally {
      setCatPreviewLoading(false)
    }
  }

  /**
   * Step 2 — the user has reviewed the preview and clicked Apply.
   * This time we hit the endpoint without dryRun so WP gets updated.
   */
  async function applyFixCategories() {
    setCatApplying(true)
    setFixingCategories(true)
    try {
      const res = await fetch('/api/blog/bulk-categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.error) {
        setFixCatResult(`Error: ${data.error}`)
      } else if (data.fixed === 0) {
        setFixCatResult(data.message || 'All posts already had categories.')
      } else {
        setFixCatResult(`Done — ${data.fixed} post${data.fixed !== 1 ? 's' : ''} re-categorized (${data.skipped} were already fine).`)
      }
    } catch {
      setFixCatResult('Something went wrong.')
    } finally {
      setCatApplying(false)
      setFixingCategories(false)
      setCatPreview(null)
    }
  }

  async function loadMore() {
    if (!nextPageToken) return
    setLoadingMore(true)
    try {
      const res = await fetch('/api/youtube/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageToken: nextPageToken }),
      })
      const data = await res.json().catch(() => ({}))
      setNextPageToken(data.nextPageToken ?? null)
      await load()
    } catch { /* non-fatal */ } finally {
      setLoadingMore(false)
    }
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
          activeTab === 'posts'
            ? `${allBlogPosts.length} post${allBlogPosts.length !== 1 ? 's' : ''} published`
            : visibleVideos.length > 0
              ? `${visibleVideos.length} video${visibleVideos.length !== 1 ? 's' : ''} · ${generatedCount} post${generatedCount !== 1 ? 's' : ''} published`
              : 'Hit Sync to pull every YouTube video into your generation queue.'
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={previewFixCategories}
              disabled={catPreviewLoading || fixingCategories}
              className="btn-secondary text-sm"
              title="Preview which category each post will be assigned to before applying"
            >
              {catPreviewLoading
                ? <><Loader2 size={14} className="animate-spin" /> Loading preview…</>
                : 'Fix Categories'}
            </button>
            {activeTab === 'videos' && (
              <button onClick={syncVideos} disabled={syncing} className="btn-secondary text-sm">
                {syncing ? <><Loader2 size={14} className="animate-spin" /> Syncing…</> : <><RefreshCw size={14} /> Sync videos</>}
              </button>
            )}
          </div>
        }
      />

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-white/10 -mt-2 mb-4">
        {(['videos', 'posts'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab)
              if (tab === 'posts' && !postsLoaded && !postsLoading) loadWpPosts()
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? 'border-[#0071e3] text-[#0071e3]'
                : 'border-transparent text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
            }`}
          >
            {tab === 'videos' ? 'Videos' : `Posts${postsLoaded ? ` (${allBlogPosts.length})` : ''}`}
          </button>
        ))}
      </div>

      {fixCatResult && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">
          <span>{fixCatResult}</span>
          <button onClick={() => setFixCatResult(null)} className="text-[#86868b] hover:text-[#1d1d1f]"><X size={14} /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : activeTab === 'posts' ? (
        <div className="flex flex-col gap-2">
          {/* Bulk action toolbar */}
          {!postsLoading && allBlogPosts.length > 0 && (
            <div className="flex items-center gap-3 pb-1 flex-wrap">
              <button
                onClick={backfillVideoLinks}
                disabled={backfilling}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#34c759] text-white rounded-lg hover:bg-[#2db34a] disabled:opacity-60 transition-colors"
                title="Link old posts to their YouTube videos so Rewrite works"
              >
                {backfilling ? <><Loader2 size={11} className="animate-spin" /> Linking…</> : '⚡ Link missing videos'}
              </button>
              <button
                onClick={() => setSelectedPostIds(new Set(allBlogPosts.filter(p => !p.thumbnail).map(p => p.id)))}
                className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline"
              >
                Select no-thumbnail
              </button>
              <button
                onClick={() => setSelectedPostIds(new Set(allBlogPosts.map(p => p.id)))}
                className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline"
              >
                Select all
              </button>
              {selectedPostIds.size > 0 && (
                <>
                  <button
                    onClick={() => setSelectedPostIds(new Set())}
                    className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline"
                  >
                    Clear ({selectedPostIds.size})
                  </button>
                  <button
                    onClick={bulkRewriteSelected}
                    disabled={bulkRewriting || bulkDeleting}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#0071e3] text-white rounded-lg hover:bg-[#0071e3]/90 disabled:opacity-60 transition-colors"
                  >
                    {bulkRewriting
                      ? <><Loader2 size={11} className="animate-spin" /> Rewriting {bulkRewriteProgress?.done ?? 0}/{bulkRewriteProgress?.total ?? 0}…</>
                      : <><RefreshCw size={11} /> Rewrite {selectedPostIds.size} selected</>
                    }
                  </button>
                  <button
                    onClick={bulkDeleteSelected}
                    disabled={bulkDeleting || bulkRewriting}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-60 transition-colors"
                  >
                    {bulkDeleting ? <><Loader2 size={11} className="animate-spin" /> Deleting…</> : `Delete ${selectedPostIds.size} selected`}
                  </button>
                </>
              )}
            </div>
          )}

          {postsLoading ? (
            <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-12 justify-center">
              <Loader2 size={16} className="animate-spin" /> Loading posts from WordPress…
            </div>
          ) : allBlogPosts.length === 0 ? (
            <div className="card p-8 max-w-md flex flex-col items-center text-center gap-3">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">No reviews live yet</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">Head to the Videos tab, pick one with an Amazon ASIN, and click Generate. The full review lands on your site in about 60 seconds.</p>
            </div>
          ) : allBlogPosts.map(post => (
            <div key={post.id} className={`card p-4 flex items-center gap-3 transition-colors ${selectedPostIds.has(post.id) ? 'ring-2 ring-[#0071e3]/40 bg-blue-50/30 dark:bg-blue-900/10' : ''}`}>
              <input
                type="checkbox"
                checked={selectedPostIds.has(post.id)}
                onChange={() => toggleSelect(post.id)}
                className="flex-shrink-0 w-4 h-4 rounded accent-[#0071e3] cursor-pointer"
              />
              <div className="w-24 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-[#2c2c2e]">
                {post.thumbnail
                  ? <img src={post.thumbnail} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] line-clamp-2 leading-snug" dangerouslySetInnerHTML={{ __html: post.title }} />
                <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">
                  {post.date ? new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {post.videoId && (
                  <button
                    onClick={() => rewritePost(post.id, post.videoId!)}
                    disabled={rewritingPostId === post.id}
                    className="text-xs text-[#86868b] hover:text-[#0071e3] flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                  >
                    {rewritingPostId === post.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    {rewritingPostId === post.id ? 'Rewriting…' : 'Rewrite'}
                  </button>
                )}
                {post.link && (
                  <a href={post.link} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs flex items-center gap-1">
                    <ExternalLink size={11} /> View
                  </a>
                )}
                <button
                  onClick={() => deletePostFromList(post.id)}
                  disabled={deletingPostId === post.id}
                  className="text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                >
                  {deletingPostId === post.id ? <Loader2 size={12} className="animate-spin" /> : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : !allReady ? (
        <SetupGate checks={checks!} />
      ) : visibleVideos.length === 0 && videos.length === 0 ? (
        <div className="card p-8 max-w-md flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <Youtube size={22} className="text-red-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">No videos synced yet</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">One click and we pull every public, unlisted, and draft video from your channel. ASIN-tagged videos become instant generation candidates.</p>
          </div>
          <button onClick={syncVideos} disabled={syncing} className="btn-primary text-sm">
            {syncing ? <><Loader2 size={14} className="animate-spin" /> Syncing…</> : 'Sync now'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Sparkles size={14} className="text-[#0071e3]" />
              <span className="text-[#6e6e73] dark:text-[#ebebf0]">{generatedCount} of {visibleVideos.length} videos published as blog posts</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {selectedVideoIds.size === 0 && visibleVideos.some(v => !posts[v.id as string]) && (
                <button
                  onClick={() => setSelectedVideoIds(new Set(visibleVideos.filter(v => !posts[v.id as string]).map(v => v.id as string)))}
                  className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline"
                >
                  Select all ungenerated
                </button>
              )}
              {selectedVideoIds.size > 0 && (
                <>
                  <button
                    onClick={() => setSelectedVideoIds(new Set())}
                    className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline"
                  >
                    Clear ({selectedVideoIds.size})
                  </button>
                  <button
                    onClick={bulkGenerateSelected}
                    disabled={bulkGenerating}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#0071e3] text-white rounded-lg hover:bg-[#0062c4] disabled:opacity-60 transition-colors"
                  >
                    {bulkGenerating
                      ? <><Loader2 size={11} className="animate-spin" /> Generating {bulkGenerateProgress?.done ?? 0}/{bulkGenerateProgress?.total ?? 0}…</>
                      : <><Sparkles size={11} /> Generate {selectedVideoIds.size} selected</>
                    }
                  </button>
                </>
              )}
            </div>
          </div>
          {visibleVideos.map((video) => {
            const isGenerated = !!posts[video.id as string]
            const isSelected = selectedVideoIds.has(video.id as string)
            return (
              <div key={video.id as string} className="flex items-start gap-2">
                {!isGenerated && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleVideoSelect(video.id as string)}
                    className="mt-5 flex-shrink-0 w-4 h-4 rounded accent-[#0071e3] cursor-pointer"
                  />
                )}
                {isGenerated && <div className="w-4 mt-5 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <VideoCard
                    video={video}
                    post={posts[video.id as string] || null}
                    wpSiteUrl={wpSiteUrl}
                    fbConnected={fbConnected}
                    pinterestConnected={pinterestConnected}
                    threadsConnected={threadsConnected}
                    linkedInConnected={linkedInConnected}
                    twitterConnected={twitterConnected}
                    blueskyConnected={blueskyConnected}
                    telegramConnected={telegramConnected}
                    userTier={userTier}
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
                </div>
              </div>
            )
          })}
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

      {/* Recategorize preview modal — dryRun first, apply on confirm. */}
      {catPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !catApplying && setCatPreview(null)}>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-white/10">
              <div>
                <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Recategorize preview</h3>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                  {catPreview.length} post{catPreview.length !== 1 ? 's' : ''} will be re-categorized. Nothing&apos;s saved yet.
                </p>
              </div>
              <button
                onClick={() => !catApplying && setCatPreview(null)}
                disabled={catApplying}
                className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5">
              <ul className="flex flex-col gap-2">
                {catPreview.map((row, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                    <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex-1 line-clamp-2">{row.title}</p>
                    <span className="text-xs font-semibold text-[#0071e3] whitespace-nowrap mt-0.5">→ {row.category}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100 dark:border-white/10">
              <button
                onClick={() => !catApplying && setCatPreview(null)}
                disabled={catApplying}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={applyFixCategories}
                disabled={catApplying}
                className="btn-primary text-sm"
              >
                {catApplying
                  ? <><Loader2 size={14} className="animate-spin" /> Applying…</>
                  : `Apply to ${catPreview.length} post${catPreview.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
