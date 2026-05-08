'use client'

import { useState } from 'react'
import { CheckCircle, Zap } from 'lucide-react'
import { useRouter } from 'next/navigation'

const plans = [
  {
    tier: 'starter',
    label: 'Starter',
    price: 25,
    limit: '4 videos / week',
    description: 'For creators building a consistent publishing rhythm.',
    features: [
      '4 blog posts per week',
      'AI-generated content',
      'WordPress auto-publish',
      'Facebook, Pinterest & Threads posting',
      'YouTube thumbnail integration',
    ],
    highlight: false,
  },
  {
    tier: 'growth',
    label: 'Growth',
    price: 40,
    limit: '1 video / day',
    description: 'For creators building a consistent publishing rhythm.',
    features: [
      '1 blog post per day',
      'Everything in Starter',
      'Priority support',
    ],
    highlight: true,
  },
  {
    tier: 'pro',
    label: 'Pro',
    price: 95,
    limit: '5 videos / day',
    description: 'Maximum output for serious affiliate marketers.',
    features: [
      '5 blog posts per day',
      'Everything in Growth',
      'Bulk content generation',
    ],
    highlight: false,
  },
]

export default function PricingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  async function handleCheckout(tier: string) {
    setLoading(tier)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      })
      const { url, error } = await res.json()
      if (error) { alert(error); return }
      router.push(url)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#000] flex flex-col items-center px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Simple, transparent pricing</h1>
        <p className="text-lg text-[#6e6e73] dark:text-[#ebebf0]">Turn your YouTube videos into affiliate blog posts automatically.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">
        {plans.map((plan) => (
          <div
            key={plan.tier}
            className={`rounded-2xl p-8 flex flex-col ${
              plan.highlight
                ? 'bg-[#0071e3] text-white shadow-2xl scale-105'
                : 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-sm border border-gray-200'
            }`}
          >
            {plan.highlight && (
              <div className="flex items-center gap-1.5 mb-4">
                <Zap size={14} className="text-yellow-300" />
                <span className="text-xs font-semibold text-yellow-300 uppercase tracking-wide">Most Popular</span>
              </div>
            )}
            <p className={`text-sm font-semibold mb-1 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>{plan.label}</p>
            <div className="flex items-end gap-1 mb-1">
              <span className="text-5xl font-bold">${plan.price}</span>
              <span className={`text-sm mb-2 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>/month</span>
            </div>
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
              {loading === plan.tier ? 'Redirecting…' : `Get ${plan.label}`}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-10 text-sm text-[#86868b] dark:text-[#8e8e93]">Cancel anytime. No contracts. Billed monthly via Stripe.</p>
    </div>
  )
}
