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
  PenLine, Check, ArrowRight, Coins, Users, Wallet, Clock, Video, Star, TrendingUp,
} from 'lucide-react'
import type { MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'

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

const PAGE_SIZE = 40
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
  const [videoOnly, setVideoOnly] = useState(false)

  const [rows, setRows] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [savedAsins, setSavedAsins] = useState<Set<string>>(new Set())

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
      if (videoOnly) params.set('video', '1')
      params.set('sort', sort)
      params.set('page', String(pageToLoad))
      const res = await fetch(`/api/campaigns/browse?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not load campaigns.'); if (!append) setRows([]); return }
      const incoming: Campaign[] = Array.isArray(data.campaigns) ? data.campaigns : []
      setRows(prev => append ? [...prev, ...incoming] : incoming)
      setHasMore(incoming.length === PAGE_SIZE)
      setPage(pageToLoad)
    } catch {
      setError('Could not load campaigns.')
    } finally {
      if (append) setLoadingMore(false); else setLoading(false)
    }
  }, [q, sort, minCommission, minDaysLeft, openSlotsOnly, minRating, minRecentSales, videoOnly])

  // Debounced reload on any filter change.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { void load() }, 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [load])

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

  const hasFilters = q.trim() || minCommission > 0 || minDaysLeft > 0 || openSlotsOnly || minRating > 0 || minRecentSales > 0 || videoOnly
  const clearFilters = () => { setQ(''); setMinCommission(0); setMinDaysLeft(0); setOpenSlotsOnly(false); setMinRating(0); setMinRecentSales(0); setVideoOnly(false); setSort('commission') }

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
          <Select value={sort} onChange={setSort} options={SORTS.map(s => ({ v: s.key, l: s.label }))} />
          <Select value={String(minCommission)} onChange={v => setMinCommission(Number(v))} options={[
            { v: '0', l: 'Any commission' }, { v: '5', l: '5%+' }, { v: '10', l: '10%+' }, { v: '15', l: '15%+' }, { v: '20', l: '20%+' },
          ]} />
          <Select value={String(minDaysLeft)} onChange={v => setMinDaysLeft(Number(v))} options={[
            { v: '0', l: 'Any runway' }, { v: '7', l: '7+ days left' }, { v: '14', l: '14+ days' }, { v: '30', l: '30+ days' },
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
          <button
            onClick={() => setVideoOnly(v => !v)}
            className="h-9 text-sm font-medium rounded-full border px-3.5 inline-flex items-center gap-1.5 transition-all active:scale-[0.97]"
            style={videoOnly
              ? { background: '#c026d3', color: '#fff', borderColor: '#c026d3' }
              : { background: 'var(--surface)', color: 'var(--text-soft)', borderColor: 'var(--border)' }}>
            <Video size={14} /> Has video
          </button>
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
          {hasFilters ? 'No campaigns match those filters — try widening them.' : 'No campaigns in the catalog right now — check back soon.'}
        </div>
      ) : (
        <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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

function BrowseCard({ c, saved, covered, onToggleSave, onMessageBrand }: {
  c: Campaign; saved: boolean; covered: boolean; onToggleSave: () => void; onMessageBrand: () => void
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

  // Days-left urgency colour.
  const dl = c.daysLeft
  const dlColor = dl == null ? 'var(--text-faint)' : dl <= 7 ? '#ff3b30' : dl <= 14 ? '#f59e0b' : '#34c759'

  return (
    <div className="rounded-xl border flex flex-col overflow-hidden" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }}>
      <div className="p-3 flex flex-col gap-2 flex-1">
        {/* Thumbnail + brand + name */}
        <div className="flex gap-2.5">
          {c.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.imageUrl} alt="" className="w-14 h-14 rounded-lg object-contain flex-shrink-0 bg-white border" style={{ borderColor: 'var(--border)' }} />
          ) : (
            <div className="w-14 h-14 rounded-lg flex-shrink-0 grid place-items-center" style={{ background: 'rgba(124,58,237,0.06)' }}>
              <Coins size={18} style={{ color: 'rgba(124,58,237,0.4)' }} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: 'var(--text-faint)' }}>{c.brand || 'Brand'}</span>
              {dl != null && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold flex-shrink-0" style={{ color: dlColor }}>
                  <Clock size={11} /> {dl}d left
                </span>
              )}
            </div>
            <p className="text-[12.5px] font-semibold leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>
              {c.campaignName}
              {c.asinCount > 1 && <span className="font-normal" style={{ color: 'var(--text-faint)' }}> · {c.asinCount} products</span>}
            </p>
          </div>
        </div>

        {/* Commission + price */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-lg font-extrabold" style={{ color: '#7C3AED' }}>
            <Coins size={15} /> +{c.commissionPct}%
          </span>
          {c.priceNow != null && (
            <span className="inline-flex items-baseline gap-1.5 text-[12px]" style={{ color: 'var(--text)' }}>
              <span className="font-semibold">${c.priceNow.toFixed(2)}</span>
              {c.discountPct != null && c.discountPct > 0 && <span className="font-bold" style={{ color: '#e11d48' }}>-{c.discountPct}%</span>}
            </span>
          )}
        </div>

        {/* Product signals (fill in as the enrichment cron reaches each product) */}
        {(c.rating != null || c.monthlySold != null || c.hasVideo) && (
          <div className="flex items-center gap-2.5 flex-wrap text-[11px]" style={{ color: 'var(--text-soft)' }}>
            {c.rating != null && (
              <span className="inline-flex items-center gap-1"><Star size={11} style={{ color: '#f59e0b', fill: '#f59e0b' }} /> {c.rating.toFixed(1)}{c.reviewCount != null ? ` (${c.reviewCount.toLocaleString()})` : ''}</span>
            )}
            {c.monthlySold != null && (
              <span className="inline-flex items-center gap-1" style={{ color: '#2563eb' }}><TrendingUp size={11} /> {c.monthlySold.toLocaleString()}+/mo</span>
            )}
            {c.hasVideo && (
              <span className="inline-flex items-center gap-1" style={{ color: '#c026d3' }}><Video size={11} /> video{c.videoCount && c.videoCount > 1 ? ` ×${c.videoCount}` : ''}</span>
            )}
          </div>
        )}

        {/* Budget bar */}
        {c.budgetPct != null && (
          <Meter icon={<Wallet size={11} />} label={`${money(c.budgetRemaining)} left`}
            sub={c.budget != null ? `of ${money(c.budget)}` : ''} pct={c.budgetPct} color="#34c759" />
        )}
        {/* Slots bar */}
        {c.totalSlot != null && c.slotsClaimed != null && (
          <Meter icon={<Users size={11} />} label={`${c.slotsClaimed} of ${c.totalSlot} claimed`}
            sub={c.slotsOpen != null ? `${c.slotsOpen} open` : ''} pct={Math.round((c.slotsClaimed / c.totalSlot) * 100)} color="#f59e0b" />
        )}

        {covered && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium w-fit" style={{ color: '#34c759' }}>
            <Check size={11} /> Already in your queue
          </span>
        )}

        {/* Actions */}
        <div className="mt-auto pt-2 space-y-1.5">
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
            <a href={`https://www.amazon.com/dp/${c.asin}`} target="_blank" rel="noopener noreferrer" title="Buy to review on Amazon"
              className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1.5 text-white flex-shrink-0" style={{ background: '#34c759' }}>
              <ShoppingCart size={12} />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

function Meter({ icon, label, sub, pct, color }: { icon: React.ReactNode; label: string; sub?: string; pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5" style={{ color: 'var(--text-soft)' }}>
        <span className="inline-flex items-center gap-1 font-medium">{icon} {label}</span>
        {sub && <span style={{ color: 'var(--text-faint)' }}>{sub}</span>}
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
        <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: color }} />
      </div>
    </div>
  )
}
