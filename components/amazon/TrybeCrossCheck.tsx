// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Already on TRYBE?" — cross-check the brands a creator ALREADY works with
// (their Amazon storefront + TikTok, via getWorkedWithBrands) against the brands
// listed inside TRYBE's "Discover Brands". TRYBE has no public API, so the creator
// pastes the brand names from that screen; MVP matches them by normalized key and
// surfaces the overlap: the brands they're already promoting for free and can now
// pitch for a paid TRYBE deal. Posts to /api/creator/brands/match.

'use client'

import { useState } from 'react'
import { Loader2, Handshake, Check, ChevronDown, ExternalLink } from 'lucide-react'

const PURPLE = '#7C3AED'

interface Match {
  name: string
  worked: boolean
  brand?: string
  amazon?: number
  tiktok?: number
  sources?: string[]
}

export default function TrybeCrossCheck() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<{ matched: number; total: number; matches: Match[] } | null>(null)

  async function run() {
    const names = input.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).slice(0, 500)
    if (!names.length) return
    setLoading(true); setRes(null)
    try {
      const r = await fetch('/api/creator/brands/match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      })
      const d = await r.json()
      const matches: Match[] = Array.isArray(d.matches) ? d.matches : []
      setRes({ matched: matches.filter(m => m.worked).length, total: names.length, matches })
    } catch { /* leave res null → the button re-enables */ }
    finally { setLoading(false) }
  }

  const worked = res?.matches.filter(m => m.worked) ?? []

  return (
    <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-5 py-4 text-left">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>
          <Handshake size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Already on TRYBE? Cross-check your brands</p>
          <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>See which brands from TRYBE&rsquo;s Discover Brands you already promote, so you can pitch them for a paid deal.</p>
        </div>
        <ChevronDown size={16} style={{ color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {open && (
        <div className="px-5 pb-5">
          <ol className="text-[12px] mb-3 space-y-0.5" style={{ color: 'var(--text-soft)' }}>
            <li>1. Open <a href="https://jointrybe.com/creator" target="_blank" rel="noopener noreferrer" className="font-medium inline-flex items-center gap-0.5" style={{ color: PURPLE }}>TRYBE &rarr; Discover Brands <ExternalLink size={11} /></a></li>
            <li>2. Copy the brand names you see and paste them below (one per line, or comma-separated).</li>
            <li>3. We highlight the ones you&rsquo;ve already featured.</li>
          </ol>

          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            rows={4}
            placeholder={'Project: Life\nHigton\nFrosh\nRaised On It\nYardSplash'}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />

          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => void run()}
              disabled={loading || !input.trim()}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: PURPLE }}
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Handshake size={15} />}
              {loading ? 'Checking…' : 'Cross-check'}
            </button>
            {res && (
              <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>
                <b style={{ color: res.matched > 0 ? PURPLE : 'var(--text-soft)' }}>{res.matched}</b> of {res.total} pasted brand{res.total === 1 ? '' : 's'} you already feature.
              </p>
            )}
          </div>

          {res && worked.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-faint)' }}>You already feature these — warm pitch</p>
              <div className="flex flex-wrap gap-2">
                {worked.map(m => (
                  <span key={m.name} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]" style={{ borderColor: PURPLE, background: 'rgba(124,58,237,0.06)', color: 'var(--text)' }}>
                    <Check size={12} style={{ color: PURPLE }} />
                    <span className="font-medium">{m.brand || m.name}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-soft)' }}>
                      {[m.amazon ? `${m.amazon} on Amazon` : null, m.tiktok ? `${m.tiktok} on TikTok` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {res && worked.length === 0 && (
            <p className="mt-4 text-[12px]" style={{ color: 'var(--text-soft)' }}>
              None of those match a brand you&rsquo;ve featured yet. They&rsquo;re still worth exploring on TRYBE as new partners.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
