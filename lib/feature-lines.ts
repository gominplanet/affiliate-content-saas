// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT EACH FEATURE DOES, IN ONE LINE (Seb, 2026-11-03: people cannot see
// "what to click on, what features do, and where to go").
//
// Keyed by the menu row's address in components/layout/DashboardShellV2.tsx.
// The Dashboard's "Everything MVP does" lists every row the member can open
// with its line from here, so the list and the menu can never disagree about
// what a member has: the menu decides what is listed, this only says what it
// does. scripts/test-teal-look.ts fails when a menu row has no line.
//
// Plain words, said from the member's side, no dashes, no year. A line that
// names a link names the store it goes to.

export const FEATURE_LINES: Record<string, string> = {
  '/dashboard': 'Your starting page: what needs you today and where things stand.',

  // Find products
  '/amz-finder': 'Search Amazon with MVP filters, save the winners and turn them into posts.',
  '/amazon/research': 'Search Amazon with MVP filters, save the winners and turn them into posts.',
  '/deal-radar': 'Live Amazon deals and Walmart boosts, filtered by MVP rules, ready to post.',
  '/cc-campaigns': "Creator Connections campaigns to browse, join and save, with Amazon's EPC.",
  '/levanta': 'Levanta, PartnerBoost and Walmart, Wayward and LTK products to promote.',
  '/idea-lists': 'An Amazon idea list turned into a shopping guide post, every product linked.',
  '/trybe': 'Find brands on TRYBE, send join requests, chat, and upload ad videos.',

  // Make videos
  '/drop': 'Drop in finished videos and MVP sends each one everywhere it belongs.',
  '/review-editor': 'Your talking take and B-roll in, an edited review out.',
  '/co-pilot': 'Titles, descriptions, tags and thumbnails for your YouTube videos.',
  '/amazon/thumbnails': 'Thumbnail designs for a product, with or without your face.',
  '/script': 'Writes a video script for a product.',
  '/clip-factory': 'The best moments of a long video as Shorts, Reels and TikToks.',
  '/liftoff': 'Uploads your videos to YouTube and your Amazon storefronts in one go.',
  '/first-comments': 'Pinned comments with your links, and new ones when a product goes on sale.',
  '/instagram-dm': 'Sends your link by DM to anyone who comments a keyword on your post.',
  '/amazon-live': 'Prep for an Amazon Live, then clips and a roundup post from the replay.',

  // Blog
  '/content': 'Write, edit and publish product posts on your site.',
  '/comparison': 'Side by side comparisons and buying guides, with a winner.',
  '/articles': 'Longer articles that go beyond a single product.',
  '/ended-deals': 'Deal posts whose sale is over, turned into lasting reviews.',
  '/seo': 'Where your posts rank, and getting them indexed by Google.',
  '/ads': 'Google AdSense and your affiliate banners on your site.',
  '/customize': 'How your blog looks: colours, fonts and layout.',
  '/newsletter': 'Your newsletter and the people subscribed to it.',

  // Share
  '/content?tab=posts': 'Posts each piece to your social accounts, now or on a schedule.',
  '/deals': 'Deal posts across your channels while Amazon has a sale on.',
  '/amazon/social': 'Designed Pinterest, Instagram and Facebook graphics for a product.',
  '/social-launch-kit': 'Sets up your social accounts in about five minutes.',
  '/meta': 'Your Facebook Page, niche Groups, Reels and reviews in one place.',
  '/group-queue': 'Products posted to your Facebook Group first, then to your Page.',
  '/pulse': 'Which hashtags earn reach, from your posts and across MVP.',
  '/link-in-bio': 'Your own link page, with the store named on every link.',
  '/passport': "Links that send each visitor to their own country's Amazon store.",

  // Work with brands
  '/collaborations': 'Writes and sends collaboration pitches to brands.',
  '/brand-inquiries': 'Brand inquiries, your history with each brand, and recaps.',

  // Your setup
  '/setup': 'Connect your blog, YouTube, social accounts and other tools.',
  '/connect-youtube': 'Connect your blog, YouTube, social accounts and other tools.',
  '/brand': 'Your brand profile and the voice MVP writes in.',
  '/photobooth': 'Your face, for thumbnails and designs.',
  '/agency': 'Virtual assistants who work on your account.',
  '/billing': 'Your plan, billing, and what you have used this month.',

  // Labs (admin)
  '/storefront': 'Your Amazon storefront earnings, synced by SCOUT.',
  '/earnings': 'Amazon earnings by product, and campaigns for products already selling.',
  '/brand-radar': 'The brands you have worked with, from your storefront and TikTok.',
  '/tiktok-shop': 'TikTok Shop products added from their link.',
  '/plan-video': 'A joined Creator Connections campaign turned into a filming plan.',

  // Help
  '/assistant': 'Answers questions about MVP and your account.',
  '/tutorials': 'Tutorials, contact support, and the community.',
}

/** The line for a menu row, or null when it has none. */
export function featureLine(href: string): string | null {
  return FEATURE_LINES[href] ?? null
}
