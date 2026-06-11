// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Dedicated OG share image for /tour.  Rendered at build time (or on-demand
// for ISR) via next/og + ImageResponse using the locally-bundled Anton font.
// Size: 1200×630 — the standard OG / Twitter card size.

import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'
export const alt = 'MVP Affiliate — Product Tour: everything the platform does today'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  const antonFont = await readFile(join(process.cwd(), 'public/fonts/Anton-Regular.ttf'))

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0E0E11',
          padding: '0',
          overflow: 'hidden',
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            width: '100%',
            height: '4px',
            backgroundImage: 'linear-gradient(90deg, #7C3AED, #C026D3, #7C3AED)',
            display: 'flex',
            flexShrink: 0,
          }}
        />

        {/* Content wrapper */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '52px 64px 52px 64px',
            flex: 1,
          }}
        >
          {/* Logo row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 'auto' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                backgroundImage: 'linear-gradient(135deg, #7C3AED, #C026D3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: '20px',
                fontWeight: 700,
              }}
            >
              M
            </div>
            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '18px', fontWeight: 600 }}>
              MVP Affiliate
            </span>
          </div>

          {/* Label + headline + description */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0px' }}>
            {/* Label */}
            <div style={{ display: 'flex', marginBottom: '18px' }}>
              <div
                style={{
                  padding: '5px 14px',
                  borderRadius: '20px',
                  backgroundColor: 'rgba(124,58,237,0.2)',
                  border: '1px solid rgba(124,58,237,0.45)',
                  color: '#A78BFA',
                  fontSize: '12px',
                  fontWeight: 700,
                  letterSpacing: '2.5px',
                  textTransform: 'uppercase',
                  display: 'flex',
                }}
              >
                Product Tour
              </div>
            </div>

            {/* Headline — Anton for impact */}
            <div
              style={{
                fontFamily: 'Anton',
                fontSize: '80px',
                color: '#F5F5F7',
                lineHeight: 1.0,
                marginBottom: '22px',
                maxWidth: '920px',
                display: 'flex',
              }}
            >
              Everything MVP does today.
            </div>

            {/* Description */}
            <div
              style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: '22px',
                lineHeight: 1.45,
                maxWidth: '700px',
                marginBottom: '36px',
                display: 'flex',
              }}
            >
              One review video → blog posts that rank, comparisons, thumbnails, newsletter, brand pitches. Fact-grounded in your real video.
            </div>

            {/* CTA row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div
                style={{
                  padding: '12px 28px',
                  borderRadius: '8px',
                  backgroundColor: '#7C3AED',
                  color: '#fff',
                  fontSize: '16px',
                  fontWeight: 700,
                  display: 'flex',
                }}
              >
                Start free trial →
              </div>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '15px', display: 'flex' }}>
                mvpaffiliate.io/tour
              </span>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: 'Anton', data: antonFont, weight: 400 }],
    },
  )
}
