'use client'

/**
 * /tiktok-publish/[blogPostId] — the dedicated, TikTok-app-review-mandated
 * publish screen. Renders the EXACT UI controls TikTok requires for any
 * app posting via Direct Post:
 *
 *   - Connected creator's @handle + avatar (live from creator_info)
 *   - Video preview (the rendered 9:16 vertical)
 *   - Editable caption (prefilled, NEVER read-only)
 *   - Privacy dropdown — fetched live, NO default selected
 *   - Individual Allow Comment / Allow Duet / Allow Stitch toggles
 *   - "This is commercial content" disclosure toggle
 *   - Music Usage Confirmation consent line above the Post button
 *
 * Postiz (an open-source scheduler) got their TikTok app rejected for
 * using a generic post composer with most of these missing — every line
 * here is load-bearing for app-review approval.
 */
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import PageHero from '@/components/layout/PageHero'
import {
  Loader2, AlertCircle, CheckCircle, Send, ExternalLink, X,
  MessageSquare, Users, Scissors, Music, Lock, Flame, Clock,
} from 'lucide-react'
import { ShortVideoUpload } from '@/components/ShortVideoUpload'
import { createBrowserClient } from '@/lib/supabase/client'

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

interface BlogPostMeta {
  title: string
  videoUrl: string | null
  /** youtube_videos.id — needed to attach a vertical render in-place. */
  videoId: string | null
  /** Real YouTube video id — deep-links to Studio to download the source MP4. */
  youtubeVideoId: string | null
  /** Amazon/affiliate product link — passed to Shop Burner for context. */
  productUrl: string | null
  defaultCaption: string
}

const PRIVACY_LABELS: Record<PrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: 'Public — anyone can see',
  MUTUAL_FOLLOW_FRIENDS: 'Friends — mutual follows only',
  FOLLOWER_OF_CREATOR: 'Followers only',
  SELF_ONLY: 'Only me (private)',
}

export default function TikTokPublishPage() {
  const params = useParams<{ blogPostId: string }>()
  const router = useRouter()
  const blogPostId = params?.blogPostId

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [info, setInfo] = useState<CreatorInfo | null>(null)
  const [meta, setMeta] = useState<BlogPostMeta | null>(null)
  const [reconnectRequired, setReconnectRequired] = useState(false)

  // Form state — every field is user-editable as required by the audit
  const [caption, setCaption] = useState('')
  const [privacy, setPrivacy] = useState<PrivacyLevel | ''>('')        // NO default
  // TikTok Content Sharing Guidelines: interaction abilities OFF by default.
  const [allowComment, setAllowComment] = useState(false)
  const [allowDuet, setAllowDuet] = useState(false)
  const [allowStitch, setAllowStitch] = useState(false)
  const [isCommercial, setIsCommercial] = useState(false)
  const [brandedContent, setBrandedContent] = useState(false)         // your own brand
  const [brandedPartnership, setBrandedPartnership] = useState(false) // someone else's

  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [publishId, setPublishId] = useState<string | null>(null)
  const [publishStatus, setPublishStatus] = useState<'idle' | 'processing' | 'published' | 'failed'>('idle')
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)

  // Pre-post validation — read the attached video's real duration/aspect/size
  // and warn BEFORE posting so TikTok doesn't reject it after the upload.
  const [videoWarnings, setVideoWarnings] = useState<string[]>([])
  // "Use one you already made" picker — the user's existing 9:16 renders.
  const [renders, setRenders] = useState<Array<{ videoId: string; title: string; thumbnailUrl: string | null; videoUrl: string }> | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [attaching, setAttaching] = useState(false)
  // One upload → both platforms: also fire an Instagram Reel after TikTok.
  const [alsoInstagram, setAlsoInstagram] = useState(false)
  const [igResult, setIgResult] = useState<'idle' | 'posting' | 'done' | 'failed'>('idle')
  const [igError, setIgError] = useState<string | null>(null)
  // Schedule-for-later
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [scheduledMsg, setScheduledMsg] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  // ── Load creator_info LIVE every time the screen opens (TikTok rule) ─────
  useEffect(() => {
    if (!blogPostId) return
    let cancelled = false
    void (async () => {
      try {
        const [infoRes, metaRes] = await Promise.all([
          fetch('/api/blog/tiktok-post/creator-info'),
          fetch(`/api/blog/tiktok-post/post-meta?blogPostId=${encodeURIComponent(blogPostId)}`),
        ])
        const infoJson = await infoRes.json()
        if (cancelled) return
        if (!infoRes.ok) {
          setLoadError(infoJson.error || 'Couldn\'t load your TikTok account info.')
          setReconnectRequired(!!infoJson.reconnectRequired)
          setLoading(false)
          return
        }
        setInfo(infoJson.info as CreatorInfo)

        const metaJson = await metaRes.json()
        if (cancelled) return
        if (metaRes.ok) {
          setMeta(metaJson as BlogPostMeta)
          setCaption((metaJson.defaultCaption as string) || '')
        }
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : 'Loading failed.')
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [blogPostId])

  // Re-pull post-meta after the user attaches a vertical video in-place (the
  // ShortVideoUpload below), so the preview + Post button light up without a
  // full reload. Leaves the caption alone — don't clobber the user's edits.
  const refetchMeta = useCallback(async () => {
    if (!blogPostId) return
    try {
      const res = await fetch(`/api/blog/tiktok-post/post-meta?blogPostId=${encodeURIComponent(blogPostId)}`)
      const json = await res.json()
      if (res.ok) setMeta(json as BlogPostMeta)
    } catch { /* non-fatal — the user can refresh */ }
  }, [blogPostId])

  // "Use one you already made" — list the user's existing 9:16 renders, minus
  // the one already on this post.
  const loadRenders = useCallback(async () => {
    try {
      const res = await fetch('/api/blog/tiktok-post/my-renders')
      const json = await res.json()
      if (res.ok) setRenders((json.renders || []).filter((r: { videoId: string }) => r.videoId !== meta?.videoId))
      else setRenders([])
    } catch { setRenders([]) }
  }, [meta?.videoId])

  // Attach a chosen render to THIS post's video (owner-scoped via RLS), then
  // refetch so the preview + Post button light up.
  const attachRender = useCallback(async (videoUrl: string) => {
    if (!meta?.videoId) return
    setAttaching(true)
    try {
      const supabase = createBrowserClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('youtube_videos').update({ instagram_video_url: videoUrl }).eq('id', meta.videoId)
      await refetchMeta()
      setPickerOpen(false)
    } finally {
      setAttaching(false)
    }
  }, [meta?.videoId, refetchMeta])

  // Pre-post validation — read the attached render's real duration/aspect/size
  // and surface warnings before the user posts (TikTok rejects out-of-spec
  // videos AFTER the upload otherwise). Runs when a video URL is present.
  useEffect(() => {
    const url = meta?.videoUrl
    if (!url) { setVideoWarnings([]); return }
    let cancelled = false
    const warns: string[] = []
    const finish = () => { if (!cancelled) setVideoWarnings([...warns]) }
    // Duration + aspect via a detached <video> element.
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      const dur = v.duration
      const w = v.videoWidth, h = v.videoHeight
      if (dur && dur < 3) warns.push('Video is under 3s — TikTok may reject it.')
      if (dur && dur > 600) warns.push('Video is over 10 minutes — trim it before posting.')
      if (w && h) {
        const ratio = w / h
        if (ratio > 0.62) warns.push('This isn\'t a 9:16 vertical video — it\'ll be letterboxed or cropped.')
      }
      finish()
    }
    v.onerror = () => finish()
    v.src = url
    // Size via a HEAD request (best-effort; storage returns content-length).
    void fetch(url, { method: 'HEAD' }).then(r => {
      const len = Number(r.headers.get('content-length') || 0)
      if (len > 287 * 1024 * 1024) warns.push('File is close to the 300 MB cap — compress it if the post fails.')
      finish()
    }).catch(() => { /* ignore — non-fatal */ })
    return () => { cancelled = true }
  }, [meta?.videoUrl])

  // ── Status polling — only active once we've kicked off a Direct Post ─────
  useEffect(() => {
    if (!publishId || publishStatus === 'published' || publishStatus === 'failed') return
    const tick = async () => {
      try {
        const res = await fetch(`/api/blog/tiktok-post/status?blogPostId=${encodeURIComponent(blogPostId!)}`)
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
    void tick()  // first tick immediately
    return () => clearInterval(id)
  }, [publishId, publishStatus, blogPostId])

  const commercialNeedsChoice = isCommercial && !brandedContent && !brandedPartnership
  const brandedNoPrivate = isCommercial && brandedPartnership && privacy === 'SELF_ONLY'
  const canPost = !!info && !!meta?.videoUrl && privacy !== ''
    && !commercialNeedsChoice && !brandedNoPrivate
    && !posting && publishStatus === 'idle'

  const submit = useCallback(async () => {
    if (!canPost) return
    setPosting(true)
    setPostError(null)
    try {
      const res = await fetch('/api/blog/tiktok-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blogPostId,
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

      // One upload → both platforms: also fire an Instagram Reel with the same
      // render + caption. Independent of TikTok's outcome — reported separately
      // so a failed IG post never masks a successful TikTok post.
      if (alsoInstagram && meta?.videoId) {
        setIgResult('posting'); setIgError(null)
        try {
          const igRes = await fetch('/api/instagram/post-direct-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoId: meta.videoId, caption, mode: 'reel' }),
          })
          const igJson = await igRes.json()
          if (igRes.ok) setIgResult('done')
          else { setIgResult('failed'); setIgError(igJson.error || 'Instagram post failed.') }
        } catch (e) {
          setIgResult('failed'); setIgError(e instanceof Error ? e.message : 'Instagram post failed.')
        }
      }
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Posting failed.')
    } finally {
      setPosting(false)
    }
  }, [canPost, blogPostId, caption, privacy, allowComment, allowDuet, allowStitch, isCommercial, brandedContent, brandedPartnership, info, alsoInstagram, meta?.videoId])

  // Schedule the same post (TikTok, + IG if the toggle is on) for a future time.
  const scheduleSubmit = useCallback(async () => {
    if (!meta?.videoUrl || privacy === '' || !scheduleAt) return
    setScheduling(true); setScheduleError(null); setScheduledMsg(null)
    try {
      const res = await fetch('/api/blog/tiktok-post/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blogPostId,
          caption,
          scheduledAt: new Date(scheduleAt).toISOString(),
          tiktok: {
            privacyLevel: privacy,
            disableComment: !allowComment || (info?.commentDisabled ?? false),
            disableDuet: !allowDuet || (info?.duetDisabled ?? false),
            disableStitch: !allowStitch || (info?.stitchDisabled ?? false),
            brandContentToggle: isCommercial && brandedPartnership,
            brandOrganicToggle: isCommercial && brandedContent,
          },
          instagram: alsoInstagram ? { mode: 'reel' } : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) setScheduleError(json.error || 'Scheduling failed.')
      else setScheduledMsg(`Scheduled for ${new Date(json.scheduledAt).toLocaleString()}${alsoInstagram ? ' (TikTok + Instagram)' : ''}.`)
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : 'Scheduling failed.')
    } finally {
      setScheduling(false)
    }
  }, [meta?.videoUrl, privacy, scheduleAt, blogPostId, caption, allowComment, allowDuet, allowStitch, isCommercial, brandedPartnership, brandedContent, alsoInstagram, info])

  return (
    <>
      <PageHero
        title="Post to TikTok"
        subtitle="Pick how this post should appear on your TikTok account, then publish."
        actions={
          <button onClick={() => router.back()} className="btn-secondary text-sm">
            <X size={14} /> Cancel
          </button>
        }
      />

      {loading ? (
        <div className="card p-10 flex items-center justify-center text-sm text-[#86868b]">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading your TikTok account…
        </div>
      ) : loadError ? (
        <div className="card p-5 border-[#ff3b30]/20 bg-[#ff3b30]/5">
          <p className="text-sm text-[#ff3b30] flex items-center gap-2"><AlertCircle size={14} /> {loadError}</p>
          {reconnectRequired && (
            <a href="/setup?tab=integrations" className="mt-3 inline-block text-xs text-[#7C3AED] hover:underline">
              Go to Integrations → Reconnect TikTok →
            </a>
          )}
        </div>
      ) : !info || !meta ? null : (
        <div className="card p-5 max-w-2xl">
          {/* ── Connected as ──────────────────────────────────────────── */}
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
                {info.displayName || info.username}{info.username ? <span className="text-[#86868b] font-normal"> · @{info.username}</span> : null}
              </p>
            </div>
          </div>

          {/* ── Video preview ─────────────────────────────────────────── */}
          {meta.videoUrl ? (
            <div className="mb-4 rounded-xl overflow-hidden bg-[#000] aspect-[9/16] max-w-[240px] mx-auto">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={meta.videoUrl} controls playsInline className="w-full h-full" />
            </div>
          ) : (
            <div className="mb-4 rounded-xl border border-dashed border-[#d2d2d7] dark:border-white/15 bg-[#f5f5f7]/60 dark:bg-white/[0.03] p-4">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Add a vertical video to post</p>
              <p className="text-xs text-[#86868b] mb-3">
                TikTok needs a 9:16 video. Add one here — it&apos;s shared with Instagram, so you only do this once.
              </p>
              {meta.videoId ? (
                <>
                  {/* In-place upload — patches this post's vertical render, then
                      refetches so the preview + Post button light up. */}
                  <ShortVideoUpload videoId={meta.videoId} onUploaded={refetchMeta} />
                  {/* Don't have the MP4 on hand? Send them to their own video in
                      YouTube Studio, which has a real Download button. */}
                  {meta.youtubeVideoId && (
                    <a
                      href={`https://studio.youtube.com/video/${encodeURIComponent(meta.youtubeVideoId)}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#7C3AED] hover:underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Don&apos;t have the file? Download it from your YouTube video
                    </a>
                  )}
                  <div className="flex items-center gap-3 my-3">
                    <div className="h-px flex-1 bg-[#e5e5ea] dark:bg-white/10" />
                    <span className="text-[11px] uppercase tracking-wide text-[#86868b]">or</span>
                    <div className="h-px flex-1 bg-[#e5e5ea] dark:bg-white/10" />
                  </div>
                  {/* Make one with a Shop Burner CTA box, carrying this post's
                      product context. The burner stores the 9:16 render on the
                      same field, so returning here shows it ready to post. */}
                  <a
                    href={`/instagram-burner?videoId=${encodeURIComponent(meta.videoId)}&productName=${encodeURIComponent(meta.title)}${meta.productUrl ? `&product=${encodeURIComponent(meta.productUrl)}` : ''}&from=tiktok`}
                    className="inline-flex items-center gap-2 text-sm font-medium text-[#7C3AED] hover:underline"
                  >
                    <Flame className="w-4 h-4" />
                    Make one in Shop Burner (add a “Shop Now” sticker)
                  </a>

                  {/* Use a render the creator already made (past upload / burn) —
                      no re-upload. Lists their existing 9:16 videos; clicking one
                      copies its render onto this post. */}
                  <button
                    type="button"
                    onClick={() => { setPickerOpen(o => !o); if (!renders) void loadRenders() }}
                    className="block mt-2 text-sm font-medium text-[#7C3AED] hover:underline"
                  >
                    {pickerOpen ? 'Hide your videos' : 'Use one you already made'}
                  </button>
                  {pickerOpen && (
                    <div className="mt-2">
                      {renders === null ? (
                        <p className="text-xs text-[#86868b]">Loading your videos…</p>
                      ) : renders.length === 0 ? (
                        <p className="text-xs text-[#86868b]">No vertical videos made yet — upload or burn one above.</p>
                      ) : (
                        <div className="grid grid-cols-4 gap-2">
                          {renders.map(r => (
                            <button
                              key={r.videoId}
                              type="button"
                              disabled={attaching}
                              onClick={() => attachRender(r.videoUrl)}
                              title={r.title}
                              className="group relative aspect-[9/16] rounded-md overflow-hidden border border-[#e5e5ea] dark:border-white/10 hover:border-[#7C3AED] disabled:opacity-50"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {r.thumbnailUrl
                                ? <img src={r.thumbnailUrl} alt={r.title} className="w-full h-full object-cover" />
                                : <div className="w-full h-full bg-[#f5f5f7] dark:bg-white/5" />}
                              <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[8px] leading-tight text-white bg-black/55 line-clamp-2 text-left">{r.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-[#9a5d00] bg-[#ff9500]/8 border border-[#ff9500]/20 rounded-lg p-2.5">
                  This post isn&apos;t linked to a video, so there&apos;s no 9:16 render to post. TikTok needs a video — start from a YouTube Short / video-backed post instead.
                </p>
              )}
            </div>
          )}

          {/* ── Caption (editable, prefilled) ─────────────────────────── */}
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1.5">
              Caption
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={2200}
              rows={4}
              className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
            <p className="text-[11px] text-[#86868b] mt-1">{caption.length} / 2200</p>
          </div>

          {/* ── Privacy dropdown — NO default — TikTok hard rule ─────── */}
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
              {info.privacyLevelOptions.map(opt => {
                const blockedForBranded = opt === 'SELF_ONLY' && isCommercial && brandedPartnership
                return (
                  <option key={opt} value={opt} disabled={blockedForBranded}>
                    {PRIVACY_LABELS[opt] || opt}{blockedForBranded ? ' — not allowed for branded content' : ''}
                  </option>
                )
              })}
            </select>
            <p className="text-[11px] text-[#86868b] mt-1">Pulled live from your TikTok account settings.</p>
            {brandedNoPrivate && (
              <p className="text-[11px] text-[#ff3b30] mt-1">Branded content visibility can&apos;t be set to private.</p>
            )}
          </div>

          {/* ── Interaction toggles ──────────────────────────────────── */}
          <div className="mb-4">
            <p className="text-[11px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-2">
              Allow viewers to
            </p>
            <div className="flex flex-col gap-2">
              <Toggle
                icon={<MessageSquare size={14} />}
                label="Comment"
                value={!info.commentDisabled && allowComment}
                disabled={info.commentDisabled}
                onChange={setAllowComment}
                disabledHint={info.commentDisabled ? 'Disabled on your TikTok account' : undefined}
              />
              <Toggle
                icon={<Users size={14} />}
                label="Duet"
                value={!info.duetDisabled && allowDuet}
                disabled={info.duetDisabled}
                onChange={setAllowDuet}
                disabledHint={info.duetDisabled ? 'Disabled on your TikTok account' : undefined}
              />
              <Toggle
                icon={<Scissors size={14} />}
                label="Stitch"
                value={!info.stitchDisabled && allowStitch}
                disabled={info.stitchDisabled}
                onChange={setAllowStitch}
                disabledHint={info.stitchDisabled ? 'Disabled on your TikTok account' : undefined}
              />
            </div>
          </div>

          {/* ── Commercial content disclosure ────────────────────────── */}
          <div className="mb-4 rounded-lg border border-gray-200 dark:border-white/10 p-3">
            <Toggle
              icon={<Lock size={14} />}
              label="This post is commercial content"
              value={isCommercial}
              onChange={setIsCommercial}
            />
            {isCommercial && (
              <div className="mt-3 pl-6 flex flex-col gap-2 border-l border-gray-200 dark:border-white/10">
                <Toggle
                  label="Your Brand"
                  value={brandedContent}
                  onChange={setBrandedContent}
                  small
                />
                <Toggle
                  label="Branded Content"
                  value={brandedPartnership}
                  onChange={(v) => { setBrandedPartnership(v); if (v && privacy === 'SELF_ONLY') setPrivacy('') }}
                  small
                />
                {(brandedContent || brandedPartnership) && (
                  <p className="text-[11px] text-[#86868b]">
                    Your post will be labeled as <strong>{brandedPartnership ? '“Paid partnership”' : '“Promotional content”'}</strong>.
                  </p>
                )}
                {commercialNeedsChoice && (
                  <p className="text-[11px] text-[#ff3b30]">You need to indicate if your content promotes yourself, a third party, or both.</p>
                )}
              </div>
            )}
          </div>

          {/* ── Music usage confirmation — TikTok-mandated copy ──────── */}
          <div className="mb-4 rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e] p-3 flex items-start gap-2 text-[12px] text-[#3a3a3c] dark:text-[#d2d2d7] leading-relaxed">
            <Music size={14} className="text-[#86868b] flex-shrink-0 mt-0.5" />
            <p>
              By posting, you agree to TikTok&apos;s{' '}
              {isCommercial && brandedPartnership && (
                <><a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">Branded Content Policy</a> and </>
              )}
              <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">Music Usage Confirmation</a>.
            </p>
          </div>

          {/* ── Error banners ────────────────────────────────────────── */}
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

          {/* ── Status banners ───────────────────────────────────────── */}
          {publishStatus === 'processing' && (
            <div className="mb-3 card p-3 border-[#7C3AED]/20 bg-[#7C3AED]/5">
              <p className="text-xs text-[#7C3AED] flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Sent to TikTok. Processing — usually 1-3 minutes. You can close this page; the result will show on the Content page.
              </p>
            </div>
          )}
          {publishStatus === 'published' && (
            <div className="mb-3 card p-3 border-[#34c759]/20 bg-[#34c759]/5">
              <p className="text-xs text-[#34c759] flex items-center gap-1.5"><CheckCircle size={12} /> Live on TikTok.</p>
              {shareUrl && (
                <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[#7C3AED] hover:underline">
                  Open on TikTok <ExternalLink size={10} />
                </a>
              )}
            </div>
          )}

          {/* ── Pre-post validation warnings ─────────────────────────── */}
          {meta?.videoUrl && videoWarnings.length > 0 && publishStatus === 'idle' && (
            <div className="mb-3 card p-3 border-[#ff9500]/25 bg-[#ff9500]/5">
              {videoWarnings.map((w, i) => (
                <p key={i} className="text-[11px] text-[#9a5d00] flex items-start gap-1.5">
                  <AlertCircle size={12} className="mt-0.5 flex-shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}

          {/* ── Also post to Instagram (one upload → both) ────────────── */}
          {meta?.videoUrl && publishStatus === 'idle' && (
            <label className="mb-3 flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={alsoInstagram}
                onChange={e => setAlsoInstagram(e.target.checked)}
                className="h-4 w-4 accent-[#E1306C]"
              />
              <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">
                Also post to Instagram as a Reel <span className="text-[#86868b]">(same video + caption)</span>
              </span>
            </label>
          )}
          {/* IG cross-post result — reported separately so it never masks TikTok. */}
          {igResult === 'posting' && (
            <p className="mb-2 text-[11px] text-[#E1306C] flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Also sending to Instagram…</p>
          )}
          {igResult === 'done' && (
            <p className="mb-2 text-[11px] text-[#34c759] flex items-center gap-1.5"><CheckCircle size={11} /> Sent to Instagram too.</p>
          )}
          {igResult === 'failed' && (
            <p className="mb-2 text-[11px] text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={11} /> Instagram: {igError || 'failed'} (TikTok was unaffected.)</p>
          )}

          {/* ── Post button ──────────────────────────────────────────── */}
          <button
            onClick={() => void submit()}
            disabled={!canPost}
            title={commercialNeedsChoice
              ? 'You need to indicate if your content promotes yourself, a third party, or both'
              : brandedNoPrivate
                ? "Branded content visibility can't be set to private"
                : undefined}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg text-sm font-semibold text-white bg-[#ff0050] hover:bg-[#e6004a] disabled:opacity-50"
          >
            {posting
              ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
              : <><Send size={14} /> Post to TikTok</>
            }
          </button>

          {/* ── Schedule for later ───────────────────────────────────── */}
          {meta?.videoUrl && publishStatus === 'idle' && (
            <div className="mt-3 text-center">
              {!scheduleOpen ? (
                <button onClick={() => setScheduleOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7C3AED] hover:underline">
                  <Clock size={13} /> Schedule for later instead
                </button>
              ) : (
                <div className="text-left card p-3 border-[#7C3AED]/20 bg-[#7C3AED]/[0.03]">
                  <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2 flex items-center gap-1.5">
                    <Clock size={13} /> Schedule this post{alsoInstagram ? ' (TikTok + Instagram)' : ''}
                  </p>
                  <input
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={e => { setScheduleAt(e.target.value); setScheduledMsg(null); setScheduleError(null) }}
                    className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                  <p className="text-[11px] text-[#86868b] mt-1">Uses your settings + caption above. Fires automatically — you can close the page.</p>
                  {scheduledMsg && <p className="mt-2 text-[11px] text-[#34c759] flex items-center gap-1.5"><CheckCircle size={11} /> {scheduledMsg}</p>}
                  {scheduleError && <p className="mt-2 text-[11px] text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={11} /> {scheduleError}</p>}
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => void scheduleSubmit()}
                      disabled={scheduling || !scheduleAt || privacy === '' || commercialNeedsChoice || brandedNoPrivate || !!scheduledMsg}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-50"
                    >
                      {scheduling ? <><Loader2 size={13} className="animate-spin" /> Scheduling…</> : <>Schedule</>}
                    </button>
                    <button onClick={() => setScheduleOpen(false)} className="px-3 py-2 rounded-lg text-sm btn-secondary">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
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
