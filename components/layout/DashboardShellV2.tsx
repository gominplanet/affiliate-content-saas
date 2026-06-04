// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// DashboardShellV2 — the new live dashboard chrome.
//
// Replaces the legacy components/layout/Sidebar.tsx as the wrapper for
// every (dashboard)/* route. Lifted from /app/preview/PreviewClientShell
// (the redesign we ran for ~2 weeks behind an admin gate) and adapted to
// production state: real nav routes, real user/tier/site data, next-themes
// integration, and the admin "View as tier" dropdown.
//
// Visual language summary (matches the preview tutorials were calibrated
// against):
//   - CSS-variable theme system (dark + light), toggled via sun/moon
//   - Grouped nav: Today / Create / Manage / Measure / Settings
//   - Collapsible sidebar with chevron toggle
//   - Site picker chip in the topbar (multi-site Pro users; single-site
//     users still see their site name)
//   - Notification bell + "Ask anything" kbd hint placeholder
//
// The legacy Sidebar.tsx component is intentionally NOT deleted — keep
// it for rollback while the new chrome bakes. Delete in a follow-up
// commit once we're confident.
'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { createBrowserClient } from '@/lib/supabase/client'
import { getViewAsTier, setViewAsTier } from '@/lib/view-as'
import type { Tier } from '@/lib/tier'
import {
  Home, Youtube, Library, Mail, Palette, Brush, TrendingUp,
  Settings, CreditCard, Bot, ChevronsLeft, ChevronsRight,
  Bell, ChevronDown, Sparkles, PenLine, Scale, Calendar,
  Sun, Moon, BookOpen, BadgePercent, Megaphone, Handshake,
  Flame, GraduationCap, KeyRound, Users, LogOut, ExternalLink,
  UserCog, AlertTriangle, DollarSign, Newspaper, Plug, Wrench,
  LayoutDashboard,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItemDef {
  href: string
  icon: React.ReactNode
  label: string
  badge?: number
  /** Hide unless gate is true. Used for showBuyingGuides + showDeals
   *  + admin-only links. */
  gate?: boolean
}

interface NavGroupDef {
  label: string
  items: NavItemDef[]
}

// Per-theme CSS variable definitions. Components reference these via
// `style={{ background: 'var(--bg)' }}` so flipping a theme is one state
// change instead of editing every JSX color string.
const DARK_VARS: React.CSSProperties = {
  ['--bg' as string]: '#0E0E11',
  ['--bg-sidebar' as string]: '#0B0B0E',
  ['--surface' as string]: 'rgba(255,255,255,0.03)',
  ['--surface-hover' as string]: 'rgba(255,255,255,0.05)',
  ['--surface-bright' as string]: 'rgba(255,255,255,0.07)',
  ['--surface-selected' as string]: 'rgba(124,58,237,0.10)',
  ['--border' as string]: 'rgba(255,255,255,0.06)',
  ['--border-bright' as string]: 'rgba(255,255,255,0.10)',
  ['--text' as string]: '#F5F5F7',
  ['--text-muted' as string]: 'rgba(255,255,255,0.85)',
  ['--text-soft' as string]: 'rgba(255,255,255,0.70)',
  ['--text-subtle' as string]: 'rgba(255,255,255,0.55)',
  ['--text-faint' as string]: 'rgba(255,255,255,0.40)',
  ['--text-dim' as string]: 'rgba(255,255,255,0.30)',
  ['--card-shadow' as string]: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.2)',
  ['--kbd-bg' as string]: 'rgba(255,255,255,0.06)',
  ['--nav-active-bg' as string]: 'rgba(124,58,237,0.16)',
  ['--nav-active-text' as string]: '#C4B5FD',
}

const LIGHT_VARS: React.CSSProperties = {
  ['--bg' as string]: '#FAFAF8',
  ['--bg-sidebar' as string]: '#F4F2EE',
  ['--surface' as string]: '#FFFFFF',
  ['--surface-hover' as string]: 'rgba(0,0,0,0.025)',
  ['--surface-bright' as string]: 'rgba(0,0,0,0.04)',
  ['--surface-selected' as string]: 'rgba(124,58,237,0.08)',
  ['--border' as string]: 'rgba(0,0,0,0.08)',
  ['--border-bright' as string]: 'rgba(0,0,0,0.14)',
  ['--text' as string]: '#1D1D1F',
  ['--text-muted' as string]: 'rgba(0,0,0,0.82)',
  ['--text-soft' as string]: 'rgba(0,0,0,0.66)',
  ['--text-subtle' as string]: 'rgba(0,0,0,0.52)',
  ['--text-faint' as string]: 'rgba(0,0,0,0.40)',
  ['--text-dim' as string]: 'rgba(0,0,0,0.30)',
  ['--card-shadow' as string]: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)',
  ['--kbd-bg' as string]: 'rgba(0,0,0,0.05)',
  ['--nav-active-bg' as string]: 'rgba(124,58,237,0.10)',
  ['--nav-active-text' as string]: '#7C3AED',
}

interface DashboardShellV2Props {
  email?: string
  wpSiteUrl: string | null
  tier: Tier | string
  showBuyingGuides: boolean
  showDeals: boolean
  children: React.ReactNode
}

export default function DashboardShellV2({
  email,
  wpSiteUrl,
  tier,
  showBuyingGuides,
  showDeals,
  children,
}: DashboardShellV2Props) {
  const pathname = usePathname() || ''
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const supabase = createBrowserClient()
  const isDark = theme !== 'light' // default to dark when unset

  // Persist collapsed state across navigations.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('mvp_shell_collapsed')
      if (saved === '1') setCollapsed(true)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('mvp_shell_collapsed', collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  const isAdmin = tier === 'admin'

  // Admin "view as tier" dropdown state. Sourced from localStorage so the
  // sidebar reflects whichever tier the admin is currently previewing.
  const [viewAs, setViewAs] = useState<Tier>('admin')
  useEffect(() => { setViewAs(getViewAsTier() ?? 'admin') }, [])

  // ── Nav definition ────────────────────────────────────────────────────
  // Mirrors the preview's IA but maps to the real routes. Gates honor the
  // server-supplied showBuyingGuides + showDeals (Pro/Studio tiering +
  // 500-post catalogue threshold) and metaEnabled (Instagram Burner).
  const NAV_GROUPS: NavGroupDef[] = [
    {
      label: 'Today',
      items: [
        { href: '/dashboard', icon: <Home size={15} />, label: 'Dashboard' },
      ],
    },
    {
      label: 'Create',
      items: [
        { href: '/studio', icon: <Youtube size={15} />, label: 'YouTube Co-Pilot' },
        { href: '/script', icon: <PenLine size={15} />, label: 'Script writer' },
        { href: '/comparison', icon: <Scale size={15} />, label: 'Compare products' },
        { href: '/buying-guides', icon: <BookOpen size={15} />, label: 'Buying Guides', gate: showBuyingGuides },
        { href: '/deals', icon: <BadgePercent size={15} />, label: 'Deals Hub', gate: showDeals },
        { href: '/newsletter', icon: <Mail size={15} />, label: 'Newsletter' },
        { href: '/instagram-burner', icon: <Flame size={15} />, label: 'Instagram Burner' },
      ],
    },
    {
      label: 'Manage',
      items: [
        { href: '/content', icon: <Library size={15} />, label: 'Library' },
        { href: '/brand', icon: <Palette size={15} />, label: 'Brand Profile' },
        { href: '/customize', icon: <Brush size={15} />, label: 'Customize Blog' },
      ],
    },
    {
      label: 'Grow',
      items: [
        { href: '/seo', icon: <TrendingUp size={15} />, label: 'SEO & Indexing' },
        { href: '/analytics', icon: <TrendingUp size={15} />, label: 'Analytics' },
      ],
    },
    {
      label: 'Collaborate',
      items: [
        { href: '/campaigns', icon: <Megaphone size={15} />, label: 'Creator Campaigns' },
        { href: '/collaborations', icon: <Handshake size={15} />, label: 'Brand Deals' },
      ],
    },
    {
      label: 'Settings',
      items: [
        { href: '/setup', icon: <Wrench size={15} />, label: 'Blog Set Up' },
        { href: '/setup?tab=integrations', icon: <Plug size={15} />, label: 'Integrations' },
        { href: '/assistant', icon: <Bot size={15} />, label: 'AI Assistant' },
        { href: '/billing', icon: <CreditCard size={15} />, label: 'Plan & Billing' },
        { href: '/developers', icon: <KeyRound size={15} />, label: 'API Access' },
        { href: '/agency', icon: <Users size={15} />, label: 'Virtual Assistants' },
        { href: '/tutorials', icon: <GraduationCap size={15} />, label: 'Tutorials' },
      ],
    },
    // Admin-only block. Only added to NAV_GROUPS when isAdmin so
    // non-admins never see these entries.
    ...(isAdmin ? [{
      label: 'Admin',
      items: [
        { href: '/admin/users', icon: <UserCog size={15} />, label: 'Users (admin)' },
        { href: '/admin/failures', icon: <AlertTriangle size={15} />, label: 'Failures' },
        { href: '/admin/costs', icon: <DollarSign size={15} />, label: 'AI Cost (admin)' },
        { href: '/admin/announcement', icon: <Newspaper size={15} />, label: 'News banner (admin)' },
      ],
    }] : []),
  ]

  // ── Active-route detection. Match by prefix so a child route still
  // highlights its parent (e.g. /admin/users/123 lights /admin/users).
  const isActive = useCallback((href: string) => {
    // Special case: /setup?tab=integrations vs /setup — both go to /setup
    // but we want them to highlight independently based on the query.
    if (href.includes('?')) {
      const [path, query] = href.split('?')
      const params = new URLSearchParams(query)
      const tabKey = params.get('tab')
      if (typeof window !== 'undefined') {
        const currentTab = new URLSearchParams(window.location.search).get('tab')
        return pathname === path && currentTab === tabKey
      }
      return false
    }
    if (href === '/dashboard') return pathname === '/dashboard'
    if (href === '/setup') {
      if (pathname !== '/setup') return false
      if (typeof window !== 'undefined') {
        const currentTab = new URLSearchParams(window.location.search).get('tab')
        return currentTab !== 'integrations'
      }
      return true
    }
    return pathname.startsWith(href)
  }, [pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const userInitial = (email || 'U').slice(0, 1).toUpperCase()
  const wpHostname = wpSiteUrl ? wpSiteUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '').slice(0, 24) : null

  return (
    <div
      style={{
        ...(isDark ? DARK_VARS : LIGHT_VARS),
        backgroundColor: 'var(--bg)',
        color: 'var(--text)',
      }}
      className="min-h-screen font-[Inter,system-ui,sans-serif] flex"
    >
      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <aside
        className={`${collapsed ? 'w-[68px]' : 'w-[232px]'} flex-shrink-0 border-r flex flex-col transition-[width] duration-200 sticky top-0 h-screen`}
        style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border)' }}
      >
        {/* Brand + collapse toggle */}
        <div className="px-4 pt-5 pb-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#7C3AED] to-[#C026D3] flex items-center justify-center font-semibold text-white text-[13px]">M</span>
            {!collapsed && (
              <span className="font-semibold text-[14px] tracking-tight" style={{ color: 'var(--text)' }}>
                MVP Affiliate
              </span>
            )}
          </Link>
          {!collapsed && (
            <button onClick={() => setCollapsed(true)} className="opacity-40 hover:opacity-90 transition-opacity" title="Collapse sidebar">
              <ChevronsLeft size={14} />
            </button>
          )}
        </div>

        {collapsed && (
          <button onClick={() => setCollapsed(false)} className="mx-auto mb-3 opacity-40 hover:opacity-90 transition-opacity" title="Expand sidebar">
            <ChevronsRight size={14} />
          </button>
        )}

        {/* Nav groups */}
        <nav className="flex-1 px-2 flex flex-col gap-5 overflow-y-auto pb-3">
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter((it) => it.gate !== false)
            if (visibleItems.length === 0) return null
            return (
              <div key={group.label}>
                {!collapsed && (
                  <p
                    className="px-2.5 mb-1.5 text-[10px] uppercase tracking-[0.15em] font-medium"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    {group.label}
                  </p>
                )}
                <div className="flex flex-col gap-0.5">
                  {visibleItems.map((item) => (
                    <NavItem
                      key={item.href + item.label}
                      item={item}
                      active={isActive(item.href)}
                      collapsed={collapsed}
                    />
                  ))}
                </div>
              </div>
            )
          })}

          {/* Admin View-as dropdown — same lib/view-as.ts wiring as the
              legacy sidebar. Only renders when the real DB tier is admin
              (gated server-side via the `tier` prop). */}
          {isAdmin && !collapsed && (
            <div className="px-2.5">
              <p className="mb-1.5 text-[10px] uppercase tracking-[0.15em] font-medium" style={{ color: 'var(--text-faint)' }}>
                Admin · view as
              </p>
              <select
                value={viewAs}
                onChange={(e) => {
                  const v = e.target.value as Tier
                  setViewAs(v)
                  setViewAsTier(v === 'admin' ? null : v)
                  window.location.reload()
                }}
                className="w-full text-[12px] rounded-md px-2 py-1.5 border"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                }}
                title="Preview the UI as each tier sees it. Visual only, your real admin access is unchanged."
              >
                <option value="admin">My view (Admin)</option>
                <option value="pro">Pro</option>
                <option value="studio">Studio</option>
                <option value="creator">Creator</option>
                <option value="trial">Free Trial</option>
              </select>
              {viewAs !== 'admin' && (
                <p className="mt-1 text-[10px]" style={{ color: '#FF9500' }}>
                  Previewing as {viewAs} · visual only
                </p>
              )}
            </div>
          )}
        </nav>

        {/* User pill */}
        <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
          <div
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg group ${collapsed ? 'justify-center' : ''}`}
            style={{ backgroundColor: 'transparent' }}
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-[12px] font-semibold text-white flex-shrink-0">
              {userInitial}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text)' }}>
                    {email || 'Account'}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--text-faint)' }}>
                    {String(tier).charAt(0).toUpperCase() + String(tier).slice(1)} plan
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="opacity-40 group-hover:opacity-90 transition-opacity"
                  title="Sign out"
                >
                  <LogOut size={13} />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main column ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <div
          className="border-b px-8 py-3 flex items-center gap-3 backdrop-blur-md sticky top-0 z-10"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: isDark ? 'rgba(14,14,17,0.85)' : 'rgba(250,250,248,0.85)',
          }}
        >
          {/* Site chip — shows the connected WordPress hostname. Click
              opens Setup → Integrations. Multi-site picker comes in a
              follow-up (needs wordpress_sites API wiring + dropdown). */}
          <Link
            href="/setup?tab=integrations"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12px] transition-colors"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface)')}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
            {wpHostname || 'No WordPress yet'}
            <ChevronDown size={11} style={{ color: 'var(--text-faint)' }} />
          </Link>

          <div className="ml-auto flex items-center gap-3">
            {/* WP admin shortcut — links straight into wp-admin if a site
                is connected. */}
            {wpSiteUrl && (
              <a
                href={`${wpSiteUrl.replace(/\/+$/, '')}/wp-admin`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-lg border text-[11px] inline-flex items-center gap-1.5 transition-colors"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-soft)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface)')}
                title="Open WordPress admin in a new tab"
              >
                WP Admin <ExternalLink size={10} />
              </a>
            )}

            {/* Theme toggle */}
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--text-soft)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
                e.currentTarget.style.color = 'var(--text)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = 'var(--text-soft)'
              }}
              title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            {/* Ask anything — opens AI Assistant. Cmd+K hotkey wiring
                lands in a follow-up; for now the button is a Link. */}
            <Link
              href="/assistant"
              className="px-2.5 py-1.5 rounded-lg border text-[11px] inline-flex items-center gap-2 transition-colors"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--text-soft)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface)')}
            >
              <Sparkles size={11} className="text-[#7C3AED]" />
              Ask anything
              <kbd
                className="px-1 py-0.5 rounded text-[9px] border font-mono"
                style={{
                  backgroundColor: 'var(--kbd-bg)',
                  borderColor: 'var(--border-bright)',
                  color: 'var(--text-faint)',
                }}
              >
                ⌘K
              </kbd>
            </Link>

            {/* Notification bell. Real notifications wiring comes later;
                the dot indicates one of: pending guide approvals, deal
                end imminent, etc. Placeholder for now. */}
            <button
              className="relative p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--text-soft)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
                e.currentTarget.style.color = 'var(--text)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = 'var(--text-soft)'
              }}
              title="Notifications"
            >
              <Bell size={14} />
            </button>
          </div>
        </div>

        {/* Page content. Generous max-width so the new chrome doesn't
            crush wide content (e.g. the comparison table on /comparison
            or the catalogue grid on /content). */}
        <main className="flex-1 overflow-y-auto w-full">
          <div className="max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 pb-12">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────

function NavItem({ item, active, collapsed }: { item: NavItemDef; active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        'relative flex items-center gap-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors',
        collapsed ? 'justify-center' : 'px-2.5',
      )}
      style={{
        backgroundColor: active ? 'var(--nav-active-bg)' : 'transparent',
        color: active ? 'var(--nav-active-text)' : 'var(--text-subtle)',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
          e.currentTarget.style.color = 'var(--text)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-subtle)'
        }
      }}
    >
      {/* Left indicator bar — 3px violet stub that proudly marks the
          selected row. Strong enough to be obvious even when scanning
          the whole sidebar. */}
      {active && <span className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[#7C3AED]" />}
      <span className="flex-shrink-0">{item.icon}</span>
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && item.badge !== undefined && (
        <span
          className="text-[10px] tabular-nums px-1.5 py-0.5 rounded"
          style={{
            backgroundColor: active ? 'rgba(124,58,237,0.18)' : 'var(--surface-bright)',
            color: active ? 'var(--nav-active-text)' : 'var(--text-faint)',
          }}
        >
          {item.badge}
        </span>
      )}
    </Link>
  )
}

// LayoutDashboard import safety: imported to avoid the unused-warning
// when collapsed pruning lands. Keep as-is until follow-up.
void LayoutDashboard
