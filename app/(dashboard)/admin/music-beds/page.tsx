'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /admin/music-beds: the music beds panel the Edit Studio will use, for the
// team first (lib/labs-preview music_beds). Tick a mood, a tempo and a style,
// hear Stable Audio 3 Small and Medium side by side, and accept the ones that
// sound right (Seb, 2026-11-26).

import { Loader2 } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import MusicBedMaker from '@/components/music/MusicBedMaker'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { canUsePreview } from '@/lib/labs-preview'

export default function AdminMusicBedsPage() {
  const tier = useEffectiveTier()
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-5">
      <PageHero
        title="Music beds"
        subtitle="Tick a mood, a tempo and a style, and MVP makes an instrumental track with Stable Audio 3 at the length you pick. Every track is checked for voices before you hear it. Try both engines and accept the ones that sound right."
      />
      {tier === null ? <p className="text-[13px] inline-flex items-center gap-2" style={{ color: 'var(--text-soft)' }}><Loader2 size={14} className="animate-spin" /> Loading</p>
        : canUsePreview('music_beds', tier) ? <MusicBedMaker showEngine />
        : <p className="text-[14px]" style={{ color: 'var(--text)' }}>Music beds are for the team for now. They come to members with the Edit Studio.</p>}
    </div>
  )
}
