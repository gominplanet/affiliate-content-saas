// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Storefront Sync — the standalone Amazon-geos workspace. This is the same stage
// Launchpad runs, exposed on its own for creators who only want the storefront
// distribution. The whole experience lives in StorefrontStage so the two stay
// in lockstep.
'use client'

import PageHero from '@/components/layout/PageHero'
import StorefrontStage from '@/components/launchpad/StorefrontStage'

export default function GlobalSyncPage() {
  return (
    <>
      <PageHero
        title="Storefront Sync"
        subtitle="One master video, localized for every Amazon marketplace you sell in. Titles and descriptions are rewritten in your voice, and dubbed in your own voice."
      />
      <div className="max-w-3xl pb-28">
        <StorefrontStage />
      </div>
    </>
  )
}
