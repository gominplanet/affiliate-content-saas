'use client'

/**
 * Product Finder — the "ViralVue but live + in MVP" flow. Enter a keyword + rules
 * (must have a carousel video, min monthly sales, how many to scan); SCOUT runs
 * the Amazon search in the user's own browser, deep-checks each result (monthly
 * sales + carousel-video position), filters by the rules, and returns the
 * winners. Each can be turned into a blog post in one click (the from-link flow).
 * Data is LIVE (read at that moment), not a cached third-party database.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Loader2, Search, Sparkles, ExternalLink, PackageSearch, MessageSquare, Radar } from 'lucide-react'
import { requestProductSearch, requestFindCampaign, requestCcMatch, type FinderProduct, type CampaignMatch } from '@/lib/extension-frame'
import MessageBrandModal, { type MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'

// Price-range buckets. Half-open ranges [min, max) so boundaries never overlap
// or gap (a $75 product lands in "$75 – $125", not both). Amazon prices arrive
// from SCOUT as strings ($1,234.56) — parsePrice() normalizes them.
const PRICE_BUCKETS: Record<string, { label: string; min: number | null; max: number | null }> = {
  any:      { label: 'Any price',   min: null, max: null },
  u50:      { label: 'Under $50',   min: null, max: 50 },
  b50_75:   { label: '$50 – $75',   min: 50,   max: 75 },
  b75_125:  { label: '$75 – $125',  min: 75,   max: 125 },
  b125_175: { label: '$125 – $175', min: 125,  max: 175 },
  b175_250: { label: '$175 – $250', min: 175,  max: 250 },
  b250_500: { label: '$250 – $500', min: 250,  max: 500 },
  o500:     { label: 'Over $500',   min: 500,  max: null },
}
const PRICE_BUCKET_ORDER = ['any', 'u50', 'b50_75', 'b75_125', 'b125_175', 'b175_250', 'b250_500', 'o500'] as const

function parsePrice(price: string | null | undefined): number | null {
  if (typeof price !== 'string') return null
  const n = parseFloat(price.replace(/[^0-9.]/g, ''))
  return isFinite(n) ? n : null
}

// In-bucket = price in [min, max). An unreadable price is excluded once a real
// range is chosen (we can't confirm it fits); "Any price" keeps everything.
function priceInBucket(price: string | null | undefined, b: { min: number | null; max: number | null }): boolean {
  if (b.min == null && b.max == null) return true
  const n = parsePrice(price)
  if (n == null) return false
  if (b.min != null && n < b.min) return false
  if (b.max != null && n >= b.max) return false
  return true
}

const RECENT_KEY = 'mvp_pf_recent_searches'  // localStorage: last 10 keywords
const RESULTS_KEY = 'mvp_pf_results_cache'   // localStorage: saved results per keyword (survives page reload)
const MAX_CACHED = 10                         // keep saved results for the last 10 searches

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'relevance',   label: 'Relevance' },
  { value: 'sales_desc',  label: 'Sales: high → low' },
  { value: 'rating_desc', label: 'Rating: high → low' },
  { value: 'price_asc',   label: 'Price: low → high' },
  { value: 'price_desc',  label: 'Price: high → low' },
]

// Sort a copy of the results. Unknown values (null price/rating/sales) always
// sink to the bottom regardless of direction, so a product SCOUT couldn't read
// never jumps to the top of a "high → low" sort. 'relevance' keeps Amazon order.
function sortProducts(list: FinderProduct[], sortBy: string): FinderProduct[] {
  if (sortBy === 'relevance') return list
  const finite = (v: number | null | undefined) => (typeof v === 'number' && isFinite(v) ? v : null)
  const by = (get: (p: FinderProduct) => number | null, dir: 'asc' | 'desc') => (a: FinderProduct, b: FinderProduct) => {
    const av = get(a), bv = get(b)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return dir === 'asc' ? av - bv : bv - av
  }
  const price  = (p: FinderProduct) => parsePrice(p.price)
  const rating = (p: FinderProduct) => finite(parseFloat(p.rating ?? ''))
  const sales  = (p: FinderProduct) => finite(p.monthlySales)
  const copy = [...list]
  switch (sortBy) {
    case 'sales_desc':  return copy.sort(by(sales, 'desc'))
    case 'rating_desc': return copy.sort(by(rating, 'desc'))
    case 'price_asc':   return copy.sort(by(price, 'asc'))
    case 'price_desc':  return copy.sort(by(price, 'desc'))
    default:            return list
  }
}

export default function ProductFinderPage() {
  const [keyword, setKeyword] = useState('')
  const [minSales, setMinSales] = useState('100')
  const [priceRange, setPriceRange] = useState('any')
  const [sortBy, setSortBy] = useState('relevance')
  const [recent, setRecent] = useState<string[]>([])
  const [mustVideo, setMustVideo] = useState(false)
  const [maxResults, setMaxResults] = useState('15')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<FinderProduct[] | null>(null)
  const [meta, setMeta] = useState<{ scanned?: number; totalFound?: number } | null>(null)
  const [genning, setGenning] = useState<Record<string, 'busy' | 'done'>>({})
  const [genUrl, setGenUrl] = useState<Record<string, string>>({})
  const [msgProduct, setMsgProduct] = useState<MessageBrandCampaign | null>(null)
  const [msgChecking, setMsgChecking] = useState<string | null>(null) // asin being checked
  // Campaign status per ASIN, surfaced on the rows BEFORE Message is opened.
  // `imported` = one of the user's own Creator Connections campaigns (instant DB
  // check). `live` = the result of an on-demand SCOUT CC search for that product.
  type Imported = { detailsUrl: string; brandName: string | null; commissionPct: number | null }
  type Live = { found: boolean; detailsUrl?: string | null; brand?: string | null; commissionPct?: number | null }
  const [imported, setImported] = useState<Record<string, Imported>>({})
  const [live, setLive] = useState<Record<string, Live>>({})
  const [ccChecking, setCcChecking] = useState<string | null>(null) // asin being live-checked
  const [ccAllRunning, setCcAllRunning] = useState(false)          // "Check all CC" in progress

  // Cache of completed searches, keyed by lowercased keyword. Clicking a Recent
  // pill RESTORES the saved results instantly instead of re-scanning Amazon (slow +
  // rate-limited). Persisted to localStorage (see persistCache) so it survives a
  // page reload too — a fresh scan only happens via the Search button, or a pill
  // whose results were never saved. Results carry a timestamp so we can still nudge
  // the user to re-scan for fresh data.
  type CacheEntry = { products: FinderProduct[]; meta: { scanned?: number; totalFound?: number } | null; imported: Record<string, Imported>; live: Record<string, Live>; savedAt?: number }
  const searchCache = useRef<Map<string, CacheEntry>>(new Map())
  const lastTermRef = useRef<string | null>(null) // keyword whose results are currently on screen (null while scanning)

  // Serialize the cache Map to localStorage, keeping only the most-recent
  // MAX_CACHED entries. Best-effort: on a quota error, drop the oldest half and
  // retry once, then give up (in-memory cache still works for this session).
  const persistCache = useCallback(() => {
    const map = searchCache.current
    while (map.size > MAX_CACHED) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
    }
    try {
      localStorage.setItem(RESULTS_KEY, JSON.stringify(Object.fromEntries(map)))
    } catch {
      try {
        const keys = [...map.keys()]
        for (const k of keys.slice(0, Math.ceil(keys.length / 2))) map.delete(k)
        localStorage.setItem(RESULTS_KEY, JSON.stringify(Object.fromEntries(map)))
      } catch { /* give up — session cache still works */ }
    }
  }, [])

  // Results in the chosen sort order (relevance = Amazon's original scan order).
  const sortedResults = useMemo(() => (results ? sortProducts(results, sortBy) : []), [results, sortBy])

  // Keep the on-screen keyword's cache entry in sync with everything the user
  // builds up AFTER the scan — imported/live campaign statuses from Check CC etc.
  // — so a later pill click restores the full enriched view, not just the raw scan,
  // and persist it. Re-inserting the key (delete→set) makes it the most-recent for
  // eviction. Skips while scanning (lastTermRef null) so an in-flight search never
  // clobbers a previous term's cache with the reset-to-empty state.
  useEffect(() => {
    const t = lastTermRef.current
    if (!t || results == null) return
    const key = t.toLowerCase()
    const map = searchCache.current
    map.delete(key)
    map.set(key, { products: results, meta, imported, live, savedAt: Date.now() })
    persistCache()
  }, [results, meta, imported, live, persistCache])

  // ── Recent searches (last 10) + their saved results — persisted per-browser in
  //    localStorage. Loaded on mount (client-only, so no SSR/hydration mismatch).
  //    Hydrating the results cache here (before setRecent triggers the re-render)
  //    means the pills render with the right "saved / re-scan" tooltip immediately.
  useEffect(() => {
    try {
      const rawCache = localStorage.getItem(RESULTS_KEY)
      const obj = rawCache ? JSON.parse(rawCache) : null
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          if (v && Array.isArray((v as CacheEntry)?.products)) searchCache.current.set(k, v as CacheEntry)
        }
      }
    } catch { /* ignore corrupt/absent cache */ }
    try {
      const raw = localStorage.getItem(RECENT_KEY)
      const arr = raw ? JSON.parse(raw) : []
      if (Array.isArray(arr)) setRecent(arr.filter((x): x is string => typeof x === 'string').slice(0, 10))
    } catch { /* ignore corrupt/absent storage */ }
  }, [])
  const pushRecent = useCallback((term: string) => {
    const t = term.trim()
    if (!t) return
    setRecent(prev => {
      const next = [t, ...prev.filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, 10)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])
  const clearRecent = useCallback(() => {
    setRecent([])
    searchCache.current.clear()
    try { localStorage.removeItem(RECENT_KEY); localStorage.removeItem(RESULTS_KEY) } catch { /* ignore */ }
  }, [])

  // Open the Message modal for a found product. First check whether this ASIN is
  // already an imported Creator Connections campaign — if so, open in AUTO-SEND
  // mode (SCOUT delivers it on Amazon); otherwise compose+copy.
  const openMessage = useCallback(async (p: FinderProduct) => {
    // Reuse what the row already knows so the modal opens in the right mode with
    // no wait: an imported campaign, or a live check that already found one.
    const imp = imported[p.asin]
    if (imp) { setMsgProduct({ product: p.title, asin: p.asin, commissionPct: imp.commissionPct, detailsUrl: imp.detailsUrl, brandLabel: imp.brandName || '' }); return }
    const lv = live[p.asin]
    if (lv?.found && lv.detailsUrl) { setMsgProduct({ product: p.title, asin: p.asin, commissionPct: lv.commissionPct ?? null, detailsUrl: lv.detailsUrl, brandLabel: lv.brand || '' }); return }
    // Not known yet — do the single instant imported check (covers the race where
    // the batch check hasn't landed), else open in compose+copy with the in-modal
    // live search still available.
    setMsgChecking(p.asin)
    let detailsUrl = ''
    let brandLabel = ''
    let commissionPct: number | null = null
    try {
      const res = await fetch(`/api/campaigns/find-by-asin?asin=${encodeURIComponent(p.asin)}`)
      const d = await res.json().catch(() => ({}))
      if (d.found && d.detailsUrl) {
        detailsUrl = d.detailsUrl
        brandLabel = d.brandName || ''
        commissionPct = typeof d.commissionPct === 'number' ? d.commissionPct : null
      }
    } catch { /* fall back to compose+copy */ }
    setMsgChecking(null)
    setMsgProduct({ product: p.title, asin: p.asin, commissionPct, detailsUrl, brandLabel })
  }, [imported, live])

  // Batch-check which result ASINs are already the user's imported campaigns, so
  // each row can show its status before Message is opened. Best-effort.
  const checkImported = useCallback(async (products: FinderProduct[]) => {
    const asins = products.map(p => p.asin).filter(Boolean)
    if (asins.length === 0) return
    try {
      const res = await fetch('/api/campaigns/find-by-asins', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asins }),
      })
      const d = await res.json().catch(() => ({}))
      if (d?.map && typeof d.map === 'object') setImported(d.map as Record<string, Imported>)
    } catch { /* rows just won't show the imported badge */ }
  }, [])

  // On-demand live "is this a Creator Connections campaign?" check for ONE row —
  // the same background SCOUT search the modal runs, but surfaced on the row so
  // the user can probe before hitting Message. Searches CC by the KEYWORD (the CC
  // grid returns cards for a keyword, not a bare ASIN) and confirms the match.
  const checkCC = useCallback(async (p: FinderProduct) => {
    setCcChecking(p.asin)
    try {
      const r = await requestFindCampaign(keyword.trim() || p.asin, p.asin)
      if (r.ok) {
        setLive(s => ({ ...s, [p.asin]: { found: !!r.found, detailsUrl: r.detailsUrl, brand: r.brand, commissionPct: r.commissionPct } }))
        if (r.found) toast.success(`It's a campaign${r.brand ? ` from ${r.brand}` : ''} — you can auto-send.`)
        else toast.message('Not a Creator Connections campaign', { description: 'You can still copy a pitch to reach the brand.' })
      } else if (r.error === 'not-installed') toast.error('Install / enable SCOUT to check Creator Connections.')
      else if (r.error === 'timeout') toast.error('The Creator Connections check timed out — try again.')
      else toast.error(`Couldn't check: ${r.error}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Check failed')
    } finally {
      setCcChecking(null)
    }
  }, [keyword])

  // "Check all CC" — ONE Creator Connections search for the keyword, matched
  // against every not-yet-known result ASIN at once (far cheaper than one search
  // per row). Fills the `live` map for all of them.
  const checkAllCC = useCallback(async () => {
    if (!results || results.length === 0) return
    const todo = results.filter(p => !imported[p.asin] && !live[p.asin]).map(p => p.asin)
    if (todo.length === 0) { toast.message('Every row already has a campaign status.'); return }
    setCcAllRunning(true)
    try {
      const r = await requestCcMatch(keyword.trim(), todo)
      if (!r.ok) {
        if (r.error === 'not-installed') toast.error('Install / enable SCOUT to check Creator Connections.')
        else if (r.error === 'timeout') toast.error('The Creator Connections scan timed out — try Check CC per row instead.')
        else toast.error(`Couldn't scan Creator Connections: ${r.error}`)
        return
      }
      const byAsin: Record<string, CampaignMatch> = {}
      for (const m of (r.matches ?? [])) byAsin[m.asin.toUpperCase()] = m
      setLive(s => {
        const next = { ...s }
        for (const asin of todo) {
          const m = byAsin[asin.toUpperCase()]
          next[asin] = m
            ? { found: true, detailsUrl: m.detailsUrl, brand: m.brand, commissionPct: m.commissionPct }
            : { found: false }
        }
        return next
      })
      const n = (r.matches ?? []).length
      toast.success(n ? `${n} of ${todo.length} are Creator Connections campaigns you can auto-send to.` : `None of the ${todo.length} checked are campaigns.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setCcAllRunning(false)
    }
  }, [results, imported, live, keyword])

  const search = useCallback(async (term?: string) => {
    const kw = (term ?? keyword).trim()
    if (!kw) { toast.error('Enter a keyword to search.'); return }
    pushRecent(kw)
    // Null the term ref for the duration of the scan so the sync effect doesn't
    // write the reset-to-empty state over any previously-cached term.
    lastTermRef.current = null
    setSearching(true); setResults(null); setMeta(null); setImported({}); setLive({})
    try {
      const bucket = PRICE_BUCKETS[priceRange] ?? PRICE_BUCKETS.any
      const r = await requestProductSearch(kw, {
        minSales: parseInt(minSales, 10) || 0,
        mustVideo,
        maxResults: Math.min(25, Math.max(1, parseInt(maxResults, 10) || 15)),
        // Forward-compat: newer SCOUT builds pre-filter the scan pool by price so
        // the deep-check budget targets in-range products. Older builds ignore
        // these; we still filter client-side below off the price each row carries.
        ...(bucket.min != null ? { priceMin: bucket.min } : {}),
        ...(bucket.max != null ? { priceMax: bucket.max } : {}),
      })
      // Keep only rows inside the chosen price bucket (no-op for "Any price").
      const applyPrice = (ps?: FinderProduct[]) => (ps ?? []).filter(p => priceInBucket(p.price, bucket))
      if (!r.ok) {
        if (r.error === 'not-installed') toast.error('Install / enable SCOUT to use the Product Finder.')
        else if (r.error === 'amazon-blocked') toast.warning('Amazon is rate-limiting right now — wait a few minutes before scanning again (and scan fewer at a time).', { duration: 11000 })
        else if (r.error === 'no-results') { setResults([]); toast.message('No products found — try a different keyword.') }
        else if (r.error === 'timeout') toast.error('The scan timed out — try fewer results or a narrower keyword.')
        else toast.error(`Search failed: ${r.error}`)
        setResults(applyPrice(r.products))
        return
      }
      const products = applyPrice(r.products)
      setResults(products)
      setMeta({ scanned: r.scanned, totalFound: r.totalFound })
      // Mark this term as the one on screen so the sync effect caches it (and any
      // Check-CC enrichment that follows). Only set on a genuine success — errors
      // above return early, so a failed scan is never cached.
      lastTermRef.current = kw
      const n = products.length
      if (r.blocked) {
        toast.warning('Amazon started rate-limiting — SCOUT stopped early to avoid a block. Wait a few minutes and scan fewer at a time.', { duration: 11000 })
      } else {
        const priced = bucket.min != null || bucket.max != null ? ` in ${bucket.label}` : ''
        toast.success(n ? `${n} product${n === 1 ? '' : 's'} passed your rules${priced}.` : `No products passed your rules${priced} — loosen them and try again.`)
      }
      if (n) checkImported(products)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }, [keyword, minSales, priceRange, mustVideo, maxResults, pushRecent])

  // Restore a previously-completed search from the cache (in-memory, hydrated from
  // localStorage on mount). Returns false if there's no saved entry — the pill
  // handler then falls back to a live scan. This is what makes a Recent pill
  // INSTANT — no re-scan, no Amazon hit — even after a page reload.
  const restoreFromCache = useCallback((term: string): boolean => {
    const hit = searchCache.current.get(term.trim().toLowerCase())
    if (!hit) return false
    setKeyword(term)
    setResults(hit.products)
    setMeta(hit.meta)
    setImported(hit.imported)
    setLive(hit.live)
    setSearching(false)
    lastTermRef.current = term.trim() // keep syncing if the user runs Check CC on the restored view
    // Age hint so the user knows whether the saved data is worth re-scanning.
    let age = ''
    if (typeof hit.savedAt === 'number') {
      const mins = Math.round((Date.now() - hit.savedAt) / 60000)
      age = mins < 1 ? ' (saved just now)' : mins < 60 ? ` (saved ${mins}m ago)` : ` (saved ${Math.round(mins / 60)}h ago)`
    }
    toast.message(`Showing your saved results for “${term.trim()}”${age}.`, { description: 'Hit Search to re-scan Amazon for fresh data.' })
    return true
  }, [])

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

  // The campaign status shown on each row, BEFORE Message is opened:
  //  • imported / live-found → a green "Campaign · auto-send" chip
  //  • live-checked miss     → a faint "Not a campaign" note
  //  • unknown               → a "Check CC" button (runs the live SCOUT search)
  const renderCampaign = (p: FinderProduct) => {
    const imp = imported[p.asin]
    const lv = live[p.asin]
    const isCampaign = !!imp || !!lv?.found
    if (isCampaign) {
      const brand = imp?.brandName || lv?.brand || ''
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#248a3d]"
          title={`Creator Connections campaign${brand ? ` · ${brand}` : ''} — Message will auto-send on Amazon`}>
          🎯 Campaign{imp ? '' : ' (live)'} · auto-send
        </span>
      )
    }
    if (ccChecking === p.asin) {
      return <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-faint)' }}><Loader2 size={10} className="animate-spin" /> Checking CC…</span>
    }
    if (lv && !lv.found) {
      return <span className="text-[11px]" style={{ color: 'var(--text-faint)' }} title="No live Creator Connections campaign matched">— not a campaign</span>
    }
    return (
      <button onClick={() => checkCC(p)} disabled={!!ccChecking}
        title="Ask SCOUT (background) whether this product is a Creator Connections campaign you can auto-send to"
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C3AED] hover:underline disabled:opacity-50">
        <Radar size={11} /> Check CC
      </button>
    )
  }

  const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none'
  const inputStyle = { backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' } as React.CSSProperties

  return (
    <>
      <PageHero
        title="AMZ Product Finder"
        subtitle="Search Amazon by keyword + rules — SCOUT reads live sales and carousel-video data in your own browser, then you turn any winner into a post."
      />

      <div className="card p-4 mb-5 max-w-4xl">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_150px_120px_auto] gap-3 items-end">
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
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Price range</label>
            <select value={priceRange} onChange={e => setPriceRange(e.target.value)} className={inputCls} style={inputStyle}>
              {PRICE_BUCKET_ORDER.map(k => <option key={k} value={k}>{PRICE_BUCKETS[k].label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Deep-check</label>
            <input type="number" min="1" max="25" value={maxResults} onChange={e => setMaxResults(e.target.value)} className={inputCls} style={inputStyle} />
          </div>
          <button onClick={() => search()} disabled={searching}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60 transition-colors h-[38px]">
            {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
          </button>
        </div>
        <label className="flex items-center gap-2 text-[13px] mt-3 cursor-pointer" style={{ color: 'var(--text)' }}>
          <input type="checkbox" checked={mustVideo} onChange={e => setMustVideo(e.target.checked)} className="accent-[#7C3AED] w-4 h-4" />
          Only products that already have a carousel video
        </label>
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
          SCOUT scans the top ~100 Amazon results for your keyword, then deep-checks the first {maxResults || '15'} of them — opening each product's Amazon page in the background to read live monthly sales + video placement (~1–2 min for 15, longer for more). Data is read at that moment — not a cached database. Rows that are already <span className="font-semibold text-[#248a3d]">🎯 your campaigns</span> are flagged instantly; use <span className="font-semibold text-[#7C3AED]">Check CC</span> (or <span className="font-semibold text-[#7C3AED]">Check all CC</span>) to have SCOUT confirm which are Creator Connections campaigns you can auto-send to.
        </p>
      </div>

      {recent.length > 0 && (
        <div className="max-w-4xl mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-faint)' }}>Recent:</span>
          {recent.map(term => {
            const cached = searchCache.current.has(term.toLowerCase())
            return (
              <button key={term} onClick={() => { if (!restoreFromCache(term)) { setKeyword(term); search(term) } }} disabled={searching}
                title={cached ? `Show your saved results for “${term}” (no re-scan)` : `Search “${term}”`}
                className="inline-flex items-center rounded-full px-3 py-1 text-[12px] border disabled:opacity-50 hover:border-[#7C3AED] transition-colors"
                style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text)' }}>
                {term}
              </button>
            )
          })}
          <button onClick={clearRecent} className="text-[11px] hover:underline ml-1" style={{ color: 'var(--text-faint)' }}>Clear</button>
        </div>
      )}

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
          <div className="flex items-center justify-between gap-3 mb-2">
            {meta
              ? <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{results.length} passed · deep-checked {meta.scanned} of {meta.totalFound} scanned</p>
              : <span />}
            <div className="flex items-center gap-2 flex-shrink-0">
              <label className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
                Sort
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  className="rounded-lg text-[12px] px-2 py-1.5 outline-none"
                  style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                  {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              {(() => {
                const uncheckable = results.filter(p => !imported[p.asin] && !live[p.asin]).length
                return (
                  <button onClick={checkAllCC} disabled={ccAllRunning || uncheckable === 0}
                    title="One Creator Connections search for your keyword, matched against every row at once — flags which products you can auto-send to"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border disabled:opacity-50 flex-shrink-0"
                    style={{ color: '#7C3AED', borderColor: '#d6c6fb', background: 'rgba(124,58,237,0.05)' }}>
                    {ccAllRunning ? <Loader2 size={13} className="animate-spin" /> : <Radar size={13} />}
                    {ccAllRunning ? 'Scanning Creator Connections…' : `Check all CC${uncheckable ? ` (${uncheckable})` : ''}`}
                  </button>
                )
              })()}
            </div>
          </div>
          <div className="card divide-y divide-gray-100 dark:divide-white/10">
            {sortedResults.map(p => (
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
                    <span aria-hidden style={{ color: 'var(--border)' }}>·</span>
                    {renderCampaign(p)}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => openMessage(p)} disabled={msgChecking === p.asin}
                    title="Compose a brand-outreach pitch — auto-sends if this product is one of your Creator Connections campaigns, else copy it"
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12px] font-semibold border disabled:opacity-60"
                    style={{ color: '#7C3AED', borderColor: '#d6c6fb' }}>
                    {msgChecking === p.asin ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />} Message
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

      {msgProduct && (
        <MessageBrandModal
          campaign={msgProduct}
          onClose={() => setMsgProduct(null)}
          // Live "is this a Creator Connections campaign?" lookup — only reached
          // from the modal when this product wasn't already an imported campaign.
          // Search CC by the KEYWORD (the grid returns cards for a keyword, not a
          // bare ASIN), then confirm the resolved card matches this ASIN.
          onFindCampaign={() => requestFindCampaign(keyword.trim() || msgProduct.asin, msgProduct.asin)}
        />
      )}
    </>
  )
}
