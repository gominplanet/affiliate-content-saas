// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TrialResearchRow — the "Free research — start here" row shown at the top of the
// dashboard for Free Trial users (the reason they're here). It's a CLIENT
// component so it honors the admin "View as" override via useEffectiveTier: it
// renders for a real trial user AND when an admin previews trial, but not for
// paid tiers. The server dashboard can't see the view-as override (localStorage),
// which is why this lives client-side.

'use client'

import Link from 'next/link'
import { PackageSearch, Radar, ShoppingBag, Store } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'

const TOOLS = [
  { href: '/amz-finder', icon: <PackageSearch size={17} />, title: 'Amazon Research', desc: 'Search the whole catalogue by the numbers that matter', accent: '#7C3AED' },
  { href: '/deal-radar', icon: <Radar size={17} />, title: 'Deal Radar', desc: 'Live, price-verified Amazon deals', accent: '#F43F5E' },
  { href: '/levanta', icon: <ShoppingBag size={17} />, title: 'MVP x Levanta', desc: 'Search your Levanta campaigns', accent: '#22D3EE' },
  { href: '/partnerboost', icon: <Store size={17} />, title: 'MVP x PartnerBoost', desc: 'Search your PartnerBoost campaigns', accent: '#10B981' },
]

export default function TrialResearchRow() {
  const tier = useEffectiveTier()
  if (tier !== 'trial') return null
  return (
    <section className="rounded-2xl p-5 sm:p-6" style={{ background: 'rgba(124, 58, 237, 0.08)', border: '1px solid rgba(124, 58, 237, 0.20)' }}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] mb-1" style={{ color: '#7C3AED' }}>Free research — start here</p>
      <p className="text-sm mb-3" style={{ color: 'var(--text-soft)' }}>Find products worth reviewing. No card, no setup.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {TOOLS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-xl border p-4 flex items-start gap-3 transition-all duration-200 hover:-translate-y-0.5"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}
          >
            <span className="w-9 h-9 rounded-lg grid place-items-center flex-shrink-0" style={{ background: `${t.accent}1A`, color: t.accent }}>{t.icon}</span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{t.title}</span>
              <span className="block text-[12px] leading-snug" style={{ color: 'var(--text-soft)' }}>{t.desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
