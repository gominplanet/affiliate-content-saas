'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PRICE LOCK, ON THE SALES PAGES.
//
// Seb, 2026-10-05: prices go up for new members on November 1, and 2026-10-07:
// present today's price as founding member pricing, salesy but not sleazy. Anyone who joins
// before keeps $99 (Amazon) or $199 (Pro) for as long as they stay subscribed,
// whatever MVP adds, on either plan. This says so, with a live countdown to the
// moment lib/price-schedule turns the prices over, and disappears at that
// moment by itself. The numbers come from lib/price-schedule, never typed here.
//
// The countdown is filled in after mount, so the server and the first client
// render agree; until then the explanation shows on its own. Pages render it
// only while !newPricesLive(), decided on the server.

import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { PRICES_BEFORE, NEW_MEMBER_PRICES, timeUntilPriceChange } from '@/lib/price-schedule'

// THE OFFER, IN NUMBERS. Today's price next to the November price and the
// monthly difference, so "lock in" means something concrete. Honest about
// the one condition: the lock lasts while the membership does.
const plans = [
  { name: 'Amazon', now: PRICES_BEFORE.amazon.month, later: NEW_MEMBER_PRICES.amazon.month },
  { name: 'Pro', now: PRICES_BEFORE.pro.month, later: NEW_MEMBER_PRICES.pro.month },
].map((pl) => ({ ...pl, saved: pl.later - pl.now }))

type Left = NonNullable<ReturnType<typeof timeUntilPriceChange>>

export default function PriceLockCountdown({ tone = 'auto', className = '' }: { tone?: 'auto' | 'dark' | 'light'; className?: string }) {
  const [left, setLeft] = useState<Left | null>(null)
  // Starts false on purpose. Reading the clock here ran on the server and again
  // on the visitor's device, so a cached page from before the change, or a
  // phone with its clock set ahead, hydrated into a mismatch. The page decides
  // on the server whether to render this at all; the tick below hides it if the
  // moment passes while it is open.
  const [over, setOver] = useState(false)

  useEffect(() => {
    const tick = () => {
      const t = timeUntilPriceChange()
      setLeft(t)
      setOver(t === null)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  if (over) return null

  // 'auto' follows the site theme; 'dark' and 'light' are for pages that paint
  // one world whatever the theme (the home and storefront pages are always light).
  const dark = tone === 'dark'
  const light = tone === 'light'
  const box = dark
    ? 'bg-white/[0.04] border-white/10 text-white'
    : light
      ? 'bg-white border-[#7C3AED]/25 text-[#1d1d1f]'
      : 'bg-white dark:bg-[#1c1c1e] border-[#7C3AED]/25 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'
  const soft = dark ? 'text-white/70' : light ? 'text-[#6e6e73]' : 'text-[#6e6e73] dark:text-[#ebebf0]/80'
  const cell = dark ? 'bg-white/[0.06] border-white/10' : light ? 'bg-[#7C3AED]/[0.06] border-[#7C3AED]/15' : 'bg-[#7C3AED]/[0.06] border-[#7C3AED]/15 dark:bg-white/[0.06] dark:border-white/10'
  const strong = dark ? 'text-white' : light ? 'text-[#1d1d1f]' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'
  const units: Array<[string, number | undefined]> = [
    ['days', left?.days], ['hrs', left?.hours], ['min', left?.minutes], ['sec', left?.seconds],
  ]

  return (
    <section aria-label="Founding member pricing until November 1" className={`w-full max-w-3xl mx-auto rounded-2xl border p-5 sm:p-6 shadow-sm ${box} ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-5">
        <div className="flex-1 min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9D6BFF]">
            <Lock size={12} /> Founding member pricing
          </p>
          <h2 className="mt-1.5 text-xl sm:text-2xl font-bold tracking-tight" style={{ textWrap: 'balance' }}>
            Lock in today&apos;s price before November 1
          </h2>
          <p className={`mt-2 text-sm leading-relaxed ${soft}`}>
            On November 1, MVP moves to its full price. Join before then and today&apos;s price is
            {' '}<strong className={strong}>locked for as long as you stay subscribed</strong>.
            Every feature we add is included at that price, and it stays yours if you switch plans.
          </p>
        </div>
        <div className="sm:w-[260px] flex-shrink-0">
          <p className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wider ${soft}`}>Founding price ends in</p>
          <div className="grid grid-cols-4 gap-2" role="timer" aria-live="off">
            {units.map(([label, n]) => (
              <div key={label} className={`rounded-xl border px-1 py-2.5 text-center ${cell}`}>
                <div className="text-2xl font-bold leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {n === undefined ? '--' : String(n).padStart(2, '0')}
                </div>
                <div className={`mt-1 text-[10px] font-medium uppercase tracking-wider ${soft}`}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {plans.map((pl) => (
          <div key={pl.name} className={`rounded-xl border px-4 py-3 ${cell}`}>
            <p className={`text-[11px] font-semibold uppercase tracking-wider ${soft}`}>{pl.name} plan</p>
            <p className="mt-1 flex items-baseline gap-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <span className={`text-2xl font-bold ${strong}`}>${pl.now}</span>
              <span className={`text-sm ${soft}`}>a month</span>
              <span className={`ml-auto text-sm line-through ${soft}`} aria-label={`${pl.later} dollars from November 1`}>${pl.later}</span>
            </p>
            <p className="mt-1 text-[12.5px] font-medium text-[#10B981]">You save ${pl.saved} every month</p>
          </div>
        ))}
      </div>

      <p className={`mt-4 text-[12px] leading-relaxed ${soft}`}>
        No catch, and you can cancel anytime. The lock lasts while your membership is active, so if you cancel
        and come back after November 1, you join at the price of the day. From November 1, new members pay
        {' '}${NEW_MEMBER_PRICES.amazon.month} for Amazon and ${NEW_MEMBER_PRICES.pro.month} for Pro.
      </p>
    </section>
  )
}
