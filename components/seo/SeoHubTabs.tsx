// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One shared tab bar across SEO & Indexing and the post-publish Site Tools so
// they read as a single section. Rendered at the top of /seo and each /tools/*
// page; highlights the active tab by pathname. Keeps the tools discoverable in
// one place instead of scattered across two nav groups.
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TrendingUp, ShieldCheck, Wand2, Copy, Signpost, Code2 } from 'lucide-react'

const TABS = [
  { href: '/seo',                   label: 'SEO & Indexing', icon: TrendingUp },
  { href: '/tools/title-audit',     label: 'Title Check',    icon: ShieldCheck },
  { href: '/tools/clean-links',     label: 'Clean Links',    icon: Wand2 },
  { href: '/tools/duplicates',      label: 'Duplicates',     icon: Copy },
  { href: '/tools/redirects',       label: 'Fix 404s',       icon: Signpost },
  { href: '/tools/fix-formatting',  label: 'Fix Formatting', icon: Code2 },
] as const

export default function SeoHubTabs() {
  const pathname = usePathname() || ''
  return (
    <div className="mb-5 overflow-x-auto">
      <div className="flex items-center gap-1.5 w-max">
        {TABS.map(t => {
          const active = t.href === '/seo' ? pathname === '/seo' : pathname.startsWith(t.href)
          const Icon = t.icon
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium border whitespace-nowrap transition-colors ${
                active
                  ? 'text-white border-transparent bg-[#7C3AED]'
                  : 'text-[#4b4b4f] dark:text-[#b0b0b5] border-black/10 dark:border-white/15 hover:border-[#7C3AED]/60 hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
