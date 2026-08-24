// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// StorefrontCharts — the visual layer for the AMZ Storefront dashboard. Six
// inline-SVG charts (no chart lib, theme-aware via CSS text/border tokens),
// each answering one question about the SCOUT-synced earnings:
//   1. Earnings trend        — am I growing? (line/area over periods)
//   2. Top earners           — which products carry me? (horizontal bars)
//   3. Conversion vs clicks  — what to fix/amplify? (bubble scatter)
//   4. Earnings concentration— how dependent on a few winners? (Pareto)
//   5. Biggest movers        — what changed this period? (diverging bars)
//   6. Revenue mix           — where does revenue come from? (ranked share)
//
// Color: single-hue orange for magnitude; a green/red diverging pair (with
// +/- signs, so identity is never color-alone) for movers. Text always wears
// theme ink tokens, never the mark color.
'use client'

import { useState } from 'react'

const ACCENT = '#C2410C'
const GREEN = '#15803d'
const RED = '#b91c1c'

interface SeriesPoint { start: string; earnings: number; revenue: number; units: number; clicks: number; conversion: number; epc: number }
interface Product {
  asin: string; title: string; earnings: number; revenue: number; units: number; clicks: number
  conversion: number; epc: number; earningsDelta: number | null; category?: string | null
}
interface Props {
  period: 'weekly' | 'monthly' | 'ytd'
  series: SeriesPoint[]
  products: Product[]
}

// ── formatting ───────────────────────────────────────────────────────────────
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const usdShort = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`)
const int = (n: number) => n.toLocaleString('en-US')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function periodLabel(period: 'weekly' | 'monthly' | 'ytd', start: string): string {
  if (period === 'ytd') return start.slice(0, 4)
  const [y, m, d] = start.split('-').map(Number)
  if (period === 'monthly') return `${MONTHS[(m || 1) - 1]} ${String(y).slice(2)}`
  return `${MONTHS[(m || 1) - 1]} ${d}`
}
const short = (s: string, n = 22) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// ── shared card ──────────────────────────────────────────────────────────────
function ChartCard({ title, hint, children, wide }: { title: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${wide ? 'lg:col-span-2' : ''}`} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="mb-3">
        <p className="font-bold text-[13.5px]" style={{ color: 'var(--text)' }}>{title}</p>
        {hint && <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-soft)' }}>{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div className="h-[180px] grid place-items-center text-[12px] text-center px-4" style={{ color: 'var(--text-soft)' }}>{msg}</div>
}

// ── 1. Earnings trend (area + line) ──────────────────────────────────────────
function EarningsTrend({ period, series }: { period: 'weekly' | 'monthly' | 'ytd'; series: SeriesPoint[] }) {
  if (series.length < 2) return <Empty msg="Your earnings trend appears once you have two or more synced periods. Keep SCOUT syncing and this fills in next period." />
  const W = 640, H = 200, padL = 44, padR = 16, padT = 14, padB = 26
  const max = Math.max(...series.map(s => s.earnings), 1)
  const x = (i: number) => padL + (i / (series.length - 1)) * (W - padL - padR)
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB)
  const line = series.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(s.earnings).toFixed(1)}`).join(' ')
  const area = `${line} L${x(series.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L${x(0).toFixed(1)},${(H - padB).toFixed(1)} Z`
  const ticks = [0, 0.5, 1].map(f => ({ v: max * f, y: y(max * f) }))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }} role="img" aria-label="Earnings by period">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={t.y} y2={t.y} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 6} y={t.y + 3} textAnchor="end" fontSize="9.5" fill="var(--text-soft)">{usdShort(t.v)}</text>
        </g>
      ))}
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.28" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#trendFill)" />
      <path d={line} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {series.map((s, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(s.earnings)} r="3.5" fill={ACCENT} stroke="var(--surface)" strokeWidth="2">
            <title>{periodLabel(period, s.start)}: {usd(s.earnings)}</title>
          </circle>
          <text x={x(i)} y={H - padB + 14} textAnchor="middle" fontSize="9.5" fill="var(--text-soft)">{periodLabel(period, s.start)}</text>
        </g>
      ))}
    </svg>
  )
}

// ── 2. Top earners (horizontal bars) ─────────────────────────────────────────
function TopEarners({ products }: { products: Product[] }) {
  const rows = [...products].sort((a, b) => b.earnings - a.earnings).slice(0, 8)
  if (!rows.length) return <Empty msg="No products yet." />
  const max = Math.max(...rows.map(r => r.earnings), 1)
  const barH = 22, gap = 8, W = 640, labelW = 150
  const H = rows.length * (barH + gap)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }} role="img" aria-label="Top earning products">
      {rows.map((r, i) => {
        const y = i * (barH + gap)
        const w = Math.max(2, (r.earnings / max) * (W - labelW - 60))
        return (
          <g key={r.asin}>
            <text x={0} y={y + barH / 2 + 3.5} fontSize="11" fill="var(--text)">{short(r.title, 20)}</text>
            <rect x={labelW} y={y} width={w} height={barH} rx="4" fill={ACCENT}>
              <title>{r.title}: {usd(r.earnings)}</title>
            </rect>
            <text x={labelW + w + 6} y={y + barH / 2 + 3.5} fontSize="10.5" fontWeight="600" fill="var(--text-soft)">{usd(r.earnings)}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── 3. Conversion vs clicks (bubble scatter) ─────────────────────────────────
function ConversionScatter({ products }: { products: Product[] }) {
  const pts = products.filter(p => p.clicks > 0)
  if (pts.length < 2) return <Empty msg="Needs a couple of products with clicks to plot." />
  const W = 640, H = 240, padL = 40, padR = 20, padT = 16, padB = 30
  const maxClicks = Math.max(...pts.map(p => p.clicks), 1)
  const maxConv = Math.max(...pts.map(p => p.conversion), 1)
  const maxE = Math.max(...pts.map(p => p.earnings), 1)
  const x = (v: number) => padL + (v / maxClicks) * (W - padL - padR)
  const y = (v: number) => padT + (1 - v / maxConv) * (H - padT - padB)
  const r = (e: number) => 4 + Math.sqrt(e / maxE) * 12
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }} role="img" aria-label="Conversion versus clicks by product">
      <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="var(--border)" strokeWidth="1" />
      <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke="var(--border)" strokeWidth="1" />
      <text x={(W) / 2} y={H - 4} textAnchor="middle" fontSize="9.5" fill="var(--text-soft)">Clicks →</text>
      <text x={10} y={padT + 4} fontSize="9.5" fill="var(--text-soft)">Conv. %</text>
      {pts.map(p => (
        <circle key={p.asin} cx={x(p.clicks)} cy={y(p.conversion)} r={r(p.earnings)} fill={ACCENT} fillOpacity="0.55" stroke={ACCENT} strokeWidth="1">
          <title>{`${p.title}\n${int(p.clicks)} clicks · ${p.conversion}% conv · ${usd(p.earnings)}`}</title>
        </circle>
      ))}
      <text x={W - padR} y={padT + 4} textAnchor="end" fontSize="9" fill="var(--text-soft)">bubble = earnings</text>
    </svg>
  )
}

// ── 4. Earnings concentration (Pareto, single % axis) ────────────────────────
function Concentration({ products }: { products: Product[] }) {
  const rows = [...products].filter(p => p.earnings > 0).sort((a, b) => b.earnings - a.earnings).slice(0, 10)
  const total = rows.reduce((s, r) => s + r.earnings, 0)
  if (total <= 0) return <Empty msg="No earnings to break down yet." />
  const W = 640, H = 200, padL = 34, padR = 16, padT = 14, padB = 26
  const bw = (W - padL - padR) / rows.length
  const y = (pct: number) => padT + (1 - pct / 100) * (H - padT - padB)
  let cum = 0
  const cumPts = rows.map((r, i) => { cum += (r.earnings / total) * 100; return { x: padL + i * bw + bw / 2, y: y(cum), cum } })
  const cumLine = cumPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }} role="img" aria-label="Earnings concentration by product">
      {[0, 50, 100].map(p => (
        <g key={p}>
          <line x1={padL} x2={W - padR} y1={y(p)} y2={y(p)} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 5} y={y(p) + 3} textAnchor="end" fontSize="9" fill="var(--text-soft)">{p}%</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const share = (r.earnings / total) * 100
        const bh = (share / 100) * (H - padT - padB)
        return (
          <rect key={r.asin} x={padL + i * bw + 2} y={H - padB - bh} width={bw - 4} height={bh} rx="3" fill={ACCENT} fillOpacity="0.35">
            <title>{r.title}: {usd(r.earnings)} ({share.toFixed(0)}% of top-10)</title>
          </rect>
        )
      })}
      <path d={cumLine} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" />
      {cumPts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill={ACCENT} stroke="var(--surface)" strokeWidth="1.5"><title>Top {i + 1}: {p.cum.toFixed(0)}% cumulative</title></circle>
      ))}
    </svg>
  )
}

// ── 5. Biggest movers (diverging bars) ───────────────────────────────────────
function Movers({ products }: { products: Product[] }) {
  const withDelta = products.filter(p => p.earningsDelta != null && p.earningsDelta !== 0) as (Product & { earningsDelta: number })[]
  if (!withDelta.length) return <Empty msg="Movers appear once you have a prior period to compare against." />
  const up = [...withDelta].filter(p => p.earningsDelta > 0).sort((a, b) => b.earningsDelta - a.earningsDelta).slice(0, 4)
  const down = [...withDelta].filter(p => p.earningsDelta < 0).sort((a, b) => a.earningsDelta - b.earningsDelta).slice(0, 4)
  const rows = [...up, ...down]
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.earningsDelta)), 1)
  const W = 640, barH = 20, gap = 9, mid = 300, half = 250
  const H = rows.length * (barH + gap)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }} role="img" aria-label="Biggest earnings movers this period">
      <line x1={mid} x2={mid} y1={0} y2={H} stroke="var(--border)" strokeWidth="1" />
      {rows.map((r, i) => {
        const yv = i * (barH + gap)
        const w = (Math.abs(r.earningsDelta) / maxAbs) * half
        const gain = r.earningsDelta > 0
        return (
          <g key={r.asin}>
            <rect x={gain ? mid : mid - w} y={yv} width={Math.max(2, w)} height={barH} rx="4" fill={gain ? GREEN : RED} fillOpacity="0.85">
              <title>{r.title}: {gain ? '+' : '−'}{usd(Math.abs(r.earningsDelta))} vs last period</title>
            </rect>
            <text x={gain ? mid + w + 6 : mid - w - 6} y={yv + barH / 2 + 3.5} textAnchor={gain ? 'start' : 'end'} fontSize="10" fontWeight="600" fill={gain ? GREEN : RED}>
              {gain ? '+' : '−'}{usdShort(Math.abs(r.earningsDelta))}
            </text>
            <text x={gain ? mid - 8 : mid + 8} y={yv + barH / 2 + 3.5} textAnchor={gain ? 'end' : 'start'} fontSize="10.5" fill="var(--text)">{short(r.title, 20)}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Ranked-share bar + legend (single-hue ramp + neutral "Other") ────────────
function ShareBar({ segs, otherLabel = 'Other', emptyMsg }: { segs: { label: string; val: number }[]; otherLabel?: string; emptyMsg: string }) {
  const total = segs.reduce((s, r) => s + r.val, 0)
  if (total <= 0) return <Empty msg={emptyMsg} />
  const isNeutral = (label: string) => label === otherLabel || label === 'Uncategorized'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex w-full h-7 rounded-lg overflow-hidden" style={{ gap: '2px' }}>
        {segs.map((s, i) => (
          <div key={i} title={`${s.label}: ${usd(s.val)} (${((s.val / total) * 100).toFixed(0)}%)`}
            style={{ width: `${(s.val / total) * 100}%`, background: isNeutral(s.label) ? 'var(--text-soft)' : ACCENT, opacity: isNeutral(s.label) ? 0.25 : 1 - (i * 0.12) }} />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
        {segs.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5 text-[11.5px] min-w-0" style={{ color: 'var(--text-soft)' }}>
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: isNeutral(s.label) ? 'var(--text-soft)' : ACCENT, opacity: isNeutral(s.label) ? 0.25 : 1 - (i * 0.12) }} />
            <span className="truncate" style={{ color: 'var(--text)' }}>{short(s.label, 24)}</span>
            <span className="ml-auto flex-shrink-0">{((s.val / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── 6. Revenue mix by product (ranked share) ─────────────────────────────────
function RevenueMix({ products }: { products: Product[] }) {
  const rows = [...products].filter(p => p.revenue > 0).sort((a, b) => b.revenue - a.revenue)
  const top = rows.slice(0, 6)
  const otherVal = rows.slice(6).reduce((s, r) => s + r.revenue, 0)
  const segs = [...top.map(r => ({ label: r.title, val: r.revenue })), ...(otherVal > 0 ? [{ label: 'Other', val: otherVal }] : [])]
  return <ShareBar segs={segs} emptyMsg="No revenue to break down yet." />
}

// ── 7. Revenue by category (ranked share) ────────────────────────────────────
function RevenueByCategory({ products }: { products: Product[] }) {
  const byCat = new Map<string, number>()
  for (const p of products) {
    if (p.revenue <= 0) continue
    const cat = (p.category && p.category.trim()) || 'Uncategorized'
    byCat.set(cat, (byCat.get(cat) ?? 0) + p.revenue)
  }
  const enriched = [...byCat.entries()].filter(([c]) => c !== 'Uncategorized').length
  if (enriched === 0) return <Empty msg="Category data is still syncing — this fills in over the next few loads as your products get categorized." />
  const rows = [...byCat.entries()].map(([label, val]) => ({ label, val })).sort((a, b) => b.val - a.val)
  const top = rows.filter(r => r.label !== 'Uncategorized').slice(0, 6)
  const rest = rows.filter(r => r.label !== 'Uncategorized').slice(6).reduce((s, r) => s + r.val, 0)
  const uncat = byCat.get('Uncategorized') ?? 0
  const segs = [
    ...top,
    ...(rest > 0 ? [{ label: 'Other', val: rest }] : []),
    ...(uncat > 0 ? [{ label: 'Uncategorized', val: uncat }] : []),
  ]
  return <ShareBar segs={segs} emptyMsg="No revenue to break down yet." />
}

export default function StorefrontCharts({ period, series, products }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-8">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border mb-3 transition-colors"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
      >
        <span className="font-bold text-[14px]">Charts &amp; visuals</span>
        <span className="text-[12px]" style={{ color: ACCENT }}>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <>
        {/* How to read these — plain-English guide so the charts are useful, not
            decorative. */}
        <div className="rounded-2xl border p-4 sm:p-5 mb-3" style={{ borderColor: 'rgba(234,88,12,0.25)', background: 'linear-gradient(180deg, rgba(234,88,12,0.05), transparent)' }}>
          <p className="font-bold text-[13.5px] mb-2" style={{ color: 'var(--text)' }}>How to read these</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
            <li><b style={{ color: 'var(--text)' }}>Earnings trend</b> — your earnings per period over time. Line going up = you're growing. The single "am I winning?" chart.</li>
            <li><b style={{ color: 'var(--text)' }}>Top earners</b> — the products that actually pay you, biggest first. Post more of what's at the top.</li>
            <li><b style={{ color: 'var(--text)' }}>Conversion vs clicks</b> — each bubble is a product (size = earnings). Far right + low = lots of clicks but few buy → change the angle or creative. High up = converts well; if it's also small, push more traffic to it.</li>
            <li><b style={{ color: 'var(--text)' }}>Earnings concentration</b> — the line shows what % of earnings your top few products make. A line that shoots up fast = you're reliant on 2–3 winners (risky if one dies).</li>
            <li><b style={{ color: 'var(--text)' }}>Biggest movers</b> — what changed most vs last period. Green = grew, red = dropped. Chase the greens, check why the reds fell.</li>
            <li><b style={{ color: 'var(--text)' }}>Revenue mix / by category</b> — where your sales volume comes from, by product and by category. Shows if you're a one-category shop or spread out.</li>
          </ul>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ChartCard wide title="Earnings trend" hint="Your earnings per period. The headline: are you growing?">
            <EarningsTrend period={period} series={series} />
          </ChartCard>
          <ChartCard title="Top earners" hint="Which products carry your storefront.">
            <TopEarners products={products} />
          </ChartCard>
          <ChartCard title="Conversion vs clicks" hint="Top-left = high traffic, low conversion → re-angle it. Bubble size = earnings.">
            <ConversionScatter products={products} />
          </ChartCard>
          <ChartCard title="Earnings concentration" hint="How much of your earnings ride on the top few products.">
            <Concentration products={products} />
          </ChartCard>
          <ChartCard title="Biggest movers" hint="Largest earnings changes vs the prior period.">
            <Movers products={products} />
          </ChartCard>
          <ChartCard title="Revenue mix" hint="Where your revenue comes from, by product.">
            <RevenueMix products={products} />
          </ChartCard>
          <ChartCard title="Revenue by category" hint="Which categories drive your sales — one-category shop, or spread out?">
            <RevenueByCategory products={products} />
          </ChartCard>
        </div>
        </>
      )}
    </div>
  )
}
