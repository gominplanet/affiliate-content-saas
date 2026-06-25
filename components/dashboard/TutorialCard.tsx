'use client'

import { useState, useEffect } from 'react'
import { Play, X } from 'lucide-react'

const VIDEO_ID = 'aBo0ruDuVuE'
const DISMISSED_KEY = 'mvp_tutorial_dismissed'

export default function TutorialCard() {
  const [dismissed, setDismissed] = useState(true) // start hidden to avoid flash
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === '1')
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1')
    setDismissed(true)
  }

  if (dismissed) return null

  return (
    <section
      className="rounded-2xl border overflow-hidden"
      style={{ borderColor: 'rgba(124,58,237,0.25)', backgroundColor: 'var(--surface)' }}
    >
      <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-[#7C3AED] flex items-center justify-center">
            <Play size={12} className="text-white" fill="white" />
          </span>
          <span className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
            Getting started with MVP Affiliate
          </span>
        </div>
        <button
          onClick={dismiss}
          className="opacity-40 hover:opacity-80 transition-opacity"
          title="Dismiss"
          aria-label="Dismiss tutorial"
        >
          <X size={15} style={{ color: 'var(--text)' }} />
        </button>
      </div>

      {playing ? (
        <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
          <iframe
            src={`https://www.youtube.com/embed/${VIDEO_ID}?autoplay=1&rel=0&modestbranding=1`}
            title="MVP Affiliate — getting started"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
          />
        </div>
      ) : (
        <button
          onClick={() => setPlaying(true)}
          className="relative w-full block group"
          style={{ aspectRatio: '16/9' }}
          aria-label="Play tutorial video"
        >
          {/* YouTube max-res thumbnail */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://img.youtube.com/vi/${VIDEO_ID}/maxresdefault.jpg`}
            alt="MVP Affiliate tutorial thumbnail"
            className="w-full h-full object-cover"
          />
          {/* Play overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-colors">
            <div className="w-16 h-16 rounded-full bg-[#7C3AED] flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
              <Play size={24} className="text-white ml-1" fill="white" />
            </div>
          </div>
        </button>
      )}
    </section>
  )
}
