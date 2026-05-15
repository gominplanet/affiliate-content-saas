'use client'

import { useState, useEffect } from 'react'
import { CheckCircle, Zap } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'

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
  tier: 'free' | 'starter' | 'growth' | 'pro'
  label: string
  price: number
  regularPrice: number
  limit: string
  description: string
  features: string[]
  highlight: boolean
  ctaLabel: string
}

type PlanExt = Plan & { bonus?: string }

const plans: PlanExt[] = [
  {
    tier: 'free',
    label: 'Free',
    price: 0,
    regularPrice: 0,
    limit: '15 posts lifetime',
    description: 'A real trial — not a teaser. Run the full YouTube workflow on 15 real reviews before paying a cent.',
    features: [
      '15 full reviews (lifetime)',
      'YouTube Studio autopilot — description, tags, hashtags & thumbnail pushed back',
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
    tier: 'starter',
    label: 'Starter',
    price: 49,
    regularPrice: 99,
    limit: '30 posts / month',
    description: 'Replace your "I\'ll do it this weekend" — and actually ship a few reviews a week.',
    features: [
      '30 full reviews per month',
      'Everything in Free',
      'Monthly cap resets on the 1st — no rollover, no surprises',
    ],
    highlight: false,
    ctaLabel: 'Get Starter',
  },
  {
    tier: 'growth',
    label: 'Growth',
    price: 99,
    regularPrice: 199,
    limit: '80 posts / month',
    bonus: '60 + 20 bonus posts',
    description: 'Daily publishers + creators clearing a backlog. Fan-out to every major social, every time.',
    features: [
      '80 full reviews per month (60 + 20 bonus)',
      'Everything in Starter',
      'Threads auto-post',
      'Bluesky auto-post',
      'LinkedIn auto-post',
      'Pinterest auto-post *',
      'Priority generation queue (your jobs jump the line)',
    ],
    highlight: true,
    ctaLabel: 'Get Growth',
  },
  {
    tier: 'pro',
    label: 'Pro',
    price: 199,
    regularPrice: 499,
    limit: '150 posts / month',
    bonus: '90 + 60 bonus posts',
    description: 'Run an affiliate channel like a media company. One-click everything — YouTube settings included.',
    features: [
      'One-click Apply to YouTube — playlist, schedule, paid-promotion disclosure, made-for-kids, notify-off, all batched',
      '150 full reviews per month (90 + 60 bonus)',
      'Everything in Growth',
      'X (Twitter) auto-post',
      'One-click Publish All — site + every social in one shot',
      'Priority human support',
    ],
    highlight: false,
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
    if (tier === 'free') {
      // No checkout needed — just send them to signup. After signup they land
      // on /dashboard with the default free tier.
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
          Every plan — even Free — includes the full agent pipeline, the YouTube Studio autopilot,
          and a branded review site. Pick a tier by how many reviews you actually publish.
        </p>
        <p className="mt-2 text-sm font-semibold text-[#34c759]">Early access pricing — locked in for life on the tier you subscribe to.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-7xl">
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
              disabled={loading === plan.tier}
              className={`w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-60 ${
                plan.highlight
                  ? 'bg-white dark:bg-[#1c1c1e] text-[#0071e3] hover:bg-blue-50'
                  : 'bg-[#0071e3] text-white hover:bg-[#0062c4]'
              }`}
            >
              {loading === plan.tier ? 'Redirecting…' : plan.ctaLabel}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-10 text-sm text-[#86868b] dark:text-[#8e8e93] max-w-2xl text-center px-4">
        * Pinterest auto-publish is built and waiting on Pinterest&apos;s developer review.
        It activates automatically on Growth &amp; Pro accounts once approved at no extra cost.
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
