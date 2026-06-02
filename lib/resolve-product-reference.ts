// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Single source of truth for "given everything we know about this piece of
// content, which image best represents the actual product the user is
// referring to?". Used by:
//
//   - blog/generate          → in-article image generation
//   - blog/refresh-images    → re-running images on a published post
//   - youtube/generate-thumbnail
//   - script/generate
//   - any future tool that needs the canonical product photo
//
// Why this exists: the resolution chain used to live inline in each route.
// They drifted — the Amazon bot-block detection + retry that we added for
// blog/refresh-images on 2026-06-02 didn't help the thumbnail route until
// someone manually copied the code. One source of truth makes every tool
// improve together when we harden any single step.
//
// Resolution priority (first non-null wins):
//   1. Uploaded photo (user dropped a product image directly on the video)
//   2. Amazon ASIN from title — fetchAmazonProduct → vision-pick gallery
//   3. Geniuslink/Amazon URL in description → resolve → ASIN → fetchAmazonProduct
//   4. Non-Amazon product URL in description → gallery scrape → vision-pick
//   5. Campaign ASIN (EPC / Creator-Connections posts, no source video)
//   6. null + source: 'none' so the caller knows we have nothing
//
// Every step emits a [tag] step:* log line so a failed resolution is fully
// traceable in Vercel logs — same diagnostic we built into refresh-images
// when debugging the wax-warmer article.

import { extractAsin, fetchAmazonProduct } from '@/services/amazon'
import { resolveFinalUrl, firstProductUrl } from '@/lib/product-link'
import { pickProductReferenceImage } from '@/lib/product-image'
import { fetchProductImageFromPage, fetchProductGalleryFromPage } from '@/services/research'

/** Signals the caller already has — pass everything available; the
 *  resolver decides what to use. Missing fields are fine. */
export interface ResolveProductReferenceInput {
  /** A photo the user uploaded directly (always wins if present). */
  uploadedUrl?: string | null
  /** Free-text title (YouTube video title, blog post title, etc.) — scanned for ASINs. */
  title?: string | null
  /** Description body — scanned for the first product/affiliate link. */
  description?: string | null
  /** Explicit ASIN if the caller already knows it (e.g. from a database column). */
  asin?: string | null
  /** Secondary ASIN (campaigns table). Used only if all primary paths fail. */
  campaignAsin?: string | null
  /** Caller's own WordPress URL — used to filter out self-links from the
   *  description scrape so we never resolve the user's own blog as the "product". */
  wordpressUrl?: string | null
  /** Trace tag for log lines — e.g. `[blog-generate:abc123]`. Defaults to
   *  `[resolve-product]` if not given. */
  traceTag?: string
  /** Required for Anthropic usage tracking on the vision picker. */
  userId: string
  /** Tier (or null) for usage tracking. */
  tier: string | null
}

export interface ResolveProductReferenceResult {
  /** The resolved product image URL — clean isolated product shot if we had
   *  multiple candidates and vision-picked, otherwise whatever single
   *  image we could find. null only if all paths failed. */
  productImageUrl: string | null
  /** The product's real title if a successful scrape happened. Fallback:
   *  whatever title the caller passed in (often the YouTube title). */
  productTitle: string | null
  /** Full gallery (vision-picked first, others next) — useful when the
   *  caller wants to pass MULTIPLE reference images to an image model for
   *  stronger identity grounding. Empty array if no gallery was found. */
  gallery: string[]
  /** Which leg of the chain actually produced the result. Useful for log /
   *  metrics dashboards — lets us see how often each path is winning. */
  source: 'uploaded' | 'amazon-asin' | 'amazon-page-url' | 'non-amazon-page' | 'campaign-asin' | 'none'
}

/**
 * The canonical "find the product image" function. Always use this — never
 * duplicate the resolution chain inline in a route. When we improve a step
 * (better Amazon headers, better vision picker, junk-URL filter, etc.) it
 * automatically applies to every caller.
 */
export async function resolveProductReference(
  input: ResolveProductReferenceInput,
): Promise<ResolveProductReferenceResult> {
  const tag = input.traceTag ?? '[resolve-product]'
  const ctx = { userId: input.userId, tier: input.tier }

  console.log(`${tag} resolving product image`, {
    hasUploadedUrl: !!input.uploadedUrl,
    hasTitle: !!input.title,
    titleLen: input.title?.length ?? 0,
    descLen: input.description?.length ?? 0,
    knownAsin: input.asin ?? null,
    campaignAsin: input.campaignAsin ?? null,
  })

  // ── 1. User-uploaded photo wins outright ────────────────────────────────
  if (input.uploadedUrl) {
    console.log(`${tag} resolved via uploaded photo`, { productImageUrl: input.uploadedUrl })
    return {
      productImageUrl: input.uploadedUrl,
      productTitle: input.title ?? null,
      gallery: [input.uploadedUrl],
      source: 'uploaded',
    }
  }

  // ── 2 + 3. Amazon-ASIN path (from title OR resolved description URL) ───
  // First try ASIN-in-title, then dig the description for an Amazon /
  // affiliate URL and unwrap it. Either way we end up calling
  // fetchAmazonProduct, which is the most reliable source of a clean
  // product image gallery.
  const titleUpper = (input.title ?? '').toUpperCase()
  let asin: string | null = input.asin ?? extractAsin(titleUpper)
  console.log(`${tag} step:asin-from-title`, { asin, titleUpper: titleUpper.slice(0, 100) })

  let pageUrl: string | null = null
  if (input.description) {
    pageUrl = firstProductUrl(input.description, input.wordpressUrl ?? null)
    console.log(`${tag} step:pageUrl-from-description`, { pageUrl: pageUrl?.slice(0, 200) ?? null })
    if (pageUrl && /(?:geni\.us|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i.test(pageUrl)) {
      const before = pageUrl
      try {
        pageUrl = await resolveFinalUrl(pageUrl)
        console.log(`${tag} step:resolveFinalUrl`, { before, after: pageUrl?.slice(0, 200) ?? null })
      } catch (e) {
        console.warn(`${tag} step:resolveFinalUrl FAILED`, { before, error: e instanceof Error ? e.message : String(e) })
      }
    }
    if (!asin && pageUrl) {
      asin = extractAsin(pageUrl)
      console.log(`${tag} step:asin-from-pageUrl`, { asin })
    }
  }

  // If we have an ASIN now (from title or resolved description URL), try Amazon.
  if (asin) {
    try {
      const p = await fetchAmazonProduct(asin)
      console.log(`${tag} step:fetchAmazonProduct ok`, {
        asin,
        gotTitle: !!p.title,
        galleryCount: p.images?.length ?? 0,
        hasMainImage: !!p.imageUrl,
      })
      const picked = (await pickProductReferenceImage(p.images, p.title || input.title || '', ctx)) || p.imageUrl
      console.log(`${tag} step:pickProductReferenceImage (amazon)`, { picked })
      if (picked) {
        // Put the picked image FIRST in the gallery — callers that pass
        // multiple references to an image model expect the cleanest shot
        // up top so the model anchors on it.
        const gallery = [picked, ...(p.images || []).filter(u => u && u !== picked)].slice(0, 8)
        return {
          productImageUrl: picked,
          productTitle: p.title || input.title || null,
          gallery,
          source: asin === input.asin ? 'amazon-asin' : 'amazon-page-url',
        }
      }
    } catch (e) {
      // fetchAmazonProduct now throws on empty/bot-block (2026-06-02 fix)
      // so we land here cleanly instead of pretending success with junk
      // data. Falls through to the next path.
      console.warn(`${tag} step:fetchAmazonProduct FAILED`, { asin, error: e instanceof Error ? e.message : String(e) })
    }
  }

  // ── 4. Non-Amazon product URL (DTC brands, Shopify, etc.) ──────────────
  if (pageUrl) {
    try {
      const galleryImgs = await fetchProductGalleryFromPage(pageUrl)
      console.log(`${tag} step:fetchProductGalleryFromPage`, { count: galleryImgs.length, sample: galleryImgs[0]?.slice(0, 100) ?? null })
      let picked: string | null = null
      if (galleryImgs.length > 0) {
        picked = (await pickProductReferenceImage(galleryImgs, input.title || '', ctx)) || null
        console.log(`${tag} step:pickProductReferenceImage (page-gallery)`, { picked })
      }
      // Belt-and-suspenders single-image fallback if the gallery scraper
      // found nothing (pages with zero scrapable product images).
      if (!picked) {
        picked = await fetchProductImageFromPage(pageUrl)
        console.log(`${tag} step:fetchProductImageFromPage (single-image fallback)`, { picked })
      }
      if (picked) {
        const gallery = picked ? [picked, ...galleryImgs.filter(u => u !== picked)].slice(0, 8) : galleryImgs
        return {
          productImageUrl: picked,
          productTitle: input.title ?? null,
          gallery,
          source: 'non-amazon-page',
        }
      }
    } catch (e) {
      console.warn(`${tag} step:page-resolution FAILED`, { pageUrl: pageUrl.slice(0, 200), error: e instanceof Error ? e.message : String(e) })
    }
  }

  // ── 5. Campaign ASIN fallback (EPC / Creator-Connections posts) ────────
  if (input.campaignAsin) {
    try {
      const p = await fetchAmazonProduct(input.campaignAsin)
      console.log(`${tag} step:fetchAmazonProduct(campaign) ok`, {
        asin: input.campaignAsin,
        galleryCount: p.images?.length ?? 0,
      })
      const picked = (await pickProductReferenceImage(p.images, p.title || input.title || '', ctx)) || p.imageUrl
      if (picked) {
        const gallery = [picked, ...(p.images || []).filter(u => u && u !== picked)].slice(0, 8)
        return {
          productImageUrl: picked,
          productTitle: p.title || input.title || null,
          gallery,
          source: 'campaign-asin',
        }
      }
    } catch (e) {
      console.warn(`${tag} step:fetchAmazonProduct(campaign) FAILED`, { asin: input.campaignAsin, error: e instanceof Error ? e.message : String(e) })
    }
  }

  // ── 6. Nothing worked. Loud warn so it surfaces in Vercel logs. ────────
  console.warn(`${tag} NO product reference resolved — downstream will use text-only generation`, {
    title: input.title?.slice(0, 100),
    hadDescription: !!input.description,
    triedAsin: asin,
    triedPageUrl: pageUrl?.slice(0, 200) ?? null,
  })
  return {
    productImageUrl: null,
    productTitle: input.title ?? null,
    gallery: [],
    source: 'none',
  }
}
