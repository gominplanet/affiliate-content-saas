// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The reads behind where a product pin goes (lib/pinterest-destination.ts has
// the rules): the creator's setting and Pinterest tracking ID (migration 382),
// and whether a blog post about the product exists.

import { readPinProductDest, type PinProductDest } from '@/lib/pinterest-destination'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export interface PinSettings {
  pref: PinProductDest
  /** The tag for pins that go straight to Amazon: the Pinterest one, else the main one. */
  amazonTag: string | null
  pinterestTag: string | null
  homepageUrl: string | null
}

/** select('*'), so a database without migration 382 still answers, with the defaults. */
export async function readPinSettings(admin: Sb, userId: string): Promise<PinSettings> {
  try {
    const { data } = await admin.from('integrations').select('*').eq('user_id', userId).maybeSingle()
    const pinterestTag = String(data?.pinterest_amazon_tag || '').trim() || null
    return {
      pref: readPinProductDest(data?.pinterest_product_dest),
      pinterestTag,
      amazonTag: pinterestTag || String(data?.amazon_associates_tag || '').trim() || null,
      homepageUrl: (data?.wordpress_url as string | null) || null,
    }
  } catch {
    return { pref: 'auto', amazonTag: null, pinterestTag: null, homepageUrl: null }
  }
}

/**
 * The creator's published blog post about this product, newest first: a deal
 * post for it, a review written from a video about it, or the post saved on
 * its campaign. Null when there is none.
 */
export async function blogPostUrlForAsin(admin: Sb, userId: string, asin: string): Promise<string | null> {
  const a = String(asin || '').toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(a)) return null
  const live = (u: unknown) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null)
  try {
    const deal = await admin.from('blog_posts').select('wordpress_url').eq('user_id', userId).eq('deal_meta->>asin', a)
      .not('wordpress_url', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (live(deal.data?.wordpress_url)) return deal.data.wordpress_url
  } catch { /* next source */ }
  try {
    const vids = await admin.from('youtube_videos').select('id').eq('user_id', userId).eq('asin', a).limit(20)
    const ids = ((vids.data ?? []) as Array<{ id: string }>).map((v) => v.id)
    if (ids.length) {
      const post = await admin.from('blog_posts').select('wordpress_url').eq('user_id', userId).in('video_id', ids)
        .not('wordpress_url', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (live(post.data?.wordpress_url)) return post.data.wordpress_url
    }
  } catch { /* next source */ }
  try {
    const camp = await admin.from('campaigns').select('wordpress_url').eq('user_id', userId).eq('asin', a)
      .not('wordpress_url', 'is', null).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (live(camp.data?.wordpress_url)) return camp.data.wordpress_url
  } catch { /* none */ }
  return null
}
