// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// robots.txt, including one for the short-link domain.
//
// A domain with no robots.txt at all is a small signal on its own, and mvpl.ink
// had none. More usefully, it lets us say something true about that domain:
// crawl the front page, do not bother with the codes. A short code is a
// redirect to somebody else's product page; there is nothing there for a search
// engine to index, and thousands of them crawled would look exactly like the
// doorway-page pattern the domain is trying not to resemble.

import type { MetadataRoute } from 'next'

const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // The short domain's codes and the app's own redirect path. Everything
        // else on both hosts is a real page and welcome to be crawled.
        disallow: ['/go/', '/api/', '/dashboard/'],
        allow: '/',
      },
    ],
    sitemap: `${APP}/sitemap.xml`,
  }
}
