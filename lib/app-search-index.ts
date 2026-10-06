// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Static in-app search index powering the topbar "search MVP" box.
//
// Each entry is a destination the user can jump straight to — a page, a tab,
// or a specific SECTION inside a page (via a #hash anchor that exists on the
// target). The `keywords` string carries synonyms + the words a user would
// actually type ("logo", "geniuslink", "amazon tag") even when they don't
// match the label, so search finds a section by what it DOES, not just its
// title. Keep this in loose sync with the sidebar NAV_GROUPS in
// components/layout/DashboardShellV2.tsx — nav is the source of truth for
// routes; this adds the section-level shortcuts nav can't express.

import { NEWSLETTER_FOR_MEMBERS } from './feature-flags'

export interface AppSearchEntry {
  /** Display name shown in the results list. */
  label: string
  /** Destination — may include a ?query (tab) and/or #hash (section anchor). */
  href: string
  /** The section/group this lives under, shown as muted context on the row. */
  group: string
  /** Extra searchable synonyms (space-separated). Not displayed. */
  keywords?: string
  /** Admin-only entries are filtered out for non-admins. */
  admin?: boolean
}

export const APP_SEARCH_INDEX: AppSearchEntry[] = [
  // ── Top ────────────────────────────────────────────────────────────────
  { label: 'Dashboard', href: '/dashboard', group: 'Home', keywords: 'home overview start today' },

  // The menu was regrouped by job on 2026-10-05. Every renamed page keeps its
  // old name in keywords, so a member searching the name they know lands on it.

  // ── Find products ────────────────────────────────────────────────────────
  { label: 'Product research', href: '/amz-finder', group: 'Find products', keywords: 'amz research amz product finder amazon catalog search creator connections epc smart scan find products commission' },
  { label: 'Amazon research', href: '/amazon/research', group: 'Product research', keywords: 'research amazon influencer find products to review' },
  { label: 'Deal Radar', href: '/deal-radar', group: 'Find products', keywords: 'deals price drops coupons discounts radar' },
  { label: 'Brand campaigns', href: '/cc-campaigns', group: 'Find products', keywords: 'cc campaigns creator connections campaigns bounty commission spots left full brand pays out payout reliability trust est per sale affiliate plus research find campaigns' },
  { label: 'Joined campaigns', href: '/joined-campaigns', group: 'Brand campaigns', keywords: 'joined campaigns accepted my campaigns creator connections' },
  { label: 'Saved campaigns', href: '/saved-campaigns', group: 'Brand campaigns', keywords: 'saved campaigns bookmarked creator connections' },
  { label: 'Best paying campaigns', href: '/epc-library', group: 'Brand campaigns', keywords: 'epc library earnings per click best paying top commission' },
  { label: 'Partner programs', href: '/levanta', group: 'Find products', keywords: 'mvp x levanta partnerboost wayward ltk networks beyond amazon' },
  { label: 'Levanta', href: '/levanta', group: 'Partner programs', keywords: 'mvp x levanta amazon creator network commissionable links brands' },
  { label: 'PartnerBoost and Walmart', href: '/partnerboost', group: 'Partner programs', keywords: 'mvp x partnerboost walmart deals offers catalog amazon dtc brands commission deep link' },
  { label: 'Wayward', href: '/wayward', group: 'Partner programs', keywords: 'mvp x wayward amazon attribution catalog commission' },
  { label: 'LTK', href: '/ltk', group: 'Partner programs', keywords: 'mvp x ltk liketoknowit shopltk rewardstyle link post' },
  { label: 'Idea lists', href: '/idea-lists', group: 'Find products', keywords: 'idea list amazon storefront shopping guide list to blog roundup shoppable list top picks curated products' },

  // ── Make videos ──────────────────────────────────────────────────────────
  { label: 'YouTube Co-Pilot', href: '/co-pilot', group: 'Make videos', keywords: 'co-pilot copilot youtube drafts calendar metadata titles descriptions chapters' },
  { label: 'Thumbnails', href: '/amazon/thumbnails', group: 'Make videos', keywords: 'thumbnail generator art director youtube amazon video thumbnail' },
  { label: 'Scriptwriter', href: '/script', group: 'Make videos', keywords: 'script video script write scriptwriter' },
  { label: 'Clip Factory', href: '/clip-factory', group: 'Make videos', keywords: 'clips shorts reels tiktok vertical find moments' },
  { label: 'Bulk Amazon upload', href: '/liftoff', group: 'Make videos', keywords: 'liftoff launch batch upload videos amazon storefront countries youtube' },
  { label: 'Pinned comments', href: '/first-comments', group: 'YouTube comments', keywords: 'first comment pinned comment product link youtube comments' },
  { label: 'On sale comments', href: '/encore', group: 'YouTube comments', keywords: 'encore on sale now sale comment youtube comments price drop' },
  { label: 'Amazon Live', href: '/amazon-live', group: 'Make videos', keywords: 'amazon live prep livestream show lineup teleprompter' },
  { label: 'Live follow-up', href: '/live-followup', group: 'Amazon Live', keywords: 'live follow up replay clips roundup after the live' },

  // ── Blog ─────────────────────────────────────────────────────────────────
  { label: 'Blog posts', href: '/content', group: 'Blog', keywords: 'blog post generator library generate blog post create article write video to blog autopilot' },
  { label: 'Comparisons', href: '/comparison', group: 'Comparisons and guides', keywords: 'comparison vs versus compare products roundup' },
  { label: 'Buying guides', href: '/buying-guides', group: 'Comparisons and guides', keywords: 'buying guide best of top picks' },
  { label: 'Articles', href: '/articles', group: 'Blog', keywords: 'articles how to informational long form' },
  { label: 'Ended deals', href: '/ended-deals', group: 'Blog', keywords: 'ended deals expired sale deal aftercare' },
  { label: 'SEO and indexing', href: '/seo', group: 'Blog', keywords: 'seo & indexing search console index indexing google ranking keywords gsc rebuild' },
  { label: 'Ads', href: '/ads', group: 'Blog', keywords: 'adsense google ads ca-pub banners sidebar homepage in-content monetize ads.txt' },
  { label: 'Blog design', href: '/customize', group: 'Blog', keywords: 'customize blog theme colors color palette primary secondary hero layout fonts show hide dates' },
  { label: 'Site Verification & Meta Tags', href: '/customize', group: 'Blog design', keywords: 'site verification meta tags verify ownership head tags search console' },
  // Retired for members (lib/feature-flags NEWSLETTER_FOR_MEMBERS), so not offered by search.
  ...(NEWSLETTER_FOR_MEMBERS ? [{ label: 'Newsletter', href: '/newsletter', group: 'Blog', keywords: 'newsletter email broadcast subscribers compose segments a/b subject' }] : []),

  // ── Site Tools (tabs of SEO and indexing) ────────────────────────────────
  { label: 'Title Check', href: '/tools/title-audit', group: 'SEO and indexing', keywords: 'title check audit title vs body accuracy seo' },
  { label: 'Clean Links', href: '/tools/clean-links', group: 'SEO and indexing', keywords: 'clean links lasso duplicate affiliate tag remove wrap geni.us' },
  { label: 'Duplicates', href: '/tools/duplicates', group: 'SEO and indexing', keywords: 'duplicates duplicate posts same product slug -2 -3 not indexed' },
  { label: 'Fix 404s', href: '/tools/redirects', group: 'SEO and indexing', keywords: 'fix 404 redirects 301 not found broken links dead urls gsc' },
  { label: 'Fix Formatting', href: '/tools/fix-formatting', group: 'SEO and indexing', keywords: 'fix formatting raw block code gutenberg broken layout repair' },

  // ── Share ────────────────────────────────────────────────────────────────
  { label: 'Social Push', href: '/content?tab=posts', group: 'Share', keywords: 'social push publish schedule posts pinterest tiktok instagram facebook cascade share' },
  { label: 'Social designs', href: '/amazon/social', group: 'Share', keywords: 'social influencer pins pinterest instagram story designs amazon product' },
  { label: 'Social Launch Kit', href: '/social-launch-kit', group: 'Share', keywords: 'social launch kit name bio banner avatar setup guide new accounts' },
  { label: 'Meta Hub', href: '/meta', group: 'Share', keywords: 'facebook page group meta hub' },
  { label: 'Hashtag insights', href: '/pulse', group: 'Share', keywords: 'pulse hashtags reach instagram reels tags' },
  { label: 'Link in Bio', href: '/link-in-bio', group: 'Share', keywords: 'link in bio shop grid profile link storefront page' },
  { label: 'Passport links', href: '/passport', group: 'Share', keywords: 'passport links geo country amazon short links clicks geniuslink' },
  { label: 'Deals Hub', href: '/deals', group: 'Share', keywords: 'deals sale prime day discount occasion' },

  // ── Work with brands ─────────────────────────────────────────────────────
  { label: 'Brand pitches', href: '/collaborations', group: 'Work with brands', keywords: 'brand deals collaborations pitch outreach sponsor media kit share with brand' },
  { label: 'Media Kit', href: '/collaborations', group: 'Brand pitches', keywords: 'media kit press kit stats one sheet brand recap' },
  { label: 'Brand inbox', href: '/brand-inquiries', group: 'Work with brands', keywords: 'brand inquiries inbox messages work with brands inbound' },
  { label: 'Brand history', href: '/brand-hub', group: 'Brand inbox', keywords: 'brand hub history timeline relationships crm messages campaigns contacted inbound pitches consolidated all brands who reached out' },
  { label: 'Brand recap', href: '/brand-recap', group: 'Brand inbox', keywords: 'brand recap links per brand message creator connections' },

  // ── Your setup ───────────────────────────────────────────────────────────
  { label: 'Connections', href: '/setup', group: 'Your setup', keywords: 'connect wordpress blog site plugin install reconnect connection doctor domain integrations' },
  { label: 'Connection Doctor', href: '/setup/wp-doctor', group: 'Connections', keywords: 'fix connection publish failing firewall wordfence not publishing 403 401 diagnose' },
  { label: 'YouTube', href: '/connect-youtube', group: 'Connections', keywords: 'connect youtube channel oauth link account' },
  { label: 'Socials', href: '/connect-socials', group: 'Connections', keywords: 'connect socials pinterest tiktok instagram facebook threads bluesky linkedin telegram x twitter accounts' },
  { label: 'Other tools', href: '/external-integrations', group: 'Connections', keywords: 'external integrations api keys levanta partnerboost wayward' },
  { label: 'Brand profile', href: '/brand', group: 'Brand and voice', keywords: 'brand name niche tone bio about author' },
  { label: 'Geniuslink API key & groups', href: '/brand#affiliate', group: 'Brand profile', keywords: 'geniuslink geni.us affiliate link tracking api key secret amazon tag associates monetization groups' },
  { label: 'Amazon Associates tag', href: '/brand#affiliate', group: 'Brand profile', keywords: 'amazon tag associates id store id affiliate tag tracking' },
  { label: 'Upload brand logo', href: '/brand#logo', group: 'Brand profile', keywords: 'logo upload brand logo favicon footer image mark' },
  { label: 'Writing voice', href: '/learn', group: 'Brand and voice', keywords: 'voice training learn writing voice tone style profile teach ai how i write' },
  { label: 'Face models', href: '/photobooth', group: 'Your setup', keywords: 'face model selfie your face photobooth train identity thumbnail face' },
  { label: 'Team', href: '/agency', group: 'Your setup', keywords: 'virtual assistant va agency seats team permissions sub account' },
  { label: 'Plan and billing', href: '/billing', group: 'Plan and usage', keywords: 'plan & billing subscription upgrade downgrade invoice payment stripe cancel price' },
  { label: 'Usage', href: '/usage', group: 'Plan and usage', keywords: 'your usage limits used remaining' },

  // ── Help ─────────────────────────────────────────────────────────────────
  { label: 'Ask MVP', href: '/assistant', group: 'Help', keywords: 'mvp help desk assistant ai chat ask question support bot how do i' },
  { label: 'Tutorials', href: '/tutorials', group: 'Tutorials and support', keywords: 'how to guide videos learn getting started help' },
  { label: 'Contact support', href: '/support', group: 'Tutorials and support', keywords: 'create a help ticket support ticket contact help problem issue bug report' },
  { label: 'Community', href: '/community', group: 'Tutorials and support', keywords: 'community forum discord group' },

  // ── Labs (admin) ─────────────────────────────────────────────────────────
  { label: 'AMZ Storefront', href: '/storefront', group: 'Labs', keywords: 'storefront analytics earnings sales revenue units clicks conversion best sellers amazon influencer scout amz', admin: true },

  // ── Admin (filtered out for non-admins) ──────────────────────────────────
  { label: 'Users (admin)', href: '/admin/users', group: 'Admin', keywords: 'admin users roster accounts', admin: true },
  { label: 'Support tickets (admin)', href: '/admin/support-tickets', group: 'Admin', keywords: 'admin support tickets queue', admin: true },
  { label: 'Failures (admin)', href: '/admin/failures', group: 'Admin', keywords: 'admin failures errors generation jobs', admin: true },
  { label: 'Cron health (admin)', href: '/admin/cron', group: 'Admin', keywords: 'admin cron health scheduled jobs', admin: true },
  { label: 'AI Cost (admin)', href: '/admin/costs', group: 'Admin', keywords: 'admin ai cost spend tokens', admin: true },
  { label: 'YouTube audio tracks (admin)', href: '/admin/audio-tracks', group: 'Admin', keywords: 'admin youtube audio tracks dub dubbed language localization storefront geo', admin: true },
  { label: 'YouTube cookies (admin)', href: '/admin/youtube-cookies', group: 'Admin', keywords: 'admin youtube cookies downloader ingest yt-dlp bot wall sign in railway', admin: true },
  { label: 'Duplicate Subs (admin)', href: '/admin/subscriptions', group: 'Admin', keywords: 'admin duplicate subscriptions stripe billing', admin: true },
  { label: 'Blog Quality (admin)', href: '/admin/blog-quality', group: 'Admin', keywords: 'admin blog quality writer', admin: true },
  { label: 'Template Performance (admin)', href: '/admin/template-performance', group: 'Admin', keywords: 'admin template performance', admin: true },
  { label: 'Broadcast email (admin)', href: '/admin/broadcast', group: 'Admin', keywords: 'admin broadcast email all users', admin: true },
  { label: 'News banner (admin)', href: '/admin/announcement', group: 'Admin', keywords: 'admin announcement news banner', admin: true },
  { label: 'Encrypt Secrets (admin)', href: '/admin/encrypt-secrets', group: 'Admin', keywords: 'admin encrypt secrets tokens', admin: true },
]

/**
 * Rank entries against a query. Scoring, best → worst:
 *   4 exact label · 3 label starts-with · 2 word in label starts-with ·
 *   1 label contains · 0.5 keyword contains. Ties keep index order (which
 *   mirrors the sidebar's funnel order, so the more "primary" entry wins).
 */
export function searchApp(
  rawQuery: string,
  opts: { isAdmin?: boolean; limit?: number } = {},
): AppSearchEntry[] {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return []
  const limit = opts.limit ?? 8

  const scored: Array<{ e: AppSearchEntry; score: number; i: number }> = []
  APP_SEARCH_INDEX.forEach((e, i) => {
    if (e.admin && !opts.isAdmin) return
    const label = e.label.toLowerCase()
    const kw = (e.keywords || '').toLowerCase()
    let score = 0
    if (label === q) score = 4
    else if (label.startsWith(q)) score = 3
    else if (label.split(/\s+/).some(w => w.startsWith(q))) score = 2
    else if (label.includes(q)) score = 1
    else if (kw.includes(q)) score = 0.5
    if (score > 0) scored.push({ e, score, i })
  })

  scored.sort((a, b) => (b.score - a.score) || (a.i - b.i))
  return scored.slice(0, limit).map(s => s.e)
}
