/**
 * /preview/dashboard — the home view in the new aesthetic.
 *
 * Theme: all colors reference CSS variables set by app/preview/layout.tsx,
 * so the same JSX renders correctly in both dark and light mode.
 */
'use client'

import { useState } from 'react'
import {
  FileText, Eye, DollarSign, BarChart3, Sparkles, ArrowUpRight,
  PenLine, Image as ImageIcon, Calendar, Scale, Wand2,
  CheckCircle2, AlertCircle, ExternalLink,
} from 'lucide-react'

export default function DashboardPreviewPage() {
  const [prompt, setPrompt] = useState('')

  return (
    <>
      {/* Hero banner */}
      <header className="relative overflow-hidden border-b" style={{ borderColor: 'var(--border)' }}>
        <div
          className="absolute inset-0"
          style={{
            opacity: 'var(--hero-opacity)',
            background: `
              radial-gradient(60% 80% at 15% 20%, rgba(124, 58, 237, 0.45), transparent 60%),
              radial-gradient(50% 70% at 85% 10%, rgba(192, 38, 211, 0.35), transparent 65%),
              radial-gradient(80% 60% at 50% 90%, rgba(99, 102, 241, 0.2), transparent 70%)
            `,
          }}
        />
        <div className="relative px-8 pt-12 pb-10">
          <p
            className="text-xs uppercase tracking-[0.18em] mb-3"
            style={{ color: 'var(--text-subtle)' }}
          >
            Saturday, June 1
          </p>
          <h1
            className="text-[40px] leading-[1.1] font-semibold tracking-tight"
            style={{ color: 'var(--text)' }}
          >
            Welcome back, Sebastien.
          </h1>
          <p className="text-[15px] mt-2" style={{ color: 'var(--text-subtle)' }}>
            3 sites connected · Pro plan · 42 posts this month
          </p>
        </div>
      </header>

      <main className="px-8 py-10 flex flex-col gap-10">
        {/* AI prompt strip */}
        <section className="-mt-4">
          <div className="relative">
            <Sparkles
              size={16}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7C3AED]"
            />
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What do you want to work on today?"
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl border text-[15px] focus:outline-none transition-colors"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border-bright)',
                color: 'var(--text)',
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <ActionChip icon={<PenLine size={13} />} label="Generate post" />
            <ActionChip icon={<ImageIcon size={13} />} label="Make thumbnail" />
            <ActionChip icon={<Scale size={13} />} label="Compare products" />
            <ActionChip icon={<Calendar size={13} />} label="Schedule social" />
            <ActionChip icon={<Wand2 size={13} />} label="Refresh images" />
          </div>
        </section>

        {/* Smart suggestion */}
        <section>
          <div
            className="rounded-2xl border px-5 py-4 flex items-start gap-3"
            style={{
              backgroundColor: 'rgba(124, 58, 237, 0.08)',
              borderColor: 'rgba(124, 58, 237, 0.25)',
            }}
          >
            <Sparkles size={16} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px]" style={{ color: 'var(--text)' }}>
                You have <span className="font-semibold">2 unprocessed videos</span> from this week, and your
                <span className="font-semibold"> &quot;YETI Cooler Review&quot;</span> is missing in-article images.
              </p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-subtle)' }}>
                Process all three in one click — fully automated, ~3 minutes total.
              </p>
            </div>
            <button
              className="px-3 py-1.5 rounded-lg border text-[12px] font-medium inline-flex items-center gap-1 transition-colors"
              style={{
                backgroundColor: 'var(--surface-bright)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            >
              Run all <ArrowUpRight size={11} />
            </button>
          </div>
        </section>

        {/* Stat tiles */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile icon={<FileText size={14} />} label="Posts this month" value="42" delta="+8" deltaLabel="vs last month" />
          <StatTile icon={<Eye size={14} />} label="Views (30d)" value="12,847" delta="+24%" deltaLabel="vs last month" />
          <StatTile icon={<DollarSign size={14} />} label="Earnings" value="$1,284" delta="+12.4%" deltaLabel="vs last month" />
          <StatTile icon={<BarChart3 size={14} />} label="Avg SEO score" value="89" delta="+3" deltaLabel="pts vs last week" />
        </section>

        {/* Wins + Needs attention */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 size={15} className="text-[#10B981]" />
              <h2 className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Today&apos;s wins</h2>
            </div>
            <ul className="flex flex-col gap-3">
              <WinRow text="“Best Electric Dirt Bike” crossed 1,000 views" meta="Up from 850 yesterday · +18%" />
              <WinRow text="“YETI Cooler Review” indexed by Google" meta="3 days after publish · 12 impressions" />
              <WinRow text="“MilePop1 3000W” featured on Pinterest" meta="42 saves · 8 outbound clicks" />
            </ul>
          </Card>
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle size={15} className="text-[#F59E0B]" />
              <h2 className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Needs attention</h2>
            </div>
            <ul className="flex flex-col gap-3">
              <AttentionRow text="Wine Reviews — last publish failed" cta="Run doctor" href="/preview/setup" />
              <AttentionRow text="2 videos waiting to be turned into posts" cta="Generate now" href="/preview/library" />
              <AttentionRow text="Newsletter draft from May 26 — not sent" cta="Open" href="/preview/newsletter" />
            </ul>
          </Card>
        </section>

        {/* Recent posts */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Recent posts</h2>
            <a
              href="/preview/library"
              className="text-[12px] inline-flex items-center gap-1 transition-colors"
              style={{ color: 'var(--text-subtle)' }}
            >
              View all <ArrowUpRight size={11} />
            </a>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <PostCard title="MilePop1 Electric Dirt Bike Review — 3000W Off-Road Beast Tested" site="Main" siteColor="#7C3AED" views={1284} daysAgo={2} gradient="from-orange-500/40 to-rose-500/30" />
            <PostCard title="YETI Tundra 45 Cooler — A 5-Day Field Test in the Rockies" site="Outdoor" siteColor="#10B981" views={847} daysAgo={5} gradient="from-emerald-500/40 to-cyan-500/30" />
            <PostCard title="Yaheetech 10×10 Pop Up Canopy Tent — Fastest Outdoor Setup?" site="Outdoor" siteColor="#10B981" views={612} daysAgo={7} gradient="from-sky-500/40 to-indigo-500/30" />
          </div>
        </section>
      </main>
    </>
  )
}

function ActionChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] transition-colors"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        color: 'var(--text-muted)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
        e.currentTarget.style.color = 'var(--text)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--surface)'
        e.currentTarget.style.color = 'var(--text-muted)'
      }}
    >
      {icon}
      {label}
    </button>
  )
}

function StatTile({ icon, label, value, delta, deltaLabel }: { icon: React.ReactNode; label: string; value: string; delta: string; deltaLabel: string }) {
  const isPositive = delta.startsWith('+')
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
      <p
        className="text-[32px] font-semibold tracking-tight tabular-nums leading-none"
        style={{ color: 'var(--text)' }}
      >
        {value}
      </p>
      <div className="flex items-center gap-1.5 mt-3">
        <span
          className="text-[11px] font-medium tabular-nums"
          style={{ color: isPositive ? '#10B981' : '#F43F5E' }}
        >
          {delta}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{deltaLabel}</span>
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl px-5 py-5 border"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      {children}
    </div>
  )
}

function WinRow({ text, meta }: { text: string; meta: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] mt-2 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] leading-snug" style={{ color: 'var(--text)' }}>{text}</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>{meta}</p>
      </div>
    </li>
  )
}

function AttentionRow({ text, cta, href }: { text: string; cta: string; href: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] mt-2 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] leading-snug" style={{ color: 'var(--text)' }}>{text}</p>
      </div>
      <a href={href} className="text-[12px] font-medium text-[#7C3AED] hover:text-[#9D6BFF] inline-flex items-center gap-1 flex-shrink-0">
        {cta} <ArrowUpRight size={11} />
      </a>
    </li>
  )
}

function PostCard({ title, site, siteColor, views, daysAgo, gradient }: { title: string; site: string; siteColor: string; views: number; daysAgo: number; gradient: string }) {
  return (
    <a
      href="#"
      className="group block rounded-2xl overflow-hidden border transition-all duration-200 hover:-translate-y-0.5"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <div className={`aspect-video bg-gradient-to-br ${gradient} relative`}>
        <div
          className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider text-white"
          style={{ backgroundColor: `${siteColor}33`, border: `1px solid ${siteColor}55` }}
        >
          {site}
        </div>
      </div>
      <div className="p-4">
        <p className="text-[13px] font-medium leading-snug line-clamp-2 mb-2" style={{ color: 'var(--text)' }}>{title}</p>
        <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          <Eye size={11} />
          <span className="tabular-nums">{views.toLocaleString()}</span>
          <span>·</span>
          <span>{daysAgo}d ago</span>
          <ExternalLink size={10} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </a>
  )
}
