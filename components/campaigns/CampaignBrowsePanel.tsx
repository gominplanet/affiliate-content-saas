'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Browse all" — the fast, sortable, mobile-friendly view of the shared Creator
// Connections catalog (GET /api/campaigns/browse). Instant SQL, no SCOUT scan,
// no Amazon traffic: the CreatorKit-style table (rate · budget left · slots
// claimed · days left) with the user's own sort/filter — plus the thing a
// scanner can't do: one-click "Write review" straight into the content engine.
//
// Product-signal columns (recent sales / rating / video count) land here once
// the catalog's ASINs are Keepa-enriched; this first pass serves the
// campaign-economics the catalog already holds.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, Search, Bookmark, BookmarkCheck, MessageCircle, ShoppingCart,
  PenLine, Check, ArrowRight, Coins, Users, Video, BarChart3, ImageOff, Lock, ShieldCheck, Sparkles,
} from 'lucide-react'
import type { MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'
import ProductDeepDiveModal from '@/components/product/ProductDeepDiveModal'
import { requestCcSmartScan } from '@/lib/extension-frame'
import { campaignRules } from '@/lib/cc-smart-rules'

interface Campaign {
  campaignId: string
  campaignName: string
  brand: string | null
  asin: string
  asinCount: number
  commissionPct: number
  startsAt: string | null
  endsAt: string
  daysLeft: number | null
  slotsOpen: number | null
  totalSlot: number | null
  slotsClaimed: number | null
  budget: number | null
  budgetRemaining: number | null
  budgetPct: number | null
  // Product signals — null until the enrichment cron has reached this product.
  imageUrl: string | null
  priceNow: number | null
  priceWas: number | null
  discountPct: number | null
  rating: number | null
  reviewCount: number | null
  monthlySold: number | null
  videoCount: number | null
  hasVideo: boolean
}

const SORTS: { key: string; label: string }[] = [
  { key: 'commission', label: 'Highest commission' },
  { key: 'recentSales', label: 'Recent sales' },
  { key: 'rating', label: 'Highest rating' },
  { key: 'endingSoon', label: 'Ending soon' },
  { key: 'mostRunway', label: 'Most days left' },
  { key: 'slots', label: 'Most slots open' },
  { key: 'budget', label: 'Most budget left' },
]

const money = (n: number | null) => (n == null ? null : n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`)

export default function CampaignBrowsePanel({
  coveredAsins,
  onMessageBrand,
  onSavedChange,
}: {
  coveredAsins: string[]
  onMessageBrand: (c: MessageBrandCampaign) => void
  onSavedChange?: () => void
}) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('commission')
  const [minCommission, setMinCommission] = useState(0)
  const [minDaysLeft, setMinDaysLeft] = useState(0)
  const [openSlotsOnly, setOpenSlotsOnly] = useState(false)
  const [minRating, setMinRating] = useState(0)
  const [minRecentSales, setMinRecentSales] = useState(0)
  const [maxVideos, setMaxVideos] = useState('') // '' off · '5'/'2' ≤N · '0' untapped
  // MVP picks: apply MVP's Focus rulebook (commission / runway / price / demand /
  // rating floors + a product-carousel required) over the catalog. Free — it just
  // filters the already-enriched columns.
  const [mvpPicks, setMvpPicks] = useState(false)

  const [rows, setRows] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [savedAsins, setSavedAsins] = useState<Set<string>>(new Set())
  const [deepDive, setDeepDive] = useState<{ asin: string; title: string; imageUrl: string | null } | null>(null)
  // CC-access confidentiality gate: Browse stays locked until SCOUT confirms the
  // user's own Creator Connections grid renders. null = unknown/allowed.
  const [locked, setLocked] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null)

  const covered = new Set(coveredAsins.map(a => a.toUpperCase()))

  useEffect(() => {
    fetch('/api/campaigns/saved').then(r => r.json()).then(d => {
      if (d?.ok && Array.isArray(d.saved)) setSavedAsins(new Set(d.saved.map((s: { asin: string }) => s.asin.toUpperCase())))
    }).catch(() => {})
  }, [])

  const load = useCallback(async (pageToLoad = 0, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (minCommission > 0) params.set('minCommission', String(minCommission))
      if (minDaysLeft > 0) params.set('minDaysLeft', String(minDaysLeft))
      if (openSlotsOnly) params.set('openSlots', '1')
      if (minRating > 0) params.set('minRating', String(minRating))
      if (minRecentSales > 0) params.set('minRecentSales', String(minRecentSales))
      if (maxVideos) params.set('maxVideos', maxVideos)
      if (mvpPicks) params.set('mvpPicks', '1')
      params.set('sort', sort)
      params.set('page', String(pageToLoad))
      const res = await fetch(`/api/campaigns/browse?${params.toString()}`)
      const data = await res.json()
      if (res.status === 403 && data?.needsCcVerify) { setLocked(true); if (!append) setRows([]); return }
      if (!res.ok) { setError(data.error || 'Could not load campaigns.'); if (!append) setRows([]); return }
      setLocked(false)
      const incoming: Campaign[] = Array.isArray(data.campaigns) ? data.campaigns : []
      setRows(prev => append ? [...prev, ...incoming] : incoming)
      // Trust the SERVER's hasMore (raw page was full), NOT the returned count:
      // the server filters each page (rows with no recoverable ASIN, avoid-list),
      // so a page can come back with fewer than a full page of cards while more
      // still exist. Using incoming.length here hid "Load more" after page 1.
      setHasMore(!!data.hasMore)
      setPage(pageToLoad)
    } catch {
      setError('Could not load campaigns.')
    } finally {
      if (append) setLoadingMore(false); else setLoading(false)
    }
  }, [q, sort, minCommission, minDaysLeft, openSlotsOnly, minRating, minRecentSales, maxVideos, mvpPicks])

  // Debounced reload on any filter change.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { void load() }, 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [load])

  // Fill product images on demand for whatever's on screen (Amazon Creators API,
  // operator key). Only asins still missing an image, each tried once per
  // session; results merge into the cards in place. No-op if the API isn't
  // configured (the endpoint returns {} and SCOUT still covers scanned items).
  const enrichTried = useRef<Set<string>>(new Set())
  useEffect(() => {
    const need = rows.filter(r => !r.imageUrl && !enrichTried.current.has(r.asin)).map(r => r.asin)
    if (!need.length) return
    need.forEach(a => enrichTried.current.add(a))
    ;(async () => {
      try {
        const res = await fetch('/api/campaigns/enrich-visible', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asins: need.slice(0, 40) }),
        })
        const data = await res.json().catch(() => ({}))
        const signals = data?.signals as Record<string, {
          imageUrl?: string | null; priceNow?: number | null; priceWas?: number | null
          discountPct?: number | null; rating?: number | null; reviewCount?: number | null
          monthlySold?: number | null; videoCount?: number | null
        }> | undefined
        if (!signals || !Object.keys(signals).length) return
        // Merge every signal the enrich pass returned (Creators = image+price;
        // Keepa fallback also brings rating/sales/videos), so cards fill fully.
        setRows(prev => prev.map(r => {
          const s = signals[r.asin]
          if (!s) return r
          return {
            ...r,
            imageUrl: s.imageUrl ?? r.imageUrl,
            priceNow: s.priceNow ?? r.priceNow,
            priceWas: s.priceWas ?? r.priceWas,
            discountPct: s.discountPct ?? r.discountPct,
            rating: s.rating ?? r.rating,
            reviewCount: s.reviewCount ?? r.reviewCount,
            monthlySold: s.monthlySold ?? r.monthlySold,
            videoCount: s.videoCount ?? r.videoCount,
            hasVideo: typeof s.videoCount === 'number' ? s.videoCount > 0 : r.hasVideo,
          }
        }))
      } catch { /* best-effort */ }
    })()
  }, [rows])

  async function toggleSave(c: Campaign) {
    const asin = c.asin.toUpperCase()
    const wasSaved = savedAsins.has(asin)
    setSavedAsins(prev => { const n = new Set(prev); if (wasSaved) n.delete(asin); else n.add(asin); return n })
    try {
      if (wasSaved) await fetch(`/api/campaigns/saved?asin=${asin}`, { method: 'DELETE' })
      else await fetch('/api/campaigns/saved', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: c.asin, source: 'campaign', title: c.campaignName, brand: c.brand,
          campaignId: c.campaignId, commissionPct: c.commissionPct,
        }),
      })
      onSavedChange?.()
    } catch {
      setSavedAsins(prev => { const n = new Set(prev); if (wasSaved) n.add(asin); else n.delete(asin); return n })
      toast.error('Could not update your saved list.')
    }
  }

  // "Verify my CC access" — SCOUT opens the user's own Creator Connections grid
  // and scans it. Getting real campaigns back proves they're an invited creator;
  // we stamp that proof server-side, which unlocks Browse. A non-CC user's grid
  // returns nothing, so it can't unlock the shared catalog for them.
  async function verifyCcAccess() {
    if (verifying) return
    setVerifying(true); setVerifyMsg('SCOUT is opening your Creator Connections grid to confirm your access — this can take a minute…')
    try {
      const res = await requestCcSmartScan(campaignRules('wide'))
      if (!res.ok) {
        setVerifyMsg(
          res.error === 'not-installed'
            ? 'SCOUT isn’t connected — install and connect it (see "Connect" above), then try again.'
            : res.error === 'timeout'
              ? 'That ran long and timed out — try again in a moment.'
              : 'We couldn’t confirm a Creator Connections grid for your account. Open your Creator Connections tab once, then try again.',
        )
        return
      }
      if (!(res.matches && res.matches.length > 0)) {
        setVerifyMsg('Your Creator Connections grid opened but had no live campaigns to confirm against right now. Try again when opportunities are showing.')
        return
      }
      const stamp = await fetch('/api/campaigns/cc-verify', { method: 'POST' }).then(r => r.json()).catch(() => null)
      if (stamp?.verified) {
        setLocked(false); setVerifyMsg(null)
        toast.success('Creator Connections access confirmed — Browse all is unlocked.')
        void load()
      } else {
        setVerifyMsg('Verified your grid, but couldn’t save it just now. Please try again.')
      }
    } catch {
      setVerifyMsg('Verification failed unexpectedly — reload the page and try again.')
    } finally {
      setVerifying(false)
    }
  }

  const hasFilters = q.trim() || minCommission > 0 || minDaysLeft > 0 || openSlotsOnly || minRating > 0 || minRecentSales > 0 || !!maxVideos || mvpPicks
  const clearFilters = () => { setQ(''); setMinCommission(0); setMinDaysLeft(0); setOpenSlotsOnly(false); setMinRating(0); setMinRecentSales(0); setMaxVideos(''); setSort('commission'); setMvpPicks(false) }

  if (locked) {
    return (
      <div className="card mb-5 overflow-hidden" style={{ borderWidth: 2, borderColor: 'rgba(124,58,237,0.30)' }}>
        <div className="px-6 py-12 text-center max-w-lg mx-auto">
          <span className="grid place-items-center w-14 h-14 rounded-2xl mx-auto mb-4" style={{ background: 'rgba(124,58,237,0.10)' }}>
            <Lock size={26} style={{ color: '#7C3AED' }} />
          </span>
          <h3 className="text-[16px] font-bold mb-2" style={{ color: 'var(--text)' }}>Creator Connections access required</h3>
          <p className="text-[13px] leading-relaxed mb-1" style={{ color: 'var(--text-soft)' }}>
            The shared campaign catalog is Amazon Creator Connections data, kept private to invited creators. Confirm your own Creator Connections access once and Browse all unlocks for you.
          </p>
          <p className="text-[12px] leading-relaxed mb-5" style={{ color: 'var(--text-faint)' }}>
            SCOUT opens your Creator Connections grid and confirms it renders for your account; nothing is shared.
          </p>
          <button
            onClick={verifyCcAccess}
            disabled={verifying}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold text-white disabled:opacity-70"
            style={{ background: '#7C3AED' }}>
            {verifying ? <><Loader2 size={15} className="animate-spin" /> Verifying…</> : <><ShieldCheck size={15} /> Verify my CC access</>}
          </button>
          {verifyMsg && <p className="text-[12px] leading-relaxed mt-4" style={{ color: 'var(--text-faint)' }}>{verifyMsg}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="card mb-5 overflow-hidden" style={{ borderWidth: 2, borderColor: 'rgba(124,58,237,0.30)' }}>
      {/* Filter bar */}
      <div className="px-3.5 py-3 space-y-2.5" style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.06), transparent 85%)' }}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-[18px] w-[18px]" style={{ color: 'var(--text-faint)' }} />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search campaigns (brand or product)…"
            className="w-full h-11 pl-11 pr-3.5 text-sm rounded-xl border bg-white dark:bg-[#1c1c1e] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-500/30 transition-shadow"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* MVP picks — MVP's Focus rulebook over the catalog (carousel required). */}
          <button
            onClick={() => setMvpPicks(v => !v)}
            title="MVP picks: MVP's proven campaign criteria — 15%+ commission, 90+ days runway, $20–800, 100+ sold/mo, 3★+, a product-carousel video, and no supplements/food/pharmacy/clothing."
            className={`h-9 text-sm font-semibold rounded-full px-3.5 inline-flex items-center gap-1.5 border transition-all active:scale-[0.97] ${mvpPicks ? '' : 'bg-white dark:bg-[#1c1c1e]'}`}
            style={mvpPicks
              ? { background: '#7C3AED', color: '#fff', borderColor: '#7C3AED' }
              : { color: 'var(--text-soft)', borderColor: 'var(--border)' }}>
            <Sparkles size={14} /> MVP picks
          </button>
          <Select value={sort} onChange={setSort} options={SORTS.map(s => ({ v: s.key, l: s.label }))} />
          <Select value={String(minCommission)} onChange={v => setMinCommission(Number(v))} options={[
            { v: '0', l: 'Any commission' }, { v: '5', l: '5%+' }, { v: '10', l: '10%+' }, { v: '15', l: '15%+' }, { v: '20', l: '20%+' },
          ]} />
          <Select value={String(minDaysLeft)} onChange={v => setMinDaysLeft(Number(v))} options={[
            { v: '0', l: 'Any runway' }, { v: '7', l: '7+ days left' }, { v: '14', l: '14+ days' }, { v: '30', l: '30+ days' },
            { v: '90', l: '90+ days' }, { v: '180', l: '180+ days' }, { v: '365', l: '365+ days' },
          ]} />
          <Select value={String(minRating)} onChange={v => setMinRating(Number(v))} options={[
            { v: '0', l: 'Any rating' }, { v: '3', l: '3★+' }, { v: '4', l: '4★+' }, { v: '4.5', l: '4.5★+' },
          ]} />
          <Select value={String(minRecentSales)} onChange={v => setMinRecentSales(Number(v))} options={[
            { v: '0', l: 'Any sales' }, { v: '100', l: '100+ sold/mo' }, { v: '500', l: '500+ sold/mo' }, { v: '1000', l: '1k+ sold/mo' },
          ]} />
          <button
            onClick={() => setOpenSlotsOnly(v => !v)}
            className="h-9 text-sm font-medium rounded-full border px-3.5 inline-flex items-center gap-1.5 transition-all active:scale-[0.97]"
            style={openSlotsOnly
              ? { background: '#7C3AED', color: '#fff', borderColor: '#7C3AED' }
              : { background: 'var(--surface)', color: 'var(--text-soft)', borderColor: 'var(--border)' }}>
            <Users size={14} /> Open slots
          </button>
          <Select value={maxVideos} onChange={setMaxVideos} options={[
            { v: '', l: 'Any videos' }, { v: '5', l: '≤ 5 carousel videos' }, { v: '2', l: '≤ 2 videos' }, { v: '0', l: '0 videos — untapped' },
          ]} />
          <span className="text-[11px] hidden lg:inline" style={{ color: 'var(--text-faint)' }} title="Fewer carousel videos = less competition, easier to stand out">
            <Video size={11} className="inline -mt-0.5" /> = product-carousel videos
          </span>
          {hasFilters && (
            <button onClick={clearFilters} className="ml-auto text-xs font-medium inline-flex items-center gap-1 h-8 px-2.5" style={{ color: 'var(--text-faint)' }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--text-faint)' }} /></div>
      ) : error ? (
        <div className="text-center py-12 text-sm" style={{ color: 'var(--text-faint)' }}>{error}</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-sm" style={{ color: 'var(--text-faint)' }}>
          {mvpPicks
            ? "Nothing cleared MVP's bar in this slice yet — the rulebook is strict and only enriched campaigns qualify. Try a keyword or turn MVP picks off to browse everything."
            : hasFilters ? 'No campaigns match those filters — try widening them.' : 'No campaigns in the catalog right now — check back soon.'}
        </div>
      ) : (
        <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
          {/* items-stretch keeps a row's cards equal height; [grid-auto-rows:1fr]
              is dropped because it stretched a single row to the full column
              height, leaving large empty gaps below each card. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
            {rows.map(c => (
              <BrowseCard
                key={c.campaignId}
                c={c}
                saved={savedAsins.has(c.asin.toUpperCase())}
                covered={covered.has(c.asin.toUpperCase())}
                onToggleSave={() => toggleSave(c)}
                onMessageBrand={() => onMessageBrand({
                  product: c.campaignName || c.asin, asin: c.asin,
                  commissionPct: c.commissionPct, detailsUrl: '', brandLabel: c.brand || undefined,
                })}
                onDeepDive={() => setDeepDive({ asin: c.asin, title: c.campaignName, imageUrl: c.imageUrl })}
              />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-4">
              <button onClick={() => void load(page + 1, true)} disabled={loadingMore}
                className="inline-flex items-center gap-2 text-sm font-medium rounded-full border px-5 py-2.5 disabled:opacity-60"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                {loadingMore ? <><Loader2 size={15} className="animate-spin" /> Loading…</> : 'Load more campaigns'}
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

// A rounded-pill native select with a custom chevron, matching the app's filters.
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

function BrowseCard({ c, saved, covered, onToggleSave, onMessageBrand, onDeepDive }: {
  c: Campaign; saved: boolean; covered: boolean; onToggleSave: () => void; onMessageBrand: () => void; onDeepDive: () => void
}) {
  const [gen, setGen] = useState<'idle' | 'working' | 'done'>('idle')
  const [postUrl, setPostUrl] = useState<string | null>(null)

  const writeReview = async () => {
    if (gen === 'working') return
    setGen('working')
    try {
      const res = await fetch('/api/blog/from-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: `https://www.amazon.com/dp/${c.asin}`, productName: c.campaignName }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not write the review.'); setGen('idle'); return }
      setPostUrl(data.url || null); setGen('done')
      toast.success('Review published to your blog.')
    } catch { toast.error('Could not write the review.'); setGen('idle') }
  }

  const dl = c.daysLeft
  const dlColor = dl == null ? 'var(--text)' : dl <= 7 ? '#ff3b30' : dl <= 14 ? '#f59e0b' : '#34c759'
  const endsDate = (() => { try { return new Date(c.endsAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' }) } catch { return '' } })()
  const amazonUrl = `https://www.amazon.com/dp/${c.asin}`

  return (
    <div className="rounded-xl border flex flex-col overflow-hidden h-full" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }}>
      {/* Product image — the hero */}
      <a href={amazonUrl} target="_blank" rel="noopener noreferrer" className="relative block aspect-square bg-white overflow-hidden">
        {c.imageUrl ? (
          // Absolutely filling the square so a tall/odd source photo can never
          // stretch the card taller than the rest (object-contain still shows
          // the whole product, letterboxed inside the fixed square).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.imageUrl} alt="" className="absolute inset-0 w-full h-full object-contain p-3" />
        ) : (
          <div className="w-full h-full grid place-items-center" style={{ background: 'rgba(124,58,237,0.04)' }} title="Preview appears once this product is scanned (Smart Scan)">
            <ImageOff size={24} style={{ color: 'rgba(124,58,237,0.3)' }} />
          </div>
        )}
        {c.discountPct != null && c.discountPct > 0 && (
          <span className="absolute top-2 left-2 text-[11px] font-bold text-white rounded px-1.5 py-0.5" style={{ background: '#e11d48' }}>-{c.discountPct}%</span>
        )}
        {c.asinCount > 1 && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-1"
            style={{ background: 'rgba(52,199,89,0.14)', color: '#1f8a3a' }}>
            {c.asinCount} products <ArrowRight size={9} />
          </span>
        )}
        {/* Deep-dive: price history + product data (opens over the card). */}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeepDive() }}
          title="Price history & product data"
          className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-1 bg-black/55 text-white hover:bg-black/75 backdrop-blur-sm transition-colors">
          <BarChart3 size={10} /> Data
        </button>
      </a>

      <div className="p-3 flex flex-col gap-2 flex-1">
        {/* Brand + ASIN */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold rounded-md px-2 py-0.5 truncate" style={{ background: 'var(--surface-2)', color: 'var(--text-soft)' }}>{c.brand || 'Brand'}</span>
          <span className="text-[10px] font-mono flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{c.asin}</span>
        </div>

        {/* Title */}
        <p className="text-[12.5px] font-semibold leading-snug line-clamp-2 min-h-[2.3rem]" style={{ color: 'var(--text)' }}>{c.campaignName}</p>

        {/* Price */}
        {c.priceNow != null ? (
          <div className="flex items-baseline gap-1.5">
            {c.priceWas != null && c.priceWas > c.priceNow && <span className="text-[12px] line-through" style={{ color: 'var(--text-faint)' }}>${c.priceWas.toFixed(2)}</span>}
            <span className="text-[15px] font-extrabold" style={{ color: '#16a34a' }}>${c.priceNow.toFixed(2)}</span>
            {c.discountPct != null && c.discountPct > 0 && <span className="text-[12px] font-bold" style={{ color: '#e11d48' }}>{c.discountPct}% off</span>}
          </div>
        ) : <div className="h-[1.1rem]" />}

        {/* Stat strip 1 — product signals */}
        <StatRow cells={[
          { label: 'Rating', value: c.rating != null ? `${c.rating.toFixed(1)}★` : '—' },
          { label: 'Bought', value: c.monthlySold != null ? c.monthlySold.toLocaleString() : '—' },
          { label: 'Videos', value: c.videoCount != null ? String(c.videoCount) : '—' },
        ]} />
        {/* Stat strip 2 — campaign economics */}
        <StatRow cells={[
          { label: 'Rate', value: `${c.commissionPct}%`, accent: '#7C3AED' },
          { label: 'Budget', value: c.budgetRemaining != null ? (money(c.budgetRemaining) as string) : '—', sub: c.budget != null ? `of ${money(c.budget)}` : undefined },
          { label: 'Ends', value: dl != null ? `${dl}d` : '—', sub: endsDate || undefined, accent: dlColor },
        ]} />

        {/* Slots claimed */}
        {c.totalSlot != null && c.slotsClaimed != null && (
          <div>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-faint)' }}>
              <span>Slots claimed</span><span className="font-semibold" style={{ color: 'var(--text-soft)' }}>{c.slotsClaimed}<span style={{ color: 'var(--text-faint)' }}> / {c.totalSlot}</span></span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, Math.round((c.slotsClaimed / c.totalSlot) * 100)))}%`, background: c.slotsClaimed / c.totalSlot >= 0.9 ? '#f59e0b' : '#34c759' }} />
            </div>
          </div>
        )}

        {covered && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium w-fit" style={{ color: '#34c759' }}>
            <Check size={11} /> Already in your queue
          </span>
        )}

        {/* Actions */}
        <div className="mt-auto pt-1.5 space-y-1.5">
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
            <button onClick={onMessageBrand} title="Message the brand"
              className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1.5 border flex-1"
              style={{ borderColor: 'rgba(124,58,237,0.4)', color: '#7C3AED' }}>
              <MessageCircle size={12} /> Message
            </button>
            <a href={amazonUrl} target="_blank" rel="noopener noreferrer" title="Buy to review on Amazon"
              className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1.5 text-white flex-shrink-0" style={{ background: '#34c759' }}>
              <ShoppingCart size={12} />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

// A CreatorKit-style 3-cell stat strip: value (+ optional sub) over a tiny
// uppercase label, cells divided by hairlines.
function StatRow({ cells }: { cells: { label: string; value: string; sub?: string; accent?: string }[] }) {
  return (
    <div className="grid grid-cols-3 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
      {cells.map((cell, i) => (
        <div key={i} className="px-1 py-1.5 text-center min-w-0" style={i > 0 ? { borderLeft: '1px solid var(--border-2)' } : undefined}>
          <div className="text-[13px] font-bold leading-tight truncate" style={{ color: cell.accent || 'var(--text)' }}>{cell.value}</div>
          {cell.sub ? <div className="text-[9px] leading-tight truncate" style={{ color: 'var(--text-faint)' }}>{cell.sub}</div> : null}
          <div className="text-[9px] uppercase tracking-wide mt-0.5 truncate" style={{ color: 'var(--text-faint)' }}>{cell.label}</div>
        </div>
      ))}
    </div>
  )
}
