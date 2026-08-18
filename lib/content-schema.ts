/**
 * One-call SEO/AEO/GEO structured-data writer for EVERY piece of content MVP
 * publishes (articles, buying guides, idea lists, deal posts, roundups, digests,
 * LTK / Levanta / Walmart / Wayward / campaign posts).
 *
 * Reviews and comparisons already build their own richer graph (Review +
 * Product + VideoObject) via lib/seo-schema. This helper covers the rest: it
 * emits a clean Article/BlogPosting + Person (author) + Organization + FAQPage
 * + BreadcrumbList graph and writes it to the post's `mvp_jsonld` meta (the MVP
 * plugin renders it in <head>). That is the graph AI answer engines cite.
 *
 * Best-effort by design: it loads the author/publisher from brand_profiles,
 * builds the graph, writes the meta, and swallows any error. It must NEVER block
 * a publish — a post without schema is fine, a failed publish is not.
 */

import { buildContentSchemaGraph, extractFaqFromHtml } from '@/lib/seo-schema'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ContentSchemaArgs {
  /** The post owner (brand_profiles + author/publisher come from this). */
  userId: string
  /** The connected site's base URL (site.wordpress_url). */
  siteUrl: string
  /** The WordPress post id just created (target of the meta write). */
  wpPostId: number
  /** The published permalink (wpPost.link). */
  pageUrl: string
  title: string
  /** Meta description / excerpt. Falls back to the title. */
  description?: string | null
  /** Final published HTML body (used for word count + FAQPage extraction). */
  html: string
  /** Featured/hero image → article image + og:image. */
  imageUrl?: string | null
  /** 'Article' for informational content, 'BlogPosting' (default) otherwise. */
  pageType?: 'Article' | 'BlogPosting'
  /** Section label → articleSection + a breadcrumb crumb (e.g. 'Deals'). */
  category?: string | null
  /** CSS selectors for SpeakableSpecification (e.g. ['.mvp-takeaways']). */
  speakableSelectors?: string[] | null
  /** ISO date; defaults to now. */
  datePublished?: string | null
}

/**
 * Load the author/publisher, build the JSON-LD graph, and write it (+ meta
 * description + og:image) to the post. Never throws.
 */
export async function writeContentSchema(
  sb: any,
  wpService: { updatePost: (id: number, post: any) => Promise<any> },
  args: ContentSchemaArgs,
): Promise<void> {
  try {
    const { data: brand } = await sb
      .from('brand_profiles').select('*').eq('user_id', args.userId).maybeSingle()
    const b = (brand || {}) as Record<string, any>
    const wpBase = (args.siteUrl || '').replace(/\/$/, '')
    const now = args.datePublished || new Date().toISOString()
    const desc = (args.description || args.title || '').trim()

    const catSlug = (args.category || '')
      .toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

    const graph = buildContentSchemaGraph({
      pageUrl: args.pageUrl,
      title: args.title,
      description: desc || args.title,
      datePublished: now,
      dateModified: now,
      imageUrl: args.imageUrl || null,
      pageType: args.pageType || 'BlogPosting',
      author: {
        name: (b.author_name as string) || (b.name as string) || 'Editor',
        channelUrl: (b.youtube_url as string) || (b.website_url as string) || null,
        bio: (b.author_bio as string) || null,
        imageUrl: (b.headshot_url as string) || null,
        jobTitle: 'Writer',
        knowsAbout: Array.isArray(b.niches) ? (b.niches as string[]).slice(0, 8) : null,
      },
      publisher: {
        name: (b.name as string) || 'MVP Affiliate',
        url: args.siteUrl,
        logoUrl: (b.logo_url as string) || null,
        sameAs: [b.youtube_url, b.instagram_url, b.tiktok_url, b.website_url]
          .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)),
      },
      wordCount: (args.html || '')
        .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
        .trim().split(/\s+/).filter(Boolean).length || null,
      category: args.category || null,
      inLanguage: 'en',
      faq: extractFaqFromHtml(args.html || ''),
      breadcrumb: [
        { name: 'Home', url: wpBase || args.siteUrl },
        ...(args.category && catSlug ? [{ name: args.category, url: `${wpBase}/category/${catSlug}/` }] : []),
        { name: args.title, url: args.pageUrl },
      ],
      speakableSelectors: args.speakableSelectors || null,
      product: null,
      rating: null,
      video: null,
      thirdPartyProduct: false,
    })

    await wpService.updatePost(args.wpPostId, {
      meta: {
        mvp_jsonld: JSON.stringify(graph),
        mvp_meta_description: (desc || args.title).slice(0, 300),
        mvp_og_image: args.imageUrl || '',
      },
    })
  } catch (e) {
    console.warn('[content-schema] skipped:', e instanceof Error ? e.message : String(e))
  }
}
