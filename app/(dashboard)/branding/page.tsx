// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /branding — White-label settings, INTENTIONALLY HIDDEN as of
// 2026-06-04 tier session (matches /developers — not surfacing
// API/whitelabel until there's real demand).
//
// Returns a 404 so the page is unreachable from URL bar, sidebar, or
// bookmarks. The backing endpoints (/api/whitelabel/*) are left intact
// so any existing whitelabel configs in the DB continue to take effect
// for sites already configured — but no new ones can be set up
// because there's no UI.
//
// To bring this back: restore the previous implementation from git
// history (the version shipped with task #150 had the full upload +
// preview UI). Re-add the sidebar link in DashboardShellV2.tsx
// alongside it.

import { notFound } from 'next/navigation'

export default function BrandingHidden(): never {
  notFound()
}
