'use client'

/**
 * Product Finder — the "ViralVue but live + in MVP" flow. Enter a keyword + rules
 * (must have a carousel video, min monthly sales, how many to scan); SCOUT runs
 * the Amazon search in the user's own browser, deep-checks each result (monthly
 * sales + carousel-video position), filters by the rules, and returns the
 * winners. Each can be turned into a blog post in one click (the from-link flow).
 * Data is LIVE (read at that moment), not a cached third-party database.
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Loader2, Search, Sparkles, ExternalLink, PackageSearch, MessageSquare } from 'lucide-react'
import { requestProductSearch, type FinderProduct } from '@/lib/extension-frame'
import MessageBrandModal, { type MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'

export default function ProductFinderPage() {
  const [keyword, setKeyword] = useState('')
  const [minSales, setMinSales] = useState('100')
  const [mustVideo, setMustVideo] = useState(false)
  const [maxResults, setMaxResults] = useState('15')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<FinderProduct[] | null>(null)
  const [meta, setMeta] = useState<{ scanned?: number; totalFound?: number } | null>(null)
  const [genning, setGenning] = useState<Record<string, 'busy' | 'done'>>({})
  const [genUrl, setGenUrl] = useState<Record<string, string>>({})
  const [msgProduct, setMsgProduct] = useState<MessageBrandCampaign | null>(null)

  const search = useCallback(async () => {
    if (!keyword.trim()) { toast.error('Enter a keyword to search.'); return }
    setSearching(true); setResults(null); setMeta(null)
    try {
      const r = await requestProductSearch(keyword.trim(), {
        minSales: parseInt(minSales, 10) || 0,
        mustVideo,
        maxResults: Math.min(20, Math.max(1, parseInt(maxResults, 10) || 15)),
      })
      if (!r.ok) {
        if (r.error === 'not-installed') toast.error('Install / enable SCOUT to use the Product Finder.')
        else if (r.error === 'no-results') { setResults([]); toast.message('No products found — try a different keyword.') }
        else if (r.error === 'timeout') toast.error('The scan timed out — try fewer results or a narrower keyword.')
        else toast.error(`Search failed: ${r.error}`)
        setResults(r.products ?? [])
        return
      }
      setResults(r.products ?? [])
      setMeta({ scanned: r.scanned, totalFound: r.totalFound })
      const n = (r.products ?? []).length
      toast.success(n ? `${n} product${n === 1 ? '' : 's'} passed your rules.` : 'No products passed your rules — loosen them and try again.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }, [keyword, minSales, mustVideo, maxResults])

  const generate = useCallback(async (p: FinderProduct) => {
    setGenning(s => ({ ...s, [p.asin]: 'busy' }))
    try {
      const res = await fetch('/api/blog/from-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link: `https://www.amazon.com/dp/${p.asin}`,
          productName: p.title,
          scraped: { title: p.title, imageUrl: p.image, price: p.price },
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Generation failed.'); setGenning(s => ({ ...s, [p.asin]: 'done' })); return }
      toast.success('Post generated and published.')
      setGenning(s => ({ ...s, [p.asin]: 'done' }))
      if (d.url) setGenUrl(s => ({ ...s, [p.asin]: d.url }))
    } catch {
      toast.error('Something went wrong.')
      setGenning(s => ({ ...s, [p.asin]: 'done' }))
    }
  }, [])

  const videoBadge = (pos: FinderProduct['carouselPos']) => {
    if (pos === 'top') return <span className="text-[#34c759] font-semibold text-[11px]" title="Video in the TOP hero carousel">🎬 top</span>
    if (pos === 'bottom') return <span className="text-[#FF9500] font-semibold text-[11px]" title="Video only in the lower carousel">🎬 bottom</span>
    return <span className="text-[11px]" style={{ color: 'var(--text-faint)' }} title="No carousel video">🚫 none</span>
  }
  const fmtSales = (n: number | null) => n == null ? '—' : (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

  const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none'
  const inputStyle = { backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' } as React.CSSProperties

  return (
    <>
      <PageHero
        title="Product Finder"
        subtitle="Search Amazon by keyword + rules — SCOUT reads live sales and carousel-video data in your own browser, then you turn any winner into a post."
      />

      <div className="card p-4 mb-5 max-w-4xl">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_150px_120px] gap-3 items-end">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Keyword</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
              <input value={keyword} onChange={e => setKeyword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !searching) search() }}
                placeholder="e.g. solar outdoor lights" className={inputCls + ' pl-8'} style={inputStyle} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Min sales / mo</label>
            <input type="number" min="0" value={minSales} onChange={e => setMinSales(e.target.value)} className={inputCls} style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Scan up to</label>
            <input type="number" min="1" max="20" value={maxResults} onChange={e => setMaxResults(e.target.value)} className={inputCls} style={inputStyle} />
          </div>
          <button onClick={search} disabled={searching}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60 transition-colors h-[38px]">
            {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
          </button>
        </div>
        <label className="flex items-center gap-2 text-[13px] mt-3 cursor-pointer" style={{ color: 'var(--text)' }}>
          <input type="checkbox" checked={mustVideo} onChange={e => setMustVideo(e.target.checked)} className="accent-[#7C3AED] w-4 h-4" />
          Only products that already have a carousel video
        </label>
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
          SCOUT opens each result's Amazon page in the background to read live monthly sales + video placement, so a scan of {maxResults || '15'} takes ~1–2 min. Data is read at that moment — not a cached database.
        </p>
      </div>

      {searching && (
        <div className="card p-6 max-w-4xl flex items-center gap-3 text-sm" style={{ color: 'var(--text-2)' }}>
          <Loader2 size={16} className="animate-spin" /> Scanning Amazon and deep-checking each product… this runs in the background, hang tight.
        </div>
      )}

      {!searching && results && results.length === 0 && (
        <div className="card p-8 max-w-4xl text-center" style={{ color: 'var(--text-faint)' }}>
          <PackageSearch size={28} className="mx-auto mb-2 opacity-60" />
          No products passed your rules{meta?.totalFound ? ` (scanned ${meta.scanned} of ${meta.totalFound} found)` : ''}. Loosen the min-sales or turn off the video filter.
        </div>
      )}

      {!searching && results && results.length > 0 && (
        <div className="max-w-4xl">
          {meta && <p className="text-[12px] mb-2" style={{ color: 'var(--text-faint)' }}>{results.length} passed · deep-checked {meta.scanned} of {meta.totalFound} Amazon results</p>}
          <div className="card divide-y divide-gray-100 dark:divide-white/10">
            {results.map(p => (
              <div key={p.asin} className="flex items-center gap-3 p-3">
                {p.image
                  ? <img src={p.image} alt="" className="w-12 h-12 rounded object-contain flex-shrink-0" style={{ background: '#fff' }} />
                  : <div className="w-12 h-12 rounded flex-shrink-0" style={{ background: 'var(--surface-2)' }} />}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{p.title}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    <a href={`https://www.amazon.com/dp/${p.asin}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[#7C3AED] hover:underline">{p.asin} <ExternalLink size={9} /></a>
                    {p.price && <span>{p.price}</span>}
                    <span title="Bought in past month">📈 {fmtSales(p.monthlySales)}/mo</span>
                    {videoBadge(p.carouselPos ?? 'none')}
                    {p.rating && <span>★ {p.rating}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => setMsgProduct({ product: p.title, asin: p.asin, commissionPct: null, detailsUrl: '', brandLabel: '' })}
                    title="Compose a brand-outreach pitch for this product (copy + send)"
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12px] font-semibold border"
                    style={{ color: '#7C3AED', borderColor: '#d6c6fb' }}>
                    <MessageSquare size={12} /> Message
                  </button>
                  {genUrl[p.asin]
                    ? <a href={genUrl[p.asin]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#34c759] hover:underline">View post <ExternalLink size={12} /></a>
                    : <button onClick={() => generate(p)} disabled={genning[p.asin] === 'busy'}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60">
                        {genning[p.asin] === 'busy' ? <><Loader2 size={13} className="animate-spin" /> Writing…</> : <><Sparkles size={13} /> Generate post</>}
                      </button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {msgProduct && <MessageBrandModal campaign={msgProduct} onClose={() => setMsgProduct(null)} />}
    </>
  )
}
