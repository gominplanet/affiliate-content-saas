'use client'

import PageHero from '@/components/layout/PageHero'
import PulsePanel from '@/components/pulse/PulsePanel'
import HashtagTrends from '@/components/pulse/HashtagTrends'
import { Activity, TrendingUp, Users, Sparkles } from 'lucide-react'

/**
 * Pulse — the home for reach-based hashtag learning. Shows which tags actually
 * earn reach for this creator and, per niche, across all MVP creators, and
 * explains that those proven tags are fed back into every caption automatically.
 */
export default function PulsePage() {
  return (
    <>
      <PageHero
        title="Hashtag insights"
        subtitle={<>Which hashtags actually earn reach, learned from your posts and pooled across MVP, then fed back into every caption automatically.<span className="block mt-1 text-[12px]">Formerly Pulse.</span></>}
      />

      <div className="max-w-3xl space-y-5">
        <PulsePanel alwaysShow />
        <HashtagTrends />

        {/* How it works — always visible so the value is clear even before data. */}
        <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">How Pulse works</p>
          <ul className="space-y-3 text-[13px] text-[#6e6e73] dark:text-[#a1a1a6]">
            <li className="flex gap-2.5">
              <TrendingUp size={15} className="text-[#34c759] flex-shrink-0 mt-0.5" />
              <span><b className="text-[#1d1d1f] dark:text-[#f5f5f7]">Measures lift, not views.</b> Every post MVP publishes is scored by how far it beat your own average on that platform, so results are fair whether you have 500 followers or 50k. Instagram, YouTube, Facebook, Pinterest and Bluesky share results with MVP; on TikTok, Threads, X, LinkedIn and Telegram the tags are recorded and the panel says why there are no results.</span>
            </li>
            <li className="flex gap-2.5">
              <Users size={15} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
              <span><b className="text-[#1d1d1f] dark:text-[#f5f5f7]">Learns from everyone, per niche.</b> Your own history leads, and the pooled signal across all MVP creators in your niche fills the gaps, so proven tags help you from day one. Only aggregate tag performance is shared; never your posts or numbers.</span>
            </li>
            <li className="flex gap-2.5">
              <Sparkles size={15} className="text-[#ff9500] flex-shrink-0 mt-0.5" />
              <span><b className="text-[#1d1d1f] dark:text-[#f5f5f7]">Feeds captions automatically.</b> Every caption MVP writes picks its hashtags the same way: your proven tags, what is trending on that platform and is about the post, the brand, and the product&apos;s own category, at the count each platform rewards (Instagram 5 including #ad, Threads 1, YouTube 3 to 5). Nothing to switch on.</span>
            </li>
            <li className="flex gap-2.5">
              <Activity size={15} className="text-[#86868b] flex-shrink-0 mt-0.5" />
              <span><b className="text-[#1d1d1f] dark:text-[#f5f5f7]">Give it a little time.</b> Numbers land about a day after each post. Your personal ranking unlocks after a handful of measured posts; until then Pulse leans on the pooled signal.</span>
            </li>
          </ul>
        </div>
      </div>
    </>
  )
}
