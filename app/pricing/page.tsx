/**
 * Public pricing page. Converted to a Server Component (#47) — the entire
 * static layout (hero, three plan cards, feature lists, price-lock callout,
 * footer) ships as RSC HTML. Only the Stripe-checkout CTA hydrates as a
 * tiny client island (`./CheckoutButton`). The Rewardful effect, the loading
 * state and the signed-in-or-not bounce live inside that island so they
 * stay client-side without dragging the whole page bundle along.
 *
 * Net effect: substantially smaller per-page JS for a route that drives
 * conversions — better LCP, better Lighthouse on mobile, no behaviour
 * change from the user's side.
 */

import type { Metadata } from 'next'
import { CheckCircle, Zap } from 'lucide-react'
import { SALES_PAUSED, SALES_PAUSED_MESSAGE } from '@/lib/sales-paused'
import { CheckoutButton } from './CheckoutButton'

export const metadata: Metadata = { title: 'Pricing — MVP Affiliate' }

type Plan = {
  tier: 'trial' | 'creator' | 'studio' | 'pro'
  label: string
  price: number
  regularPrice: number
  limit: string
  description: string
  features: string[]
  highlight: boolean
  ctaLabel: string
}

type PlanExt = Plan & { bonus?: string; badge?: string }

const plans: PlanExt[] = [
  {
    tier: 'trial',
    label: 'Free Trial',
    price: 0,
    regularPrice: 0,
    limit: '5 posts — no card',
    description: 'A real trial, not a teaser. Run the full YouTube workflow on 5 real reviews before paying a cent. No card, no time limit.',
    features: [
      '5 full reviews (lifetime — no time limit)',
      'YouTube Co-Pilot — description, tags, hashtags & thumbnail pushed back to YouTube',
      'Branded WordPress review site (theme + plugin auto-installed)',
      'One-click publish to your site',
      'Facebook auto-post',
      'Full AI agent pipeline (research → outline → draft → verdict → SEO)',
      'Geniuslink affiliate-link wrapping',
    ],
    highlight: false,
    ctaLabel: 'Start free',
  },
  {
    tier: 'creator',
    label: 'Creator',
    price: 49,
    regularPrice: 99,
    limit: '40 posts / month',
    description: 'For creators shipping a few reviews a week across the major socials — and trying the Pro brand-pitch workflow that lands deals.',
    features: [
      '40 full reviews per month',
      'Everything in the trial, uncapped monthly',
      'Auto-post to Facebook, Threads, Bluesky, LinkedIn, Pinterest *',
      'In-body AI product images (up to 3 per post)',
      'Your Face in AI thumbnails + studio Photobooth headshots (2 faces)',
      'Built-in AI assistant that knows your brand — product help + affiliate coaching (one less subscription to pay for)',
      '5 brand-collab pitch emails / month (try the Pro feature)',
      'Monthly cap resets on your billing date — no rollover, no surprises',
    ],
    highlight: false,
    ctaLabel: 'Get Creator',
  },
  {
    tier: 'studio',
    label: 'Studio',
    price: 99,
    regularPrice: 199,
    limit: '80 posts / month',
    description: 'For the serious solo affiliate creator. Everything in Creator + TikTok, Instagram, scripts, comparison posts, and the browser extension — the full toolkit on one site.',
    features: [
      '80 full reviews per month',
      'Adds TikTok + Instagram direct-post on top of Creator’s 5 platforms',
      'Comparison & Guide posts — let MVP rank 5 products into one review',
      'Video Script & Shot List generator (15 / month) — pre-production AI in your voice',
      'Browser extension — capture real video keyframes for thumbnails (vidIQ-grade)',
      'Brand voice training (LEARN) — every review reads more like you over time',
      '15 brand-collab pitch emails / month',
      '5,000 newsletter subscribers + 10 broadcasts / month',
      '1,000 AI assistant messages / month',
      '80 thumbnails + 80 YouTube Co-Pilot metadata refreshes / month',
    ],
    highlight: true,
    ctaLabel: 'Get Studio',
  },
  {
    tier: 'pro',
    label: 'Pro',
    price: 199,
    regularPrice: 499,
    limit: '200 posts / month',
    bonus: '140 + 60 bonus posts',
    description: 'Become the creator brands want. Multi-account social, Creator Campaigns, one-click Publish All, and every cap raised — so when a brand asks "where will this go?", your answer is a list, not a sentence.',
    features: [
      '200 full reviews per month (140 + 60 bonus)',
      'Multi-account social — connect multiple Facebook Pages, Instagram accounts, TikTok accounts',
      'For Amazon influencers & associates: scout Creator Connections campaigns by commission & EPC, then one-click research, write & publish',
      'One-click Publish All — site + every social in one shot',
      'Native AI Instagram image — your face + the actual product, 4:5 (50 / month)',
      'Adds X & Telegram on top of Studio’s platforms',
      'Double the Photobooth headshots — 20 / month',
      'Near-unlimited AI assistant — your reviews, niches & campaigns in context',
      '100 brand-collab pitch emails / month — your direct lever for deal flow',
      'Video scripts 30 / month · newsletter unlimited broadcasts · 10k subscribers',
      'One-click Apply to YouTube — playlist, schedule, paid-promotion, made-for-kids, all batched',
      'Priority queue + priority human support',
    ],
    highlight: false,
    ctaLabel: 'Get Pro',
  },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#000] flex flex-col items-center px-4 py-16">
      <div className="text-center mb-12 max-w-2xl">
        <h1 className="text-4xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Pricing built for how often you ship</h1>
        <p className="text-lg text-[#6e6e73] dark:text-[#ebebf0]">
          Every plan — even Free — includes the full agent pipeline, the YouTube Co-Pilot,
          and a branded review site. Pick a tier by how many reviews you actually publish.
        </p>
        <p className="mt-2 text-sm font-semibold text-[#34c759]">Early access pricing — locked in for life on the tier you subscribe to.</p>
      </div>

      {SALES_PAUSED && (
        <div className="w-full max-w-3xl mb-8 rounded-2xl bg-[#ff9500]/10 border border-[#ff9500]/30 p-5 text-center">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Sign-ups & purchases temporarily paused</p>
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">{SALES_PAUSED_MESSAGE}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full max-w-6xl">
        {plans.map((plan) => (
          <div
            key={plan.tier}
            className={`rounded-2xl p-6 lg:p-7 flex flex-col ${
              plan.highlight
                ? 'bg-[#7C3AED] text-white shadow-2xl lg:scale-105 ring-1 ring-[#7C3AED]/40'
                : 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-sm border border-gray-200 dark:border-white/10'
            }`}
          >
            {plan.highlight && (
              <div className="flex items-center gap-1.5 mb-4">
                <Zap size={14} className="text-yellow-300" />
                <span className="text-xs font-semibold text-yellow-300 uppercase tracking-wide">Most Popular</span>
              </div>
            )}
            {!plan.highlight && plan.badge && (
              <div className="flex items-center gap-1.5 mb-4">
                <Zap size={14} className="text-[#7C3AED]" />
                <span className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wide">{plan.badge}</span>
              </div>
            )}
            <p className={`text-sm font-semibold mb-1 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>{plan.label}</p>
            <div className="flex items-end gap-1.5 mb-1">
              <span className="text-4xl font-bold tracking-tight">${plan.price}</span>
              {plan.price > 0 && (
                <span className={`text-sm mb-1.5 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>/month</span>
              )}
            </div>
            {plan.regularPrice > plan.price && (
              <p className={`text-xs mb-1 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>
                <span className="line-through">${plan.regularPrice}/month</span>{' '}
                <span className={plan.highlight ? 'text-yellow-300 font-semibold' : 'text-[#34c759] font-semibold'}>
                  Save ${plan.regularPrice - plan.price}
                </span>
              </p>
            )}
            <p className={`text-sm mb-2 font-medium ${plan.highlight ? 'text-blue-100' : 'text-[#7C3AED]'}`}>{plan.limit}</p>
            <p className={`text-sm mb-6 ${plan.highlight ? 'text-blue-100' : 'text-[#6e6e73] dark:text-[#ebebf0]'}`}>{plan.description}</p>

            <ul className="flex flex-col gap-3 mb-8 flex-1">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <CheckCircle size={15} className={`mt-0.5 flex-shrink-0 ${plan.highlight ? 'text-blue-200' : 'text-[#34c759]'}`} />
                  <span className={plan.highlight ? 'text-blue-50' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}>{f}</span>
                </li>
              ))}
            </ul>

            {/* The only client island on this page — keeps Rewardful + the
                signed-in check + Stripe redirect on the client, while the
                card around it stays server-rendered. */}
            <CheckoutButton
              tier={plan.tier}
              highlight={plan.highlight}
              salesPaused={SALES_PAUSED}
              ctaLabel={plan.ctaLabel}
            />
          </div>
        ))}
      </div>

      <p className="mt-10 text-sm text-[#86868b] dark:text-[#8e8e93] max-w-2xl text-center px-4">
        * Pinterest auto-publish is built and waiting on Pinterest&apos;s developer review.
        It activates automatically on Creator &amp; Pro accounts once approved at no extra cost.
      </p>
      <div className="mt-6 max-w-2xl rounded-2xl bg-[#7C3AED]/5 border border-[#7C3AED]/20 p-5">
        <p className="text-center text-sm font-semibold text-[#7C3AED] mb-1.5">🔒 Price-lock guarantee</p>
        <p className="text-center text-sm text-[#3a3a3c] dark:text-[#ebebf0] leading-relaxed">
          When you subscribe at these Early Access rates, your price stays locked in for as long as you
          keep your plan — even if we raise prices later. Your rate only changes if you choose to upgrade
          or downgrade tiers.
        </p>
      </div>
      <p className="mt-6 text-sm text-[#86868b] dark:text-[#8e8e93]">
        Cancel anytime. No contracts. Billed monthly via Stripe.
      </p>
    </div>
  )
}
