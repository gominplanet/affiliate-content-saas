// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /developers — API access surface, INTENTIONALLY HIDDEN as of
// 2026-06-04 tier session ("not using it yet or ever").
//
// Returns a 404 so the page is unreachable from the URL bar, sidebar,
// or bookmarks. The backing endpoints (/api/api-keys/*, /api/v1/*) are
// left intact so any keys already minted in the DB continue to work for
// existing API consumers (if any) — but no new keys can be created
// because there's no UI.
//
// To bring this back: restore the previous implementation from git
// history (the version shipped with task #149 had the full key-mint UI).
// Re-add the sidebar link in DashboardShellV2.tsx alongside it.

import { notFound } from 'next/navigation'

export default function DevelopersHidden(): never {
  notFound()
}
