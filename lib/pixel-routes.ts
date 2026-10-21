// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH PAGES COUNT AS A STRANGER LOOKING AT THE PRODUCT.
//
// WHAT WAS WRONG. The pixel fires `fbq('track','PageView')` once, from the
// inline script in app/layout.tsx. That script runs on a hard page load and
// never again: App Router navigation swaps the page without re-running it. So
// a visitor who landed on the homepage and then read /pricing and /tour
// produced exactly ONE PageView, reported at the homepage URL.
//
// It is not a small reporting gap. Asked for its URL breakdown over the five
// days to 2026-10-21, the dataset answered with a single URL,
// https://www.mvpaffiliate.io/, for every event it held: 2,200 PageViews and
// also the ViewContent, GuideRead and GuideModuleDone events, which fire on
// other pages entirely. At 20:00 on 2026-10-18 the homepage count was 105,
// exactly 97 PageViews + 4 ViewContent + 2 GuideModuleDone + 2 GuideRead.
// Every event in the account was being filed under the page the visitor
// happened to arrive on.
//
// WHAT THAT COST. "Nobody gets from the homepage to the pricing page" and "the
// pixel cannot see the pricing page" looked identical, and the second is true,
// so the first could not be tested. A $13/day traffic campaign ran against
// that blindness and bought 90 landing page views and no signups, with no way
// to tell where the 90 stopped.
//
// WHY NOT SIMPLY FIRE ON EVERY ROUTE CHANGE. There are 89 page routes inside
// app/(dashboard), all of them the signed-in product. A member clicking around
// Drop and Deal Radar would file hundreds of PageViews a day under URLs no
// prospect ever sees, which makes the funnel harder to read, not easier. The
// question this instrumentation exists to answer is about strangers, so only
// pages a stranger is sold on count.
//
// The authenticated product is one route group, so the marketing site is the
// short list, and scripts/test-pixel-routes.ts fails the build if a new page
// route appears outside app/(dashboard) without being classified here.

/**
 * Marketing and funnel pages, as path prefixes. A prospect's journey runs
 * through these and nothing else: the landing pages, the plan, the terms they
 * agree to, and the signup form itself.
 *
 * Prefixes, so '/join' covers '/join/amazon' and '/docs' covers every page
 * under it. Matched on segment boundaries, so '/partner' never matches
 * '/partners-only'.
 */
export const FUNNEL_ROUTES = [
  '/affiliates',
  '/amazon-influencer',
  '/docs',
  '/features',
  '/gominplanet',
  '/join',
  '/own-your-blog',
  '/partner',
  '/pricing',
  '/privacy',
  '/run-your-storefront',
  '/shop',
  // The form itself. The last page before Stripe, and the one place a drop-off
  // is worth the most to see.
  '/signup',
  // The free week lives in clause form here, so it is part of the decision.
  '/terms',
  '/tour',
] as const

/**
 * Page routes that exist outside app/(dashboard) and are deliberately NOT
 * counted, each with the reason. Read by scripts/test-pixel-routes.ts, which
 * requires every such route to appear either here or in FUNNEL_ROUTES.
 */
export const NOT_FUNNEL_ROUTES: Record<string, string> = {
  '/agency': 'accepting an invite to somebody else\'s account, not a prospect',
  '/landing-preview': 'an internal preview of a draft landing page; counting it would file Seb\'s own reviews as prospect traffic',
  '/link-domain': 'a shopper who clicked a Passport link, not a creator buying MVP',
  '/link-policy': 'the link-cloaking policy, read by shoppers and reviewers rather than buyers',
  '/link-preview': 'shows a shopper where a cloaked link goes before they follow it',
  '/report-a-link': 'a shopper or brand reporting a link, not a creator considering MVP',
  '/newsletter-confirmed': 'an email landing, reached after the decision',
  '/newsletter-unsubscribed': 'an email landing, reached after leaving',
  '/onboarding': 'the product, reached only after signing up',
  '/login': 'a member coming back, not a stranger being sold',
  '/reset-password': 'a member coming back',
}

/**
 * Does a client-side navigation to this path count as a prospect viewing the
 * product? The homepage does; so does anything under FUNNEL_ROUTES.
 *
 * Pure, and takes the pathname only. A query string is never the difference
 * between two pages here: '/signup?tier=pro' and '/signup' are one page, and
 * counting them apart would turn every filter change into a page view.
 */
export function countsAsFunnelView(pathname: string): boolean {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return true
  return FUNNEL_ROUTES.some((r) => path === r || path.startsWith(r + '/'))
}
