// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AmazonUpgradeGate — the upsell panel an Amazon Influencer sees when they open
// anything outside their plan (blog, YouTube, newsletter, SEO, etc.). Rendered
// by DashboardShellV2 in place of the page body whenever an amazon-tier user is
// on a locked path (see AMAZON_LOCKED_PREFIXES), so it covers every entry point
// — sidebar click, dashboard card, or a pasted deep link — from one place.
//
// The Amazon plan is a deliberately focused, blog-free / YouTube-free track, so
// the pull here is "here's the whole toolkit the paid creator plans add", not a
// single-feature nag.

'use client'

import Link from 'next/link'
import { Lock, ArrowRight, Check } from 'lucide-react'

const ACCENT = '#C2410C' // Amazon-hub orange, matches the sidebar section + /pricing

// What upgrading opens up. Concrete outcomes, not feature names.
const UNLOCKS: string[] = [
  'Publish full product-review blog posts to your own WordPress site, in your voice',
  'Turn any YouTube video into a blog, thumbnails, scripts and social posts',
  'Comparison posts and buying guides that rank products and win search',
  'A newsletter to your own list, with scheduling and segments',
  'SEO and indexing tools to get every post found on Google',
]

export default function AmazonUpgradeGate({ feature }: { feature: string }) {
  return (
    <div className="max-w-3xl mx-auto pt-6">
      <div
        className="rounded-2xl border p-8"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}
      >
        {/* Hero: icon + lock chip */}
        <div className="flex items-start gap-4 mb-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 relative"
            style={{ backgroundColor: `${ACCENT}1F`, color: ACCENT }}
          >
            <Lock size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <h2 className="text-[22px] font-semibold leading-tight" style={{ color: 'var(--text)' }}>
                {feature}
              </h2>
              <span
                className="text-[10px] font-bold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full"
                style={{ backgroundColor: `${ACCENT}26`, color: ACCENT }}
              >
                Not in Amazon Influencer
              </span>
            </div>
            <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              Your Amazon Influencer plan is built around your storefront: Art Director thumbnails,
              product research, and ready-to-post pins, Reels and Facebook designs. {feature} is part
              of MVP&apos;s full creator toolkit. Upgrade to add the whole blog and YouTube engine on top
              of everything you already have.
            </p>
          </div>
        </div>

        {/* What upgrading unlocks */}
        <ul className="mt-5 space-y-2.5">
          {UNLOCKS.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px]" style={{ color: 'var(--text-soft)' }}>
              <Check size={14} className="flex-shrink-0 mt-0.5" style={{ color: ACCENT }} strokeWidth={2.5} />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        {/* Footer: CTA + current-plan hint */}
        <div className="mt-6 pt-5 border-t flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
            You&apos;re on the <span className="font-semibold" style={{ color: 'var(--text-soft)' }}>Amazon Influencer</span> plan.
            Everything above is added, not swapped.
          </p>
          <Link
            href="/billing"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
            style={{ backgroundColor: ACCENT }}
          >
            See upgrade options
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  )
}
