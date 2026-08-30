// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CTA Studio — the standalone upload + CTA burn-in workspace. Same stage
// Launchpad uses to start from a raw file, exposed on its own. The whole
// experience lives in UploadStage so the two stay in lockstep.
'use client'

import PageHero from '@/components/layout/PageHero'
import UploadStage from '@/components/launchpad/UploadStage'

export default function CtaStudioPage() {
  return (
    <>
      <PageHero
        title="CTA Studio"
        subtitle="Upload a horizontal video, burn in a branded call-to-action, and publish it to YouTube."
      />
      <div className="max-w-2xl pb-28">
        <UploadStage />
      </div>
    </>
  )
}
