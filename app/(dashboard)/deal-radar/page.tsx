// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Deal Radar (Pro; Labs/admin-only until NEXT_PUBLIC_DEAL_RADAR_ENABLED).
//
// Always-on live Amazon deals (Keepa-backed, cached server-side) with search +
// filters, plus a "double-win" ticker of deals that ALSO carry a Creator
// Connections bounty. Every product link is tagged with the creator's own
// Amazon Associates tag. "Make blog post" generates directly through the deal
// article engine (POST /api/deals) — Deal Radar is always-on and independent of
// the seasonal Deals Hub page. "Quick post" fires straight to socials.

'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Radar, Search, Loader2, Star, Zap, BadgePercent, ExternalLink,
  ArrowRight, Sparkles, TrendingUp, RefreshCw, ShieldCheck, ShieldAlert,
  Send, Check, AlertCircle, X as CloseIcon, HelpCircle, Mail, Info, Coins, Flame,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import QuickPostModal from '@/components/deal/QuickPostModal'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { createBrowserClient } from '@/lib/supabase/client'
import { type Tier } from '@/lib/tier'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'
import { dealRadarEnabled } from '@/lib/feature-flags'

interface DealCampaign { commissionPct: number; brand: string | null; detailsUrl: string | null }
interface DealVerdict { quality: string; label: string | null; typical: number | null; allTimeLow: number | null }
interface Deal {
  asin: string
  title: string
  brand: string | null
  imageUrl: string | null
  categoryId: number | null
  priceNow: number | null
  priceWas: number | null
  discountPct: number | null
  rating: number | null
  reviewCount: number | null
  monthlySold: number | null
  dealType: string
  lightningEndsAt: string | null
  amazonUrl: string
  campaign: DealCampaign | null
  verdict: DealVerdict | null
  /** If the user already turned this ASIN into a deal post, its URL. */
  postedUrl: string | null
  /** Estimated commission per sale (cents) + the rate used. `isBounty` = the
   *  rate is a Creator Connections bounty (exact), else a rough Amazon est. */
  estCommissionCents: number | null
  commissionRatePct: number
  commissionIsBounty: boolean
  opportunityScore: number | null
}

// Category filter options — mirror the cron's swept browse nodes.
const CATEGORIES: { id: number; label: string }[] = [
  { id: 172282, label: 'Electronics' },
  { id: 1055398, label: 'Home & Kitchen' },
  { id: 3375251, label: 'Sports & Outdoors' },
  { id: 3760901, label: 'Health & Household' },
  { id: 3760911, label: 'Beauty' },
  { id: 228013, label: 'Tools' },
  { id: 165793011, label: 'Toys & Games' },
  { id: 2619533011, label: 'Pet Supplies' },
  { id: 1064954, label: 'Office' },
  { id: 15684181, label: 'Automotive' },
  { id: 165796011, label: 'Baby' },
  { id: 7141123011, label: 'Clothing & Shoes' },
  { id: 541966, label: 'Computers' },
  { id: 2335752011, label: 'Cell Phones' },
  { id: 16310101, label: 'Grocery' },
  { id: 11091801, label: 'Musical Instruments' },
  { id: 2972638011, label: 'Patio & Garden' },
  { id: 468642, label: 'Video Games' },
]

const SORTS: { key: string; label: string }[] = [
  { key: 'opportunity', label: 'Best opportunity' },
  { key: 'discount', label: 'Biggest discount' },
  { key: 'commission', label: 'Highest commission' },
  { key: 'ending', label: 'Ending soon' },
  { key: 'bestseller', label: 'Best sellers' },
]

const money = (n: number | null) => (n == null ? null : `$${n.toFixed(2)}`)

// Opt-in toggle for the weekly "Top deals in your niche" auto-post digest.
// Reads/writes integrations.notification_preferences.weekly_digest.
function DigestToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  useEffect(() => {
    fetch('/api/deal-radar/digest-pref').then((r) => r.json()).then((d) => setEnabled(!!d.enabled)).catch(() => setEnabled(false))
  }, [])
  const toggle = async () => {
    if (enabled === null || saving) return
    const next = !enabled
    setEnabled(next); setSaving(true)
    try {
      await fetch('/api/deal-radar/digest-pref', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }),
      })
      toast.success(next ? 'Weekly digest on — a "top deals in your niche" roundup will auto-post to your blog each week.' : 'Weekly digest off.')
    } catch { setEnabled(!next); toast.error('Could not update.') } finally { setSaving(false) }
  }
  if (enabled === null) return null
  return (
    <div className="relative inline-flex items-center gap-1">
      <button onClick={toggle} disabled={saving}
        className={`text-xs rounded-lg border px-2.5 py-2 inline-flex items-center gap-1.5 transition ${enabled ? 'bg-violet-600 text-white border-violet-600' : 'bg-background hover:bg-accent'}`}>
        <Mail size={13} /> Weekly digest{enabled ? ': On' : ''}
      </button>
      <button onClick={() => setShowInfo((v) => !v)} title="What does this do?"
        className="text-muted-foreground hover:text-foreground p-1"><Info size={14} /></button>
      {showInfo && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowInfo(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-xl border bg-white dark:bg-[#16161a] shadow-xl p-4 text-left">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold inline-flex items-center gap-1.5"><Mail size={14} /> Weekly digest</div>
              <button onClick={() => setShowInfo(false)} className="text-muted-foreground hover:text-foreground"><CloseIcon size={14} /></button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Turn this on and MVP <strong className="text-foreground">automatically publishes a &ldquo;Top deals in your niche&rdquo; roundup to your blog about once a week</strong> — completely hands-off.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground leading-relaxed list-disc pl-4">
              <li>Picks the best <strong className="text-foreground">price-verified</strong> deals in your niche (no fake markdowns).</li>
              <li>Wraps every product in <strong className="text-foreground">your affiliate link</strong>.</li>
              <li>Publishes a full post to your site with the affiliate disclosure + SEO built in.</li>
              <li>It only posts to your <strong className="text-foreground">blog</strong> — nothing goes to your socials.</li>
            </ul>
            <p className="text-[11px] text-muted-foreground mt-2">Toggle off anytime; nothing already published is removed.</p>
          </div>
        </>
      )}
    </div>
  )
}

// Consistent on/off filter pill for the filter bar. Ghost when inactive, filled
// with its accent when active — so the toggles read as one family.
function FilterToggle({ active, onClick, icon, activeClass, title, children }: {
  active: boolean; onClick: () => void; icon: ReactNode; activeClass: string; title?: string; children: ReactNode
}) {
  return (
    <button onClick={onClick} title={title}
      className={`h-9 text-sm rounded-lg border px-3 inline-flex items-center gap-1.5 transition ${active ? activeClass : 'bg-background hover:bg-accent'}`}>
      {icon} {children}
    </button>
  )
}

export default function DealRadarPage() {
  // ── Tier (honors admin View-as), mirrors the Deals Hub page ───────────────
  const [tier, setTier] = useState<Tier | null>(null)
  useEffect(() => {
    let cancelled = false
    let realTier: string = 'trial'
    const apply = () => { if (!cancelled) setTier(effectiveTier(realTier)) }
    ;(async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { realTier = 'trial'; apply(); return }
        const { data } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        realTier = (data as { tier?: string } | null)?.tier ?? 'trial'
        apply()
      } catch { realTier = 'trial'; apply() }
    })()
    window.addEventListener(VIEW_AS_EVENT, apply)
    return () => { cancelled = true; window.removeEventListener(VIEW_AS_EVENT, apply) }
  }, [])

  // ── Filters ───────────────────────────────────────────────────────────────
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<number | ''>('')
  const [minDiscount, setMinDiscount] = useState<number>(0)
  const [minRating, setMinRating] = useState<number>(0)
  const [hasCampaign, setHasCampaign] = useState(false)
  const [realOnly, setRealOnly] = useState(false)
  const [lightningOnly, setLightningOnly] = useState(false)
  const [sort, setSort] = useState('opportunity')

  const [deals, setDeals] = useState<Deal[]>([])
  const [ticker, setTicker] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [quickPostDeal, setQuickPostDeal] = useState<Deal | null>(null)
  const [showHelp, setShowHelp] = useState(true)

  const isPro = tier === 'pro' || tier === 'admin'
  const labsOk = dealRadarEnabled() || tier === 'admin'
  const canView = isPro && labsOk

  const PAGE_SIZE = 48 // matches the API

  const load = useCallback(async (pageToLoad = 0, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (category !== '') params.set('category', String(category))
      if (minDiscount > 0) params.set('minDiscount', String(minDiscount))
      if (minRating > 0) params.set('minRating', String(minRating))
      if (hasCampaign) params.set('hasCampaign', '1')
      if (realOnly) params.set('real', '1')
      if (lightningOnly) params.set('lightning', '1')
      params.set('sort', sort)
      params.set('page', String(pageToLoad))
      const res = await fetch(`/api/deal-radar?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not load deals.'); if (!append) { setDeals([]); setTicker([]) }; return }
      const incoming: Deal[] = Array.isArray(data.deals) ? data.deals : []
      setDeals((prev) => append ? [...prev, ...incoming] : incoming)
      setHasMore(incoming.length === PAGE_SIZE)
      setPage(pageToLoad)
      if (!append) setTicker(Array.isArray(data.ticker) ? data.ticker : [])
    } catch {
      setError('Could not load deals.')
    } finally {
      if (append) setLoadingMore(false); else setLoading(false)
    }
  }, [q, category, minDiscount, minRating, hasCampaign, realOnly, lightningOnly, sort])

  // Debounced fetch on filter change (only once we know the user can view).
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!canView) return
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { void load() }, 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [canView, load])

  // "How it works" panel stays until the user dismisses it (remembered).
  useEffect(() => {
    try { if (localStorage.getItem('deal_radar_help') === 'off') setShowHelp(false) } catch { /* no-op */ }
  }, [])
  const dismissHelp = () => { setShowHelp(false); try { localStorage.setItem('deal_radar_help', 'off') } catch { /* no-op */ } }

  // ── Gating ─────────────────────────────────────────────────────────────────
  if (tier === null) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  }
  if (!isPro) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <FeatureLockedCard
          icon={<Radar size={28} />}
          feature="Amazon Deal Radar"
          description="An always-on feed of live Amazon deals in your niche, cross-checked against Creator Connections, Levanta, and PartnerBoost bounties — one click turns any deal into a blog post you can push to social."
          bullets={[
            'Live price-drop feed, searchable and filterable by category, discount, and rating',
            'A "double-win" ticker: on sale AND paying an elevated commission',
            'Every link carries your own Amazon Associates tag',
          ]}
          requiredTier="pro"
          currentTier={tier}
        />
      </div>
    )
  }
  if (!labsOk) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 mb-4">
          <Radar size={28} />
        </div>
        <h1 className="text-2xl font-bold mb-2">Amazon Deal Radar is in Labs</h1>
        <p className="text-muted-foreground">We&apos;re testing it with a small group first. It&apos;ll open to all Pro accounts soon.</p>
      </div>
    )
  }

  const hasFilters = q.trim() || category !== '' || minDiscount > 0 || minRating > 0 || hasCampaign || realOnly || lightningOnly
  const clearFilters = () => { setQ(''); setCategory(''); setMinDiscount(0); setMinRating(0); setHasCampaign(false); setRealOnly(false); setLightningOnly(false); setSort('opportunity') }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><Radar size={20} /></div>
            <h1 className="text-2xl font-bold">Amazon Deal Radar</h1>
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">Labs</span>
            {!showHelp && (
              <button onClick={() => setShowHelp(true)} className="text-xs text-muted-foreground underline inline-flex items-center gap-1">
                <HelpCircle size={13} /> How it works
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">Live Amazon deals in your niche. Turn any one into a blog post, then push it to social.</p>
        </div>
        <div className="flex items-center gap-2">
          <DigestToggle />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* How it works */}
      {showHelp && <HowItWorks onDismiss={dismissHelp} />}

      {/* Double-win ticker */}
      {ticker.length > 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-2">
            <TrendingUp size={14} /> Double wins — on sale AND paying a bounty
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {ticker.map((d) => (
              <TickerCard key={d.asin} deal={d} onQuickPost={setQuickPostDeal} />
            ))}
          </div>
        </div>
      )}

      {/* Filter bar — search on its own row, then one tidy row of filters with
          sort pinned right. Consistent h-9 controls; a divider separates the
          dropdown filters from the on/off toggles. */}
      <div className="rounded-xl border bg-card p-3 space-y-2.5">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search deals (e.g. air fryer, dog bed)…"
            className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border bg-background"
          />
        </div>

        {/* Filters + sort */}
        <div className="flex flex-wrap items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value === '' ? '' : Number(e.target.value))}
                  className="h-9 text-sm rounded-lg border bg-background px-2.5">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select value={minDiscount} onChange={(e) => setMinDiscount(Number(e.target.value))}
                  className="h-9 text-sm rounded-lg border bg-background px-2.5">
            <option value={0}>Any discount</option>
            <option value={15}>15%+ off</option>
            <option value={25}>25%+ off</option>
            <option value={40}>40%+ off</option>
            <option value={50}>50%+ off</option>
          </select>
          <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}
                  className="h-9 text-sm rounded-lg border bg-background px-2.5">
            <option value={0}>Any rating</option>
            <option value={3}>3★+</option>
            <option value={4}>4★+</option>
            <option value={4.5}>4.5★+</option>
          </select>

          <span className="hidden sm:block w-px h-6 bg-border mx-0.5" aria-hidden />

          <FilterToggle active={realOnly} onClick={() => setRealOnly((v) => !v)} icon={<ShieldCheck size={14} />}
            activeClass="bg-blue-600 text-white border-blue-600"
            title="Only deals whose price history confirms a genuine discount">Real deals</FilterToggle>
          <FilterToggle active={hasCampaign} onClick={() => setHasCampaign((v) => !v)} icon={<Sparkles size={14} />}
            activeClass="bg-emerald-600 text-white border-emerald-600"
            title="Only deals whose ASIN matches a campaign in your uploaded Creator Connections catalog (pays an elevated commission)">Creator Connections</FilterToggle>
          <FilterToggle active={lightningOnly} onClick={() => setLightningOnly((v) => !v)} icon={<Zap size={14} />}
            activeClass="bg-amber-500 text-white border-amber-500"
            title="Only Amazon Lightning Deals — time-limited flash sales">Lightning</FilterToggle>

          <div className="ml-auto flex items-center gap-2">
            {hasFilters && <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground">Clear all</button>}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value)}
                      className="h-9 text-sm rounded-lg border bg-background px-2.5 text-foreground">
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="text-center py-16 text-sm text-muted-foreground">{error}</div>
      ) : deals.length === 0 ? (
        <EmptyState hasFilters={!!hasFilters} isAdmin={tier === 'admin'} onClear={clearFilters} onRefresh={() => void load()} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {deals.map((d) => <DealCard key={d.asin} deal={d} onQuickPost={setQuickPostDeal} />)}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-6">
              <button
                onClick={() => void load(page + 1, true)}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 text-sm font-medium rounded-full border px-5 py-2.5 hover:bg-accent disabled:opacity-60"
              >
                {loadingMore ? <><Loader2 size={15} className="animate-spin" /> Loading…</> : 'Load more deals'}
              </button>
            </div>
          )}
        </>
      )}

      {quickPostDeal && <QuickPostModal deal={quickPostDeal} onClose={() => setQuickPostDeal(null)} />}
    </div>
  )
}

// Generate the deal blog post DIRECTLY through the generation engine
// (POST /api/deals). Deal Radar is always-on and independent of the seasonal
// Deals Hub page — the pause there is a UI gate only, the engine isn't paused.
// occasion:'auto' → a "low price alert" article year-round when no event.
// Shared by the main DealCard and the double-win TickerCard so both get the
// same "Writing… → View post" flow.
function useMakePost(d: Deal) {
  const [gen, setGen] = useState<'idle' | 'working' | 'done'>('idle')
  const [postUrl, setPostUrl] = useState<string | null>(null)
  const makePost = async () => {
    if (gen === 'working') return
    setGen('working')
    try {
      const res = await fetch('/api/deals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: d.asin, occasion: 'auto' }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not create the post.'); setGen('idle'); return }
      setPostUrl(data.url || null); setGen('done')
      toast.success('Deal post published.')
      // Auto-watch the product so we can alert if it hits a new low or the price
      // drifts away from what this post claims (Price Alerts on the dashboard).
      void fetch('/api/price-watch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: d.asin, deal: true, title: d.title, imageUrl: d.imageUrl,
          priceCents: d.priceNow != null ? Math.round(d.priceNow * 100) : undefined,
        }),
      }).catch(() => {})
    } catch { toast.error('Could not create the post.'); setGen('idle') }
  }
  return { gen, postUrl, makePost }
}

function DealCard({ deal: d, onQuickPost }: { deal: Deal; onQuickPost: (d: Deal) => void }) {
  const { gen, postUrl, makePost } = useMakePost(d)
  return (
    <div className="rounded-xl border bg-card overflow-hidden flex flex-col">
      <a href={d.amazonUrl} target="_blank" rel="noopener noreferrer" className="relative flex items-center justify-center bg-white h-44 p-3">
        {d.imageUrl
          ? <img src={d.imageUrl} alt="" className="max-h-full max-w-full object-contain" />
          : <div className="flex items-center justify-center text-muted-foreground"><BadgePercent size={28} /></div>}
        {d.discountPct != null && (
          <span className="absolute top-2 left-2 text-xs font-bold bg-red-600 text-white rounded px-1.5 py-0.5">-{d.discountPct}%</span>
        )}
        {d.dealType === 'lightning' && (
          <span className="absolute top-2 right-2 text-[10px] font-bold bg-amber-500 text-white rounded px-1.5 py-0.5 inline-flex items-center gap-0.5"><Zap size={10} /> Lightning</span>
        )}
        {d.postedUrl && (
          <span className="absolute bottom-2 left-2 text-[10px] font-bold bg-emerald-600 text-white rounded px-1.5 py-0.5 inline-flex items-center gap-0.5"><Check size={10} /> Posted</span>
        )}
        {d.opportunityScore != null && d.opportunityScore >= 55 && (
          <span className="absolute bottom-2 right-2 text-[10px] font-bold bg-violet-600 text-white rounded px-1.5 py-0.5 inline-flex items-center gap-0.5" title="High opportunity: strong discount, real deal, in demand"><Flame size={10} /> Top pick</span>
        )}
      </a>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="text-sm font-medium line-clamp-2 leading-snug min-h-[2.5rem]">{d.title}</div>
        {d.brand && <div className="text-xs text-muted-foreground">{d.brand}</div>}
        <div className="flex items-center gap-2">
          {money(d.priceNow) && <span className="text-base font-bold">{money(d.priceNow)}</span>}
          {money(d.priceWas) && d.priceWas! > (d.priceNow ?? 0) && (
            <span className="text-xs text-muted-foreground line-through">{money(d.priceWas)}</span>
          )}
        </div>
        {d.rating != null && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Star size={12} className="fill-amber-400 text-amber-400" /> {d.rating.toFixed(1)}
            {d.reviewCount != null && <span>({d.reviewCount.toLocaleString()})</span>}
          </div>
        )}
        {d.monthlySold != null && (
          <div className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 w-fit">
            <TrendingUp size={12} /> {d.monthlySold.toLocaleString()}+ bought/mo
          </div>
        )}
        {d.estCommissionCents != null && d.estCommissionCents > 0 && (
          <div className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 w-fit"
               title={d.commissionIsBounty ? 'Creator Connections bounty rate' : 'Estimated Amazon commission (category rate)'}>
            <Coins size={12} /> ≈ {money((d.estCommissionCents) / 100)}/sale
            <span className="font-normal text-muted-foreground">· {d.commissionIsBounty ? `${d.commissionRatePct}% bounty` : `${d.commissionRatePct}% est`}</span>
          </div>
        )}
        {d.verdict && <VerdictBadge verdict={d.verdict} />}
        {d.campaign && (
          <a href={d.campaign.detailsUrl || '#'} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">
            <Sparkles size={12} /> +{d.campaign.commissionPct}% Creator Connections
          </a>
        )}
        <div className="mt-auto pt-2 space-y-1.5">
          {d.postedUrl && gen !== 'done' && (
            <a href={d.postedUrl} target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline">
              <Check size={12} /> You&apos;ve posted this — view it
            </a>
          )}
          <div className="flex items-center gap-2">
            {gen === 'done' && postUrl ? (
              <a href={postUrl} target="_blank" rel="noopener noreferrer"
                 className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold rounded-full bg-emerald-600 text-white py-2">
                <Check size={14} /> View post
              </a>
            ) : (
              <button onClick={makePost} disabled={gen === 'working'}
                className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold rounded-full bg-violet-600 hover:bg-violet-700 text-white py-2 disabled:opacity-60 transition">
                {gen === 'working'
                  ? <><Loader2 size={14} className="mr-1 animate-spin" /> Writing…</>
                  : d.postedUrl
                    ? <>Post again <ArrowRight size={14} className="ml-1" /></>
                    : <>Make blog post <ArrowRight size={14} className="ml-1" /></>}
              </button>
            )}
            <a href={d.amazonUrl} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center justify-center h-8 w-8 rounded-full border hover:bg-accent" title="View on Amazon">
              <ExternalLink size={14} />
            </a>
          </div>
          <button
            onClick={() => onQuickPost(d)}
            className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-full bg-orange-500 hover:bg-orange-600 text-white py-2 transition"
          >
            <Send size={13} /> Quick post to socials
          </button>
        </div>
      </div>
    </div>
  )
}

// Compact card for the "double wins" ticker. Same two actions as DealCard —
// make a blog post (inline) or quick-post to socials (opens the modal) — plus a
// direct Amazon link, in a small horizontal-scroll footprint.
function TickerCard({ deal: d, onQuickPost }: { deal: Deal; onQuickPost: (d: Deal) => void }) {
  const { gen, postUrl, makePost } = useMakePost(d)
  return (
    <div className="shrink-0 w-48 rounded-lg bg-card text-[color:var(--text)] border border-emerald-500/20 p-2 flex flex-col">
      <a href={d.amazonUrl} target="_blank" rel="noopener noreferrer" className="block">
        {d.imageUrl && <img src={d.imageUrl} alt="" className="h-20 w-full object-contain mb-1.5 rounded bg-white" />}
        <div className="text-xs font-medium line-clamp-2 leading-snug min-h-[2rem]">{d.title}</div>
      </a>
      <div className="flex items-center gap-1.5 mt-1 mb-2">
        {d.discountPct != null && <span className="text-[10px] font-bold text-red-500">-{d.discountPct}%</span>}
        {d.campaign && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">+{d.campaign.commissionPct}% CC</span>}
        {d.postedUrl && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5"><Check size={9} /> Posted</span>}
      </div>
      <div className="mt-auto flex items-center gap-1.5">
        {gen === 'done' && postUrl ? (
          <a href={postUrl} target="_blank" rel="noopener noreferrer"
             className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-full bg-emerald-600 text-white py-1.5">
            <Check size={12} /> View post
          </a>
        ) : (
          <button onClick={makePost} disabled={gen === 'working'}
             className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-full bg-violet-600 hover:bg-violet-700 text-white py-1.5 disabled:opacity-60 transition">
            {gen === 'working' ? <><Loader2 size={11} className="animate-spin" /> Writing…</> : <>Blog</>}
          </button>
        )}
        <button onClick={() => onQuickPost(d)} title="Quick post to socials"
           className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-full bg-orange-500 hover:bg-orange-600 text-white py-1.5 transition">
          <Send size={12} /> Social
        </button>
      </div>
    </div>
  )
}

// Price-history verdict badge. Genuine discounts read confident (green/blue);
// a "weak" verdict shows a muted caution so a creator can skip a fake discount.
function VerdictBadge({ verdict: v }: { verdict: DealVerdict }) {
  if (v.quality === 'excellent') {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5 w-fit">
      <ShieldCheck size={12} /> {v.label || 'All-time low'}
    </span>
  }
  if (v.quality === 'genuine') {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 w-fit">
      <ShieldCheck size={12} /> {v.label || 'Real discount'}
    </span>
  }
  if (v.quality === 'fair') {
    return <span className="inline-flex items-center gap-1 text-xs text-slate-600 w-fit">
      <ShieldCheck size={12} /> {v.label || 'Below usual'}
    </span>
  }
  // weak — the "discount" isn't really below the usual price.
  return <span className="inline-flex items-center gap-1 text-xs text-amber-600 w-fit" title="The list-price discount isn't below this item's typical selling price.">
    <ShieldAlert size={12} /> {v.label || 'Around usual price'}
  </span>
}

// Always-available explainer so the page teaches even before deals load, and
// stays a handy reference once they do. Dismissible (remembered per browser).
function HowItWorks({ onDismiss }: { onDismiss: () => void }) {
  const steps = [
    { icon: <Search size={16} />, title: 'Browse live deals', body: 'Filter by niche, discount, and rating — or search for anything.' },
    { icon: <ShieldCheck size={16} />, title: 'Trust the badge', body: 'We check each deal’s price history. Green = a genuine low. Amber = a fake discount to skip.' },
    { icon: <TrendingUp size={16} />, title: 'Catch double wins', body: 'The green strip up top = on sale AND paying you an elevated commission.' },
    { icon: <Send size={16} />, title: 'Publish in one move', body: 'Make a blog post for SEO, or Quick post straight to your socials. Your affiliate link is attached for you.' },
  ]
  return (
    <div className="relative rounded-xl border bg-card p-4">
      <button onClick={onDismiss} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground" title="Hide guide"><CloseIcon size={16} /></button>
      <div className="text-sm font-semibold mb-3">How Deal Radar works</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((s, i) => (
          <div key={i} className="flex gap-2.5">
            <div className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted">{s.icon}</div>
            <div>
              <div className="text-xs font-semibold">{i + 1}. {s.title}</div>
              <div className="text-xs text-muted-foreground leading-snug mt-0.5">{s.body}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">Badges:</span>
        <span className="inline-flex items-center gap-1"><ShieldCheck size={12} className="text-emerald-700" /> All-time low / real discount</span>
        <span className="inline-flex items-center gap-1"><ShieldAlert size={12} className="text-amber-600" /> Around usual price — likely fake</span>
        <span className="inline-flex items-center gap-1"><Sparkles size={12} className="text-emerald-700" /> Pays a Creator Connections bounty</span>
      </div>
    </div>
  )
}

// Rich empty state — teaches instead of just saying "nothing here".
function EmptyState({ hasFilters, isAdmin, onClear, onRefresh }: { hasFilters: boolean; isAdmin: boolean; onClear: () => void; onRefresh: () => void }) {
  if (hasFilters) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-muted-foreground mb-3">No deals match those filters yet. Try widening them.</p>
        <Button variant="outline" size="sm" onClick={onClear}>Clear filters</Button>
      </div>
    )
  }
  return (
    <div className="py-12">
      <div className="max-w-md mx-auto text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 mb-4"><Radar size={28} /></div>
        <h2 className="text-lg font-semibold mb-2">Your radar is warming up</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Live Amazon deals in your niche will land here, refreshed every few hours. Once they do, you&apos;ll see which discounts are genuinely the lowest price, which ones pay you a bounty, and you can turn any deal into a blog post or a social post in one click.
        </p>
        {isAdmin && (
          <p className="text-xs text-muted-foreground mb-4">Admin: deals populate once the Amazon data feed is connected and the refresh has run.</p>
        )}
        <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-4 w-4 mr-1.5" /> Check now</Button>
      </div>

      {/* Non-interactive preview so the page shows what real deals look like. */}
      <div className="mt-10">
        <div className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Example — this is what your deals will look like
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-3xl mx-auto pointer-events-none select-none opacity-90">
          {SAMPLE_DEALS.map((s, i) => <SampleCard key={i} s={s} />)}
        </div>
      </div>
    </div>
  )
}

// Static sample deals for the empty-state preview. Clearly labeled "Example"
// and rendered inside a pointer-events-none wrapper, so nothing here is
// clickable or postable — it exists purely to show the card layout + badges.
interface SampleDeal {
  title: string; brand: string; priceNow: string; priceWas: string; discountPct: number
  rating: string; reviews: string; verdict: DealVerdict; commissionPct?: number
}
const SAMPLE_DEALS: SampleDeal[] = [
  {
    title: 'Ninja AF101 Air Fryer, 4 Qt', brand: 'Ninja', priceNow: '59.99', priceWas: '89.99',
    discountPct: 33, rating: '4.7', reviews: '112,430',
    verdict: { quality: 'excellent', label: 'All-time low', typical: 84.99, allTimeLow: 59.99 },
    commissionPct: 8,
  },
  {
    title: 'Orthopedic Dog Bed, Large, Washable', brand: 'Bedsure', priceNow: '34.99', priceWas: '49.99',
    discountPct: 30, rating: '4.6', reviews: '48,207',
    verdict: { quality: 'genuine', label: '30% below its usual price', typical: 49.99, allTimeLow: 32.99 },
  },
]

function SampleCard({ s }: { s: SampleDeal }) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden flex flex-col">
      <div className="relative bg-white aspect-square p-3 flex items-center justify-center">
        <BadgePercent size={40} className="text-muted-foreground/40" />
        <span className="absolute top-2 left-2 text-xs font-bold bg-red-600 text-white rounded px-1.5 py-0.5">-{s.discountPct}%</span>
        <span className="absolute top-2 right-2 text-[10px] font-bold bg-slate-900/70 text-white rounded px-1.5 py-0.5">Example</span>
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="text-sm font-medium line-clamp-2 leading-snug min-h-[2.5rem]">{s.title}</div>
        <div className="text-xs text-muted-foreground">{s.brand}</div>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold">${s.priceNow}</span>
          <span className="text-xs text-muted-foreground line-through">${s.priceWas}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Star size={12} className="fill-amber-400 text-amber-400" /> {s.rating} <span>({s.reviews})</span>
        </div>
        <VerdictBadge verdict={s.verdict} />
        {s.commissionPct != null && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 w-fit">
            <Sparkles size={12} /> +{s.commissionPct}% Creator Connections
          </span>
        )}
        <div className="mt-auto pt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium rounded-md bg-primary/60 text-primary-foreground py-1.5">
              Make blog post <ArrowRight size={13} />
            </span>
            <span className="inline-flex items-center justify-center h-8 w-8 rounded-md border text-muted-foreground"><ExternalLink size={14} /></span>
          </div>
          <span className="w-full inline-flex items-center justify-center gap-1.5 text-xs rounded-md border py-1.5 text-muted-foreground">
            <Send size={13} /> Quick post to socials
          </span>
        </div>
      </div>
    </div>
  )
}
