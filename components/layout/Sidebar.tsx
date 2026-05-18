'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  LayoutDashboard,
  PlaySquare,
  Palette,
  AlertTriangle,
  UserCog,
  ChevronRight,
  Wrench,
  Plug,
  CreditCard,
  Sun,
  Moon,
  Paintbrush,
  ExternalLink,
  KeyRound,
  LogOut,
  Star,
  Clapperboard,
  Zap,
  Check,
  Loader2,
  HandCoins,
  Menu,
  TrendingUp,
  Megaphone,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createBrowserClient } from '@/lib/supabase/client'

// New nav order — Setup is split into two: Blog Set Up (WordPress wizard)
// and Integrations (3rd-party social connectors). Both routes go to /setup
// with different ?tab= values; active highlighting uses the query param.
const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, matchKind: 'exact' as const },
  { href: '/setup', label: 'Blog Set Up', icon: Wrench, matchKind: 'setup-wp' as const },
  { href: '/setup?tab=integrations', label: 'Integrations', icon: Plug, matchKind: 'setup-int' as const },
  { href: '/brand', label: 'Brand Profile', icon: Palette, matchKind: 'prefix' as const },
  { href: '/customize', label: 'Customize Blog', icon: Paintbrush, matchKind: 'prefix' as const },
  { href: '/studio', label: 'YouTube Studio', icon: Clapperboard, matchKind: 'prefix' as const },
  { href: '/content', label: 'Library & Social Push', icon: PlaySquare, matchKind: 'prefix' as const },
  { href: '/campaigns', label: 'CC Campaigns', icon: Megaphone, matchKind: 'prefix' as const, badge: 'PRO' },
  { href: '/analytics', label: 'Analytics', icon: TrendingUp, matchKind: 'prefix' as const },
]

const secondaryNav = [
  { href: '/billing', label: 'Plan & Billing', icon: CreditCard },
  // Rewardful-hosted affiliate dashboard — opens in a new tab.
  { href: 'https://mvp-affiliate.getrewardful.com/signup', label: 'Earn 10% — Refer', icon: HandCoins, external: true as const, accent: '#34c759' },
  { href: '/admin/users', label: 'Users (admin)', icon: UserCog, danger: false },
  { href: '/admin/failures', label: 'Failures', icon: AlertTriangle, danger: true },
]

export default function Sidebar({ email, wpSiteUrl: wpSiteUrlProp }: { email?: string; wpSiteUrl?: string | null }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const supabase = createBrowserClient()
  const [wpSiteUrl, setWpSiteUrl] = useState<string | null>(wpSiteUrlProp ?? null)
  const [purging, setPurging] = useState(false)
  const [purged, setPurged] = useState(false)
  // Mobile drawer state — sidebar is hidden offscreen below lg and slides in
  // when this is true. Auto-closes on every route change.
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { setMobileOpen(false) }, [pathname, searchParams])

  async function purgeCache() {
    setPurging(true)
    setPurged(false)
    try {
      const res = await fetch('/api/wordpress/purge-cache', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      // Always log the full response so we can inspect what the snippet refresh did
      // eslint-disable-next-line no-console
      console.log('[Purge Site Cache] response:', json)
      if (!res.ok) {
        alert(json.error || 'Cache purge failed.')
        return
      }
      // Legacy Code Snippets error surface removed — the new theme-based
      // architecture doesn't depend on Code Snippets.
      setPurged(true)
      setTimeout(() => setPurged(false), 2500)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Cache purge failed.')
    } finally {
      setPurging(false)
    }
  }

  // Re-fetch on every route change so the link is always up to date
  useEffect(() => {
    // 1. Check localStorage immediately (instant, no network round-trip)
    try {
      const raw = localStorage.getItem('affiliateos_setup_v3')
      if (raw) {
        const d = JSON.parse(raw)
        if (d.completedUrl) setWpSiteUrl(d.completedUrl)
      }
    } catch { /* ignore */ }

    // 2. Also fetch from Supabase so we pick up changes from other sessions
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(supabase as any)
        .from('integrations')
        .select('wordpress_url')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }: { data: Record<string, string> | null }) => {
          const url = data?.wordpress_url || null
          if (url) setWpSiteUrl(url)
        })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)

  // Tab-aware active state for Blog Set Up vs Integrations (both live at /setup)
  const isActiveTabbed = (matchKind: 'exact' | 'prefix' | 'setup-wp' | 'setup-int', href: string) => {
    if (matchKind === 'exact')      return pathname === href
    if (matchKind === 'setup-wp')   return pathname.startsWith('/setup') && searchParams?.get('tab') !== 'integrations'
    if (matchKind === 'setup-int')  return pathname.startsWith('/setup') && searchParams?.get('tab') === 'integrations'
    // 'prefix'
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* Mobile hamburger — visible below lg, fixed top-left so it stays put as
          the user scrolls. The dashboard layout adds top padding on mobile so
          page content doesn't slide under this button. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-40 w-10 h-10 rounded-xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 shadow-sm flex items-center justify-center text-[#1d1d1f] dark:text-[#f5f5f7]"
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      {/* Backdrop — only on mobile when drawer is open. Click anywhere to close. */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          'sidebar flex flex-col h-screen overflow-y-auto z-50',
          // Desktop: classic sticky sidebar
          'lg:sticky lg:top-0 lg:translate-x-0',
          // Mobile: fixed off-canvas drawer that slides in when open
          'fixed top-0 left-0 transition-transform duration-200 ease-out',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
      >
      {/* Logo */}
      <div className="px-4 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border-2)' }}>
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mvp-affiliate-logo.png"
            alt="MVP Affiliate"
            className="w-7 h-7 rounded-lg object-contain mix-blend-multiply dark:mix-blend-screen flex-shrink-0"
          />
          <span className="font-semibold text-sm tracking-tight" style={{ color: 'var(--text)' }}>MVP Affiliate</span>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 px-3 pt-4 pb-2 flex flex-col gap-0.5">
        <p className="section-label px-2 mb-2">Workspace</p>
        {nav.map((item) => {
          const { href, label, icon: Icon, matchKind } = item
          const badge = 'badge' in item ? item.badge : undefined
          return (
            <Link key={label} href={href} className={cn('nav-item', isActiveTabbed(matchKind, href) && 'active')}>
              <Icon size={16} className="flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {badge && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#ff9500]/15 text-[#9a5d00] flex-shrink-0">
                  {badge}
                </span>
              )}
            </Link>
          )
        })}

        {/* Visit Blog */}
        <a
          href={wpSiteUrl || '/setup'}
          target={wpSiteUrl ? '_blank' : '_self'}
          rel="noopener noreferrer"
          className="nav-item"
          style={wpSiteUrl ? {} : { opacity: 0.45 }}
        >
          <ExternalLink size={16} className="flex-shrink-0" style={wpSiteUrl ? { color: '#0071e3' } : {}} />
          <span style={wpSiteUrl ? { color: '#0071e3', fontWeight: 500 } : {}}>Visit Blog</span>
        </a>

        {/* WordPress Admin — direct link to wp-admin for the connected site.
            Only renders when a site is connected; otherwise the wp-admin URL
            is meaningless. */}
        {wpSiteUrl && (
          <button
            onClick={() => {
              const ok = window.confirm(
                'Heads up: editing posts, theme files or plugin settings directly in WordPress can break the MVP Affiliate setup — theme + plugin sync, Brand Profile push, and the cache layer all depend on MVP being the source of truth.\n\nYou\'re doing this at your own risk. Continue?'
              )
              if (ok) window.open(`${wpSiteUrl.replace(/\/$/, '')}/wp-admin`, '_blank', 'noopener,noreferrer')
            }}
            className="nav-item w-full text-left"
            title="Open your WordPress admin (shows a warning first)"
          >
            <KeyRound size={16} className="flex-shrink-0" style={{ color: '#5856d6' }} />
            <span style={{ color: '#5856d6', fontWeight: 500 }}>WP Admin</span>
          </button>
        )}

        {/* Purge cache — prominent global action, always active */}
        {(
          <button
            onClick={purgeCache}
            disabled={purging}
            className="mt-3 flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-60"
            style={{
              background: purged
                ? 'linear-gradient(135deg, #34c759 0%, #30b450 100%)'
                : 'linear-gradient(135deg, #ff9500 0%, #ff6b00 100%)',
              boxShadow: purged
                ? '0 2px 8px rgba(52,199,89,0.3)'
                : '0 2px 8px rgba(255,149,0,0.3)',
            }}
            title="Clear LiteSpeed cache so your latest changes appear on the live blog"
          >
            {purging
              ? <><Loader2 size={14} className="animate-spin" /> Clearing cache…</>
              : purged
              ? <><Check size={14} /> Cache cleared!</>
              : <><Zap size={14} /> Purge Site Cache</>
            }
          </button>
        )}

        {/* Recommended Tools */}
        <div className="mt-4 mb-2 pt-4" style={{ borderTop: '1px solid var(--border-2)' }}>
          <p className="section-label px-2 mb-2 flex items-center gap-1.5">
            <Star size={10} className="text-[#ff9500]" /> Recommended Tools
          </p>
          {[
            { label: 'Levanta', href: 'https://geni.us/GCad5Q' },
            { label: 'PartnerBoost', href: 'https://geni.us/Z0q3hY' },
            { label: 'Archer Affiliate', href: 'https://geni.us/khuHTe' },
            { label: 'Geniuslink', href: 'https://geni.us/Y70p9R' },
            { label: 'Oink', href: 'https://geni.us/2y5sBo' },
          ].map(({ label, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="nav-item"
            >
              <ExternalLink size={13} className="flex-shrink-0 opacity-50" />
              {label}
            </a>
          ))}
        </div>

        <div className="mt-4 mb-2 pt-4" style={{ borderTop: '1px solid var(--border-2)' }}>
          <p className="section-label px-2 mb-2">System</p>
          {secondaryNav.map((item) => {
            const { href, label, icon: Icon } = item
            const danger = 'danger' in item && item.danger
            const external = 'external' in item && item.external
            const accent = 'accent' in item ? item.accent : undefined

            if (external) {
              return (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nav-item"
                  style={accent ? { color: accent } : undefined}
                >
                  <Icon size={16} className="flex-shrink-0" />
                  <span className="flex-1">{label}</span>
                  <ExternalLink size={11} className="opacity-60 flex-shrink-0" />
                </a>
              )
            }

            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'nav-item',
                  isActive(href) && 'active',
                  danger && !isActive(href) && 'hover:!text-[#ff3b30]',
                )}
              >
                <Icon size={16} className="flex-shrink-0" />
                {label}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Footer: theme toggle + user */}
      <div className="px-3 pb-4 pt-3" style={{ borderTop: '1px solid var(--border-2)' }}>
        {/* Dark mode toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="nav-item w-full mb-2 justify-between"
        >
          <div className="flex items-center gap-3">
            {theme === 'dark'
              ? <Moon size={16} className="flex-shrink-0" />
              : <Sun size={16} className="flex-shrink-0" />}
            <span>{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
          </div>
          {/* Toggle pill */}
          <div className={`relative w-9 h-5 rounded-full transition-colors ${theme === 'dark' ? 'bg-[#0071e3]' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${theme === 'dark' ? 'left-[18px]' : 'left-0.5'}`} />
          </div>
        </button>

        {/* User */}
        <Link
          href="/billing"
          className="flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors group hover:opacity-80"
          style={{ background: 'var(--surface-2)' }}
        >
          <div className="w-7 h-7 rounded-full bg-[#0071e3]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-semibold text-[#0071e3]">
              {email?.[0]?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>{email ?? 'Account'}</p>
          </div>
          <ChevronRight size={14} style={{ color: 'var(--text-3)' }} className="opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="nav-item w-full mt-1 hover:!text-[#ff3b30]"
        >
          <LogOut size={16} className="flex-shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
    </>
  )
}
