'use client'

/**
 * TikTokDirectModal — modal version of the /tiktok-publish/video/[videoId]
 * page. Opens from the TikTok pill on a Vertical Videos row, contains the
 * same audit-mandated UI controls (live privacy dropdown, comment/duet/
 * stitch toggles, commercial-content disclosure, Music Usage Confirmation),
 * and posts via the same backend routes.
 *
 * TikTok's app review checklist requires every one of those controls — we
 * keep them in the modal exactly as they appear on the page route. Postiz
 * (an open-source scheduler) got their TikTok app rejected for using a
 * generic post composer with most of these controls missing.
 */
import { useEffect, useState, useCallback } from 'react'
import {
  Loader2, AlertCircle, CheckCircle, Send, ExternalLink, X,
  MessageSquare, Users, Scissors, Music, Lock, RefreshCw, Package, Download,
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
  productResolved?: { title: string; asin: string | null } | null
}

const PRIVACY_LABELS: Record<PrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: 'Public — anyone can see',
  MUTUAL_FOLLOW_FRIENDS: 'Friends — mutual follows only',
  FOLLOWER_OF_CREATOR: 'Followers only',
  SELF_ONLY: 'Only me (private)',
}

export function TikTokDirectModal({
  videoId,
  onClose,
  onPosted,
}: {
  videoId: string
  onClose: () => void
  /** Fires once when the publish status flips to "published". The Vertical
   *  Videos row uses this to update its TikTok pill state. */
  onPosted?: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [info, setInfo] = useState<CreatorInfo | null>(null)
  const [meta, setMeta] = useState<VideoMeta | null>(null)
  const [reconnectRequired, setReconnectRequired] = useState(false)

  // Optional product context — when the user pastes an ASIN / URL we
  // re-fetch the caption with the product info baked in. Empty = "title-
  // only" caption mode (the default state when the modal opens).
  const [productInput, setProductInput] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [productResolved, setProductResolved] = useState<{ title: string; asin: string | null } | null>(null)

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
  // YouTube Short import state — for rows with no IG video URL yet and
  // for "re-import a fresh copy" when the stored video is wrong.
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const loadMeta = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [infoRes, metaRes] = await Promise.all([
        fetch('/api/blog/tiktok-post/creator-info'),
        fetch(`/api/blog/tiktok-post/video-meta?videoId=${encodeURIComponent(videoId)}`),
      ])
      const infoJson = await infoRes.json()
      if (!infoRes.ok) {
        setLoadError(infoJson.error || 'Could not load your TikTok account info.')
        setReconnectRequired(!!infoJson.reconnectRequired)
        return
      }
      setInfo(infoJson.info as CreatorInfo)
      const metaJson = await metaRes.json()
      if (metaRes.ok && metaJson.videoUrl) {
        setMeta(metaJson as VideoMeta)
        setCaption((metaJson.defaultCaption as string) || '')
        setProductResolved((metaJson.productResolved as { title: string; asin: string | null } | null) || null)
      } else {
        setMeta(null)
        setLoadError(metaJson.error || 'No vertical video file ready for this Short.')
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Loading failed.')
    } finally {
      setLoading(false)
    }
  }, [videoId])

  useEffect(() => { void loadMeta() }, [loadMeta])

  // Import / re-import the Short from YouTube. See /api/youtube/import-short
  // for the streaming-download + Supabase Storage upload mechanics.
  const importFromYoutube = useCallback(async () => {
    setImporting(true)
    setImportError(null)
    try {
      const res = await fetch('/api/youtube/import-short', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setImportError(json.error || 'Import failed.')
        return
      }
      await loadMeta()
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setImporting(false)
    }
  }, [videoId, loadMeta])

  // Poll publish status after kicking off Direct Post.
  useEffect(() => {
    if (!publishId || publishStatus === 'published' || publishStatus === 'failed') return
    const tick = async () => {
      try {
        const res = await fetch(`/api/blog/tiktok-post/video/status?videoId=${encodeURIComponent(videoId)}`)
        const json = await res.json()
        if (!res.ok) {
          setPublishError(json.error || 'Status check failed.')
          return
        }
        if (json.status === 'published') {
          setPublishStatus('published')
          setShareUrl(json.shareUrl ?? null)
          if (onPosted) onPosted()
        } else if (json.status === 'failed') {
          setPublishStatus('failed')
          setPublishError(json.errorMessage || 'TikTok rejected the post.')
        }
      } catch { /* tick again on next interval */ }
    }
    const id = setInterval(tick, 5000)
    void tick()
    return () => clearInterval(id)
  }, [publishId, publishStatus, videoId, onPosted])

  const canPost = !!info && !!meta?.videoUrl && privacy !== '' && !posting && publishStatus === 'idle'

  // Re-fetch the caption with whatever product input the user has typed.
  // Idempotent — safe to call on every change of productInput (debounced
  // via the button click below).
  const regenerateCaption = useCallback(async () => {
    setRegenerating(true)
    try {
      const url = `/api/blog/tiktok-post/video-meta?videoId=${encodeURIComponent(videoId)}${productInput.trim() ? `&productInput=${encodeURIComponent(productInput.trim())}` : ''}`
      const res = await fetch(url)
      const json = await res.json()
      if (res.ok && json.defaultCaption) {
        setCaption(json.defaultCaption)
        setProductResolved(json.productResolved || null)
      }
    } catch { /* swallow — old caption still usable */ }
    finally { setRegenerating(false) }
  }, [videoId, productInput])

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

  const closeAllowed = publishStatus !== 'processing'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => closeAllowed && onClose()}
    >
      <div
        className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-lg w-full max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-black flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.45a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.34z" /></svg>
            </span>
            <div>
              <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Post Short to TikTok</h3>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Direct push — no blog post needed</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={!closeAllowed}
            className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] disabled:opacity-40 flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          {loading ? (
            <div className="py-10 flex items-center justify-center text-sm text-[#86868b]">
              <Loader2 size={16} className="animate-spin mr-2" /> Loading + writing your caption…
            </div>
          ) : loadError ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border-[#ff9500]/20 bg-[#ff9500]/5 p-3">
                <p className="text-sm text-[#9a5d00] flex items-start gap-2"><AlertCircle size={14} className="mt-0.5" /> {loadError}</p>
                {reconnectRequired && (
                  <a href="/setup?tab=integrations" className="mt-3 inline-block text-xs text-[#0071e3] hover:underline">
                    Go to Integrations → Reconnect TikTok →
                  </a>
                )}
              </div>
              {/* Import from YouTube — only surfaces when the row needs a
                  vertical (TikTok is fine, just no MP4 stored yet). */}
              {!reconnectRequired && (
                <div className="rounded-lg border border-[#0071e3]/20 bg-[#0071e3]/5 p-4 flex flex-col items-center gap-3">
                  <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] text-center">This Short is already on your YouTube channel. We can pull it directly — no upload needed.</p>
                  {importError && <p className="text-xs text-[#ff3b30]">{importError}</p>}
                  <button
                    type="button"
                    onClick={() => void importFromYoutube()}
                    disabled={importing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-60"
                  >
                    {importing
                      ? <><Loader2 size={14} className="animate-spin" /> Pulling from YouTube… (15-60s)</>
                      : <><Download size={14} /> Import from YouTube</>
                    }
                  </button>
                </div>
              )}
            </div>
          ) : !info || !meta ? null : (
            <div className="flex flex-col gap-4">
              {/* Connected as */}
              <div className="flex items-center gap-3 pb-3 border-b border-gray-100 dark:border-white/10">
                {info.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={info.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e]" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-[#86868b] uppercase tracking-wide font-semibold">Posting as</p>
                  <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {info.displayName || info.username || 'Your TikTok account'}{info.username ? <span className="text-[#86868b] font-normal"> · @{info.username}</span> : null}
                  </p>
                </div>
              </div>

              {/* Video preview */}
              {meta.videoUrl && (
                <div className="flex flex-col items-center gap-1.5">
                  <div className="rounded-xl overflow-hidden bg-[#000] aspect-[9/16] max-w-[200px]">
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video src={meta.videoUrl} controls playsInline className="w-full h-full" />
                  </div>
                  <button
                    type="button"
                    onClick={() => void importFromYoutube()}
                    disabled={importing}
                    className="text-[10px] text-[#86868b] hover:text-[#0071e3] inline-flex items-center gap-1 disabled:opacity-50"
                    title="Replace this with a fresh copy from YouTube"
                  >
                    {importing
                      ? <><Loader2 size={10} className="animate-spin" /> Re-importing…</>
                      : <><Download size={10} /> Wrong video? Re-import from YouTube</>
                    }
                  </button>
                  {importError && <p className="text-[10px] text-[#ff3b30]">{importError}</p>}
                </div>
              )}

              {/* Product input — optional. Paste an ASIN / Amazon URL /
                  Geniuslink and we re-fetch the caption with real product
                  info baked in (hook + value line + better hashtags). */}
              <div>
                <label className="block text-[10px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <Package size={11} /> Product (optional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={productInput}
                    onChange={(e) => setProductInput(e.target.value)}
                    placeholder="ASIN (B08TT4YHG1), Amazon URL, or Geniuslink"
                    className="flex-1 text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                  <button
                    type="button"
                    onClick={() => void regenerateCaption()}
                    disabled={regenerating}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-xs font-semibold text-white bg-[#5856d6] hover:bg-[#4845b4] disabled:opacity-60"
                    title="Regenerate the caption using the product info above"
                  >
                    {regenerating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    {regenerating ? 'Writing…' : 'Refresh'}
                  </button>
                </div>
                {productResolved && (
                  <p className="text-[10px] text-[#34c759] mt-1">
                    ✓ Using product: <strong>{productResolved.title.slice(0, 80)}{productResolved.title.length > 80 ? '…' : ''}</strong>
                    {productResolved.asin && <span className="text-[#86868b]"> · {productResolved.asin}</span>}
                  </p>
                )}
                {!productResolved && productInput && (
                  <p className="text-[10px] text-[#86868b] mt-1">Click Refresh to apply the product to the caption.</p>
                )}
              </div>

              {/* Caption */}
              <div>
                <label className="block text-[10px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1.5">
                  Caption (AI-generated — edit freely)
                </label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={2200}
                  rows={6}
                  className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                />
                <p className="text-[10px] text-[#86868b] mt-1">{caption.length} / 2200 · Hashtags + disclaimer included.</p>
              </div>

              {/* Privacy — NO default */}
              <div>
                <label className="block text-[10px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1.5">
                  Who can view this <span className="text-[#ff3b30]">*</span>
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
              </div>

              {/* Interaction toggles */}
              <div>
                <p className="text-[10px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-2">
                  Allow viewers to
                </p>
                <div className="flex flex-col gap-1.5">
                  <Toggle icon={<MessageSquare size={13} />} label="Comment" value={!info.commentDisabled && allowComment} disabled={info.commentDisabled} onChange={setAllowComment} disabledHint={info.commentDisabled ? 'Disabled on TikTok' : undefined} />
                  <Toggle icon={<Users size={13} />} label="Duet" value={!info.duetDisabled && allowDuet} disabled={info.duetDisabled} onChange={setAllowDuet} disabledHint={info.duetDisabled ? 'Disabled on TikTok' : undefined} />
                  <Toggle icon={<Scissors size={13} />} label="Stitch" value={!info.stitchDisabled && allowStitch} disabled={info.stitchDisabled} onChange={setAllowStitch} disabledHint={info.stitchDisabled ? 'Disabled on TikTok' : undefined} />
                </div>
              </div>

              {/* Commercial content */}
              <div className="rounded-lg border border-gray-200 dark:border-white/10 p-3">
                <Toggle icon={<Lock size={13} />} label="This is commercial content" value={isCommercial} onChange={setIsCommercial} />
                {isCommercial && (
                  <div className="mt-2.5 pl-5 flex flex-col gap-1.5 border-l border-gray-200 dark:border-white/10">
                    <Toggle label="Your own brand" value={brandedContent} onChange={setBrandedContent} small />
                    <Toggle label="Branded content (partnership)" value={brandedPartnership} onChange={setBrandedPartnership} small />
                  </div>
                )}
              </div>

              {/* Music Usage Confirmation */}
              <div className="rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e] p-3 flex items-start gap-2 text-[11px] text-[#3a3a3c] dark:text-[#d2d2d7] leading-relaxed">
                <Music size={13} className="text-[#86868b] flex-shrink-0 mt-0.5" />
                <p>
                  By posting, you confirm your video complies with TikTok&apos;s <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">Music Usage Confirmation</a>.
                </p>
              </div>

              {postError && (
                <div className="rounded-lg border-[#ff3b30]/20 bg-[#ff3b30]/5 p-3">
                  <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {postError}</p>
                </div>
              )}
              {publishError && (
                <div className="rounded-lg border-[#ff3b30]/20 bg-[#ff3b30]/5 p-3">
                  <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {publishError}</p>
                </div>
              )}
              {publishStatus === 'processing' && (
                <div className="rounded-lg border-[#0071e3]/20 bg-[#0071e3]/5 p-3">
                  <p className="text-xs text-[#0071e3] flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" />
                    Sent to TikTok. Processing — 1-3 min.
                  </p>
                </div>
              )}
              {publishStatus === 'published' && (
                <div className="rounded-lg border-[#34c759]/20 bg-[#34c759]/5 p-3">
                  <p className="text-xs text-[#34c759] flex items-center gap-1.5"><CheckCircle size={12} /> Live on TikTok.</p>
                  {shareUrl && (
                    <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#0071e3] hover:underline">
                      Open on TikTok <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {!loading && !loadError && info && meta && (
          <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100 dark:border-white/10">
            <button onClick={onClose} disabled={!closeAllowed} className="btn-secondary text-sm">Cancel</button>
            <button
              onClick={() => void submit()}
              disabled={!canPost}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#ff0050] hover:bg-[#e6004a] disabled:opacity-50"
            >
              {posting
                ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
                : <><Send size={14} /> Post to TikTok</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
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
      <span className={`flex items-center gap-1.5 ${small ? 'text-xs' : 'text-[13px]'} text-[#1d1d1f] dark:text-[#f5f5f7] ${disabled ? 'opacity-50' : ''}`}>
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
