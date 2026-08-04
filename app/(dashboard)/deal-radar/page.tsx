// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Deal Radar — open to all paid tiers (graduated out of Labs 2026-07-27).
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
  Send, Check, AlertCircle, X as CloseIcon, HelpCircle, Mail, Info, Coins, Flame, Plus, Layers, Video, ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import QuickPostModal from '@/components/deal/QuickPostModal'
import WalmartOffers from '@/components/walmart/WalmartOffers'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { createBrowserClient } from '@/lib/supabase/client'
import { type Tier } from '@/lib/tier'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'
import { canUseDealRadar, canBrowseDealRadar } from '@/lib/feature-access'

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
  /** Listing has a brand/merchant video in its image carousel. */
  hasVideo: boolean
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
  // Added 2026-07-27 — kept in sync with the cron's DEFAULT_CATEGORIES.
  { id: 2619525011, label: 'Appliances' },
  { id: 2617941011, label: 'Arts, Crafts & Sewing' },
  { id: 16310161, label: 'Industrial & Scientific' },
  { id: 9479199011, label: 'Luggage & Travel Gear' },
  { id: 283155, label: 'Books' },
  { id: 2625373011, label: 'Movies & TV' },
  { id: 3367581, label: 'Jewelry' },
  { id: 6358539011, label: 'Watches' },
]

const SORTS: { key: string; label: string }[] = [
  { key: 'opportunity', label: 'Best opportunity' },
  { key: 'discount', label: 'Biggest discount' },
  { key: 'commission', label: 'Highest commission' },
  { key: 'ending', label: 'Ending soon' },
  { key: 'bestseller', label: 'Best sellers' },
]

const money = (n: number | null) => (n == null ? null : `$${n.toFixed(2)}`)

interface SavedSearch {
  name: string
  f: { q: string; category: number | ''; minDiscount: number; minRating: number; hasCampaign: boolean; realOnly: boolean; lightningOnly: boolean; videoOnly?: boolean; sort: string }
}
const SAVED_KEY = 'deal_radar_saved_searches'

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
      const res = await fetch('/api/deal-radar/digest-pref', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setEnabled(!next); toast.error(data.error || 'Could not update.'); return }
      // Trust the server's persisted value so the button reflects reality.
      setEnabled(data.enabled === true)
      toast.success(data.enabled ? 'Weekly digest on — a "top deals in your niche" roundup will auto-post to your blog each week.' : 'Weekly digest off.')
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

// Live "Ends in …" countdown for Lightning deals. Ticks each minute; shows a
// muted "Deal ended" once it lapses.
function Countdown({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t) }, [])
  const ms = new Date(endsAt).getTime() - now
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground"><Zap size={11} /> Deal ended</span>
  const totalMin = Math.floor(ms / 60_000)
  const days = Math.floor(totalMin / 1440)
  const hrs = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  const label = days >= 1 ? `${days}d ${hrs}h` : hrs >= 1 ? `${hrs}h ${mins}m` : `${mins}m`
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400"><Zap size={11} /> Ends in {label}</span>
}

// Color tones for the filter pills — each toggle keeps a consistent accent so
// the bar reads as one family. Inactive pills already tint their icon (so the
// color is a hint, not a surprise) and warm toward the accent on hover; active
// pills fill solid with a soft matching glow so on/off is unmistakable.
const TOGGLE_TONES: Record<string, { active: string; icon: string; hover: string }> = {
  blue:    { active: 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/30',       icon: 'text-blue-500',    hover: 'hover:border-blue-400/60 hover:bg-blue-50 dark:hover:bg-blue-500/10' },
  emerald: { active: 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-600/30', icon: 'text-emerald-500', hover: 'hover:border-emerald-400/60 hover:bg-emerald-50 dark:hover:bg-emerald-500/10' },
  amber:   { active: 'bg-amber-500 text-white border-amber-500 shadow-sm shadow-amber-500/30',     icon: 'text-amber-500',   hover: 'hover:border-amber-400/60 hover:bg-amber-50 dark:hover:bg-amber-500/10' },
  fuchsia: { active: 'bg-fuchsia-600 text-white border-fuchsia-600 shadow-sm shadow-fuchsia-600/30', icon: 'text-fuchsia-500', hover: 'hover:border-fuchsia-400/60 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-500/10' },
}
function FilterToggle({ active, onClick, icon, tone, title, children }: {
  active: boolean; onClick: () => void; icon: ReactNode; tone: keyof typeof TOGGLE_TONES; title?: string; children: ReactNode
}) {
  const t = TOGGLE_TONES[tone]
  return (
    <button onClick={onClick} title={title} aria-pressed={active}
      className={`h-9 text-sm font-medium rounded-full border px-3.5 inline-flex items-center gap-1.5 transition-all active:scale-[0.97] ${active ? t.active : `bg-background border-border ${t.hover}`}`}>
      <span className={`inline-flex ${active ? '' : t.icon}`}>{icon}</span> {children}
    </button>
  )
}

// A native <select> dressed as a rounded pill with a consistent custom chevron,
// so the dropdowns match the toggle pills in both light and dark themes (the
// browser's default select arrow renders differently per-OS/theme).
function SelectPill({ value, onChange, children }: {
  value: string | number; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; children: ReactNode
}) {
  return (
    <div className="relative">
      <select value={value} onChange={onChange}
        className="h-9 text-sm font-medium rounded-full border bg-background pl-3.5 pr-8 outline-none cursor-pointer appearance-none hover:bg-accent focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 transition">
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </div>
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
  const [videoOnly, setVideoOnly] = useState(false)
  const [sort, setSort] = useState('opportunity')

  // Which marketplace's deals to show. Amazon = the cached Keepa feed (all the
  // filters below). Walmart = live time-boxed PartnerBoost commission boosts
  // (per-user, so a separate live source — no shared cache).
  const [source, setSource] = useState<'amazon' | 'walmart'>('amazon')

  const [deals, setDeals] = useState<Deal[]>([])
  const [ticker, setTicker] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [quickPostDeal, setQuickPostDeal] = useState<Deal | null>(null)
  const [showHelp, setShowHelp] = useState(true)
  // Full walkthrough modal — opens automatically the first time, reopenable from the header.
  const [showGuide, setShowGuide] = useState(false)
  // On-demand roundup: multi-select deals → one curated post.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [roundupBusy, setRoundupBusy] = useState(false)
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
  const toggleSelect = (asin: string) => setSelected((s) => { const n = new Set(s); n.has(asin) ? n.delete(asin) : n.add(asin); return n })
  const createRoundup = async () => {
    if (selected.size < 2 || roundupBusy) return
    setRoundupBusy(true)
    try {
      const res = await fetch('/api/deal-radar/roundup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asins: [...selected] }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not build the roundup.'); return }
      toast.success(`Roundup post published — ${data.count} deals.`)
      setSelected(new Set())
      if (data.url) window.open(data.url, '_blank')
    } catch { toast.error('Could not build the roundup.') } finally { setRoundupBusy(false) }
  }

  // Open to all paid tiers (creator/studio/pro/admin) — graduated out of Labs.
  const isPaid = canUseDealRadar(tier)
  const canView = canBrowseDealRadar(tier)

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
      if (videoOnly) params.set('video', '1')
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
  }, [q, category, minDiscount, minRating, hasCampaign, realOnly, lightningOnly, videoOnly, sort])

  // Debounced fetch on filter change (only once we know the user can view).
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!canView) return
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { void load() }, 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [canView, load])

  // "How it works" panel stays until the user dismisses it (remembered). The
  // full guide modal auto-opens once, the first time this browser opens Deal Radar.
  useEffect(() => {
    try { if (localStorage.getItem('deal_radar_help') === 'off') setShowHelp(false) } catch { /* no-op */ }
    try { if (!localStorage.getItem('deal_radar_guide_seen')) setShowGuide(true) } catch { /* no-op */ }
    try { const raw = localStorage.getItem(SAVED_KEY); if (raw) setSavedSearches(JSON.parse(raw)) } catch { /* no-op */ }
  }, [])
  const dismissHelp = () => { setShowHelp(false); try { localStorage.setItem('deal_radar_help', 'off') } catch { /* no-op */ } }
  const closeGuide = () => { setShowGuide(false); try { localStorage.setItem('deal_radar_guide_seen', '1') } catch { /* no-op */ } }

  // ── Gating ─────────────────────────────────────────────────────────────────
  if (tier === null) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  }
  // Note: BROWSING is open to every plan (incl. free) — the feed is the
  // discovery magnet. Posting a deal is paid, so when !isPaid we still render
  // the full feed but swap every action for an upgrade prompt (see `locked`).

  const hasFilters = q.trim() || category !== '' || minDiscount > 0 || minRating > 0 || hasCampaign || realOnly || lightningOnly || videoOnly
  const clearFilters = () => { setQ(''); setCategory(''); setMinDiscount(0); setMinRating(0); setHasCampaign(false); setRealOnly(false); setLightningOnly(false); setVideoOnly(false); setSort('opportunity') }

  const saveCurrentSearch = () => {
    const name = (window.prompt('Name this search (e.g. "Home · 30%+ real deals")') || '').trim()
    if (!name) return
    const entry: SavedSearch = { name, f: { q, category, minDiscount, minRating, hasCampaign, realOnly, lightningOnly, videoOnly, sort } }
    const next = [...savedSearches.filter((s) => s.name !== name), entry].slice(-12)
    setSavedSearches(next)
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)) } catch { /* no-op */ }
  }
  const applySavedSearch = (s: SavedSearch) => {
    setQ(s.f.q); setCategory(s.f.category); setMinDiscount(s.f.minDiscount); setMinRating(s.f.minRating)
    setHasCampaign(s.f.hasCampaign); setRealOnly(s.f.realOnly); setLightningOnly(s.f.lightningOnly); setVideoOnly(!!s.f.videoOnly); setSort(s.f.sort)
  }
  const deleteSavedSearch = (name: string) => {
    const next = savedSearches.filter((s) => s.name !== name)
    setSavedSearches(next)
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)) } catch { /* no-op */ }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><Radar size={20} /></div>
            <h1 className="text-2xl font-bold">Deal Radar</h1>
            <button onClick={() => setShowGuide(true)} className="text-xs font-medium text-orange-600 dark:text-orange-400 underline inline-flex items-center gap-1">
              <HelpCircle size={13} /> Full guide
            </button>
            {!showHelp && (
              <button onClick={() => setShowHelp(true)} className="text-xs text-muted-foreground underline inline-flex items-center gap-1">
                <HelpCircle size={13} /> How it works
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {source === 'amazon'
              ? 'Live Amazon deals in your niche. Turn any one into a blog post, then push it to social.'
              : 'Live Walmart price drops from your PartnerBoost account, run through MVP’s rules. Turn any one into a post with a cloaked link.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isPaid && <DigestToggle />}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Marketplace source toggle — Amazon (cached Keepa feed) vs Walmart (live
          time-boxed PartnerBoost boosts). */}
      <div className="inline-flex rounded-full border p-0.5 bg-background">
        {([['amazon', 'Amazon'], ['walmart', 'Walmart']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setSource(key)}
            className={`px-4 h-8 text-sm font-semibold rounded-full transition-colors ${source === key ? (key === 'walmart' ? 'bg-[#0071CE] text-white' : 'bg-orange-500 text-white') : 'text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Free plan: browsing is open; posting is paid. */}
      {!isPaid && (
        <a href="/billing" className="flex items-center gap-2.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm transition hover:bg-violet-500/15">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-violet-600 text-white flex-shrink-0"><Sparkles size={14} /></span>
          <span className="text-foreground">
            <strong>You&apos;re on the free plan — browse every deal.</strong>{' '}
            <span className="text-muted-foreground">Upgrade to turn any deal into a blog post or social post in one click.</span>
          </span>
          <ArrowRight size={15} className="ml-auto flex-shrink-0 text-violet-600" />
        </a>
      )}

      {/* Full walkthrough — auto-opens the first time, reopenable via "Full guide". */}
      {showGuide && <DealRadarGuide onClose={closeGuide} />}

      {/* How it works */}
      {showHelp && <HowItWorks onDismiss={dismissHelp} />}

      {source === 'amazon' && (<>
      {/* Double-win ticker */}
      {ticker.length > 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-2">
            <TrendingUp size={14} /> Double wins — on sale AND paying a bounty
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {ticker.map((d) => (
              <TickerCard key={d.asin} deal={d} onQuickPost={setQuickPostDeal} locked={!isPaid} />
            ))}
          </div>
        </div>
      )}

      {/* Filter bar — a prominent search field, then one tidy row of filters
          with sort pinned right. Dropdowns are grouped as a soft-filled cluster;
          the on/off toggles are color-toned pills that read as one family. */}
      <div className="rounded-2xl border bg-card p-3.5 space-y-3 shadow-sm">
        {/* Search — the hero of the bar: taller, with a violet focus ring. */}
        <div className="group relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-muted-foreground transition-colors group-focus-within:text-violet-500" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search deals (e.g. air fryer, dog bed)…"
            className="w-full h-11 pl-11 pr-3.5 text-sm rounded-xl border bg-background outline-none transition-shadow focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
          />
        </div>

        {/* Filters + sort — every control is the same rounded-full pill so the
            row reads as one family: neutral pills for the dropdowns, color-toned
            pills for the on/off toggles, divided by a thin rule. */}
        <div className="flex flex-wrap items-center gap-2">
          <SelectPill value={category} onChange={(e) => setCategory(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </SelectPill>
          <SelectPill value={minDiscount} onChange={(e) => setMinDiscount(Number(e.target.value))}>
            <option value={0}>Any discount</option>
            <option value={15}>15%+ off</option>
            <option value={25}>25%+ off</option>
            <option value={40}>40%+ off</option>
            <option value={50}>50%+ off</option>
          </SelectPill>
          <SelectPill value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
            <option value={0}>Any rating</option>
            <option value={3}>3★+</option>
            <option value={4}>4★+</option>
            <option value={4.5}>4.5★+</option>
          </SelectPill>

          <span className="hidden sm:block w-px h-6 bg-border mx-0.5" aria-hidden />

          <FilterToggle active={realOnly} onClick={() => setRealOnly((v) => !v)} icon={<ShieldCheck size={14} />}
            tone="blue"
            title="Only deals whose price history confirms a genuine discount">Real deals</FilterToggle>
          <FilterToggle active={hasCampaign} onClick={() => setHasCampaign((v) => !v)} icon={<Sparkles size={14} />}
            tone="emerald"
            title="Only deals whose ASIN matches a campaign in your uploaded Creator Connections catalog (pays an elevated commission)">Creator Connections</FilterToggle>
          <FilterToggle active={lightningOnly} onClick={() => setLightningOnly((v) => !v)} icon={<Zap size={14} />}
            tone="amber"
            title="Only Amazon Lightning Deals — time-limited flash sales">Lightning</FilterToggle>
          <FilterToggle active={videoOnly} onClick={() => setVideoOnly((v) => !v)} icon={<Video size={14} />}
            tone="fuchsia"
            title="Only listings with a product-carousel video — better conversion, and ready-made b-roll for a Short or Reel">Has video</FilterToggle>

          <div className="ml-auto flex items-center gap-2">
            {hasFilters && (
              <button onClick={clearFilters}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground rounded-full px-2.5 h-8 hover:bg-accent transition-colors">
                <CloseIcon size={13} /> Clear
              </button>
            )}
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Sort
              <SelectPill value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </SelectPill>
            </label>
          </div>
        </div>
      </div>

      {/* Saved searches */}
      {(savedSearches.length > 0 || hasFilters) && (
        <div className="flex items-center gap-2 flex-wrap -mt-2">
          {savedSearches.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1 text-xs rounded-full border bg-background pl-3 pr-1.5 py-1">
              <button onClick={() => applySavedSearch(s)} className="hover:underline">{s.name}</button>
              <button onClick={() => deleteSavedSearch(s.name)} title="Delete" className="text-muted-foreground hover:text-foreground"><CloseIcon size={12} /></button>
            </span>
          ))}
          {hasFilters && (
            <button onClick={saveCurrentSearch} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded-full border border-dashed px-3 py-1">
              <Plus size={12} /> Save these filters
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="text-center py-16 text-sm text-muted-foreground">{error}</div>
      ) : deals.length === 0 ? (
        <EmptyState hasFilters={!!hasFilters} isAdmin={tier === 'admin'} onClear={clearFilters} onRefresh={() => void load()} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {deals.map((d) => <DealCard key={d.asin} deal={d} onQuickPost={setQuickPostDeal} selected={selected.has(d.asin)} onToggleSelect={isPaid ? toggleSelect : undefined} locked={!isPaid} />)}
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

      {/* Floating roundup bar — appears once a deal is selected. Paid only. */}
      {isPaid && selected.size >= 1 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full border bg-white dark:bg-[#16161a] shadow-2xl px-4 py-2.5">
          <span className="text-sm font-medium inline-flex items-center gap-1.5"><Layers size={15} /> {selected.size} selected</span>
          <button onClick={createRoundup} disabled={selected.size < 2 || roundupBusy}
            title={selected.size < 2 ? 'Pick at least 2 deals' : 'Publish a curated roundup post of these deals'}
            className="text-sm font-semibold rounded-full bg-violet-600 hover:bg-violet-700 text-white px-4 py-1.5 disabled:opacity-60 inline-flex items-center gap-1.5">
            {roundupBusy ? <><Loader2 size={14} className="animate-spin" /> Building…</> : 'Create roundup post'}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
        </div>
      )}
      </>)}

      {/* Walmart source — price drops (steep catalog markdowns) from PartnerBoost,
          run through MVP's rules. Self-fetch per-user; prompt to connect when
          there's no token. */}
      {source === 'walmart' && (
        <WalmartOffers
          embedded autoRun minDiscount={25} sort="discount"
          title="Walmart price drops"
          subtitle="Steep markdowns across the Walmart catalog, run through MVP’s rules. The discount is live now."
        />
      )}
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
    const submit = async (confirmDuplicate: boolean) => {
      const res = await fetch('/api/deals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: d.asin, occasion: 'auto', ...(confirmDuplicate ? { confirmDuplicate: true } : {}) }),
      })
      return { res, data: await res.json() }
    }
    try {
      let { res, data } = await submit(false)
      // Server says we already have a deal post for this ASIN — confirm before
      // publishing another one (and burning another monthly post).
      if (data?.duplicate) {
        const ok = window.confirm(`You've already posted this product${data.existingTitle ? ` ("${String(data.existingTitle).slice(0, 60)}")` : ''}. Publish another article about it anyway?`)
        if (!ok) { setGen('idle'); return }
        ;({ res, data } = await submit(true))
      }
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

function DealCard({ deal: d, onQuickPost, selected = false, onToggleSelect, locked = false }: { deal: Deal; onQuickPost: (d: Deal) => void; selected?: boolean; onToggleSelect?: (asin: string) => void; locked?: boolean }) {
  const { gen, postUrl, makePost } = useMakePost(d)
  return (
    <div className="rounded-xl border bg-card overflow-hidden flex flex-col transition-shadow hover:shadow-md">
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
        {d.dealType === 'lightning' && d.lightningEndsAt && <Countdown endsAt={d.lightningEndsAt} />}
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
        {d.hasVideo && (
          <div className="inline-flex items-center gap-1 text-xs font-medium text-fuchsia-600 dark:text-fuchsia-400 w-fit"
               title="This listing has a product-carousel video — great for a Short or Reel">
            <Video size={12} /> Has video
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
          {locked ? (
            /* Free plan: browse only. Posting a deal is a paid action. */
            <>
              <a href="/billing"
                className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-full bg-violet-600 hover:bg-violet-700 text-white py-2 transition">
                <Sparkles size={13} /> Upgrade to post this deal
              </a>
              <div className="flex items-center justify-end pt-0.5">
                <a href={d.amazonUrl} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground" title="View on Amazon">
                  View on Amazon <ExternalLink size={12} />
                </a>
              </div>
            </>
          ) : (
          <>
          {/* Primary actions — each full-width so labels never wrap. */}
          {gen === 'done' && postUrl ? (
            <a href={postUrl} target="_blank" rel="noopener noreferrer"
               className="w-full inline-flex items-center justify-center gap-1 text-xs font-semibold rounded-full bg-emerald-600 text-white py-2">
              <Check size={14} /> View post
            </a>
          ) : (
            <button onClick={makePost} disabled={gen === 'working'}
              className="w-full inline-flex items-center justify-center gap-1 text-xs font-semibold rounded-full bg-violet-600 hover:bg-violet-700 text-white py-2 disabled:opacity-60 transition">
              {gen === 'working'
                ? <><Loader2 size={14} className="mr-1 animate-spin" /> Writing…</>
                : d.postedUrl
                  ? <>Post again <ArrowRight size={14} className="ml-1" /></>
                  : <>Make blog post <ArrowRight size={14} className="ml-1" /></>}
            </button>
          )}
          <button
            onClick={() => onQuickPost(d)}
            className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-full bg-orange-500 hover:bg-orange-600 text-white py-2 transition"
          >
            <Send size={13} /> Quick post to socials
          </button>
          {/* Secondary row — quiet: roundup toggle on the left, Amazon on the right. */}
          <div className="flex items-center justify-between pt-0.5">
            {onToggleSelect ? (
              <button onClick={() => onToggleSelect(d.asin)} title={selected ? 'Remove from roundup' : 'Add to a roundup post'}
                className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-1 transition ${selected ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' : 'text-muted-foreground hover:bg-accent'}`}>
                {selected ? <><Check size={12} /> In roundup</> : <><Plus size={12} /> Add to roundup</>}
              </button>
            ) : <span />}
            <a href={d.amazonUrl} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground" title="View on Amazon">
              View on Amazon <ExternalLink size={12} />
            </a>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  )
}

// Compact card for the "double wins" ticker. Same two actions as DealCard —
// make a blog post (inline) or quick-post to socials (opens the modal) — plus a
// direct Amazon link, in a small horizontal-scroll footprint.
function TickerCard({ deal: d, onQuickPost, locked = false }: { deal: Deal; onQuickPost: (d: Deal) => void; locked?: boolean }) {
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
        {locked ? (
          <a href="/billing"
             className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-full bg-violet-600 hover:bg-violet-700 text-white py-1.5 transition">
            <Sparkles size={11} /> Upgrade to post
          </a>
        ) : (
          <>
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
          </>
        )}
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

// The complete walkthrough. Opens automatically the first time a browser visits
// Deal Radar (localStorage 'deal_radar_guide_seen'), and is reopenable anytime
// from the "Full guide" link in the header. Solid background (no see-through).
function DealRadarGuide({ onClose }: { onClose: () => void }) {
  const sections: { icon: ReactNode; title: string; body: ReactNode }[] = [
    {
      icon: <Radar size={18} />,
      title: 'What Deal Radar is',
      body: <>Deal Radar scans Amazon for real, live price drops in your niche and refreshes every few hours. Instead of hunting for something to promote, you open the page and the deals are already waiting — each one ready to become a blog post or a social post with your affiliate link built in.</>,
    },
    {
      icon: <BadgePercent size={18} />,
      title: 'Reading a deal card',
      body: <>Every card shows the current price, the discount, the star rating and review count, and — when we know it — how many people <strong>bought it this month</strong> (real demand) and your <strong>estimated commission per sale</strong>. The bigger the discount, the demand, and the payout, the better the opportunity.</>,
    },
    {
      icon: <ShieldCheck size={18} />,
      title: 'The trust badge (this is the important one)',
      body: <>A “40% off” sticker means nothing if the price was quietly raised first. We check each product’s real price history and score it for you:
        <span className="mt-2 flex flex-col gap-1.5">
          <span className="inline-flex items-start gap-1.5"><ShieldCheck size={14} className="text-emerald-600 mt-0.5 shrink-0" /> <span><strong>Green — all-time low / genuine discount.</strong> The deal is real. Promote with confidence.</span></span>
          <span className="inline-flex items-start gap-1.5"><ShieldAlert size={14} className="text-amber-600 mt-0.5 shrink-0" /> <span><strong>Amber — around its usual price.</strong> The “discount” is likely fake. Skip it, or wait.</span></span>
        </span>
        Turn on the <strong>Real deals</strong> filter to hide the fakes entirely.</>,
    },
    {
      icon: <Sparkles size={18} />,
      title: 'Double wins & Creator Connections',
      body: <>The green strip at the top of the page is the jackpot: products that are <strong>on sale AND paying you an elevated Creator Connections bounty</strong> at the same time. A <span className="inline-flex items-center gap-0.5 font-medium text-emerald-700 dark:text-emerald-400"><Sparkles size={12} /> +% Creator Connections</span> line on any card means Amazon is paying extra to promote it right now — that rate is exact, not an estimate.</>,
    },
    {
      icon: <Flame size={18} />,
      title: '“Best opportunity” & Top pick',
      body: <>The default sort is <strong>Best opportunity</strong> — a single score that blends discount depth, whether the deal is genuine, real monthly demand, review count, and any bounty. Cards scoring near the top get a <span className="inline-flex items-center gap-0.5 font-medium text-violet-600 dark:text-violet-400"><Flame size={12} /> Top pick</span> badge. Start there and you’re promoting the strongest deals first.</>,
    },
    {
      icon: <Zap size={18} />,
      title: 'Lightning deals',
      body: <>A <span className="inline-flex items-center gap-0.5 font-medium text-amber-600 dark:text-amber-400"><Zap size={12} /> Lightning</span> deal only runs for a few hours — the card shows a live “Ends in Xh Ym” countdown so you can post while it’s hot. The <strong>Lightning</strong> filter shows only deals whose window is still open; once one ends it drops out automatically.</>,
    },
    {
      icon: <Search size={18} />,
      title: 'Filters, sorting & saved searches',
      body: <>Narrow the feed by category, minimum discount, rating, <strong>Real deals</strong>, <strong>Creator Connections</strong>, <strong>Lightning</strong>, or <strong>Has video</strong> (listings with a product-carousel video — better conversion, and ready-made b-roll for a Short or Reel) — or just search (“air fryer”, “dog bed”). Sort by best opportunity, biggest discount, best sellers, highest commission, or ending soonest. Found a combination you like? Hit <strong>Save these filters</strong> and it becomes a one-tap chip next time.</>,
    },
    {
      icon: <ArrowRight size={18} />,
      title: 'Turn a deal into a blog post',
      body: <><strong>Make blog post</strong> writes a full, SEO-complete article for the product and publishes it to your WordPress — headline, FAQ, internal links, image alt text, and the required affiliate disclosure are all handled. Pricing is written in <strong>relative</strong> terms (“a great price right now”, “X% off”) rather than an exact dollar figure, so the post doesn’t go stale the moment the price shifts.</>,
    },
    {
      icon: <Send size={18} />,
      title: 'Quick post to socials',
      body: <><strong>Quick post to socials</strong> pushes the deal straight to Facebook, Instagram, Threads or X in one move, with a caption and your affiliate link (and if you use Geniuslink, a properly grouped short link) attached for you. Great for lightning deals where speed matters more than a full article.</>,
    },
    {
      icon: <Layers size={18} />,
      title: 'Roundups',
      body: <>Tap <strong>＋ Add to roundup</strong> on a few cards, then <strong>Create roundup post</strong> to bundle your hand-picked deals into one curated “best deals” article — perfect for a weekly “Top 5 in [niche]” post. Pick at least two.</>,
    },
    {
      icon: <TrendingUp size={18} />,
      title: 'Price Alerts & keeping posts fresh',
      body: <>On your dashboard, <strong>Price Alerts</strong> tells you when a product you’ve posted about hits a genuine new all-time low (a reason to re-share) or when its price drifted from what your post implies. One tap re-posts the drop, or <strong>Refresh price</strong> quietly updates the wording in your existing post to match reality — no rewrite needed.</>,
    },
    {
      icon: <Mail size={18} />,
      title: 'Weekly digest',
      body: <>Flip the <strong>Weekly digest</strong> toggle (top right) and MVP automatically publishes a &ldquo;Top deals in your niche&rdquo; roundup to your blog about once a week — price-verified picks, your affiliate links, hands-off. It posts to your blog only; nothing goes to your socials.</>,
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label="Deal Radar guide">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-2xl max-h-full sm:max-h-[85vh] flex flex-col rounded-none sm:rounded-2xl border bg-white dark:bg-[#16161a] shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><Radar size={20} /></div>
            <div>
              <div className="text-base font-bold leading-tight">Your guide to Amazon Deal Radar</div>
              <div className="text-xs text-muted-foreground">Everything it does, and how to turn a deal into content in one click.</div>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" title="Close"><CloseIcon size={18} /></button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {sections.map((s, i) => (
            <div key={i} className="flex gap-3">
              <div className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground/80">{s.icon}</div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{s.title}</div>
                <div className="text-[13px] text-muted-foreground leading-relaxed mt-0.5">{s.body}</div>
              </div>
            </div>
          ))}
          <div className="rounded-lg bg-muted/60 px-3.5 py-3 text-[12px] text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Affiliate links & disclosure are automatic.</strong> Whether you make a blog post or a quick social post, your Amazon tag (or Geniuslink) is attached and the FTC affiliate disclosure is added for you — you never have to paste a link or a disclaimer by hand.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t shrink-0">
          <span className="text-xs text-muted-foreground">You can reopen this anytime from <span className="font-medium text-foreground">Full guide</span> at the top.</span>
          <Button size="sm" onClick={onClose}>Got it — show me the deals</Button>
        </div>
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
