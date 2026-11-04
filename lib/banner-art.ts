// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE NEW LOOK'S PAGE PICTURES (Seb's banner set, 2026-11-04), one per menu
// row, drawn on the right of the page's header card (teal-ui TealArt). Keyed by
// the menu row's label (DashboardShellV2), the same label the header reads, so
// a page and its tabs share one picture. A row missing here keeps its big
// menu icon instead.
//
// The files are public/banners/<name>.webp, cleaned and shrunk from Seb's
// PNGs by scripts/clean-banner-art.cjs. Held back until remade, because the
// picture has a grey checkerboard painted under it that would show on the
// page: Articles, Blog design, Blog posts and Ended deals. Not made yet:
// Scriptwriter, Newsletter, Hashtag insights.

export const BANNER_ART: Readonly<Record<string, string>> = {
  'Dashboard': 'dashboard',
  // Find products
  'Product research': 'product-research',
  'Deal Radar': 'deal-radar',
  'Brand campaigns': 'brand-campaigns',
  'Partner programs': 'partner-programs',
  'Idea lists': 'idea-lists',
  'TRYBE': 'trybe',
  // Make videos
  'Drop': 'drop',
  'Review Editor': 'review-editor',
  'YouTube Co-Pilot': 'youtube-co-pilot',
  'Thumbnails': 'thumbnails',
  'Clip Factory': 'clip-factory',
  'Bulk Amazon upload': 'bulk-amazon-upload',
  'YouTube comments': 'youtube-comments',
  'Instagram Auto-DM': 'instagram-auto-dm',
  'Amazon Live': 'amazon-live',
  // Blog
  'Comparisons and guides': 'comparisons',
  'SEO and indexing': 'seo',
  'Ads': 'ads',
  // Share
  'Social Push': 'social-push',
  'Deals Hub': 'deals-hub',
  'Social designs': 'social-designs',
  'Social Launch Kit': 'launch-kit',
  'Meta Hub': 'meta-hub',
  'Group Post Queue': 'group-queue',
  'Link in Bio': 'link-in-bio',
  'Passport links': 'passport',
  // Work with brands
  'Brand pitches': 'brand-pitches',
  'Brand inbox': 'brand-inbox',
  // Your setup
  'Connections': 'connections',
  'Brand and voice': 'brand-voice',
  'Face models': 'face-models',
  'Team': 'team',
  'Plan and usage': 'plan-usage',
  // Help
  'Ask MVP': 'ask-mvp',
  'Tutorials and support': 'tutorials',
}

/** The picture for a menu row, or null when it has none yet. */
export function bannerFor(label: string | null | undefined): string | null {
  const name = label ? BANNER_ART[label] : undefined
  return name ? `/banners/${name}.webp` : null
}
