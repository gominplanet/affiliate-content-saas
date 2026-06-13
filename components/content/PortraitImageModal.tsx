'use client'

/**
 * PortraitImageModal — standalone generator for the Portrait (4:5) AI thumbnail
 * (1080×1350, face + product, with a baked headline overlay). Same engine the
 * Instagram publish flow uses, but decoupled from Instagram: a Studio/Pro user
 * can generate and DOWNLOAD the image without connecting Instagram (which is
 * still pending platform review). No posting — just the image.
 *
 * Reuses /api/instagram/generate-ai-image (video-backed: needs the post's
 * blog_posts id, which maps to a source video + product) and the shared
 * renderThumbnailOverlay canvas helper for the headline.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, RefreshCw, Download, Sparkles } from 'lucide-react'
import { pickWeightedStyleIndex, renderThumbnailOverlay } from '@/lib/thumbnail-overlay'
import { dispatchCapReached } from '@/components/CapReachedBanner'

export function PortraitImageModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [img, setImg] = useState<string | null>(null)
  const [headline, setHeadline] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const ran = useRef(false)

  const generate = useCallback(async (force: boolean) => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/instagram/generate-ai-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, customHeadline: headline.trim() || undefined, force }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) {
        if (data.limitReached) {
          dispatchCapReached(data.error || 'Monthly limit reached.', {
            cap: data.cap || 'instagram_ai', currentTier: data.currentTier, upgrade: data.upgrade,
          })
          onClose()
          return
        }
        throw new Error(data.error || 'Generation failed')
      }
      const rawUrl = data.imageUrl as string
      const hook = (data.overlayHook as string) || ''
      let finalUrl = rawUrl
      if (hook) {
        try {
          const styleIndex = pickWeightedStyleIndex({}, {})
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const textPosition = (data.textPosition as any) || undefined
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const faceBox = (data.faceBox as any) || undefined
          const o = await renderThumbnailOverlay(rawUrl, hook, { width: 1080, height: 1350, styleIndex, position: textPosition, faceBox })
          finalUrl = o.url
        } catch { /* fall back to the clean (text-free) image */ }
      }
      setImg(finalUrl)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusy(false)
    }
  }, [postId, headline, onClose])

  // Auto-generate on open. First call uses the server-side cache (free); the
  // explicit Regenerate button forces a fresh, credit-burning render.
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    void generate(false)
  }, [generate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose, busy])

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl border shadow-xl" style={{ backgroundColor: 'var(--bg, #0E0E11)', borderColor: 'var(--border)' }}>
        <div className="flex items-start justify-between gap-3 p-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start gap-2.5">
            <span className="grid place-items-center w-9 h-9 rounded-xl shrink-0" style={{ background: 'rgba(124,58,237,0.12)', color: '#9D6BFF' }}>
              <Sparkles size={17} />
            </span>
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Portrait (4:5) AI thumbnail</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>1080×1350, your face + the product, with a headline. Download it for socials or a vertical hero.</p>
            </div>
          </div>
          <button onClick={() => !busy && onClose()} className="p-1 rounded-md hover:opacity-70" style={{ color: 'var(--text-2)' }} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3.5">
          <div className="mx-auto w-full max-w-[300px] aspect-[4/5] rounded-xl overflow-hidden grid place-items-center" style={{ background: 'var(--surface-2, rgba(255,255,255,0.04))', border: '1px solid var(--border)' }}>
            {busy ? (
              <div className="flex flex-col items-center gap-2 text-center px-4">
                <Loader2 size={20} className="animate-spin" style={{ color: '#9D6BFF' }} />
                <span className="text-xs" style={{ color: 'var(--text-2)' }}>Rendering your 4:5 image… (~1 min)</span>
              </div>
            ) : img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt="Portrait 4:5 AI thumbnail" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs px-4 text-center" style={{ color: 'var(--text-faint)' }}>{err || 'No image yet.'}</span>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Headline <span style={{ color: 'var(--text-faint)' }}>(optional — leave blank to auto-write)</span></label>
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="e.g. WORTH IT?"
              disabled={busy}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none disabled:opacity-60"
              style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          </div>

          {err && <p className="text-[11px]" style={{ color: '#ff3b30' }}>{err}</p>}

          <div className="flex items-center gap-2 pt-0.5">
            {img && (
              <a
                href={img}
                download="portrait-4x5.jpg"
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] transition-colors"
              >
                <Download size={14} /> Download
              </a>
            )}
            <button
              onClick={() => generate(true)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60"
              style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
              title="Generate a fresh image (uses one of your monthly credits)"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Regenerate
            </button>
            <button onClick={() => !busy && onClose()} className="text-sm px-3 py-2 ml-auto" style={{ color: 'var(--text-2)' }}>Close</button>
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
            Counts as one Portrait (4:5) thumbnail against your monthly allowance. Regenerate burns a fresh credit; re-opening reuses the last image for free.
          </p>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(modal, document.body)
}
