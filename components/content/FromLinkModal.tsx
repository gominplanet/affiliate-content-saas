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

export function FromLinkModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [link, setLink] = useState('')
  const [name, setName] = useState('')
  const [angle, setAngle] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
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
    try {
      const res = await fetch('/api/blog/from-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: link.trim(), productName: name.trim(), angle: angle.trim(), category: category.trim() }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Generation failed. Try again.'); setBusy(false); return }
      toast.success('Post generated and published.')
      setDone({ url: d.url, title: d.title })
      onDone()
    } catch {
      toast.error('Something went wrong. Try again.')
    } finally {
      setBusy(false)
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
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>No video needed — paste a product and MVP researches, writes &amp; publishes it.</p>
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
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Product link or Amazon ASIN <span style={{ color: 'var(--text-faint)' }}>(any store / affiliate link works)</span></label>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://amzn.to/… or B0XXXXXXXX or any store link" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Product / service name <span style={{ color: 'var(--text-faint)' }}>(optional — helps if the link is a cloaked redirect)</span></label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anker 737 Power Bank" className={inputCls} style={inputStyle} />
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
              MVP researches the product (the link, its name, and the web), writes a review in your voice grounded in real facts, recloaks your link with Geniuslink if connected, and adds a hero image. Counts as one post.
            </p>
            <button
              onClick={generate}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60 transition-colors"
            >
              {busy ? <><Loader2 size={15} className="animate-spin" /> Researching &amp; writing… (~1–2 min)</> : <><Sparkles size={15} /> Generate &amp; publish</>}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(modal, document.body)
}
