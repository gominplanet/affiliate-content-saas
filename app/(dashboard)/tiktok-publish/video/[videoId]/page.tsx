'use client'

/**
 * /tiktok-publish/video/[videoId] — direct-vertical-video publish flow.
 *
 * Mirrors the blog-post-based /tiktok-publish/[blogPostId] page but
 * reads from a YouTube video directly (no blog post needed). The audit-
 * mandated controls — live privacy dropdown, comment / duet / stitch
 * toggles, commercial-content disclosure, Music Usage Confirmation —
 * are identical to the blog flow.
 *
 * Caption is generated fresh by /api/blog/tiktok-post/video-meta on
 * load (Haiku, TikTok-tuned hashtags + affiliate disclaimer baked in).
 */
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Header from '@/components/layout/Header'
import {
  Loader2, AlertCircle, CheckCircle, Send, ExternalLink, X,
  MessageSquare, Users, Scissors, Music, Lock,
} from 'lucide-react'

type PrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY' | 'FOLLOWER_OF_CREATOR'

interface CreatorInfo {
  username: string
  displayName: string
  avatarUrl: string
  privacyLevelOptions: PrivacyLevel[]
  maxVideoDurationSec: number
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
}

interface VideoMeta {
  title: string
  videoUrl: string | null
  defaultCaption: string
  hashtags: string[]
  hook: string
}

const PRIVACY_LABELS: Record<PrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: 'Public — anyone can see',
  MUTUAL_FOLLOW_FRIENDS: 'Friends — mutual follows only',
  FOLLOWER_OF_CREATOR: 'Followers only',
  SELF_ONLY: 'Only me (private)',
}

export default function TikTokDirectVideoPublishPage() {
  const params = useParams<{ videoId: string }>()
  const router = useRouter()
  const videoId = params?.videoId

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [info, setInfo] = useState<CreatorInfo | null>(null)
  const [meta, setMeta] = useState<VideoMeta | null>(null)
  const [reconnectRequired, setReconnectRequired] = useState(false)

  const [caption, setCaption] = useState('')
  const [privacy, setPrivacy] = useState<PrivacyLevel | ''>('')
  const [allowComment, setAllowComment] = useState(true)
  const [allowDuet, setAllowDuet] = useState(true)
  const [allowStitch, setAllowStitch] = useState(true)
  const [isCommercial, setIsCommercial] = useState(false)
  const [brandedContent, setBrandedContent] = useState(false)
  const [brandedPartnership, setBrandedPartnership] = useState(false)

  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [publishId, setPublishId] = useState<string | null>(null)
  const [publishStatus, setPublishStatus] = useState<'idle' | 'processing' | 'published' | 'failed'>('idle')
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)

  useEffect(() => {
    if (!videoId) return
    let cancelled = false
    void (async () => {
      try {
        const [infoRes, metaRes] = await Promise.all([
          fetch('/api/blog/tiktok-post/creator-info'),
          fetch(`/api/blog/tiktok-post/video-meta?videoId=${encodeURIComponent(videoId)}`),
        ])
        const infoJson = await infoRes.json()
        if (cancelled) return
        if (!infoRes.ok) {
          setLoadError(infoJson.error || 'Could not load your TikTok account info.')
          setReconnectRequired(!!infoJson.reconnectRequired)
          setLoading(false)
          return
        }
        setInfo(infoJson.info as CreatorInfo)

        const metaJson = await metaRes.json()
        if (cancelled) return
        if (metaRes.ok && metaJson.videoUrl) {
          setMeta(metaJson as VideoMeta)
          setCaption((metaJson.defaultCaption as string) || '')
        } else {
          setLoadError(metaJson.error || 'No vertical video file ready for this Short.')
        }
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : 'Loading failed.')
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [videoId])

  useEffect(() => {
    if (!publishId || publishStatus === 'published' || publishStatus === 'failed') return
    const tick = async () => {
      try {
        const res = await fetch(`/api/blog/tiktok-post/video/status?videoId=${encodeURIComponent(videoId!)}`)
        const json = await res.json()
        if (!res.ok) {
          setPublishError(json.error || 'Status check failed.')
          return
        }
        if (json.status === 'published') {
          setPublishStatus('published')
          setShareUrl(json.shareUrl ?? null)
        } else if (json.status === 'failed') {
          setPublishStatus('failed')
          setPublishError(json.errorMessage || 'TikTok rejected the post.')
        }
      } catch { /* one tick missed; next tick covers it */ }
    }
    const id = setInterval(tick, 5000)
    void tick()
    return () => clearInterval(id)
  }, [publishId, publishStatus, videoId])

  const canPost = !!info && !!meta?.videoUrl && privacy !== '' && !posting && publishStatus === 'idle'

  const submit = useCallback(async () => {
    if (!canPost) return
    setPosting(true)
    setPostError(null)
    try {
      const res = await fetch('/api/blog/tiktok-post/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          caption,
          privacyLevel: privacy,
          disableComment: !allowComment || (info?.commentDisabled ?? false),
          disableDuet: !allowDuet || (info?.duetDisabled ?? false),
          disableStitch: !allowStitch || (info?.stitchDisabled ?? false),
          brandContentToggle: isCommercial && brandedPartnership,
          brandOrganicToggle: isCommercial && brandedContent,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setPostError(json.error || 'Posting failed.')
        setReconnectRequired(!!json.reconnectRequired)
        setPosting(false)
        return
      }
      setPublishId(json.publishId)
      setPublishStatus('processing')
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Posting failed.')
    } finally {
      setPosting(false)
    }
  }, [canPost, videoId, caption, privacy, allowComment, allowDuet, allowStitch, isCommercial, brandedContent, brandedPartnership, info])

  return (
    <>
      <Header
        title="Post Short to TikTok"
        subtitle="Direct push from your Vertical Videos — no blog post needed. Pick how it should appear, then publish."
        actions={
          <button onClick={() => router.back()} className="btn-secondary text-sm">
            <X size={14} /> Cancel
          </button>
        }
      />

      {loading ? (
        <div className="card p-10 flex items-center justify-center text-sm text-[#86868b]">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading your TikTok account + writing your caption…
        </div>
      ) : loadError ? (
        <div className="card p-5 border-[#ff3b30]/20 bg-[#ff3b30]/5">
          <p className="text-sm text-[#ff3b30] flex items-center gap-2"><AlertCircle size={14} /> {loadError}</p>
          {reconnectRequired && (
            <a href="/setup?tab=integrations" className="mt-3 inline-block text-xs text-[#0071e3] hover:underline">
              Go to Integrations → Reconnect TikTok →
            </a>
          )}
        </div>
      ) : !info || !meta ? null : (
        <div className="card p-5 max-w-2xl">
          {/* Connected as */}
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-gray-200 dark:border-white/10">
            {info.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={info.avatarUrl} alt="" className="w-10 h-10 rounded-full" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e]" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-[#86868b] uppercase tracking-wide font-semibold">Posting as</p>
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                {info.displayName || info.username || 'Your TikTok account'}{info.username ? <span className="text-[#86868b] font-normal"> · @{info.username}</span> : null}
              </p>
            </div>
          </div>

          {meta.videoUrl ? (
            <div className="mb-4 rounded-xl overflow-hidden bg-[#000] aspect-[9/16] max-w-[240px] mx-auto">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={meta.videoUrl} controls playsInline className="w-full h-full" />
            </div>
          ) : null}

          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1.5">
              Caption (AI-generated — edit freely)
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={2200}
              rows={8}
              className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
            <p className="text-[11px] text-[#86868b] mt-1">{caption.length} / 2200 · Niche hashtags + affiliate disclaimer included.</p>
          </div>

          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1.5">
              Who can view this video <span className="text-[#ff3b30]">*</span>
            </label>
            <select
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value as PrivacyLevel)}
              className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              <option value="">Choose...</option>
              {info.privacyLevelOptions.map(opt => (
                <option key={opt} value={opt}>{PRIVACY_LABELS[opt] || opt}</option>
              ))}
            </select>
            <p className="text-[11px] text-[#86868b] mt-1">Pulled live from your TikTok account settings.</p>
          </div>

          <div className="mb-4">
            <p className="text-[11px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-2">
              Allow viewers to
            </p>
            <div className="flex flex-col gap-2">
              <Toggle icon={<MessageSquare size={14} />} label="Comment" value={!info.commentDisabled && allowComment} disabled={info.commentDisabled} onChange={setAllowComment} disabledHint={info.commentDisabled ? 'Disabled on your TikTok account' : undefined} />
              <Toggle icon={<Users size={14} />} label="Duet" value={!info.duetDisabled && allowDuet} disabled={info.duetDisabled} onChange={setAllowDuet} disabledHint={info.duetDisabled ? 'Disabled on your TikTok account' : undefined} />
              <Toggle icon={<Scissors size={14} />} label="Stitch" value={!info.stitchDisabled && allowStitch} disabled={info.stitchDisabled} onChange={setAllowStitch} disabledHint={info.stitchDisabled ? 'Disabled on your TikTok account' : undefined} />
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-gray-200 dark:border-white/10 p-3">
            <Toggle icon={<Lock size={14} />} label="This post is commercial content" value={isCommercial} onChange={setIsCommercial} />
            {isCommercial && (
              <div className="mt-3 pl-6 flex flex-col gap-2 border-l border-gray-200 dark:border-white/10">
                <Toggle label="Your own brand" value={brandedContent} onChange={setBrandedContent} small />
                <Toggle label="Branded content (someone else)" value={brandedPartnership} onChange={setBrandedPartnership} small />
                <p className="text-[11px] text-[#86868b] mt-1">
                  You must disclose paid partnerships or self-promoting commercial content. TikTok will surface a disclosure label on the post.
                </p>
              </div>
            )}
          </div>

          <div className="mb-4 rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e] p-3 flex items-start gap-2 text-[12px] text-[#3a3a3c] dark:text-[#d2d2d7] leading-relaxed">
            <Music size={14} className="text-[#86868b] flex-shrink-0 mt-0.5" />
            <p>
              By posting, you confirm your video complies with TikTok&apos;s <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">Music Usage Confirmation</a>.
            </p>
          </div>

          {postError && (
            <div className="mb-3 card p-3 border-[#ff3b30]/20 bg-[#ff3b30]/5">
              <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {postError}</p>
            </div>
          )}
          {publishError && (
            <div className="mb-3 card p-3 border-[#ff3b30]/20 bg-[#ff3b30]/5">
              <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {publishError}</p>
            </div>
          )}

          {publishStatus === 'processing' && (
            <div className="mb-3 card p-3 border-[#0071e3]/20 bg-[#0071e3]/5">
              <p className="text-xs text-[#0071e3] flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Sent to TikTok. Processing — usually 1-3 minutes. You can close this page; the result shows on the Vertical Videos row.
              </p>
            </div>
          )}
          {publishStatus === 'published' && (
            <div className="mb-3 card p-3 border-[#34c759]/20 bg-[#34c759]/5">
              <p className="text-xs text-[#34c759] flex items-center gap-1.5"><CheckCircle size={12} /> Live on TikTok.</p>
              {shareUrl && (
                <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[#0071e3] hover:underline">
                  Open on TikTok <ExternalLink size={10} />
                </a>
              )}
            </div>
          )}

          <button
            onClick={() => void submit()}
            disabled={!canPost}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg text-sm font-semibold text-white bg-[#ff0050] hover:bg-[#e6004a] disabled:opacity-50"
          >
            {posting
              ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
              : <><Send size={14} /> Post to TikTok</>
            }
          </button>
        </div>
      )}
    </>
  )
}

function Toggle({
  icon, label, value, onChange, disabled, disabledHint, small,
}: {
  icon?: React.ReactNode
  label: string
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  disabledHint?: string
  small?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`flex items-center gap-1.5 ${small ? 'text-xs' : 'text-sm'} text-[#1d1d1f] dark:text-[#f5f5f7] ${disabled ? 'opacity-50' : ''}`}>
        {icon}
        {label}
        {disabledHint && <span className="text-[10px] text-[#86868b]">· {disabledHint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${value && !disabled ? 'bg-[#34c759]' : 'bg-gray-300 dark:bg-white/15'} disabled:opacity-50`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${value && !disabled ? 'translate-x-5' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}
