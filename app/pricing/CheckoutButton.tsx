'use client'

/**
 * Tiny client wrapper around the Stripe-checkout CTA on /pricing.
 *
 * Why this exists: the pricing page is almost entirely static (#47 — Server
 * Component conversion). The hero copy, the three pricing cards with all
 * their feature lists, the price-lock callout, and the footer are
 * server-rendered now. Only the CTA button needs interactivity — it owns:
 *   - the Rewardful affiliate-tracking effect (window.rewardful)
 *   - the loading state while we redirect the user to Stripe
 *   - the async signed-in check + redirect to /signup if not
 *   - the actual fetch to /api/stripe/checkout
 *
 * By isolating that ~60 lines in this file, the entire static layout of
 * /pricing ships as RSC HTML — no React hydration cost for the cards
 * themselves, only this small component hydrates.
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'

// Mirror the Window globals Rewardful exposes once its script loads. Kept here
// (rather than in a global .d.ts) so this component file is self-contained.
//
// Rewardful.coupon shape (per their JS API): when the visitor arrived via an
// affiliate link AND the campaign has double-sided incentives enabled, this
// is an object like { id: 'coupon_xxx', name: 'Affiliate20', percent_off: 20 }.
// When either condition fails, it's null/undefined. We only need the id.
declare global {
  interface Window {
    Rewardful?: {
      referral?: string | null
      coupon?: { id?: string; name?: string; percent_off?: number } | null
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rewardful?: (event: string, cb: () => void) => void
  }
}

type Tier = 'trial' | 'creator' | 'studio' | 'pro'

export function CheckoutButton({
  tier,
  highlight,
  salesPaused,
  ctaLabel,
}: {
  tier: Tier
  /** Drives the colour scheme — Pro card uses a light-on-dark button, others
   *  use the standard primary-blue button. Same shape as the old inline code. */
  highlight: boolean
  /** Server-injected: when sales are paused (lib/sales-paused.ts), the button
   *  is disabled and the label changes. Passed in so the server component
   *  controls the gate without this client component re-reading the constant. */
  salesPaused: boolean
  /** "Start free" / "Get Creator" / "Get Pro" — fully owned by the server. */
  ctaLabel: string
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [referral, setReferral] = useState<string | null>(null)
  const [couponId, setCouponId] = useState<string | null>(null)
  const [autoFired, setAutoFired] = useState(false)

  // Capture Rewardful referral ID + double-sided-incentive coupon once the
  // tracking script signals ready. The coupon ID is what makes the discount
  // auto-apply at Stripe Checkout — without it the referred customer would
  // still need to manually type a promo code.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.rewardful) return
    window.rewardful('ready', () => {
      setReferral(window.Rewardful?.referral ?? null)
      setCouponId(window.Rewardful?.coupon?.id ?? null)
    })
  }, [])

  // Auto-resume checkout when a just-confirmed user is sent back here as
  // /pricing?checkout=<tier> from the signup flow. Without this, a logged-out
  // visitor who clicked "Get Pro" signs up, confirms email, lands on trial, and
  // is never charged — the exact bug that left referred customers stuck. We
  // wait briefly for Rewardful to resolve the referral (the cookie is still in
  // their browser) so affiliate attribution survives, then fire the same
  // checkout the button would. Only the card whose tier matches fires.
  useEffect(() => {
    if (autoFired || typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('checkout') !== tier) return
    setAutoFired(true)
    let fired = false
    const go = () => { if (!fired) { fired = true; void handleCheckout() } }
    if (window.rewardful) {
      window.rewardful('ready', go)
      window.setTimeout(go, 2500) // fallback if 'ready' never fires (blocked script)
    } else {
      go()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFired, tier])

  async function handleCheckout() {
    if (tier === 'trial') {
      // No checkout needed — just send them to signup. After signup they land
      // on /dashboard with the default trial tier.
      router.push('/signup?next=/dashboard')
      return
    }
    setLoading(true)
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
        // Prefer React state, but fall back to the live Rewardful globals — on
        // the auto-resume path the checkout can fire before state has flushed,
        // and we must not drop the affiliate referral/coupon.
        body: JSON.stringify({
          tier,
          referral: referral ?? window.Rewardful?.referral ?? null,
          couponId: couponId ?? window.Rewardful?.coupon?.id ?? null,
        }),
      })
      const { url, error } = await res.json()
      if (error) { alert(error); return }
      if (url) window.location.href = url
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleCheckout}
      disabled={loading || salesPaused}
      className={`w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
        highlight
          ? 'bg-white dark:bg-[#1c1c1e] text-[#7C3AED] hover:bg-blue-50'
          : 'bg-[#7C3AED] text-white hover:bg-[#6D28D9]'
      }`}
    >
      {salesPaused ? 'Sales paused' : loading ? 'Redirecting…' : ctaLabel}
    </button>
  )
}
