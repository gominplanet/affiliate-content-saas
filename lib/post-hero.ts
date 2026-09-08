// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Every post that goes up gets a designed hero, or says why it did not.
//
// A Deal Radar roundup of four products went to the site fronted by one bare
// Amazon photograph of a beverage fridge. The route did that on purpose: its
// comment read "a roundup spans multiple products, so use the lead deal's
// product image (the AI thumbnail pipeline is single-product)". True when it
// was written, and the shape of the whole problem.
//
// Counted across the codebase: nineteen routes create a WordPress post, and
// three of them ever generated a designed hero. The other sixteen uploaded a
// raw product photograph or nothing at all. Even on the one route that did it
// properly it was opt-in per request, off unless a flag was passed, so most
// posts never tried. A creator pasting their post URL into ChatGPT and getting
// a better banner back in one shot is a fair verdict on that.
//
// So this is the single place that answers "what image fronts this post", and
// every route calls it instead of hand-rolling an upload. It:
//
//   - picks the right designer for the post's shape: one product gets the
//     single-product hero, two or more get the roundup hero, which is the case
//     that did not exist before;
//   - respects the same per-tier thumbnail allowance and monthly spend ceiling
//     the Thumbnail Generator enforces, because this is a paid render and a
//     creator on a cap should not discover it here;
//   - falls back to whatever the route would have used before, so a post is
//     never left with no image because the designer had an off day;
//   - and REPORTS which of those happened, rather than returning a media id
//     that looks identical either way.
//
// That last point is the one worth keeping. A silent fallback is how a
// "designed hero" feature can be switched on across nineteen routes and quietly
// produce raw product photos for months.

import { TIERS, normalizeTier } from '@/lib/tier'
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'
import { spendGate } from '@/lib/ai-spend'
import { generateArtDirectorBlogHero, generateArtDirectorRoundupHero, type HeadlineStyle } from '@/lib/art-director-pin'

/** What actually fronts the post, and how it got there. */
export interface HeroOutcome {
  /** WordPress media id to set as featured_media, or null when nothing worked. */
  mediaId: number | null
  /** Public URL of whatever was attached, for schema and social cards. */
  sourceUrl: string | null
  /** 'designed' = an Art Director render. 'product-photo' = the raw fallback.
   *  'none' = nothing was attached. Kept distinct because on screen the first
   *  two look like a working feature and only one of them is. */
  kind: 'designed' | 'product-photo' | 'none'
  /** Why it is not a designed hero, in a sentence, when it is not. Null when
   *  the designed render succeeded. */
  note: string | null
}

/** Minimal shape of the WordPress service this needs, so callers can pass their
 *  existing instance without a cast. */
interface WpLike {
  uploadImageFromUrl(url: string, filename: string): Promise<{ id?: number; source_url?: string } | null>
  uploadImageFromBase64(data: string, filename: string, mediaType?: string): Promise<{ id?: number; source_url?: string } | null>
}

export interface HeroRequest {
  wpService: WpLike
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
  userId: string
  tier: string | null | undefined
  subscriptionStart?: string | null
  subscriptionEnd?: string | null
  /** The products the post is actually about, in the order the post presents
   *  them. Two or more switches on the roundup designer. */
  products: Array<{ imageUrl: string | null | undefined; title: string }>
  /** Post title, used for the filename and as a copy fallback. */
  title: string
  /** Category or theme the post covers, e.g. "home furniture". Drives the
   *  headline the designer writes. */
  category?: string | null
  /** 'deal' = current price drops. 'guide' = considered picks. 'review' = one
   *  product examined. Decides which designer and which copy rules apply. */
  kind: 'deal' | 'guide' | 'review'
  slug?: string | null
  headlineStyle?: HeadlineStyle
  /** Extra context for the single-product designer (the product description). */
  productContext?: string | null
  brandName?: string | null
}

/** Filename-safe slug for the uploaded media. */
function fileSlug(s: string | null | undefined, fallback: string): string {
  const out = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  return out || fallback
}

/**
 * Attach a hero image to a post that has just been created, best-effort.
 *
 * Never throws: a hero is worth trying for and is never worth failing a publish
 * over. The outcome says what happened.
 */
export async function attachPostHero(req: HeroRequest): Promise<HeroOutcome> {
  const usable = (req.products || []).filter((p) => !!p.imageUrl && !!p.title) as Array<{ imageUrl: string; title: string }>
  const fallbackUrl = usable[0]?.imageUrl ?? null
  const name = fileSlug(req.slug || req.title, 'post')

  // The raw product photo, which is what every one of these routes did before.
  // Used whenever the designed render is skipped or fails, so the post is never
  // worse off than it used to be.
  const useFallback = async (note: string): Promise<HeroOutcome> => {
    if (!fallbackUrl) return { mediaId: null, sourceUrl: null, kind: 'none', note: `${note} There was also no product photo to fall back on, so the post has no featured image.` }
    try {
      const media = await req.wpService.uploadImageFromUrl(fallbackUrl, `${name}.jpg`)
      const id = (media?.id as number | undefined) ?? null
      return { mediaId: id, sourceUrl: media?.source_url ?? null, kind: id ? 'product-photo' : 'none', note }
    } catch (e) {
      console.warn('[post-hero] fallback product photo upload failed:', e instanceof Error ? e.message : e)
      return { mediaId: null, sourceUrl: null, kind: 'none', note: `${note} The product photo could not be uploaded either.` }
    }
  }

  if (usable.length === 0) {
    return { mediaId: null, sourceUrl: null, kind: 'none', note: 'This post had no product image to work from, so no featured image was made.' }
  }

  try {
    // ── Paid render, so the same two gates the Thumbnail Generator uses ──────
    // The monthly dollar ceiling first, since it is the cheaper check and the
    // one that exists to stop a runaway bill.
    const tier = normalizeTier(req.tier)
    const blocked = await spendGate(req.userId, tier)
    if (blocked) return useFallback('Your monthly AI spend ceiling was reached, so this post uses the product photo instead of a designed header.')

    const capLimit = TIERS[tier]?.thumbnailsPerMonth ?? null
    if (typeof capLimit === 'number') {
      const cap = await checkUsageCap(
        req.db, req.userId,
        [...PRIMARY_FEATURE.thumbnail, 'yt_thumb_graphic'],
        capLimit,
        req.subscriptionStart ?? null,
        req.subscriptionEnd ?? null,
      )
      if (cap?.exceeded) {
        return useFallback(`You have used all ${capLimit} designed images on your plan this period, so this post uses the product photo instead.`)
      }
    }

    // ── Pick the designer by the shape of the post ──────────────────────────
    // Two or more products is a roundup and needs the wide multi-product
    // header. One product is a review and gets the single-product hero. This
    // is the branch whose absence sent a four-product deals post to the site
    // wearing one photo of a fridge.
    const hero = usable.length >= 2
      ? await generateArtDirectorRoundupHero({
        products: usable.slice(0, 4),
        category: req.category || req.title,
        kind: req.kind === 'deal' ? 'deal' : 'guide',
        brandName: req.brandName ?? null,
        userId: req.userId,
        tier: req.tier ?? null,
      })
      : await generateArtDirectorBlogHero({
        productImageUrl: usable[0].imageUrl,
        productTitle: usable[0].title,
        productContext: (req.productContext || '').slice(0, 700),
        userId: req.userId,
        tier: req.tier ?? null,
        headlineStyle: req.headlineStyle,
      })

    if (!hero) return useFallback('The designed header could not be generated this time, so the post uses the product photo.')

    const media = await req.wpService.uploadImageFromBase64(hero.data, `${name}-hero.jpg`, hero.mediaType)
    const id = (media?.id as number | undefined) ?? null
    if (!id) return useFallback('The designed header was made but could not be uploaded to your site, so the post uses the product photo.')

    return { mediaId: id, sourceUrl: media?.source_url ?? null, kind: 'designed', note: null }
  } catch (e) {
    console.warn('[post-hero] designed hero failed:', e instanceof Error ? e.message : e)
    return useFallback('The designed header could not be generated this time, so the post uses the product photo.')
  }
}
