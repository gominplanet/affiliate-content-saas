// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AmazonDashboard — the landing page a real Amazon Influencer sees instead of
// the blog-oriented default dashboard. Two halves, as designed:
//   LEFT  — the toolkit they're paying for (their Amazon features, each a card
//           that deep-links into the tool).
//   RIGHT — the upgrade pitch: everything the full creator plans add on top.
//
// Rendered server-side for real amazon-tier users (dashboard/page.tsx) and
// client-side for an admin previewing via the view-as switcher.

'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import ScoutInfoCard from '@/components/amazon/ScoutInfoCard'
import {
  Wand2, PackageSearch, Share2, Handshake, Radar, UserSquare,
  FileText, Youtube, Scale, TrendingUp, Check, ArrowRight, Sparkles,
  Upload, Scissors, Radio,
} from 'lucide-react'
import { TIERS } from '@/lib/tier'
import {
  AMAZON_COPILOT_RUNS_PER_MONTH, AMAZON_LIVE_SHOWS_PER_MONTH,
  AMAZON_FIND_MOMENTS_PER_MONTH, AMAZON_CLIPS_PER_MONTH,
} from '@/lib/amazon-plan'

const ACCENT = '#C2410C' // Amazon-hub orange (sidebar + /pricing)

// EVERY NUMBER READ, NONE TYPED. These tiles said 50 deals a month, 1 face
// model and 6 photobooth shots long after the plan said otherwise.
const AMZ = TIERS.amazon

const TOOLKIT: { href: string; icon: ReactNode; title: string; desc: string }[] = [
  { href: '/amazon/thumbnails', icon: <Wand2 size={18} />, title: 'Thumbnails', desc: `Incredible Amazon video-review thumbnails in one click. ${AMZ.thumbnailsPerMonth} a month.` },
  { href: '/amazon/social', icon: <Share2 size={18} />, title: 'Social designs', desc: 'Ready-to-post pins and Reels designs, with Facebook reusing them, published to all three at once.' },
  { href: '/amazon/research', icon: <PackageSearch size={18} />, title: 'Product Research', desc: 'Filter the whole Amazon catalogue by sales, rating, price and competition.' },
  { href: '/cc-campaigns', icon: <Handshake size={18} />, title: 'Creator Connections', desc: 'A daily digest of brand campaigns auto-matched to your content. Messaging brands is unlimited.' },
  { href: '/deal-radar', icon: <Radar size={18} />, title: 'Deal Radar', desc: `Live, price-history-verified Amazon deals. Up to ${AMZ.dealsPerMonth} deal posts a month to Pinterest, Facebook and Instagram.` },
  { href: '/photobooth', icon: <UserSquare size={18} />, title: 'Face Models', desc: `Put your own face on every design. ${AMZ.maxFaces} models and ${AMZ.photoboothPerMonth} studio photobooth shots a month.` },
  // THE VIDEO ADDITIONS (Seb, 2026-10-05, for current and new Amazon members).
  { href: '/liftoff', icon: <Upload size={18} />, title: 'Bulk Amazon upload', desc: 'Upload a batch of review videos to your Amazon storefront through SCOUT, and to YouTube too when a channel is connected.' },
  { href: '/co-pilot', icon: <Youtube size={18} />, title: 'YouTube Co-Pilot', desc: `Titles, descriptions and tags for your videos on one connected channel. ${AMAZON_COPILOT_RUNS_PER_MONTH} runs a month.` },
  { href: '/clip-factory', icon: <Scissors size={18} />, title: 'Clip Factory', desc: `Find the best moments and post clips to Instagram and Facebook Reels. ${AMAZON_FIND_MOMENTS_PER_MONTH} Find moments and ${AMAZON_CLIPS_PER_MONTH} clips a month.` },
  { href: '/amazon-live', icon: <Radio size={18} />, title: 'Amazon Live', desc: `Prep before the show and follow-up after it. Up to ${AMAZON_LIVE_SHOWS_PER_MONTH} shows a month.` },
]

const UPGRADE: { icon: ReactNode; title: string; desc: string }[] = [
  { icon: <FileText size={16} />, title: 'A real blog', desc: 'Publish full product-review posts to your own WordPress site, in your voice.' },
  { icon: <Youtube size={16} />, title: 'Video to blog', desc: 'Turn any video into a blog post and a script, and post to TikTok, X, Threads and more.' },
  { icon: <Scale size={16} />, title: 'Comparisons & guides', desc: 'Head-to-head ranked posts and buying guides that win search.' },
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

      {/* SCOUT — the extension that powers Creator Connections + earnings. Shown
          right under the hero so new storefront users set it up first. */}
      <div className="px-6 sm:px-8 pt-8">
        <ScoutInfoCard />
      </div>

      {/* Split: toolkit (left) + upgrade pitch (right) */}
      <div className="px-6 sm:px-8 pb-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
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
              You&apos;ve got the storefront covered. Pro adds a whole content engine on top of
              everything you already have, so one product can become a blog post, a script and a
              week of social on every network, not just a design.
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
