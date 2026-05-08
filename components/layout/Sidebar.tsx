'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  LayoutDashboard,
  PlaySquare,
  Palette,
  Settings,
  AlertTriangle,
  ChevronRight,
  Wrench,
  CreditCard,
  Sun,
  Moon,
  Paintbrush,
  ExternalLink,
  LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createBrowserClient } from '@/lib/supabase/client'

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/content', label: 'Content', icon: PlaySquare },
  { href: '/brand', label: 'Brand Profile', icon: Palette },
  { href: '/setup', label: 'Blog Setup', icon: Wrench },
  { href: '/customize', label: 'Customize Blog', icon: Paintbrush },
]

const secondaryNav = [
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/billing', label: 'Plan & Billing', icon: CreditCard },
  { href: '/admin/failures', label: 'Failures', icon: AlertTriangle, danger: true },
]

export default function Sidebar({ email, wpSiteUrl }: { email?: string; wpSiteUrl?: string | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const supabase = createBrowserClient()

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
        {/* Visit Blog */}
        {wpSiteUrl && (
          <a
            href={wpSiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="nav-item w-full mb-2"
          >
            <ExternalLink size={16} className="flex-shrink-0 text-[#0071e3]" />
            <span className="text-[#0071e3] font-medium">Visit Blog</span>
          </a>
        )}

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
          href="/settings"
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
