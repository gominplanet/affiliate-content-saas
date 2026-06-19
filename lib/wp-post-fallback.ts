/**
 * Build a minimal post-like object from a WordPress-only post — one that exists
 * on the user's site but has NO `blog_posts` row (so the social routes' normal
 * `.eq('id', …)` lookup 404s with "Post not found"). This lets social publishing
 * operate directly off the WordPress post the client already knows about
 * (title + permalink + image), instead of requiring an MVP record.
 *
 * Carries only the fields the pin/social pipeline reads: title, wordpress_url,
 * wordpress_post_id (used for the category-board lookup), a featured image
 * fallback, and an empty social_publish_counts (no per-post cap tracking —
 * there's no row to persist it on). `id` is null → callers MUST skip any DB
 * write keyed on the post id when they're operating on one of these.
 */
export interface SyntheticPost {
  id: null
  title: string
  wordpress_url: string
  wordpress_post_id: number | null
  wordpress_site_id: string | null
  featured_image_url: string | null
  thumbnail_url: string | null
  video_id: null
  content: string
  excerpt: string
  social_publish_counts: Record<string, never>
}

export function syntheticWpPost(args: {
  wpPostId?: string | number | null
  url?: string | null
  title?: string | null
  image?: string | null
}): SyntheticPost {
  const idStr = args.wpPostId == null ? '' : String(args.wpPostId)
  const numeric = /^\d+$/.test(idStr) ? Number(idStr) : null
  const img = (args.image || '').trim() || null
  return {
    id: null,
    title: (args.title || '').trim() || 'Untitled post',
    wordpress_url: (args.url || '').trim(),
    wordpress_post_id: numeric,
    wordpress_site_id: null,
    featured_image_url: img,
    thumbnail_url: img,
    video_id: null,
    content: '',
    excerpt: '',
    social_publish_counts: {},
  }
}
