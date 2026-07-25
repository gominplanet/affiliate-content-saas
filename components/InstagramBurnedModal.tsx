'use client'

/**
 * InstagramBurnedModal — review-then-post modal for pushing an ALREADY-rendered
 * vertical Short (a burned clip URL) to Instagram as a Reel. Mirrors the TikTok
 * modal's flow: preview the clip, edit the caption, then Post. Publishing is
 * always an explicit user action (Meta content-publishing policy).
 *
 * Distinct from InstagramDirectModal, which loads a YouTube Short row and posts
 * via /api/instagram/post-direct-video. This one takes a finished burned URL
 * (e.g. from Shorts Studio) and posts via /api/instagram/publish-burned.
 */
import { useCallback, useRef, useState } from 'react'
import { Loader2, AlertCircle, CheckCircle, Send, ExternalLink, X, Instagram } from 'lucide-react'
import { useModalA11y } from '@/components/ui/useModalA11y'

export function InstagramBurnedModal({
  burnedVideoUrl,
  initialCaption,
  onClose,
  onPosted,
}: {
  burnedVideoUrl: string
  initialCaption?: string
  onClose: () => void
  onPosted?: () => void
}) {
  const [caption, setCaption] = useState((initialCaption || '').slice(0, 2200))
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [posted, setPosted] = useState(false)

  const submit = useCallback(async () => {
    if (posting || posted) return
    setPosting(true)
    setPostError(null)
    try {
      const res = await fetch('/api/instagram/publish-burned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: burnedVideoUrl, caption }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setPostError(json.error || 'Instagram publish failed.')
        return
      }
      setPosted(true)
      if (onPosted) onPosted()
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Posting failed.')
    } finally {
      setPosting(false)
    }
  }, [posting, posted, burnedVideoUrl, caption, onPosted])

  const closeAllowed = !posting
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onA11yKey = useModalA11y(true, panelRef, () => { if (closeAllowed) onClose() })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => closeAllowed && onClose()}
      onKeyDown={onA11yKey}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-lg w-full max-h-[92vh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Post Short to Instagram"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
              style={{ background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}
            >
              <Instagram size={16} className="text-white" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Post Short to Instagram</h3>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Review your caption, then post as a Reel</p>
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
          <div className="flex flex-col gap-4">
            <div className="flex justify-center">
              <div className="rounded-xl overflow-hidden bg-[#000] aspect-[9/16] max-w-[200px]">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={burnedVideoUrl} controls playsInline className="w-full h-full" />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1.5">
                Caption (edit freely)
              </label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={2200}
                rows={7}
                className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
              <p className="text-[10px] text-[#86868b] mt-1">{caption.length} / 2200 · Hashtags + disclaimer included.</p>
            </div>

            {postError && (
              <div className="rounded-lg border-[#ff3b30]/20 bg-[#ff3b30]/5 p-3">
                <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {postError}</p>
              </div>
            )}
            {posted && (
              <div className="rounded-lg border-[#34c759]/20 bg-[#34c759]/5 p-3 flex flex-col gap-1">
                <p className="text-xs text-[#34c759] flex items-center gap-1.5"><CheckCircle size={12} /> Reel live on Instagram.</p>
                <a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[#7C3AED] hover:underline self-start">
                  Open Instagram <ExternalLink size={10} />
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100 dark:border-white/10">
          <button onClick={onClose} disabled={!closeAllowed} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={posting || posted}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: posted ? '#34c759' : 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}
          >
            {posting
              ? <><Loader2 size={14} className="animate-spin" /> Posting…</>
              : posted
                ? <><CheckCircle size={14} /> Posted</>
                : <><Send size={14} /> Post to Instagram</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
