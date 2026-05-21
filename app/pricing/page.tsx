'use client'

import { useState, useEffect } from 'react'
import { CheckCircle, Zap } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import { SALES_PAUSED, SALES_PAUSED_MESSAGE } from '@/lib/sales-paused'

// Rewardful injects a global `Rewardful` object once the script is ready.
// Declared here so TypeScript stops complaining about the access below.
declare global {
  interface Window {
    Rewardful?: { referral?: string | null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rewardful?: (event: string, cb: () => void) => void
  }
}

type Plan = {
  tier: 'trial' | 'creator' | 'pro'
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
      'YouTube Co-Pilot — description, tags, hashtags & thumbnail pushed back to YouTube Studio',
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
      'Built-in AI assistant that knows your brand — product help + affiliate coaching (one less subscription to pay for)',
      '5 brand-collab pitch emails / month (try the Pro feature)',
      'Monthly cap resets on your billing date — no rollover, no surprises',
    ],
    highlight: false,
    ctaLabel: 'Get Creator',
  },
  {
    tier: 'pro',
    label: 'Pro',
    price: 199,
    regularPrice: 499,
    limit: '200 posts / month',
    bonus: '140 + 60 bonus posts',
    description: 'Become the creator brands want. One video becomes a YouTube package, a blog review, and a post on every major social — so when a brand asks "where will this go?", your answer is a list, not a sentence.',
    features: [
      '200 full reviews per month (140 + 60 bonus)',
      '100 brand-collab pitch emails / month — your direct lever for deal flow',
      'For Amazon influencers & associates: scout Creator Connections campaigns by commission & EPC, then one-click research, write & publish',
      'Native AI Instagram image — your trained face + the actual product, 4:5 (50 / month)',
      'Custom face training for AI thumbnails & IG images',
      'Near-unlimited AI assistant that knows your business — your reviews, niches & campaigns in context',
      'Adds Instagram, X & Telegram on top of Creator’s platforms',
      'One-click Apply to YouTube — playlist, schedule, paid-promotion, made-for-kids, all batched',
      'One-click Publish All — site + every social in one shot',
      'Priority queue + priority human support',
    ],
    highlight: true,
    ctaLabel: 'Get Pro',
  },
]

export default function PricingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [referral, setReferral] = useState<string | null>(null)

  // Capture Rewardful referral ID once the tracking script signals ready.
  // We pass this to Stripe checkout below so the conversion gets attributed.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.rewardful) return
    window.rewardful('ready', () => {
      setReferral(window.Rewardful?.referral ?? null)
    })
  }, [])

  async function handleCheckout(tier: Plan['tier']) {
    if (tier === 'trial') {
      // No checkout needed — just send them to signup. After signup they land
      // on /dashboard with the default trial tier.
      router.push('/signup?next=/dashboard')
      return
    }

    setLoading(tier)
    try {
      // Check auth client-side first. If we just POST to /api/stripe/checkout
      // while logged out, middleware redirects to /login (307) and fetch
      // silently follows the redirect, leaving the user staring at a
      // do-nothing button. So we bounce them to signup ourselves.
      const supabase = createBrowserClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push(`/signup?next=/pricing&tier=${tier}`)
        return
      }

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, referral }),
      })
      const { url, error } = await res.json()
      if (error) { alert(error); return }
      if (url) window.location.href = url
    } finally {
      setLoading(null)
    }
  }

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">
        {plans.map((plan) => (
          <div
            key={plan.tier}
            className={`rounded-2xl p-8 flex flex-col ${
              plan.highlight
                ? 'bg-[#0071e3] text-white shadow-2xl scale-105'
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
                <Zap size={14} className="text-[#0071e3]" />
                <span className="text-xs font-semibold text-[#0071e3] uppercase tracking-wide">{plan.badge}</span>
              </div>
            )}
            <p className={`text-sm font-semibold mb-1 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>{plan.label}</p>
            <div className="flex items-end gap-2 mb-1">
              <span className="text-5xl font-bold">${plan.price}</span>
              {plan.price > 0 && (
                <span className={`text-sm mb-2 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>/month</span>
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
            <p className={`text-sm mb-2 font-medium ${plan.highlight ? 'text-blue-100' : 'text-[#0071e3]'}`}>{plan.limit}</p>
            <p className={`text-sm mb-6 ${plan.highlight ? 'text-blue-100' : 'text-[#6e6e73] dark:text-[#ebebf0]'}`}>{plan.description}</p>

            <ul className="flex flex-col gap-3 mb-8 flex-1">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <CheckCircle size={15} className={`mt-0.5 flex-shrink-0 ${plan.highlight ? 'text-blue-200' : 'text-[#34c759]'}`} />
                  <span className={plan.highlight ? 'text-blue-50' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}>{f}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleCheckout(plan.tier)}
              disabled={loading === plan.tier || SALES_PAUSED}
              className={`w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                plan.highlight
                  ? 'bg-white dark:bg-[#1c1c1e] text-[#0071e3] hover:bg-blue-50'
                  : 'bg-[#0071e3] text-white hover:bg-[#0062c4]'
              }`}
            >
              {SALES_PAUSED ? 'Sales paused' : loading === plan.tier ? 'Redirecting…' : plan.ctaLabel}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-10 text-sm text-[#86868b] dark:text-[#8e8e93] max-w-2xl text-center px-4">
        * Pinterest auto-publish is built and waiting on Pinterest&apos;s developer review.
        It activates automatically on Creator &amp; Pro accounts once approved at no extra cost.
      </p>
      <div className="mt-6 max-w-2xl rounded-2xl bg-[#0071e3]/5 border border-[#0071e3]/20 p-5">
        <p className="text-center text-sm font-semibold text-[#0071e3] mb-1.5">🔒 Price-lock guarantee</p>
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
