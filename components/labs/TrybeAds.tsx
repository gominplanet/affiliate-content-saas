'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR ADS, LIVE, at the top of My brands (Seb, 2026-10-14, after Rob's Oink
// Suite video: "build all 4"). What your videos do as ads on TRYBE for the
// last 7, 14 or 30 days: earned (and its pace against the month), live ads,
// impressions, link clicks, hook rate, click rate and watch time; the brands
// winning on ads; and your best videos. Read fresh from your TRYBE through
// SCOUT (components/labs/useTrybeAds); MVP keeps none of it. A number TRYBE
// did not send says so. An older SCOUT shows what you earned and says what
// the update adds, so it never looks like a full read.
//
// ANALYTICS, LIKE TRYBE'S (Seb, 2026-10-19, with TRYBE's Analytics screen:
// "this is what we can get from Trybe and should also be showing inside of
// MVP"). Its own tab now, laid out as TRYBE lays it out: All or one brand,
// Total submissions (approved, pending, revision, rejected, approval rate),
// then the same tiles under TRYBE's names, then the top earning videos. One
// brand's ad numbers are added up from its own videos, and say so.
//
// THE VIDEOS BEHIND THE COUNTS (Seb, 2026-10-29: "is there a way we can
// filter and do searches to check for pending submissions, rejected ones").
// Tapping Approved, Pending, Revision or Rejected, or searching, lists those
// videos (components/labs/TrybeSubList), for All or the brand picked.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw, TrendingUp, TrendingDown, Minus, Megaphone, PlayCircle, AlertTriangle, Search } from 'lucide-react'
import { useTrybeAds } from '@/components/labs/useTrybeAds'
import { useTrybeSubmissions, useTrybeSubList } from '@/components/labs/useTrybeSubmissions'
import TrybeSubList from '@/components/labs/TrybeSubList'
import type { SubFilter } from '@/lib/trybe-sub-list'
import { paceOf, adBrands, adWinners, bestVideos, notRunning, diagnose, remixOf, whoPays, concentrationOf, concentrationWords, DIAGNOSIS_WORDS, AD_PERIODS, type AdPeriod, type AdTotals, type PayFact, type Delivery, type ZeroRead } from '@/lib/trybe-ads'
import { approvalRateOf, brandAdTotals, sameBrand, NO_COUNTS } from '@/lib/trybe-analytics'

const PURPLE = 'var(--accent)'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'
const soft = { color: 'var(--text-3)' }

const PERIOD_LABEL: Record<AdPeriod, string> = { '7d': '7 days', '14d': '14 days', '30d': '30 days' }
const money = (n: number) => `$${n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2).replace(/\.00$/, '')}`
const count = (n: number) => n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K` : Math.round(n).toLocaleString('en-US')

type Tile = { key: keyof AdTotals; label: string; show: (t: AdTotals) => string | null; sub?: (t: AdTotals) => string | null; says: string }
// TRYBE's own names and order, so the two screens read the same.
const TILES: Tile[] = [
  { key: 'earned', label: 'Total earnings', show: (t) => (t.earned == null ? null : money(t.earned)), says: 'What TRYBE says you earned in this period.' },
  { key: 'avgWatchSec', label: 'Avg watch time', show: (t) => (t.avgWatchSec == null ? null : `${t.avgWatchSec.toFixed(1)}s`), sub: (t) => (t.avgWatchPct == null ? null : `${t.avgWatchPct.toFixed(0)}% of the video`), says: 'How long people watch, on average.' },
  { key: 'liveAds', label: 'Active ads', show: (t) => (t.liveAds == null ? null : count(t.liveAds)), says: 'Your videos running as ads now.' },
  { key: 'hookRate', label: 'Hook rate', show: (t) => (t.hookRate == null ? null : `${t.hookRate.toFixed(1)}%`), says: 'Viewers who watched past the first seconds (TRYBE calls it thumbstop rate). Your hook decides this.' },
  { key: 'impressions', label: 'Impressions', show: (t) => (t.impressions == null ? null : count(t.impressions)), says: 'Times your ads were shown.' },
  { key: 'ctr', label: 'Click through', show: (t) => (t.ctr == null ? null : `${t.ctr.toFixed(2)}%`), says: 'Clicks out of impressions.' },
  { key: 'clicks', label: 'Link clicks', show: (t) => (t.clicks == null ? null : count(t.clicks)), says: 'People who clicked through to the brand.' },
  { key: 'spend', label: 'Ad spend', show: (t) => (t.spend == null ? null : money(t.spend)), says: 'What brands spent running your videos as ads.' },
]

/** Whether a brand is running your videos, and what its $0 means, as chips (lib/trybe-ads). */
const DELIVERY_CHIP: Partial<Record<Delivery, { word: string; color: string }>> = { shelved: { word: 'Barely running your videos', color: RED }, light: { word: 'Running them less', color: AMBER }, running: { word: 'Running them', color: GREEN } }
const ZERO_CHIP: Partial<Record<ZeroRead, { word: string; color: string }>> = { too_early: { word: 'Too early to judge', color: 'var(--text-3)' }, not_converting: { word: 'Clicks not buying', color: RED }, not_run: { word: 'No clicks yet', color: 'var(--text-3)' } }
function Chip({ word, color }: { word: string; color: string }) {
  return <span className="text-[10.5px] font-semibold rounded-full px-1.5 py-0.5 border whitespace-nowrap" style={{ borderColor: color, color }}>{word}</span>
}

const SUB_ROWS = [
  { key: 'approved', label: 'Approved', color: '#16A34A' },
  { key: 'pending', label: 'Pending', color: '#3B82F6' },
  { key: 'revision', label: 'Revision', color: '#EAB308' },
  { key: 'rejected', label: 'Rejected', color: '#DC2626' },
] as const

export default function TrybeAds({ canRead, isAdmin, onPlan }: { canRead: boolean; isAdmin?: boolean; onPlan?: () => void }) {
  const [period, setPeriod] = useState<AdPeriod>('7d')
  const { read, week, month, problem, loading, reload, days } = useTrybeAds(canRead, period)
  const subs = useTrybeSubmissions(canRead, period)
  // The videos list: closed until a count is tapped or a search typed.
  const [subFilter, setSubFilter] = useState<SubFilter | null>(null)
  const [subQuery, setSubQuery] = useState('')
  const listOpen = subFilter !== null || subQuery.trim() !== ''
  const subList = useTrybeSubList(subs.read, listOpen)
  // ALL OR ONE BRAND, as TRYBE's chips: the brands with a submission or an ad
  // in the period, the busiest first.
  const [brandId, setBrandId] = useState<string | null>(null)
  const chips = useMemo(() => {
    const list = (subs.read?.brands || []).map((b) => ({ id: b.id, name: b.name, logo: b.logo, n: b.counts.total + (read?.videos || []).filter((v) => sameBrand(v, b)).length }))
    return list.filter((b) => b.n > 0).sort((a, b) => b.n - a.n)
  }, [subs.read, read])
  const brand = chips.find((b) => b.id === brandId) || null
  // EACH BRAND'S ADVERTISED PAY (lib/trybe-pay, from MVP's copy of TRYBE's
  // list), to set against what it actually paid (Seb, 2026-11-20). A brand
  // MVP has no pay for says nothing, never a guess.
  const [terms, setTerms] = useState<Record<string, { text: string | null; pct: number | null }>>({})
  const termIds = useMemo(() => Array.from(new Set([...(read?.videos || []).map((x) => x.brandId), ...(subs.read?.brands || []).map((x) => x.id)].filter((x): x is string => !!x))).slice(0, 120).sort().join(','), [read, subs.read])
  useEffect(() => {
    if (!canRead || !termIds) return
    let gone = false
    const ids = termIds.split(',')
    void (async () => {
      const out: Record<string, { text: string | null; pct: number | null }> = {}
      for (let i = 0; i < ids.length; i += 60) {
        const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'browse', ids: ids.slice(i, i + 60), includeMine: true, limit: 60 }), signal: AbortSignal.timeout(30_000) }).catch(() => null)
        const d = r && r.ok ? await r.json().catch(() => null) : null
        for (const b of ((d?.brands || []) as Array<{ brand_id: string; pay_text?: string | null; pay_est?: { short?: string | null; percent?: number | null } | null }>)) {
          const pct = typeof b.pay_est?.percent === 'number' ? b.pay_est.percent : null
          out[b.brand_id] = { text: pct != null ? `${pct}% of GMV` : (b.pay_text || b.pay_est?.short || null), pct }
        }
      }
      if (!gone) setTerms(out)
    })()
    return () => { gone = true }
  }, [canRead, termIds])
  if (!canRead) return null
  const full = read?.source === 'full'
  const one = brand && read ? brandAdTotals(read.videos, brand) : null
  // One brand's earnings are what TRYBE says it paid in the period, not only
  // what its ad videos add up to (a flat fee has no ad row).
  const oneEarned = brand ? subs.read?.brands.find((b) => b.id === brand.id)?.earned ?? null : null
  const t = one ? { ...one.totals, earned: oneEarned ?? one.totals.earned } : read?.totals
  const shownVideos = one ? one.videos : (read?.videos || [])
  const pace = brand ? null : paceOf(week?.earned ?? null, month?.earned ?? null)
  const brands = full && read && !brand ? adBrands(read.videos) : []
  const winners = full ? adWinners(brands, days) : []
  const best = full ? bestVideos(shownVideos) : []
  const stalled = full && read && !brand ? notRunning(read.videos, days) : []
  const remix = full && read && !brand ? remixOf(read.videos) : null
  // WHO ACTUALLY PAYS YOU (lib/trybe-ads whoPays): TRYBE's approved count and
  // earnings per brand for the window, each brand's advertised pay, and its
  // ads; ranked by dollars per approved video. All brands only.
  const facts: PayFact[] = (() => {
    const out: PayFact[] = (subs.read?.brands || []).map((s) => ({ brand: s.name, brandId: s.id, approved: s.read ? s?.counts.approved ?? null : null, earned: s.earned ?? null, advertised: terms[s.id]?.text ?? null, advertisedPct: terms[s.id]?.pct ?? null }))
    for (const b of brands) if (b.brandId && !out.some((f) => f.brandId === b.brandId) && terms[b.brandId]) out.push({ brand: b.brand, brandId: b.brandId, advertised: terms[b.brandId].text, advertisedPct: terms[b.brandId].pct })
    return out
  })()
  const payRows = full && read && !brand ? whoPays(brands, facts).rows.filter((r) => r.earned > 0 || (r.approved ?? 0) > 0 || r.adVideos > 0).slice(0, 15) : []
  const conc = full && read && !brand ? concentrationOf(read.videos) : null
  const nothingRead = full && !brand && t && Object.values(t).every((v) => v == null)
  // All: TRYBE's own totals when its analytics answer carried them; one
  // brand: that brand's totals for the period (useTrybeSubmissions).
  const oneSubs = brand && subs.read ? subs.read.brands.find((b) => b.id === brand.id) ?? null : null
  const counts = subs.read
    ? (brand ? (oneSubs?.counts ?? { ...NO_COUNTS }) : subs.read.all)
    : { ...NO_COUNTS }
  // One brand whose list could not be read is "not read", never 0.
  const oneUnread = !!brand && (!oneSubs || !oneSubs.read)
  const rate = approvalRateOf(counts)

  return (
    <section className="rounded-xl border p-3.5 mb-4" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }} aria-label="Analytics">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="w-8 h-8 shrink-0 rounded-lg inline-flex items-center justify-center" style={{ background: 'rgb(var(--brand-rgb) / 0.12)', color: PURPLE }}><Megaphone size={16} /></span>
        <div className="min-w-[12rem] flex-1">
          <p className="text-[14.5px] font-bold leading-tight">Analytics</p>
          <p className="text-[12px]" style={soft}>Your submissions and how your videos do as ads, the same numbers as TRYBE&rsquo;s Analytics. Read from your TRYBE just now; MVP keeps none of it.</p>
        </div>
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-2)' }} role="group" aria-label="Period">
          {AD_PERIODS.map((p) => (
            <button key={p} onClick={() => setPeriod(p)} aria-pressed={period === p} className="text-[12px] font-semibold px-2.5 py-1"
              style={period === p ? { background: PURPLE, color: '#fff' } : { color: 'var(--text-2)' }}>{PERIOD_LABEL[p]}</button>
          ))}
        </div>
        <button onClick={() => { reload(); subs.reload(); if (listOpen) subList.reload() }} disabled={loading || subs.loading} className="text-[12px] font-semibold inline-flex items-center gap-1 underline disabled:opacity-50" style={{ color: PURPLE }}>
          {loading || subs.loading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Read again
        </button>
      </div>

      {chips.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3" role="group" aria-label="Brand">
          {[{ id: null as string | null, name: 'All', logo: null as string | null }, ...chips].map((b) => {
            const on = (b.id ?? null) === (brand?.id ?? null)
            return (
              <button key={b.id ?? 'all'} onClick={() => setBrandId(b.id)} aria-pressed={on}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold"
                style={on ? { borderColor: PURPLE, background: 'rgb(var(--brand-rgb) / 0.10)', color: PURPLE } : { borderColor: 'var(--border-2)', color: 'var(--text-2)' }}>
                {b.logo && <img src={b.logo} alt="" className="w-4 h-4 rounded-full object-cover" referrerPolicy="no-referrer" />}
                {b.name}
              </button>
            )
          })}
        </div>
      )}

      {/* TOTAL SUBMISSIONS, as TRYBE splits them, with its approval rate. */}
      <div className="rounded-lg px-3 py-2.5 mb-3" style={{ background: 'var(--surface-2)' }}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider" style={soft}>Total submissions{brand ? `, ${brand.name}` : ''}</p>
            {subs.read && !oneUnread
              ? <p className="text-[24px] font-extrabold tabular-nums leading-tight">{counts.total}</p>
              : <p className="text-[13px] font-semibold" style={soft}>{subs.loading ? 'Reading...' : 'not read'}</p>}
            {subs.read && !oneUnread && <p className="text-[11.5px]" style={soft}>Approval rate (approved out of all sent): <b style={{ color: rate ? GREEN : 'var(--text-2)' }}>{rate == null ? 'none yet' : `${Math.round(rate * 100)}%`}</b></p>}
          </div>
          {subs.read && !oneUnread && (
            <ul className="flex flex-wrap gap-x-5 gap-y-1">
              {SUB_ROWS.map((r) => (
                <li key={r.key}>
                  <button type="button" onClick={() => setSubFilter(subFilter === r.key ? null : r.key)} aria-pressed={subFilter === r.key} title={`See your ${r.label.toLowerCase()} videos`}
                    className="inline-flex items-center gap-1.5 text-[12.5px] rounded-md px-1 -mx-1" style={subFilter === r.key ? { background: 'rgb(var(--brand-rgb) / 0.12)' } : undefined}>
                    <span className="w-1 h-4 rounded-full" style={{ background: r.color }} />
                    <b className="tabular-nums">{counts[r.key]}</b><span className="underline decoration-dotted underline-offset-2" style={soft}>{r.label}</span>
                  </button>
                </li>
              ))}
              {counts.other > 0 && <li className="text-[12px]" style={soft}>{counts.other} with a status MVP could not place</li>}
            </ul>
          )}
        </div>
        {subs.error && <p className="text-[12px] mt-1.5" style={{ color: RED }}>{subs.error}</p>}
        {subs.read && (subs.read.partial ?? 0) > 0 && (
          <p className="text-[12px] mt-1.5" style={soft}>{subs.read.partial} brand{subs.read.partial === 1 ? '' : 's'} counted in the total but not split by status: MVP reads 25 brand lists at a time.</p>
        )}
        {subs.read && subs.read.notRead > 0 && (
          <p className="text-[12px] mt-1.5" style={{ color: AMBER }}>{subs.read.notRead} brand{subs.read.notRead === 1 ? '' : 's'} could not be read, so these counts may be low. Press Read again.</p>
        )}
        {subs.read && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[12rem] max-w-sm">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={soft} />
              <input type="search" value={subQuery} onChange={(e) => setSubQuery(e.target.value)} placeholder="Search your videos: product, brand, or what the brand wrote"
                className="w-full rounded-lg border pl-8 pr-3 py-1.5 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            </div>
            {!listOpen && <button type="button" onClick={() => setSubFilter('all')} className="text-[12px] font-semibold underline" style={{ color: PURPLE }}>See all your videos</button>}
          </div>
        )}
        {isAdmin && subs.read && (
          <p className="text-[11px] mt-1.5" style={soft}>Counted from {subs.read.source === 'analytics' ? 'TRYBE\u2019s analytics totals' : subs.read.source === 'brand totals' ? 'your brand totals for the period' : 'each brand\u2019s submissions list'}. What TRYBE sent: {subs.read.keys}</p>
        )}
      </div>

      {listOpen && (
        <TrybeSubList state={subList.state} filter={subFilter ?? 'all'} setFilter={setSubFilter} query={subQuery}
          brandId={brand?.id ?? null} brandName={brand?.name ?? null} days={days} onClose={() => { setSubFilter(null); setSubQuery('') }} />
      )}

      {problem && (
        <p className="text-[12px] mb-3 flex items-start gap-1.5" style={{ color: problem.kind === 'old' ? AMBER : RED }}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /><span>{problem.text}{read?.source === 'earnings' && problem.kind === 'old' ? ' Until then, only what you earned is shown.' : ''}</span>
        </p>
      )}
      {loading && !read && <p className="text-[12px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading your ad results from TRYBE...</p>}

      {brand && one && (
        <p className="text-[12px] mb-2" style={soft}>
          {one.videos.length
            ? `${brand.name}: added up from your ${one.videos.length} video${one.videos.length === 1 ? '' : 's'} with them in the last ${days} days.`
            : `None of your ${brand.name} videos ran as ads in the last ${days} days.`}
        </p>
      )}
      {t && (!one || one.videos.length > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TILES.filter((x) => full || x.key === 'earned').map((x) => {
            const v = x.show(t)
            const sub = x.sub?.(t)
            return (
              <div key={x.key} className="rounded-lg px-2.5 py-2" style={{ background: 'var(--surface-2)' }} title={x.says}>
                <p className="text-[10.5px] font-bold uppercase tracking-wider" style={soft}>{x.label}</p>
                <p className="text-[18px] font-extrabold tabular-nums leading-tight" style={v == null ? { color: 'var(--text-3)', fontSize: 13, fontWeight: 600 } : undefined}>{v ?? 'not sent'}</p>
                {x.key === 'earned' && pace && (
                  <p className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: pace.dir === 'up' ? GREEN : pace.dir === 'down' ? RED : 'var(--text-3)' }}
                    title="Earned a day in the last 7 days, against a day in the last 30.">
                    {pace.dir === 'up' ? <TrendingUp size={11} /> : pace.dir === 'down' ? <TrendingDown size={11} /> : <Minus size={11} />}
                    {pace.dir === 'steady' ? 'Steady' : `${pace.pct > 0 ? '+' : ''}${pace.pct}%`} this week vs the month
                  </p>
                )}
                {sub && <p className="text-[11px]" style={soft}>{sub}</p>}
              </div>
            )
          })}
        </div>
      )}
      {nothingRead && (
        <p className="text-[12px] mt-2" style={{ color: AMBER }}>
          TRYBE answered, but with none of the numbers MVP knows. Nothing is shown as zero.{isAdmin && read?.keys ? ` What it sent: ${read.keys}` : ''}
        </p>
      )}

      {full && read && read.videos.length === 0 && !nothingRead && read.videosRead !== false && (
        <p className="text-[12px] mt-3" style={soft}>No videos ran as ads in the last {days} days. Once a brand runs one, it shows here with its hook rate and clicks.</p>
      )}
      {full && read && read.videosRead === false && (
        <p className="text-[12px] mt-3" style={{ color: AMBER }}>MVP could not read your ad videos from TRYBE just now, so they are not listed here{read.videosWhy ? ` (${read.videosWhy})` : ''}. The totals above did read. Press Read again.</p>
      )}
      {full && read && read.totalsRead === false && read.videosRead !== false && (
        <p className="text-[12px] mt-1.5" style={{ color: AMBER }}>TRYBE&rsquo;s totals did not answer, so the numbers above are added up from up to 100 of your videos and may be low.</p>
      )}

      {/* WHO ACTUALLY PAYS YOU (Seb, 2026-11-20): how few videos made the money,
          then each brand's dollars per approved video, whether it is running
          the videos, what a $0 means yet, and its advertised rate against
          what it paid, every verdict in its own numbers. */}
      {(conc || payRows.length > 0) && (
        <div className="mb-3 rounded-lg border p-3" style={{ borderColor: 'var(--border-2)' }} aria-label="Who actually pays you">
          <p className="text-[13.5px] font-bold">Who actually pays you</p>
          {conc && <p className="text-[13px] mt-1 font-semibold" style={{ color: 'var(--text)' }}>{concentrationWords(conc)}</p>}
          {payRows.length > 0 && (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-[12.5px] tabular-nums">
                <thead>
                  <tr className="text-left" style={soft}>
                    <th className="font-semibold py-1 pr-3">Brand</th>
                    <th className="font-semibold py-1 pr-3">Earned</th>
                    <th className="font-semibold py-1 pr-3">Per video</th>
                    <th className="font-semibold py-1 pr-3">Impressions per ad</th>
                    <th className="font-semibold py-1">Advertised</th>
                  </tr>
                </thead>
                <tbody>
                  {payRows.map((r) => (
                    <tr key={r.brandId || r.brand} className="border-t align-top" style={{ borderColor: 'var(--border-2)' }}>
                      <td className="py-1.5 pr-3">
                        <span className="font-semibold" style={{ color: 'var(--text)' }}>{r.brand}</span>
                        <span className="flex flex-wrap gap-1 mt-0.5">{DELIVERY_CHIP[r.delivery] && <Chip {...DELIVERY_CHIP[r.delivery]!} />}{r.zero && ZERO_CHIP[r.zero] && <Chip {...ZERO_CHIP[r.zero]!} />}</span>
                        {r.says.length > 0 && <span className="block mt-1 text-[12px] max-w-[60ch]" style={{ color: 'var(--text-2)' }}>{r.says.join(' ')}</span>}
                      </td>
                      <td className="py-1.5 pr-3" style={{ color: r.earned > 0 ? GREEN : 'var(--text-2)' }}>${r.earned.toFixed(2)}</td>
                      <td className="py-1.5 pr-3">{r.perVideo == null ? <span style={soft}>Not known</span> : <><b style={{ color: 'var(--text)' }}>${r.perVideo.toFixed(2)}</b><span className="block text-[11px]" style={soft}>{r.perBasis === 'approved' ? `per approved video (${r.approved})` : `per video with ad results (${r.adVideos})`}</span></>}</td>
                      <td className="py-1.5 pr-3">{r.perAd == null ? <span style={soft}>Not sent</span> : <>{Math.round(r.perAd).toLocaleString('en-US')}<span className="block text-[11px]" style={soft}>{r.activeAds} active ad{r.activeAds === 1 ? '' : 's'}</span></>}</td>
                      <td className="py-1.5" style={{ color: r.gap ? RED : 'var(--text-2)' }}>{r.advertised ?? <span style={soft}>Not listed</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11.5px] mt-2" style={soft}>Per video divides what TRYBE says each brand paid you in {PERIOD_LABEL[period]} by its approved videos when TRYBE gave the count, else by your videos with ad results. Impressions per ad and every verdict compare with your own typical brand, never a fixed number.</p>
        </div>
      )}

      {winners.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-bold mb-1">Winning on ads: double down here</p>
          <ul className="space-y-1">
            {winners.map((w) => (
              <li key={w.brand} className="text-[12.5px] flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold" style={{ color: GREEN }}>{w.brand}</span><span style={soft}>{w.why}</span>
              </li>
            ))}
          </ul>
          {onPlan && <button onClick={onPlan} className="text-[12px] font-semibold underline mt-1" style={{ color: PURPLE }}>Plan more videos for them in This week</button>}
        </div>
      )}

      {stalled.length > 0 && (
        <div className="mt-3 rounded-lg px-2.5 py-2" style={{ background: 'rgba(180,83,9,0.08)' }}>
          <p className="text-[12px] font-bold mb-1" style={{ color: AMBER }}>Didn&rsquo;t run? Move on</p>
          <ul className="space-y-0.5">
            {stalled.slice(0, 4).map((x) => <li key={x.brand} className="text-[12.5px]" style={{ color: 'var(--text-2)' }}>{x.says}</li>)}
          </ul>
        </div>
      )}

      {best.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-bold mb-1.5">Top earning{brand ? `, ${brand.name}` : ''}: make more like these</p>
          <div className="space-y-1.5">
            {best.map((v) => (
              <div key={v.id} className="flex items-center gap-2.5">
                {v.thumbnail
                  ? <img src={v.thumbnail} alt="" className="w-9 h-12 rounded object-cover shrink-0" loading="lazy" referrerPolicy="no-referrer" />
                  : <span className="w-9 h-12 rounded shrink-0 inline-flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}><PlayCircle size={14} /></span>}
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold truncate">{v.title || 'A video'}{v.brand ? <span className="font-normal" style={soft}> · {v.brand}</span> : null}</p>
                  <p className="text-[11.5px] tabular-nums flex flex-wrap gap-x-2.5" style={{ color: 'var(--text-2)' }}>
                    {v.earned != null && <span>{money(v.earned)} earned</span>}
                    {v.hookRate != null && <span>hook {v.hookRate.toFixed(1)}%</span>}
                    {v.ctr != null && <span>CTR {v.ctr.toFixed(2)}%</span>}
                    {v.avgWatchSec != null && <span>watch {v.avgWatchSec.toFixed(1)}s</span>}
                    {v.live && <span className="font-semibold" style={{ color: GREEN }}>live</span>}
                  </p>
                  {(() => {
                    const dg = diagnose(v)
                    if (!dg) return null
                    const w = DIAGNOSIS_WORDS[dg]
                    const tone = dg === 'winner' ? GREEN : dg === 'early' ? 'var(--text-3)' : AMBER
                    return <p className="text-[11.5px]" title={w.fix}><span className="font-semibold" style={{ color: tone }}>{w.label}.</span> <span style={soft}>{w.fix}</span></p>
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {remix && (
        <p className="text-[12.5px] mt-2 rounded-lg px-2.5 py-1.5" style={{ background: 'rgb(var(--brand-rgb) / 0.07)' }}>
          <b style={{ color: PURPLE }}>Try this remix.</b> {remix.says.replace(/^Remix: /, '')}
        </p>
      )}

      {read?.source === 'earnings' && read.videos.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-bold mb-1">Earned by brand, last {days} days</p>
          <ul className="space-y-0.5">
            {read.videos.slice(0, 8).map((v) => <li key={v.id} className="text-[12.5px] tabular-nums"><span className="font-semibold">{v.brand}</span> <span style={soft}>{money(v.earned ?? 0)}</span></li>)}
          </ul>
        </div>
      )}
    </section>
  )
}
