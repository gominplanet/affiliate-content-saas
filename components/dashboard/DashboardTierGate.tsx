// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DashboardTierGate — lets an ADMIN preview the Amazon dashboard via the
// view-as switcher. Real amazon-tier users are branched server-side in
// dashboard/page.tsx (no flash); this only swaps the client tree for an admin
// who picked "Amazon Influencer" in the preview dropdown. Non-admins never
// swap, so a stale localStorage value can't change what a real user sees.

'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { getViewAsTier, VIEW_AS_EVENT } from '@/lib/view-as'

export default function DashboardTierGate({
  isAdmin,
  amazon,
  children,
}: {
  isAdmin: boolean
  amazon: ReactNode
  children: ReactNode
}) {
  const [showAmazon, setShowAmazon] = useState(false)
  useEffect(() => {
    if (!isAdmin) return
    const check = () => setShowAmazon(getViewAsTier() === 'amazon')
    check()
    window.addEventListener(VIEW_AS_EVENT, check)
    return () => window.removeEventListener(VIEW_AS_EVENT, check)
  }, [isAdmin])
  return <>{showAmazon ? amazon : children}</>
}
