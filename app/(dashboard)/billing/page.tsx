'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/Header'
import { Zap, CheckCircle, Loader2 } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { TIERS, type Tier } from '@/lib/tier'

export default function BillingPage() {
  const supabase = createBrowserClient()
  const [tier, setTier] = useState<Tier>('free')
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    setTier((data?.tier as Tier) ?? 'free')
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const currentTier = TIERS[tier]
  const isPaid = tier !== 'free' && tier !== 'admin'

  async function openPortal() {
    setPortalLoading(true)
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const { url, error } = await res.json()
    if (error) { alert(error); setPortalLoading(false); return }
    window.location.href = url
  }

  async function upgrade(t: string) {
    setCheckoutLoading(t)
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: t }),
    })
    const { url, error } = await res.json()
    if (error) { alert(error); setCheckoutLoading(null); return }
    window.location.href = url
  }

  const planDetails = [
    { tier: 'starter' as Tier, limit: 'Up to 4 videos / week', price: 25 },
    { tier: 'growth' as Tier,  limit: 'Up to 1 video / day',   price: 40 },
    { tier: 'pro' as Tier,     limit: 'Up to 5 videos / day',  price: 95 },
  ]

  return (
    <>
      <Header title="Plan & Billing" subtitle="Manage your subscription and usage limits." />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-8">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="max-w-xl flex flex-col gap-5">

          {/* Current plan */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Current Plan</h2>
              {isPaid && (
                <button
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="text-xs text-[#0071e3] hover:underline disabled:opacity-60 flex items-center gap-1"
                >
                  {portalLoading && <Loader2 size={11} className="animate-spin" />}
                  Manage subscription
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#0071e3]/10 flex items-center justify-center">
                <Zap size={18} className="text-[#0071e3]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{currentTier.label}</p>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
                  {'lifetimeMax' in currentTier && currentTier.lifetimeMax
                    ? `${currentTier.lifetimeMax} posts total (free trial)`
                    : currentTier.videosPerWeek
                    ? `Up to ${currentTier.videosPerWeek} videos / week`
                    : currentTier.videosPerDay
                    ? `Up to ${currentTier.videosPerDay} video${currentTier.videosPerDay > 1 ? 's' : ''} / day`
                    : 'Unlimited'}
                  {currentTier.price > 0 ? ` · $${currentTier.price}/month` : ''}
                </p>
              </div>
            </div>
          </div>

          {/* Plans */}
          {tier !== 'admin' && (
            <div className="card p-6">
              <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">
                {isPaid ? 'Change plan' : 'Upgrade your plan'}
              </h2>
              <div className="flex flex-col gap-3">
                {planDetails.filter(p => p.tier !== tier).map((plan) => (
                  <div key={plan.tier} className="flex items-center justify-between p-4 rounded-xl border border-gray-200 dark:border-white/10 hover:border-[#0071e3]/40 transition-colors">
                    <div>
                      <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{TIERS[plan.tier].label}</p>
                      <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{plan.limit} · ${plan.price}/month</p>
                    </div>
                    <button
                      onClick={() => upgrade(plan.tier)}
                      disabled={checkoutLoading === plan.tier}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0062c4] disabled:opacity-60 transition-colors"
                    >
                      {checkoutLoading === plan.tier
                        ? <><Loader2 size={11} className="animate-spin" /> Redirecting…</>
                        : <><CheckCircle size={11} /> Select</>}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </>
  )
}
