// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Build a post's featured thumbnail, and say what actually happened.
//
// WHY THIS IS A MODULE AND NOT SIXTY LINES INSIDE A ROUTE. It was sixty lines
// inside a route: the Art Director hero block, two thousand four hundred lines
// into /api/blog/generate. That made it reachable exactly one way, by
// regenerating the whole post, so a creator who only wanted a new thumbnail had
// to rewrite an article that was already fine. One reported a misspelled
// headline and asked for a way to redo just the image; there was none.
//
// SO BOTH CALLERS SHARE THIS. The generate route still runs it as part of a
// rewrite, and the rebuild button runs it on its own. A second copy would have
// been two paths that agree about the cap, the product lookup and the upload
// until the first time one of them learned something.
//
// IT REPORTS WHAT HAPPENED. The old block wrote three different console
// warnings and returned nothing, so every outcome looked the same from
// outside: over the cap, no product image, and a generator that returned null
// were one silent shrug. A button needs to tell somebody which of those it was.

import { resolveProductReference } from '@/lib/resolve-product-reference'
import { generateArtDirectorBlogHero } from '@/lib/art-director-pin'
import { getBrandPresetId } from '@/lib/brand-preset'
import { getAccountHeadlineStyle } from '@/lib/thumbnail-style'
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'
import { TIERS } from '@/lib/tier'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Wp = any

export type HeroOutcome =
  | { ok: true; imageUrl: string | null; mediaId: number }
  /** Every one of these was a console warning and nothing else before. */
  | { ok: false; reason: 'over_cap' | 'no_product_image' | 'generator_failed' | 'upload_failed' | 'error'; message: string }

/** What a creator should read, per outcome. Kept beside the outcomes so a new
 *  one cannot be added without a sentence for it. */
export function heroOutcomeMessage(o: HeroOutcome): string {
  if (o.ok) return 'New thumbnail built and set on the post. It can take a minute to show.'
  switch (o.reason) {
    case 'over_cap':
      return 'You have used all your thumbnails for this billing period, so the current one is being kept.'
    case 'no_product_image':
      return 'No product photo could be found for this post, and the designed thumbnail is built from one. Set the product on the video and try again.'
    case 'generator_failed':
      return 'The thumbnail could not be designed this time. Nothing changed on the post, so try again in a moment.'
    case 'upload_failed':
      return 'The thumbnail was designed but WordPress would not accept it. The old one is still on the post.'
    default:
      // NEVER THE RAW EXCEPTION. `message` is whatever an SDK threw, which is
      // for the log, not for somebody deciding what to do next. The sentence
      // says the one thing they actually need: the post is as it was.
      return 'The thumbnail could not be rebuilt, so the current one is still on the post. Try again in a moment.'
  }
}

/**
 * Design a new featured image for a post and set it.
 *
 * NOTHING IS REMOVED ON FAILURE. Every exit leaves whatever the post already
 * had, because a post with the wrong thumbnail is better than a post with none,
 * and that is the state a half-finished rebuild would leave behind.
 */
export async function rebuildPostHero(opts: {
  supabase: Sb
  wpService: Wp
  userId: string
  tier: string | null
  /** The WordPress post to set the image on. */
  wpPostId: number
  /** The video this post was written from, for the product photo. */
  video: { id?: string | null; title?: string | null; product_image_url?: string | null } | null
  description?: string | null
  asin?: string | null
  wordpressUrl?: string | null
  fallbackTitle: string
  slug: string
  periodStart?: string | null
  periodEnd?: string | null
  traceTag?: string
}): Promise<HeroOutcome> {
  const tag = opts.traceTag || '[blog-adthumb]'
  try {
    // PAID ACTION, SO IT COUNTS AGAINST THE SAME ALLOWANCE the Thumbnail
    // Generator enforces. A rebuild button that did not count would be a way to
    // spend without a cap simply by pressing it repeatedly.
    const tierKey = (opts.tier || '') as keyof typeof TIERS
    const thumbCapLimit = TIERS[tierKey]?.thumbnailsPerMonth ?? null
    if (typeof thumbCapLimit === 'number') {
      const cap = await checkUsageCap(
        opts.supabase, opts.userId,
        [...PRIMARY_FEATURE.thumbnail, 'yt_thumb_graphic'],
        thumbCapLimit,
        opts.periodStart ?? null,
        opts.periodEnd ?? null,
      )
      if (cap?.exceeded) {
        console.warn(`${tag} thumbnail cap reached for tier ${opts.tier} — keeping the current thumb`)
        return { ok: false, reason: 'over_cap', message: 'thumbnail cap reached' }
      }
    }

    const ref = await resolveProductReference({
      uploadedUrl: (opts.video?.product_image_url || '')?.trim() || null,
      title: opts.video?.title ?? null,
      description: opts.description ?? null,
      asin: opts.asin ?? null,
      wordpressUrl: opts.wordpressUrl ?? null,
      traceTag: tag,
      userId: opts.userId,
      tier: opts.tier,
    })
    if (!ref.productImageUrl) {
      console.warn(`${tag} no product image resolved — keeping the current thumb`)
      return { ok: false, reason: 'no_product_image', message: 'no product image resolved' }
    }

    const hero = await generateArtDirectorBlogHero({
      presetId: await getBrandPresetId(opts.userId),
      productImageUrl: ref.productImageUrl,
      productTitle: ref.productTitle || opts.fallbackTitle,
      productContext: (opts.description || '').slice(0, 700),
      userId: opts.userId,
      tier: opts.tier,
      headlineStyle: await getAccountHeadlineStyle(opts.supabase, opts.userId),
    })
    if (!hero) {
      console.warn(`${tag} hero generation returned null — keeping the current thumb`)
      return { ok: false, reason: 'generator_failed', message: 'hero generation returned null' }
    }

    const media = await opts.wpService.uploadImageFromBase64(hero.data, `${opts.slug}-adhero.jpg`, hero.mediaType)
    if (!media?.id) {
      return { ok: false, reason: 'upload_failed', message: 'WordPress did not return a media id' }
    }
    await opts.wpService.updatePost(opts.wpPostId, { featured_media: media.id })
    console.log(`${tag} set Art Director hero`, { mediaId: media.id })
    return { ok: true, imageUrl: media.source_url || null, mediaId: media.id }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn(`${tag} failed — keeping the current thumb:`, message)
    return { ok: false, reason: 'error', message }
  }
}
