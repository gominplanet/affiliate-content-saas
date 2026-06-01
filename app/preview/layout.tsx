/**
 * Shared shell for the dashboard redesign preview. Wraps every page under
 * /preview/* with the same sidebar + topbar so you can navigate between
 * mockups and feel the cross-page consistency.
 *
 * Once the redesign is approved, this layout (or a near-clone) replaces
 * the current (dashboard)/layout.tsx and the per-page contents move into
 * the real route files.
 */
'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  Home, Youtube, Library, Mail, Palette, Brush, TrendingUp,
  Settings, CreditCard, Bot, ChevronsLeft, ChevronsRight,
  Bell, ChevronDown, Sparkles, PenLine, Scale, Calendar,
} from 'lucide-react'

/** Nav-item shape. `path` is the full route inc. /preview prefix; `badge`
 *  is optional and rendered as a small count chip when present. */
interface NavItemDef {
  path: string
  icon: React.ReactNode
  label: string
  badge?: number
}

const NAV_GROUPS: Array<{ label: string; items: NavItemDef[] }> = [
  {
    label: 'Today',
    items: [{ path: '/preview/dashboard', icon: <Home size={15} />, label: 'Dashboard' }],
  },
  {
    label: 'Create',
    items: [
      { path: '/preview/studio', icon: <Youtube size={15} />, label: 'YouTube Co-Pilot' },
      { path: '/preview/script', icon: <PenLine size={15} />, label: 'Script writer' },
      { path: '/preview/compare', icon: <Scale size={15} />, label: 'Compare & Guides' },
      { path: '/preview/newsletter', icon: <Mail size={15} />, label: 'Newsletter' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { path: '/preview/library', icon: <Library size={15} />, label: 'Library', badge: 42 },
      { path: '/preview/scheduled', icon: <Calendar size={15} />, label: 'Scheduled', badge: 3 },
      { path: '/preview/brand', icon: <Palette size={15} />, label: 'Brand Profile' },
      { path: '/preview/customize', icon: <Brush size={15} />, label: 'Customize Blog' },
    ],
  },
  {
    label: 'Measure',
    items: [{ path: '/preview/seo', icon: <TrendingUp size={15} />, label: 'SEO' }],
  },
  {
    label: 'Settings',
    items: [
      { path: '/preview/setup', icon: <Settings size={15} />, label: 'Site & Integrations' },
      { path: '/preview/assistant', icon: <Bot size={15} />, label: 'Assistant' },
      { path: '/preview/billing', icon: <CreditCard size={15} />, label: 'Billing' },
    ],
  },
]

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [activeSite, setActiveSite] = useState('Main')
  const pathname = usePathname() || ''

  return (
    <div className="min-h-screen bg-[#0E0E11] text-[#F5F5F7] font-[Inter,system-ui,sans-serif] flex">
      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <aside
        className={`${collapsed ? 'w-[68px]' : 'w-[232px]'} flex-shrink-0 border-r border-white/[0.06] bg-[#0B0B0E] flex flex-col transition-[width] duration-200 sticky top-0 h-screen`}
      >
        <div className="px-4 pt-5 pb-4 flex items-center justify-between">
          <a href="/preview/dashboard" className="flex items-center gap-2">
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

        <nav className="flex-1 px-2 flex flex-col gap-5 overflow-y-auto">
          {NAV_GROUPS.map(group => (
            <div key={group.label}>
              {!collapsed && (
                <p className="px-2.5 mb-1.5 text-[10px] uppercase tracking-[0.15em] font-medium text-white/35">
                  {group.label}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map(item => (
                  <NavItem
                    key={item.path}
                    item={item}
                    active={pathname === item.path}
                    collapsed={collapsed}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

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

      {/* ── Main column ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-white/[0.06] px-8 py-3 flex items-center gap-3 bg-[#0E0E11]/80 backdrop-blur-md sticky top-0 z-10">
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] text-[12px] text-white transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
            {activeSite}
            <ChevronDown size={11} className="text-white/40" />
          </button>
          <button
            onClick={() => setActiveSite(activeSite === 'Main' ? 'Outdoor' : activeSite === 'Outdoor' ? 'Wine Reviews' : 'Main')}
            className="text-[11px] text-white/40 hover:text-white/70 transition-colors"
          >
            (click to swap sites — demo)
          </button>

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

        {children}
      </div>
    </div>
  )
}

/** Sidebar nav row. Active state: thin violet bar on the left + brighter
 *  text. Collapsed mode uses the native title attr for tooltips. */
function NavItem({ item, active, collapsed }: { item: NavItemDef; active: boolean; collapsed: boolean }) {
  return (
    <a
      href={item.path}
      title={collapsed ? item.label : undefined}
      className={`relative flex items-center gap-2.5 ${collapsed ? 'justify-center' : 'px-2.5'} py-1.5 rounded-lg text-[13px] transition-colors ${
        active
          ? 'bg-white/[0.06] text-white'
          : 'text-white/55 hover:text-white hover:bg-white/[0.04]'
      }`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r bg-[#7C3AED]" />}
      <span className="flex-shrink-0">{item.icon}</span>
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && item.badge !== undefined && (
        <span className="text-[10px] tabular-nums text-white/40 px-1.5 py-0.5 rounded bg-white/[0.06]">{item.badge}</span>
      )}
    </a>
  )
}
