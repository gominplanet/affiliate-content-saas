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
  { label: 'Dashboard', href: '/dashboard', group: 'Home', keywords: 'home overview start' },

  // ── Set up ───────────────────────────────────────────────────────────────
  { label: 'Tutorials', href: '/tutorials', group: 'Set up', keywords: 'how to guide videos learn getting started help' },
  { label: 'WordPress', href: '/setup', group: 'Set up', keywords: 'connect site wordpress plugin install reconnect connection doctor blog site domain' },
  { label: 'Connection Doctor', href: '/setup/wp-doctor', group: 'Set up', keywords: 'fix connection publish failing firewall wordfence not publishing 403 401 diagnose' },
  { label: 'YouTube', href: '/connect-youtube', group: 'Set up', keywords: 'connect youtube channel oauth link account' },
  { label: 'CC Campaigns', href: '/cc-campaigns', group: 'Research', keywords: 'creator connections campaigns bounty commission spots left full brand pays out payout reliability trust est per sale affiliate plus research find campaigns' },
  { label: 'Brand Profile', href: '/brand', group: 'Set up', keywords: 'brand name niche tone bio about author' },
  { label: 'Geniuslink API key & groups', href: '/brand#affiliate', group: 'Brand Profile', keywords: 'geniuslink geni.us affiliate link tracking api key secret amazon tag associates monetization groups' },
  { label: 'Amazon Associates tag', href: '/brand#affiliate', group: 'Brand Profile', keywords: 'amazon tag associates id store id affiliate tag tracking' },
  { label: 'Upload brand logo', href: '/brand#logo', group: 'Brand Profile', keywords: 'logo upload brand logo favicon footer image mark' },
  { label: 'Voice Training', href: '/learn', group: 'Set up', keywords: 'learn writing voice tone style profile teach ai how i write' },
  { label: 'Customize Blog', href: '/customize', group: 'Set up', keywords: 'theme colors color palette primary secondary hero layout fonts show hide dates site verification meta tags favicon' },
  { label: 'Site Verification & Meta Tags', href: '/customize', group: 'Customize Blog', keywords: 'site verification meta tags verify ownership head tags search console' },
  { label: 'Face Models', href: '/photobooth', group: 'Set up', keywords: 'face model selfie your face photobooth train identity thumbnail face' },
  { label: 'Connect Socials', href: '/connect-socials', group: 'Set up', keywords: 'connect social pinterest tiktok instagram facebook threads bluesky linkedin telegram x twitter accounts' },
  { label: 'Ads', href: '/ads', group: 'Set up', keywords: 'adsense google ads ca-pub banners sidebar homepage in-content monetize ads.txt' },
  { label: 'Social Launch Kit', href: '/social-launch-kit', group: 'Set up', keywords: 'social launch kit name bio banner avatar setup guide new accounts' },

  // ── Create ───────────────────────────────────────────────────────────────
  { label: 'YouTube Co-Pilot', href: '/co-pilot', group: 'Create', keywords: 'co-pilot copilot youtube drafts calendar metadata descriptions' },
  { label: 'Blog Post Generator', href: '/content', group: 'Create', keywords: 'library generate blog post create article write video to blog' },
  { label: 'Social Push', href: '/content?tab=posts', group: 'Create', keywords: 'social push publish schedule posts pinterest tiktok instagram facebook cascade share' },
  { label: 'Comparisons', href: '/comparison', group: 'Create', keywords: 'comparison vs versus compare products roundup' },
  { label: 'Buying Guides', href: '/buying-guides', group: 'Create', keywords: 'buying guide best of top picks' },
  { label: 'MVP x LTK', href: '/ltk', group: 'Create', keywords: 'ltk liketoknowit shopltk rewardstyle link post' },
  { label: 'Deals Hub', href: '/deals', group: 'Create', keywords: 'deals sale prime day discount occasion' },
  { label: 'Scriptwriter', href: '/script', group: 'Create', keywords: 'script video script write scriptwriter' },
  { label: 'Newsletter', href: '/newsletter', group: 'Create', keywords: 'newsletter email broadcast subscribers compose segments a/b subject' },
  { label: 'Shop Burner', href: '/instagram-burner', group: 'Create', keywords: 'instagram burner reels vertical video cta sticker burn' },

  // ── Source & Earn ────────────────────────────────────────────────────────
  { label: 'AMZ Product Finder', href: '/amz-finder', group: 'Source & Earn', keywords: 'amazon product finder creator connections campaigns epc smart scan find products commission' },
  { label: 'MVP x Levanta', href: '/levanta', group: 'Source & Earn', keywords: 'levanta amazon creator network commissionable links brands' },
  { label: 'MVP x PartnerBoost', href: '/partnerboost', group: 'Source & Earn', keywords: 'partnerboost walmart amazon dtc brands finder commission deep link' },
  { label: 'Walmart Deals & Offers', href: '/partnerboost', group: 'Source & Earn', keywords: 'walmart deals offers catalog affiliate boost commission promotion partnerboost creator marketplace generate post browse products' },

  // ── Grow ─────────────────────────────────────────────────────────────────
  { label: 'SEO & Indexing', href: '/seo', group: 'Grow', keywords: 'seo search console index indexing google ranking keywords gsc rebuild' },

  // ── Site Tools ───────────────────────────────────────────────────────────
  { label: 'Title Check', href: '/tools/title-audit', group: 'Site Tools', keywords: 'title check audit title vs body accuracy seo' },
  { label: 'Clean Links', href: '/tools/clean-links', group: 'Site Tools', keywords: 'clean links lasso duplicate affiliate tag remove wrap geni.us' },
  { label: 'Duplicates', href: '/tools/duplicates', group: 'Site Tools', keywords: 'duplicates duplicate posts same product slug -2 -3 not indexed' },
  { label: 'Fix 404s', href: '/tools/redirects', group: 'Site Tools', keywords: 'fix 404 redirects 301 not found broken links dead urls gsc' },
  { label: 'Fix Formatting', href: '/tools/fix-formatting', group: 'Site Tools', keywords: 'fix formatting raw block code gutenberg broken layout repair' },

  // ── Collaborate ──────────────────────────────────────────────────────────
  { label: 'Brand Deals', href: '/collaborations', group: 'Collaborate', keywords: 'brand deals collaborations pitch outreach sponsor media kit share with brand' },
  { label: 'Media Kit', href: '/collaborations', group: 'Collaborate', keywords: 'media kit press kit stats one sheet brand recap' },
  { label: 'Brand Inquiries', href: '/brand-inquiries', group: 'Collaborate', keywords: 'brand inquiries inbox messages work with brands inbound' },
  { label: 'Virtual Assistant', href: '/agency', group: 'Collaborate', keywords: 'virtual assistant va agency seats team permissions sub account' },

  // ── Help & Community ─────────────────────────────────────────────────────
  { label: 'AMZ Storefront', href: '/storefront', group: 'Find & Earn', keywords: 'storefront analytics earnings sales revenue units clicks conversion best sellers amazon influencer scout amz' },
  { label: 'MVP Help Desk', href: '/assistant', group: 'Help & Community', keywords: 'help desk assistant ai chat ask question support bot how do i' },
  { label: 'Create a Help Ticket', href: '/support', group: 'Help & Community', keywords: 'support ticket contact help problem issue bug report' },
  { label: 'Community', href: '/community', group: 'Help & Community', keywords: 'community forum discord group' },

  // ── Account ──────────────────────────────────────────────────────────────
  { label: 'Plan & Billing', href: '/billing', group: 'Account', keywords: 'billing plan subscription upgrade downgrade invoice payment stripe cancel price' },

  // ── Admin (filtered out for non-admins) ──────────────────────────────────
  { label: 'Users (admin)', href: '/admin/users', group: 'Admin', keywords: 'admin users roster accounts', admin: true },
  { label: 'Support tickets (admin)', href: '/admin/support-tickets', group: 'Admin', keywords: 'admin support tickets queue', admin: true },
  { label: 'Failures (admin)', href: '/admin/failures', group: 'Admin', keywords: 'admin failures errors generation jobs', admin: true },
  { label: 'Cron health (admin)', href: '/admin/cron', group: 'Admin', keywords: 'admin cron health scheduled jobs', admin: true },
  { label: 'AI Cost (admin)', href: '/admin/costs', group: 'Admin', keywords: 'admin ai cost spend tokens', admin: true },
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
