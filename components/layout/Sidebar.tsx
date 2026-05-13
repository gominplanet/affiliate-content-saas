'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  LayoutDashboard,
  PlaySquare,
  Palette,
  AlertTriangle,
  ChevronRight,
  Wrench,
  CreditCard,
  Sun,
  Moon,
  Paintbrush,
  ExternalLink,
  LogOut,
  Star,
  Clapperboard,
  Zap,
  Check,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createBrowserClient } from '@/lib/supabase/client'

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/content', label: 'Content', icon: PlaySquare },
  { href: '/studio', label: 'YouTube Studio', icon: Clapperboard },
  { href: '/brand', label: 'Brand Profile', icon: Palette },
  { href: '/setup', label: 'Site & Integrations', icon: Wrench },
  { href: '/customize', label: 'Customize Blog', icon: Paintbrush },
]

const secondaryNav = [
  { href: '/billing', label: 'Plan & Billing', icon: CreditCard },
  { href: '/admin/failures', label: 'Failures', icon: AlertTriangle, danger: true },
]

export default function Sidebar({ email, wpSiteUrl: wpSiteUrlProp }: { email?: string; wpSiteUrl?: string | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const supabase = createBrowserClient()
  const [wpSiteUrl, setWpSiteUrl] = useState<string | null>(wpSiteUrlProp ?? null)
  const [purging, setPurging] = useState(false)
  const [purged, setPurged] = useState(false)

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
      // If the snippet refresh part failed but the purge succeeded, surface it.
      const debug = (json.debug as Record<string, unknown>) || {}
      if (debug.snippetError || debug.snippetsListStatus) {
        alert(
          `Cache purged, BUT the snippet refresh didn't fully succeed.\n\n` +
          `Debug:\n${JSON.stringify(debug, null, 2)}\n\n` +
          `This is why the logo banner / colors may not be appearing. Send this output to support.`
        )
      }
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

  return (
    <aside className="sidebar flex flex-col h-screen sticky top-0 overflow-y-auto">
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
        {nav.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={cn('nav-item', isActive(href) && 'active')}>
            <Icon size={16} className="flex-shrink-0" />
            {label}
          </Link>
        ))}

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
          {secondaryNav.map(({ href, label, icon: Icon, danger }) => (
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
          ))}
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
  )
}
