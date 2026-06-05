/**
 * /connect-socials — dedicated route for connecting YouTube + every social
 * channel (Instagram, TikTok, Pinterest, X, Facebook, Threads, LinkedIn,
 * Bluesky, Telegram, Newsletter).
 *
 * Until 2026-06-05 this was a hash anchor inside /setup → Integrations
 * tab — easy to lose, buried two levels deep. Now it's a top-level URL
 * that the sidebar's "Connect Socials" entry points at directly.
 *
 * Renders the same IntegrationsPanel that /setup → Integrations renders,
 * imported from the setup page. Single OAuth state machine, single
 * source of truth — only the URL is different.
 *
 * WordPress connect bits live on /setup proper now (Blog Set Up). The
 * Geniuslink + Amazon-tag fallback moved to /brand (Brand Profile). What
 * this page focuses on: social/video channels the user broadcasts to.
 */

'use client'

import { Suspense } from 'react'
import { IntegrationsPanel } from '@/app/(dashboard)/setup/page'
import { TutorialVideo } from '@/components/TutorialVideo'

function ConnectSocialsInner() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
          Connect Socials
        </h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
          Hook up YouTube, your video channels, and every social platform you publish to.
          Connect once — fan-out posting works from anywhere in the app afterward.
        </p>
      </div>
      <TutorialVideo sectionKey="integrations" />
      {/* Same panel that lives at /setup?tab=integrations. Reused so OAuth
          callbacks, in-flight states, and DB writes stay consistent. */}
      <IntegrationsPanel onLoad={() => {}} />
    </div>
  )
}

export default function ConnectSocialsPage() {
  return (
    <Suspense>
      <ConnectSocialsInner />
    </Suspense>
  )
}
