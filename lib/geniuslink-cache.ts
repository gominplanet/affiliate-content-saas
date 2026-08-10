// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-ASIN Geniuslink code cache. Geniuslink's create API is intermittently
// slow (times out our retries), so once we've minted a geni.us code for an
// ASIN we store it and reuse it forever — a re-review or a Regenerate of the
// same product then ships a geni.us link INSTANTLY, with zero dependency on
// their flaky endpoint. Only the first-ever generation for a brand-new ASIN
// still calls the API. Cache read/write goes through the service-role client
// so it's independent of the caller's RLS context (agency owner vs member).
import { createAdminClient } from '@/lib/supabase/admin'
import type { GeniuslinkService } from '@/services/geniuslink'

interface Args {
  userId: string
  asin: string
  /** Full tagged Amazon destination (dp/ASIN?tag=…&ascsubtag=…). */
  destination: string
  service: GeniuslinkService
  groupId?: number
  note?: string
}

/**
 * Return a geni.us short URL for this user+ASIN, reusing a cached code when we
 * have one and otherwise creating (and caching) a fresh one. Throws only when
 * there's no cached code AND the live create call fails — the caller then falls
 * back to the plain Amazon tag, exactly as before, but now every SUBSEQUENT
 * attempt for that ASIN succeeds instantly from cache.
 */
export async function getOrCreateAmazonGeniuslink(args: Args): Promise<{ url: string; cached: boolean }> {
  const { userId, asin, destination, service, groupId, note } = args
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // 1. Cache hit → reuse instantly, no API call.
  try {
    const { data } = await admin
      .from('geniuslink_codes')
      .select('code')
      .eq('user_id', userId)
      .eq('asin', asin)
      .maybeSingle()
    if (data?.code) return { url: `https://geni.us/${data.code}`, cached: true }
  } catch { /* cache read failed — fall through to a live create */ }

  // 2. Miss → create (with the service's own retries) and cache the code.
  const { url, code } = await service.createLinkWithCode(destination, note || asin, { groupId, note })
  if (code) {
    try {
      await admin
        .from('geniuslink_codes')
        .upsert({ user_id: userId, asin, code, destination }, { onConflict: 'user_id,asin' })
    } catch { /* cache write is best-effort — the link still works this run */ }
  }
  return { url, cached: false }
}
