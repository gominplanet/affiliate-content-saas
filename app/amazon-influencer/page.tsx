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
import NextImage from 'next/image'
import {
  Wand2, LayoutTemplate, Handshake, MessageSquare, PackageSearch, Radar,
  Send, UserSquare, Zap, Check, ArrowRight, ShoppingBag, ShieldCheck, Lock,
} from 'lucide-react'
import { SALES_PAUSED, SALES_PAUSED_MESSAGE } from '@/lib/sales-paused'
import { CheckoutButton } from '../pricing/CheckoutButton'
import { TIERS } from '@/lib/tier'
import { freeTrialHighlights, freeTrialExclusions } from '@/lib/free-trial'

export const metadata: Metadata = {
  title: 'MVP for Amazon Influencers — thumbnails, designs & brand deals',
  description:
    'Built for Amazon Associates & Influencers. Turn any product into scroll-stopping thumbnails and ready-to-post pins, Reels and Facebook designs, and land brand deals. No blog, no YouTube required.',
}

const ACCENT = '#C2410C'

// The allowances on the cards are READ FROM THE PLAN, never typed here.
//
// Typed, they went stale: this page sold 300 pins, 150 Reels, 45 Facebook posts,
// 50 pitches and 100 published posts a month, while the plan had been trimmed to
// 150 / 100 / 40 / 40 / 60 to fit its cost ceiling. Someone paying $79 for 300
// pins would have been cut off at 150 with a message about their plan limit,
// which is a refund conversation, not a support one.
const AMZ = TIERS.amazon

// Same rule for the free plan: the numbers come from lib/free-trial.ts, which is
// also what the server enforces and what /pricing renders.
const FREE_THUMBS = TIERS.trial.thumbnailsPerMonth
const FREE_DESIGNS = TIERS.trial.socialDesignsPerMonth

const FEATURES: { icon: React.ReactNode; title: string; tag: string; desc: string }[] = [
  { icon: <Wand2 size={20} />, title: 'One-click video-review thumbnails', tag: `${AMZ.thumbnailsPerMonth} / month`, desc: 'Drop in any Amazon product and get an incredible video-review thumbnail in one click, the scroll-stopping cover that makes shoppers hit play on your storefront review. The same Art Director engine our top video creators use.' },
  { icon: <LayoutTemplate size={20} />, title: 'Ready-to-post designs', tag: `${AMZ.pinsPerMonth} pins · ${AMZ.igPostsPerMonth} Reels · ${AMZ.facebookPostsPerMonth} FB`, desc: 'Finished Pinterest pins, Instagram Reels covers and Facebook posts, laid out and captioned for you. No Canva, no templates to fight. Post them as they are.' },
  { icon: <Handshake size={20} />, title: 'Daily brand-deal digest', tag: 'Picked for you', desc: 'Every day MVP sends you a fresh, ranked list of Creator Connections campaigns auto-matched to your storefront, your niche and what you actually post, each scored on payout and how full the roster is. The deals worth your time, surfaced for you, so you stop digging through the whole catalogue.' },
  { icon: <MessageSquare size={20} />, title: 'Outreach written for you', tag: `${AMZ.collabsPerMonth} pitches / month`, desc: 'For any campaign, MVP drafts a personalized pitch from your media kit and drops it straight into Amazon’s own Message Brand box. You review the wording and hit send.' },
  { icon: <PackageSearch size={20} />, title: 'Amazon Product Research', tag: 'Unlimited browse', desc: 'Filter the whole Amazon catalogue by sales, rating, price, review ratio and competition. Find the products worth posting before you spend a design on them.' },
  { icon: <Radar size={20} />, title: 'Deal Radar', tag: 'Unlimited browse', desc: 'Live, price-history-verified Amazon deals. Jump on a real price drop the day it happens and turn it into a post while it is still hot.' },
  { icon: <ShoppingBag size={20} />, title: 'Idea List → Shopping Guide', tag: 'Up to Top 20', desc: 'Point MVP at one of your Amazon idea lists and it checks every product, ranks them by your own sales, demand, live deals and ratings, then writes a full shopping-guide post with your affiliate links and a call-to-action back to the whole list on Amazon.' },
  { icon: <Send size={20} />, title: 'Publish for you', tag: `${AMZ.dealsPerMonth} posts / month`, desc: 'Push product and deal posts straight to Facebook, Pinterest and Instagram, all three at once, from one screen. Copy written, design done, you approve and it goes.' },
  { icon: <UserSquare size={20} />, title: 'Your face on every design', tag: `${AMZ.maxFaces} model · ${AMZ.photoboothPerMonth} headshots`, desc: 'Add one face model and MVP puts you in the designs. Run the photobooth for 6 studio-quality headshots so your posts look like you, not stock. Prefer not to? Switch to product-only designs anytime.' },
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
            <NextImage src="/png/mvp-affiliate-amz.png" alt="MVP Amazon Influencer" width={28} height={28} className="w-7 h-7 rounded-lg" />
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
          <NextImage src="/png/mvp-affiliate-amz.png" alt="MVP Amazon Influencer" width={96} height={96} priority className="mx-auto mb-5 w-20 h-20 sm:w-24 sm:h-24 rounded-3xl shadow-lg" />
          <p className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: ACCENT }}>For Amazon Associates & Influencers</p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05] max-w-3xl mx-auto">
            Every product, post-ready in one click.
          </h1>
          <p className="mt-5 text-lg text-[#6e6e73] dark:text-[#ebebf0] max-w-2xl mx-auto leading-relaxed">
            No blog. No YouTube. Generate incredible Amazon video-review thumbnails in one click, turn
            any product into ready-to-post pins, Reels and Facebook designs with your face on them,
            publish everywhere at once, and get matched to paid brand deals, all from one place.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            {/* The free CTA leads. Someone arriving from an ad has not decided
                to spend $79 on a product they have never seen make anything;
                they have decided to look. Sending them straight to a finished
                design with their own face on it is the argument, and the paid
                button is right beside it for anyone who is already sold.
                nextPath drops them in the thumbnail generator rather than a
                generic dashboard, which is where that intent gets spent. */}
            {/* salesPaused is false on the free button on purpose: SALES_PAUSED
                stops PAID checkout, and pausing free signups along with it would
                close the door on the traffic the ads are already paying for. */}
            <div className="w-full sm:w-64">
              <CheckoutButton tier="trial" highlight={true} salesPaused={false} ctaLabel="Start free, no card" nextPath="/amazon/thumbnails" />
            </div>
            <div className="w-full sm:w-64">
              <CheckoutButton tier="amazon" highlight={false} salesPaused={SALES_PAUSED} ctaLabel="Get Amazon Influencer" />
            </div>
          </div>
          <p className="mt-4 text-sm text-[#86868b] dark:text-[#8e8e93]">
            Free: {FREE_THUMBS} thumbnails, {FREE_DESIGNS} designs and your own face on them, yours to download.
            Then <span className="text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">$79</span>/mo{' '}
            <span className="line-through">$129</span> · save $50 for life
          </p>
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

        {/* Try it free — what the trial is, and just as plainly what it is not.
            A trial that hides its walls until somebody hits one produces a
            support ticket instead of an upgrade, so the exclusions sit in the
            same box as the inclusions rather than in a footnote. */}
        <div className="mt-12 max-w-3xl mx-auto rounded-2xl border border-gray-200 dark:border-white/10 p-6 bg-white dark:bg-[#1c1c1e]">
          <h3 className="text-xl font-bold tracking-tight">Try the whole loop free first</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0]">
            No card. No website. No YouTube channel. Add your Amazon Associates tag, paste a product
            link, and download a finished design with your face on it. That is the whole product in
            about two minutes.
          </p>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: ACCENT }}>Free includes</p>
              <ul className="space-y-1.5">
                {freeTrialHighlights().map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0]">
                    <Check size={14} className="mt-0.5 flex-shrink-0" style={{ color: ACCENT }} />{f}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] mb-2 text-[#86868b] dark:text-[#8e8e93]">Needs the $79 plan</p>
              <ul className="space-y-1.5">
                {freeTrialExclusions().map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px] leading-relaxed text-[#86868b] dark:text-[#8e8e93]">
                    <Lock size={13} className="mt-0.5 flex-shrink-0" />{f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-6 w-full sm:w-72">
            <CheckoutButton tier="trial" highlight={true} salesPaused={false} ctaLabel="Start free, no card" nextPath="/amazon/thumbnails" />
          </div>
        </div>

        {/* No-sleaze rule — privacy dig, subtle and unnamed. */}
        <div className="mt-12 max-w-3xl mx-auto rounded-2xl border p-6 flex items-start gap-4" style={{ borderColor: 'rgba(234,88,12,0.30)', background: 'linear-gradient(180deg, rgba(234,88,12,0.06), transparent)' }}>
          <span className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0 text-white" style={{ backgroundColor: ACCENT }}><ShieldCheck size={20} /></span>
          <div>
            <p className="font-bold text-[15px] mb-1">Our no-sleaze rule</p>
            <p className="text-[13.5px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0]">
              Some of these tools quietly turn your sales into their research, and their next product. MVP Affiliate never touches your numbers for anything but you.
            </p>
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
        <h2 className="text-3xl font-bold tracking-tight">From storefront to scroll-stopping, without the studio.</h2>
        <p className="mt-3 text-[15px] text-[#6e6e73] dark:text-[#ebebf0]">
          Start free, no card. Then $79/mo, locked for life. Cancel anytime.
        </p>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-[#6e6e73] dark:text-[#ebebf0]">
          {['No website needed', 'No card to start', 'Priority support'].map((f) => (
            <li key={f} className="flex items-center gap-1.5"><Check size={14} style={{ color: ACCENT }} />{f}</li>
          ))}
        </ul>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <div className="w-full sm:w-64">
            <CheckoutButton tier="trial" highlight={true} salesPaused={false} ctaLabel="Start free, no card" nextPath="/amazon/thumbnails" />
          </div>
          <div className="w-full sm:w-64">
            <CheckoutButton tier="amazon" highlight={false} salesPaused={SALES_PAUSED} ctaLabel="Get Amazon Influencer" />
          </div>
        </div>
      </section>
    </div>
  )
}
