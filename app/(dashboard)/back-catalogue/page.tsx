// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /back-catalogue — the same thing Video Launchpad's "Already on YouTube" tab
// runs, on its own page.
//
// It is ONE component, not two copies. This started life as a separate Labs page
// and was folded into Launchpad, where it belongs: a creator thinking about
// getting a video onto Amazon should not have to know that the answer depends on
// whether the video is already on their channel. The page stays because it is
// the direct link, and because Labs is where people go looking for it.

'use client'

import PageHero from '@/components/layout/PageHero'
import BackCatalogueStage from '@/components/launchpad/BackCatalogueStage'

export default function BackCataloguePage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHero
        title="Back catalogue"
        subtitle="YouTube has already dubbed part of your channel. This finds those videos and sends them to the Amazon storefronts that speak those languages, translated, with the product attached. You never download anything."
      />
      <div className="mt-6">
        <BackCatalogueStage />
      </div>
      <p className="mt-6 text-[12px]" style={{ color: 'var(--muted)' }}>
        This also lives inside <a href="/launchpad" className="underline" style={{ color: '#7C3AED' }}>Video Launchpad</a>,
        under &ldquo;Already on YouTube&rdquo;.
      </p>
    </div>
  )
}
