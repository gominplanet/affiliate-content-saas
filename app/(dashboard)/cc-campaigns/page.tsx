'use client'

/**
 * CC Campaigns — the Creator Connections intelligence browser.
 *
 * Every live campaign with the decision data on the card: commission + est
 * $/sale, how full it is (spots left), whether the brand actually pays out
 * (budget being spent), demand + rating, days left, and a one-click "Make blog
 * post". This is MVP's answer to Logie-style CC research, fused straight into
 * the content engine (browse → publish in one place).
 */

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import {
  Loader2, ExternalLink, Search, ShieldCheck, ShieldAlert, ShieldQuestion,
  Users, Star, TrendingUp, Clock, FileText, CheckCircle2,
} from 'lucide-react'

interface Trust { score: number; tier: 'reliable' | 'mixed' | 'risky' | 'unknown'; spendRatio: number | null; reasons: string[] }
interface Campaign {
  campaignId: string
  name: string | null
  brand: string | null
  repAsin: string | null
  asinCount: number
  image: string | null
  commissionPct: number | null
  perSale: number | null
  priceNow: number | null
  discountPct: number | null
  rating: number | null
  reviewCount: number | null
  monthlySold: number | null
  videoCount: number | null
  endsAt: string | null
  daysLeft: number | null
  spotsLeft: number | null
  totalSlots: number | null
  pctFilled: number | null
  isFull: boolean
  budgetRemaining: number | null
  trust: Trust
  score: number
  detailsUrl: string
}

const SORTS = [
  { key: 'score', label: 'Best opportunities' },
  { key: 'commission', label: 'Highest commission' },
  { key: 'perSale', label: 'Highest $ / sale' },
  { key: 'ending', label: 'Ending soon' },
  { key: 'demand', label: 'Most in demand' },
] as const

function TrustBadge({ t }: { t: Trust }) {
  const map = {
    reliable: { icon: <ShieldCheck size={13} />, label: 'Pays out', cls: 'text-[#1c7a35] bg-[#34c759]/15' },
    mixed: { icon: <ShieldQuestion size={13} />, label: 'Mixed', cls: 'text-[#8a6d00] bg-[#ffcc00]/15' },
    risky: { icon: <ShieldAlert size={13} />, label: 'Risky', cls: 'text-[#b3261e] bg-[#ff3b30]/12' },
    unknown: { icon: <ShieldQuestion size={13} />, label: 'Unknown', cls: 'text-[var(--text-3)] bg-[var(--surface-2)]' },
  }[t.tier]
  return (
    <span title={t.reasons.join(' · ')} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${map.cls}`}>
      {map.icon} {map.label}
    </span>
  )
}

function useMakePost(c: Campaign) {
  const [gen, setGen] = useState(false)
  const [postUrl, setPostUrl] = useState<string | null>(null)
  const makePost = useCallback(async (confirmDuplicate = false) => {
    if (!c.repAsin) { toast.error('No product ASIN on this campaign yet.'); return }
    setGen(true)
    try {
      const res = await fetch('/api/deals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: c.repAsin, occasion: 'auto', ...(confirmDuplicate ? { confirmDuplicate: true } : {}) }),
      })
      const j = await res.json().catch(() => ({}))
      if (j?.duplicate && !confirmDuplicate) {
        if (window.confirm(`You already have a post for this product${j.existingTitle ? `: "${j.existingTitle}"` : ''}. Make another?`)) {
          setGen(false); return makePost(true)
        }
        setGen(false); return
      }
      if (!res.ok || j?.error) { toast.error(j?.error || `Failed (${res.status})`); return }
      const url = j.wordpressUrl || j.url || j.existingUrl || null
      setPostUrl(url)
      toast.success('Blog post created.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate')
    } finally { setGen(false) }
  }, [c.repAsin])
  return { gen, postUrl, makePost }
}

function CampaignCard({ c }: { c: Campaign }) {
  const { gen, postUrl, makePost } = useMakePost(c)
  const endingSoon = c.daysLeft != null && c.daysLeft <= 1
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="w-20 h-20 rounded-lg bg-[var(--surface-2)] border border-[var(--border-2)] flex items-center justify-center overflow-hidden flex-shrink-0">
          {c.image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={c.image} alt="" className="w-full h-full object-contain p-1" />
            : <span className="text-[10px] text-[var(--text-3)]">No image</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <TrustBadge t={c.trust} />
            {c.isFull && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-[#b3261e] bg-[#ff3b30]/12">FULL</span>}
            {endingSoon && !c.isFull && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-[#b3261e] bg-[#ff3b30]/12">Ends {c.daysLeft === 0 ? 'today' : 'tomorrow'}</span>}
          </div>
          <p className="text-[11px] text-[var(--text-3)] truncate">{c.brand || 'Unknown brand'}</p>
          <p className="text-sm font-medium text-[var(--text)] leading-snug line-clamp-2">{c.name || c.repAsin}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5">
          <p className="text-[var(--text-3)] text-[10px]">Commission</p>
          <p className="font-semibold text-[var(--text)]">{c.commissionPct != null ? `${c.commissionPct}%` : '—'}</p>
        </div>
        <div className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5">
          <p className="text-[var(--text-3)] text-[10px]">Est. $ / sale</p>
          <p className="font-semibold text-[#1c7a35]">{c.perSale != null ? `$${c.perSale.toFixed(2)}` : '—'}</p>
        </div>
      </div>

      {/* Spots */}
      {c.totalSlots != null && (
        <div>
          <div className="flex items-center justify-between text-[10px] text-[var(--text-3)] mb-1">
            <span>{c.spotsLeft != null ? `${c.spotsLeft.toLocaleString()} of ${c.totalSlots.toLocaleString()} spots left` : 'Spots'}</span>
            {c.pctFilled != null && <span>{c.pctFilled}% full</span>}
          </div>
          <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${c.pctFilled ?? 0}%`, background: c.isFull ? '#ff3b30' : (c.pctFilled ?? 0) > 80 ? '#ff9500' : '#34c759' }} />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-[var(--text-3)] flex-wrap">
        {c.monthlySold != null && <span className="inline-flex items-center gap-1"><TrendingUp size={12} /> {c.monthlySold.toLocaleString()}+/mo</span>}
        {c.rating != null && <span className="inline-flex items-center gap-1"><Star size={12} /> {c.rating}{c.reviewCount ? ` (${c.reviewCount.toLocaleString()})` : ''}</span>}
        {c.videoCount != null && <span className="inline-flex items-center gap-1"><Users size={12} /> {c.videoCount} vids</span>}
        {c.daysLeft != null && c.daysLeft > 1 && <span className="inline-flex items-center gap-1"><Clock size={12} /> {c.daysLeft}d left</span>}
      </div>

      <div className="flex items-center gap-2 mt-auto pt-1">
        {postUrl ? (
          <a href={postUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-1.5 text-xs flex-1 justify-center">
            <CheckCircle2 size={13} className="text-[#34c759]" /> View post
          </a>
        ) : (
          <button onClick={() => makePost()} disabled={gen || c.isFull} className="btn-primary flex items-center gap-1.5 text-xs flex-1 justify-center disabled:opacity-50"
            title={c.isFull ? 'Campaign is full — no bounty to earn' : 'Generate a blog post for this product'}>
            {gen ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Make blog post
          </button>
        )}
        <a href={c.detailsUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-1.5 text-xs" title="Open the campaign on Amazon Creator Connections">
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  )
}

export default function CcCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [sort, setSort] = useState<string>('score')
  const [q, setQ] = useState('')
  const [minCommission, setMinCommission] = useState(0)
  const [payingOnly, setPayingOnly] = useState(false)
  const [hasSpots, setHasSpots] = useState(true)

  const fetchPage = useCallback(async (page: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    try {
      const p = new URLSearchParams({ page: String(page), sort, ...(q ? { q } : {}), ...(minCommission ? { minCommission: String(minCommission) } : {}), ...(payingOnly ? { payingOnly: '1' } : {}), ...(hasSpots ? { hasSpots: '1' } : {}) })
      const res = await fetch(`/api/cc/campaigns?${p.toString()}`, { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) { toast.error(j?.error || 'Failed to load campaigns'); return }
      setCampaigns((prev) => append ? [...prev, ...j.campaigns] : j.campaigns)
      setNextPage(j.nextPage)
      setTotal(j.total ?? 0)
    } finally { setLoadingMore(false); setLoading(false) }
  }, [sort, q, minCommission, payingOnly, hasSpots])

  // Debounced reload on filter change.
  useEffect(() => {
    const t = setTimeout(() => fetchPage(1, false), 250)
    return () => clearTimeout(t)
  }, [fetchPage])

  return (
    <>
      <PageHero
        title="CC Campaigns"
        subtitle="Every live Creator Connections campaign with the numbers that matter — commission, $ per sale, spots left, whether the brand actually pays out — and one click to turn it into a blog post."
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brand or product…" className="input-field w-full pl-9 text-sm" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="input-field text-sm w-auto">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={minCommission} onChange={(e) => setMinCommission(Number(e.target.value))} className="input-field text-sm w-auto">
          <option value={0}>Any commission</option>
          <option value={5}>5%+</option>
          <option value={10}>10%+</option>
          <option value={15}>15%+</option>
          <option value={20}>20%+</option>
        </select>
        <button onClick={() => setPayingOnly((v) => !v)} className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${payingOnly ? 'border-[#34c759] text-[#1c7a35] bg-[#34c759]/10' : 'border-[var(--border-2)] text-[var(--text-3)]'}`}>
          Paying brands only
        </button>
        <button onClick={() => setHasSpots((v) => !v)} className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${hasSpots ? 'border-[#7C3AED] text-[#7C3AED] bg-[#7C3AED]/10' : 'border-[var(--border-2)] text-[var(--text-3)]'}`}>
          Has open spots
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-3)] py-10"><Loader2 size={16} className="animate-spin" /> Loading campaigns…</div>
      ) : campaigns.length === 0 ? (
        <div className="card p-8 text-center text-sm text-[var(--text-3)]">
          No live campaigns match these filters. Try clearing filters, or check back after the next catalog import.
        </div>
      ) : (
        <>
          <p className="text-xs text-[var(--text-3)] mb-3">{total.toLocaleString()} live campaign{total === 1 ? '' : 's'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((c) => <CampaignCard key={c.campaignId} c={c} />)}
          </div>
          {nextPage && (
            <div className="flex justify-center mt-6">
              <button onClick={() => fetchPage(nextPage, true)} disabled={loadingMore} className="btn-secondary flex items-center gap-2">
                {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null} Load more
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
