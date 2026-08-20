// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AmazonBrainstorm — the storefront ANALYTICS dashboard for the Amazon Influencer
// tier. Reads SCOUT-synced storefront_earnings via /api/storefront/analytics:
// headline KPIs (earnings, revenue, units, clicks, conversion, earnings/click)
// with period-over-period trend, plus a sortable per-product table where each
// row shows its own trend vs the prior period and one-click actions. Below the
// numbers, a compact AI "next moves" strip (/api/brainstorm/amazon) turns the
// data into specific posts to make. Weekly/monthly toggle; both are SCOUT-synced.
'use client'

import { useCallback, useEffect, useState, Fragment } from 'react'
import Link from 'next/link'
import { requestEarningsScan } from '@/lib/extension-frame'
import {
  Loader2, Sparkles, Wand2, Share2, Handshake, PackageSearch, ArrowRight, ArrowUpRight, ArrowDownRight,
  AlertCircle, DollarSign, MousePointerClick, Package, Percent, TrendingUp, ExternalLink,
  FileText, ChevronDown, Star, Check, Layers, X, CheckCircle2, HeartPulse, Upload,
} from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { acceptCampaignViaScout } from '@/lib/accept-campaign'
import StorefrontCharts from '@/components/amazon/StorefrontCharts'

const ACCENT = '#C2410C'
const GREEN = '#15803d'
const RED = '#b91c1c'

// ── Types mirrored from /api/storefront/analytics ────────────────────────────
interface Totals { earnings: number; revenue: number; units: number; clicks: number; products: number; conversion: number; epc: number }
interface Campaign { name: string | null; status: string | null; campaignId: string | null; detailsUrl: string | null; brand: string | null; accepted: boolean }
interface Product {
  asin: string; title: string; earnings: number; revenue: number; units: number; clicks: number
  conversion: number; epc: number; commissionPct: number | null
  earningsPrev: number | null; earningsDelta: number | null; isNew: boolean; amazonUrl: string
  // Garnish (deal_radar_cache + campaigns)
  image: string | null; priceNow: number | null; monthlySold: number | null
  rating: number | null; reviewCount: number | null; discountPct: number | null
  category?: string | null
  campaign: Campaign | null
}
interface SeriesPoint { start: string; earnings: number; revenue: number; units: number; clicks: number; conversion: number; epc: number }
interface Coverage { periods: number; earliestStart: string | null; latestStart: string | null }
type Period = 'weekly' | 'monthly' | 'ytd'

interface Analytics {
  period: Period; hasData: boolean
  available: { weekly: number; monthly: number; ytd: number }
  coverage?: Coverage
  latest: { start: string; end: string | null } | null
  previous: { start: string } | null
  totals: Totals | null; totalsPrev: Totals | null; products: Product[]
  series?: SeriesPoint[]
}

// ── AI next-moves (unchanged endpoint) ───────────────────────────────────────
interface Suggestion { title: string; why: string; action: 'thumbnail' | 'social' | 'campaign' | 'research'; asin?: string | null; label: string }
const ACTION_META: Record<Suggestion['action'], { icon: React.ReactNode; href: (asin?: string | null) => string }> = {
  thumbnail: { icon: <Wand2 size={14} />, href: (asin) => (asin ? `/amazon/thumbnails?asin=${asin}` : '/amazon/thumbnails') },
  social: { icon: <Share2 size={14} />, href: () => '/amazon/social' },
  campaign: { icon: <Handshake size={14} />, href: () => '/cc-campaigns' },
  research: { icon: <PackageSearch size={14} />, href: () => '/amazon/research' },
}

// ── Formatting ───────────────────────────────────────────────────────────────
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const usdShort = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : usd(n))
const int = (n: number) => n.toLocaleString('en-US')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtPeriod(period: Period, start?: string | null, end?: string | null): string {
  if (!start) return ''
  const [ys, ms, ds] = start.split('-').map(Number)
  if (period === 'ytd') return `${ys} year to date`
  if (period === 'monthly') return `${MONTHS[(ms || 1) - 1]} ${ys}`
  const s = `${MONTHS[(ms || 1) - 1]} ${ds}`
  if (end) { const [, me, de] = end.split('-').map(Number); return `${s} – ${MONTHS[(me || 1) - 1]} ${de}` }
  return s
}
function pctChange(cur: number, prev: number | null | undefined): number | null {
  if (prev == null || prev === 0) return null
  return Math.round(((cur - prev) / prev) * 1000) / 10
}

// ── Delta chip (period-over-period % on a KPI) ───────────────────────────────
function Delta({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>no prior period</span>
  if (pct === 0) return <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>flat</span>
  const up = pct > 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold" style={{ color: up ? GREEN : RED }}>
      <Icon size={12} /> {Math.abs(pct)}%
    </span>
  )
}

type SortKey = 'earnings' | 'revenue' | 'units' | 'clicks' | 'conversion' | 'epc'

// ── Expandable per-product command center ────────────────────────────────────
function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>{label}</p>
      <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{value}</p>
    </div>
  )
}

function ActionBtn({ href, external, icon, label, sub, primary }: { href: string; external?: boolean; icon: React.ReactNode; label: string; sub?: string; primary?: boolean }) {
  const cls = 'inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-transform hover:-translate-y-0.5'
  const style: React.CSSProperties = primary
    ? { backgroundColor: ACCENT, color: '#fff' }
    : { border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }
  const inner = <><span style={{ color: primary ? '#fff' : ACCENT }}>{icon}</span> {label}{sub ? <span className="font-normal opacity-70">· {sub}</span> : null}</>
  if (external) return <a href={href} target="_blank" rel="noreferrer" className={cls} style={style}>{inner}</a>
  return <Link href={href} className={cls} style={style}>{inner}</Link>
}

function ProductDrawer({ p, hasBlog }: { p: Product; hasBlog: boolean }) {
  const camp = p.campaign
  const [accepted, setAccepted] = useState(!!camp?.accepted)
  const [accepting, setAccepting] = useState(false)

  async function accept() {
    if (!camp) return
    setAccepting(true)
    try {
      const ok = await acceptCampaignViaScout({
        detailsUrl: camp.detailsUrl || '',
        asin: p.asin,
        campaignId: camp.campaignId,
        brand: camp.brand,
        commissionPct: p.commissionPct,
        productTitle: p.title,
      })
      if (ok) setAccepted(true)
    } finally {
      setAccepting(false)
    }
  }

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      {/* Stat chips — full set, so it reads on mobile where columns are hidden */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-4">
        <StatChip label="Earnings" value={usd(p.earnings)} />
        <StatChip label="Revenue" value={usd(p.revenue)} />
        <StatChip label="Units" value={int(p.units)} />
        <StatChip label="Clicks" value={int(p.clicks)} />
        <StatChip label="Conversion" value={`${p.conversion}%`} />
        <StatChip label="Earn/click" value={usd(p.epc)} />
        {p.priceNow != null && <StatChip label="Price" value={usd(p.priceNow)} />}
        {p.monthlySold != null && p.monthlySold > 0 && <StatChip label="Demand" value={`~${int(p.monthlySold)}/mo`} />}
        {p.rating != null && <StatChip label="Rating" value={`${p.rating}★${p.reviewCount ? ` (${int(p.reviewCount)})` : ''}`} />}
        {p.discountPct != null && p.discountPct > 0 && <StatChip label="Discount" value={`${p.discountPct}% off`} />}
        {p.commissionPct != null && <StatChip label="Your commission" value={`${p.commissionPct}%`} />}
      </div>

      {/* Brand deal — accept inline via SCOUT, no bouncing to CC Campaigns */}
      {camp && (
        <div className="rounded-xl border p-3 mb-3 flex items-center gap-3 flex-wrap" style={{ borderColor: 'rgba(234,88,12,0.3)', background: 'rgba(234,88,12,0.05)' }}>
          <span className="w-8 h-8 rounded-lg grid place-items-center text-white flex-shrink-0" style={{ backgroundColor: ACCENT }}><Handshake size={15} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              Open brand deal{camp.brand ? ` · ${camp.brand}` : ''}
            </p>
            <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>{camp.name || 'Creator Connections campaign for this product'}</p>
          </div>
          {accepted ? (
            <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'rgba(52,199,89,0.14)', color: GREEN }}>
              <CheckCircle2 size={14} /> Accepted
            </span>
          ) : (
            <button
              onClick={accept}
              disabled={accepting || !camp.detailsUrl}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white whitespace-nowrap disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
              title={camp.detailsUrl ? 'Accept this campaign on Amazon via SCOUT' : 'No campaign link yet — open it in CC Campaigns'}
            >
              {accepting ? <><Loader2 size={13} className="animate-spin" /> Accepting…</> : <><Handshake size={13} /> Accept on Amazon</>}
            </button>
          )}
        </div>
      )}

      {/* Actions — turn this product into content */}
      <div className="flex flex-wrap gap-2">
        <ActionBtn primary href={`/amazon/thumbnails?asin=${p.asin}`} icon={<Wand2 size={14} />} label="Make thumbnail" />
        <ActionBtn href={`/amazon/social?asin=${p.asin}`} icon={<Share2 size={14} />} label="Quick social" />
        {hasBlog && <ActionBtn href={`/deals?asin=${p.asin}`} icon={<FileText size={14} />} label="Write blog post" />}
        <ActionBtn external href={p.amazonUrl} icon={<ExternalLink size={14} />} label="Visit Amazon" />
      </div>
    </div>
  )
}

/**
 * Storefront health — flags products that are quietly costing the creator
 * money, computed from the earnings data we already have (no extra calls):
 *   • Dead weight — getting clicks but ZERO sales (often unavailable, or a weak
 *     pick that sends traffic nowhere).
 *   • Falling — earnings dropped 75%+ vs the previous period (losing the sale).
 *   • Low conversion — plenty of clicks, but under 1% convert.
 * Each row links to AMZ Research pre-filled to find a better replacement.
 *
 * (Oink also flags untagged / over-tagged videos; that needs storefront
 * video-tag data MVP doesn't ingest — SCOUT is frozen — so it's out of scope.)
 */
function StorefrontHealth({ products }: { products: Product[] }) {
  const [open, setOpen] = useState(true)
  type Flag = { label: string; tone: string; dead: boolean }
  const flagFor = (p: Product): Flag | null => {
    if (p.clicks >= 5 && p.earnings === 0) return { label: 'Clicks, no sales', tone: RED, dead: true }
    if (p.earningsPrev != null && p.earningsPrev >= 5 && p.earnings <= p.earningsPrev * 0.25) return { label: 'Earnings falling', tone: '#b45309', dead: false }
    if (p.clicks >= 25 && p.earnings > 0 && p.conversion < 1) return { label: 'Low conversion', tone: '#b45309', dead: false }
    return null
  }
  const flagged = products
    .map(p => ({ p, f: flagFor(p) }))
    .filter((x): x is { p: Product; f: Flag } => x.f != null)
    .sort((a, b) => Number(b.f.dead) - Number(a.f.dead) || b.p.clicks - a.p.clicks)
  const replaceHref = (p: Product) => {
    const kw = (p.category || p.title || '').split(/\s+/).slice(0, 4).join(' ')
    return `/amz-finder?q=${encodeURIComponent(kw)}`
  }
  if (!flagged.length) {
    return (
      <div className="rounded-2xl border p-4 mb-6 flex items-center gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <HeartPulse size={16} style={{ color: GREEN }} />
        <span className="text-[13px] font-medium" style={{ color: 'var(--text)' }}>Storefront looks healthy — every product getting traffic is converting.</span>
      </div>
    )
  }
  return (
    <div className="rounded-2xl border overflow-hidden mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full px-4 py-3 border-b flex items-center justify-between gap-2" style={{ borderColor: 'var(--border)' }}>
        <span className="inline-flex items-center gap-2 font-bold text-[14px]" style={{ color: 'var(--text)' }}>
          <HeartPulse size={16} style={{ color: ACCENT }} /> Storefront health
          <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(234,88,12,0.12)', color: ACCENT }}>{flagged.length} to review</span>
        </span>
        <ChevronDown size={16} style={{ color: 'var(--text-soft)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && (
        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {flagged.slice(0, 25).map(({ p, f }) => (
            <div key={p.asin} className="flex items-center gap-3 px-4 py-2.5">
              {p.image
                ? <img src={p.image} alt="" className="w-10 h-10 rounded object-contain bg-white flex-shrink-0" />
                : <div className="w-10 h-10 rounded flex-shrink-0" style={{ background: 'var(--surface-2)' }} />}
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text)' }}>{p.title}</div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[10.5px] font-semibold rounded px-1.5 py-0.5" style={{ background: `${f.tone}1a`, color: f.tone }}>{f.label}</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    {p.clicks.toLocaleString()} clicks · {usd(p.earnings)}{p.earningsPrev != null ? ` (was ${usd(p.earningsPrev)})` : ''}
                  </span>
                </div>
              </div>
              <Link href={replaceHref(p)} className="text-[11px] font-semibold rounded-full px-2.5 py-1.5 inline-flex items-center gap-1 flex-shrink-0 text-white" style={{ background: ACCENT }} title="Find a better product in this space">
                <PackageSearch size={12} /> Replace
              </Link>
              <a href={p.amazonUrl} target="_blank" rel="noopener noreferrer" className="rounded-full px-2 py-1.5 border inline-flex items-center flex-shrink-0" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }} title="View on Amazon"><ExternalLink size={12} /></a>
            </div>
          ))}
          <div className="px-4 py-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            Clicks-no-sales usually means the product went unavailable or doesn&apos;t convert — replace it. Falling = earnings dropped 75%+ vs last period. &ldquo;Replace&rdquo; opens AMZ Research to find a better product in the same space.
          </div>
        </div>
      )}
    </div>
  )
}

export default function AmazonBrainstorm() {
  const [period, setPeriod] = useState<Period>('monthly')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('earnings')
  const [openAsin, setOpenAsin] = useState<string | null>(null)
  const tier = useEffectiveTier()
  const hasBlog = tier !== 'amazon' // Amazon tier has no blog sites; others do.

  // Roundup: pick winners → one "my top N" blog post (deal-radar roundup engine).
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [roundupBusy, setRoundupBusy] = useState(false)
  const [roundupMsg, setRoundupMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null)
  const toggleSelect = (asin: string) => setSelected(prev => {
    const n = new Set(prev); if (n.has(asin)) n.delete(asin); else n.add(asin); return n
  })
  async function createRoundup() {
    const asins = [...selected]
    if (asins.length < 2) return
    setRoundupBusy(true); setRoundupMsg(null)
    try {
      const res = await fetch('/api/deal-radar/roundup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asins }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.ok === false) { setRoundupMsg({ ok: false, text: j.error || 'Could not build the roundup.' }); return }
      setRoundupMsg({ ok: true, text: `Roundup published (${j.count ?? asins.length} products).`, url: j.url })
      setSelected(new Set())
    } catch {
      setRoundupMsg({ ok: false, text: 'Could not build the roundup.' })
    } finally {
      setRoundupBusy(false)
    }
  }

  // AI next-moves
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [grounded, setGrounded] = useState(true)

  const load = useCallback(async (p: Period) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/storefront/analytics?period=${p}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json?.error || 'Could not load your storefront data.'); setData(null); return }
      setData(json as Analytics)
    } catch {
      setError('Network error — try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(period) }, [period, load])

  // One-click history sync: SCOUT reads the Amazon earnings report in a hidden
  // background tab (current view + quick-ranges) and pushes it, then we refresh.
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const syncFromAmazon = useCallback(async () => {
    setSyncing(true); setSyncMsg(null)
    try {
      const r = await requestEarningsScan()
      if (r.ok) {
        await load(period)
        setSyncMsg({ ok: true, text: r.count ? `Synced ${r.count} row${r.count === 1 ? '' : 's'} from Amazon.` : 'Checked Amazon — nothing new to add right now.' })
      } else if (r.error === 'not-installed') {
        setSyncMsg({ ok: false, text: 'Install SCOUT first — it reads your Amazon report. Then click Sync again.' })
      } else if (r.error === 'signed-out') {
        setSyncMsg({ ok: false, text: 'Sign in to Amazon Associates in this browser, then click Sync again.' })
      } else {
        setSyncMsg({ ok: false, text: "Couldn't read your Amazon report just now. Open it once on Amazon, then try again." })
      }
    } catch {
      setSyncMsg({ ok: false, text: 'Sync failed — try again in a moment.' })
    } finally {
      setSyncing(false)
    }
  }, [load, period])

  // ── Full-year import: the creator downloads their Amazon report CSV
  //    ("Download Reports" on the report page) and drops it here. One file =
  //    the whole year, per product — no waiting on SCOUT to page months. Two
  //    report types (regular Commissions + Creator Connections) import
  //    separately and sum in the Year-to-date view.
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const importReport = useCallback(async (file: File, csvSource: 'amazon_commissions' | 'creator_connections') => {
    setImporting(true); setImportMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('source', csvSource)
      fd.append('year', String(new Date().getFullYear()))
      const res = await fetch('/api/storefront/import-earnings', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.ok === false) {
        setImportMsg({ ok: false, text: j.error || 'Could not read that file.' })
        return
      }
      const label = csvSource === 'creator_connections' ? 'Creator Connections' : 'Commissions'
      setImportMsg({ ok: true, text: `Imported ${j.imported} product${j.imported === 1 ? '' : 's'} from your ${label} report (${usd(j.totalEarnings || 0)} earnings).` })
      setPeriod('ytd')
      await load('ytd')
    } catch {
      setImportMsg({ ok: false, text: 'Import failed — try again.' })
    } finally {
      setImporting(false)
    }
  }, [load])

  async function generate() {
    setAiBusy(true); setAiError(null)
    try {
      const res = await fetch('/api/brainstorm/amazon', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setAiError(json?.error || 'Could not generate ideas.'); return }
      setSuggestions(Array.isArray(json.suggestions) ? json.suggestions : [])
      setGrounded(json.grounded !== false)
    } catch {
      setAiError('Network error — try again.')
    } finally {
      setAiBusy(false)
    }
  }

  const t = data?.totals
  const tp = data?.totalsPrev
  const products = data?.products ?? []
  const sorted = [...products].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number))
  const periodLabel = fmtPeriod(period, data?.latest?.start, data?.latest?.end)

  const KPIS: { key: SortKey | 'products'; label: string; icon: React.ReactNode; value: string; pct: number | null }[] = t ? [
    { key: 'earnings', label: 'Earnings', icon: <DollarSign size={14} />, value: usd(t.earnings), pct: pctChange(t.earnings, tp?.earnings) },
    { key: 'revenue', label: 'Revenue', icon: <TrendingUp size={14} />, value: usd(t.revenue), pct: pctChange(t.revenue, tp?.revenue) },
    { key: 'units', label: 'Units shipped', icon: <Package size={14} />, value: int(t.units), pct: pctChange(t.units, tp?.units) },
    { key: 'clicks', label: 'Clicks', icon: <MousePointerClick size={14} />, value: int(t.clicks), pct: pctChange(t.clicks, tp?.clicks) },
    { key: 'conversion', label: 'Conversion', icon: <Percent size={14} />, value: `${t.conversion}%`, pct: pctChange(t.conversion, tp?.conversion) },
    { key: 'epc', label: 'Earnings / click', icon: <DollarSign size={14} />, value: usd(t.epc), pct: pctChange(t.epc, tp?.epc) },
  ] : []

  return (
    <div className="max-w-6xl mx-auto">
      <PageHero
        accent={ACCENT}
        title="Your storefront, by the numbers"
        subtitle="What SCOUT synced from your Amazon report: your proven sellers, ranked by what they actually earn, with the trend since last period and a one-click way to post more of what works."
      />

      {/* Period toggle */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="inline-flex rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {([['ytd', 'Year to date'], ['monthly', 'Monthly'], ['weekly', 'Weekly']] as const).map(([p, label]) => {
            const has = (data?.available?.[p] ?? 0) > 0
            const active = period === p
            return (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className="px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-40"
                style={active ? { background: ACCENT, color: '#fff' } : { background: 'transparent', color: 'var(--text-soft)' }}
                title={has ? '' : (p === 'ytd' ? 'Upload your Amazon report to see the full year' : 'No ' + p + ' data synced yet')}
              >
                {label}
              </button>
            )
          })}
        </div>
        {periodLabel && (
          <span className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
            Showing <span className="font-semibold" style={{ color: 'var(--text)' }}>{periodLabel}</span>
            {data?.previous ? ' vs the period before' : ''}
          </span>
        )}
      </div>

      {/* Sales-history coverage + how to load more. SCOUT captures whatever
          report period is on screen, keyed per period, so opening past date
          ranges backfills months/years automatically — most creators just
          don't know to do it. */}
      {!loading && !error && data?.hasData && data.coverage && period !== 'ytd' && (
        <div className="mb-4 rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
              <span className="font-semibold" style={{ color: 'var(--text)' }}>
                {data.coverage.periods} {period === 'weekly' ? 'week' : 'month'}{data.coverage.periods !== 1 ? 's' : ''} of history
              </span>
              {data.coverage.earliestStart ? ` captured, back to ${fmtPeriod(period, data.coverage.earliestStart)}` : ' captured'}
            </span>
            <button
              onClick={() => void syncFromAmazon()}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
            >
              {syncing ? <><Loader2 size={13} className="animate-spin" /> Syncing from Amazon…</> : 'Load more history'}
            </button>
          </div>
          {syncMsg && (
            <p className="text-[12px] mt-2" style={{ color: syncMsg.ok ? '#16a34a' : '#c0392b' }}>{syncMsg.text}</p>
          )}
          <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
            One click and SCOUT reads your Amazon report in the background (latest + recent past periods) and closes the tab — nothing to babysit.
          </p>
        </div>
      )}

      {/* Import your full year — the reliable path. Amazon's "Download Reports"
          export is the whole year in one CSV; SCOUT only reads one period at a
          time and misses Creator Connections entirely. Drop both report files
          here and the Year-to-date view sums them into your real income. */}
      {!loading && !error && (
        <div className="mb-4 rounded-xl border px-4 py-3.5" style={{ borderColor: 'rgba(234,88,12,0.28)', background: 'linear-gradient(180deg, rgba(234,88,12,0.04), transparent)' }}>
          <div className="flex items-start gap-2.5">
            <span className="w-7 h-7 rounded-lg grid place-items-center text-white flex-shrink-0 mt-0.5" style={{ backgroundColor: ACCENT }}><Upload size={14} /></span>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[13.5px]" style={{ color: 'var(--text)' }}>Import your full year</p>
              <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                On Amazon&rsquo;s report page, click <span className="font-semibold" style={{ color: 'var(--text)' }}>Download Reports</span>, set the range to <span className="font-semibold" style={{ color: 'var(--text)' }}>This Year</span>, and drop the CSV here. Do it once for <span className="font-semibold" style={{ color: 'var(--text)' }}>Commissions</span> and once for <span className="font-semibold" style={{ color: 'var(--text)' }}>Creator Connections</span> — the Year-to-date view adds them together.
              </p>
              <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white cursor-pointer ${importing ? 'opacity-60 pointer-events-none' : ''}`} style={{ backgroundColor: ACCENT }}>
                  {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Commissions CSV
                  <input type="file" accept=".csv,text/csv" className="hidden" disabled={importing}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void importReport(f, 'amazon_commissions'); e.target.value = '' }} />
                </label>
                <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold cursor-pointer border ${importing ? 'opacity-60 pointer-events-none' : ''}`} style={{ borderColor: ACCENT, color: ACCENT }}>
                  {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Creator Connections CSV
                  <input type="file" accept=".csv,text/csv" className="hidden" disabled={importing}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void importReport(f, 'creator_connections'); e.target.value = '' }} />
                </label>
              </div>
              {importMsg && (
                <p className="text-[12px] mt-2" style={{ color: importMsg.ok ? '#16a34a' : '#c0392b' }}>{importMsg.text}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border p-10 flex items-center justify-center gap-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
          <Loader2 size={16} className="animate-spin" /> Loading your storefront…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border p-4 flex items-center gap-2 text-[13px]" style={{ borderColor: 'rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.06)', color: '#c0392b' }}>
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* Empty state — no earnings synced yet */}
      {!loading && !error && data && !data.hasData && (
        <div className="rounded-2xl border p-8 text-center" style={{ borderColor: 'rgba(234,88,12,0.3)', background: 'linear-gradient(180deg, rgba(234,88,12,0.05), transparent)' }}>
          <span className="w-11 h-11 rounded-2xl grid place-items-center text-white mx-auto mb-3" style={{ backgroundColor: ACCENT }}><PackageSearch size={20} /></span>
          <p className="font-bold text-[16px] mb-1" style={{ color: 'var(--text)' }}>No storefront earnings synced yet</p>
          <p className="text-[13px] max-w-md mx-auto mb-4" style={{ color: 'var(--text-soft)' }}>
            Install SCOUT and open your Amazon earnings report once. It reads your own report in your browser and syncs your per-product sales here. Amazon only reports products with a few shipments, so everything that lands is a proven seller.
          </p>
          <Link href="/amazon/research" className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white" style={{ backgroundColor: ACCENT }}>
            Set up SCOUT <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {/* KPIs + table */}
      {!loading && !error && data?.hasData && t && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {KPIS.map((k) => (
              <div key={k.label} className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="flex items-center gap-1.5 mb-1.5" style={{ color: ACCENT }}>
                  <span className="w-6 h-6 rounded-lg grid place-items-center flex-shrink-0" style={{ background: 'rgba(234,88,12,0.12)' }}>{k.icon}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>{k.label}</span>
                </div>
                <p className="text-[20px] font-bold leading-none mb-1.5" style={{ color: 'var(--text)' }}>{k.value}</p>
                <Delta pct={k.pct} />
              </div>
            ))}
          </div>

          {/* Charts & visuals — collapsible so the table stays the default view */}
          <StorefrontCharts period={period} series={data.series ?? []} products={products} />

          {/* Storefront health — products quietly costing the creator money */}
          <StorefrontHealth products={products} />

          {/* Per-product table */}
          <div className="rounded-2xl border overflow-hidden mb-8" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: 'var(--border)' }}>
              <p className="font-bold text-[14px]" style={{ color: 'var(--text)' }}>Your products this period <span className="font-normal" style={{ color: 'var(--text-soft)' }}>({products.length}) · tap a row for stats &amp; actions</span></p>
              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-soft)' }}>
                Sort by:
                {(['earnings', 'revenue', 'units', 'clicks', 'conversion', 'epc'] as SortKey[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setSortKey(k)}
                    className="px-2 py-0.5 rounded-full capitalize font-semibold transition-colors"
                    style={sortKey === k ? { background: 'rgba(234,88,12,0.12)', color: ACCENT } : { color: 'var(--text-soft)' }}
                  >
                    {k === 'epc' ? 'EPC' : k}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left" style={{ color: 'var(--text-soft)' }}>
                    <th className="font-semibold px-4 py-2.5">Product</th>
                    <th className="font-semibold px-3 py-2.5 text-right">Earnings</th>
                    <th className="font-semibold px-3 py-2.5 text-right">Trend</th>
                    <th className="font-semibold px-3 py-2.5 text-right hidden sm:table-cell">Revenue</th>
                    <th className="font-semibold px-3 py-2.5 text-right hidden md:table-cell">Units</th>
                    <th className="font-semibold px-3 py-2.5 text-right hidden md:table-cell">Clicks</th>
                    <th className="font-semibold px-3 py-2.5 text-right hidden lg:table-cell">Conv.</th>
                    <th className="font-semibold px-3 py-2.5 text-right hidden lg:table-cell">EPC</th>
                    <th className="font-semibold px-3 py-2.5 text-right">Act</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p, i) => {
                    const open = openAsin === p.asin
                    const sel = selected.has(p.asin)
                    return (
                    <Fragment key={p.asin}>
                    <tr
                      className="border-t cursor-pointer transition-colors"
                      style={{ borderColor: 'var(--border)', ...(p.campaign ? { background: 'rgba(234,88,12,0.06)', boxShadow: `inset 3px 0 0 ${ACCENT}` } : {}) }}
                      onClick={() => setOpenAsin(open ? null : p.asin)}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {hasBlog && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleSelect(p.asin) }}
                              className="w-4 h-4 rounded flex-shrink-0 grid place-items-center border transition-colors"
                              style={sel ? { background: ACCENT, borderColor: ACCENT } : { borderColor: 'var(--border)' }}
                              title={sel ? 'Remove from roundup' : 'Add to roundup post'}
                            >
                              {sel && <Check size={11} className="text-white" />}
                            </button>
                          )}
                          <span className="text-[11px] font-bold w-4 flex-shrink-0 text-center" style={{ color: 'var(--text-soft)' }}>{i + 1}</span>
                          <span className="w-9 h-9 rounded-lg border flex-shrink-0 grid place-items-center overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                            {p.image
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img loading="lazy" decoding="async" src={p.image} alt="" className="w-full h-full object-contain" />
                              : <Package size={15} style={{ color: 'var(--text-soft)' }} />}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium truncate max-w-[240px]" style={{ color: 'var(--text)' }} title={p.title}>{p.title}</span>
                              {p.campaign && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: 'rgba(234,88,12,0.14)', color: ACCENT }} title="You have an open Creator Connections campaign for this product">
                                  <Handshake size={10} /> Deal
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--text-soft)' }}>
                              <span>{p.asin}</span>
                              {p.priceNow != null && <span>· {usd(p.priceNow)}</span>}
                              {p.monthlySold != null && p.monthlySold > 0 && <span>· ~{int(p.monthlySold)}/mo</span>}
                              {p.rating != null && <span className="inline-flex items-center gap-0.5">· <Star size={10} className="fill-current" style={{ color: '#f59e0b' }} />{p.rating}</span>}
                              {p.isNew && <span>· new</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text)' }}>{usdShort(p.earnings)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {p.earningsDelta == null ? (
                          <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>{p.isNew ? 'new' : '—'}</span>
                        ) : p.earningsDelta === 0 ? (
                          <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>flat</span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold" style={{ color: p.earningsDelta > 0 ? GREEN : RED }}>
                            {p.earningsDelta > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{usdShort(Math.abs(p.earningsDelta))}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap hidden sm:table-cell" style={{ color: 'var(--text-soft)' }}>{usdShort(p.revenue)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap hidden md:table-cell" style={{ color: 'var(--text-soft)' }}>{int(p.units)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap hidden md:table-cell" style={{ color: 'var(--text-soft)' }}>{int(p.clicks)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap hidden lg:table-cell" style={{ color: 'var(--text-soft)' }}>{p.conversion}%</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap hidden lg:table-cell" style={{ color: 'var(--text-soft)' }}>{usd(p.epc)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: open ? 'rgba(234,88,12,0.12)' : 'transparent', color: open ? ACCENT : 'var(--text-soft)' }}>
                          <ChevronDown size={15} className="transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr style={{ borderColor: 'var(--border)' }}>
                        <td colSpan={9} className="px-4 pb-4 pt-0" style={{ background: 'rgba(234,88,12,0.03)' }}>
                          <ProductDrawer p={p} hasBlog={hasBlog} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* AI next moves — grounded in the numbers above */}
      {!loading && !error && (
        <div className="rounded-2xl border p-5 sm:p-6" style={{ borderColor: 'rgba(234,88,12,0.25)', background: 'linear-gradient(180deg, rgba(234,88,12,0.05), transparent)' }}>
          <div className="flex items-start gap-3 mb-4">
            <span className="w-9 h-9 rounded-xl grid place-items-center text-white flex-shrink-0" style={{ backgroundColor: ACCENT }}><Sparkles size={16} /></span>
            <div>
              <p className="font-bold text-[15px]" style={{ color: 'var(--text)' }}>Turn the numbers into your next posts</p>
              <p className="text-[13px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
                MVP reads the table above plus your open brand campaigns and niche, then hands you specific next moves — amplify your best earners, re-angle high-click products that under-convert, chase your strongest campaigns. Each is one click from being made.
              </p>
            </div>
          </div>
          <button
            onClick={generate}
            disabled={aiBusy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            style={{ backgroundColor: ACCENT }}
          >
            {aiBusy ? <><Loader2 size={15} className="animate-spin" /> Thinking…</> : <><Sparkles size={15} /> Generate my next moves</>}
          </button>

          {aiError && (
            <div className="mt-4 rounded-xl border p-3 flex items-center gap-2 text-[13px]" style={{ borderColor: 'rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.06)', color: '#c0392b' }}>
              <AlertCircle size={15} /> {aiError}
            </div>
          )}

          {suggestions && suggestions.length > 0 && (
            <>
              {!grounded && (
                <p className="text-[12.5px] mt-4 mb-1" style={{ color: 'var(--text-soft)' }}>
                  No storefront earnings yet, so these are research-first starters. Once SCOUT syncs your sales, these build on your proven winners.
                </p>
              )}
              <ol className="grid grid-cols-1 gap-3 mt-4">
                {suggestions.map((s, i) => {
                  const meta = ACTION_META[s.action] ?? ACTION_META.research
                  return (
                    <li key={i} className="rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center gap-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-6 h-6 rounded-full grid place-items-center text-[12px] font-bold text-white flex-shrink-0" style={{ backgroundColor: ACCENT }}>{i + 1}</span>
                          <p className="font-semibold text-[14px] leading-snug" style={{ color: 'var(--text)' }}>{s.title}</p>
                        </div>
                        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{s.why}</p>
                      </div>
                      <Link href={meta.href(s.asin)} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white whitespace-nowrap shadow-sm transition-transform hover:-translate-y-0.5 flex-shrink-0" style={{ backgroundColor: ACCENT }}>
                        {meta.icon} {s.label} <ArrowRight size={13} />
                      </Link>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </div>
      )}

      {/* Roundup result toast (inline, not a lib) */}
      {roundupMsg && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 rounded-xl border px-4 py-3 shadow-lg flex items-center gap-3 text-[13px] max-w-[92vw]"
          style={{ borderColor: roundupMsg.ok ? 'rgba(52,199,89,0.4)' : 'rgba(255,59,48,0.4)', background: 'var(--surface)' }}
        >
          {roundupMsg.ok ? <CheckCircle2 size={16} style={{ color: GREEN }} /> : <AlertCircle size={16} style={{ color: RED }} />}
          <span style={{ color: 'var(--text)' }}>{roundupMsg.text}</span>
          {roundupMsg.ok && roundupMsg.url && (
            <a href={roundupMsg.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: ACCENT }}>View post</a>
          )}
          <button onClick={() => setRoundupMsg(null)} className="ml-1" style={{ color: 'var(--text-soft)' }}><X size={15} /></button>
        </div>
      )}

      {/* Floating roundup bar — appears once winners are picked (blog tiers only) */}
      {hasBlog && selected.size >= 1 && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-2xl border shadow-xl px-4 py-3 flex items-center gap-3 max-w-[92vw]"
          style={{ borderColor: 'rgba(234,88,12,0.35)', background: 'var(--surface)' }}
        >
          <span className="text-[13px] font-semibold inline-flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
            <Layers size={15} style={{ color: ACCENT }} /> {selected.size} selected
          </span>
          <button
            onClick={createRoundup}
            disabled={selected.size < 2 || roundupBusy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold text-white whitespace-nowrap disabled:opacity-50"
            style={{ backgroundColor: ACCENT }}
            title={selected.size < 2 ? 'Pick at least 2 products' : 'Publish a “my top picks” roundup blog post'}
          >
            {roundupBusy ? <><Loader2 size={14} className="animate-spin" /> Building…</> : <><FileText size={14} /> Publish top {selected.size} roundup</>}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-[12px] font-semibold" style={{ color: 'var(--text-soft)' }}>Clear</button>
        </div>
      )}
    </div>
  )
}
