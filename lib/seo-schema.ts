/**
 * SEO / AEO / GEO structured-data builder.
 *
 * Emits ONE schema.org JSON-LD `@graph` per blog post (never competing
 * top-level blocks — that confuses Google about which entity represents the
 * page and hurts both). The graph cross-references nodes by `@id`:
 *
 *   BlogPosting ──video──▶ VideoObject        (the embedded YouTube review)
 *        │
 *        └─ (page also carries) Review ─itemReviewed─▶ Product
 *                                   └─ reviewRating (Rating)
 *   + FAQPage  + BreadcrumbList  + Organization (publisher) + Person (author)
 *
 * Why this matters: the embedded review video is first-hand "Experience" proof
 * (the dominant 2026 ranking signal), an AI-answer citation magnet, and (via
 * VideoObject) eligible for video rich results / Key Moments.
 *
 * SELF-SERVING REVIEW GUARDRAIL: Google suppresses review stars when an entity
 * reviews *its own* product/org. Our creators review THIRD-PARTY products, so
 * stars are valid — but we only emit the Review node when `thirdPartyProduct`
 * is true and a real rating + product exist. Never mark up a review of the
 * user's own product.
 *
 * Delivery: the returned object is JSON-stringified and sent to WordPress as
 * post meta (`mvp_jsonld`); the MVP theme renders it in <head>. No dependency
 * on the user having Yoast/RankMath.
 */

export interface SeoFaqItem {
  question: string
  answer: string
}

export interface SeoSchemaInput {
  /** Canonical URL of the published post (the WordPress permalink). */
  pageUrl: string
  /** Post headline / title. */
  title: string
  /** Meta description (1–2 sentences). Falls back to excerpt upstream. */
  description: string
  /** ISO 8601. */
  datePublished: string
  /** ISO 8601. Defaults to datePublished. */
  dateModified?: string
  /** Hero/featured image URL (the upscaled AI hero, not the raw frame). */
  imageUrl?: string | null

  author: {
    name: string
    /** The creator's YouTube channel (or site) URL → Person.sameAs. */
    channelUrl?: string | null
  }
  publisher: {
    name: string
    url: string
    logoUrl?: string | null
  }

  /** The reviewed product. Null when the post isn't a single-product review. */
  product?: {
    name: string
    imageUrl?: string | null
    brand?: string | null
    /** The affiliate/destination URL for the product. */
    url?: string | null
  } | null
  /** Numeric rating out of `ratingMax` (default 5). Null → no Review stars. */
  rating?: number | null
  ratingMax?: number
  /** Guardrail: only emit Review stars for genuine third-party products. */
  thirdPartyProduct?: boolean

  /** The embedded YouTube review video. */
  video?: {
    youtubeId: string
    name: string
    description: string
    uploadDate: string
    thumbnailUrl?: string | null
    /** Seconds → ISO 8601 duration (e.g. 754 → "PT12M34S"). */
    durationSeconds?: number | null
  } | null

  /** Structured Q&A → FAQPage (high-leverage AEO win). */
  faq?: SeoFaqItem[] | null

  /** Home → Category → Post trail. */
  breadcrumb?: Array<{ name: string; url: string }> | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = Record<string, any>

/** Parse a rating like "4.5", "4.5/5", "4,5 out of 5" → 4.5 (clamped). */
export function parseRating(raw: string | number | null | undefined, max = 5): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') return clampRating(raw, max)
  const m = String(raw).replace(',', '.').match(/(\d+(?:\.\d+)?)/)
  if (!m) return null
  return clampRating(parseFloat(m[1]), max)
}
function clampRating(n: number, max: number): number | null {
  if (!isFinite(n) || n <= 0) return null
  return Math.min(Math.round(n * 10) / 10, max)
}

/** Seconds → ISO 8601 duration ("PT12M34S"). */
function isoDuration(seconds?: number | null): string | undefined {
  if (!seconds || seconds <= 0) return undefined
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s ? `${s}S` : ''}` || 'PT0S'
}

/**
 * Build the JSON-LD `@graph` for a product-review blog post.
 * Returns a plain object ready to `JSON.stringify` into a
 * <script type="application/ld+json"> tag.
 */
export function buildReviewSchemaGraph(input: SeoSchemaInput): { '@context': string; '@graph': Node[] } {
  const url = input.pageUrl.replace(/#.*$/, '')
  const ratingMax = input.ratingMax ?? 5
  const modified = input.dateModified || input.datePublished

  const id = {
    article: `${url}#article`,
    person: `${url}#author`,
    org: `${input.publisher.url.replace(/\/$/, '')}#org`,
    review: `${url}#review`,
    product: `${url}#product`,
    video: `${url}#video`,
    faq: `${url}#faq`,
    breadcrumb: `${url}#breadcrumb`,
  }

  const graph: Node[] = []

  // ── Person (author) ──────────────────────────────────────────────────────
  const person: Node = { '@type': 'Person', '@id': id.person, name: input.author.name }
  if (input.author.channelUrl) person.sameAs = [input.author.channelUrl]
  graph.push(person)

  // ── Organization (publisher) ─────────────────────────────────────────────
  const org: Node = { '@type': 'Organization', '@id': id.org, name: input.publisher.name, url: input.publisher.url }
  if (input.publisher.logoUrl) {
    org.logo = { '@type': 'ImageObject', url: input.publisher.logoUrl }
  }
  graph.push(org)

  // ── VideoObject (the embedded YouTube review) ────────────────────────────
  let hasVideo = false
  if (input.video?.youtubeId) {
    hasVideo = true
    const v = input.video
    const video: Node = {
      '@type': 'VideoObject',
      '@id': id.video,
      name: v.name || input.title,
      description: v.description || input.description,
      uploadDate: v.uploadDate,
      thumbnailUrl: [v.thumbnailUrl || `https://img.youtube.com/vi/${v.youtubeId}/maxresdefault.jpg`],
      contentUrl: `https://www.youtube.com/watch?v=${v.youtubeId}`,
      embedUrl: `https://www.youtube.com/embed/${v.youtubeId}`,
    }
    const dur = isoDuration(v.durationSeconds)
    if (dur) video.duration = dur
    graph.push(video)
  }

  // ── BlogPosting (the page node) ──────────────────────────────────────────
  const article: Node = {
    '@type': 'BlogPosting',
    '@id': id.article,
    headline: input.title.slice(0, 110),
    description: input.description,
    datePublished: input.datePublished,
    dateModified: modified,
    author: { '@id': id.person },
    publisher: { '@id': id.org },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  }
  if (input.imageUrl) article.image = [input.imageUrl]
  if (hasVideo) article.video = { '@id': id.video }
  graph.push(article)

  // ── Review → Product (self-serving guardrail) ────────────────────────────
  const rating = input.rating ?? null
  const canReview = !!input.product && input.thirdPartyProduct !== false
  if (canReview && input.product) {
    const product: Node = {
      '@type': 'Product',
      '@id': id.product,
      name: input.product.name,
    }
    if (input.product.imageUrl) product.image = [input.product.imageUrl]
    if (input.product.brand) product.brand = { '@type': 'Brand', name: input.product.brand }

    const review: Node = {
      '@type': 'Review',
      '@id': id.review,
      itemReviewed: { '@id': id.product },
      author: { '@id': id.person },
      datePublished: input.datePublished,
      url,
    }
    if (rating != null) {
      review.reviewRating = {
        '@type': 'Rating',
        ratingValue: rating,
        bestRating: ratingMax,
        worstRating: 1,
      }
      // Surface the rating on the Product too (single first-party review →
      // use `review`, not `aggregateRating`, to stay within Google's policy).
      product.review = { '@id': id.review }
    }
    graph.push(product, review)
  }

  // ── FAQPage ──────────────────────────────────────────────────────────────
  const faq = (input.faq || []).filter(f => f?.question?.trim() && f?.answer?.trim())
  if (faq.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      '@id': id.faq,
      mainEntity: faq.map(f => ({
        '@type': 'Question',
        name: f.question.trim(),
        acceptedAnswer: { '@type': 'Answer', text: f.answer.trim() },
      })),
    })
  }

  // ── BreadcrumbList ───────────────────────────────────────────────────────
  const crumbs = input.breadcrumb || []
  if (crumbs.length > 0) {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': id.breadcrumb,
      itemListElement: crumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        item: c.url,
      })),
    })
  }

  return { '@context': 'https://schema.org', '@graph': graph }
}
