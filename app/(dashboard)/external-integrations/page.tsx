// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// External Integrations — paid tiers. Reachable from SET UP > External
// Integrations (under Connect Socials). One place for users to connect their OWN
// API keys for external networks (Levanta, PartnerBoost, Wayward). Keys are
// stored encrypted server-side; this page only ever shows a masked last-4.
// The connection cards themselves live in a shared component so the same setup
// also appears on the Passport Links page.

'use client'

import PageHero from '@/components/layout/PageHero'
import { FlaskConical } from 'lucide-react'
import ExternalNetworksCards from '@/components/integrations/ExternalNetworksCards'

const CYAN = '#0E7490'

export default function ExternalIntegrationsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      <div className="mb-3">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
          style={{ background: 'rgba(34,211,238,0.14)', color: CYAN }}>
          <FlaskConical size={11} /> MVP Labs
        </span>
      </div>

      <PageHero
        title="External Integrations"
        subtitle="Connect your own API keys for external affiliate networks. Each key unlocks its matching Labs tool for your account. Keys are encrypted and stored server-side — we only ever show the last 4 digits."
        accent="rgba(34,211,238,0.32)"
      />

      <ExternalNetworksCards />
    </div>
  )
}
