// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Brands you've featured" — scouted from the creator's OWN connected Amazon
// storefront (storefront_catalog, synced by SCOUT). Reads /api/storefront/brands,
// which derives the brand of every featured product, ranks them, lists each
// brand's products, and flags the ones live on Creator Connections. Each card
// expands to show the products under the brand and, when the brand is on CC, a
// "Message the brand" button that jumps to that brand in the CC browser.
// Collapsible; self-hides until the storefront is synced.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Tag, ChevronDown, Copy, Check, Handshake, MessageSquare, ExternalLink } from 'lucide-react'

interface BrandProduct { asin: string; title: string | null; image: string | null }
interface Brand {
  brand: string; count: number; image: string | null
  products: BrandProduct[]; cc: boolean; ccCommissionPct: number | null
}
interface Resp {
  ok: boolean; hasData: boolean; brands: Brand[]
  totalProducts: number; uniqueBrands: number; unknown: number; ccCount?: number
}

const PURPLE = '#7C3AED'

export default function StorefrontBrands() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/storefront/brands')
      .then(r => (r.ok ? r.json() : null))
      .then((d: Resp | null) => { if (alive && d) setData(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

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
    const text = data.brands.map(b => `${b.brand} (${b.count})${b.cc ? ' — on Creator Connections' : ''}`).join('\n')
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1600)
    }).catch(() => {})
  }

  const max = data.brands[0]?.count || 1
  const ccCount = data.ccCount ?? data.brands.filter(b => b.cc).length

  return (
    <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-5 py-4 text-left">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>
          <Tag size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Brands you&rsquo;ve featured</p>
          <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>
            <b>{data.uniqueBrands}</b> brand{data.uniqueBrands === 1 ? '' : 's'} across <b>{data.totalProducts}</b> product{data.totalProducts === 1 ? '' : 's'}
            {ccCount > 0 && <> · <b style={{ color: PURPLE }}>{ccCount}</b> on Creator Connections</>}
          </p>
        </div>
        <ChevronDown size={16} style={{ color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {open && (
        <div className="px-5 pb-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              Ranked by how many of your products carry each brand. Tap a brand to see its products; ones on Creator Connections can be messaged.
            </p>
            <button onClick={copyList} className="flex-shrink-0 inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
              {copied ? <><Check size={12} style={{ color: '#34c759' }} /> Copied</> : <><Copy size={12} /> Copy list</>}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.brands.map(b => {
              const isOpen = expanded === b.brand
              return (
                <div key={b.brand} className={`rounded-xl border ${isOpen ? 'sm:col-span-2 lg:col-span-3' : ''}`} style={{ borderColor: isOpen ? PURPLE : 'var(--border)', background: 'var(--surface-2, var(--surface))' }}>
                  <button onClick={() => setExpanded(isOpen ? null : b.brand)} className="w-full flex items-center gap-3 p-2.5 text-left">
                    {b.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.image} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" style={{ background: 'var(--surface)' }} />
                    ) : (
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-[13px] font-bold" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>
                        {b.brand.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{b.brand}</p>
                        {b.cc && (
                          <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-[1px] text-[9px] font-bold flex-shrink-0" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}>
                            <Handshake size={9} /> CC
                          </span>
                        )}
                      </div>
                      <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.max(8, Math.round((b.count / max) * 100))}%`, background: 'linear-gradient(90deg,#7C3AED,#34c759)' }} />
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-[12px] font-semibold tabular-nums" style={{ color: 'var(--text-soft)' }}>{b.count}</span>
                    <ChevronDown size={14} className="flex-shrink-0" style={{ color: 'var(--text-faint)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                  </button>

                  {isOpen && (
                    <div className="px-2.5 pb-2.5 pt-0.5 border-t" style={{ borderColor: 'var(--border)' }}>
                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-2 my-2.5">
                        {b.cc ? (
                          <Link href={`/cc-campaigns?q=${encodeURIComponent(b.brand)}`} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: PURPLE }}>
                            <MessageSquare size={13} /> Message the brand
                          </Link>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>Not on Creator Connections right now.</span>
                        )}
                        {b.cc && b.ccCommissionPct != null && b.ccCommissionPct > 0 && (
                          <span className="text-[11px] font-medium" style={{ color: 'var(--text-soft)' }}>up to {b.ccCommissionPct}% commission</span>
                        )}
                        <span className="text-[11px] ml-auto" style={{ color: 'var(--text-faint)' }}>{b.count} product{b.count === 1 ? '' : 's'}</span>
                      </div>

                      {/* Products under this brand */}
                      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-2">
                        {b.products.map(p => (
                          <a key={p.asin} href={`https://www.amazon.com/dp/${p.asin}`} target="_blank" rel="noopener noreferrer" title={p.title || p.asin} className="group block rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                            <div className="relative aspect-square" style={{ background: 'var(--surface-2, var(--surface))' }}>
                              {p.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.image} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px]" style={{ color: 'var(--text-faint)' }}>{p.asin.slice(-4)}</div>
                              )}
                              <span className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity rounded bg-black/60 text-white p-0.5"><ExternalLink size={10} /></span>
                            </div>
                            <p className="text-[9.5px] leading-tight px-1 py-1 line-clamp-2" style={{ color: 'var(--text-soft)' }}>{p.title || p.asin}</p>
                          </a>
                        ))}
                      </div>
                      {b.count > b.products.length && (
                        <p className="text-[10px] mt-2" style={{ color: 'var(--text-faint)' }}>Showing {b.products.length} of {b.count}.</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
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
