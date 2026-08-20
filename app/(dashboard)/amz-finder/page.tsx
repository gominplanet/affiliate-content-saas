'use client'

/**
 * AMZ Product Research — search the whole Amazon catalogue with MVP filters,
 * save the winners, turn them into posts.
 *
 * This page is Amazon-catalogue only. Creator Connections / Affiliate+ campaigns
 * moved to their own dedicated surface (the "CC Campaigns" page under Research)
 * on 2026-08-05 so there's exactly ONE Creator Connections home, gated by SCOUT
 * CC-verification. The old two-area picker (Amazon vs Affiliate+) lived here and
 * was retired with that split.
 *
 * Flow:
 *   1. Search the catalogue (keyword, price, rating, reviews, best-sellers).
 *   2. Save the products worth reviewing.
 *   → Saved-for-later shelf holds your buy-to-review shortlist (Message brand /
 *      Buy to review / Remove).
 *
 * Lives in the sidebar "Source & Earn" group. Research is FREE for every tier;
 * the paid actions (Save / Write review / Deep-dive) are gated by canAct.
 */

import { useState, useEffect, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { AmzFinderGuide } from '@/components/guide/tool-guides'
import { ShoppingBag } from 'lucide-react'
import { requestFindCampaign } from '@/lib/extension-frame'
import MessageBrandModal, { type MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'
import AmazonResearchPanel from '@/components/campaigns/AmazonResearchPanel'
import SavedFinds from '@/components/campaigns/SavedFinds'
import MadeForYouFeed from '@/components/product/MadeForYouFeed'
import { createBrowserClient } from '@/lib/supabase/client'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'

export default function AmzFinderPage() {
  const [msgModal, setMsgModal] = useState<MessageBrandCampaign | null>(null)
  // Bumped when the Finder or Saved shelf saves/unsaves a find → SavedFinds reloads.
  const [savedReloadKey, setSavedReloadKey] = useState(0)

  // ── Tier gate — research is FREE for every tier; only the paid actions
  // (Save / Write review / Deep-dive) are gated, via canAct below. null = still
  // resolving (render optimistically to avoid a flash).
  const [tier, setTier] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    let realTier = 'trial'
    const apply = () => { if (!cancelled) setTier(effectiveTier(realTier)) }
    ;(async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { apply(); return }
        const { data } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        realTier = (data?.tier as string | undefined) ?? 'trial'
        apply()
      } catch { apply() }
    })()
    window.addEventListener(VIEW_AS_EVENT, apply)
    return () => { cancelled = true; window.removeEventListener(VIEW_AS_EVENT, apply) }
  }, [])
  const canUseFinder = tier !== 'trial' // gates PAID actions (canAct)

  return (
    <>
      <PageHero
        guide={<AmzFinderGuide />}
        title="Amazon Product Research"
        subtitle="Search the whole Amazon catalogue with MVP filters — keyword, price, rating, reviews, best-sellers. Every link carries your own Associates tag. Find products worth buying to review, then save the winners."
      />

      {tier !== undefined && (
      <>
      {/* ── Made for your channel — products matched to what already earns for
             this creator (affinity profile), shown before the generic search. ── */}
      <MadeForYouFeed />

      {/* ── Amazon Product Research — the regular catalogue browse. Free to
             research on every tier; paid actions gated by canUseFinder. ── */}
      <div className="mb-2">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <ShoppingBag size={16} style={{ color: '#7C3AED' }} />
          <p className="text-[13px] font-bold uppercase tracking-wide" style={{ color: '#7C3AED' }}>Amazon Product Research</p>
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-faint)' }}>— the whole catalogue, filterable. Buy to review or write a review in one click.</span>
        </div>
        <AmazonResearchPanel canAct={canUseFinder} onSavedChange={() => setSavedReloadKey(k => k + 1)} />
        <p className="text-[11px] leading-relaxed mt-1 mb-4 px-1" style={{ color: 'var(--text-faint)' }}>
          Product data is sourced from licensed catalogue providers; prices and availability update on Amazon. Links carry your own Associates tag when you&rsquo;ve set one in Settings. Looking for Creator Connections campaigns? They live on the <span className="font-medium">CC Campaigns</span> page under Research.
        </p>
      </div>

      {/* ── Saved for later — the buy-to-review shortlist. Fed by the Finder's
             Save button; can message the brand or buy to review. ── */}
      <SavedFinds reloadKey={savedReloadKey} onMessageBrand={(c) => setMsgModal(c)} />

      {msgModal && (
        <MessageBrandModal
          campaign={msgModal}
          onClose={() => setMsgModal(null)}
          onSent={() => setSavedReloadKey(k => k + 1)}
          // Saved Affiliate+ finds arrive without a campaign details URL (SCOUT
          // verifies on the /dp, not the CC grid). Hand the modal a live SCOUT
          // lookup so it fetches the real details URL by ASIN and flips Copy →
          // Send — direct brand-message, not copy-only.
          onFindCampaign={() => requestFindCampaign(msgModal?.brandLabel || msgModal?.product || '', msgModal?.asin || '')}
        />
      )}
      </>
      )}
    </>
  )
}
