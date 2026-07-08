// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// RENAMED (2026-07-08): the "AMZ Product Finder" page moved from /epc to
// /amz-finder so the URL matches its name (the old "EPC" slug was an internal
// term users never saw). This route survives only as a redirect so existing
// bookmarks, links, and the demo video's /epc URL keep working.
import { redirect } from 'next/navigation'

export default function EpcRedirect() {
  redirect('/amz-finder')
}
