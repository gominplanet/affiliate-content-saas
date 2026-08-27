'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EPC / Sponsored Products research library. Amazon's "Creator Connections Check
// → Sponsored Products" view lists per-creator EPC opportunities (product, price,
// rating, "Estimated EPC: Up to $X", "Budget availability score") with no export.
// SCOUT scrapes the open tab; the app saves each row into a GROWING per-user
// library the creator can search + sort. Scan again anytime to refresh + add.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Radar, Loader2, Search, ExternalLink, Star, Trash2, RefreshCw, Send, FileText, ArrowRight, Check, Image as ImageIcon, Link2 as LinkIcon, Copy, ChevronDown, ShoppingCart, Download } from 'lucide-react'
import { scoutCreatorConnections, loadEpcViaApi, type ScoutError } from '@/lib/extension-frame'
import { tierAllowsSocial, tierAllowsCampaigns, type Tier } from '@/lib/tier'
import QuickPostModal, { type QuickPostDeal } from '@/components/deal/QuickPostModal'

interface EpcProduct {
  asin: string
  title: string | null
  brand: string | null
  image_url: string | null
  price_cents: number | null
  epc_value: number | null
  epc_display: string | null
  budget: string | null
  rating: number | null
  monthly_sold: number | null
  sales_rank: number | null
  sales_rank_avg90: number | null
  sales_rank_category: string | null
  price_now_cents: number | null
  price_avg_cents: number | null
  price_lowest_cents: number | null
  discount_pct: number | null
  deal_quality: string | null
  ends_at: string | null
  details_url: string | null
  scanned_at: string
}

// Cleanup preview from GET /api/epc/cleanup — staleness buckets (rows not seen in
// a scan for 30/60/90+ days), duplicate count, and crawl-coverage timestamps.
interface EpcCleanupPreview {
  total: number
  expired: number
  duplicates: number
  newestScan: string | null
  oldestScan: string | null
  stale: { d30: number; d60: number; d90: number }
}

const SORTS: { key: string; label: string }[] = [
  { key: 'recent', label: 'Recently added' },
  { key: 'epc', label: 'Highest EPC' },
  { key: 'discount', label: 'Biggest deal' },
  { key: 'sold', label: 'Most bought' },
  { key: 'rank', label: 'Best-selling' },
  { key: 'rating', label: 'Highest rated' },
  { key: 'price_low', label: 'Lowest price' },
  { key: 'price_high', label: 'Highest price' },
]
// The shared catalog (what regular users browse) only has product-level columns
// to sort on — sold / rank / discount need per-scan enrichment that lives on the
// operator's own rows — so its sort menu is a subset.
const CATALOG_SORT_KEYS = new Set(['recent', 'epc', 'rating', 'price_low', 'price_high'])

interface EpcFilters {
  onSale: boolean
  minSold: number
  minRating: number
  maxPrice: string
  budget: string
}
const EMPTY_FILTERS: EpcFilters = { onSale: false, minSold: 0, minRating: 0, maxPrice: '', budget: '' }

// Deal-quality → a short badge. Mirrors Keepa's read (excellent/genuine/fair/weak);
// only the two that signal a real deal get a colored badge, so the grid isn't noisy.
function dealBadge(q: string | null, pct: number | null): { text: string; bg: string; color: string } | null {
  if (q === 'excellent') return { text: 'All-time low', bg: 'rgba(52,199,89,0.16)', color: '#1f7a4d' }
  if (q === 'genuine') return { text: pct ? `${pct}% off usual` : 'Below usual', bg: 'rgba(52,199,89,0.12)', color: '#1f7a4d' }
  if (q === 'fair' && (pct ?? 0) >= 5) return { text: `${pct}% off usual`, bg: 'rgba(255,204,0,0.16)', color: '#8a6d00' }
  return null
}
const money = (c: number | null | undefined) => (c != null ? `$${(c / 100).toFixed(2)}` : '')

const SCAN_ERROR: Record<ScoutError, string> = {
  'not-installed': 'SCOUT isn’t connected. Install the extension, then open your Creator Connections → Sponsored Products tab and scan again.',
  'no-cc-tab': 'Open your Amazon “Creator Connections Check → Sponsored Products” tab in another tab, then scan again.',
  'content-script-unreachable': 'Your Creator Connections tab needs a reload — refresh it once, then scan again.',
  'scan-failed': 'Couldn’t read the opportunities grid. Make sure you’re on the Sponsored Products view, then scan again.',
  'timeout': 'The scan ran long and timed out — a shorter opportunities list scans faster. Try again.',
}

function budgetStyle(b: string | null): { bg: string; color: string } {
  if (b === 'High') return { bg: 'rgba(52,199,89,0.14)', color: '#1f7a4d' }
  if (b === 'Medium') return { bg: 'rgba(255,204,0,0.16)', color: '#8a6d00' }
  if (b === 'Low') return { bg: 'rgba(255,59,48,0.12)', color: '#b3261e' }
  return { bg: 'var(--surface-2)', color: 'var(--text-faint)' }
}

export default function EpcLibraryPanel({ tier }: { tier?: Tier | null }) {
  // Pinterest gets its own designed pin (amazon/studio/pro). Amazon Influencer
  // has no blog/WordPress, so the blog action is hidden for it.
  const pinterestEnabled = tier ? tierAllowsSocial(tier, 'pinterest') : false
  const canBlog = tier !== 'amazon'
  // EPC is a paid feature. The nav is visible to every tier (canBrowseDealRadar),
  // but scanning + acting are paid — gate the Scan button client-side so a trial
  // user gets an upgrade prompt instead of sitting through a ~90s SCOUT harvest
  // that the ingest endpoint then rejects with a 403.
  const paidTier = tier ? tierAllowsCampaigns(tier) : false
  // Only the operator (admin) scans Amazon to build the library; everyone else
  // browses the shared catalog it produces. effectiveTier already collapses to
  // the viewed-as tier, so "View as Creator" previews the browse-only experience.
  const isAdmin = tier === 'admin'
  const sortOptions = isAdmin ? SORTS : SORTS.filter((s) => CATALOG_SORT_KEYS.has(s.key))
  const [quickPost, setQuickPost] = useState<QuickPostDeal | null>(null)
  const [products, setProducts] = useState<EpcProduct[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('recent')
  const [filters, setFilters] = useState<EpcFilters>(EMPTY_FILTERS)
  const activeFilterCount = (filters.onSale ? 1 : 0) + (filters.minSold ? 1 : 0) + (filters.minRating ? 1 : 0)
    + (filters.maxPrice.trim() && Number(filters.maxPrice) > 0 ? 1 : 0) + (filters.budget ? 1 : 0)
  const [debug, setDebug] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [filling, setFilling] = useState(false)
  const [fillMsg, setFillMsg] = useState<string | null>(null)
  const [cleaning, setCleaning] = useState(false)
  // ViralVue-style API load: paginate Amazon's own spcc list endpoint with a live
  // running count, instead of scraping the grid.
  const [apiLoading, setApiLoading] = useState(false)
  const [apiCount, setApiCount] = useState<{ loaded: number; total: number | null } | null>(null)
  const apiCancel = useRef(false)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupData, setCleanupData] = useState<EpcCleanupPreview | null>(null)
  const cleanupRef = useRef<HTMLDivElement>(null)
  // The active site's US Associates tag + whether Passport Links (geo-routing) is
  // on. "Get link" hands out a Passport Link when enabled (sends each visitor to
  // their own country's Amazon), else the standard tagged link.
  const [amazonTag, setAmazonTag] = useState<string>('')
  const [passportEnabled, setPassportEnabled] = useState(false)
  useEffect(() => {
    fetch('/api/passport').then((r) => r.json()).then((d) => {
      if (d?.ok) {
        if (typeof d.usTag === 'string') setAmazonTag(d.usTag.trim())
        setPassportEnabled(!!d.enabled)
      }
    }).catch(() => {})
  }, [])

  const load = useCallback(async (query: string, sortKey: string, f: EpcFilters) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      // The shared catalog only understands a subset of sorts/filters; the
      // operator's own library understands them all.
      params.set('sort', isAdmin || CATALOG_SORT_KEYS.has(sortKey) ? sortKey : 'recent')
      if (f.minRating > 0) params.set('minRating', String(f.minRating))
      if (f.maxPrice.trim() && Number(f.maxPrice) > 0) params.set('maxPrice', f.maxPrice.trim())
      if (isAdmin) {
        if (f.onSale) params.set('onSale', '1')
        if (f.minSold >= 1) params.set('minSold', String(f.minSold))
        if (f.budget) params.set('budget', f.budget)
      }
      const endpoint = isAdmin ? 'list' : 'catalog'
      const res = await fetch(`/api/epc/${endpoint}?${params.toString()}`)
      const data = await res.json()
      setProducts(Array.isArray(data.products) ? data.products : [])
      setTotal(data.total ?? 0)
    } catch {
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  // Initial + sort/filter change: load immediately. Search: debounce.
  useEffect(() => { void load(q, sort, filters) }, [sort, filters, load]) // eslint-disable-line react-hooks/exhaustive-deps
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void load(q, sort, filters), 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close the cleanup popover on outside-click / Escape.
  useEffect(() => {
    if (!cleanupOpen) return
    const onDown = (e: MouseEvent) => {
      if (cleanupRef.current && !cleanupRef.current.contains(e.target as Node)) setCleanupOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCleanupOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [cleanupOpen])

  async function scan() {
    setScanning(true)
    try {
      const res = await scoutCreatorConnections()
      if (!res.ok) { toast.error(SCAN_ERROR[res.error] || 'Scan failed. Try again.'); setDebug(null); return }
      // Only Sponsored Products / EPC rows carry an epcValue — Affiliate+ campaign
      // rows don't. Keeping only EPC rows means an accidental scan on the wrong CC
      // tab saves nothing to the library instead of polluting it.
      const all = res.campaigns ?? []
      const rows = all.filter((r) => r.epcValue != null)
      // Diagnostic line — what SCOUT actually saw, so a 0 result explains itself
      // (SCOUT is invisible on Amazon now; this replaces the old on-page debug).
      const d = res.diag
      if (d) {
        setDebug(d.sponsored === false
          ? `SCOUT wasn’t on the Sponsored Products grid. It was on: ${d.url || 'unknown'}. Accept your campaigns and open the Accepted tab, then scan again.`
          // Report the accumulated harvest, not the per-window DOM snapshot: the
          // grid is virtualized, so only ~30 cards exist in the page at any instant
          // while the scroll harvests thousands. Showing the snapshot read as
          // "saw 30 but read 3180", which looked broken.
          : `SCOUT read ${(d.parsed ?? all.length).toLocaleString()} cards; ${rows.length.toLocaleString()} had an EPC value.`)
      } else {
        setDebug(null)
      }
      if (!rows.length) {
        toast.error(all.length
          ? 'That tab isn’t the Sponsored Products view (no EPC found). Switch to your Sponsored Products for Creators tab, then scan again.'
          : 'No opportunities found. On Amazon, accept your Sponsored Products campaigns (“Accept all”), open the Accepted tab so the products show, then scan again.')
        return
      }
      const save = await fetch('/api/epc/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products: rows }),
      })
      const saved = await save.json()
      if (!save.ok || !saved.ok) { toast.error(saved.error || 'Could not save the scan.'); return }
      // Report NEW vs already-saved. Each scan re-reads the same top products, so
      // most are usually dupes — showing the new count (and why the rest didn't
      // add) explains why the library total moves slowly.
      const added = Number(saved.added ?? saved.saved) || 0
      const scanned = Number(saved.saved) || 0
      const dupes = Math.max(0, scanned - added)
      if (added > 0) {
        toast.success(`Added ${added.toLocaleString()} new ${added === 1 ? 'opportunity' : 'opportunities'}${dupes ? ` · ${dupes.toLocaleString()} already in your library` : ''}.`)
      } else {
        toast.info(`No new opportunities in this stretch — all ${scanned.toLocaleString()} were already saved. Scan again: SCOUT picks up deeper each time (and loops back to the top once it has covered your whole Accepted list). Accepting more campaigns on Amazon adds new ones too.`, { duration: 8_000 })
      }
      await load(q, sort, filters)
    } catch {
      toast.error('Scan failed unexpectedly. Reload and try again.')
    } finally {
      setScanning(false)
    }
  }

  // Load the whole EPC opportunity list via Amazon's own API (the ViralVue way):
  // the extension paginates the spcc list endpoint and ingests each batch live, so
  // the count climbs on its own with no duplicates. Long-running; the grid refreshes
  // as batches land. Cancelable.
  async function loadViaApi() {
    if (apiLoading) return
    apiCancel.current = false
    setApiLoading(true)
    setApiCount({ loaded: 0, total: null })
    let lastRefresh = 0
    try {
      const res = await loadEpcViaApi(
        (p) => {
          setApiCount({ loaded: p.loaded, total: p.total })
          // Refresh the grid + total periodically so the user sees rows landing,
          // without hammering the list endpoint every poll.
          const now = Date.now()
          if (now - lastRefresh > 8000) { lastRefresh = now; void load(q, sort, filters) }
        },
        () => apiCancel.current,
      )
      await load(q, sort, filters)
      // Surface the loader diagnostic (captured endpoint, response shape, sample)
      // so a 0/low load is debuggable at a glance — copy this to support to tune.
      if (res.loaded === 0 || res.diag) {
        try {
          const parts: string[] = []
          if (Array.isArray(res.diag?.capSources)) parts.push(`captured: ${res.diag.capSources.join(',')}`)
          if (Array.isArray(res.diag?.seenPosts)) parts.push(`seenPosts: ${res.diag.seenPosts.join(' | ') || '(none fired)'}`)
          if (Array.isArray(res.diag?.probe)) parts.push(`probe: ${res.diag.probe.map((p: { try: string; http: number; total: number | null; items: number; optedIn?: number; accepted?: boolean }) => `${p.try}=${p.total ?? '?'}/${p.items}i/${p.optedIn ?? 0}oi${p.accepted ? '✓' : ''}(${p.http})`).join(', ')}`)
          if (res.diag?.chosen) parts.push(`chosen: ${res.diag.chosen}`)
          if (res.diag?.firstStatus != null) parts.push(`status: ${res.diag.firstStatus}`)
          if (res.diag?.itemsKey) parts.push(`itemsKey: ${res.diag.itemsKey}`)
          if (Array.isArray(res.diag?.topKeys) && res.diag.topKeys.length) parts.push(`keys: ${res.diag.topKeys.join(',')}`)
          if (res.diag?.raw) parts.push(`raw: ${res.diag.raw}`)
          if (res.sample) parts.push(`sample: ${res.sample}`)
          if (res.diag?.capBody) parts.push(`reqBody: ${res.diag.capBody}`)
          setDebug(parts.length ? `EPC API load — ${parts.join(' · ')}` : null)
        } catch { /* ignore */ }
      }
      if (res.canceled) {
        toast.info(`Stopped. Loaded ${res.loaded.toLocaleString()} so far — they're saved.`)
      } else if (!res.ok) {
        const why = res.error === 'not-installed' ? 'SCOUT isn’t installed.'
          : (res.error === 'no-rows' || res.error === 'no-accepted-set') ? 'Couldn’t read any EPC rows (see the details line below). Open your Sponsored Products tab on Amazon once, then try again.'
          : res.error === 'no-capture' ? 'Couldn’t read Amazon’s list request. Open your Sponsored Products tab on Amazon once, then try again.'
          : res.error === 'unauthorized' ? 'Amazon rejected the request. Sign in to Creator Connections on Amazon, then retry.'
          : res.error === 'throttled' ? `Amazon throttled the load at ${res.loaded.toLocaleString()}. What loaded is saved — run it again to continue.`
          : `Load stopped (${res.error || 'unknown'}). ${res.loaded ? `${res.loaded.toLocaleString()} saved.` : ''}`
        toast.error(why)
      } else {
        toast.success(`Loaded ${res.loaded.toLocaleString()} opportunities from Amazon.${res.total ? ` Amazon reported ${res.total.toLocaleString()}.` : ''}`)
      }
    } catch {
      toast.error('The Amazon load failed unexpectedly. Try again.')
    } finally {
      setApiLoading(false)
      setApiCount(null)
    }
  }

  // Backfill images (+ sales rank / monthly sold) for the library on demand,
  // instead of waiting on the paced background cron. Self-driving: the endpoint
  // does a bounded batch and reports how many rows still need filling, so we loop
  // until done, refreshing the grid as we go so images pop in live.
  async function fillImages() {
    if (filling) return
    setFilling(true); setFillMsg('Starting…')
    let totalFilled = 0
    try {
      for (let guard = 0; guard < 400; guard++) {
        const res = await fetch('/api/epc/enrich', { method: 'POST' })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(d.error || 'Could not fill images.'); break }
        totalFilled += Number(d.filled ?? 0)
        if (d.stopped === 'low_tokens') {
          setFillMsg(null)
          toast.warning(`Filled ${totalFilled.toLocaleString()} so far. The rest is still syncing and finishes automatically over the next while, or click again later.`, { duration: 10_000 })
          break
        }
        const remaining = Number(d.remaining ?? 0)
        setFillMsg(`Filled ${totalFilled.toLocaleString()}${remaining ? ` · ${remaining.toLocaleString()} to go` : ''}…`)
        await load(q, sort, filters) // refresh so images appear as they land
        if (d.done || remaining === 0) {
          setFillMsg(null)
          toast.success(totalFilled ? `Filled ${totalFilled.toLocaleString()} product image${totalFilled === 1 ? '' : 's'}.` : 'Everything is already up to date.')
          break
        }
      }
    } catch {
      toast.error('Filling images failed. Try again.')
    } finally {
      setFilling(false); setFillMsg(null)
    }
  }

  async function remove(asin: string) {
    setProducts((prev) => prev.filter((p) => p.asin !== asin))
    setTotal((t) => Math.max(0, t - 1))
    try { await fetch(`/api/epc/list?asin=${asin}`, { method: 'DELETE' }) } catch { /* optimistic */ }
  }

  // Open the cleanup popover: fetch a fresh preview (staleness buckets, duplicate
  // count, crawl coverage) so the operator picks a window with the numbers in view.
  async function openCleanup() {
    if (cleaning) return
    if (cleanupOpen) { setCleanupOpen(false); return }
    setCleaning(true)
    try {
      const pre = await fetch('/api/epc/cleanup').then((r) => r.json()).catch(() => null)
      if (!pre?.ok) { toast.error(pre?.error || 'Could not check the library.'); return }
      setCleanupData(pre as EpcCleanupPreview)
      setCleanupOpen(true)
    } catch {
      toast.error('Could not check the library. Try again.')
    } finally {
      setCleaning(false)
    }
  }

  // Run one cleanup pass: 'stale' (not seen in a scan for N+ days) or 'duplicates'
  // (collapse exact-ASIN dupes). Confirms, then refreshes the grid + preview.
  async function runCleanup(mode: 'stale' | 'duplicates', days?: number) {
    if (cleaning) return
    const n = mode === 'stale'
      ? (days === 30 ? cleanupData?.stale.d30 : days === 60 ? cleanupData?.stale.d60 : cleanupData?.stale.d90) ?? 0
      : cleanupData?.duplicates ?? 0
    if (!n) { toast.info('Nothing to remove for that option.'); return }
    const label = mode === 'stale'
      ? `${n.toLocaleString()} product${n === 1 ? '' : 's'} not seen in a scan for ${days}+ days`
      : `${n.toLocaleString()} duplicate row${n === 1 ? '' : 's'}`
    if (!window.confirm(`Remove ${label}? You can always re-scan to add anything back.`)) return
    setCleaning(true)
    try {
      const res = await fetch('/api/epc/cleanup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'stale' ? { mode, days } : { mode }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) { toast.error(d.error || 'Cleanup failed.'); return }
      setTotal(Number(d.total) || 0)
      toast.success(`Removed ${(Number(d.removed) || 0).toLocaleString()}. Library now holds ${(Number(d.total) || 0).toLocaleString()}.`)
      setCleanupOpen(false)
      await load(q, sort, filters)
    } catch {
      toast.error('Cleanup failed unexpectedly. Try again.')
    } finally {
      setCleaning(false)
    }
  }

  return (
    <div>
      {/* Header — two actions + a collapsible how-to. */}
      <div className="card mb-5 overflow-hidden" style={{ borderWidth: 2, borderColor: 'rgba(124,58,237,0.45)', boxShadow: '0 14px 36px -16px rgba(124,58,237,0.45)' }}>
        <div className="px-4 py-3" style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.10), transparent 85%)' }}>
          <div className="flex items-start gap-3 flex-wrap">
            <span className="grid place-items-center w-7 h-7 rounded-lg flex-shrink-0 mt-0.5" style={{ background: 'rgba(124,58,237,0.12)' }}>
              <Radar size={14} className="text-[#7C3AED]" />
            </span>
            <div className="flex-1 min-w-[220px]">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>EPC library <span className="font-normal" style={{ color: 'var(--text-faint)' }}>· Sponsored Products opportunities</span></p>
              <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
                {isAdmin
                  ? 'Open your Sponsored Products on Amazon, accept your campaigns, then scan them into this searchable library.'
                  : 'A searchable library of Amazon Sponsored Products EPC opportunities, kept updated for you. Search or filter, then grab a link or turn any one into a blog or social post.'}
              </p>
            </div>
            {/* Scan controls are operator-only: the library is built centrally and
                served to everyone, so regular users never see "accept + scan". */}
            {isAdmin && (
              <div className="flex flex-col gap-2 self-start">
                <a href="https://affiliate-program.amazon.com/p/connect/requests" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold border"
                  style={{ borderColor: 'rgba(124,58,237,0.45)', color: '#7C3AED', background: 'var(--surface)' }}
                  title="Opens Creator Connections on Amazon. Sign in with the Amazon Associates account that holds your store ID, then accept your campaigns and open the Accepted tab.">
                  <ShoppingCart size={14} /> Open my EPC on Amazon <ExternalLink size={12} />
                </a>
                <button onClick={loadViaApi} disabled={apiLoading || scanning}
                  title="Load every EPC opportunity straight from Amazon's own API (paginated, exact count, no duplicates). Runs in the background and fills the library live."
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-70" style={{ background: '#7C3AED' }}>
                  {apiLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {apiLoading
                    ? `Loading… ${(apiCount?.loaded ?? 0).toLocaleString()}${apiCount?.total ? ` / ${apiCount.total.toLocaleString()}` : ''}`
                    : 'Load all from Amazon'}
                </button>
                {apiLoading && (
                  <button onClick={() => { apiCancel.current = true }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                    Stop
                  </button>
                )}
                <button onClick={scan} disabled={scanning || apiLoading}
                  title="Fallback: scrape the on-screen grid (slower and can miss/duplicate). Prefer 'Load all from Amazon'."
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-medium border disabled:opacity-70"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-soft)', background: 'var(--surface)' }}>
                  {scanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {scanning ? 'Scanning…' : 'Scan grid (fallback)'}
                </button>
              </div>
            )}
          </div>

          {/* Collapsible how-to — keeps the page clean; the detail is one click away. */}
          <button onClick={() => setHelpOpen((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: 'var(--text-soft)' }}>
            <ChevronDown size={13} className="transition-transform" style={{ transform: helpOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            {isAdmin ? 'How EPC works & how to set it up' : 'How EPC works'}
          </button>
          {helpOpen && (
            <div className="mt-2">
              {/* Do this first — same for everyone: accept all on Amazon, then
                  search the library. Users don't scan anything; the catalogue is
                  already here for them to search. */}
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,204,0,0.10)', border: '1px solid rgba(255,204,0,0.35)' }}>
                <p className="text-[12px] font-semibold" style={{ color: '#8a6d00' }}>Do this first: Accept your campaigns</p>
                <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
                  You only earn EPC on products you&rsquo;ve accepted in your own Amazon account. Open <b>Amazon Creator Connections</b>, sign in with the Associates account that holds your store ID, and use <b>&ldquo;Accept all&rdquo;</b> on the <b>Sponsored Products for Creators</b> tab. Then come back and <b>search this EPC Library</b> for products to promote.
                </p>
              </div>
              {isAdmin && (
                <p className="text-[11px] leading-relaxed mt-2" style={{ color: 'var(--text-faint)' }}>
                  Operator note: the library is built centrally, so creators don&rsquo;t scan anything, they just accept and search. The Scan control above tops it up from your own Accepted grid when you want to.
                </p>
              )}
              <div className="mt-2 rounded-lg px-3 py-2" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.30)' }}>
                <p className="text-[12px] font-semibold" style={{ color: '#7C3AED' }}>Worth it for Gold &amp; Platinum creators</p>
                <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
                  EPC pays on <b>qualified clicks</b> from offsite traffic (YouTube, socials, your blog), and Amazon only pays it to <b>Gold and Platinum</b> Creator Star tier creators. Below Gold, these clicks don&apos;t earn, so promoting EPC products isn&apos;t worth it yet. Use <b>Get link</b> on any card to drop one offsite, or make a blog / social post: with Passport Links on it hands you a geo-routing link that sends each visitor to their own country&apos;s Amazon, and either way the link earns EPC. Track it in Amazon&apos;s <b>Creator Connections → Sponsored Products for Creators</b> reporting tab.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scan diagnostic — what SCOUT actually saw on the last scan. */}
      {debug && (
        <div className="mb-4 rounded-lg px-3 py-2 text-[11px] flex items-start gap-2" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-soft)' }}>
          <span className="font-semibold flex-shrink-0" style={{ color: 'var(--text)' }}>Scan check:</span>
          <span>{debug}</span>
        </div>
      )}

      {/* Search + sort */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or brand…" className="input-field w-full pl-9 text-sm" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="input-field text-sm w-auto">
          {sortOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {isAdmin && total > 0 && (
          <button onClick={fillImages} disabled={filling}
            title="Fetch the image, sales rank, monthly sales and price history for any card still missing them (skips ones already filled)."
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-medium border disabled:opacity-60"
            style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
            {filling ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
            {filling ? (fillMsg || 'Filling…') : 'Fill in details'}
          </button>
        )}
        {isAdmin && total > 0 && (
          <div ref={cleanupRef} className="relative">
            <button onClick={openCleanup} disabled={cleaning}
              title="Trim the library to what's live. EPC cards show no end date, so this uses the last time SCOUT saw each product — anything not seen in a while has likely dropped out of EPC."
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-medium border disabled:opacity-60"
              style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
              {cleaning ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {cleaning ? 'Working…' : 'Clean up'}
            </button>
            {cleanupOpen && cleanupData && (
              <div className="mvp-panel absolute right-0 top-full mt-2 z-50 w-[320px] rounded-xl border p-3.5 shadow-xl">
                <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Trim the EPC library</p>
                <p className="text-[11.5px] leading-relaxed mt-1" style={{ color: 'var(--text-soft)' }}>
                  EPC cards don&rsquo;t show an end date, so we use the last time a scan saw each product. Do a full scan pass first so live products are freshly stamped, then remove the stragglers.
                </p>

                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>Not seen in a scan for…</p>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {([30, 60, 90] as const).map((d) => {
                    const n = d === 30 ? cleanupData.stale.d30 : d === 60 ? cleanupData.stale.d60 : cleanupData.stale.d90
                    return (
                      <button key={d} onClick={() => runCleanup('stale', d)} disabled={cleaning || !n}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[12.5px] font-medium border transition-colors disabled:opacity-45"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)', background: 'var(--surface)' }}>
                        <span>{d}+ days</span>
                        <span style={{ color: n ? '#dc2626' : 'var(--text-faint)' }}>{n.toLocaleString()} to remove</span>
                      </button>
                    )
                  })}
                </div>

                {cleanupData.duplicates > 0 && (
                  <button onClick={() => runCleanup('duplicates')} disabled={cleaning}
                    className="mt-2 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[12.5px] font-medium border disabled:opacity-45"
                    style={{ borderColor: 'var(--border)', color: 'var(--text)', background: 'var(--surface)' }}>
                    <span>Collapse duplicate rows</span>
                    <span style={{ color: '#dc2626' }}>{cleanupData.duplicates.toLocaleString()}</span>
                  </button>
                )}

                <p className="mt-3 text-[10.5px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                  {cleanupData.total.toLocaleString()} in library.
                  {cleanupData.newestScan ? ` Last scan ${new Date(cleanupData.newestScan).toLocaleDateString()}.` : ''}
                  {' '}Removing is safe: re-scan anytime to add anything back.
                </p>
              </div>
            )}
          </div>
        )}
        <span className="text-[12px] ml-auto" style={{ color: 'var(--text-faint)' }}>
          {total.toLocaleString()} {isAdmin ? 'in library' : 'opportunities'}{(q.trim() || activeFilterCount > 0) ? ' (filtered)' : ''}
        </span>
      </div>

      {/* Filters. The on-sale / sales-volume / budget filters need the operator's
          per-scan enrichment, so they only show on the admin's own library. */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {isAdmin && (
          <button onClick={() => setFilters((f) => ({ ...f, onSale: !f.onSale }))}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors"
            style={filters.onSale
              ? { borderColor: '#34c759', color: '#1f7a4d', background: 'rgba(52,199,89,0.12)' }
              : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
            On sale now
          </button>
        )}
        {isAdmin && (
          <select value={filters.minSold} onChange={(e) => setFilters((f) => ({ ...f, minSold: Number(e.target.value) }))} className="input-field text-[12px] w-auto py-1.5">
            <option value={0}>Any sales volume</option>
            <option value={100}>100+ bought/mo</option>
            <option value={500}>500+ bought/mo</option>
            <option value={1000}>1,000+ bought/mo</option>
          </select>
        )}
        <select value={filters.minRating} onChange={(e) => setFilters((f) => ({ ...f, minRating: Number(e.target.value) }))} className="input-field text-[12px] w-auto py-1.5">
          <option value={0}>Any rating</option>
          <option value={4}>4.0★ and up</option>
          <option value={4.5}>4.5★ and up</option>
        </select>
        {isAdmin && (
          <select value={filters.budget} onChange={(e) => setFilters((f) => ({ ...f, budget: e.target.value }))} className="input-field text-[12px] w-auto py-1.5">
            <option value="">Any budget</option>
            <option value="High">High budget</option>
            <option value="Medium">Medium budget</option>
            <option value="Low">Low budget</option>
          </select>
        )}
        <div className="inline-flex items-center gap-1">
          <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>Max $</span>
          <input value={filters.maxPrice} onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value.replace(/[^0-9.]/g, '') }))}
            inputMode="decimal" placeholder="price" className="input-field text-[12px] w-20 py-1.5" />
        </div>
        {activeFilterCount > 0 && (
          <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-[12px] font-medium" style={{ color: '#7C3AED' }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Grid */}
      {!isAdmin && !paidTier ? (
        <div className="text-center py-16 px-6">
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>The EPC library is a paid feature.</p>
          <p className="text-[13px] mt-1 mb-4" style={{ color: 'var(--text-soft)' }}>
            Upgrade to browse curated Sponsored Products opportunities and turn any one into a link, blog, or social post.
          </p>
          <a href="/pricing" className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white" style={{ background: '#7C3AED' }}>
            See plans
          </a>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-16 text-[var(--text-faint)]"><Loader2 size={20} className="animate-spin" /></div>
      ) : products.length === 0 ? (
        <div className="text-center py-16 px-6">
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            {q.trim() ? 'No matches.' : isAdmin ? 'Your EPC library is empty.' : 'The EPC library is still filling up.'}
          </p>
          <p className="text-[13px] mt-1" style={{ color: 'var(--text-soft)' }}>
            {q.trim() ? 'Try a different search.'
              : isAdmin ? 'On Amazon, accept your Sponsored Products campaigns (“Accept all”), open the Accepted tab, then hit “Scan my EPC opportunities” to build it up.'
              : 'New Sponsored Products opportunities are added regularly. Check back soon.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {products.map((p) => (
            <EpcCard
              key={p.asin} p={p} canBlog={canBlog} amazonTag={amazonTag} passportEnabled={passportEnabled}
              canRemove={isAdmin}
              onQuickPost={() => setQuickPost({ asin: p.asin, title: p.title || p.asin, imageUrl: p.image_url })}
              onRemove={() => remove(p.asin)}
            />
          ))}
        </div>
      )}

      {quickPost && (
        <QuickPostModal deal={quickPost} pinterestEnabled={pinterestEnabled} onClose={() => setQuickPost(null)} />
      )}
    </div>
  )
}

// One EPC opportunity card, with its own blog-generation state. "Make blog post"
// runs the same deal-article engine as Deal Radar (POST /api/deals); "Post"
// opens the shared social modal. An EPC product IS an Amazon product, so both
// reuse the existing ASIN-driven flows.
function EpcCard({ p, canBlog, amazonTag, passportEnabled, canRemove, onQuickPost, onRemove }: {
  p: EpcProduct
  canBlog: boolean
  amazonTag: string
  passportEnabled: boolean
  /** Only the operator can delete rows from the shared library. */
  canRemove?: boolean
  onQuickPost: () => void
  onRemove: () => void
}) {
  const bs = budgetStyle(p.budget)
  const [copied, setCopied] = useState(false)
  const [linking, setLinking] = useState(false)

  // Copy the affiliate link for offsite traffic (where EPC clicks come from). With
  // Passport Links on, hand out the geo-routing link (each visitor → their own
  // country's Amazon). Otherwise the standard tagged link, which earns EPC too.
  async function copyLink() {
    if (linking) return
    const flash = () => { setCopied(true); setTimeout(() => setCopied(false), 1800) }
    const write = (url: string, ok: string, warn?: string) =>
      navigator.clipboard?.writeText(url).then(() => { flash(); if (warn) toast.warning(warn); else toast.success(ok) })
        .catch(() => toast.error('Could not copy the link.'))
    if (passportEnabled) {
      setLinking(true)
      try {
        const res = await fetch('/api/passport/link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asin: p.asin, title: p.title || p.asin }),
        })
        const d = await res.json().catch(() => ({}))
        if (res.ok && d.url) { await write(d.url, 'Passport Link copied — it geo-routes each visitor.'); return }
        toast.error(d.error || 'Could not create the link.')
      } finally { setLinking(false) }
      return
    }
    const tag = (amazonTag || '').trim()
    await write(
      `https://www.amazon.com/dp/${p.asin}${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`,
      'Affiliate link copied.',
      tag ? undefined : 'Link copied, but set your Amazon Associates tag in Brand Profile so it earns.',
    )
  }
  const [gen, setGen] = useState<'idle' | 'working' | 'done'>('idle')
  const [postUrl, setPostUrl] = useState<string | null>(null)

  async function makePost() {
    if (gen === 'working') return
    setGen('working')
    const submit = (confirmDuplicate: boolean) => fetch('/api/deals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asin: p.asin, occasion: 'auto', ...(confirmDuplicate ? { confirmDuplicate: true } : {}) }),
    }).then(async (res) => ({ res, data: await res.json().catch(() => ({})) }))
    try {
      let { res, data } = await submit(false)
      if (data?.duplicate) {
        const ok = window.confirm(`You've already posted this product${data.existingTitle ? ` (“${String(data.existingTitle).slice(0, 60)}”)` : ''}. Publish another article anyway?`)
        if (!ok) { setGen('idle'); return }
        ;({ res, data } = await submit(true))
      }
      if (!res.ok) { toast.error(data.error || 'Could not create the post.'); setGen('idle'); return }
      setPostUrl(data.url || null); setGen('done')
      toast.success('Blog post published.')
    } catch { toast.error('Could not create the post.'); setGen('idle') }
  }

  return (
    <div className="rounded-xl border overflow-hidden flex flex-col" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="flex gap-3 p-3">
        {p.image_url
          ? <img loading="lazy" decoding="async" src={p.image_url} alt="" className="w-16 h-16 rounded-lg object-contain flex-shrink-0 bg-white" />
          : <div className="w-16 h-16 rounded-lg flex-shrink-0" style={{ background: 'rgba(124,58,237,0.08)' }} />}
        <div className="flex-1 min-w-0">
          {p.brand && <div className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: '#7C3AED' }}>{p.brand}</div>}
          <p className="text-[12.5px] font-medium leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>{p.title || p.asin}</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-soft)' }}>
            {p.price_cents != null ? `$${(p.price_cents / 100).toFixed(2)}` : ''}
            {p.rating != null ? <> · <Star size={9} className="inline -mt-0.5" style={{ color: '#ff9500' }} /> {p.rating}</> : null}
            {p.monthly_sold != null ? <> · {p.monthly_sold >= 1000 ? `${Math.round(p.monthly_sold / 1000)}k` : p.monthly_sold}+ sold/mo</> : null}
          </p>
          {(p.sales_rank != null || p.sales_rank_category) && (
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
              {p.sales_rank != null ? `#${p.sales_rank.toLocaleString()}` : ''}{p.sales_rank_category ? ` in ${p.sales_rank_category}` : ''}
            </p>
          )}
        </div>
      </div>
      {/* Price history (Keepa): current vs its usual 90-day average + all-time low,
          so a real deal is obvious at a glance. Only shown once enriched. */}
      {(p.price_now_cents != null || p.price_lowest_cents != null) && (
        <div className="px-3 pb-1.5 text-[11px] flex flex-wrap items-baseline gap-x-2 gap-y-0.5" style={{ color: 'var(--text-soft)' }}>
          {p.price_now_cents != null && <span className="font-semibold" style={{ color: 'var(--text)' }}>{money(p.price_now_cents)}</span>}
          {p.price_avg_cents != null && p.discount_pct != null && p.discount_pct >= 1 && (
            <span><span style={{ textDecoration: 'line-through' }}>{money(p.price_avg_cents)}</span> usual</span>
          )}
          {p.price_lowest_cents != null && <span style={{ color: 'var(--text-faint)' }}>· low {money(p.price_lowest_cents)}</span>}
        </div>
      )}
      <div className="px-3 pb-2 flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-baseline gap-1 px-2 py-1 rounded-md text-[12px] font-bold" style={{ background: 'rgba(52,199,89,0.12)', color: '#1f7a4d' }}>
          {p.epc_display || (p.epc_value != null ? `Up to $${p.epc_value.toFixed(2)}` : 'EPC n/a')}
        </span>
        {(() => { const d = dealBadge(p.deal_quality, p.discount_pct); return d
          ? <span className="px-2 py-1 rounded-md text-[11px] font-semibold" style={{ background: d.bg, color: d.color }} title="Price vs its 90-day average">{d.text}</span>
          : null })()}
        {p.budget && (
          <span className="px-2 py-1 rounded-md text-[11px] font-semibold" style={{ background: bs.bg, color: bs.color }} title="Budget availability score">
            {p.budget} budget
          </span>
        )}
      </div>
      {/* Get link — the standard associate link that earns EPC on offsite clicks. */}
      <div className="px-3 pb-2">
        <button onClick={copyLink} disabled={linking}
          className="w-full inline-flex items-center justify-center gap-1.5 text-[11.5px] font-semibold rounded-lg py-1.5 border disabled:opacity-60"
          style={{ borderColor: 'rgba(124,58,237,0.4)', color: '#7C3AED', background: 'rgba(124,58,237,0.06)' }}
          title={passportEnabled
            ? 'Copy your Passport Link — sends each visitor to their own country’s Amazon and tracks clicks'
            : 'Copy your affiliate link to drop offsite (YouTube, socials, blog) — EPC pays on those clicks'}>
          {linking ? <><Loader2 size={13} className="animate-spin" /> Building…</>
            : copied ? <><Check size={13} /> Link copied</>
            : <><LinkIcon size={13} /> {passportEnabled ? 'Get Passport Link' : 'Get affiliate link'}</>}
        </button>
      </div>
      {/* Actions: turn the opportunity into content. */}
      <div className="px-3 pb-2 flex items-center gap-1.5">
        {canBlog && (
          gen === 'done' && postUrl ? (
            <a href={postUrl} target="_blank" rel="noopener noreferrer"
               className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-lg py-1.5 text-white" style={{ background: '#34c759' }}>
              <Check size={12} /> View post
            </a>
          ) : (
            <button onClick={makePost} disabled={gen === 'working'}
              className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-lg py-1.5 text-white disabled:opacity-60" style={{ background: '#7C3AED' }}>
              {gen === 'working' ? <><Loader2 size={12} className="animate-spin" /> Writing…</> : <><FileText size={12} /> Blog post <ArrowRight size={11} /></>}
            </button>
          )
        )}
        <button onClick={onQuickPost}
          className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-lg py-1.5 text-white" style={{ background: '#f97316' }}>
          <Send size={12} /> Post to socials
        </button>
      </div>
      <div className="mt-auto px-3 py-2 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--border)' }}>
        <a href={`https://www.amazon.com/dp/${p.asin}`} target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--text-soft)' }} title="View on Amazon (direct)">
          View on Amazon <ExternalLink size={11} />
        </a>
        <button
          onClick={() => { navigator.clipboard?.writeText(p.asin).then(() => toast.success('ASIN copied.')).catch(() => {}) }}
          title="Copy ASIN"
          className="inline-flex items-center gap-1 text-[10px] font-mono font-medium" style={{ color: 'var(--text-faint)' }}>
          {p.asin} <Copy size={10} />
        </button>
        {canRemove && (
          <button onClick={onRemove} title="Remove from library"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-faint)] hover:text-[#b3261e]">
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  )
}
