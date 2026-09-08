// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The card people see when the link is shared.
//
// It used to be a 1.6 MB abstract render: a glowing play button, a dashboard, a
// phone, a camera. Handsome, and it told a stranger nothing. A link preview in
// WhatsApp gets about two seconds of attention and is often the only thing
// somebody sees before deciding whether to open it, so those two seconds should
// say what the product DOES.
//
// So this draws the pipeline instead, in words: a video goes in, a blog post
// and social posts come out, and every link in them is the creator's own
// affiliate link. That is the whole product in one line, and it is the part
// people ask about.
//
// Generated with next/og rather than exported from a design tool, for the
// reason that matters over time: the copy is code. When the product changes,
// this changes in the same commit and nobody has to remember to re-export a
// PNG. The same ImageResponse is already used for Instagram composites, so this
// is a path that works here rather than a new dependency.

import { ImageResponse } from 'next/og'

export const alt = 'MVP Affiliate turns one video into a blog post and social posts, all carrying your own affiliate links'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** Brand purple, the same one the app uses for its primary actions. */
const ACCENT = '#7C3AED'
const INK = '#F5F5F7'
const MUTED = '#A9A9B8'

/** One step of the pipeline. Satori needs an explicit display:flex on any
 *  element with more than one child, so every wrapper here declares it. */
function Step({ label, sub }: { label: string; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
      <div style={{ fontSize: 30, color: INK, fontWeight: 600, lineHeight: 1.15 }}>{label}</div>
      <div style={{ fontSize: 20, color: MUTED, lineHeight: 1.3 }}>{sub}</div>
    </div>
  )
}

function Arrow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', color: ACCENT, fontSize: 34, paddingTop: 4 }}>→</div>
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
          background: '#0B0B12',
          // A single soft wash of the brand colour, off to one side. Enough to
          // look like something rather than a plain slide, without competing
          // with the words, which are the point of the card.
          backgroundImage: 'radial-gradient(1000px 560px at 90% 4%, rgba(124,58,237,0.55), transparent 64%), radial-gradient(700px 400px at 2% 100%, rgba(124,58,237,0.16), transparent 60%)',
          padding: '58px 64px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', width: 13, height: 13, borderRadius: 13, background: ACCENT }} />
          <div style={{ fontSize: 25, color: INK, fontWeight: 700, letterSpacing: 0.4 }}>MVP Affiliate</div>
        </div>

        {/* The promise, in one sentence a stranger can act on. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 60, color: INK, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1 }}>
            One video becomes a blog post
          </div>
          <div style={{ fontSize: 60, color: ACCENT, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1 }}>
            and a week of social posts
          </div>
        </div>

        {/* The pipeline, named. This is the explanatory half: it answers "what
            does it actually do" without anyone having to click. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 26 }}>
          <Step label="Your video" sub="YouTube, or a product link" />
          <Arrow />
          <Step label="An SEO blog post" sub="written in your own voice" />
          <Arrow />
          <Step label="Posted everywhere" sub="socials, pins, newsletter" />
        </div>

        {/* The part affiliates care about most, and the domain. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 24, color: INK }}>
            Every link is your own affiliate link, routed to each reader&rsquo;s country.
          </div>
          <div style={{ display: 'flex', fontSize: 24, color: MUTED }}>mvpaffiliate.io</div>
        </div>
      </div>
    ),
    size,
  )
}
