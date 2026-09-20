// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Storefront Sync — the whole international Amazon feature, on one page.
//
// There used to be three doors to this. A Launchpad tab for a video already on
// YouTube, a Back Catalogue page in Labs that scanned the channel, and this
// page, which asked you to pick one master video at a time. All three ended in
// the same sync jobs, so the only thing the split achieved was making a creator
// choose a door before they could ask the one question they actually have:
// which of my videos are earning in other countries, and what is stopping the
// rest.
//
// One page now, and one model behind it. Every video has a standing row in
// every country you tick, a background worker keeps moving them whether or not
// this page is open, and the only thing asked of you is the upload, which can
// only happen in your own browser.
//
// The single-video path did not need its own page either: it is one row in the
// same grid, and Video Launchpad still handles a file that is not on YouTube
// yet, which is genuinely a different job.
'use client'

import PageHero from '@/components/layout/PageHero'
import CoverageBoard from '@/components/storefront/CoverageBoard'

export default function GlobalSyncPage() {
  return (
    <>
      <PageHero
        title="Storefront Sync"
        subtitle="Your videos, earning in every Amazon country you sell in. Pick the countries and MVP works through your whole catalogue in the background, translating and dubbing each video for each store. The only part that needs you is the upload, which goes through your own Amazon Creator account."
      />
      <div className="pb-28">
        <CoverageBoard />
      </div>
    </>
  )
}
