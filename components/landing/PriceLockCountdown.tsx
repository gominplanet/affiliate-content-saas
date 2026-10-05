'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PRICE LOCK, ON THE SALES PAGES.
//
// Seb, 2026-10-05: prices go up for new members on November 1. Anyone who joins
// before keeps $99 (Amazon) or $199 (Pro) for as long as they stay subscribed,
// whatever MVP adds, on either plan. This says so, with a live countdown to the
// moment lib/price-schedule turns the prices over, and disappears at that
// moment by itself. The numbers come from lib/price-schedule, never typed here.
//
// The countdown is filled in after mount, so the server and the first client
// render agree; until then the explanation shows on its own.

import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { PRICES_BEFORE, NEW_MEMBER_PRICES, timeUntilPriceChange, newPricesLive } from '@/lib/price-schedule'

type Left = NonNullable<ReturnType<typeof timeUntilPriceChange>>

export default function PriceLockCountdown({ tone = 'auto', className = '' }: { tone?: 'auto' | 'dark' | 'light'; className?: string }) {
  const [left, setLeft] = useState<Left | null>(null)
  const [over, setOver] = useState(() => newPricesLive())

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
  // one world whatever the theme (the home page is dark, the ad page light).
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
    ['days', left?.days], ['hours', left?.hours], ['minutes', left?.minutes], ['seconds', left?.seconds],
  ]

  return (
    <section aria-label="Price lock before November 1" className={`w-full max-w-3xl mx-auto rounded-2xl border p-5 sm:p-6 shadow-sm ${box} ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="flex-1 min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9D6BFF]">
            <Lock size={12} /> Price lock
          </p>
          <h2 className="mt-1.5 text-xl sm:text-2xl font-bold tracking-tight" style={{ textWrap: 'balance' }}>
            Prices go up on November 1
          </h2>
          <p className={`mt-2 text-sm leading-relaxed ${soft}`}>
            Join before then and your price is locked for as long as you stay subscribed:
            {' '}<strong className={strong}>${PRICES_BEFORE.amazon.month} a month for Amazon</strong> or
            {' '}<strong className={strong}>${PRICES_BEFORE.pro.month} for Pro</strong>.
            Every feature we add is included at that price, and it stays yours if you switch plans.
            From November 1, new members pay ${NEW_MEMBER_PRICES.amazon.month} and ${NEW_MEMBER_PRICES.pro.month}.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2 sm:w-[260px] flex-shrink-0" role="timer" aria-live="off">
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
    </section>
  )
}
