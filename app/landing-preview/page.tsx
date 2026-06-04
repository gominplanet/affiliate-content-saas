// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /landing-preview — now a permanent redirect to the live homepage.
//
// This route was the staging slot for the dark sales page while it was
// being built. As of 2026-06-04 the dark page IS the homepage at /, so
// /landing-preview just bounces visitors (and search engines) to the
// canonical URL. 308 permanent redirect → preserves SEO authority that
// accrued on the preview URL during the build window.
//
// To restore /landing-preview as a separate staging slot, swap this file
// for a real React component again.

import { permanentRedirect } from 'next/navigation'

export default function LandingPreviewRedirect(): never {
  permanentRedirect('/')
}
