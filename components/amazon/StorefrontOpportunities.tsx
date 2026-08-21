'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// StorefrontOpportunities — the highest-value insight on the storefront page:
// products the creator ALREADY made a video for that AREN'T earning. The video
// exists (Creator Hub sync flagged has_video) but there are no Amazon sales
// against it — so the fix is cheap: check the link in the description, refresh
// the pin, re-promote. Surfaced at the TOP so it isn't lost under the catalog.
//
// Self-contained: reads /api/storefront/catalog (same source as the full
// catalog list) and filters to has-video + not-earning. Renders nothing until
// the catalog + video sync have run (no products → no card, no clutter).

import { useCallback, useEffect, useState } from 'react'
import { Video, ExternalLink, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

const ACCENT = '#C2410C'
const int = (n: number) => n.toLocaleString('en-US')

interface CatalogProduct {
  asin: string; title: string; image: string | null; listTitle: string | null
  hasEarnings: boolean; hasVideo: boolean; amazonUrl: string
}
interface CatalogData { hasData?: boolean; products?: CatalogProduct[] }

const PREVIEW = 6

export default function StorefrontOpportunities() {
  const [data, setData] = useState<CatalogData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/storefront/catalog')
      setData(await r.json())
    } catch { setData({ hasData: false }) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading || !data?.hasData) return null

  const all = data.products ?? []
  // The opportunity: a video exists but the product isn't earning.
  const opps = all.filter((p) => p.hasVideo && !p.hasEarnings)
  if (!opps.length) return null

  const shown = expanded ? opps : opps.slice(0, PREVIEW)

  return (
    <div className="rounded-2xl border mb-6 overflow-hidden" style={{ borderColor: 'rgba(234,88,12,0.35)', background: 'linear-gradient(180deg, rgba(234,88,12,0.06), transparent)' }}>
      <div className="px-4 sm:px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-7 h-7 rounded-lg grid place-items-center text-white flex-shrink-0" style={{ backgroundColor: ACCENT }}><Video size={14} /></span>
          <p className="font-bold text-[15px]" style={{ color: 'var(--text)' }}>
            {int(opps.length)} product{opps.length === 1 ? '' : 's'} you have a video for {opps.length === 1 ? 'isn’t' : 'aren’t'} earning
          </p>
        </div>
        <p className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
          You already made the video — these just aren&rsquo;t turning into Amazon sales. Fix the cheap stuff first: check the affiliate link in the description still works, refresh the pinned comment, and re-share. This is your fastest money.
        </p>
      </div>

      <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {shown.map((p) => (
          <div key={p.asin} className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
            {p.image
              ? <img src={p.image} alt="" className="w-10 h-10 rounded-md object-cover flex-shrink-0" style={{ background: 'var(--surface-2, transparent)' }} />
              : <div className="w-10 h-10 rounded-md flex-shrink-0" style={{ background: 'var(--border)' }} />}
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] truncate flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
                <Video size={12} className="flex-shrink-0" style={{ color: ACCENT }} aria-label="Has video" />
                <span className="truncate">{p.title}</span>
              </p>
              <p className="text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>{p.listTitle || p.asin}</p>
            </div>
            <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0" style={{ background: 'rgba(234,88,12,0.14)', color: ACCENT }}>no sales yet</span>
            <a href={p.amazonUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0" style={{ color: 'var(--text-faint)' }} title="Check the product on Amazon"><ExternalLink size={13} /></a>
          </div>
        ))}
      </div>

      {opps.length > PREVIEW && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full px-5 py-2.5 text-[12px] font-semibold flex items-center justify-center gap-1.5 border-t"
          style={{ borderColor: 'var(--border)', color: ACCENT }}
        >
          {expanded
            ? <>Show fewer <ChevronUp size={13} /></>
            : <>Show all {int(opps.length)} <ChevronDown size={13} /></>}
        </button>
      )}
    </div>
  )
}
