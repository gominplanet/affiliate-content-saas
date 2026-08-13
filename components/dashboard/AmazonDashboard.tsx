// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AmazonDashboard — the landing page a real Amazon Influencer sees instead of
// the blog/YouTube-oriented default dashboard. Two halves, as designed:
//   LEFT  — the toolkit they're paying for (their Amazon features, each a card
//           that deep-links into the tool).
//   RIGHT — the upgrade pitch: everything the full creator plans add on top.
//
// Rendered server-side for real amazon-tier users (dashboard/page.tsx) and
// client-side for an admin previewing via the view-as switcher.

'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  Wand2, PackageSearch, Share2, Handshake, Radar, UserSquare,
  FileText, Youtube, Scale, Mail, TrendingUp, Check, ArrowRight, Sparkles,
} from 'lucide-react'

const ACCENT = '#C2410C' // Amazon-hub orange (sidebar + /pricing)

const TOOLKIT: { href: string; icon: ReactNode; title: string; desc: string }[] = [
  { href: '/amazon/thumbnails', icon: <Wand2 size={18} />, title: 'Thumbnail Generator', desc: 'Turn any product into scroll-stopping, storefront-ready thumbnails. 200/mo.' },
  { href: '/amazon/social', icon: <Share2 size={18} />, title: 'Social Influencer', desc: 'Ready-to-post pins, Reels and Facebook designs, published to all three at once.' },
  { href: '/amazon/research', icon: <PackageSearch size={18} />, title: 'Product Research', desc: 'Filter the whole Amazon catalogue by sales, rating, price and competition.' },
  { href: '/cc-campaigns', icon: <Handshake size={18} />, title: 'Creator Connections', desc: 'Browse brand campaigns, land deals, and message brands direct. 50/mo.' },
  { href: '/deal-radar', icon: <Radar size={18} />, title: 'Deal Radar', desc: 'Live, price-history-verified Amazon deals to post while they are hot.' },
  { href: '/photobooth', icon: <UserSquare size={18} />, title: 'Face Models', desc: 'Put your own face on every design. 1 model + 3 studio photobooth shots.' },
]

const UPGRADE: { icon: ReactNode; title: string; desc: string }[] = [
  { icon: <FileText size={16} />, title: 'A real blog', desc: 'Publish full product-review posts to your own WordPress site, in your voice.' },
  { icon: <Youtube size={16} />, title: 'YouTube engine', desc: 'Turn any video into a blog, thumbnails, scripts and a week of social posts.' },
  { icon: <Scale size={16} />, title: 'Comparisons & guides', desc: 'Head-to-head ranked posts and buying guides that win search.' },
  { icon: <Mail size={16} />, title: 'Newsletter', desc: 'Your own list, with scheduling and segments.' },
  { icon: <TrendingUp size={16} />, title: 'SEO & indexing', desc: 'Get every post found on Google, faster.' },
]

export default function AmazonDashboard({ firstName, today }: { firstName: string; today: string }) {
  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-6">
      {/* Hero */}
      <section className="relative overflow-hidden border-b" style={{ borderColor: 'var(--border)' }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 'var(--hero-opacity)',
            background: `
              radial-gradient(60% 80% at 15% 20%, rgba(234,88,12,0.42), transparent 60%),
              radial-gradient(50% 70% at 85% 10%, rgba(234,88,12,0.28), transparent 65%),
              radial-gradient(80% 60% at 50% 90%, rgba(194,65,12,0.20), transparent 70%)
            `,
          }}
        />
        <div className="relative px-6 sm:px-8 pt-10 pb-8">
          <p className="text-[11px] uppercase tracking-[0.18em] font-semibold mb-3" style={{ color: 'var(--text-subtle)' }}>{today}</p>
          <h1 className="text-[36px] sm:text-[40px] leading-[1.05] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
            Welcome back, {firstName}.
          </h1>
          <p className="text-[14px] mt-3" style={{ color: 'var(--text-soft)' }}>
            <span className="font-semibold" style={{ color: ACCENT }}>Amazon Influencer</span> plan · your storefront command center
          </p>
        </div>
      </section>

      {/* Split: toolkit (left) + upgrade pitch (right) */}
      <div className="px-6 sm:px-8 py-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — what they're getting */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={16} style={{ color: ACCENT }} />
            <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Your toolkit</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TOOLKIT.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="group rounded-2xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div className="w-10 h-10 rounded-xl grid place-items-center mb-3" style={{ backgroundColor: `${ACCENT}1F`, color: ACCENT }}>{t.icon}</div>
                <p className="font-semibold text-[14px] mb-1 flex items-center gap-1" style={{ color: 'var(--text)' }}>
                  {t.title}
                  <ArrowRight size={13} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: ACCENT }} />
                </p>
                <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{t.desc}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* RIGHT — upgrade pitch */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={16} style={{ color: ACCENT }} />
            <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Grow beyond your storefront</h2>
          </div>
          <div className="rounded-2xl border p-6 h-[calc(100%-2rem)] flex flex-col" style={{ borderColor: `${ACCENT}55`, background: `linear-gradient(180deg, ${ACCENT}14, ${ACCENT}05)` }}>
            <p className="text-[13.5px] leading-relaxed mb-5" style={{ color: 'var(--text-soft)' }}>
              You&apos;ve got the storefront covered. The full MVP plans add a whole content engine on
              top of everything you already have, so one product can become a blog post, a video, a
              newsletter and a week of social, not just a design.
            </p>
            <ul className="space-y-3 flex-1">
              {UPGRADE.map((u) => (
                <li key={u.title} className="flex items-start gap-3">
                  <span className="w-7 h-7 rounded-lg grid place-items-center flex-shrink-0 mt-0.5" style={{ backgroundColor: `${ACCENT}1F`, color: ACCENT }}>{u.icon}</span>
                  <span>
                    <span className="block text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}>{u.title}</span>
                    <span className="block text-[12.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{u.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/billing"
              className="mt-6 inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-xl text-[13.5px] font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
              style={{ backgroundColor: ACCENT }}
            >
              See upgrade options
              <ArrowRight size={14} />
            </Link>
            <p className="mt-2 text-center text-[11px]" style={{ color: 'var(--text-faint)' }}>
              Everything above is added, not swapped. Your Amazon tools stay exactly as they are.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
