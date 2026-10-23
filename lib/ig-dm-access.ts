// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHO CAN USE INSTAGRAM AUTO-DM (Seb, 2026-10-23, the day Meta approved
// instagram_business_manage_messages and instagram_business_manage_comments:
// "let's open to users"). Out of Labs: every member whose plan posts to
// Instagram, and the MVP team. NEXT_PUBLIC_IG_DM_ENABLED=false in Vercel
// shuts it again for members (lib/feature-flags igDmEnabled). Facebook
// Auto-DM is not here: its permissions (pages_messaging and two more) are not
// approved, so it stays with the team. Pure; on its own so lib/tier and
// lib/feature-flags do not import each other.

import { igDmEnabled } from '@/lib/feature-flags'
import { normalizeTier, tierAllowsSocial, type Tier } from '@/lib/tier'

export function canUseIgDm(tier: Tier | string | null | undefined): boolean {
  if (!tier) return false
  const t = normalizeTier(tier)
  if (t === 'admin') return true
  return igDmEnabled() && tierAllowsSocial(t, 'instagram')
}
