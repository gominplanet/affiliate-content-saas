// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CONSOLIDATED (2026-07-06): the standalone Product Finder merged into the ONE
// "AMZ Product Finder" page at /epc — Campaigns ON (Affiliate+ Smart Scan) /
// Campaigns OFF (onsite product search with MVP's approved-product rules).
// This route survives only as a redirect for old links/bookmarks.
import { redirect } from 'next/navigation'

export default function ProductFinderRedirect() {
  redirect('/epc')
}
