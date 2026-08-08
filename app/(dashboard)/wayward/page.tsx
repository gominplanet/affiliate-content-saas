'use client'

// MVP x Wayward (Labs) — browse the Wayward Amazon-Attribution catalog, filter by
// brand, sort by commission, mint attributed links, save finds, quick-post to
// socials, and generate blog posts (per-product or across all Saved). Needs the
// user's Wayward API key (External Integrations).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ShoppingBag, Loader2, Search, Link2, Copy, ExternalLink, ChevronLeft, ChevronRight,
  Bookmark, BookmarkCheck, FileText, ClipboardList, Tag, ArrowDownWideNarrow, X, Send,
} from 'lucide-react'
import WaywardQuickPostModal from '@/components/wayward/WaywardQuickPostModal'

const PURPLE = '#7C3AED'

interface Product {
  productId: string; asin: string; name: string; brandName: string | null
  price: number | null; currency: string | null; commissionRate: number | null
  imageUrl: string | null; marketplace: string | null; isActive: boolean
}
interface Brand { id: string; name: string; avgCommission: number | null; activeProductsCount: number | null }

function bigImg(u: string | null): string | null {
  if (!u) return u
  return u.replace(/\._[A-Z]{1,2}\d+_\./i, '._SL500_.')
}

export default function WaywardPage() {
  const [tab, setTab] = useState<'catalog' | 'saved'>('catalog')
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
  const [savedAsins, setSavedAsins] = useState<Set<string>>(new Set())
  const [savedItems, setSavedItems] = useState<Product[]>([])
  const [savingAsin, setSavingAsin] = useState<string | null>(null)
  const [genAsin, setGenAsin] = useState<string | null>(null)
  const [genAll, setGenAll] = useState(false)
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandOpen, setBrandOpen] = useState(false)
  const [brandQuery, setBrandQuery] = useState('')
  const [selBrand, setSelBrand] = useState<Brand | null>(null)
  const [sortByComm, setSortByComm] = useState(false)
  const [postItem, setPostItem] = useState<{ asin: string; name: string; imageUrl: string | null } | null>(null)

  const load = useCallback(async (pageNumber: number, asinFilter: string, brandId?: string) => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ page: String(pageNumber), pageSize: '24' })
      if (asinFilter.trim()) qs.set('asin', asinFilter.trim())
      if (brandId) qs.set('brandId', brandId)
      const res = await fetch(`/api/wayward/products?${qs.toString()}`)
      const data = await res.json()
      if (data.needsToken) { setNeedsToken(true); setProducts([]); return }
      if (!data.ok) throw new Error(data.error || 'Failed to load')
      setNeedsToken(false)
      setProducts(data.products || [])
      setPage(data.pageNumber || pageNumber)
      setTotalPages(data.totalPages || 1)
      setTotalProducts(data.totalProducts || 0)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') } finally { setLoading(false) }
  }, [])

  const loadSaved = useCallback(async () => {
    try {
      const d = await (await fetch('/api/wayward/saved')).json()
      if (d.ok && Array.isArray(d.saved)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: Product[] = d.saved.map((s: any) => ({
          productId: s.id, asin: s.asin, name: s.title || s.asin, brandName: s.brand || null,
          price: s.price ?? null, currency: 'USD', commissionRate: s.commission_pct ?? null,
          imageUrl: s.image_url || null, marketplace: s.marketplace || 'amazon.com', isActive: true,
        }))
        setSavedItems(rows)
        setSavedAsins(new Set(rows.map(r => r.asin)))
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load(1, '') }, [load])
  useEffect(() => { loadSaved() }, [loadSaved])
  useEffect(() => {
    fetch('/api/wayward/brands').then(r => r.json()).then(d => {
      if (d.ok && Array.isArray(d.brands)) setBrands([...d.brands].sort((a: Brand, b: Brand) => (b.avgCommission ?? 0) - (a.avgCommission ?? 0)))
    }).catch(() => {})
  }, [])

  function pickBrand(b: Brand | null) { setSelBrand(b); setBrandOpen(false); setBrandQuery(''); setAsin(''); load(1, '', b?.id) }

  async function mintLink(p: Product) {
    setLinking(p.asin)
    try {
      const res = await fetch('/api/wayward/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asin: p.asin, title: p.name }) })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Could not generate link')
      setLinks(prev => ({ ...prev, [p.asin]: data.url }))
      try { await navigator.clipboard.writeText(data.url) } catch { /* ignore */ }
      toast.success(data.cloaked ? 'Attributed link (Geniuslink) copied' : 'Attributed link copied')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not generate link') } finally { setLinking(null) }
  }

  async function toggleSave(p: Product) {
    const isSaved = savedAsins.has(p.asin); setSavingAsin(p.asin)
    try {
      if (isSaved) {
        await fetch(`/api/wayward/saved?asin=${encodeURIComponent(p.asin)}`, { method: 'DELETE' })
        setSavedAsins(prev => { const n = new Set(prev); n.delete(p.asin); return n })
        setSavedItems(prev => prev.filter(s => s.asin !== p.asin))
      } else {
        await fetch('/api/wayward/saved', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asin: p.asin, title: p.name, brand: p.brandName, imageUrl: p.imageUrl, commissionPct: p.commissionRate, price: p.price, marketplace: p.marketplace }) })
        setSavedAsins(prev => new Set(prev).add(p.asin))
        setSavedItems(prev => prev.some(s => s.asin === p.asin) ? prev : [{ ...p }, ...prev])
        toast.success('Saved')
      }
    } catch { toast.error('Could not update saved') } finally { setSavingAsin(null) }
  }

  async function generatePost(p: Product): Promise<boolean> {
    setGenAsin(p.asin)
    toast.loading('Writing & publishing…', { id: `gen-${p.asin}` })
    try {
      const res = await fetch('/api/wayward/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product: { asin: p.asin, title: p.name, image: p.imageUrl, price: p.price, brandName: p.brandName } }) })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Generation failed')
      toast.success('Post published', { id: `gen-${p.asin}`, action: data.wordpressUrl ? { label: 'View', onClick: () => window.open(data.wordpressUrl, '_blank') } : undefined })
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Generation failed', { id: `gen-${p.asin}` }); return false } finally { setGenAsin(null) }
  }

  async function generateAllSaved() {
    if (!savedItems.length) return
    if (!confirm(`Generate and publish ${savedItems.length} blog post${savedItems.length > 1 ? 's' : ''} from your saved products? This uses AI credits and posts to your blog.`)) return
    setGenAll(true)
    let ok = 0, fail = 0
    for (let i = 0; i < savedItems.length; i++) {
      toast.message(`Generating ${i + 1}/${savedItems.length}…`)
      // eslint-disable-next-line no-await-in-loop
      const done = await generatePost(savedItems[i])
      done ? ok++ : fail++
      if (fail >= 2) { toast.error('Stopped after repeated failures.'); break } // fail-safe
    }
    setGenAll(false)
    toast.success(`Done — ${ok} published${fail ? `, ${fail} failed` : ''}.`)
  }

  const money = (p: Product) => p.price != null ? `${p.currency === 'USD' || !p.currency ? '$' : ''}${p.price}` : ''

  // Shared product card, used by both the Catalog and Saved tabs.
  function Card({ p }: { p: Product }) {
    const saved = savedAsins.has(p.asin); const busyGen = genAsin === p.asin
    return (
      <div className="rounded-xl border border-black/5 dark:border-white/10 p-3 flex flex-col">
        <div className="aspect-[4/3] rounded-lg bg-white overflow-hidden flex items-center justify-center mb-2">
          {p.imageUrl
            ? // eslint-disable-next-line @next/next/no-img-element
              <img src={bigImg(p.imageUrl) || ''} alt={p.name} loading="lazy" className="max-h-full max-w-full object-contain" />
            : <ShoppingBag size={40} className="text-[#c7c7cc]" />}
        </div>
        <p className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] line-clamp-2 leading-snug">{p.name}</p>
        <div className="flex items-center gap-2 mt-1 text-[12px] text-[#86868b]">
          {money(p) && <span className="tabular-nums font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{money(p)}</span>}
          {p.commissionRate != null && <span className="font-semibold" style={{ color: '#1f8a3a' }}>{p.commissionRate}% commission</span>}
        </div>
        {p.brandName && <p className="text-[11px] text-[#86868b] mt-0.5 truncate">{p.brandName}</p>}
        <div className="mt-auto pt-2 flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            {links[p.asin] ? (
              <button onClick={() => { navigator.clipboard.writeText(links[p.asin]).then(() => toast.success('Copied')).catch(() => {}) }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-white" style={{ backgroundColor: '#34c759' }}><Copy size={12} /> Copy link</button>
            ) : (
              <button onClick={() => mintLink(p)} disabled={linking === p.asin}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60" style={{ backgroundColor: PURPLE }}>
                {linking === p.asin ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Get link</button>
            )}
            <button onClick={() => generatePost(p)} disabled={busyGen || genAll}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold border border-[#7C3AED]/40 text-[#7C3AED] hover:bg-[#7C3AED]/5 disabled:opacity-60">
              {busyGen ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} {busyGen ? 'Writing…' : 'Generate post'}</button>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => toggleSave(p)} disabled={savingAsin === p.asin}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium border border-black/10 dark:border-white/15 text-[#4b4b4f] dark:text-[#b0b0b5] disabled:opacity-60">
              {saved ? <BookmarkCheck size={12} style={{ color: PURPLE }} /> : <Bookmark size={12} />} {saved ? 'Saved' : 'Save'}</button>
            <button onClick={() => setPostItem({ asin: p.asin, name: p.name, imageUrl: bigImg(p.imageUrl) })}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium border border-black/10 dark:border-white/15 text-[#4b4b4f] dark:text-[#b0b0b5]"><Send size={12} /> Post</button>
            <a href={`https://www.amazon.com/dp/${p.asin}`} target="_blank" rel="noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium border border-black/10 dark:border-white/15 text-[#4b4b4f] dark:text-[#b0b0b5]"><ExternalLink size={12} /> Visit</a>
          </div>
        </div>
      </div>
    )
  }

  const shown = sortByComm ? [...products].sort((a, b) => (b.commissionRate ?? 0) - (a.commissionRate ?? 0)) : products
  const filteredBrands = brandQuery.trim()
    ? brands.filter(b => b.name.toLowerCase().includes(brandQuery.trim().toLowerCase())).slice(0, 60)
    : brands.slice(0, 60)

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <ShoppingBag size={20} style={{ color: PURPLE }} />
        <h1 className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">MVP x Wayward</h1>
        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}>Labs</span>
        <Link href="/wayward/placement" className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border border-[#7C3AED]/40 text-[#7C3AED] hover:bg-[#7C3AED]/5">
          <ClipboardList size={13} /> Build a placement offer
        </Link>
      </div>
      <p className="text-sm text-[#6e6e73] dark:text-[#a1a1a6] mb-4">
        Browse Wayward&apos;s Amazon Attribution catalog, filter by brand, and mint an attributed Amazon link per product — measured and paid back to your Wayward account.
      </p>

      {needsToken ? (
        <div className="rounded-xl border border-black/10 dark:border-white/10 p-6 text-center">
          <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Connect your Wayward API key to use this tool.</p>
          <Link href="/external-integrations" className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: PURPLE }}><Link2 size={14} /> Connect Wayward</Link>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex items-center gap-2 mb-4 border-b border-black/5 dark:border-white/10">
            {(['catalog', 'saved'] as const).map(tk => (
              <button key={tk} onClick={() => setTab(tk)}
                className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === tk ? 'border-[#7C3AED] text-[#7C3AED]' : 'border-transparent text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'}`}>
                {tk === 'catalog' ? 'Catalog' : `Saved${savedItems.length ? ` (${savedItems.length})` : ''}`}
              </button>
            ))}
          </div>

          {tab === 'catalog' ? (
            <>
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <form onSubmit={e => { e.preventDefault(); setSelBrand(null); load(1, asin) }} className="relative flex-1 min-w-[200px] max-w-sm flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
                    <input value={asin} onChange={e => setAsin(e.target.value)} placeholder="Filter by ASIN (e.g. B0C8BRDVT6)"
                      className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-[var(--surface,#fff)] border border-black/10 dark:border-white/15 text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#7C3AED]" />
                  </div>
                  <button type="submit" className="rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ backgroundColor: PURPLE }}>Go</button>
                </form>
                <div className="relative">
                  <button onClick={() => setBrandOpen(o => !o)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm border border-black/10 dark:border-white/15 text-[#1d1d1f] dark:text-[#f5f5f7]">
                    <Tag size={13} /> {selBrand ? selBrand.name.slice(0, 22) : 'Brand'}
                    {selBrand && <X size={13} className="text-[#86868b] hover:text-[#ff3b30]" onClick={(e) => { e.stopPropagation(); pickBrand(null) }} />}
                  </button>
                  {brandOpen && (
                    <div className="absolute z-20 mt-1 w-80 max-h-96 overflow-auto rounded-xl border border-black/10 dark:border-white/15 bg-[var(--surface,#fff)] shadow-xl p-2">
                      <input autoFocus value={brandQuery} onChange={e => setBrandQuery(e.target.value)} placeholder="Search brands…"
                        className="w-full mb-2 px-2.5 py-1.5 text-sm rounded-lg border border-black/10 dark:border-white/15 bg-transparent outline-none focus:border-[#7C3AED]" />
                      <p className="text-[10px] text-[#86868b] px-1 mb-1">Sorted by avg commission</p>
                      {filteredBrands.map(b => (
                        <button key={b.id} onClick={() => pickBrand(b)} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-black/[.04] dark:hover:bg-white/[.06] flex items-center justify-between gap-2">
                          <span className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{b.name}</span>
                          <span className="text-[11px] shrink-0"><span className="font-semibold" style={{ color: '#1f8a3a' }}>{b.avgCommission ?? '—'}%</span> <span className="text-[#86868b]">· {b.activeProductsCount ?? 0}</span></span>
                        </button>
                      ))}
                      {filteredBrands.length === 0 && <p className="text-[12px] text-[#86868b] px-2 py-2">No brands match.</p>}
                    </div>
                  )}
                </div>
                <button onClick={() => setSortByComm(s => !s)} title="Sort this page by commission"
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm border ${sortByComm ? 'border-[#7C3AED] text-[#7C3AED] bg-[#7C3AED]/5' : 'border-black/10 dark:border-white/15 text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>
                  <ArrowDownWideNarrow size={13} /> Commission
                </button>
                <span className="ml-auto text-[11px] text-[#86868b] tabular-nums">{totalProducts.toLocaleString()} products</span>
              </div>

              {selBrand && <p className="text-[12px] text-[#86868b] mb-3">Showing <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">{selBrand.name}</strong> · {selBrand.avgCommission ?? '—'}% avg commission</p>}
              {error && <p className="text-sm text-[#ff3b30] mb-3">{error}</p>}

              {loading ? (
                <div className="flex items-center justify-center py-16 text-[#86868b]"><Loader2 className="animate-spin" /></div>
              ) : shown.length === 0 ? (
                <p className="text-sm text-[#86868b] py-10 text-center">No products found.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {shown.map(p => <Card key={p.productId} p={p} />)}
                </div>
              )}

              {!asin && totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-5 text-sm">
                  <button onClick={() => page > 1 && load(page - 1, '', selBrand?.id)} disabled={page <= 1 || loading}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/15 disabled:opacity-40"><ChevronLeft size={14} /> Prev</button>
                  <span className="text-[12px] text-[#86868b] tabular-nums">Page {page.toLocaleString()} / {totalPages.toLocaleString()}</span>
                  <button onClick={() => page < totalPages && load(page + 1, '', selBrand?.id)} disabled={page >= totalPages || loading}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/15 disabled:opacity-40">Next <ChevronRight size={14} /></button>
                </div>
              )}
            </>
          ) : (
            /* Saved tab */
            savedItems.length === 0 ? (
              <p className="text-sm text-[#86868b] py-10 text-center">Nothing saved yet — tap <strong>Save</strong> on any product in the Catalog.</p>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[12px] text-[#86868b]">{savedItems.length} saved</span>
                  <button onClick={generateAllSaved} disabled={genAll}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60" style={{ backgroundColor: PURPLE }}>
                    {genAll ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} {genAll ? 'Generating…' : `Generate all (${savedItems.length})`}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {savedItems.map(p => <Card key={p.productId} p={p} />)}
                </div>
              </>
            )
          )}
        </>
      )}

      {postItem && <WaywardQuickPostModal item={postItem} onClose={() => setPostItem(null)} />}
    </div>
  )
}
