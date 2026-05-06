'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  PlaySquare,
  FileText,
  Palette,
  Settings,
  AlertTriangle,
  ChevronRight,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/content', label: 'Content', icon: PlaySquare },
  { href: '/drafts', label: 'Drafts', icon: FileText },
  { href: '/brand', label: 'Brand Profile', icon: Palette },
  { href: '/setup', label: 'Blog Setup', icon: Wrench },
]

const secondaryNav = [
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/admin/failures', label: 'Failures', icon: AlertTriangle, danger: true },
]

export default function Sidebar({ email }: { email?: string }) {
  const pathname = usePathname()

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)

  return (
    <aside className="sidebar flex flex-col bg-white border-r border-gray-200/80 h-screen sticky top-0 overflow-y-auto">
      {/* Logo */}
      <div className="px-4 pt-5 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#0071e3] flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="font-semibold text-sm text-[#1d1d1f] tracking-tight">AffiliateOS</span>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 px-3 pt-4 pb-2 flex flex-col gap-0.5">
        <p className="section-label px-2 mb-2">Workspace</p>
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn('nav-item', isActive(href) && 'active')}
          >
            <Icon size={16} className="flex-shrink-0" />
            {label}
          </Link>
        ))}

        <div className="mt-4 mb-2 border-t border-gray-100 pt-4">
          <p className="section-label px-2 mb-2">System</p>
          {secondaryNav.map(({ href, label, icon: Icon, danger }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'nav-item',
                isActive(href) && 'active',
                danger && !isActive(href) && 'text-[#86868b] hover:text-[#ff3b30]',
              )}
            >
              <Icon size={16} className="flex-shrink-0" />
              {label}
            </Link>
          ))}
        </div>
      </nav>

      {/* User footer */}
      <div className="px-3 pb-4 border-t border-gray-100 pt-3">
        <Link
          href="/settings"
          className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors group"
        >
          <div className="w-7 h-7 rounded-full bg-[#0071e3]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-semibold text-[#0071e3]">
              {email?.[0]?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[#1d1d1f] truncate">{email ?? 'Account'}</p>
          </div>
          <ChevronRight size={14} className="text-[#86868b] opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
      </div>
    </aside>
  )
}
