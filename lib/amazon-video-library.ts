// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which of the creator's Amazon videos shows a product, answered from the
// library MVP already keeps (amazon_videos, and amazon_video_products filled
// by the server read in lib/amazon-video-products). No extension, no tab.
// Used by Share with brand so it never sends the creator to another tool to
// find a video MVP already knows about.

import { vdpIdFromAci } from '@/lib/amazon-vdp'
import { amazonVideoPage } from '@/lib/brand-content'

/** The creator's newest live Amazon video that shows this product, from the
 *  library MVP already read (amazon_video_products), as its public /vdp/ link.
 *  Null when the library has none, or the tables are not there yet. */
export async function libraryVideoFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, ownerId: string, asin: string,
): Promise<string | null> {
  try {
    const { data: rows } = await supabase.from('amazon_video_products')
      .select('aci').eq('user_id', ownerId).eq('asin', asin.toUpperCase()).limit(50)
    const acis = [...new Set(((rows ?? []) as Array<{ aci: string }>).map(r => r.aci).filter(a => !!vdpIdFromAci(a)))]
    if (!acis.length) return null
    const { data: vids } = await supabase.from('amazon_videos')
      .select('aci, media_url, state, published_at').eq('user_id', ownerId).in('aci', acis)
    // Same rule as Brand Recap (amazonVideoPage): only a video Amazon has
    // published has a public page worth sending a brand.
    const live = ((vids ?? []) as Array<{ aci: string; media_url: string | null; state: string | null; published_at: string | null }>)
      .sort((x, y) => String(y.published_at || '').localeCompare(String(x.published_at || '')))
      .map(v => amazonVideoPage(v.aci, v.media_url, v.state))
      .find(Boolean)
    return live ? live.url : null
  } catch { return null }
}
