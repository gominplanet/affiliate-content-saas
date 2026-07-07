// The PartnerBoost tool moved from /walmart-pb → /partnerboost (2026-07-07).
// Keep this permanent redirect so old bookmarks / links still land in the right
// place.
import { redirect } from 'next/navigation'

export default function WalmartPbRedirect() {
  redirect('/partnerboost')
}
