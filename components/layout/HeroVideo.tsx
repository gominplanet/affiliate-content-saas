// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HeroVideo — a walkthrough video for the `media` slot of <PageHero>.
//
// Click-to-play rather than a live embed: a YouTube iframe pulls ~1MB, and
// these sit on pages that load on every visit. We render the poster and only
// mount the iframe once someone actually asks for it.

'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'

interface HeroVideoProps {
  /** YouTube video id, e.g. the `O4fOrgudOOA` in youtu.be/O4fOrgudOOA */
  videoId: string
  /** Describes the video for screen readers and the iframe title. */
  title: string
}

export default function HeroVideo({ videoId, title }: HeroVideoProps) {
  const [playing, setPlaying] = useState(false)

  if (playing) {
    return (
      <div
        className="relative w-full rounded-xl overflow-hidden border"
        style={{ borderColor: 'var(--border)', paddingBottom: '56.25%', height: 0 }}
      >
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>
    )
  }

  return (
    <button
      onClick={() => setPlaying(true)}
      className="relative w-full block group rounded-xl overflow-hidden border shadow-lg"
      style={{ aspectRatio: '16/9', borderColor: 'var(--border)' }}
      aria-label={`Play: ${title}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`}
        alt=""
        className="w-full h-full object-cover"
        // maxresdefault 404s on uploads that never got one; hqdefault always exists.
        onError={e => { e.currentTarget.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` }}
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-colors">
        <div className="w-14 h-14 rounded-full bg-[#7C3AED] flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
          <Play size={22} className="text-white ml-0.5" fill="white" />
        </div>
      </div>
    </button>
  )
}
