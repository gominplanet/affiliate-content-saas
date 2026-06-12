// Creator Campaigns is gated out of the product for ALL tiers (2026-06-12).
// The sidebar tab was removed; this server redirect makes the gate complete so
// a stale bookmark or old deep link can't reach the page. The full prior
// implementation (client UI + Creator Connections ingest flow) is preserved in
// git history and can be restored by reverting this file + the nav line in
// components/layout/DashboardShellV2.tsx if the feature is ever revived. The
// /api/campaigns/* routes are left intact (untouched) so any in-flight data
// stays readable; only the user-facing page is closed off.
import { redirect } from 'next/navigation'

export default function CampaignsPage() {
  redirect('/dashboard')
}
