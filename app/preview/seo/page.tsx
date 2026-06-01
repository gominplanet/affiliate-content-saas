/**
 * /preview/seo — SEO hub redesign. Theme-aware via CSS variables.
 */
'use client'

import { useState } from 'react'
import {
  TrendingUp, AlertCircle, CheckCircle2, Search,
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
          <h1 className="text-[28px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>SEO</h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--text-subtle)' }}>
            Per-post scoring, Google indexing status, and one-click fixes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 rounded-lg border text-[12px] inline-flex items-center gap-1.5 transition-colors"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-bright)', color: 'var(--text)' }}
          >
            <RefreshCw size={11} /> Re-check all
          </button>
          <button className="px-3.5 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-[13px] font-medium text-white inline-flex items-center gap-1.5 transition-colors">
            <Wand2 size={13} /> Fix {totalFixable} issues
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={<TrendingUp size={14} />} label="Avg score" value="84" delta="+3 pts" deltaLabel="vs last week" positive />
        <StatTile icon={<CheckCircle2 size={14} />} label="Indexed" value={`${indexedCount}/${ROWS.length}`} delta="+2" deltaLabel="this week" positive />
        <StatTile icon={<Search size={14} />} label="Clicks (30d)" value="243" delta="+18%" deltaLabel="vs prior 30d" positive />
        <StatTile icon={<AlertCircle size={14} />} label="Fixable issues" value={totalFixable.toString()} delta="across 5 posts" deltaLabel="" warn />
      </section>

      <div
        className="rounded-xl border px-4 py-3 flex items-center gap-3"
        style={{
          backgroundColor: 'rgba(245, 158, 11, 0.10)',
          borderColor: 'rgba(245, 158, 11, 0.3)',
        }}
      >
        <AlertCircle size={14} className="text-[#F59E0B] flex-shrink-0" />
        <p className="text-[13px] flex-1" style={{ color: 'var(--text)' }}>
          <span className="font-semibold">Hydro Flask vs YETI</span> hasn&apos;t been picked up by Google yet (7 days old). Submit it to IndexNow + check the sitemap?
        </p>
        <button
          className="text-[12px] font-medium px-2.5 py-1 rounded"
          style={{ backgroundColor: 'var(--surface-bright)', color: 'var(--text)' }}
        >
          Submit now
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search posts by title"
            className="pl-8 pr-3 py-2 rounded-lg border text-[13px] focus:outline-none w-72"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-bright)', color: 'var(--text)' }}
          />
        </div>
        <p className="text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
          {filtered.length} of {ROWS.length} posts
        </p>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
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
      className="rounded-2xl px-5 py-5 border transition-colors"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <div className="flex items-center gap-2 mb-3" style={{ color: 'var(--text-subtle)' }}>
        {icon}
        <span className="text-[11px] uppercase tracking-[0.12em]">{label}</span>
      </div>
      <p className="text-[32px] font-semibold tracking-tight tabular-nums leading-none" style={{ color: 'var(--text)' }}>{value}</p>
      <div className="flex items-center gap-1.5 mt-3">
        <span className="text-[11px] font-medium tabular-nums" style={{ color: deltaColor }}>{delta}</span>
        {deltaLabel && <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{deltaLabel}</span>}
      </div>
    </div>
  )
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] ${className}`}
      style={{ color: 'var(--text-faint)' }}
    >
      {children}
    </th>
  )
}

function SeoRowTr({ row }: { row: SeoRow }) {
  const scoreColor = row.score >= 90 ? '#10B981' : row.score >= 75 ? '#F59E0B' : '#F43F5E'
  return (
    <tr
      className="border-b last:border-0 transition-colors"
      style={{ borderColor: 'var(--border)' }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <td className="px-3 py-3 max-w-md">
        <a href="#" className="text-[13px] line-clamp-1 hover:text-[#9D6BFF]" style={{ color: 'var(--text)' }}>
          {row.title}
        </a>
      </td>
      <td className="px-3 py-3">
        <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-soft)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SITE_COLORS[row.site] }} />
          {row.site}
        </span>
      </td>
      <td className="px-3 py-3">
        <span className="text-[14px] font-semibold tabular-nums" style={{ color: scoreColor }}>{row.score}</span>
      </td>
      <td className="px-3 py-3"><IndexedPill state={row.indexed} /></td>
      <td className="px-3 py-3 text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{row.clicks}</td>
      <td className="px-3 py-3 text-[12px] tabular-nums" style={{ color: 'var(--text-soft)' }}>{row.impressions.toLocaleString()}</td>
      <td className="px-3 py-3 text-[12px] tabular-nums" style={{ color: 'var(--text-soft)' }}>{row.position?.toFixed(1) ?? '—'}</td>
      <td className="px-3 py-3">
        {row.fixable > 0 ? (
          <button className="text-[11px] font-medium text-[#7C3AED] inline-flex items-center gap-1">
            <Sparkles size={10} /> Fix {row.fixable}
          </button>
        ) : (
          <a href="#" className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
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
