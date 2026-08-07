'use client'

/**
 * FromLinkModal — generate a blog post from a product link / ASIN, no video.
 * Posts to /api/blog/from-link, which researches the product, writes a
 * review with MVP's rules + the creator's voice, recloaks the link via
 * Geniuslink, makes a hero image, and publishes to WordPress as a normal
 * post (lands in the Posts tab). Self-contained: own state + fetch.
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { X, Loader2, Link2, ExternalLink, Sparkles } from 'lucide-react'
import { requestScrapeUrl } from '@/lib/extension-frame'

// Amazon links already have a dedicated server path (ASIN scrape + SCOUT /dp
// fallback), so we only route NON-Amazon store links through the SCOUT reader.
function isAmazonLink(u: string): boolean {
  const s = u.trim()
  return /(^|\.)amazon\.[a-z.]+/i.test(s) || /amzn\.(to|com)/i.test(s) || /geni\.us/i.test(s) || /^[A-Z0-9]{10}$/i.test(s)
}

export function FromLinkModal({ onClose, onDone, initialLink, initialName, initialCategory }: {
  onClose: () => void
  onDone: () => void
  /** Optional prefill — e.g. opened from a campaign card with the product's ASIN. */
  initialLink?: string
  initialName?: string
  initialCategory?: string
}) {
  const [link, setLink] = useState(initialLink ?? '')
  const [name, setName] = useState(initialName ?? '')
  const [angle, setAngle] = useState('')
  const [category, setCategory] = useState(initialCategory ?? '')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'scout' | 'write' | 'images'>('idle')
  const [done, setDone] = useState<{ url: string; title: string } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose, busy])

  async function generate() {
    if (!link.trim() && !name.trim()) { toast.error('Paste a product link or ASIN — or at least the product name.'); return }
    setBusy(true)
    setPhase('write')
    try {
      const raw = link.trim()
      // Non-Amazon store link → have SCOUT read the page in the user's own
      // browser first (Walmart/Target/etc. block MVP's server scrape). The
      // scraped title/specs/image ground the post; best-effort, so if SCOUT
      // isn't installed or the store isn't supported we just skip it and the
      // endpoint falls back to URL-slug name + web-search research.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let scraped: any = null
      if (raw && /^https?:\/\//i.test(raw) && !isAmazonLink(raw)) {
        setPhase('scout')
        try {
          const r = await requestScrapeUrl(raw)
          if (r.ok && r.product && r.product.title) {
            scraped = r.product
            toast.message('Read the product page ✓', { description: r.product.title.slice(0, 60) })
          } else if (r.error === 'permission-needed') {
            toast.message('Tip: turn on “Read non-Amazon products” in the SCOUT popup', {
              description: 'It lets SCOUT read this store’s page for a sharper post. Generating from the link for now.',
              duration: 8000,
            })
          }
        } catch { /* ignore — fall back to web research */ }
        setPhase('write')
      }
      const res = await fetch('/api/blog/from-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: raw, productName: name.trim(), angle: angle.trim(), category: category.trim(), scraped }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Generation failed. Try again.'); setBusy(false); setPhase('idle'); return }
      // The post is published with its hero image. from-link doesn't add
      // IN-BODY images server-side, so fire the same reliable image step the
      // video flow uses — it reads your "images per article" brand setting and
      // inserts that many photos. Best-effort: the post already stands without it.
      if (d.postId) {
        setPhase('images')
        try {
          await fetch('/api/blog/refresh-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wordpressPostId: d.postId }),
          })
        } catch { /* non-fatal — published post stands with its hero image */ }
      }
      toast.success('Post generated and published.')
      setDone({ url: d.url, title: d.title })
      onDone()
    } catch {
      toast.error('Something went wrong. Try again.')
    } finally {
      setBusy(false)
      setPhase('idle')
    }
  }

  const inputCls = 'w-full rounded-lg px-3 py-2.5 text-sm outline-none'
  const inputStyle = { backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' } as React.CSSProperties

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div className="w-full max-w-lg rounded-2xl border shadow-xl" style={{ backgroundColor: 'var(--bg, #0E0E11)', borderColor: 'var(--border)' }}>
        <div className="flex items-start justify-between gap-3 p-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start gap-2.5">
            <span className="grid place-items-center w-9 h-9 rounded-xl shrink-0" style={{ background: 'rgba(124,58,237,0.12)', color: '#9D6BFF' }}>
              <Link2 size={17} />
            </span>
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>New post from a link</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>No video needed — paste any product or service link and MVP researches, writes &amp; publishes it.</p>
            </div>
          </div>
          <button onClick={() => !busy && onClose()} className="p-1 rounded-md hover:opacity-70" style={{ color: 'var(--text-2)' }} aria-label="Close"><X size={18} /></button>
        </div>

        {done ? (
          <div className="p-5">
            <div className="rounded-lg p-3 text-sm mb-4" style={{ background: 'rgba(52,199,89,0.1)', border: '1px solid rgba(52,199,89,0.3)', color: '#34c759' }}>
              ✓ Published: <strong>{done.title}</strong>. It’s in your Posts tab now — ready to schedule or push to socials.
            </div>
            <div className="flex items-center gap-2">
              {done.url && (
                <a href={done.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] transition-colors">
                  View post <ExternalLink size={13} />
                </a>
              )}
              <button onClick={onClose} className="text-sm px-3 py-2" style={{ color: 'var(--text-2)' }}>Done</button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-3.5">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Product or service link <span style={{ color: 'var(--text-faint)' }}>(any store, brand, SaaS or affiliate link — or an Amazon ASIN)</span></label>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Any product or service URL — a store page, brand site, SaaS page, affiliate link, or Amazon ASIN" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Product / service name <span style={{ color: 'var(--text-faint)' }}>(optional — helps if the link is a cloaked redirect)</span></label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anker 737 Power Bank, or Notion, Audible…" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Angle / focus <span style={{ color: 'var(--text-faint)' }}>(optional)</span></label>
              <input value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="e.g. best for travel; compare value vs premium" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Category <span style={{ color: 'var(--text-faint)' }}>(optional)</span></label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Electronics & Tech" className={inputCls} style={inputStyle} />
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              Works for any product or service — Amazon, any online store, or a SaaS/subscription. MVP researches it (the link, its name, and the web), writes a review in your voice grounded in real facts, recloaks your link with Geniuslink if connected, and adds a hero image. Counts as one post.
            </p>
            <button
              onClick={generate}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60 transition-colors"
            >
              {busy
                ? (phase === 'scout'
                    ? <><Loader2 size={15} className="animate-spin" /> Reading the product page with SCOUT…</>
                    : phase === 'images'
                    ? <><Loader2 size={15} className="animate-spin" /> Adding your images…</>
                    : <><Loader2 size={15} className="animate-spin" /> Researching &amp; writing… (~1–2 min)</>)
                : <><Sparkles size={15} /> Generate &amp; publish</>}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(modal, document.body)
}
