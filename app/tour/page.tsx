// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /tour — the PUBLIC product tour. Same body as the in-app /pro-tour page
// (shared from components/tour/tour-content.tsx) but with marketing chrome:
// its own slim header + footer, a signup-oriented hero, and CTAs that route
// to /signup + /pricing instead of deep-linking into the authenticated app.
//
// Server Component (no client hooks) so the long static page ships as RSC
// HTML — fast LCP, good for an indexable, top-of-funnel marketing page.
// Whitelisted as public in middleware.ts ('/tour'). Linked from the sales
// page nav, hero, and footer.

import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { Compass, ArrowUpRight, ArrowRight } from 'lucide-react'
import { TourBody } from '@/components/tour/tour-content'

export const metadata: Metadata = {
  title: 'Product tour · MVP Affiliate',
  description:
    'The full tour of MVP Affiliate: turn a review video — or just a product link — into a blog post that ranks, comparisons, buying guides, thumbnails, a newsletter, brand pitches, and more, all fact-grounded and published to a blog you own. Everything that ships today.',
  alternates: { canonical: '/tour' },
  openGraph: {
    title: 'Product tour · MVP Affiliate',
    description:
      'Turn a review video — or just a product link — into content that ranks: blog, comparisons, buying guides, thumbnails, newsletter, brand outreach. The full tour of what ships today.',
    url: '/tour',
    type: 'website',
  },
}

// Public pages don't sit inside the dashboard layout (which supplies the
// theme tokens) or the sales page's inline DARK_VARS wrapper, so we declare
// the dark token set here on the page root — including the tokens that are
// NOT in globals.css :root (--page-bg, --surface-bright, --card-shadow).
// Mirrors the sales page's default dark theme for a seamless hop from the
// landing page into the tour.
const TOUR_DARK_VARS: CSSProperties = {
  ['--page-bg' as string]: '#0E0E11',
  ['--surface' as string]: 'rgba(255,255,255,0.04)',
  ['--surface-bright' as string]: 'rgba(255,255,255,0.08)',
  ['--border' as string]: 'rgba(255,255,255,0.08)',
  ['--text' as string]: '#F5F5F7',
  ['--text-soft' as string]: 'rgba(255,255,255,0.65)',
  ['--card-shadow' as string]: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.3)',
}

export default function PublicTourPage() {
  return (
    <div className="min-h-screen" style={{ ...TOUR_DARK_VARS, backgroundColor: 'var(--page-bg)' }}>

      {/* ── Slim public header ───────────────────────────────────────── */}
      <header
        className="sticky top-0 z-20 backdrop-blur-md px-5 sm:px-8 py-3.5 flex items-center justify-between"
        style={{ backgroundColor: 'rgba(14,14,17,0.6)', borderBottom: '1px solid var(--border)' }}
      >
        <Link href="/" className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#7C3AED] to-[#C026D3] flex items-center justify-center font-semibold text-white text-[14px]">M</span>
          <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text)' }}>
            MVP Affiliate
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/pricing"
            className="px-3 py-1.5 rounded-lg text-[13px] transition-colors hover:opacity-80"
            style={{ color: 'var(--text-soft)' }}
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="hidden sm:inline-flex px-3 py-1.5 rounded-lg text-[13px] transition-colors hover:opacity-80"
            style={{ color: 'var(--text-soft)' }}
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="px-3.5 py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-[13px] font-medium text-white transition-colors"
          >
            Start free
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <header className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Compass size={14} className="text-[#7C3AED]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>
              Product tour
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4" style={{ color: 'var(--text)' }}>
            Everything MVP Affiliate does today
          </h1>
          <p className="text-[15px] leading-relaxed max-w-3xl mb-6" style={{ color: 'var(--text-soft)' }}>
            One review video — or just a product or service link — becomes a blog post that ranks, plus comparisons,
            buying guides, a thumbnail, a newsletter, brand pitches, and more. All fact-grounded in your real video or
            real research, published to a blog you own. This is the full tour of what ships right now. No roadmap, no
            &quot;coming soon.&quot; Just what works today.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-semibold text-white"
              style={{ background: '#7C3AED' }}
            >
              Start free trial <ArrowUpRight size={13} />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-semibold border"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              Compare plans <ArrowRight size={13} />
            </Link>
          </div>
        </header>

        <TourBody ctaMode="public" />
      </div>

      {/* ── Slim footer ──────────────────────────────────────────────── */}
      <footer className="border-t mt-8" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#7C3AED] to-[#C026D3] flex items-center justify-center font-semibold text-white text-[12px]">M</span>
            <span className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
              © 2026 MVP Affiliate
            </span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]" style={{ color: 'var(--text-soft)' }}>
            <Link href="/" className="hover:opacity-80">Home</Link>
            <Link href="/pricing" className="hover:opacity-80">Pricing</Link>
            <Link href="/privacy" className="hover:opacity-80">Privacy</Link>
            <Link href="/terms" className="hover:opacity-80">Terms</Link>
            <Link href="/login" className="hover:opacity-80">Sign in</Link>
            <Link href="/signup" className="font-semibold text-[#7C3AED] hover:text-[#9D6BFF]">Start free →</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
