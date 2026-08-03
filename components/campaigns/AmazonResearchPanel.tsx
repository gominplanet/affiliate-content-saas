'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Amazon Product Research" — a filterable browse of the WHOLE Amazon catalogue
// (GET /api/amazon-research), NOT deals and NOT Creator Connections campaigns.
// Search by keyword, price, rating, reviews, best-sellers and category; the
// Keepa Product Finder returns matching ASINs and the Creators API hydrates the
// image / title / price. Every product link carries the creator's own Associates
// tag. From a card the creator can buy-to-review, write a review straight into
// the content engine, save it, or open the price-history deep-dive.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, Search, Bookmark, BookmarkCheck, ShoppingCart, PenLine, Check,
  ArrowRight, BarChart3, ImageOff, SlidersHorizontal, Sparkles, Video, Lock,
} from 'lucide-react'
import ProductDeepDiveModal from '@/components/product/ProductDeepDiveModal'
import MvpPicksInfo from '@/components/campaigns/MvpPicksInfo'

interface Product {
  asin: string
  title: string | null
  imageUrl: string | null
  priceNow: number | null
  productUrl: string
  // Present on MVP picks results (carousel-verified, buy-to-review vetted).
  mvpApproved?: boolean
  monthlySold?: number | null
  rating?: number | null
  reviewCount?: number | null
  videoCount?: number
}

const SORTS = [
  { v: 'salesRank', l: 'Best sellers' },
  { v: 'reviews', l: 'Most reviews' },
  { v: 'rating', l: 'Highest rating' },
  { v: 'priceLow', l: 'Price: low to high' },
  { v: 'priceHigh', l: 'Price: high to low' },
]

// VERIFIED Keepa rootCategory ids — MUST match the /api/amazon-research list.
const CATEGORIES = [
  { v: '0', l: 'All categories' },
  { v: '172282', l: 'Electronics' },
  { v: '1055398', l: 'Home & Kitchen' },
  { v: '3375251', l: 'Sports & Outdoors' },
  { v: '3760901', l: 'Health & Household' },
  { v: '3760911', l: 'Beauty & Personal Care' },
  { v: '228013', l: 'Tools & Home Improvement' },
  { v: '165793011', l: 'Toys & Games' },
  { v: '2619533011', l: 'Pet Supplies' },
  { v: '1064954', l: 'Office Products' },
  { v: '15684181', l: 'Automotive' },
  { v: '165796011', l: 'Baby' },
  { v: '7141123011', l: 'Clothing, Shoes & Jewelry' },
  { v: '541966', l: 'Computers' },
  { v: '2335752011', l: 'Cell Phones & Accessories' },
  { v: '16310101', l: 'Grocery & Gourmet Food' },
  { v: '11091801', l: 'Musical Instruments' },
  { v: '2972638011', l: 'Patio, Lawn & Garden' },
  { v: '468642', l: 'Video Games' },
  { v: '2619525011', l: 'Appliances' },
  { v: '2617941011', l: 'Arts, Crafts & Sewing' },
  { v: '16310161', l: 'Industrial & Scientific' },
  { v: '9479199011', l: 'Luggage & Travel Gear' },
  { v: '283155', l: 'Books' },
  { v: '2625373011', l: 'Movies & TV' },
  { v: '3367581', l: 'Jewelry' },
  { v: '6358539011', l: 'Watches' },
]

export default function AmazonResearchPanel({ canAct = true, onSavedChange }: { canAct?: boolean; onSavedChange?: () => void }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('salesRank')
  const [category, setCategory] = useState('0')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [minRating, setMinRating] = useState('0')
  const [minReviews, setMinReviews] = useState('0')
  const [maxSalesRank, setMaxSalesRank] = useState('0')
  // MVP picks: apply MVP's onsite buy-to-review rulebook (price/rating/reviews
  // floors + a verified open video carousel + real monthly demand). Paid-only.
  const [mvpPicks, setMvpPicks] = useState(false)

  const [rows, setRows] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [needsFilter, setNeedsFilter] = useState(true)
  const [debug, setDebug] = useState<Record<string, number | string | null> | null>(null)
  const [savedAsins, setSavedAsins] = useState<Set<string>>(new Set())
  const [deepDive, setDeepDive] = useState<{ asin: string; title: string | null; imageUrl: string | null } | null>(null)

  useEffect(() => {
    fetch('/api/campaigns/saved').then(r => r.json()).then(d => {
      if (d?.ok && Array.isArray(d.saved)) setSavedAsins(new Set(d.saved.map((s: { asin: string }) => s.asin.toUpperCase())))
    }).catch(() => {})
  }, [])

  const buildParams = useCallback((pageToLoad: number) => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (category !== '0') params.set('category', category)
    if (minPrice.trim() && Number(minPrice) > 0) params.set('minPrice', String(Number(minPrice)))
    if (maxPrice.trim() && Number(maxPrice) > 0) params.set('maxPrice', String(Number(maxPrice)))
    if (minRating !== '0') params.set('minRating', minRating)
    if (minReviews !== '0') params.set('minReviews', minReviews)
    if (maxSalesRank !== '0') params.set('maxSalesRank', maxSalesRank)
    if (mvpPicks) params.set('mvpPicks', '1')
    params.set('sort', sort)
    params.set('page', String(pageToLoad))
    return params
  }, [q, category, minPrice, maxPrice, minRating, minReviews, maxSalesRank, sort, mvpPicks])

  const load = useCallback(async (pageToLoad = 0, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/amazon-research?${buildParams(pageToLoad).toString()}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not search Amazon.'); if (!append) setRows([]); return }
      setNeedsFilter(!!data.needsFilter)
      setDebug(data.debug ?? null)
      const incoming: Product[] = Array.isArray(data.products) ? data.products : []
      setRows(prev => append ? [...prev, ...incoming] : incoming)
      setHasMore(!!data.hasMore)
      setPage(pageToLoad)
    } catch {
      setError('Could not search Amazon.')
    } finally {
      if (append) setLoadingMore(false); else setLoading(false)
    }
  }, [buildParams])

  // Debounced reload on any filter change (skips the wide-open no-filter state).
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasFilters = q.trim() || category !== '0' || (minPrice.trim() && Number(minPrice) > 0)
    || (maxPrice.trim() && Number(maxPrice) > 0) || minRating !== '0' || minReviews !== '0' || maxSalesRank !== '0' || mvpPicks
  useEffect(() => {
    // Free/trial users search MANUALLY (a Search button) so filter-fiddling
    // doesn't silently burn their daily search cap. Paid users get instant
    // live-search on every filter change.
    if (!canAct) return
    if (debounce.current) clearTimeout(debounce.current)
    if (!hasFilters) { setRows([]); setNeedsFilter(true); setLoading(false); return }
    debounce.current = setTimeout(() => { void load() }, 400)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, hasFilters, canAct])

  async function toggleSave(p: Product) {
    if (!canAct) { toast.error('Saving finds to your shortlist is a paid feature. Upgrade to save and act on products.'); return }
    const asin = p.asin.toUpperCase()
    const wasSaved = savedAsins.has(asin)
    setSavedAsins(prev => { const n = new Set(prev); if (wasSaved) n.delete(asin); else n.add(asin); return n })
    try {
      if (wasSaved) await fetch(`/api/campaigns/saved?asin=${asin}`, { method: 'DELETE' })
      else await fetch('/api/campaigns/saved', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: p.asin, source: 'onsite', title: p.title, imageUrl: p.imageUrl, price: p.priceNow }),
      })
      onSavedChange?.()
    } catch {
      setSavedAsins(prev => { const n = new Set(prev); if (wasSaved) n.add(asin); else n.delete(asin); return n })
      toast.error('Could not update your saved list.')
    }
  }

  const clearFilters = () => {
    setQ(''); setCategory('0'); setMinPrice(''); setMaxPrice(''); setMinRating('0'); setMinReviews('0'); setMaxSalesRank('0'); setSort('salesRank'); setMvpPicks(false)
  }

  return (
    <div className="card mb-5 overflow-hidden" style={{ borderWidth: 2, borderColor: 'rgba(124,58,237,0.30)' }}>
      {/* Filter bar */}
      <div className="px-3.5 py-3 space-y-2.5" style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.06), transparent 85%)' }}>
        {/* Search row — the input is only as wide as it needs to be, with Search
            and Clear right beside it (reads more like a search box). */}
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-1/2 min-w-0">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-[18px] w-[18px]" style={{ color: 'var(--text-faint)' }} />
            <input
              value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && hasFilters) void load(0) }}
              placeholder="Search Amazon products (keyword)…"
              className="w-full h-11 pl-11 pr-3.5 text-sm rounded-xl border bg-white dark:bg-[#1c1c1e] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-500/30 transition-shadow"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          {/* Free/trial: an explicit Search button (each search counts toward the
              daily free cap). Paid users search live, so they don't need it. */}
          {!canAct && (
            <button onClick={() => void load(0)} disabled={loading || !hasFilters}
              className="shrink-0 inline-flex items-center gap-1.5 h-11 px-4 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#7C3AED' }}>
              {loading ? <><Loader2 size={14} className="animate-spin" /> Searching…</> : <><Search size={14} /> Search</>}
            </button>
          )}
          {hasFilters && (
            <button onClick={clearFilters} className="shrink-0 inline-flex items-center gap-1 h-11 px-3.5 rounded-xl border text-sm font-medium" style={{ color: 'var(--text-faint)', borderColor: 'var(--border)' }}>
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* MVP picks — MVP's onsite buy-to-review rulebook (carousel-verified). */}
          <button
            onClick={() => {
              if (!canAct) { toast.error('MVP picks is a paid feature — plain research stays free. Upgrade to unlock carousel-verified, buy-to-review products.'); return }
              setMvpPicks(v => !v)
            }}
            title="MVP picks: MVP's onsite buy-to-review criteria — $25+ price, 3.8★+, 50+ reviews, real monthly demand, and an open video carousel on the product page. Slower (each pick is verified) and paid-only."
            className={`inline-flex items-center gap-1.5 h-9 rounded-full px-3.5 text-sm font-semibold border transition ${mvpPicks ? '' : 'bg-white dark:bg-[#1c1c1e]'}`}
            style={mvpPicks
              ? { background: '#7C3AED', borderColor: '#7C3AED', color: '#fff' }
              : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
            {canAct ? <Sparkles size={14} /> : <Lock size={12} />} MVP picks
          </button>
          <MvpPicksInfo />
          <Select value={sort} onChange={setSort} options={SORTS} />
          <Select value={category} onChange={setCategory} options={CATEGORIES} />
          <Select value={minRating} onChange={setMinRating} options={[
            { v: '0', l: 'Any rating' }, { v: '3', l: '3★+' }, { v: '4', l: '4★+' }, { v: '4.5', l: '4.5★+' },
          ]} />
          <Select value={minReviews} onChange={setMinReviews} options={[
            { v: '0', l: 'Any reviews' }, { v: '50', l: '50+ reviews' }, { v: '250', l: '250+ reviews' }, { v: '1000', l: '1k+ reviews' },
          ]} />
          <Select value={maxSalesRank} onChange={setMaxSalesRank} options={[
            { v: '0', l: 'Any rank' }, { v: '5000', l: 'Top 5k sellers' }, { v: '20000', l: 'Top 20k' }, { v: '100000', l: 'Top 100k' },
          ]} />
          <div className="inline-flex items-center gap-1 h-9 rounded-full border px-3 bg-white dark:bg-[#1c1c1e]" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>$</span>
            <input value={minPrice} onChange={e => setMinPrice(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="min"
              className="w-11 text-sm bg-transparent outline-none placeholder:text-[color:var(--text-faint)]" style={{ color: 'var(--text)' }} />
            <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>to</span>
            <input value={maxPrice} onChange={e => setMaxPrice(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="max"
              className="w-11 text-sm bg-transparent outline-none placeholder:text-[color:var(--text-faint)]" style={{ color: 'var(--text)' }} />
          </div>
        </div>
        {/* Manual-search reminder — free/trial applies filters only when Search is
            hit (paid searches live), so make that explicit. */}
        {!canAct && (
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Changed a filter or keyword? Hit <span className="font-semibold" style={{ color: 'var(--text-soft)' }}>Search</span> to apply it.
          </p>
        )}
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--text-faint)' }} /></div>
      ) : error ? (
        <div className="text-center py-12 text-sm" style={{ color: 'var(--text-faint)' }}>{error}</div>
      ) : needsFilter && rows.length === 0 ? (
        <div className="text-center py-14 px-6" style={{ color: 'var(--text-faint)' }}>
          <SlidersHorizontal size={26} className="mx-auto mb-3" style={{ color: 'rgba(124,58,237,0.4)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-soft)' }}>Search the whole Amazon catalogue</p>
          <p className="text-[12px] mt-1 max-w-sm mx-auto leading-relaxed">Type a keyword or pick a category, rating, review or best-seller filter above and results appear here — every product links with your own Associates tag.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-sm" style={{ color: 'var(--text-faint)' }}>
          {mvpPicks
            ? "Nothing cleared MVP's bar here — carousel, demand, rating and price floors are strict. Try another keyword or category."
            : 'No products match those filters : try widening them.'}
          {debug && (
            <div className="mt-3 text-[11px] font-mono break-all max-w-2xl mx-auto" style={{ color: 'var(--text-faint)' }}>
              <div>diagnostic · status {debug.status} · tokens {debug.tokensLeft ?? '—'} · total {debug.totalResults ?? '—'} · matched {debug.matched}</div>
              {debug.error ? <div className="mt-1" style={{ color: '#e11d48' }}>keepa: {String(debug.error)}</div> : null}
            </div>
          )}
        </div>
      ) : (
        <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
          {/* items-stretch (grid default) keeps cards in a row the same height
              WITHOUT [grid-auto-rows:1fr], which stretched a single row to fill
              the whole column and left big empty gaps below each card. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 items-stretch">
            {rows.map(p => (
              <ProductCard
                key={p.asin}
                p={p}
                canAct={canAct}
                saved={savedAsins.has(p.asin.toUpperCase())}
                onToggleSave={() => toggleSave(p)}
                onDeepDive={() => { if (!canAct) { toast.error('The price-history deep-dive is a paid feature. Upgrade to unlock it.'); return } setDeepDive({ asin: p.asin, title: p.title, imageUrl: p.imageUrl }) }}
              />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-4">
              <button onClick={() => void load(page + 1, true)} disabled={loadingMore}
                className="inline-flex items-center gap-2 text-sm font-medium rounded-full border px-5 py-2.5 disabled:opacity-60"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                {loadingMore ? <><Loader2 size={15} className="animate-spin" /> Loading…</> : 'Load more products'}
              </button>
            </div>
          )}
        </div>
      )}

      {deepDive && (
        <ProductDeepDiveModal asin={deepDive.asin} title={deepDive.title} imageUrl={deepDive.imageUrl} onClose={() => setDeepDive(null)} />
      )}
    </div>
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="h-9 text-sm font-medium rounded-full border bg-white dark:bg-[#1c1c1e] pl-3.5 pr-8 outline-none cursor-pointer appearance-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-500/30 transition"
        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-faint)' }}><path d="M6 9l6 6 6-6" /></svg>
    </div>
  )
}

function ProductCard({ p, canAct, saved, onToggleSave, onDeepDive }: {
  p: Product; canAct: boolean; saved: boolean; onToggleSave: () => void; onDeepDive: () => void
}) {
  const [gen, setGen] = useState<'idle' | 'working' | 'done'>('idle')
  const [postUrl, setPostUrl] = useState<string | null>(null)

  const writeReview = async () => {
    if (!canAct) { toast.error('Writing a review is a paid feature. Upgrade to turn a find into a post.'); return }
    if (gen === 'working') return
    setGen('working')
    try {
      const res = await fetch('/api/blog/from-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: p.productUrl, productName: p.title || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not write the review.'); setGen('idle'); return }
      setPostUrl(data.url || null); setGen('done')
      toast.success('Review published to your blog.')
    } catch { toast.error('Could not write the review.'); setGen('idle') }
  }

  return (
    <div className="rounded-xl border flex flex-col overflow-hidden h-full transition-shadow hover:shadow-md" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }}>
      <a href={p.productUrl} target="_blank" rel="noopener noreferrer" className="relative block aspect-square bg-white overflow-hidden">
        {p.imageUrl ? (
          // Absolutely filling the square so a tall/odd source photo can NEVER
          // stretch the card taller than the rest — object-contain still shows
          // the whole product, just letterboxed inside the fixed square.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt="" className="absolute inset-0 w-full h-full object-contain p-3" />
        ) : (
          <div className="w-full h-full grid place-items-center" style={{ background: 'rgba(124,58,237,0.04)' }}>
            <ImageOff size={22} style={{ color: 'rgba(124,58,237,0.3)' }} />
          </div>
        )}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeepDive() }}
          title="Price history & product data"
          className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-1 bg-black/55 text-white hover:bg-black/75 backdrop-blur-sm transition-colors">
          <BarChart3 size={10} /> Data
        </button>
        {p.mvpApproved && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-1 text-white" style={{ background: '#7C3AED' }}>
            <Sparkles size={10} /> MVP pick
          </span>
        )}
      </a>

      <div className="p-2.5 flex flex-col gap-2 flex-1">
        <p className="text-[12px] font-semibold leading-snug line-clamp-2 min-h-[2.1rem]" style={{ color: 'var(--text)' }}>
          {p.title || <span className="font-mono text-[11px]" style={{ color: 'var(--text-faint)' }}>{p.asin}</span>}
        </p>
        {p.priceNow != null ? (
          <span className="text-[15px] font-extrabold" style={{ color: '#16a34a' }}>${p.priceNow.toFixed(2)}</span>
        ) : <div className="h-[1.1rem]" />}
        {p.mvpApproved && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
            {p.rating != null && <span>★{p.rating.toFixed(1)}{p.reviewCount != null ? ` (${p.reviewCount.toLocaleString()})` : ''}</span>}
            {p.monthlySold != null && <span>{p.monthlySold.toLocaleString()}+ sold/mo</span>}
            {(p.videoCount ?? 0) > 0 && <span className="inline-flex items-center gap-0.5" style={{ color: '#7C3AED' }}><Video size={10} /> carousel</span>}
          </div>
        )}

        <div className="mt-auto pt-1 space-y-1.5">
          {gen === 'done' && postUrl ? (
            <a href={postUrl} target="_blank" rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-full py-2 text-white" style={{ background: '#34c759' }}>
              <Check size={14} /> View review
            </a>
          ) : (
            <button onClick={writeReview} disabled={gen === 'working'}
              className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-full py-2 text-white disabled:opacity-60 transition"
              style={{ background: '#7C3AED' }}>
              {gen === 'working' ? <><Loader2 size={13} className="animate-spin" /> Writing…</> : <><PenLine size={13} /> Write review <ArrowRight size={13} /></>}
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <button onClick={onToggleSave} title={saved ? 'Saved — click to remove' : 'Save for later'}
              className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1.5 border flex-1"
              style={saved ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.10)', color: '#b26a00' } : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
              {saved ? <BookmarkCheck size={12} /> : <Bookmark size={12} />} {saved ? 'Saved' : 'Save'}
            </button>
            {/* Buy to review = the creator purchasing for themselves, so this is
               a PLAIN Amazon link with NO affiliate tag (you can't tag your own
               purchase). The tagged link is only for the content they publish. */}
            <a href={`https://www.amazon.com/dp/${p.asin}`} target="_blank" rel="noopener noreferrer" title="Buy to review on Amazon"
              className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1.5 text-white flex-shrink-0" style={{ background: '#34c759' }}>
              <ShoppingCart size={12} />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
