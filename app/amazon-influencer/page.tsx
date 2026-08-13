// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /amazon-influencer — the dedicated sales page for Amazon Associates &
// Influencers, reached from the audience splitter on the homepage. Makes the
// Amazon tier the hero while still pointing to the full-suite plans for anyone
// who realises they want the blog/YouTube engine too.
//
// Route is /amazon-influencer (NOT /amazon) on purpose: /amazon/* is the
// in-dashboard tool group, and a public /amazon page would collide with it.

import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Wand2, LayoutTemplate, Handshake, MessageSquare, PackageSearch, Radar,
  Send, UserSquare, Zap, Check, ArrowRight, ShoppingBag,
} from 'lucide-react'
import { SALES_PAUSED, SALES_PAUSED_MESSAGE } from '@/lib/sales-paused'
import { CheckoutButton } from '../pricing/CheckoutButton'

export const metadata: Metadata = {
  title: 'MVP for Amazon Influencers — thumbnails, designs & brand deals',
  description:
    'Built for Amazon Associates & Influencers. Turn any product into scroll-stopping thumbnails and ready-to-post pins, Reels and Facebook designs, and land brand deals. No blog, no YouTube required.',
}

const ACCENT = '#C2410C'

const FEATURES: { icon: React.ReactNode; title: string; tag: string; desc: string }[] = [
  { icon: <Wand2 size={20} />, title: 'One-click video-review thumbnails', tag: '200 / month', desc: 'Drop in any Amazon product and get an incredible video-review thumbnail in one click, the scroll-stopping cover that makes shoppers hit play on your storefront review. The same Art Director engine our top video creators use.' },
  { icon: <LayoutTemplate size={20} />, title: 'Ready-to-post designs', tag: '300 pins · 150 Reels · 45 FB', desc: 'Finished Pinterest pins, Instagram Reels covers and Facebook posts, laid out and captioned for you. No Canva, no templates to fight. Post them as they are.' },
  { icon: <Handshake size={20} />, title: 'Creator Connections deals', tag: '50 brand deals / month', desc: 'Browse the full Creator Connections campaign catalogue and land the brand collabs worth your time. Track what you have applied to and what has come back.' },
  { icon: <MessageSquare size={20} />, title: 'Message brands direct', tag: 'Built in', desc: 'Pitch and negotiate with brands inside MVP. Draft the outreach, keep every conversation in one place, and turn a browse into a paid collaboration.' },
  { icon: <PackageSearch size={20} />, title: 'Amazon Product Research', tag: 'Unlimited browse', desc: 'Filter the whole Amazon catalogue by sales, rating, price, review ratio and competition. Find the products worth posting before you spend a design on them.' },
  { icon: <Radar size={20} />, title: 'Deal Radar', tag: 'Unlimited browse', desc: 'Live, price-history-verified Amazon deals. Jump on a real price drop the day it happens and turn it into a post while it is still hot.' },
  { icon: <Send size={20} />, title: 'Publish for you', tag: '100 posts / month', desc: 'Push product and deal posts straight to Facebook, Pinterest and Instagram, all three at once, from one screen. Copy written, design done, you approve and it goes.' },
  { icon: <UserSquare size={20} />, title: 'Your face on every design', tag: '1 model · 3 headshots', desc: 'Add one face model and MVP puts you in the designs. Run the photobooth for 3 studio-quality headshots so your posts look like you, not stock.' },
  { icon: <Zap size={20} />, title: 'Priority queue + support', tag: 'Included', desc: 'Your renders jump the line and your questions get answered first. When a deal is live you are not waiting behind the free tier.' },
]

const OTHER_TIERS: { name: string; price: string; blurb: string }[] = [
  { name: 'Creator', price: '$49', blurb: 'A blog + YouTube starter: 20 posts/mo, thumbnails, scripts, a taster newsletter.' },
  { name: 'Studio', price: '$99', blurb: 'The serious blogger: 45 posts/mo, Pinterest + Instagram, weekly newsletter, Deals Hub.' },
  { name: 'Pro', price: '$199', blurb: 'Agencies & power users: 100 posts/mo, every network, 3 VA seats, all content types.' },
]

export default function AmazonInfluencerPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0b0b0d] text-[#1d1d1f] dark:text-[#f5f5f7]">
      {/* Top bar */}
      <header className="sticky top-0 z-30 backdrop-blur border-b border-gray-200 dark:border-white/10 bg-white/80 dark:bg-[#0b0b0d]/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <span className="w-7 h-7 rounded-lg grid place-items-center text-white" style={{ backgroundColor: ACCENT }}><ShoppingBag size={15} /></span>
            MVP Affiliate
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/" className="text-[#6e6e73] dark:text-[#ebebf0] hover:opacity-80">Full suite</Link>
            <Link href="/login" className="font-semibold hover:opacity-80">Log in</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-gray-200 dark:border-white/10">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(60% 80% at 20% 10%, rgba(234,88,12,0.16), transparent 60%), radial-gradient(50% 60% at 90% 20%, rgba(234,88,12,0.10), transparent 65%)' }} />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-14 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: ACCENT }}>For Amazon Associates & Influencers</p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05] max-w-3xl mx-auto">
            Your storefront, running itself.
          </h1>
          <p className="mt-5 text-lg text-[#6e6e73] dark:text-[#ebebf0] max-w-2xl mx-auto leading-relaxed">
            No blog. No YouTube. Generate incredible Amazon video-review thumbnails in one click, turn
            any product into ready-to-post pins, Reels and Facebook designs with your face on them,
            publish everywhere at once, and land paid brand deals, all from one place.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <div className="w-full sm:w-64">
              <CheckoutButton tier="amazon" highlight={true} salesPaused={SALES_PAUSED} ctaLabel="Get Amazon Influencer" />
            </div>
            <p className="text-sm text-[#86868b] dark:text-[#8e8e93]">
              <span className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">$79</span>/mo{' '}
              <span className="line-through">$129</span> · save $50 for life
            </p>
          </div>
          {SALES_PAUSED && <p className="mt-4 text-sm text-[#ff9500]">{SALES_PAUSED_MESSAGE}</p>}
        </div>
      </section>

      {/* Feature grid — everything it comes with */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <div className="text-center mb-9">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Everything the plan comes with</h2>
          <p className="mt-3 text-[15px] text-[#6e6e73] dark:text-[#ebebf0] max-w-2xl mx-auto">
            It finds the products, writes the copy, designs the posts with your face on them, publishes
            them, and opens the door to paid brand deals. Here is exactly what you get.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((t) => (
            <div key={t.title} className="rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 p-5 flex flex-col">
              <div className="w-10 h-10 rounded-xl grid place-items-center mb-3" style={{ background: 'rgba(234,88,12,0.12)', color: ACCENT }}>{t.icon}</div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="font-semibold text-[15px]">{t.title}</p>
                <span className="text-[11px] font-semibold whitespace-nowrap px-2 py-0.5 rounded-full" style={{ background: 'rgba(234,88,12,0.10)', color: ACCENT }}>{t.tag}</span>
              </div>
              <p className="text-[13px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0]">{t.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <div className="inline-block w-full sm:w-72">
            <CheckoutButton tier="amazon" highlight={true} salesPaused={SALES_PAUSED} ctaLabel="Get Amazon Influencer" />
          </div>
        </div>
      </section>

      {/* Need the full suite? — the other plans, secondary */}
      <section className="border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold tracking-tight">Got a blog or a YouTube channel too?</h2>
            <p className="mt-3 text-[15px] text-[#6e6e73] dark:text-[#ebebf0] max-w-2xl mx-auto">
              The full-suite plans add the whole content engine, blog posts, video-to-blog, a
              newsletter and SEO, on top of everything above.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {OTHER_TIERS.map((t) => (
              <div key={t.name} className="rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 p-5">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="font-semibold text-[15px]">{t.name}</p>
                  <p className="text-lg font-bold">{t.price}<span className="text-xs font-normal text-[#86868b]">/mo</span></p>
                </div>
                <p className="text-[13px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0]">{t.blurb}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/pricing" className="inline-flex items-center gap-1.5 text-sm font-semibold hover:opacity-80" style={{ color: '#7C3AED' }}>
              Compare all plans <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
        <h2 className="text-3xl font-bold tracking-tight">Start turning products into posts.</h2>
        <p className="mt-3 text-[15px] text-[#6e6e73] dark:text-[#ebebf0]">
          $79/mo, locked for life. Cancel anytime.
        </p>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-[#6e6e73] dark:text-[#ebebf0]">
          {['No website needed', 'No credit card to browse research', 'Priority support'].map((f) => (
            <li key={f} className="flex items-center gap-1.5"><Check size={14} style={{ color: ACCENT }} />{f}</li>
          ))}
        </ul>
        <div className="mt-8 inline-block w-full sm:w-72">
          <CheckoutButton tier="amazon" highlight={true} salesPaused={SALES_PAUSED} ctaLabel="Get Amazon Influencer" />
        </div>
      </section>
    </div>
  )
}
