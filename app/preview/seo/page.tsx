/**
 * /preview/seo — SEO hub redesign.
 *
 * Three stacked sections:
 *   1. Aggregate stats — overall health at a glance
 *   2. Recently dropped — the most urgent thing to act on
 *   3. Per-post table — every published post with score, indexed state, clicks
 *
 * Filter by site (Pro multi-site). Click any row → opens post detail with
 * AI fix suggestions inline. "Fix all" sweeps every fixable issue across
 * every post (using the existing seo/fix-all engine).
 */
'use client'

import { useState } from 'react'
import {
  TrendingUp, AlertCircle, CheckCircle2, Search, ArrowUpRight,
  Sparkles, Wand2, ExternalLink, RefreshCw,
} from 'lucide-react'

interface SeoRow {
  postId: string
  title: string
  site: 'Main' | 'Outdoor' | 'Wine Reviews'
  score: number
  indexed: 'indexed' | 'not_indexed' | 'unknown'
  clicks: number
  impressions: number
  position: number | null
  fixable: number
}

const ROWS: SeoRow[] = [
  { postId: '1', title: 'MilePop1 Electric Dirt Bike Review — 3000W Off-Road Beast Tested', site: 'Main', score: 92, indexed: 'indexed', clicks: 48, impressions: 1284, position: 4.2, fixable: 0 },
  { postId: '2', title: 'YETI Tundra 45 Cooler — A 5-Day Field Test in the Rockies', site: 'Outdoor', score: 89, indexed: 'indexed', clicks: 31, impressions: 847, position: 5.8, fixable: 1 },
  { postId: '3', title: 'Bose QuietComfort Ultra Headphones — Honest 60-Day Review', site: 'Main', score: 95, indexed: 'indexed', clicks: 124, impressions: 1944, position: 2.1, fixable: 0 },
  { postId: '5', title: 'Coleman Sundome Tent — Surviving a Rainstorm in Yosemite', site: 'Outdoor', score: 78, indexed: 'not_indexed', clicks: 0, impressions: 0, position: null, fixable: 3 },
  { postId: '6', title: 'Yaheetech 10×10 Pop Up Canopy Tent — Fastest Outdoor Setup?', site: 'Outdoor', score: 84, indexed: 'indexed', clicks: 22, impressions: 612, position: 8.4, fixable: 2 },
  { postId: '7', title: 'Decoy Pinot Noir 2021 — Mid-Tier Wine, Premium Taste?', site: 'Wine Reviews', score: 81, indexed: 'indexed', clicks: 18, impressions: 287, position: 12.3, fixable: 1 },
  { postId: '8', title: 'Hydro Flask 32oz vs YETI Rambler 30oz — Which Wins?', site: 'Outdoor', score: 72, indexed: 'unknown', clicks: 0, impressions: 0, position: null, fixable: 4 },
]

const SITE_COLORS: Record<SeoRow['site'], string> = {
  Main: '#7C3AED',
  Outdoor: '#10B981',
  'Wine Reviews': '#F43F5E',
}

export default function SeoPreviewPage() {
  const [query, setQuery] = useState('')
  const filtered = ROWS.filter(r => query === '' || r.title.toLowerCase().includes(query.toLowerCase()))
  const totalFixable = ROWS.reduce((s, r) => s + r.fixable, 0)
  const indexedCount = ROWS.filter(r => r.indexed === 'indexed').length

  return (
    <main className="px-8 py-10 flex flex-col gap-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-white">SEO</h1>
          <p className="text-[13px] text-white/55 mt-1">Per-post scoring, Google indexing status, and one-click fixes.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] text-[12px] text-white inline-flex items-center gap-1.5 transition-colors">
            <RefreshCw size={11} /> Re-check all
          </button>
          <button className="px-3.5 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-[13px] font-medium text-white inline-flex items-center gap-1.5 transition-colors">
            <Wand2 size={13} /> Fix {totalFixable} issues
          </button>
        </div>
      </header>

      {/* Aggregate stats */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={<TrendingUp size={14} />} label="Avg score" value="84" delta="+3 pts" deltaLabel="vs last week" positive />
        <StatTile icon={<CheckCircle2 size={14} />} label="Indexed" value={`${indexedCount}/${ROWS.length}`} delta="+2" deltaLabel="this week" positive />
        <StatTile icon={<Search size={14} />} label="Clicks (30d)" value="243" delta="+18%" deltaLabel="vs prior 30d" positive />
        <StatTile icon={<AlertCircle size={14} />} label="Fixable issues" value={totalFixable.toString()} delta="across 5 posts" deltaLabel="" warn />
      </section>

      {/* Smart suggestion / alert */}
      <div className="rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/25 px-4 py-3 flex items-center gap-3">
        <AlertCircle size={14} className="text-[#F59E0B] flex-shrink-0" />
        <p className="text-[13px] text-white flex-1">
          <span className="font-semibold">Hydro Flask vs YETI</span> hasn&apos;t been picked up by Google yet (7 days old). Submit it to IndexNow + check the sitemap?
        </p>
        <button className="text-[12px] font-medium text-white/85 hover:text-white px-2.5 py-1 rounded bg-white/[0.06] hover:bg-white/[0.1]">
          Submit now
        </button>
      </div>

      {/* Search + filter */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search posts by title"
            className="pl-8 pr-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[13px] text-white placeholder:text-white/35 focus:outline-none focus:border-[#7C3AED]/50 w-72"
          />
        </div>
        <p className="text-[11px] text-white/40 tabular-nums">
          {filtered.length} of {ROWS.length} posts
        </p>
      </div>

      {/* Table */}
      <div
        className="rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden"
        style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.2)' }}
      >
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <Th>Title</Th>
              <Th className="w-28">Site</Th>
              <Th className="w-16">Score</Th>
              <Th className="w-28">Indexed</Th>
              <Th className="w-20">Clicks</Th>
              <Th className="w-24">Impr.</Th>
              <Th className="w-20">Pos.</Th>
              <Th className="w-32">Action</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <SeoRowTr key={r.postId} row={r} />
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}

function StatTile({ icon, label, value, delta, deltaLabel, positive, warn }: { icon: React.ReactNode; label: string; value: string; delta: string; deltaLabel: string; positive?: boolean; warn?: boolean }) {
  const deltaColor = warn ? '#F59E0B' : positive ? '#10B981' : '#F43F5E'
  return (
    <div
      className="rounded-2xl px-5 py-5 bg-white/[0.03] border border-white/[0.06] transition-colors hover:bg-white/[0.05]"
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.2)' }}
    >
      <div className="flex items-center gap-2 text-white/50 mb-3">
        {icon}
        <span className="text-[11px] uppercase tracking-[0.12em]">{label}</span>
      </div>
      <p className="text-[32px] font-semibold tracking-tight text-white tabular-nums leading-none">{value}</p>
      <div className="flex items-center gap-1.5 mt-3">
        <span className="text-[11px] font-medium tabular-nums" style={{ color: deltaColor }}>{delta}</span>
        {deltaLabel && <span className="text-[11px] text-white/45">{deltaLabel}</span>}
      </div>
    </div>
  )
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-white/40 ${className}`}>
      {children}
    </th>
  )
}

function SeoRowTr({ row }: { row: SeoRow }) {
  const scoreColor = row.score >= 90 ? '#10B981' : row.score >= 75 ? '#F59E0B' : '#F43F5E'
  return (
    <tr className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.025] transition-colors">
      <td className="px-3 py-3 max-w-md">
        <a href="#" className="text-[13px] text-white hover:text-[#9D6BFF] line-clamp-1">
          {row.title}
        </a>
      </td>
      <td className="px-3 py-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-white/70">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SITE_COLORS[row.site] }} />
          {row.site}
        </span>
      </td>
      <td className="px-3 py-3">
        <span className="text-[14px] font-semibold tabular-nums" style={{ color: scoreColor }}>{row.score}</span>
      </td>
      <td className="px-3 py-3">
        <IndexedPill state={row.indexed} />
      </td>
      <td className="px-3 py-3 text-[12px] text-white/80 tabular-nums">{row.clicks}</td>
      <td className="px-3 py-3 text-[12px] text-white/60 tabular-nums">{row.impressions.toLocaleString()}</td>
      <td className="px-3 py-3 text-[12px] text-white/60 tabular-nums">{row.position?.toFixed(1) ?? '—'}</td>
      <td className="px-3 py-3">
        {row.fixable > 0 ? (
          <button className="text-[11px] font-medium text-[#7C3AED] hover:text-[#9D6BFF] inline-flex items-center gap-1">
            <Sparkles size={10} /> Fix {row.fixable}
          </button>
        ) : (
          <a href="#" className="text-[11px] text-white/45 hover:text-white inline-flex items-center gap-1">
            View <ExternalLink size={10} />
          </a>
        )}
      </td>
    </tr>
  )
}

function IndexedPill({ state }: { state: SeoRow['indexed'] }) {
  const config = {
    indexed: { color: '#10B981', label: 'Indexed' },
    not_indexed: { color: '#F43F5E', label: 'Not indexed' },
    unknown: { color: '#F59E0B', label: 'Unknown' },
  }[state]
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: config.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: config.color }} />
      {config.label}
    </span>
  )
}
