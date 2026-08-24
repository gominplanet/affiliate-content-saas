// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Influencer → Research hub. A single launchpad to the product- and
// campaign-discovery tools an Amazon storefront creator uses to decide what to
// review next. These are existing pages; this is just the curated front door.
import type { Metadata } from 'next'
import Link from 'next/link'
import { PackageSearch, Radar, BadgePercent, Bookmark, ArrowRight } from 'lucide-react'
import PageExplainer from '@/components/amazon/PageExplainer'
import ScoutInfoCard from '@/components/amazon/ScoutInfoCard'

export const metadata: Metadata = {
  title: 'Research — Amazon Influencer',
  description: 'Find products and brand campaigns worth reviewing.',
}

const TOOLS = [
  {
    href: '/amz-finder',
    icon: PackageSearch,
    title: 'AMZ Research',
    desc: 'Search the whole Amazon catalogue. Find trending, high-commission products to review, then send them straight to the Thumbnail Generator.',
  },
  {
    href: '/deal-radar',
    icon: Radar,
    title: 'Deal Radar',
    desc: 'Live Amazon deals with price history and deal scores. Catch a real markdown before it sells out.',
  },
  {
    href: '/cc-campaigns',
    icon: BadgePercent,
    title: 'CC Campaigns',
    desc: 'Amazon Creator Connections. Browse brand campaigns paying a bounty on top of commission, ranked by payout and trust.',
  },
  {
    href: '/saved-campaigns',
    icon: Bookmark,
    title: 'Saved Campaigns',
    desc: 'The campaigns you bookmarked to act on. Your shortlist of brand deals to shoot and post.',
  },
]

export default function AmazonResearchPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <PackageSearch size={14} className="text-[#d97706]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>
            Amazon Influencer · Research
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2" style={{ color: 'var(--text)' }}>
          Find what to review next
        </h1>
        <p className="text-sm max-w-2xl" style={{ color: 'var(--text-soft)' }}>
          Everything you need to source products and brand deals worth making content about, in one place.
        </p>
      </header>

      <PageExplainer
        eyebrow="New here? Start with what to post"
        heading="Decide what to feature before you make it"
        intro="This is where you pick your next winner. Instead of guessing, you can see what is actually selling, catch real price drops, and find brands paying a bounty. Browsing all of it is unlimited and free, you only spend a design once you have found something worth posting."
        steps={[
          { title: 'Find a product', body: 'Use AMZ Research to search the whole catalogue by sales, rating, price and commission, and find products worth reviewing.' },
          { title: 'Catch a live deal', body: 'Deal Radar shows real Amazon markdowns with price history, so you post a genuine drop the day it happens, not a fake “was” price.' },
          { title: 'Check brand deals', body: 'CC Campaigns lists Amazon Creator Connections offers, brands paying a bounty on top of commission, ranked by payout and how full the roster is.' },
          { title: 'Shortlist & make it', body: 'Bookmark the good ones to Saved Campaigns, then send a product straight into the Thumbnail Generator to design the post.' },
        ]}
        footnote="Rule of thumb: research is free, so browse as much as you like. Only turn a find into a design and a post once you are sure it is worth it."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TOOLS.map((t) => {
          const Icon = t.icon
          return (
            <Link
              key={t.href}
              href={t.href}
              className="group flex flex-col gap-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 hover:border-[#d97706]/50 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-[#d97706]/10 flex items-center justify-center">
                  <Icon size={18} className="text-[#d97706]" />
                </div>
                <ArrowRight size={16} className="text-[#86868b] group-hover:text-[#d97706] group-hover:translate-x-0.5 transition" />
              </div>
              <div>
                <h2 className="text-base font-bold mb-1" style={{ color: 'var(--text)' }}>{t.title}</h2>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{t.desc}</p>
              </div>
            </Link>
          )
        })}
      </div>

      {/* SCOUT explainer — Creator Connections + earnings need the extension. */}
      <div className="mt-6">
        <ScoutInfoCard />
      </div>
    </div>
  )
}
