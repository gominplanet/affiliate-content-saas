// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The two facts "Hide campaigns missing from this upload" needs before it may
// mark anything full (lib/cc-merge-mode ccHideMissingBlock): how many live
// campaigns there are, and whether the upload carries open-slots counts at all.
// Server only. A fact it cannot read comes back null, which blocks the hide.

import type { CcHideFacts } from '@/lib/cc-merge-mode'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ccHideFacts(admin: any): Promise<CcHideFacts> {
  const today = new Date().toISOString().slice(0, 10)
  let live: number | null = null
  let stagedHasSpots: boolean | null = null
  try {
    const { count, error } = await admin.from('cc_campaign_catalog')
      .select('campaign_id', { count: 'estimated', head: true }).gte('ends_at', today)
    if (!error && typeof count === 'number') live = count
  } catch { /* unknown */ }
  try {
    const { data, error } = await admin.from('cc_campaign_catalog_import')
      .select('campaign_id').not('available_slot', 'is', null).limit(1)
    if (!error) stagedHasSpots = Array.isArray(data) && data.length > 0
  } catch { /* unknown */ }
  return { live, stagedHasSpots }
}
