/**
 * Dashboard redesign preview — "Apple Creator Studio + Anthropic AI-first" blend.
 *
 * This is a STATIC visual mockup, no live data. Drop into the URL bar
 * at /preview/dashboard to compare side-by-side with the real dashboard.
 *
 * Lives outside the (dashboard) layout group on purpose so the existing
 * Sidebar/Header don't fight the new aesthetic. Once approved, the
 * components here move into the real dashboard and this file gets deleted.
 *
 * Design notes:
 *   - Warm dark surface (#0E0E11) — not pure black, feels less harsh
 *   - Glass cards with inner highlights — depth without skeuomorphism
 *   - 32–48px display numbers in tabular-nums — calm, premium
 *   - One AI prompt at top — Anthropic touch, sets the "ask, don't navigate" tone
 *   - Smart suggestion cards lower down — the assistant proactively offers next actions
 *   - No vidIQ-loud gradients on every card; gradients reserved for hero banner only
 */
'use client'

import { useState } from 'react'
import {
  FileText, Eye, DollarSign, BarChart3, Sparkles, ArrowUpRight,
  PenLine, Image as ImageIcon, Calendar, Scale, Wand2,
  CheckCircle2, AlertCircle, ExternalLink,
  // Sidebar nav icons:
  Home, Youtube, Library, MessageSquare, Mail, Palette, Brush,
  TrendingUp, Settings, CreditCard, Bot, ChevronsLeft, ChevronsRight,
  Bell, ChevronDown,
} from 'lucide-react'

export default function DashboardPreviewPage() {
  const [prompt, setPrompt] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [activeSite, setActiveSite] = useState('Main')

  return (
    <div className="min-h-screen bg-[#0E0E11] text-[#F5F5F7] font-[Inter,system-ui,sans-serif] flex">
      {/* ── Sidebar (left rail) ──────────────────────────────────────────
          Glass-treated nav. Grouped into 4 sections so the 11-item list
          doesn't feel like a soup. Collapsible to icon-only (Linear-style).
          Active state: thin violet bar on the left + slightly brighter row. */}
      <aside
        className={`${collapsed ? 'w-[68px]' : 'w-[232px]'} flex-shrink-0 border-r border-white/[0.06] bg-[#0B0B0E] flex flex-col transition-[width] duration-200`}
      >
        {/* Brand + collapse */}
        <div className="px-4 pt-5 pb-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#7C3AED] to-[#C026D3] flex items-center justify-center font-semibold text-white text-[13px]">M</span>
            {!collapsed && <span className="font-semibold text-white text-[14px] tracking-tight">MVP Affiliate</span>}
          </a>
          {!collapsed && (
            <button onClick={() => setCollapsed(true)} className="text-white/30 hover:text-white/70">
              <ChevronsLeft size={14} />
            </button>
          )}
        </div>

        {collapsed && (
          <button onClick={() => setCollapsed(false)} className="mx-auto mb-3 text-white/30 hover:text-white/70">
            <ChevronsRight size={14} />
          </button>
        )}

        {/* Nav groups */}
        <nav className="flex-1 px-2 flex flex-col gap-5 overflow-y-auto">
          <NavGroup label="Today" collapsed={collapsed}>
            <NavItem icon={<Home size={15} />} label="Dashboard" active collapsed={collapsed} />
          </NavGroup>

          <NavGroup label="Create" collapsed={collapsed}>
            <NavItem icon={<Youtube size={15} />} label="YouTube Co-Pilot" collapsed={collapsed} />
            <NavItem icon={<PenLine size={15} />} label="Script writer" collapsed={collapsed} />
            <NavItem icon={<Scale size={15} />} label="Compare & Guides" collapsed={collapsed} />
            <NavItem icon={<Mail size={15} />} label="Newsletter" collapsed={collapsed} />
          </NavGroup>

          <NavGroup label="Manage" collapsed={collapsed}>
            <NavItem icon={<Library size={15} />} label="Library" badge={42} collapsed={collapsed} />
            <NavItem icon={<Calendar size={15} />} label="Scheduled" badge={3} collapsed={collapsed} />
            <NavItem icon={<Palette size={15} />} label="Brand Profile" collapsed={collapsed} />
            <NavItem icon={<Brush size={15} />} label="Customize Blog" collapsed={collapsed} />
          </NavGroup>

          <NavGroup label="Measure" collapsed={collapsed}>
            <NavItem icon={<TrendingUp size={15} />} label="SEO" collapsed={collapsed} />
          </NavGroup>

          <NavGroup label="Settings" collapsed={collapsed}>
            <NavItem icon={<Settings size={15} />} label="Site & Integrations" collapsed={collapsed} />
            <NavItem icon={<Bot size={15} />} label="Assistant" collapsed={collapsed} />
            <NavItem icon={<CreditCard size={15} />} label="Billing" collapsed={collapsed} />
          </NavGroup>
        </nav>

        {/* User chip at bottom */}
        <div className="border-t border-white/[0.06] p-3">
          <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] cursor-pointer transition-colors ${collapsed ? 'justify-center' : ''}`}>
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-[12px] font-semibold text-white">S</div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-white truncate">Sebastien</p>
                  <p className="text-[10px] text-white/45 truncate">Pro plan</p>
                </div>
                <ChevronDown size={12} className="text-white/30" />
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar: site picker (multi-site) + notifications + ⌘K hint */}
        <div className="border-b border-white/[0.06] px-8 py-3 flex items-center gap-3 bg-[#0E0E11]/80 backdrop-blur-md sticky top-0 z-10">
          {/* Multi-site picker */}
          <div className="relative">
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] text-[12px] text-white transition-colors">
              <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
              {activeSite}
              <ChevronDown size={11} className="text-white/40" />
            </button>
          </div>
          <button onClick={() => setActiveSite(activeSite === 'Main' ? 'Outdoor' : activeSite === 'Outdoor' ? 'Wine Reviews' : 'Main')} className="text-[11px] text-white/40 hover:text-white/70 transition-colors">
            (click to swap sites — demo)
          </button>

          {/* ⌘K hint pushed right */}
          <div className="ml-auto flex items-center gap-3">
            <button className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] text-[11px] text-white/60 inline-flex items-center gap-2 transition-colors">
              <Sparkles size={11} className="text-[#7C3AED]" />
              Ask anything
              <kbd className="px-1 py-0.5 rounded text-[9px] bg-white/[0.06] border border-white/[0.08] font-mono text-white/40">⌘K</kbd>
            </button>
            <button className="relative p-1.5 rounded-lg hover:bg-white/[0.06] text-white/60 hover:text-white transition-colors">
              <Bell size={14} />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
            </button>
          </div>
        </div>

        {/* Hero banner */}
        <header className="relative overflow-hidden border-b border-white/[0.06]">
          <div
            className="absolute inset-0 opacity-[0.35]"
            style={{
              background: `
                radial-gradient(60% 80% at 15% 20%, rgba(124, 58, 237, 0.45), transparent 60%),
                radial-gradient(50% 70% at 85% 10%, rgba(192, 38, 211, 0.35), transparent 65%),
                radial-gradient(80% 60% at 50% 90%, rgba(99, 102, 241, 0.2), transparent 70%)
              `,
            }}
          />
          <div className="relative px-8 pt-12 pb-10">
            <p className="text-xs uppercase tracking-[0.18em] text-white/50 mb-3">
              Saturday, June 1
            </p>
            <h1 className="text-[40px] leading-[1.1] font-semibold tracking-tight text-white">
              Welcome back, Sebastien.
            </h1>
            <p className="text-[15px] text-white/60 mt-2">
              3 sites connected · Pro plan · 42 posts this month
            </p>
          </div>
        </header>

        <main className="px-8 py-10 flex flex-col gap-10">
        {/* ── AI prompt strip ──────────────────────────────────────────────
            Anthropic touch — leads with "ask, don't navigate". The input
            doesn't have to ACTUALLY do anything in the live version; it can
            simply route to /assistant with the prompt prefilled. Below the
            input: quick-action chips that cover the 80% of common tasks. */}
        <section className="-mt-4">
          <div className="relative">
            <Sparkles size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7C3AED]" />
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What do you want to work on today?"
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-[15px] text-white placeholder:text-white/40 focus:outline-none focus:border-[#7C3AED]/50 focus:bg-white/[0.06] transition-colors"
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

        {/* ── Smart suggestion card — Anthropic-style "the assistant noticed
            something" prompt. Quiet, single line, one CTA. Renders only
            when there's a clear next action. */}
        <section>
          <div className="rounded-2xl bg-gradient-to-r from-[#7C3AED]/10 to-[#C026D3]/5 border border-[#7C3AED]/20 px-5 py-4 flex items-start gap-3">
            <Sparkles size={16} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] text-white">
                You have <span className="font-semibold">2 unprocessed videos</span> from this week, and your
                <span className="font-semibold"> &quot;YETI Cooler Review&quot;</span> is missing in-article images.
              </p>
              <p className="text-[12px] text-white/55 mt-1">
                Process all three in one click — fully automated, ~3 minutes total.
              </p>
            </div>
            <button className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.08] text-[12px] font-medium text-white inline-flex items-center gap-1 transition-colors">
              Run all <ArrowUpRight size={11} />
            </button>
          </div>
        </section>

        {/* ── Stat tiles ──────────────────────────────────────────────────
            Four glass cards in a 4-col grid. Each: muted icon top-left,
            big number, label, growth pill. Tabular-nums for vertical
            alignment of the digits. */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile
            icon={<FileText size={14} />}
            label="Posts this month"
            value="42"
            delta="+8"
            deltaLabel="vs last month"
          />
          <StatTile
            icon={<Eye size={14} />}
            label="Views (30d)"
            value="12,847"
            delta="+24%"
            deltaLabel="vs last month"
          />
          <StatTile
            icon={<DollarSign size={14} />}
            label="Earnings"
            value="$1,284"
            delta="+12.4%"
            deltaLabel="vs last month"
          />
          <StatTile
            icon={<BarChart3 size={14} />}
            label="Avg SEO score"
            value="89"
            delta="+3"
            deltaLabel="pts vs last week"
          />
        </section>

        {/* ── Two-column: today's wins + needs attention. Both quiet, both
            useful — wins celebrate, action items nudge. */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Today's wins */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 size={15} className="text-[#10B981]" />
              <h2 className="text-[13px] font-semibold tracking-tight text-white">Today&apos;s wins</h2>
            </div>
            <ul className="flex flex-col gap-3">
              <WinRow
                text="“Best Electric Dirt Bike” crossed 1,000 views"
                meta="Up from 850 yesterday · +18%"
              />
              <WinRow
                text="“YETI Cooler Review” indexed by Google"
                meta="3 days after publish · 12 impressions"
              />
              <WinRow
                text="“MilePop1 3000W” featured on Pinterest"
                meta="42 saves · 8 outbound clicks"
              />
            </ul>
          </Card>

          {/* Needs attention */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle size={15} className="text-[#F59E0B]" />
              <h2 className="text-[13px] font-semibold tracking-tight text-white">Needs attention</h2>
            </div>
            <ul className="flex flex-col gap-3">
              <AttentionRow
                text="Wine Reviews — last publish failed"
                cta="Run doctor"
                href="/setup/wp-doctor"
              />
              <AttentionRow
                text="2 videos waiting to be turned into posts"
                cta="Generate now"
                href="/content"
              />
              <AttentionRow
                text="Newsletter draft from May 26 — not sent"
                cta="Open"
                href="/newsletter"
              />
            </ul>
          </Card>
        </section>

        {/* ── Recent posts grid ───────────────────────────────────────────
            Three-up. Each card: cover image (gradient placeholder for
            mock), site chip, title, view count, days-ago. Hover lifts. */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-semibold tracking-tight text-white">Recent posts</h2>
            <a href="/content" className="text-[12px] text-white/60 hover:text-white inline-flex items-center gap-1">
              View all <ArrowUpRight size={11} />
            </a>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <PostCard
              title="MilePop1 Electric Dirt Bike Review — 3000W Off-Road Beast Tested"
              site="Main"
              siteColor="#7C3AED"
              views={1284}
              daysAgo={2}
              gradient="from-orange-500/40 to-rose-500/30"
            />
            <PostCard
              title="YETI Tundra 45 Cooler — A 5-Day Field Test in the Rockies"
              site="Outdoor"
              siteColor="#10B981"
              views={847}
              daysAgo={5}
              gradient="from-emerald-500/40 to-cyan-500/30"
            />
            <PostCard
              title="Yaheetech 10×10 Pop Up Canopy Tent — Fastest Outdoor Setup?"
              site="Outdoor"
              siteColor="#10B981"
              views={612}
              daysAgo={7}
              gradient="from-sky-500/40 to-indigo-500/30"
            />
          </div>
        </section>

        {/* ── Footer / signal — Anthropic AI-rail collapsed-state preview.
            In the real version this could be a persistent right side rail
            that expands on click to show conversation history with the
            assistant. For the mock, just a quiet reminder it exists. */}
        <section className="mt-6 pb-12">
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-5 py-4 flex items-center gap-3">
            <Sparkles size={14} className="text-[#7C3AED]" />
            <p className="text-[12px] text-white/60 flex-1">
              Need help thinking through anything? The MVP assistant is one keyboard shortcut away — press <kbd className="px-1.5 py-0.5 rounded text-[10px] bg-white/[0.08] border border-white/[0.12] font-mono text-white/70">⌘ K</kbd>.
            </p>
          </div>
        </section>
        </main>
      </div>
    </div>
  )
}

/** Sidebar nav group header — quiet uppercase label above each cluster.
 *  When collapsed to icon-only mode, the label hides and just the items
 *  show, separated by a tiny gap. */
function NavGroup({
  label,
  collapsed,
  children,
}: {
  label: string
  collapsed: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      {!collapsed && (
        <p className="px-2.5 mb-1.5 text-[10px] uppercase tracking-[0.15em] font-medium text-white/35">
          {label}
        </p>
      )}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

/** Sidebar nav item — single row with icon + label + optional count badge.
 *  Active state: violet 2px bar on the left + slightly brighter text.
 *  Collapsed mode: tooltip-on-hover would belong here in the live version. */
function NavItem({
  icon,
  label,
  badge,
  active,
  collapsed,
}: {
  icon: React.ReactNode
  label: string
  badge?: number
  active?: boolean
  collapsed: boolean
}) {
  return (
    <a
      href="#"
      title={collapsed ? label : undefined}
      className={`relative flex items-center gap-2.5 ${collapsed ? 'justify-center' : 'px-2.5'} py-1.5 rounded-lg text-[13px] transition-colors ${
        active
          ? 'bg-white/[0.06] text-white'
          : 'text-white/55 hover:text-white hover:bg-white/[0.04]'
      }`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r bg-[#7C3AED]" />}
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && badge !== undefined && (
        <span className="text-[10px] tabular-nums text-white/40 px-1.5 py-0.5 rounded bg-white/[0.06]">{badge}</span>
      )}
    </a>
  )
}

/** Single quick-action chip below the AI prompt. Stays muted so the
 *  prompt itself remains the primary action. */
function ActionChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-[12px] text-white/80 hover:text-white transition-colors">
      {icon}
      {label}
    </button>
  )
}

/** Glass stat card with inner highlight + outer shadow — the "depth"
 *  signature of the Apple Creator Studio direction. */
function StatTile({
  icon,
  label,
  value,
  delta,
  deltaLabel,
}: {
  icon: React.ReactNode
  label: string
  value: string
  delta: string
  deltaLabel: string
}) {
  const isPositive = delta.startsWith('+')
  return (
    <div
      className="rounded-2xl px-5 py-5 bg-white/[0.03] border border-white/[0.06] transition-colors hover:bg-white/[0.05]"
      style={{
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.2)',
      }}
    >
      <div className="flex items-center gap-2 text-white/50 mb-3">
        {icon}
        <span className="text-[11px] uppercase tracking-[0.12em]">{label}</span>
      </div>
      <p className="text-[32px] font-semibold tracking-tight text-white tabular-nums leading-none">
        {value}
      </p>
      <div className="flex items-center gap-1.5 mt-3">
        <span className={`text-[11px] font-medium tabular-nums ${isPositive ? 'text-[#10B981]' : 'text-[#F43F5E]'}`}>
          {delta}
        </span>
        <span className="text-[11px] text-white/45">{deltaLabel}</span>
      </div>
    </div>
  )
}

/** Generic card wrapper — same depth treatment as StatTile but with
 *  padding tuned for content lists. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl px-5 py-5 bg-white/[0.03] border border-white/[0.06]"
      style={{
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.2)',
      }}
    >
      {children}
    </div>
  )
}

/** One row in the "Today's wins" card. Calm green dot, text, meta below. */
function WinRow({ text, meta }: { text: string; meta: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] mt-2 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-white leading-snug">{text}</p>
        <p className="text-[11px] text-white/45 mt-0.5">{meta}</p>
      </div>
    </li>
  )
}

/** One row in the "Needs attention" card. Soft amber dot + CTA link. */
function AttentionRow({ text, cta, href }: { text: string; cta: string; href: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] mt-2 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-white leading-snug">{text}</p>
      </div>
      <a
        href={href}
        className="text-[12px] font-medium text-[#7C3AED] hover:text-[#9D6BFF] inline-flex items-center gap-1 flex-shrink-0"
      >
        {cta} <ArrowUpRight size={11} />
      </a>
    </li>
  )
}

/** Recent post card — gradient placeholder image on top, body below.
 *  Uses a tailwind gradient instead of a real image to keep this preview
 *  zero-asset-dependency. In the live version, this gets the actual
 *  thumbnail. */
function PostCard({
  title,
  site,
  siteColor,
  views,
  daysAgo,
  gradient,
}: {
  title: string
  site: string
  siteColor: string
  views: number
  daysAgo: number
  gradient: string
}) {
  return (
    <a
      href="#"
      className="group block rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.06] transition-all duration-200 hover:bg-white/[0.05] hover:-translate-y-0.5"
      style={{
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.2)',
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
        <p className="text-[13px] font-medium text-white leading-snug line-clamp-2 mb-2 group-hover:text-white">
          {title}
        </p>
        <div className="flex items-center gap-2 text-[11px] text-white/45">
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
