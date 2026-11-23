// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The share card for /trybe-free: the image that unfurls when the free-TRYBE
// link is posted to Facebook, X, WhatsApp, iMessage and the rest.
//
// Generated with next/og rather than a hand-exported PNG, for the same reason
// as the site-wide card (app/opengraph-image.tsx): the copy is code, so when the
// offer changes this changes in the same commit and nobody has to remember to
// re-export an image. Next wires this file up as og:image AND twitter:image for
// this route automatically.
//
// Framing (Seb, 2026-11-23): the free thing is MVP Affiliate's TRYBE FEATURE,
// not the TRYBE marketplace, so "free" is tied to MVP, never to TRYBE itself.
//
// Satori note: every element with more than one child needs an explicit
// display:flex, so every wrapper below declares it.

import { ImageResponse } from 'next/og'

export const alt = "MVP Affiliate's TRYBE feature is free: find the brands that pay, pitch them in your own words, and track every dollar. No card."
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BG = '#FBF7F2'
const INK = '#1C1917'
const MUTED = '#57534E'
const FAINT = '#A8A29E'
const TEAL = '#008080'
const TEAL_LT = '#0C9A91'

function Chip({ children }: { children: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', background: '#FFFFFF', border: '1.5px solid rgba(0,128,128,0.25)', borderRadius: 999, padding: '12px 22px', fontSize: 23, fontWeight: 700, color: INK }}>
      {children}
    </div>
  )
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: BG,
          backgroundImage: 'radial-gradient(900px 520px at 92% 2%, rgba(45,212,191,0.30), transparent 62%), radial-gradient(640px 420px at 2% 102%, rgba(0,128,128,0.16), transparent 60%)',
          padding: '60px 66px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Wordmark + free badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 14, background: TEAL }} />
            <div style={{ fontSize: 27, color: INK, fontWeight: 700, letterSpacing: 0.2 }}>MVP Affiliate</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', background: TEAL, color: '#FFFFFF', borderRadius: 999, padding: '11px 22px', fontSize: 20, fontWeight: 700, letterSpacing: 1.2 }}>
            FREE FOREVER · NO CARD NEEDED
          </div>
        </div>

        {/* Headline + subline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 66, color: INK, fontWeight: 800, lineHeight: 1.04, letterSpacing: -1.6 }}>
              Land brand deals on TRYBE.
            </div>
            <div style={{ fontSize: 66, color: TEAL_LT, fontWeight: 800, lineHeight: 1.04, letterSpacing: -1.6 }}>
              Free, only on MVP.
            </div>
          </div>
          <div style={{ display: 'flex', fontSize: 27, color: MUTED, lineHeight: 1.35, maxWidth: 900 }}>
            MVP Affiliate&rsquo;s TRYBE feature finds the brands that pay, pitches them in your own words, and tracks every dollar.
          </div>
        </div>

        {/* Chips + domain */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Chip>Find brands that pay</Chip>
            <Chip>Ask 20 a day</Chip>
            <Chip>Attach your intro video</Chip>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', background: TEAL, color: '#FFFFFF', borderRadius: 999, padding: '14px 30px', fontSize: 24, fontWeight: 800 }}>
            Start free on MVP  →
          </div>
          <div style={{ display: 'flex', fontSize: 24, color: FAINT, fontWeight: 600 }}>mvpaffiliate.io/trybe-free</div>
        </div>
      </div>
    ),
    size,
  )
}
