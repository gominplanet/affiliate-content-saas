// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Keep the public link of every social post MVP makes about a product
// (migration 379), so Brand recap can show the brand all of them later.
//
// Deal Radar, Encore and the Amazon social pushes get a live URL back from
// each platform. Before this, only "which platforms worked" was kept, and the
// URLs vanished with the response. Best effort: recording never changes what
// the post itself reports, and a database without migration 379 simply keeps
// nothing, as before.

import { contentPlatform, shareableUrl } from '@/lib/brand-content'
import { createAdminClient } from '@/lib/supabase/admin'

/** Written with the service client: creators can read their rows, only the
 *  server writes them. */
export async function recordProductPostLinks(
  userId: string,
  asin: string | null | undefined,
  results: Array<{ platform: string; ok?: boolean; url?: string | null }>,
  source: string,
): Promise<number> {
  const a = String(asin || '').trim().toUpperCase()
  if (!userId || !/^[A-Z0-9]{10}$/.test(a)) return 0
  const rows = results
    .filter((r) => r.ok !== false)
    .map((r) => ({ platform: contentPlatform(r.platform), url: shareableUrl(r.url) }))
    .filter((r): r is { platform: NonNullable<typeof r.platform>; url: string } => !!r.platform && !!r.url)
    .map((r) => ({ user_id: userId, asin: a, platform: r.platform, url: r.url, source }))
  if (!rows.length) return 0
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (createAdminClient() as any).from('product_post_links').upsert(rows, { onConflict: 'user_id,url', ignoreDuplicates: true })
    if (error) { console.warn('[product-post-links] not kept:', error.message); return 0 }
    return rows.length
  } catch (e) {
    console.warn('[product-post-links] not kept:', e instanceof Error ? e.message : e)
    return 0
  }
}
