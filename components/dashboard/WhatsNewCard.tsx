'use client'

/**
 * WhatsNewCard: the "What's new" pill in the dashboard hero. It opens the one
 * news card (components/dashboard/MvpNews): the last 7 days of updates for
 * this plan, SCOUT's news, and the latest MVP Affiliate videos. The entries
 * themselves are in lib/whats-new, each dated; the card opens by itself once
 * a day, and this pill opens it any time.
 */

import { useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import { recentNews } from '@/lib/whats-new'
import { OPEN_EVENT } from '@/components/dashboard/MvpNews'

export default function WhatsNewCard({ tier }: { tier: string }) {
  const count = useMemo(() => recentNews(tier).length, [tier])
  return (
    <button
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold text-white shadow-sm transition-all hover:opacity-90 hover:-translate-y-px"
      style={{ background: 'linear-gradient(135deg, #FF5A1F 0%, #E11900 100%)' }}
      aria-label="Open what's new"
    >
      {count > 0 && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: '#FFD400' }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: '#FFD400' }} />
        </span>
      )}
      <Sparkles size={12} />
      What&apos;s new
      {count > 0 && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/25">
          {count}
        </span>
      )}
    </button>
  )
}
