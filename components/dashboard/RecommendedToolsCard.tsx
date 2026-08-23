// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Dashboard "Recommended tools" section — mirrors the sidebar Recommended Tools
// group (revenue-converting partner/affiliate links) so the discovery links are
// visible on the dashboard itself, right under the opportunity stats. Plain
// external <a> links → server component, no client JS needed. The sidebar
// (components/layout/DashboardShellV2.tsx) holds the canonical list; keep the two
// in sync when a partner is added/removed.

import { ExternalLink } from 'lucide-react'

// Order is intentional (not alphabetical): Oink first (highest converter),
// Geniuslink second (link wrapping), then programs in revenue-rank order —
// matching the sidebar group.
const TOOLS: Array<{ href: string; label: string; desc: string; highlight?: string }> = [
  { href: 'https://geni.us/2y5sBo', label: 'Oink', desc: 'Manage Amazon Creator Connections, earnings & storefronts', highlight: '#E0218A' },
  { href: 'https://geni.us/Y70p9R', label: 'Geniuslink', desc: 'Auto-localize Amazon links + route mobile shoppers to the app' },
  { href: 'https://geni.us/GCad5Q', label: 'Levanta', desc: 'Exclusive brand deals on Amazon, Shopify & Walmart' },
  { href: 'https://geni.us/Z0q3hY', label: 'PartnerBoost', desc: 'Top brands across retail, travel, D2C & subscriptions' },
  { href: 'https://geni.us/khuHTe', label: 'Archer Affiliate', desc: 'Partner with Amazon sellers — up to 60% commissions' },
  { href: 'https://geni.us/9qSLP', label: 'Cha-Ching Automate', desc: 'Auto-sync your videos to YouTube + 13 global Amazon storefronts' },
]

export default function RecommendedToolsCard() {
  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] mb-3" style={{ color: 'var(--text-faint)' }}>
        Recommended tools
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {TOOLS.map(t => (
          <a
            key={t.href}
            href={t.href}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="group rounded-xl border p-4 flex flex-col gap-1 transition-all hover:-translate-y-0.5"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-semibold truncate" style={{ color: t.highlight || 'var(--text)' }}>
                {t.label}
              </span>
              <ExternalLink size={13} className="flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-faint)' }} />
            </div>
            <span className="text-[12px] leading-snug" style={{ color: 'var(--text-soft)' }}>{t.desc}</span>
          </a>
        ))}
      </div>
    </section>
  )
}
