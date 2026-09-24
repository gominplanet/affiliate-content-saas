// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Liftoff (was Launch Batch, and replaces Video Launchpad) — up to ten videos
// set up in one sitting, then YouTube and every Amazon country from one press.
//
// Launchpad did one video at a time with the creator watching, and its one
// extra (skip YouTube, Amazon only) is a choice here now, so /launchpad and
// the old /launch both forward to this page (next.config.js).
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

export default function LiftoffPage() {
  return (
    <>
      <PageHero
        title="Liftoff"
        subtitle="Up to ten videos, one press. Choose your CTA, thumbnail look and Amazon countries once, give each video its product, then press Launch. MVP burns the CTA, builds every thumbnail, schedules YouTube with paid promotion and AI use set, then translates, dubs and sends each video to every Amazon country, and shows you where each one landed."
      />
      <div className="pb-28">
        <LaunchBoard />
      </div>
    </>
  )
}
