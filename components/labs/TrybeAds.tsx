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

import { useState } from 'react'
import { Loader2, RotateCcw, TrendingUp, TrendingDown, Minus, Megaphone, PlayCircle, AlertTriangle } from 'lucide-react'
import { useTrybeAds } from '@/components/labs/useTrybeAds'
import { paceOf, adBrands, adWinners, bestVideos, notRunning, AD_PERIODS, type AdPeriod, type AdTotals } from '@/lib/trybe-ads'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'
const soft = { color: 'var(--text-3)' }

const PERIOD_LABEL: Record<AdPeriod, string> = { '7d': '7 days', '14d': '14 days', '30d': '30 days' }
const money = (n: number) => `$${n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2).replace(/\.00$/, '')}`
const count = (n: number) => n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K` : Math.round(n).toLocaleString('en-US')

type Tile = { key: keyof AdTotals; label: string; show: (t: AdTotals) => string | null; sub?: (t: AdTotals) => string | null; says: string }
const TILES: Tile[] = [
  { key: 'earned', label: 'Earned', show: (t) => (t.earned == null ? null : money(t.earned)), says: 'What TRYBE says you earned in this period.' },
  { key: 'liveAds', label: 'Live ads', show: (t) => (t.liveAds == null ? null : count(t.liveAds)), says: 'Your videos running as ads now.' },
  { key: 'impressions', label: 'Impressions', show: (t) => (t.impressions == null ? null : count(t.impressions)), says: 'Times your ads were shown.' },
  { key: 'clicks', label: 'Link clicks', show: (t) => (t.clicks == null ? null : count(t.clicks)), says: 'People who clicked through to the brand.' },
  { key: 'hookRate', label: 'Hook rate', show: (t) => (t.hookRate == null ? null : `${t.hookRate.toFixed(1)}%`), says: 'Viewers who watched past the first seconds (TRYBE calls it thumbstop rate). Your hook decides this.' },
  { key: 'ctr', label: 'Link CTR', show: (t) => (t.ctr == null ? null : `${t.ctr.toFixed(2)}%`), says: 'Clicks out of impressions.' },
  { key: 'avgWatchSec', label: 'Avg watch', show: (t) => (t.avgWatchSec == null ? null : `${t.avgWatchSec.toFixed(1)}s`), sub: (t) => (t.avgWatchPct == null ? null : `${t.avgWatchPct.toFixed(0)}% of the video`), says: 'How long people watch, on average.' },
  { key: 'spend', label: 'Ad spend', show: (t) => (t.spend == null ? null : money(t.spend)), says: 'What brands spent running your videos as ads.' },
]

export default function TrybeAds({ canRead, isAdmin, onPlan }: { canRead: boolean; isAdmin?: boolean; onPlan?: () => void }) {
  const [period, setPeriod] = useState<AdPeriod>('7d')
  const { read, week, month, problem, loading, reload, days } = useTrybeAds(canRead, period)
  if (!canRead) return null
  const t = read?.totals
  const full = read?.source === 'full'
  const pace = paceOf(week?.earned ?? null, month?.earned ?? null)
  const brands = full && read ? adBrands(read.videos) : []
  const winners = full ? adWinners(brands, days) : []
  const best = full && read ? bestVideos(read.videos) : []
  const stalled = full && read ? notRunning(read.videos, days) : []
  const nothingRead = full && t && Object.values(t).every((v) => v == null)

  return (
    <section className="rounded-xl border p-3.5 mb-4" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }} aria-label="Your ads, live">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="w-8 h-8 shrink-0 rounded-lg inline-flex items-center justify-center" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}><Megaphone size={16} /></span>
        <div className="min-w-[12rem] flex-1">
          <p className="text-[14.5px] font-bold leading-tight">Your ads, live</p>
          <p className="text-[12px]" style={soft}>What your videos do as ads on TRYBE. Read from your TRYBE just now; MVP keeps none of it.</p>
        </div>
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-2)' }} role="group" aria-label="Period">
          {AD_PERIODS.map((p) => (
            <button key={p} onClick={() => setPeriod(p)} aria-pressed={period === p} className="text-[12px] font-semibold px-2.5 py-1"
              style={period === p ? { background: PURPLE, color: '#fff' } : { color: 'var(--text-2)' }}>{PERIOD_LABEL[p]}</button>
          ))}
        </div>
        <button onClick={reload} disabled={loading} className="text-[12px] font-semibold inline-flex items-center gap-1 underline disabled:opacity-50" style={{ color: PURPLE }}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Read again
        </button>
      </div>

      {problem && (
        <p className="text-[12px] mb-3 flex items-start gap-1.5" style={{ color: problem.kind === 'old' ? AMBER : RED }}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /><span>{problem.text}{read?.source === 'earnings' && problem.kind === 'old' ? ' Until then, only what you earned is shown.' : ''}</span>
        </p>
      )}
      {loading && !read && <p className="text-[12px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading your ad results from TRYBE...</p>}

      {t && (
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

      {full && read && read.videos.length === 0 && !nothingRead && (
        <p className="text-[12px] mt-3" style={soft}>No videos ran as ads in the last {days} days. Once a brand runs one, it shows here with its hook rate and clicks.</p>
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
          <p className="text-[12px] font-bold mb-1.5">Your best videos as ads: make more like these</p>
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
                </div>
              </div>
            ))}
          </div>
        </div>
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
