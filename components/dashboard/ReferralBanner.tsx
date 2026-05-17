'use client'

import { useEffect, useState } from 'react'
import { HandCoins, X, ArrowRight } from 'lucide-react'

/**
 * Persistent (until dismissed) green callout on the dashboard pointing
 * existing customers at the Rewardful affiliate signup. Customers are
 * the best referrers — they already know the product works for them.
 *
 * Storage key: `mvp_referral_seen` — once set to '1', stays hidden.
 * Bump the value (e.g. '2') in a future commit to re-show after a
 * meaningful program update.
 */

const STORAGE_KEY = 'mvp_referral_seen'
const CURRENT_VERSION = '1'
const SIGNUP_URL = 'https://mvp-affiliate.getrewardful.com/signup'

export default function ReferralBanner() {
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === CURRENT_VERSION)
    } catch {
      setDismissed(false)
    }
  }, [])

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, CURRENT_VERSION) } catch { /* ignore */ }
    setDismissed(true)
  }

  if (dismissed) return null

  return (
    <div
      className="card mb-6 p-5 relative"
      style={{
        background: 'linear-gradient(135deg, rgba(52, 199, 89, 0.08) 0%, rgba(52, 199, 89, 0.02) 100%)',
        borderColor: 'rgba(52, 199, 89, 0.3)',
      }}
    >
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#34c759]">
          <HandCoins size={16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
            Earn 10% every month — refer creators to MVP Affiliate
          </p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-3">
            You&apos;re already using the tool. Tell another creator and earn 10% of their plan for as
            long as they stay. Real numbers: 10 Pro referrals = <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">$199/mo passive</strong>, $2,388/year.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <a
              href={SIGNUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-[#34c759] hover:bg-[#2db34a] transition-colors"
            >
              Join the program <ArrowRight size={11} />
            </a>
            <button
              onClick={dismiss}
              className="text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
