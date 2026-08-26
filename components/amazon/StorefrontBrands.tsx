// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Brands you've featured" — scouted from the creator's OWN connected Amazon
// storefront (storefront_catalog, synced by SCOUT). Reads /api/storefront/brands,
// which derives the brand of every featured product and ranks them. Gives the
// creator an instant, deduped list of the brands they've worked with — the answer
// to "which brands have I actually featured?" for outreach, media kits, and
// brand-deal pitches. Collapsible; self-hides until the storefront is synced.

'use client'

import { useEffect, useState } from 'react'
import { Loader2, Tag, ChevronDown, Copy, Check } from 'lucide-react'

interface Brand { brand: string; count: number; asins: string[]; image: string | null }
interface Resp { ok: boolean; hasData: boolean; brands: Brand[]; totalProducts: number; uniqueBrands: number; unknown: number }

export default function StorefrontBrands() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/storefront/brands')
      .then(r => (r.ok ? r.json() : null))
      .then((d: Resp | null) => { if (alive && d) setData(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // Nothing synced yet → stay quiet (the catalog card owns the sync prompt).
  if (loading) {
    return (
      <div className="rounded-2xl border p-5 flex items-center gap-2 text-[13px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-soft)' }}>
        <Loader2 size={14} className="animate-spin" /> Scanning your storefront for brands…
      </div>
    )
  }
  if (!data || !data.hasData || data.brands.length === 0) return null

  function copyList() {
    if (!data) return
    const text = data.brands.map(b => `${b.brand} (${b.count})`).join('\n')
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1600)
    }).catch(() => {})
  }

  const max = data.brands[0]?.count || 1

  return (
    <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(124,58,237,0.10)', color: '#7C3AED' }}>
          <Tag size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Brands you&rsquo;ve featured</p>
          <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>
            <b>{data.uniqueBrands}</b> brand{data.uniqueBrands === 1 ? '' : 's'} across <b>{data.totalProducts}</b> product{data.totalProducts === 1 ? '' : 's'} on your storefront
          </p>
        </div>
        <ChevronDown size={16} style={{ color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {open && (
        <div className="px-5 pb-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              Ranked by how many of your products carry each brand. Great for brand-deal outreach and your media kit.
            </p>
            <button
              onClick={copyList}
              className="flex-shrink-0 inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}
            >
              {copied ? <><Check size={12} style={{ color: '#34c759' }} /> Copied</> : <><Copy size={12} /> Copy list</>}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.brands.map(b => (
              <div
                key={b.brand}
                className="flex items-center gap-3 rounded-xl border p-2.5"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-2, var(--surface))' }}
              >
                {b.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.image} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" style={{ background: 'var(--surface)' }} />
                ) : (
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-[13px] font-bold" style={{ background: 'rgba(124,58,237,0.10)', color: '#7C3AED' }}>
                    {b.brand.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{b.brand}</p>
                  <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max(8, Math.round((b.count / max) * 100))}%`, background: 'linear-gradient(90deg,#7C3AED,#34c759)' }} />
                  </div>
                </div>
                <span className="flex-shrink-0 text-[12px] font-semibold tabular-nums" style={{ color: 'var(--text-soft)' }}>{b.count}</span>
              </div>
            ))}
          </div>

          {data.unknown > 0 && (
            <p className="mt-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {data.unknown} product{data.unknown === 1 ? '' : 's'} had no clear brand in the title and aren&rsquo;t counted above.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
