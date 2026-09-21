// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Launch Batch — ten videos set up in one sitting and released on a schedule.
//
// Video Launchpad is one video with a creator watching it, which is the right
// shape for one video. It is the wrong shape for ten: the CTA burn, the
// thumbnails, the translation and every dub run on our servers and need nobody
// present, so sitting through them ten times is the whole friction.
//
// Here the creator makes three decisions once (the CTA, the countries, the
// cadence), gives each video its own product, and presses Launch. YouTube is
// handled from our side. The Amazon upload is the one part that needs their
// browser, because SCOUT drives their own logged-in Creator account and there
// is no server-side session for amazon.de.
'use client'

import PageHero from '@/components/layout/PageHero'
import LaunchBoard from '@/components/launch/LaunchBoard'

export default function LaunchPage() {
  return (
    <>
      <PageHero
        title="Launch Batch"
        subtitle="Set up ten videos in one sitting. Choose your CTA and your Amazon countries once, give each video its product, then press Launch and walk away. MVP burns the CTA, builds every thumbnail, translates and dubs for each country, and puts your videos on YouTube at the times you pick."
      />
      <div className="pb-28">
        <LaunchBoard />
      </div>
    </>
  )
}
