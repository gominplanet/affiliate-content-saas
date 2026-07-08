// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CONSOLIDATED (2026-07-06): the standalone Product Finder merged into the ONE
// "AMZ Product Finder" page — Campaigns ON (Affiliate+ Smart Scan) / Campaigns
// OFF (onsite product search with MVP's approved-product rules). The page was
// renamed /epc → /amz-finder 2026-07-08. This route survives as a redirect.
import { redirect } from 'next/navigation'

export default function ProductFinderRedirect() {
  redirect('/amz-finder')
}
