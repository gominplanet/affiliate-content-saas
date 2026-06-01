'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import Header from '@/components/layout/Header'
import { Zap, CheckCircle, Loader2, PartyPopper } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { TIERS, type Tier } from '@/lib/tier'
import { effectiveTier } from '@/lib/view-as'

export default function BillingPage() {
  const supabase = createBrowserClient()
  const [tier, setTier] = useState<Tier>('trial')
  const [postsUsed, setPostsUsed] = useState(0)
  const [socialCounts, setSocialCounts] = useState({ facebook: 0, threads: 0, pinterest: 0 })
  const [loading, setLoading] = useState(true)
  const [upgraded, setUpgraded] = useState(false)
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

    const userTier = effectiveTier(data?.tier as string)
    setTier(userTier)

    // Count posts used — lifetime for free, current month for paid
    const limits = TIERS[userTier]
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    if (limits.lifetimeMax !== null) {
      const { count } = await supabase
        .from('blog_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
      setPostsUsed(count ?? 0)
    } else if (limits.postsPerMonth !== null) {
      const { count } = await supabase
        .from('blog_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('published_at', monthStart)
      setPostsUsed(count ?? 0)
    }

    // Social post counts this month
    const [fbRes, thRes, pinRes] = await Promise.all([
      supabase.from('blog_posts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).not('facebook_post_id', 'is', null).gte('published_at', monthStart),
      supabase.from('blog_posts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).not('threads_post_id', 'is', null).gte('published_at', monthStart),
      supabase.from('blog_posts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).not('pinterest_pin_id', 'is', null).gte('published_at', monthStart),
    ])
    setSocialCounts({ facebook: fbRes.count ?? 0, threads: thRes.count ?? 0, pinterest: pinRes.count ?? 0 })

    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  // Show upgrade success banner from Stripe redirect
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('upgraded=1')) {
      setUpgraded(true)
      window.history.replaceState({}, '', '/billing')
    }
  }, [])

  const currentTier = TIERS[tier]
  const isPaid = tier !== 'trial' && tier !== 'admin'
  const limit = currentTier.postsPerMonth ?? currentTier.lifetimeMax ?? null
  const usagePct = limit ? Math.min((postsUsed / limit) * 100, 100) : 0
  const usageLabel = currentTier.lifetimeMax
    ? 'posts used (lifetime)'
    : `posts used this month · resets the 1st`

  const planDetails = [
    { tier: 'creator' as Tier, limit: '40 posts / month',                 price: 49,  regularPrice: 99  },
    { tier: 'pro' as Tier,     limit: '200 posts / month (140 + 60 bonus)', price: 199, regularPrice: 499 },
  ]

  async function openPortal() {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const { url, error } = await res.json()
      if (error) { toast.error(error); return }
      window.location.href = url
    } catch { toast.error('Something went wrong. Please try again.') }
    finally { setPortalLoading(false) }
  }

  async function upgrade(t: string) {
    setCheckoutLoading(t)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: t }),
      })
      const { url, error } = await res.json()
      if (error) { toast.error(error); return }
      window.location.href = url
    } catch { toast.error('Something went wrong. Please try again.') }
    finally { setCheckoutLoading(null) }
  }

  return (
    <>
      <Header title="Plan & Billing" subtitle="See where you are this month, swap plans, or cancel — all in one place." />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-8">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="max-w-xl flex flex-col gap-5">

          {/* Upgrade success banner */}
          {upgraded && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-[#34c759]/10 border border-[#34c759]/20">
              <PartyPopper size={18} className="text-[#34c759] flex-shrink-0" />
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                You&apos;re on the <strong>{currentTier.label}</strong> plan. Welcome aboard!
              </p>
            </div>
          )}

          {/* Current plan + usage */}
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

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-[#0071e3]/10 flex items-center justify-center">
                <Zap size={18} className="text-[#0071e3]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{currentTier.label}</p>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
                  {limit ? `${limit} posts / ${currentTier.lifetimeMax ? 'lifetime' : 'month'}` : 'Unlimited'}
                  {currentTier.price > 0 ? ` · $${currentTier.price}/month` : ''}
                </p>
              </div>
            </div>

            {/* Usage bar — only for capped tiers */}
            {limit !== null && tier !== 'admin' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{postsUsed} of {limit} {usageLabel}</span>
                  <span className={`text-xs font-semibold ${usagePct >= 90 ? 'text-[#ff3b30]' : usagePct >= 70 ? 'text-[#ff9500]' : 'text-[#34c759]'}`}>
                    {Math.round(usagePct)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      usagePct >= 90 ? 'bg-[#ff3b30]' : usagePct >= 70 ? 'bg-[#ff9500]' : 'bg-[#34c759]'
                    }`}
                    style={{ width: `${usagePct}%` }}
                  />
                </div>
                {usagePct >= 90 && (
                  <p className="text-xs text-[#ff3b30] mt-2">
                    {usagePct >= 100 ? 'You\'ve used every post on this plan. Upgrade to keep generating.' : 'You\'re close to your cap — upgrade now to avoid being blocked mid-generation.'}
                  </p>
                )}

                {/* Social breakdown */}
                {(socialCounts.facebook > 0 || socialCounts.threads > 0 || socialCounts.pinterest > 0) && (
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 dark:border-white/10">
                    {socialCounts.facebook > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#1877f2]" />
                        <span className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{socialCounts.facebook} Facebook</span>
                      </div>
                    )}
                    {socialCounts.threads > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#1d1d1f] dark:bg-white" />
                        <span className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{socialCounts.threads} Threads</span>
                      </div>
                    )}
                    {socialCounts.pinterest > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#e60023]" />
                        <span className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{socialCounts.pinterest} Pinterest</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
                      <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
                        {plan.limit} ·{' '}
                        <span className="line-through text-[#86868b]">${plan.regularPrice}</span>{' '}
                        <span className="text-[#34c759] font-semibold">${plan.price}/month</span>
                      </p>
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
