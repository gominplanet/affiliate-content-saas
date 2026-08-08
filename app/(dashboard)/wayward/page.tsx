'use client'

// MVP x Wayward (Labs) — browse the Wayward Amazon-Attribution catalog and mint
// an attributed Amazon link per product (measured back to your Wayward account).
// Needs your own Wayward API key connected in External Integrations.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ShoppingBag, Loader2, Search, Link2, Copy, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react'

const PURPLE = '#7C3AED'

interface Product {
  productId: string
  asin: string
  name: string
  brandName: string | null
  price: number | null
  currency: string | null
  commissionRate: number | null
  imageUrl: string | null
  marketplace: string | null
  isActive: boolean
}

export default function WaywardPage() {
  const [loading, setLoading] = useState(true)
  const [needsToken, setNeedsToken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalProducts, setTotalProducts] = useState(0)
  const [asin, setAsin] = useState('')
  const [linking, setLinking] = useState<string | null>(null)
  const [links, setLinks] = useState<Record<string, string>>({})

  const load = useCallback(async (pageNumber: number, asinFilter: string) => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ page: String(pageNumber), pageSize: '24' })
      if (asinFilter.trim()) qs.set('asin', asinFilter.trim())
      const res = await fetch(`/api/wayward/products?${qs.toString()}`)
      const data = await res.json()
      if (data.needsToken) { setNeedsToken(true); setProducts([]); return }
      if (!data.ok) throw new Error(data.error || 'Failed to load')
      setNeedsToken(false)
      setProducts(data.products || [])
      setPage(data.pageNumber || pageNumber)
      setTotalPages(data.totalPages || 1)
      setTotalProducts(data.totalProducts || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load(1, '') }, [load])

  async function mintLink(p: Product) {
    setLinking(p.asin)
    try {
      const res = await fetch('/api/wayward/link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: p.asin, title: p.name }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Could not generate link')
      setLinks(prev => ({ ...prev, [p.asin]: data.url }))
      try { await navigator.clipboard.writeText(data.url) } catch { /* ignore */ }
      toast.success(data.cloaked ? 'Attributed link (Geniuslink) copied' : 'Attributed link copied')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate link')
    } finally { setLinking(null) }
  }

  const money = (p: Product) => p.price != null ? `${p.currency === 'USD' || !p.currency ? '$' : ''}${p.price}` : ''

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-1">
        <ShoppingBag size={20} style={{ color: PURPLE }} />
        <h1 className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">MVP x Wayward</h1>
        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}>Labs</span>
      </div>
      <p className="text-sm text-[#6e6e73] dark:text-[#a1a1a6] mb-5">
        Browse Wayward&apos;s Amazon Attribution catalog and mint an attributed Amazon link per product — measured and paid back to your Wayward account.
      </p>

      {needsToken ? (
        <div className="rounded-xl border border-black/10 dark:border-white/10 p-6 text-center">
          <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Connect your Wayward API key to use this tool.</p>
          <Link href="/external-integrations" className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: PURPLE }}>
            <Link2 size={14} /> Connect Wayward
          </Link>
          <p className="text-[11px] text-[#86868b] mt-3">Wayward → Settings → API → copy your key into External Integrations.</p>
        </div>
      ) : (
        <>
          {/* Search by ASIN (the catalog is 300k+, so the filter is ASIN-exact). */}
          <form
            onSubmit={e => { e.preventDefault(); load(1, asin) }}
            className="flex items-center gap-2 mb-4"
          >
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
              <input
                value={asin}
                onChange={e => setAsin(e.target.value)}
                placeholder="Filter by ASIN (e.g. B0C8BRDVT6)"
                className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-[var(--surface,#fff)] border border-black/10 dark:border-white/15 text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#7C3AED]"
              />
            </div>
            <button type="submit" className="rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ backgroundColor: PURPLE }}>Search</button>
            {asin && <button type="button" onClick={() => { setAsin(''); load(1, '') }} className="text-xs text-[#86868b] hover:underline">Clear</button>}
            <span className="ml-auto text-[11px] text-[#86868b] tabular-nums">{totalProducts.toLocaleString()} products</span>
          </form>

          {error && <p className="text-sm text-[#ff3b30] mb-3">{error}</p>}

          {loading ? (
            <div className="flex items-center justify-center py-16 text-[#86868b]"><Loader2 className="animate-spin" /></div>
          ) : products.length === 0 ? (
            <p className="text-sm text-[#86868b] py-10 text-center">No products found.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {products.map(p => (
                <div key={p.productId} className="rounded-xl border border-black/5 dark:border-white/10 p-3 flex flex-col">
                  <div className="aspect-square rounded-lg bg-black/[0.03] dark:bg-white/[0.04] overflow-hidden flex items-center justify-center mb-2">
                    {p.imageUrl
                      ? // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt={p.name} className="max-h-full max-w-full object-contain" />
                      : <ShoppingBag size={28} className="text-[#c7c7cc]" />}
                  </div>
                  <p className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] line-clamp-2 leading-snug">{p.name}</p>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-[#86868b]">
                    {money(p) && <span className="tabular-nums">{money(p)}</span>}
                    {p.commissionRate != null && (
                      <span className="font-semibold" style={{ color: '#1f8a3a' }}>{p.commissionRate}% commission</span>
                    )}
                  </div>
                  {p.brandName && <p className="text-[10px] text-[#86868b] mt-0.5 truncate">{p.brandName}</p>}

                  <div className="mt-auto pt-2">
                    {links[p.asin] ? (
                      <button
                        onClick={() => { navigator.clipboard.writeText(links[p.asin]).then(() => toast.success('Copied')).catch(() => {}) }}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-white"
                        style={{ backgroundColor: '#34c759' }}
                      >
                        <Copy size={12} /> Copy link
                      </button>
                    ) : (
                      <button
                        onClick={() => mintLink(p)}
                        disabled={linking === p.asin}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60"
                        style={{ backgroundColor: PURPLE }}
                      >
                        {linking === p.asin ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Get link
                      </button>
                    )}
                    <a
                      href={`https://www.amazon.com/dp/${p.asin}`}
                      target="_blank" rel="noreferrer"
                      className="mt-1 w-full inline-flex items-center justify-center gap-1 text-[10px] text-[#86868b] hover:underline"
                    >
                      <ExternalLink size={9} /> {p.asin}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pager (disabled while filtering to one ASIN). */}
          {!asin && totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-5 text-sm">
              <button onClick={() => page > 1 && load(page - 1, '')} disabled={page <= 1 || loading}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/15 disabled:opacity-40">
                <ChevronLeft size={14} /> Prev
              </button>
              <span className="text-[12px] text-[#86868b] tabular-nums">Page {page.toLocaleString()} / {totalPages.toLocaleString()}</span>
              <button onClick={() => page < totalPages && load(page + 1, '')} disabled={page >= totalPages || loading}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/15 disabled:opacity-40">
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
