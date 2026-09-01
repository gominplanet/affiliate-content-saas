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
import { igDmEnabled } from '@/lib/feature-flags'

export function InstagramBurnedModal({
  burnedVideoUrl,
  initialCaption,
  defaultDmLink,
  product,
  productTitle,
  coverOffsetMs,
  onClose,
  onPosted,
}: {
  burnedVideoUrl: string
  initialCaption?: string
  /** Prefills the auto-DM link (e.g. the clip's product/affiliate link). */
  defaultDmLink?: string
  /** Clip Factory product link + name (from the Enhance step). When the creator's
   *  Link in Bio has auto-import on, publishing adds it as a shop tile — sent
   *  independently of the auto-DM toggle. */
  product?: string
  productTitle?: string
  /** Reel COVER frame, ms into the burned clip (chosen in the picker). Passed
   *  through to publish as thumb_offset. null/undefined = IG default frame. */
  coverOffsetMs?: number | null
  onClose: () => void
  onPosted?: () => void
}) {
  const [caption, setCaption] = useState((initialCaption || '').slice(0, 2200))
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [posted, setPosted] = useState(false)

  // Auto-DM: commenting `dmKeyword` on the Reel DMs `dmLink` to that person.
  // Hidden until Meta approves the messaging permissions (igDmEnabled).
  const dmAvailable = igDmEnabled()
  const [autoDm, setAutoDm] = useState(dmAvailable && !!(defaultDmLink && defaultDmLink.trim()))
  const [dmKeyword, setDmKeyword] = useState('LINK')
  const [dmLink, setDmLink] = useState((defaultDmLink || '').trim())

  const submit = useCallback(async () => {
    if (posting || posted) return
    const wantDm = autoDm && /^https?:\/\//i.test(dmLink.trim())
    setPosting(true)
    setPostError(null)
    try {
      const res = await fetch('/api/instagram/publish-burned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: burnedVideoUrl,
          caption,
          ...(product && product.trim() ? { product: product.trim(), productTitle: (productTitle || '').trim() } : {}),
          ...(typeof coverOffsetMs === 'number' && coverOffsetMs >= 0 ? { thumbOffsetMs: Math.round(coverOffsetMs) } : {}),
          ...(wantDm ? { autoDm: { link: dmLink.trim(), keyword: dmKeyword.trim() || 'LINK' } } : {}),
        }),
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
  }, [posting, posted, burnedVideoUrl, caption, product, productTitle, coverOffsetMs, autoDm, dmKeyword, dmLink, onPosted])

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

            {/* Auto-DM: comment a keyword → DM the link. Gated until Meta
                approves the messaging permissions. */}
            {dmAvailable && (
            <div className="rounded-lg border border-gray-200 dark:border-white/10 p-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={autoDm} onChange={(e) => setAutoDm(e.target.checked)} className="accent-[#7C3AED]" />
                <span className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Auto-DM the link when someone comments</span>
              </label>
              {autoDm && (
                <div className="mt-2.5 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[#86868b] shrink-0">When they comment</span>
                    <input
                      value={dmKeyword}
                      onChange={(e) => setDmKeyword(e.target.value.replace(/\s+/g, ' ').trimStart().slice(0, 30))}
                      placeholder="LINK"
                      className="flex-1 text-sm px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                    />
                  </div>
                  <input
                    value={dmLink}
                    onChange={(e) => setDmLink(e.target.value)}
                    placeholder="Link to DM them (https://…)"
                    className="w-full text-sm px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                  <p className="text-[10px] text-[#86868b]">
                    Anyone who comments <span className="font-semibold">{(dmKeyword || 'LINK').toUpperCase()}</span> on this Reel gets your link in their DMs automatically. Tip: add &quot;Comment {(dmKeyword || 'LINK').toUpperCase()} for the link&quot; to the caption or the video.
                  </p>
                </div>
              )}
            </div>
            )}

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
