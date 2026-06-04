/**
 * Shared shell for the dashboard redesign preview. Wraps every page under
 * /preview/* with the same sidebar + topbar so you can navigate between
 * mockups and feel the cross-page consistency.
 *
 * THEME: a sun/moon toggle in the topbar swaps the whole preview between
 * a warm-dark and a warm-light mode. Colors are CSS variables set on the
 * outermost wrapper so no per-page class refactor was needed — pages
 * reference `var(--surface)`, `var(--text)`, etc. via Tailwind's arbitrary
 * value syntax.
 *
 * Once the redesign is approved, this layout (or a near-clone) replaces
 * the current (dashboard)/layout.tsx and the per-page contents move into
 * the real route files.
 */
'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import {
  Home, Youtube, Library, Mail, Palette, Brush, TrendingUp,
  Settings, CreditCard, Bot, ChevronsLeft, ChevronsRight,
  Bell, ChevronDown, Sparkles, PenLine, Scale, Calendar,
  Sun, Moon,
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

/** Per-theme CSS variable definitions. Components reference these via
 *  `bg-[color:var(--surface)]` etc. so flipping a theme is one state
 *  change instead of editing every JSX color string. */
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
  ['--hero-opacity' as string]: '0.35',
  ['--kbd-bg' as string]: 'rgba(255,255,255,0.06)',
  // Active sidebar nav: violet-tinted background + lighter violet text so
  // it's distinctly "selected" without straining the eye against dark bg.
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
  ['--hero-opacity' as string]: '0.18',
  ['--kbd-bg' as string]: 'rgba(0,0,0,0.05)',
  // Active sidebar nav: lighter violet wash + saturated violet text. The
  // text picks up the brand color so the row reads "selected" instantly.
  ['--nav-active-bg' as string]: 'rgba(124,58,237,0.10)',
  ['--nav-active-text' as string]: '#7C3AED',
}

export default function PreviewClientShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [activeSite, setActiveSite] = useState('Main')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const pathname = usePathname() || ''

  // Persist theme choice across page navigations within the preview
  // (we use sessionStorage so it resets on a fresh visit — keeps the
  // preview discoverable for new viewers).
  useEffect(() => {
    const saved = sessionStorage.getItem('mvp-preview-theme')
    if (saved === 'light' || saved === 'dark') setTheme(saved)
  }, [])
  useEffect(() => {
    sessionStorage.setItem('mvp-preview-theme', theme)
  }, [theme])

  return (
    <div
      style={{
        ...(theme === 'dark' ? DARK_VARS : LIGHT_VARS),
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
        <div className="px-4 pt-5 pb-4 flex items-center justify-between">
          <a href="/preview/dashboard" className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#7C3AED] to-[#C026D3] flex items-center justify-center font-semibold text-white text-[13px]">M</span>
            {!collapsed && (
              <span className="font-semibold text-[14px] tracking-tight" style={{ color: 'var(--text)' }}>
                MVP Affiliate
              </span>
            )}
          </a>
          {!collapsed && (
            <button onClick={() => setCollapsed(true)} className="opacity-40 hover:opacity-90 transition-opacity">
              <ChevronsLeft size={14} />
            </button>
          )}
        </div>

        {collapsed && (
          <button onClick={() => setCollapsed(false)} className="mx-auto mb-3 opacity-40 hover:opacity-90 transition-opacity">
            <ChevronsRight size={14} />
          </button>
        )}

        <nav className="flex-1 px-2 flex flex-col gap-5 overflow-y-auto">
          {NAV_GROUPS.map(group => (
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

        <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
          <div
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${collapsed ? 'justify-center' : ''}`}
            style={{ backgroundColor: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-[12px] font-semibold text-white">S</div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text)' }}>Sebastien</p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--text-faint)' }}>Pro plan</p>
                </div>
                <ChevronDown size={12} style={{ color: 'var(--text-dim)' }} />
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main column ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div
          className="border-b px-8 py-3 flex items-center gap-3 backdrop-blur-md sticky top-0 z-10"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: theme === 'dark' ? 'rgba(14,14,17,0.8)' : 'rgba(250,250,248,0.8)',
          }}
        >
          <button
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
            {activeSite}
            <ChevronDown size={11} style={{ color: 'var(--text-faint)' }} />
          </button>
          <button
            onClick={() => setActiveSite(activeSite === 'Main' ? 'Outdoor' : activeSite === 'Outdoor' ? 'Wine Reviews' : 'Main')}
            className="text-[11px] transition-colors"
            style={{ color: 'var(--text-faint)' }}
          >
            (click to swap sites — demo)
          </button>

          <div className="ml-auto flex items-center gap-3">
            {/* Theme toggle — sun/moon. Persists in sessionStorage. */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
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
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            <button
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
            </button>
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
            >
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

function NavItem({ item, active, collapsed }: { item: NavItemDef; active: boolean; collapsed: boolean }) {
  return (
    <a
      href={item.path}
      title={collapsed ? item.label : undefined}
      className={`relative flex items-center gap-2.5 ${collapsed ? 'justify-center' : 'px-2.5'} py-1.5 rounded-lg text-[13px] font-medium transition-colors`}
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
      {/* Left indicator bar — 3px violet, slightly proud of the row.
          Strong enough to be obvious even when scanning the sidebar. */}
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
    </a>
  )
}
