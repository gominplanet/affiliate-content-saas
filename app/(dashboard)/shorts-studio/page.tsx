// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shorts Studio was folded into Clip Factory (2026-08). The old picker page is
// retired; anyone landing on /shorts-studio (old bookmark, stale link) is sent
// to Clip Factory, which subsumes it (create + enhance + publish) and carries
// the proper Pro gate + monthly cap. Keeping this as a redirect means there's
// no second, unguarded Shorts surface to maintain.
import { redirect } from 'next/navigation'

export default function ShortsStudioRedirect() {
  redirect('/clip-factory')
}
