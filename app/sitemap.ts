// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Next.js App Router sitemap — served at /sitemap.xml automatically.
// Only lists public marketing pages; authenticated routes are excluded.

import type { MetadataRoute } from 'next'

const BASE = 'https://mvpaffiliate.io'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${BASE}/pricing`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${BASE}/tour`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      // The free guide. A static file, so it carries its own canonical, which
      // points here.
      url: `${BASE}/freeguide`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${BASE}/privacy`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${BASE}/terms`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ]
}
