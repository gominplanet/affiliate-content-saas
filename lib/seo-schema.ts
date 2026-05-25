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

/** Strip WP block comments + HTML tags + common entities → plain text. */
function stripHtml(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract the on-page FAQ (question/answer pairs) from generated post HTML so
 * the FAQPage schema EXACTLY matches the visible content (Google requires the
 * markup to reflect what's on the page). Scoped to the "Frequently Asked
 * Questions" section: each `<h3>` is a question, everything up to the next
 * `<h3>` (or the next `<h2>`/section end) is its answer.
 */
export function extractFaqFromHtml(html: string): SeoFaqItem[] {
  if (!html) return []
  const faqStart = html.search(/<h2[^>]*>\s*Frequently Asked Questions\s*<\/h2>/i)
  if (faqStart === -1) return []
  let section = html.slice(faqStart)
  // Bound the FAQ section so post-FAQ blocks don't leak into the last answer:
  // stop at the next <h2> OR the verdict / rating / CTA cards that follow the
  // FAQ in our template (those are <div>s, not headings).
  const bound = section.slice(1).search(/<h2[^>]*>|class="gr-(?:rating-box|verdict|cta)/i)
  if (bound !== -1) section = section.slice(0, bound + 1)

  const h3re = /<h3[^>]*>([\s\S]*?)<\/h3>/gi
  const marks: Array<{ q: string; end: number; start: number }> = []
  let m: RegExpExecArray | null
  while ((m = h3re.exec(section)) !== null) {
    marks.push({ q: stripHtml(m[1]), start: m.index, end: h3re.lastIndex })
  }
  const items: SeoFaqItem[] = []
  for (let i = 0; i < marks.length; i++) {
    const answerHtml = section.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].start : section.length)
    const question = marks[i].q
    const answer = stripHtml(answerHtml)
    if (question && answer) items.push({ question, answer })
  }
  return items
}

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
  person.url = input.author.channelUrl || input.publisher.url
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

    // Only emit a Review when there's a real rating, and link it from the
    // Product (product.review → @id). Per Google, a Review reached via its
    // parent item must NOT carry `itemReviewed` (directional conflict), so it's
    // omitted. A single first-party review uses `review`, not `aggregateRating`.
    if (rating != null) {
      const review: Node = {
        '@type': 'Review',
        '@id': id.review,
        author: { '@id': id.person },
        datePublished: input.datePublished,
        url,
        reviewRating: {
          '@type': 'Rating',
          ratingValue: rating,
          bestRating: ratingMax,
          worstRating: 1,
        },
      }
      product.review = { '@id': id.review }
      graph.push(product, review)
    } else {
      graph.push(product)
    }
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
