// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT MVP ALREADY MADE FOR THIS. Seb, 2026-10-05: when a creator makes more
// than one thing for the same product, MVP should say "we already made this"
// and let them reuse it or build from it, instead of paying to design or write
// the same thing again.
//
// One lookup, keyed by what a generator knows before it starts: the product
// (ASIN), the YouTube video, or the brand. It reads the tables MVP already
// writes its outputs to, so nothing new is stored:
//
//   product_images     the product's remembered thumbnail
//   youtube_videos     video thumbnails, Co-Pilot titles, Instagram AI images
//   blog_posts         blog posts (by video), deal posts (deal_meta.asin)
//   campaigns          Creator Campaign posts
//   launch_items       Liftoff thumbnails
//   video_scripts      scripts
//   collaborations     collab emails, by brand
//
// Every read is its own try: a table missing on one environment, or a column
// renamed, costs that row of the answer and never the rest. Newest first.

import { isAsin } from '@/lib/product-image-label'

export type MadeKind = 'thumbnail' | 'blog' | 'deal' | 'campaign' | 'liftoff' | 'script' | 'collab' | 'copilot' | 'instagram'

export interface MadeItem {
  kind: MadeKind
  /** What it is, in the creator's words: "Blog post: Best steam brush". */
  label: string
  /** Where to open it, when it lives somewhere (a post URL). */
  url: string | null
  /** The picture, for anything that is one (reusable as is). */
  imageUrl: string | null
  /** When it was made, ISO. */
  at: string | null
  /** The row it came from, for a screen that loads it back (a script, an email). */
  id: string | null
}

export interface MadeQuery { asin?: string | null; youtubeVideoId?: string | null; brand?: string | null }

const KIND_LABEL: Record<MadeKind, string> = {
  thumbnail: 'Thumbnail', blog: 'Blog post', deal: 'Deal post', campaign: 'Campaign post',
  liftoff: 'Liftoff thumbnail', script: 'Script', collab: 'Collab email', copilot: 'YouTube title and description',
  instagram: 'Instagram image',
}

/** "Blog post: Best steam brush" or just "Blog post". Pure. */
export function madeLabel(kind: MadeKind, title?: string | null): string {
  const t = (title || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return t ? `${KIND_LABEL[kind]}: ${t}` : KIND_LABEL[kind]
}

/** Newest first, the same output only once (by kind + url/image/id). Pure. */
export function tidyMade(items: MadeItem[], limit = 12): MadeItem[] {
  const seen = new Set<string>()
  const out: MadeItem[] = []
  for (const it of [...items].sort((a, b) => (b.at || '').localeCompare(a.at || ''))) {
    const key = `${it.kind}|${it.url || it.imageUrl || it.id || it.label}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
    if (out.length >= limit) break
  }
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Everything MVP already made for this product, video or brand. Never throws. */
export async function madeBefore(db: Db, userId: string, q: MadeQuery): Promise<MadeItem[]> {
  const asin = isAsin(q.asin) ? String(q.asin).trim().toUpperCase() : null
  const videoId = s(q.youtubeVideoId)
  const brand = s(q.brand)?.slice(0, 80) ?? null
  const items: MadeItem[] = []
  const tryRead = async (fn: () => Promise<void>) => { try { await fn() } catch { /* this row of the answer only */ } }

  // The videos this is about: the one named, and every video tagged with the product.
  const videos: Array<Record<string, unknown>> = []
  await tryRead(async () => {
    if (videoId) {
      const { data } = await db.from('youtube_videos').select('*').eq('user_id', userId).eq('youtube_video_id', videoId).limit(1)
      for (const v of data ?? []) videos.push(v)
    }
    if (asin) {
      const { data } = await db.from('youtube_videos').select('*').eq('user_id', userId).eq('asin', asin).order('created_at', { ascending: false }).limit(10)
      for (const v of data ?? []) if (!videos.some((x) => x.id === v.id)) videos.push(v)
    }
  })

  await Promise.all([
    tryRead(async () => {
      if (!asin) return
      const { data } = await db.from('product_images').select('*').eq('user_id', userId).eq('asin', asin).maybeSingle()
      if (data?.image_url) items.push({ kind: 'thumbnail', label: madeLabel('thumbnail', s(data.surface) ? `from ${data.surface}` : null), url: null, imageUrl: data.image_url, at: data.approved_at || data.created_at || null, id: null })
    }),
    tryRead(async () => {
      for (const v of videos) {
        const title = s(v.title)
        const img = s(v.blog_thumbnail_url) || s(v.thumbnail_url)
        if (img && /supabase|mvpaffiliate|fal\.media|cloudinary/i.test(img)) items.push({ kind: 'thumbnail', label: madeLabel('thumbnail', title), url: null, imageUrl: img, at: (v.updated_at as string) || (v.created_at as string) || null, id: null })
        if (s(v.generated_title)) items.push({ kind: 'copilot', label: madeLabel('copilot', v.generated_title as string), url: null, imageUrl: null, at: (v.metadata_generated_at as string) || null, id: (v.youtube_video_id as string) || null })
        if (s(v.instagram_ai_thumbnail_url)) items.push({ kind: 'instagram', label: madeLabel('instagram', title), url: null, imageUrl: v.instagram_ai_thumbnail_url as string, at: (v.instagram_ai_thumbnail_generated_at as string) || null, id: null })
      }
      const ids = videos.map((v) => v.id).filter(Boolean)
      if (!ids.length) return
      const { data } = await db.from('blog_posts').select('*').eq('user_id', userId).in('video_id', ids).order('created_at', { ascending: false }).limit(10)
      for (const p of data ?? []) items.push({ kind: 'blog', label: madeLabel('blog', p.title), url: s(p.wordpress_url), imageUrl: null, at: p.created_at ?? null, id: p.id ?? null })
    }),
    tryRead(async () => {
      if (!asin) return
      const { data } = await db.from('blog_posts').select('*').eq('user_id', userId).eq('deal_meta->>asin', asin).order('created_at', { ascending: false }).limit(5)
      for (const p of data ?? []) items.push({ kind: 'deal', label: madeLabel('deal', p.title), url: s(p.wordpress_url), imageUrl: null, at: p.created_at ?? null, id: p.id ?? null })
    }),
    tryRead(async () => {
      if (!asin) return
      const { data } = await db.from('campaigns').select('*').eq('user_id', userId).eq('asin', asin).eq('status', 'published').order('created_at', { ascending: false }).limit(5)
      for (const c of data ?? []) items.push({ kind: 'campaign', label: madeLabel('campaign', c.product_title || c.campaign_name), url: s(c.wordpress_url), imageUrl: null, at: c.created_at ?? null, id: c.id ?? null })
    }),
    tryRead(async () => {
      if (!asin) return
      const { data } = await db.from('launch_items').select('*').eq('user_id', userId).eq('asin', asin).not('thumbnail_url', 'is', null).order('created_at', { ascending: false }).limit(5)
      for (const l of data ?? []) items.push({ kind: 'liftoff', label: madeLabel('liftoff', l.title || l.amazon_title), url: null, imageUrl: s(l.thumbnail_url), at: l.updated_at || l.created_at || null, id: l.id ?? null })
    }),
    tryRead(async () => {
      if (!asin) return
      const { data } = await db.from('video_scripts').select('*').eq('user_id', userId).eq('asin', asin).order('created_at', { ascending: false }).limit(5)
      for (const sc of data ?? []) items.push({ kind: 'script', label: madeLabel('script', sc.product_title || sc.style), url: null, imageUrl: null, at: sc.created_at ?? null, id: sc.id ?? null })
    }),
    tryRead(async () => {
      if (!brand) return
      const { data } = await db.from('collaborations').select('*').eq('user_id', userId).ilike('brand_name', brand.replace(/[%_]/g, '')).order('created_at', { ascending: false }).limit(5)
      for (const c of data ?? []) if (s(c.generated_email)) items.push({ kind: 'collab', label: madeLabel('collab', c.brand_name), url: null, imageUrl: null, at: c.created_at ?? null, id: c.id ?? null })
    }),
  ])
  return tidyMade(items)
}
