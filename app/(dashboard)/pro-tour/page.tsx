// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /pro-tour — the long-form capabilities tour of what's shipped on Pro today,
// for logged-in creators. The body lives in components/tour/tour-content.tsx
// and is shared with the PUBLIC marketing tour at /tour (ctaMode="public"),
// so the two never drift. This page just supplies the in-app hero + the
// dashboard page chrome and renders the shared body in "app" mode (CTAs deep
// link into the product). Linked from the dashboard banner.

import type { Metadata } from 'next'
import { Compass } from 'lucide-react'
import { TourBody } from '@/components/tour/tour-content'

export const metadata: Metadata = {
  title: 'Pro capabilities tour',
  description: 'Every Pro feature live on MVP Affiliate today.',
}

export default function ProTourPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--page-bg)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <header className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Compass size={14} className="text-[#7C3AED]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>
              Capabilities tour
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4" style={{ color: 'var(--text)' }}>
            Everything Pro unlocks on MVP Affiliate today
          </h1>
          <p className="text-[15px] leading-relaxed max-w-3xl" style={{ color: 'var(--text-soft)' }}>
            If you&apos;re running review content as a real business — multiple sites, a team, a growing newsletter,
            brand deals — you&apos;ve outgrown the &quot;one tool per job&quot; approach. This is the full tour of what&apos;s
            shipped on Pro right now. No roadmap, no &quot;coming soon.&quot; Just what works today.
          </p>
        </header>

        <TourBody ctaMode="app" />
      </div>
    </div>
  )
}
