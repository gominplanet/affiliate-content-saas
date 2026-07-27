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

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Radar, Search, Loader2, Star, Zap, BadgePercent, ExternalLink,
  ArrowRight, Sparkles, TrendingUp, RefreshCw, ShieldCheck, ShieldAlert,
  Send, Check, AlertCircle, X as CloseIcon, HelpCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  { key: 'discount', label: 'Biggest discount' },
  { key: 'commission', label: 'Highest commission' },
  { key: 'ending', label: 'Ending soon' },
  { key: 'bestseller', label: 'Best sellers' },
]

// Link-friendly platforms for a direct "Quick post" (no IG/TikTok — captions
// there can't carry a clickable link; no Pinterest — pins link to the blog).
const QUICK_PLATFORMS: { key: string; label: string }[] = [
  { key: 'twitter', label: 'X' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'threads', label: 'Threads' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'bluesky', label: 'Bluesky' },
]

const money = (n: number | null) => (n == null ? null : `$${n.toFixed(2)}`)

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
  const [sort, setSort] = useState('discount')

  const [deals, setDeals] = useState<Deal[]>([])
  const [ticker, setTicker] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [quickPostDeal, setQuickPostDeal] = useState<Deal | null>(null)
  const [showHelp, setShowHelp] = useState(true)

  const isPro = tier === 'pro' || tier === 'admin'
  const labsOk = dealRadarEnabled() || tier === 'admin'
  const canView = isPro && labsOk

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (category !== '') params.set('category', String(category))
      if (minDiscount > 0) params.set('minDiscount', String(minDiscount))
      if (minRating > 0) params.set('minRating', String(minRating))
      if (hasCampaign) params.set('hasCampaign', '1')
      if (realOnly) params.set('real', '1')
      params.set('sort', sort)
      const res = await fetch(`/api/deal-radar?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not load deals.'); setDeals([]); setTicker([]); return }
      setDeals(Array.isArray(data.deals) ? data.deals : [])
      setTicker(Array.isArray(data.ticker) ? data.ticker : [])
    } catch {
      setError('Could not load deals.')
    } finally {
      setLoading(false)
    }
  }, [q, category, minDiscount, minRating, hasCampaign, realOnly, sort])

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

  const hasFilters = q.trim() || category !== '' || minDiscount > 0 || minRating > 0 || hasCampaign || realOnly
  const clearFilters = () => { setQ(''); setCategory(''); setMinDiscount(0); setMinRating(0); setHasCampaign(false); setRealOnly(false); setSort('discount') }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><Radar size={20} /></div>
            <h1 className="text-2xl font-bold">Amazon Deal Radar</h1>
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">Labs</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Live Amazon deals in your niche. Turn any one into a blog post, then push it to social.</p>
        </div>
        <div className="flex items-center gap-2">
          {!showHelp && (
            <button onClick={() => setShowHelp(true)} className="text-xs text-muted-foreground underline inline-flex items-center gap-1">
              <HelpCircle size={13} /> How it works
            </button>
          )}
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

      {/* Filter bar */}
      <div className="rounded-xl border bg-card p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search deals (e.g. air fryer, dog bed)…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-background"
          />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value === '' ? '' : Number(e.target.value))}
                className="text-sm rounded-lg border bg-background px-2.5 py-2">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select value={minDiscount} onChange={(e) => setMinDiscount(Number(e.target.value))}
                className="text-sm rounded-lg border bg-background px-2.5 py-2">
          <option value={0}>Any discount</option>
          <option value={15}>15%+ off</option>
          <option value={25}>25%+ off</option>
          <option value={40}>40%+ off</option>
          <option value={50}>50%+ off</option>
        </select>
        <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}
                className="text-sm rounded-lg border bg-background px-2.5 py-2">
          <option value={0}>Any rating</option>
          <option value={3}>3★+</option>
          <option value={4}>4★+</option>
          <option value={4.5}>4.5★+</option>
        </select>
        <button
          onClick={() => setRealOnly((v) => !v)}
          title="Only deals whose price history confirms a genuine discount"
          className={`text-sm rounded-lg border px-2.5 py-2 inline-flex items-center gap-1.5 ${realOnly ? 'bg-blue-600 text-white border-blue-600' : 'bg-background'}`}
        >
          <ShieldCheck size={14} /> Real deals
        </button>
        <button
          onClick={() => setHasCampaign((v) => !v)}
          title="Only deals whose ASIN matches a campaign in your uploaded Creator Connections catalog (pays an elevated commission)"
          className={`text-sm rounded-lg border px-2.5 py-2 inline-flex items-center gap-1.5 ${hasCampaign ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-background'}`}
        >
          <Sparkles size={14} /> Creator Connections
        </button>
        <select value={sort} onChange={(e) => setSort(e.target.value)}
                className="text-sm rounded-lg border bg-background px-2.5 py-2 ml-auto">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {hasFilters && <button onClick={clearFilters} className="text-xs text-muted-foreground underline">Clear</button>}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="text-center py-16 text-sm text-muted-foreground">{error}</div>
      ) : deals.length === 0 ? (
        <EmptyState hasFilters={!!hasFilters} isAdmin={tier === 'admin'} onClear={clearFilters} onRefresh={() => void load()} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {deals.map((d) => <DealCard key={d.asin} deal={d} onQuickPost={setQuickPostDeal} />)}
        </div>
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
function useMakePost(asin: string) {
  const [gen, setGen] = useState<'idle' | 'working' | 'done'>('idle')
  const [postUrl, setPostUrl] = useState<string | null>(null)
  const makePost = async () => {
    if (gen === 'working') return
    setGen('working')
    try {
      const res = await fetch('/api/deals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin, occasion: 'auto' }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not create the post.'); setGen('idle'); return }
      setPostUrl(data.url || null); setGen('done')
      toast.success('Deal post published.')
    } catch { toast.error('Could not create the post.'); setGen('idle') }
  }
  return { gen, postUrl, makePost }
}

function DealCard({ deal: d, onQuickPost }: { deal: Deal; onQuickPost: (d: Deal) => void }) {
  const { gen, postUrl, makePost } = useMakePost(d.asin)
  return (
    <div className="rounded-xl border bg-card overflow-hidden flex flex-col">
      <a href={d.amazonUrl} target="_blank" rel="noopener noreferrer" className="relative block bg-white aspect-square p-3">
        {d.imageUrl
          ? <img src={d.imageUrl} alt="" className="h-full w-full object-contain" />
          : <div className="h-full w-full flex items-center justify-center text-muted-foreground"><BadgePercent size={28} /></div>}
        {d.discountPct != null && (
          <span className="absolute top-2 left-2 text-xs font-bold bg-red-600 text-white rounded px-1.5 py-0.5">-{d.discountPct}%</span>
        )}
        {d.dealType === 'lightning' && (
          <span className="absolute top-2 right-2 text-[10px] font-bold bg-amber-500 text-white rounded px-1.5 py-0.5 inline-flex items-center gap-0.5"><Zap size={10} /> Lightning</span>
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
        {d.verdict && <VerdictBadge verdict={d.verdict} />}
        {d.campaign && (
          <a href={d.campaign.detailsUrl || '#'} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">
            <Sparkles size={12} /> +{d.campaign.commissionPct}% Creator Connections
          </a>
        )}
        <div className="mt-auto pt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            {gen === 'done' && postUrl ? (
              <a href={postUrl} target="_blank" rel="noopener noreferrer"
                 className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium rounded-md bg-emerald-600 text-white py-2">
                <Check size={14} /> View post
              </a>
            ) : (
              <Button size="sm" className="flex-1" onClick={makePost} disabled={gen === 'working'}>
                {gen === 'working'
                  ? <><Loader2 size={14} className="mr-1 animate-spin" /> Writing…</>
                  : <>Make blog post <ArrowRight size={14} className="ml-1" /></>}
              </Button>
            )}
            <a href={d.amazonUrl} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center justify-center h-8 w-8 rounded-md border hover:bg-accent" title="View on Amazon">
              <ExternalLink size={14} />
            </a>
          </div>
          <button
            onClick={() => onQuickPost(d)}
            className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium rounded-md border py-1.5 hover:bg-accent"
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
  const { gen, postUrl, makePost } = useMakePost(d.asin)
  return (
    <div className="shrink-0 w-48 rounded-lg bg-card text-[color:var(--text)] border border-emerald-500/20 p-2 flex flex-col">
      <a href={d.amazonUrl} target="_blank" rel="noopener noreferrer" className="block">
        {d.imageUrl && <img src={d.imageUrl} alt="" className="h-20 w-full object-contain mb-1.5 rounded bg-white" />}
        <div className="text-xs font-medium line-clamp-2 leading-snug min-h-[2rem]">{d.title}</div>
      </a>
      <div className="flex items-center gap-1.5 mt-1 mb-2">
        {d.discountPct != null && <span className="text-[10px] font-bold text-red-500">-{d.discountPct}%</span>}
        {d.campaign && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">+{d.campaign.commissionPct}% CC</span>}
      </div>
      <div className="mt-auto flex items-center gap-1.5">
        {gen === 'done' && postUrl ? (
          <a href={postUrl} target="_blank" rel="noopener noreferrer"
             className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-medium rounded-md bg-emerald-600 text-white py-1.5">
            <Check size={12} /> View post
          </a>
        ) : (
          <button onClick={makePost} disabled={gen === 'working'}
             className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-medium rounded-md bg-primary text-primary-foreground py-1.5 disabled:opacity-60">
            {gen === 'working' ? <><Loader2 size={11} className="animate-spin" /> Writing…</> : <>Blog</>}
          </button>
        )}
        <button onClick={() => onQuickPost(d)} title="Quick post to socials"
           className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-medium rounded-md border py-1.5 hover:bg-accent">
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

interface PostResult { platform: string; ok: boolean; url?: string; error?: string }

// "Quick post" modal — fire a deal straight to the link-friendly socials with a
// thumbnail, an auto-written price-safe caption (editable), and the user's
// affiliate link. No IG/TikTok (no clickable caption link) or Pinterest.
function QuickPostModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(QUICK_PLATFORMS.map((p) => p.key)))
  const [caption, setCaption] = useState('')
  const [posting, setPosting] = useState(false)
  const [results, setResults] = useState<PostResult[] | null>(null)
  const [linkNote, setLinkNote] = useState<string | null>(null)

  const toggle = (key: string) => setSelected((s) => {
    const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n
  })

  const post = async () => {
    if (selected.size === 0) { toast.error('Pick at least one platform.'); return }
    setPosting(true); setResults(null); setLinkNote(null)
    try {
      const res = await fetch('/api/deal-radar/social-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: deal.asin, platforms: [...selected], caption: caption.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok && !Array.isArray(data.results)) { toast.error(data.error || 'Could not post.'); return }
      const posted = data.results as PostResult[]
      setResults(posted)
      const note = typeof data.geniuslinkNote === 'string' ? data.geniuslinkNote : null
      setLinkNote(note)
      const okCount = posted.filter((r) => r.ok).length
      const failCount = posted.length - okCount
      if (okCount > 0) toast.success(`Posted to ${okCount} platform${okCount > 1 ? 's' : ''}.`)
      if (data.caption && !caption) setCaption(data.caption)
      // Everything the user asked for went out cleanly — close the modal (brief
      // beat so the green check is visible). Stay open if any platform failed OR
      // a Geniuslink note needs reading (e.g. link fell back to the tagged URL).
      if (okCount > 0 && failCount === 0 && !note) setTimeout(onClose, 900)
    } catch {
      toast.error('Could not post.')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-[#16161a] rounded-xl border shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2 font-semibold"><Send size={16} /> Quick post to socials</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><CloseIcon size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex gap-3">
            {deal.imageUrl && <img src={deal.imageUrl} alt="" className="h-16 w-16 object-contain rounded border bg-white shrink-0" />}
            <div className="text-sm font-medium line-clamp-3">{deal.title}</div>
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1.5">Post to</div>
            <div className="flex flex-wrap gap-2">
              {QUICK_PLATFORMS.map((p) => (
                <button key={p.key} onClick={() => toggle(p.key)}
                  className={`text-sm rounded-lg border px-3 py-1.5 ${selected.has(p.key) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1.5">Caption <span className="font-normal">(leave blank to auto-write)</span></div>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3}
              placeholder="We'll write a price-safe caption for you, or type your own…"
              className="w-full text-sm rounded-lg border bg-background p-2.5 resize-none" />
            <p className="text-[11px] text-muted-foreground mt-1">Your affiliate link and an #ad disclosure are added automatically. We avoid quoting a specific price so the post stays accurate over time.</p>
          </div>

          {results && (
            <div className="space-y-1.5">
              {results.map((r) => (
                <div key={r.platform} className="flex items-center gap-2 text-sm">
                  {r.ok ? <Check size={15} className="text-emerald-600" /> : <AlertCircle size={15} className="text-red-600" />}
                  <span className="capitalize font-medium">{QUICK_PLATFORMS.find((p) => p.key === r.platform)?.label || r.platform}</span>
                  {r.ok
                    ? (r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">view</a> : <span className="text-xs text-muted-foreground">posted</span>)
                    : <span className="text-xs text-red-600">{r.error}</span>}
                </div>
              ))}
            </div>
          )}

          {linkNote && (
            <div className="flex items-start gap-2 text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-400">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>Your affiliate tag still earns, but we couldn&apos;t shorten via Geniuslink this time, so the post used your plain Amazon link. Reason: {linkNote}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          <Button size="sm" onClick={post} disabled={posting || selected.size === 0}>
            {posting ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Posting…</> : <><Send size={14} className="mr-1.5" /> Post now</>}
          </Button>
        </div>
      </div>
    </div>
  )
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
