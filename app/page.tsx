/**
 * / — public-facing homepage (mvpaffiliate.io).
 *
 * Promoted from /landing-preview on 2026-06-04 — the dark sales page
 * is now the canonical landing surface. The previous light-themed
 * homepage was archived (git history) when this took over.
 *
 * Sits outside /preview/* so it doesn't inherit the dashboard preview's
 * sidebar/topbar layout. Uses the same CSS-variable theme system so the
 * sun/moon toggle works identically.
 *
 * Source of truth for tier copy: lib/tier.ts → mirrored in PRICING_TIERS
 * below and in app/pricing/page.tsx. If you change one, change all three.
 */
'use client'

import { useState, useEffect } from 'react'
import {
  FileText, Image as ImageIcon, Music2, Instagram, Mail, Scale, Calendar,
  Play, Sun, Moon, Sparkles, ArrowRight, Bookmark,
  Twitter, AtSign, Cloud, Send, Facebook,
  Compass, HeartHandshake, PenLine, Share2, Globe, TrendingUp, Wand2,
  Youtube, ShieldCheck, Zap, Upload, X as XIcon, Check, Quote,
  Crown, Rocket, Plus, Minus,
  LayoutTemplate, BadgePercent,
} from 'lucide-react'

const DARK_VARS: React.CSSProperties = {
  ['--bg' as string]: '#0E0E11',
  ['--surface' as string]: 'rgba(255,255,255,0.04)',
  ['--surface-bright' as string]: 'rgba(255,255,255,0.08)',
  ['--border' as string]: 'rgba(255,255,255,0.08)',
  ['--text' as string]: '#F5F5F7',
  ['--text-muted' as string]: 'rgba(255,255,255,0.85)',
  ['--text-soft' as string]: 'rgba(255,255,255,0.65)',
  ['--text-subtle' as string]: 'rgba(255,255,255,0.50)',
  ['--text-faint' as string]: 'rgba(255,255,255,0.38)',
  ['--card-shadow' as string]: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.3)',
  ['--hero-opacity' as string]: '0.55',
  ['--line-color' as string]: 'rgba(124,58,237,0.55)',
  ['--line-glow' as string]: 'rgba(124,58,237,0.35)',
  ['--center-bg' as string]: 'linear-gradient(135deg, #7C3AED, #C026D3)',
}

const LIGHT_VARS: React.CSSProperties = {
  ['--bg' as string]: '#FAFAF8',
  ['--surface' as string]: '#FFFFFF',
  ['--surface-bright' as string]: 'rgba(0,0,0,0.05)',
  ['--border' as string]: 'rgba(0,0,0,0.10)',
  ['--text' as string]: '#1D1D1F',
  ['--text-muted' as string]: 'rgba(0,0,0,0.82)',
  ['--text-soft' as string]: 'rgba(0,0,0,0.62)',
  ['--text-subtle' as string]: 'rgba(0,0,0,0.50)',
  ['--text-faint' as string]: 'rgba(0,0,0,0.40)',
  ['--card-shadow' as string]: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.03)',
  ['--hero-opacity' as string]: '0.22',
  ['--line-color' as string]: 'rgba(124,58,237,0.55)',
  ['--line-glow' as string]: 'rgba(124,58,237,0.18)',
  ['--center-bg' as string]: 'linear-gradient(135deg, #7C3AED, #C026D3)',
}

/** Hub diagram constants. Computed once so the SVG and the absolutely
 *  positioned spoke nodes share the same geometry. Bumped from 8 spokes
 *  to 13 (full social coverage) — container + radius widened so the pills
 *  don't crowd each other. */
const CX = 380
const CY = 290
const RADIUS = 250
const VIEW_W = 760
const VIEW_H = 580

interface Spoke {
  /** Angle in degrees, 0 = right, 90 = down, -90 = up. */
  angle: number
  label: string
  icon: React.ReactNode
}

/** 13 spokes total, ~27.7° apart. Layout flows clockwise starting at
 *  top: 5 content outputs (blog/thumbnail/comparison/newsletter/scheduled),
 *  then 8 social platforms. Labels kept short so the pills don't overlap
 *  at the equator. */
const SPOKES: Spoke[] = [
  { angle:  -90.0, label: 'Blog post',  icon: <FileText size={13} /> },
  { angle:  -62.3, label: 'Thumbnail',  icon: <ImageIcon size={13} /> },
  { angle:  -34.6, label: 'Comparison', icon: <Scale size={13} /> },
  { angle:   -6.9, label: 'Newsletter', icon: <Mail size={13} /> },
  { angle:   20.8, label: 'Scheduled',  icon: <Calendar size={13} /> },
  { angle:   48.5, label: 'TikTok',     icon: <Music2 size={13} /> },
  { angle:   76.2, label: 'Instagram',  icon: <Instagram size={13} /> },
  { angle:  103.8, label: 'Pinterest',  icon: <Bookmark size={13} /> },
  { angle:  131.5, label: 'X',          icon: <Twitter size={13} /> },
  { angle:  159.2, label: 'Threads',    icon: <AtSign size={13} /> },
  { angle:  186.9, label: 'Bluesky',    icon: <Cloud size={13} /> },
  { angle:  214.6, label: 'Telegram',   icon: <Send size={13} /> },
  { angle:  242.3, label: 'FB Groups',  icon: <Facebook size={13} /> },
]

/** Convert an angle to {x,y} on the spoke circle. */
function spokePos(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: CX + RADIUS * Math.cos(rad),
    y: CY + RADIUS * Math.sin(rad),
  }
}

export default function LandingPreview() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const saved = sessionStorage.getItem('mvp-landing-theme')
    if (saved === 'light' || saved === 'dark') setTheme(saved)
  }, [])
  useEffect(() => {
    sessionStorage.setItem('mvp-landing-theme', theme)
  }, [theme])

  return (
    <div
      style={{
        ...(theme === 'dark' ? DARK_VARS : LIGHT_VARS),
        backgroundColor: 'var(--bg)',
        color: 'var(--text)',
      }}
      className="min-h-screen font-[Inter,system-ui,sans-serif]"
    >
      {/* Page-scoped keyframes for the hub animation. Lives here so the
          preview is fully self-contained — no global CSS edits. */}
      <style jsx global>{`
        @keyframes mvp-center-in {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes mvp-spoke-in {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes mvp-line-draw {
          from { stroke-dashoffset: 320; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes mvp-line-pulse {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 0.95; }
        }
        @keyframes mvp-ring-pulse {
          0%, 100% { opacity: 0.4; transform: translate(-50%, -50%) scale(1); }
          50%      { opacity: 0.0; transform: translate(-50%, -50%) scale(1.25); }
        }
        @keyframes mvp-play-pulse {
          0%   { transform: scale(1);    opacity: 0.5; }
          70%  { transform: scale(1.6);  opacity: 0;   }
          100% { transform: scale(1.6);  opacity: 0;   }
        }
        html { scroll-behavior: smooth; }
      `}</style>

      <Nav theme={theme} onToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <Hero />
      <PlatformBar />
      <DemoVideoSection />
      <RolesSection />
      <WorkflowSection />
      <BeforeAfterSection />
      <GroundedSection />
      <BrandedSiteSection />
      <PricingSection />
      <ProofSection />
      <FAQSection />
      <FinalCTASection />
      <Footer />
      <StickyBottomBar />
    </div>
  )
}

/** Intro video section — large centered video frame with a clickable
 *  play overlay. Click opens a fullscreen modal lightbox that plays the
 *  real 90-second founder introduction MP4 from /public/demo/mvp-90s.mp4
 *  (self-hosted, not YouTube — see commit history for the "why self-host"
 *  call). NOTE: section id stays "demo" and the directory stays /demo/
 *  to keep all the #demo anchor links + asset URLs stable; the user-
 *  facing copy is what we updated to "introduction" since this is a
 *  founder intro, not a product walkthrough.
 *
 *  The play button has a gentle breathing pulse so it reads as "alive
 *  and clickable" from any distance on the page.
 *
 *  Modal close behaviors: ESC key, X button top-right, click anywhere
 *  outside the video frame. Body scroll is locked while the modal is
 *  open so the page doesn't jitter when the lightbox renders. */
function DemoVideoSection() {
  const [open, setOpen] = useState(false)

  // ESC-to-close + body scroll lock. Both live in the same effect so
  // they enable + tear down together — a half-applied state (scroll
  // locked but no ESC listener) would be surprising.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <section id="demo" className="px-6 lg:px-8 pb-24 -mt-8 relative">
      <div className="max-w-5xl mx-auto">
        {/* Section eyebrow + heading */}
        <div className="text-center mb-8">
          <p
            className="text-[11px] uppercase tracking-[0.18em] font-medium mb-3"
            style={{ color: 'var(--text-faint)' }}
          >
            A quick introduction
          </p>
          <h2
            className="text-[28px] lg:text-[36px] font-semibold tracking-tight leading-tight max-w-3xl mx-auto"
            style={{ color: 'var(--text)' }}
          >
            Why we built MVP.{' '}
            <span style={{ color: 'var(--text-soft)' }}>What it does.</span>{' '}
            <span style={{ color: 'var(--text-soft)' }}>What&apos;s free when you start.</span>
          </h2>
        </div>

        {/* The video frame. Wrapper provides the violet outer glow + soft
            shadow. Inner div is what the visitor clicks — opens the
            fullscreen modal with the real demo MP4. */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Play 90-second introduction"
          className="relative rounded-2xl overflow-hidden cursor-pointer group transition-transform duration-200 hover:scale-[1.005] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2"
          style={{
            boxShadow: '0 24px 80px -16px rgba(124,58,237,0.35), 0 8px 24px rgba(0,0,0,0.15), 0 0 0 1px var(--border)',
          }}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setOpen(true)
            }
          }}
        >
          {/* Aspect ratio holder (16:9). All visual layers stack inside. */}
          <div className="relative aspect-video w-full overflow-hidden bg-[#0E0E11]">
            {/* Mesh gradient backdrop — same family as hero, slightly
                offset so the demo doesn't look like a copy of the hero. */}
            <div
              className="absolute inset-0"
              style={{
                background: `
                  radial-gradient(45% 65% at 30% 30%, rgba(124,58,237,0.40), transparent 60%),
                  radial-gradient(40% 60% at 75% 60%, rgba(192,38,211,0.32), transparent 65%),
                  radial-gradient(60% 50% at 50% 95%, rgba(99,102,241,0.25), transparent 70%),
                  linear-gradient(180deg, #0E0E11, #1A1A22)
                `,
              }}
            />

            {/* Faint UI-chrome hint at the top — gives the impression of a
                real product screenshot underneath without committing to one.
                Three tiny circles like a macOS window. */}
            <div className="absolute top-4 left-4 flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
            </div>

            {/* Real product frame from the demo video (extracted at the
                42-second mark). Sits behind the play button so visitors
                see what they're about to watch. If the file is missing
                the browser silently 404s the background-image and the
                mesh gradient underneath still shows — no broken-image
                icon, no layout shift. */}
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: 'url(/demo/poster.jpg)' }}
              aria-hidden
            />

            {/* Soft dark overlay so the violet play button + pulse stay
                the clear focal point against any frame from the video. */}
            <div
              className="absolute inset-0"
              style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
              aria-hidden
            />

            {/* Play button — large, violet, with a soft breathing pulse so
                it reads as the focal point from any scroll position. */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative">
                {/* Outer pulsing ring */}
                <span
                  className="absolute inset-0 rounded-full"
                  style={{
                    backgroundColor: 'rgba(124,58,237,0.35)',
                    animation: 'mvp-play-pulse 2.5s ease-out infinite',
                  }}
                />
                {/* The button itself */}
                <button
                  type="button"
                  aria-label="Play introduction video"
                  className="relative w-20 h-20 rounded-full bg-[#7C3AED] hover:bg-[#6D28D9] flex items-center justify-center text-white transition-all duration-200 group-hover:scale-105"
                  style={{ boxShadow: '0 12px 32px rgba(124,58,237,0.55)' }}
                >
                  <Play size={28} fill="currentColor" className="ml-1" />
                </button>
              </div>
            </div>

            {/* Bottom-right: mock timestamp pill — adds credibility ("this
                is a 1:30 video, not a sales pitch") at a glance. */}
            <div
              className="absolute bottom-4 right-4 px-2 py-1 rounded text-[11px] font-medium tabular-nums text-white/85 backdrop-blur-sm"
              style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
            >
              0:00 · 1:30
            </div>

            {/* Bottom progress bar — empty for now, decorative. Implies
                "this is a video player, ready to play." */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
              <div className="h-full bg-[#7C3AED]" style={{ width: '0%' }} />
            </div>
          </div>
        </div>

        {/* Caption below the video — sets expectations so visitors who
            don't click still get the value prop. */}
        <p
          className="text-center mt-6 text-[14px] max-w-xl mx-auto leading-relaxed"
          style={{ color: 'var(--text-subtle)' }}
        >
          90 seconds. The story behind MVP, what it does, and what you get free when you start.
        </p>
      </div>

      {/* Modal lightbox — renders only when `open === true` so the
          <video> element doesn't even mount until the user clicks
          play. Means: zero bandwidth burned on scroll-by traffic,
          zero JS player code parsed unless interest is real.

          Close behaviors:
            - X button top-right
            - Click anywhere outside the video frame (handler on the
              backdrop; the video stops propagation)
            - ESC key (effect on the parent component)

          The MP4 lives in /public/demo/ so it ships from Vercel's
          edge CDN. `preload="metadata"` fetches only the first few
          KB until the user hits play — keeps the modal-open feel
          snappy without auto-pulling the whole 39MB asset. */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8 backdrop-blur-sm"
          style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Introduction video"
        >
          {/* Stop clicks on the video itself from closing the modal —
              that should only happen on backdrop clicks. */}
          <div
            className="relative w-full max-w-5xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close introduction"
              className="absolute -top-12 right-0 sm:top-2 sm:right-2 w-10 h-10 rounded-full flex items-center justify-center text-white hover:scale-110 transition-transform z-10"
              style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
            >
              <XIcon size={20} strokeWidth={2.5} />
            </button>
            <video
              src="/demo/mvp-90s.mp4"
              poster="/demo/poster.jpg"
              controls
              autoPlay
              playsInline
              preload="metadata"
              className="w-full rounded-2xl shadow-2xl"
              style={{ maxHeight: '85vh' }}
            >
              Your browser does not support the video tag. <a href="/demo/mvp-90s.mp4">Download the introduction</a> instead.
            </video>
          </div>
        </div>
      )}
    </section>
  )
}

/** Section 3 — "Roles MVP plays".
 *
 *  Frames the product as a TEAM of specialists you already have on payroll
 *  the moment you subscribe. Eight roles, 4×2 grid, glass cards. Each card:
 *  icon → role label → one product-led line that says what MVP actually
 *  does for that role.
 *
 *  Copy intent: every line passes the "would a creator hire this?" test —
 *  concrete deliverable, no vague benefit-speak.
 */
function RolesSection() {
  return (
    <section id="roles" className="px-6 lg:px-8 pt-24 pb-28 relative">
      <div className="max-w-6xl mx-auto">
        {/* Section header — eyebrow + headline + sub. Centered, same
            rhythm as the hero but slightly tighter. */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <Sparkles size={10} />
            One hub. Many hats.
          </span>
          <h2
            className="text-[40px] sm:text-[52px] font-semibold tracking-tight leading-[1.05] mb-5"
            style={{ color: 'var(--text)' }}
          >
            MVP is many roles.
            <br />
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              One subscription.
            </span>
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            Plans, writes, schedules, optimizes, publishes, so you focus on what only you can do.
          </p>
        </div>

        {/* 4×2 grid of role cards. Drops to 2×4 on tablet, 1×8 on phone. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ROLES.map((role) => (
            <RoleCard key={role.label} {...role} />
          ))}
        </div>
      </div>
    </section>
  )
}

interface Role {
  icon: React.ReactNode
  label: string
  line: string
}

const ROLES: Role[] = [
  {
    icon: <Compass size={18} />,
    label: 'Planner',
    line: 'See your whole content pipeline. Plan a month in one view.',
  },
  {
    icon: <Calendar size={18} />,
    label: 'Scheduler',
    line: 'Schedule once. MVP fires off every platform at the perfect time.',
  },
  {
    icon: <HeartHandshake size={18} />,
    label: 'Collaborator',
    line: 'Your AI partner, trained on your voice. Always ready to think with you.',
  },
  {
    icon: <PenLine size={18} />,
    label: 'Script writer',
    line: 'Long-form video scripts in your voice. From idea to teleprompter in minutes.',
  },
  {
    icon: <Share2 size={18} />,
    label: 'Social generator',
    line: 'Nine social platforms. Each post written native to that one. No copy-paste.',
  },
  {
    icon: <Globe size={18} />,
    label: 'WordPress publisher',
    line: 'Publish straight to your WordPress. Pro: up to 10 sites from one account.',
  },
  {
    icon: <TrendingUp size={18} />,
    label: 'SEO optimizer',
    line: 'Per-post SEO scoring + one-click "fix all" across your entire catalog.',
  },
  {
    icon: <Wand2 size={18} />,
    label: 'Thumbnail studio',
    line: 'CTR-tested thumbnails and titles. AI-picked from your actual video frames.',
  },
]

function RoleCard({ icon, label, line }: Role) {
  return (
    <div
      className="rounded-2xl border p-5 h-full flex flex-col gap-3 transition-all duration-200 hover:-translate-y-0.5"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.35)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          background: 'linear-gradient(135deg, rgba(124,58,237,0.18), rgba(192,38,211,0.14))',
          color: '#C4B5FD',
          border: '1px solid rgba(124,58,237,0.25)',
        }}
      >
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
        {label}
      </h3>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
        {line}
      </p>
    </div>
  )
}

/** Section 4 — "The 4-minute workflow."
 *
 *  Horizontal timeline of 4 numbered steps with a connecting line through
 *  the center. The line uses a violet→fuchsia gradient that fades at both
 *  ends so it visually starts at step 1 and ends at step 4 without
 *  dangling past either side.
 *
 *  Layout:
 *  - Desktop (lg): 4 columns side-by-side, connecting line is horizontal
 *    behind the number circles.
 *  - Mobile/tablet: stacked vertically. Connecting line becomes a vertical
 *    bar on the left, number circles offset right.
 *
 *  Number circles use position: relative + z-index to sit on top of the
 *  line. Each step card is a glass card matching Section 3's rhythm.
 */
function WorkflowSection() {
  return (
    <section id="how-it-works" className="px-6 lg:px-8 pt-12 pb-28 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <Zap size={10} />
            How it works
          </span>
          <h2
            className="text-[40px] sm:text-[52px] font-semibold tracking-tight leading-[1.05] mb-5"
            style={{ color: 'var(--text)' }}
          >
            The{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              4-minute
            </span>{' '}
            workflow.
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            From video to nine outputs, fact-grounded and in your voice.
          </p>
        </div>

        {/* Timeline container — relative so the line can be absolutely
            positioned. The line lives in two flavors that toggle by media
            query so we get one horizontal track on desktop and one vertical
            track on mobile. */}
        <div className="relative">
          {/* Horizontal line (desktop only). Sits at ~y=44px to align with
              the center of the number circles. Fades at both edges so it
              visually originates from step 1 and dies into step 4. */}
          <div
            className="hidden lg:block absolute top-[44px] left-[12.5%] right-[12.5%] h-px"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(124,58,237,0.55) 12%, rgba(192,38,211,0.55) 88%, transparent 100%)',
            }}
            aria-hidden
          />
          {/* Vertical line (mobile/tablet). Same gradient logic, rotated. */}
          <div
            className="lg:hidden absolute top-12 bottom-12 left-[26px] w-px"
            style={{
              background:
                'linear-gradient(180deg, transparent 0%, rgba(124,58,237,0.55) 8%, rgba(192,38,211,0.55) 92%, transparent 100%)',
            }}
            aria-hidden
          />

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 lg:gap-4">
            {STEPS.map((step, i) => (
              <StepCard key={step.title} index={i + 1} step={step} />
            ))}
          </div>
        </div>

        {/* Footnote below the timeline — sets expectations and re-affirms
            the "no copy-paste" pattern. */}
        <p
          className="text-center mt-12 text-[13px]"
          style={{ color: 'var(--text-faint)' }}
        >
          One channel. One workflow. Nine outputs. Zero copy-paste.
        </p>
      </div>
    </section>
  )
}

interface Step {
  icon: React.ReactNode
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    icon: <Youtube size={18} />,
    title: 'Pick a video.',
    body: 'MVP already has your YouTube channel synced (transcript, product, gallery, and timestamps are pre-loaded). No URLs to paste. No copy-paste.',
  },
  {
    icon: <ShieldCheck size={18} />,
    title: 'It grounds everything in real facts.',
    body: 'No invented features. No fabricated stories. Just what you actually said in the video, pulled straight from the transcript and the scraped product data.',
  },
  {
    icon: <Sparkles size={18} />,
    title: 'Generate 9 outputs in one click.',
    body: 'Blog post, comparison, thumbnail, newsletter, plus 6 native social posts. All in your voice. All in about four minutes.',
  },
  {
    icon: <Upload size={18} />,
    title: 'Publish or schedule.',
    body: 'Hit your WordPress site, the social queue, or the calendar. Your call. Everything you make stays yours, on your domain, forever.',
  },
]

function StepCard({ index, step }: { index: number; step: Step }) {
  return (
    <div className="relative pl-16 lg:pl-0">
      {/* Number circle. On mobile, sits flush left of the card and the
          vertical line passes through it. On desktop, centered above the
          card title. The solid background covers the connecting line so
          the circles read as nodes on a wire. */}
      <div
        className="absolute lg:relative top-0 left-0 lg:left-auto lg:mx-auto w-[52px] h-[52px] rounded-full flex items-center justify-center mb-0 lg:mb-5 z-10"
        style={{
          background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
          boxShadow: '0 0 0 6px var(--bg), 0 6px 20px rgba(124,58,237,0.35)',
        }}
      >
        <span className="text-white text-[16px] font-semibold tabular-nums">{index}</span>
      </div>

      <div
        className="rounded-2xl border p-5 lg:p-6 h-full flex flex-col gap-3 transition-all duration-200 hover:-translate-y-0.5"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--card-shadow)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.35)')}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(124,58,237,0.18), rgba(192,38,211,0.14))',
            color: '#C4B5FD',
            border: '1px solid rgba(124,58,237,0.25)',
          }}
        >
          {step.icon}
        </div>
        <h3 className="text-[16px] font-semibold tracking-tight leading-snug" style={{ color: 'var(--text)' }}>
          {step.title}
        </h3>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          {step.body}
        </p>
      </div>
    </div>
  )
}

/** Section 5 — "Grounded in real video. Trained on real voice."
 *
 *  The fact-grounded differentiator section. Sells the product against
 *  generic AI content tools without naming any competitor. Lands as a
 *  comparison table (the old way vs MVP) followed by a founder-quote
 *  card that ties back to the hero's trust strip.
 *
 *  Honesty notes:
 *  - Every row is something MVP actually does (verified against the
 *    product's current behavior — scraping product pages, using
 *    transcripts, LEARN voice profile, video frames in thumbnails,
 *    publish-ready output).
 *  - The "Thumbnails" row specifically — NOT a generic "images" row —
 *    because in-article images mix real product photos with AI; only
 *    thumbnails are reliably grounded in actual video frames.
 *
 *  Layout: 2-col comparison table on desktop. On mobile, each row
 *  stacks the two columns vertically with the label as a pill above.
 */
function GroundedSection() {
  return (
    <section id="grounded" className="px-6 lg:px-8 pt-12 pb-28 relative">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <ShieldCheck size={10} />
            Grounded. Never guessed.
          </span>
          <h2
            className="text-[40px] sm:text-[52px] font-semibold tracking-tight leading-[1.05] mb-5"
            style={{ color: 'var(--text)' }}
          >
            Grounded in{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              real video.
            </span>
            <br />
            Trained on{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              real voice.
            </span>
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            If MVP can&apos;t prove it from your transcript or the product page, MVP doesn&apos;t say it.
          </p>
        </div>

        {/* Comparison table. Desktop: 2 columns side by side with a faint
            vertical divider. Mobile: each row stacks both columns with the
            label-pill on top. */}
        <div
          className="rounded-2xl border overflow-hidden"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          {/* Header row */}
          <div className="hidden sm:grid grid-cols-[160px_1fr_1fr] items-center gap-4 px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-faint)' }}>Dimension</span>
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full"
                style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-faint)' }}
              >
                <XIcon size={11} />
              </span>
              <span className="text-[11px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-subtle)' }}>The old way</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full"
                style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)', color: '#FFFFFF' }}
              >
                <Check size={11} />
              </span>
              <span className="text-[11px] uppercase tracking-[0.15em] font-semibold" style={{ color: '#9D6BFF' }}>MVP</span>
            </div>
          </div>

          {/* Rows */}
          {COMPARISON_ROWS.map((row, i) => (
            <ComparisonRow key={row.label} row={row} isLast={i === COMPARISON_ROWS.length - 1} />
          ))}
        </div>

        {/* Founder quote close — the "B touch" — ties Section 5 back to the
            hero trust strip. */}
        <div
          className="mt-10 rounded-2xl border p-6 sm:p-8 max-w-3xl mx-auto"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'rgba(124,58,237,0.25)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <Quote size={20} className="text-[#7C3AED] mb-3" />
          <p className="text-[16px] sm:text-[17px] leading-relaxed mb-4 italic" style={{ color: 'var(--text-muted)' }}>
            &ldquo;I built MVP because at 2 a.m. I was still rewriting AI-generated posts that invented features my products didn&apos;t have. Every other tool either sounded like a robot or made me triple-check every claim. So I built the one I needed.&rdquo;
          </p>
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            Built by a creator who&apos;s done{' '}
            <span className="font-semibold" style={{ color: 'var(--text)' }}>$3M+/yr</span> in affiliate sales.
          </p>
        </div>
      </div>
    </section>
  )
}

interface ComparisonRowData {
  label: string
  oldWay: string
  mvpWay: string
}

const COMPARISON_ROWS: ComparisonRowData[] = [
  {
    label: 'Facts',
    oldWay: 'Invents features the product doesn’t have.',
    mvpWay: 'Pulls real specs from the product page you reviewed.',
  },
  {
    label: 'Stories',
    oldWay: 'Fabricates “experiences” you never had.',
    mvpWay: 'Uses what you actually said in the transcript.',
  },
  {
    label: 'Voice',
    oldWay: 'Sounds like every other AI post on the internet.',
    mvpWay: 'Trained on your channel: your phrasing, your hooks.',
  },
  {
    label: 'Thumbnails',
    oldWay: 'Generic AI illustrations.',
    mvpWay: 'Built from your actual video frames, with your face baked in.',
  },
  {
    label: 'Time',
    oldWay: 'You spend an hour rewriting before publishing.',
    mvpWay: 'Publish-ready out of the box.',
  },
]

function ComparisonRow({ row, isLast }: { row: ComparisonRowData; isLast: boolean }) {
  return (
    <div
      className={`px-5 py-5 sm:py-4 ${isLast ? '' : 'border-b'}`}
      style={{ borderColor: 'var(--border)' }}
    >
      {/* Mobile: stacked */}
      <div className="sm:hidden flex flex-col gap-2.5">
        <span
          className="self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.12em] font-medium"
          style={{ backgroundColor: 'rgba(124,58,237,0.10)', color: '#9D6BFF' }}
        >
          {row.label}
        </span>
        <div className="flex items-start gap-2">
          <XIcon size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }} />
          <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-subtle)' }}>
            {row.oldWay}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Check size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#9D6BFF' }} />
          <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text)' }}>
            {row.mvpWay}
          </p>
        </div>
      </div>

      {/* Desktop: 3-column grid */}
      <div className="hidden sm:grid grid-cols-[160px_1fr_1fr] items-start gap-4">
        <span className="text-[13px] font-semibold tracking-tight pt-0.5" style={{ color: 'var(--text)' }}>
          {row.label}
        </span>
        <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-subtle)' }}>
          {row.oldWay}
        </p>
        <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {row.mvpWay}
        </p>
      </div>
    </div>
  )
}

/** Section 5.5 — Branded WordPress site.
 *
 *  The "wait, there's more, and it's FREE" moment right before the price
 *  reveal. Every other affiliate AI hands you content and walks away.
 *  MVP installs a complete editorial review site on your domain the moment
 *  you connect WordPress — including a trial user. The cost-stack card at
 *  the bottom makes the value concrete by listing what you'd otherwise pay
 *  (theme + plugins + setup time).
 *
 *  Three feature columns:
 *    1. Editorial review theme (design + UX + layout)
 *    2. Affiliate marketing plugin (monetization tooling)
 *    3. SEO + automation (discovery + cross-linking)
 *  Then a unified "what you'd otherwise pay" card with the savings math.
 *
 *  Position in flow: between Grounded (the truth/no-fabrication section)
 *  and Pricing. Creates a "wait there's more" beat right before the
 *  price reveal so the cards below feel like even more of a steal. */
function BrandedSiteSection() {
  return (
    <section className="px-6 lg:px-8 py-24 relative">
      <div className="max-w-6xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-14 max-w-3xl mx-auto">
          <p
            className="text-[11px] uppercase tracking-[0.18em] font-medium mb-4"
            style={{ color: 'var(--text-faint)' }}
          >
            Free with every plan, trial included
          </p>
          <h2
            className="text-[28px] lg:text-[40px] font-semibold tracking-tight leading-tight mb-5"
            style={{ color: 'var(--text)' }}
          >
            A real branded WordPress site.{' '}
            <span style={{ color: 'var(--text-soft)' }}>Day one.</span>{' '}
            <span style={{ color: '#9D6BFF' }}>Even on the trial.</span>
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed"
            style={{ color: 'var(--text-soft)' }}
          >
            Every other affiliate AI hands you content and walks away. You&apos;re still
            on the hook for buying a theme, hunting plugins, building the layout, and
            figuring out conversion. MVP installs a complete editorial review site on
            YOUR WordPress, YOUR domain, the moment you connect. Designed for affiliate
            reviews. Tuned for conversion. Yours forever, even if you cancel.
          </p>
        </div>

        {/* 3-column feature stack — Theme / Plugin / SEO + Automation */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          {SITE_FEATURE_COLUMNS.map((col) => (
            <div
              key={col.eyebrow}
              className="rounded-2xl border p-6 lg:p-7"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                boxShadow: 'var(--card-shadow)',
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md"
                  style={{ backgroundColor: 'rgba(124,58,237,0.18)', color: '#9D6BFF' }}
                >
                  {col.icon}
                </span>
                <p className="text-[10px] uppercase tracking-[0.15em] font-semibold" style={{ color: '#9D6BFF' }}>
                  {col.eyebrow}
                </p>
              </div>
              <h3 className="text-[18px] lg:text-[20px] font-semibold mb-5 leading-snug" style={{ color: 'var(--text)' }}>
                {col.tagline}
              </h3>
              <ul className="flex flex-col gap-2.5">
                {col.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                    <Check size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#10B981' }} strokeWidth={2.5} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* "What you'd otherwise pay" cost-stack card. Mirrors the bundle-math
            section on /pricing but tighter, and frames the savings vs. the
            cobbled-together stack a creator would normally need. */}
        <div
          className="rounded-2xl border p-7 lg:p-8 max-w-4xl mx-auto"
          style={{
            background: 'linear-gradient(180deg, rgba(124,58,237,0.04), rgba(124,58,237,0.01))',
            borderColor: 'rgba(124,58,237,0.30)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <p className="text-center text-[11px] uppercase tracking-[0.18em] font-semibold mb-5" style={{ color: '#9D6BFF' }}>
            What it would cost you to build this yourself
          </p>
          <ul className="flex flex-col gap-2.5 max-w-2xl mx-auto mb-7">
            {SITE_COST_STACK.map(([tool, price]) => (
              <li key={tool} className="flex items-baseline justify-between gap-3 border-b border-dashed pb-2" style={{ borderColor: 'var(--border)' }}>
                <span className="text-[13.5px]" style={{ color: 'var(--text-soft)' }}>{tool}</span>
                <span className="font-mono text-[12.5px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{price}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-center sm:text-left">
            <div>
              <p className="text-[12px] uppercase tracking-[0.15em] mb-1" style={{ color: 'var(--text-faint)' }}>
                Cobbled together
              </p>
              <p className="text-[24px] font-mono font-semibold" style={{ color: 'var(--text)' }}>
                ~$504<span className="text-[16px]" style={{ color: 'var(--text-faint)' }}>/yr</span>
                <span className="text-[14px] ml-2" style={{ color: 'var(--text-faint)' }}>+ a weekend</span>
              </p>
            </div>
            <span className="hidden sm:block text-[20px]" style={{ color: 'var(--text-faint)' }}>→</span>
            <div>
              <p className="text-[12px] uppercase tracking-[0.15em] mb-1" style={{ color: '#10B981' }}>
                With MVP
              </p>
              <p className="text-[28px] font-mono font-bold" style={{ color: '#10B981' }}>
                $0
                <span className="text-[14px] ml-2 font-sans font-normal" style={{ color: 'var(--text-faint)' }}>
                  / installed in 5 minutes
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Final emphasis line — drives home the "even trial users" angle. */}
        <p className="text-center text-[15px] mt-8 max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          The site is yours. On your domain. Forever. Even after you cancel,
          even if you only use the 5 free trial posts, you keep the WordPress
          install, the theme, the plugin, and every review you published.
        </p>
      </div>
    </section>
  )
}

/** Three-column feature stack for the WordPress site section. Each column
 *  is a logical bucket (theme / plugin / discovery) with 7-8 concrete
 *  features. Bullet copy intentionally specific (real shortcode names,
 *  real plugin behaviors) so the section reads as "this is built" not
 *  "this is roadmap." */
const SITE_FEATURE_COLUMNS = [
  {
    eyebrow: 'Editorial review theme',
    tagline: 'Designed for reviews. Not generic.',
    icon: <LayoutTemplate size={13} />,
    features: [
      'Hero + verdict box + pros / cons + comparison table layout',
      'Sticky table of contents on long reviews',
      'Sticky "Buy Now" bar on mobile (your highest-converting CTA)',
      'Reviewed-by credibility box with author photo and bio',
      'FTC-compliant affiliate disclosure banners auto-inserted',
      'Light and dark theme support, mobile-first responsive',
      'Topic hub pages auto-aggregate your reviews by category',
    ],
  },
  {
    eyebrow: 'Affiliate marketing plugin',
    tagline: 'Built-in monetization tooling.',
    icon: <BadgePercent size={13} />,
    features: [
      'Geniuslink affiliate-link wrapping (your tracking, your commissions)',
      'AI Product Finder chatbot embedded on every post',
      'Deal banner + countdown timer shortcodes',
      'Buying Guides shortcode + comparison-table shortcode',
      'Newsletter signup form (one shortcode, full form)',
      'Final-verdict Buy / Skip block at the end of every post',
      'No .htaccess editing, no API key juggling',
    ],
  },
  {
    eyebrow: 'SEO + automation',
    tagline: 'Discoverable the day it ships.',
    icon: <TrendingUp size={13} />,
    features: [
      'Schema.org Review markup for rich snippets in Google',
      'Auto-generated XML sitemap kept in sync as you publish',
      'Answer-first H2 leads tuned for AI search engines (AEO)',
      'Internal linking auto-generated across your full catalog',
      'Topic clustering for compounding SEO authority',
      'Theme + plugin auto-installed when you connect WordPress',
      'Works with Hostinger, SiteGround, Bluehost, Cloudways, WP Engine',
    ],
  },
] as const

/** What you'd otherwise be paying. Numbers are public pricing for the
 *  most common stack (Cuppa Pro / Schema Pro / Pretty Links Pro /
 *  TablePress Pro / OptinMonster basic / UpdraftPlus Premium). The
 *  list is the math behind the ~$504/yr total in the card. */
const SITE_COST_STACK: ReadonlyArray<readonly [string, string]> = [
  ['Affiliate review theme (Cuppa Pro, Newspaper, etc.)', '$59-$99 / yr'],
  ['Schema markup plugin (Schema Pro)', '$89 / yr'],
  ['Affiliate link manager (Pretty Links Pro)', '$99 / yr'],
  ['Comparison-table builder (TablePress Pro)', '$79 / yr'],
  ['Newsletter signup plugin (OptinMonster basic)', '$108 / yr'],
  ['Site backups + security (UpdraftPlus Premium)', '$70 / yr'],
  ['Your weekend setting it all up', 'priceless'],
]

/** Section 6 — Pricing.
 *
 *  Three monetized tiers shown side-by-side (Creator / Studio / Pro).
 *  Trial is positioned as the WAY IN (no-card banner above the cards),
 *  not as a fourth column — nobody chooses "trial" as a tier.
 *
 *  Studio is flagged as Most Popular per the audit (sits in the middle
 *  price point + unlocks the most-asked features: TikTok + Instagram +
 *  Scripts). Pro is the power tier (multi-site + IG AI thumbnails +
 *  face training + everything uncapped).
 *
 *  Prices + features mirror lib/tier.ts exactly so the page never drifts
 *  from the live system. The regularPrice strikethrough sells the
 *  founder-pricing window without making it feel like a permanent
 *  discount.
 */
function PricingSection() {
  return (
    <section id="pricing" className="px-6 lg:px-8 pt-12 pb-28 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-10">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <Sparkles size={10} />
            Pricing
          </span>
          <h2
            className="text-[40px] sm:text-[52px] font-semibold tracking-tight leading-[1.05] mb-5"
            style={{ color: 'var(--text)' }}
          >
            Start free.{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Scale when you&apos;re ready.
            </span>
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            Every plan includes the full Central Hub. Cancel anytime. Your WordPress site stays yours forever.
          </p>
        </div>

        {/* Trial banner — the no-card "way in" sits ABOVE the cards so it
            reads as "start here, then pick a tier when you're ready." */}
        <div
          className="rounded-2xl border p-5 mb-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6"
          style={{
            backgroundColor: 'rgba(16,185,129,0.06)',
            borderColor: 'rgba(16,185,129,0.25)',
          }}
        >
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #10B981, #059669)', color: '#FFFFFF' }}
          >
            <Sparkles size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text)' }}>
              Try MVP free. No card required.
            </p>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              Get 5 full posts on the house. Generate, publish, share, see if it fits your workflow before you pay a cent. No time limit on the trial.
            </p>
          </div>
          <a
            href="/signup"
            className="px-5 py-2.5 rounded-lg text-[13px] font-medium text-white whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}
          >
            Start free →
          </a>
        </div>

        {/* 3-tier grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
          {PRICING_TIERS.map(tier => (
            <PricingCard key={tier.name} tier={tier} />
          ))}
        </div>

        {/* Trust strip below the cards. */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px]" style={{ color: 'var(--text-soft)' }}>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Cancel anytime
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Switch plans up or down
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Your WordPress site stays yours forever
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Founder pricing locked for life
          </span>
        </div>
      </div>
    </section>
  )
}

interface PricingTier {
  name: string
  tagline: string
  price: number
  regularPrice: number
  highlight: boolean
  icon: React.ReactNode
  features: string[]
  cta: string
}

// Refreshed 2026-06-04 to match the new tier matrix (lib/tier.ts). This
// preview page is the headline sales deck; numbers MUST match /pricing.
// If you edit one, edit both (and update tier.ts if the change is real).
const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Creator',
    tagline: 'For one channel, one niche.',
    price: 49,
    regularPrice: 99,
    highlight: false,
    icon: <Sparkles size={16} />,
    features: [
      '20 posts / month (blog + thumbnail + metadata bundle)',
      '5 socials: LinkedIn, Bluesky, Pinterest, Facebook *, Threads *',
      '1 face + 1 LoRA retrain / month, 10 Photobooth headshots',
      '10 video scripts + shot-lists / month',
      'Newsletter taster: 500 subs, 1 broadcast / month',
      '5 brand-collab pitch emails / month',
      '200 assistant messages / month',
      '1 WordPress site',
    ],
    cta: 'Start as Creator',
  },
  {
    name: 'Studio',
    tagline: 'For creators who post everywhere.',
    price: 99,
    regularPrice: 199,
    highlight: true,
    icon: <Crown size={16} />,
    features: [
      '60 posts / month (blog + thumbnail + metadata bundle)',
      'Adds Instagram * + Telegram on top of Creator',
      'Deals Hub: 5 deal posts / month + Amazon CSV bulk import',
      'IG AI Thumbnails 4:5 (30 / month)',
      'Topic hubs + Refresh Images on published posts',
      '2 faces + 3 LoRA retrains / month, 15 Photobooth headshots',
      '30 video scripts, 15 brand pitches',
      'Newsletter: 5,000 subs, weekly + scheduling',
      '1,000 assistant messages / month',
      'Priority Discord support',
    ],
    cta: 'Go Studio',
  },
  {
    name: 'Pro',
    tagline: 'For operators running a portfolio.',
    price: 199,
    regularPrice: 499,
    highlight: false,
    icon: <Rocket size={16} />,
    features: [
      '200 posts / month + Comparisons + Buying Guides',
      'Adds Twitter / X + TikTok * (9 socials total)',
      'Rebuild-from-video on any legacy WP post',
      'Creator Campaigns (Amazon EPC scout, one-click publish)',
      'Up to 10 WordPress sites + 3 Virtual Assistant seats',
      'Multi-account social + one-click Publish All',
      '30 deal posts / month, 100 IG AI thumbs, 5 LoRA retrains',
      '150 video scripts, 100 brand pitches',
      'Newsletter: 10k subs, twice-weekly + A/B + segments',
      '5,000 assistant messages / month',
      'Priority generation queue + priority Discord support',
    ],
    cta: 'Go Pro',
  },
]

function PricingCard({ tier }: { tier: PricingTier }) {
  const highlight = tier.highlight
  return (
    <div className="relative">
      {highlight && (
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.15em] text-white z-10"
          style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}
        >
          Most popular
        </div>
      )}
      <div
        className={`rounded-2xl border p-6 h-full flex flex-col gap-5 transition-all duration-200 ${highlight ? 'lg:-translate-y-2' : 'hover:-translate-y-0.5'}`}
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: highlight ? 'rgba(124,58,237,0.5)' : 'var(--border)',
          boxShadow: highlight
            ? '0 8px 32px rgba(124,58,237,0.15), inset 0 1px 0 rgba(255,255,255,0.06)'
            : 'var(--card-shadow)',
        }}
      >
        {/* Header — icon + tier name + tagline. */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span
              className="inline-flex items-center justify-center w-7 h-7 rounded-lg"
              style={{
                background: 'linear-gradient(135deg, rgba(124,58,237,0.18), rgba(192,38,211,0.14))',
                color: '#C4B5FD',
                border: '1px solid rgba(124,58,237,0.25)',
              }}
            >
              {tier.icon}
            </span>
            <h3 className="text-[20px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
              {tier.name}
            </h3>
          </div>
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            {tier.tagline}
          </p>
        </div>

        {/* Price block. Regular price strikethrough on top, current price big. */}
        <div>
          <p className="text-[12px] line-through" style={{ color: 'var(--text-faint)' }}>
            ${tier.regularPrice}/month regular
          </p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[40px] font-semibold tracking-tight tabular-nums" style={{ color: 'var(--text)' }}>
              ${tier.price}
            </span>
            <span className="text-[14px]" style={{ color: 'var(--text-soft)' }}>
              /month
            </span>
          </div>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
            Founder pricing, locked for the life of your subscription.
          </p>
        </div>

        {/* Feature list. */}
        <ul className="flex flex-col gap-2.5 flex-1">
          {tier.features.map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <Check
                size={13}
                className="flex-shrink-0 mt-1"
                style={{ color: highlight ? '#9D6BFF' : 'var(--text-soft)' }}
              />
              <span className="text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {f}
              </span>
            </li>
          ))}
        </ul>

        {/* CTA. Carries the plan slug so the signup flow lands the user
            on the right checkout post-signup. */}
        <a
          href={`/signup?plan=${tier.name.toLowerCase()}`}
          className="w-full px-4 py-3 rounded-xl text-center text-[14px] font-semibold transition-all"
          style={{
            background: highlight
              ? 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)'
              : 'var(--surface-bright)',
            color: highlight ? '#FFFFFF' : 'var(--text)',
            boxShadow: highlight ? '0 4px 20px rgba(124,58,237,0.35)' : 'none',
            border: highlight ? 'none' : '1px solid var(--border)',
          }}
        >
          {tier.cta} →
        </a>
      </div>
    </div>
  )
}

/** Section 7 — Proof.
 *
 *  We don't have user testimonials yet, so this section grounds the
 *  promise in NUMBERS we can defend: the founder's $3M+/yr operation,
 *  the 4-min workflow, the 9 outputs per video, the fact-grounding
 *  guarantee. No fabricated quotes.
 *
 *  Below the stat row: a "Built for these niches" panel that names real
 *  categories MVP supports without naming individual customers.
 */
function ProofSection() {
  return (
    <section id="proof" className="px-6 lg:px-8 pt-12 pb-28 relative">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <TrendingUp size={10} />
            Numbers that matter
          </span>
          <h2
            className="text-[36px] sm:text-[44px] font-semibold tracking-tight leading-[1.1] mb-4"
            style={{ color: 'var(--text)' }}
          >
            Built by an operator. Run daily.
          </h2>
          <p
            className="text-[16px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            Every number on this page is something the founder uses MVP to do every week.
          </p>
        </div>

        {/* 4-up stat row. Each big number with a label. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {STATS.map(s => (
            <StatCard key={s.label} stat={s} />
          ))}
        </div>

      </div>
    </section>
  )
}

interface Stat {
  value: string
  label: string
  detail: string
}

const STATS: Stat[] = [
  { value: '$3M+', label: '/yr proven', detail: 'in affiliate sales by the founder' },
  { value: '4 min', label: 'average workflow', detail: 'video → 9 outputs' },
  { value: '9', label: 'outputs per video', detail: 'blog + thumb + 7 socials' },
  { value: '0', label: 'fabricated claims', detail: 'every output grounded in your video' },
]

function StatCard({ stat }: { stat: Stat }) {
  return (
    <div
      className="rounded-2xl border p-5 text-center"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <p
        className="text-[36px] sm:text-[42px] font-semibold tracking-tight tabular-nums leading-none"
        style={{
          background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        {stat.value}
      </p>
      <p className="text-[12px] uppercase tracking-[0.12em] mt-2 mb-1" style={{ color: 'var(--text)' }}>
        {stat.label}
      </p>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        {stat.detail}
      </p>
    </div>
  )
}

/** Section 8 — FAQ.
 *
 *  Six accordion items covering the top objections. Each opens with
 *  smooth height animation. Honest, specific answers — no
 *  legalese, no marketing fluff.
 *
 *  Topics chosen to address the strongest "but…" objections from the
 *  page so far:
 *    1. Trial mechanics (5 lifetime posts, no card)
 *    2. WordPress ownership (yours forever)
 *    3. Will it sound like me? (LEARN voice profile)
 *    4. Cancel + refund mechanics
 *    5. Fact-grounding guarantee
 *    6. Switching plans
 */
function FAQSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(0)
  return (
    <section id="faq" className="px-6 lg:px-8 pt-12 pb-28 relative">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            Questions you might be having
          </span>
          <h2
            className="text-[36px] sm:text-[44px] font-semibold tracking-tight leading-[1.1]"
            style={{ color: 'var(--text)' }}
          >
            Common questions.
          </h2>
        </div>

        <div className="flex flex-col gap-3">
          {FAQS.map((f, i) => (
            <FAQItem
              key={i}
              q={f.q}
              a={f.a}
              isOpen={openIdx === i}
              onToggle={() => setOpenIdx(openIdx === i ? null : i)}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

const FAQS = [
  {
    q: 'How does the free trial work?',
    a: 'You get 5 full posts on the house. No card required, no time limit. Generate, publish, share, see how it fits your workflow. If you decide MVP is for you, pick a plan (Creator, Studio, or Pro) and you keep going. If not, no charge, no follow-up emails. Your trial just sits there.',
  },
  {
    q: 'Do I need to host my own WordPress site?',
    a: 'Yes, and that\'s the whole point. MVP publishes to YOUR WordPress site on YOUR domain. We never host your content. You own everything you make, forever, even if you cancel. Most creators host on SiteGround, Hostinger, Bluehost, Cloudways, or WP Engine. Any of them work.',
  },
  {
    q: 'Will MVP-generated content actually sound like me?',
    a: 'Yes. MVP trains a voice profile on your channel: your phrasing, your hooks, your closers, your structure. Every blog post and social caption gets generated through that profile, not a generic AI persona. The longer you use it, the better the match. You can also tune the voice manually if you want it sharper, longer, or more conversational.',
  },
  {
    q: 'Can I cancel anytime? What happens to my content?',
    a: 'Yes, cancel from your billing page anytime. Your subscription runs through the end of the current period, then stops. Your content stays on your WordPress site forever (it\'s on YOUR domain, not ours). Nothing gets deleted. Your account stays open in read-only mode so you can come back later.',
  },
  {
    q: 'How do you guarantee MVP doesn\'t fabricate facts about my products?',
    a: 'Two layers. First: the generator pulls product specs directly from the product page you reviewed (Amazon, the brand site, wherever the buy link points). It uses those specs verbatim, no model "imagination." Second: every story / experience claim comes from your actual video transcript. If you didn\'t say it on camera, MVP doesn\'t put it in the post.',
  },
  {
    q: 'Can I switch plans up or down later?',
    a: 'Anytime. Upgrade and the difference is pro-rated and applied immediately. Downgrade and the new plan kicks in at the next billing cycle (you keep the higher plan\'s features until then). No "annual commitment" trap.',
  },
]

function FAQItem({ q, a, isOpen, onToggle }: { q: string; a: string; isOpen: boolean; onToggle: () => void }) {
  return (
    <div
      className="rounded-xl border overflow-hidden transition-colors"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: isOpen ? 'rgba(124,58,237,0.35)' : 'var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left"
      >
        <span className="text-[15px] font-medium leading-snug" style={{ color: 'var(--text)' }}>
          {q}
        </span>
        <span
          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-transform"
          style={{
            backgroundColor: isOpen ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.05)',
            color: isOpen ? '#9D6BFF' : 'var(--text-soft)',
          }}
        >
          {isOpen ? <Minus size={13} /> : <Plus size={13} />}
        </span>
      </button>
      {isOpen && (
        <div className="px-5 pb-4 -mt-1">
          <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            {a}
          </p>
        </div>
      )}
    </div>
  )
}

/** Section 9 — Final CTA.
 *
 *  Full-bleed dark/light closing panel that re-states the offer one
 *  more time before the scroll ends. Big headline, twin CTAs, and the
 *  same trust elements as the pricing section for consistency.
 *
 *  Background uses a soft radial gradient so the section reads as a
 *  visual "landing" rather than just another card.
 */
function FinalCTASection() {
  return (
    <section
      id="get-started"
      className="px-6 lg:px-8 pt-16 pb-24 relative overflow-hidden"
    >
      {/* Background: soft violet radial that fades out, matching the hub
          diagram's visual rhythm. Theme-aware via --bg + the overlay. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 30%, rgba(124,58,237,0.18), transparent 70%)',
        }}
        aria-hidden
      />

      <div className="max-w-4xl mx-auto text-center relative">
        <span
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-6"
          style={{
            backgroundColor: 'rgba(124,58,237,0.15)',
            color: '#C4B5FD',
            border: '1px solid rgba(124,58,237,0.30)',
          }}
        >
          Ready when you are
        </span>
        <h2
          className="text-[44px] sm:text-[60px] font-semibold tracking-tight leading-[1.02] mb-5"
          style={{ color: 'var(--text)' }}
        >
          Start your{' '}
          <span
            style={{
              background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Central Hub.
          </span>
        </h2>
        <p
          className="text-[17px] sm:text-[18px] leading-relaxed max-w-2xl mx-auto mb-8"
          style={{ color: 'var(--text-soft)' }}
        >
          Five free posts. No card. No time limit. See if MVP fits your workflow before you pay a cent.
        </p>

        {/* Twin CTAs — primary action + lower-friction demo link. */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-center mb-8">
          <a
            href="/signup"
            className="px-7 py-3.5 rounded-xl text-[15px] font-semibold text-white inline-flex items-center gap-2 transition-all hover:scale-[1.02]"
            style={{
              background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
              boxShadow: '0 8px 28px rgba(124,58,237,0.40)',
            }}
          >
            Start your free trial
            <ArrowRight size={16} />
          </a>
          <a
            href="#demo"
            className="px-5 py-3.5 rounded-xl text-[15px] inline-flex items-center gap-2 transition-colors"
            style={{
              backgroundColor: 'var(--surface-bright)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
            }}
          >
            <Play size={14} />
            Watch the 90-second intro
          </a>
        </div>

        {/* Trust strip — matches pricing section's strip for consistency. */}
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px]" style={{ color: 'var(--text-soft)' }}>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> No card required
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> 5 full posts free
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Cancel anytime
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={12} className="text-[#10B981]" /> Your WordPress site stays yours
          </span>
        </div>

        {/* Founder signature line — final reassurance. */}
        <p className="text-[12px] mt-10" style={{ color: 'var(--text-faint)' }}>
          Built by a creator who&apos;s done <span className="font-semibold" style={{ color: 'var(--text-soft)' }}>$3M+/yr</span> in affiliate sales. Made for creators who want the same.
        </p>
      </div>
    </section>
  )
}

/** Top nav — minimal: logo + sign in + theme toggle. Sticky so it stays
 *  accessible while scrolling. Will gain Pricing/Demo links when those
 *  sections exist further down the page. */
function Nav({ theme, onToggle }: { theme: 'dark' | 'light'; onToggle: () => void }) {
  return (
    <nav
      className="sticky top-0 z-20 backdrop-blur-md px-8 py-4 flex items-center justify-between relative"
      style={{
        backgroundColor: theme === 'dark' ? 'rgba(14,14,17,0.7)' : 'rgba(250,250,248,0.7)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <a href="/" className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#7C3AED] to-[#C026D3] flex items-center justify-center font-semibold text-white text-[14px]">M</span>
        <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text)' }}>
          MVP Affiliate
        </span>
      </a>
      {/* Anchor links — visible on lg+ so the long page stays skimmable.
          Each item points at a section id elsewhere on the page; smooth
          scroll is enabled globally via the `html { scroll-behavior:
          smooth }` rule near the top of LandingPreview. */}
      <div className="hidden lg:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
        {NAV_ANCHORS.map(a => (
          <a
            key={a.href}
            href={a.href}
            className="px-3 py-1.5 rounded-lg text-[13px] transition-colors hover:opacity-100"
            style={{ color: 'var(--text-soft)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-soft)')}
          >
            {a.label}
          </a>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className="p-2 rounded-lg transition-colors"
          style={{ color: 'var(--text-soft)' }}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <a
          href="/login"
          className="px-3 py-1.5 rounded-lg text-[13px] transition-colors"
          style={{ color: 'var(--text-soft)' }}
        >
          Sign in
        </a>
        <a
          href="/signup"
          className="px-3.5 py-1.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-[13px] font-medium text-white transition-colors"
        >
          Start free trial
        </a>
      </div>
    </nav>
  )
}

const NAV_ANCHORS = [
  { label: 'Roles', href: '#roles' },
  { label: 'Workflow', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

/** The hero — locked copy + animated hub diagram + CTAs. */
function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Background mesh gradient — same recipe as the dashboard preview's
          hero, scaled up. Opacity adapts to theme via var. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 'var(--hero-opacity)',
          background: `
            radial-gradient(50% 70% at 25% 25%, rgba(124,58,237,0.55), transparent 60%),
            radial-gradient(45% 65% at 80% 20%, rgba(192,38,211,0.45), transparent 65%),
            radial-gradient(70% 50% at 60% 100%, rgba(99,102,241,0.30), transparent 70%)
          `,
        }}
      />

      <div className="relative max-w-7xl mx-auto px-8 pt-20 pb-28 grid lg:grid-cols-[1fr_760px] gap-12 items-center">
        {/* ── Left: copy + CTAs ────────────────────────────────────── */}
        <div>
          {/* Pill */}
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] uppercase tracking-[0.16em] font-medium mb-4"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text-soft)',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
            For affiliate creators
          </div>

          {/* Trust strip — lifted to live above the headline. Establishes
              credibility BEFORE the bold value claim, so the headline
              lands on a primed visitor. */}
          <p className="mb-6 text-[12px] font-medium" style={{ color: 'var(--text-subtle)' }}>
            Built by a <span style={{ color: 'var(--text-muted)' }}>$3M/yr affiliate creator</span>. No card to start.
          </p>

          {/* Main + Secondary headlines */}
          <h1
            className="text-[52px] lg:text-[64px] font-semibold tracking-[-0.02em] leading-[1.02]"
            style={{ color: 'var(--text)' }}
          >
            Your Central<br />
            Content Hub.
          </h1>
          <p
            className="mt-4 text-[20px] font-medium tracking-tight"
            style={{ color: 'var(--text-muted)' }}
          >
            One Review. Every Output. One Hub.
          </p>

          {/* Sub */}
          <p
            className="mt-6 text-[16px] leading-relaxed max-w-xl"
            style={{ color: 'var(--text-soft)' }}
          >
            From one review video: a published blog post, a CTR-tested thumbnail, 9 social variants, a newsletter draft, and a full week of scheduled posts. In ten minutes. <span style={{ color: 'var(--text)' }}>Grounded in what you actually said.</span>
          </p>

          {/* CTAs — primary button + its supporting reassurance live as
              separate elements so the button stays readable and the
              "yours forever" promise sits clearly below both CTAs. */}
          <div className="mt-8">
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/signup"
                className="px-5 py-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-[14px] font-semibold text-white inline-flex items-center gap-2 transition-colors shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
              >
                Start your free trial
                <ArrowRight size={14} />
              </a>
              <a
                href="#demo"
                className="px-5 py-3 rounded-xl border text-[14px] font-medium inline-flex items-center gap-2 transition-colors"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                }}
              >
                <Play size={13} fill="currentColor" />
                Watch the 90-second intro
              </a>
            </div>
            <p className="mt-3 text-[12px] inline-flex items-center gap-1.5" style={{ color: 'var(--text-faint)' }}>
              <span className="w-1 h-1 rounded-full bg-[#10B981]" />
              Keep your WordPress site forever.
            </p>
          </div>
        </div>

        {/* ── Right: animated hub diagram ───────────────────────────── */}
        <HubDiagram />
      </div>
    </section>
  )
}

/** The hub diagram: SVG lines drawn between a central node and 8 spoke
 *  nodes, animated on page load (lines draw outward in sequence; spokes
 *  pop in once each line arrives; lines then breathe gently forever).
 *
 *  Layered:
 *    - SVG (z-0): lines + radial pulse rings under center
 *    - HTML (z-10): the 8 spoke nodes
 *    - HTML (z-20): the center video node, drawn last so it covers line
 *                   endpoints
 */
function HubDiagram() {
  return (
    <div className="relative w-full mx-auto" style={{ maxWidth: VIEW_W, height: VIEW_H }}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      >
        {/* Lines from center to each spoke. Drawn from a long dasharray
            offset down to 0 (the "drawing" effect). Each line gets a
            stagger via animation-delay; once drawn, pulse forever. */}
        {SPOKES.map((s, i) => {
          const { x, y } = spokePos(s.angle)
          const drawDelay = 0.2 + i * 0.08
          const pulseDelay = drawDelay + 0.4
          return (
            <line
              key={i}
              x1={CX}
              y1={CY}
              x2={x}
              y2={y}
              stroke="var(--line-color)"
              strokeWidth="1.5"
              strokeLinecap="round"
              style={{
                strokeDasharray: 320,
                strokeDashoffset: 320,
                animation: `
                  mvp-line-draw 0.45s ease-out ${drawDelay}s forwards,
                  mvp-line-pulse 3s ease-in-out ${pulseDelay}s infinite
                `,
                filter: 'drop-shadow(0 0 4px var(--line-glow))',
              }}
            />
          )
        })}

        {/* Subtle expanding rings under the center node — adds "energy
            radiating from the source" feeling without being loud. */}
        <circle cx={CX} cy={CY} r={50} fill="rgba(124,58,237,0.12)" style={{ animation: 'mvp-ring-pulse 4s ease-out infinite' }} />
        <circle cx={CX} cy={CY} r={50} fill="rgba(124,58,237,0.08)" style={{ animation: 'mvp-ring-pulse 4s ease-out 2s infinite' }} />
      </svg>

      {/* Spoke nodes, positioned absolutely at the calculated coords.
          Fade in after their connecting line completes drawing. */}
      {SPOKES.map((s, i) => {
        const { x, y } = spokePos(s.angle)
        const fadeDelay = 0.2 + i * 0.08 + 0.5
        return (
          <div
            key={i}
            className="absolute"
            style={{
              left: x,
              top: y,
              opacity: 0,
              animation: `mvp-spoke-in 0.4s ease-out ${fadeDelay}s forwards`,
            }}
          >
            <SpokeNode icon={s.icon} label={s.label} />
          </div>
        )
      })}

      {/* Center node — the "Your review video" card. Drawn last (highest
          z) so it sits cleanly on top of the line endpoints. */}
      <div
        className="absolute"
        style={{
          left: CX,
          top: CY,
          opacity: 0,
          animation: 'mvp-center-in 0.5s ease-out forwards',
        }}
      >
        <CenterNode />
      </div>
    </div>
  )
}

function CenterNode() {
  return (
    <div
      className="rounded-2xl px-5 py-4 flex items-center gap-3 text-white"
      style={{
        background: 'var(--center-bg)',
        boxShadow: '0 12px 32px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
        minWidth: 220,
      }}
    >
      <div className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center backdrop-blur-sm">
        <Play size={16} fill="currentColor" className="ml-0.5" />
      </div>
      <div className="flex-1">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium opacity-75">Your video</p>
        <p className="text-[13px] font-semibold leading-tight mt-0.5">YouTube review</p>
      </div>
    </div>
  )
}

function SpokeNode({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div
      className="rounded-xl px-3 py-2 border text-[12px] font-medium flex items-center gap-2 whitespace-nowrap"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        color: 'var(--text)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <span className="text-[#7C3AED]">{icon}</span>
      {label}
    </div>
  )
}

/** Platform bar — slim strip directly under the hero that names every
 *  platform MVP publishes to. Reinforces the breadth promise of the hub
 *  diagram with concrete platform names, and bonus: helps SEO
 *  discoverability for "WordPress + TikTok + Instagram + ..." searches.
 *
 *  Visual: monochrome icons + names laid out horizontally, separated by
 *  thin dividers. Theme-aware via var(--text-faint). Wraps on mobile.
 */
function PlatformBar() {
  return (
    <section className="px-6 lg:px-8 pt-2 pb-12 relative">
      <div className="max-w-5xl mx-auto">
        <p
          className="text-[10px] uppercase tracking-[0.18em] text-center mb-4"
          style={{ color: 'var(--text-faint)' }}
        >
          Publishes natively to
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
          {PLATFORMS.map((p, i) => (
            <span key={p.name} className="inline-flex items-center gap-3">
              <span
                className="inline-flex items-center gap-2 text-[13px]"
                style={{ color: 'var(--text-soft)' }}
              >
                <span style={{ color: 'var(--text-muted)' }}>{p.icon}</span>
                {p.name}
              </span>
              {i < PLATFORMS.length - 1 && (
                <span className="hidden sm:inline" style={{ color: 'var(--text-faint)' }}>·</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

const PLATFORMS = [
  { name: 'WordPress', icon: <Globe size={14} /> },
  { name: 'TikTok', icon: <Music2 size={14} /> },
  { name: 'Instagram', icon: <Instagram size={14} /> },
  { name: 'Pinterest', icon: <Bookmark size={14} /> },
  { name: 'X', icon: <Twitter size={14} /> },
  { name: 'Threads', icon: <AtSign size={14} /> },
  { name: 'Bluesky', icon: <Cloud size={14} /> },
  { name: 'Telegram', icon: <Send size={14} /> },
  { name: 'Facebook', icon: <Facebook size={14} /> },
]

/** Before/After visual — sits between Workflow (Section 4) and Grounded
 *  (Section 5). Sells the "one subscription replaces a tool stack" pitch
 *  viscerally: a chaotic grid of generic tool boxes on the left, the
 *  single MVP hub on the right, an arrow between.
 *
 *  Why no competitor names: the user has flagged repeatedly never to
 *  name competitors (vidIQ, Tubebuddy, etc.) in user-facing copy. So
 *  the "before" side uses generic role labels (Writing tool, Scheduler,
 *  Designer, Publisher, etc.) instead — readers fill in their own
 *  current stack.
 */
function BeforeAfterSection() {
  return (
    <section id="stack" className="px-6 lg:px-8 pt-12 pb-28 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-[0.18em] mb-5"
            style={{
              backgroundColor: 'rgba(124,58,237,0.12)',
              color: '#9D6BFF',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <Sparkles size={10} />
            One subscription replaces your stack
          </span>
          <h2
            className="text-[40px] sm:text-[52px] font-semibold tracking-tight leading-[1.05] mb-5"
            style={{ color: 'var(--text)' }}
          >
            Five tools and a tab tangle.{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Or one hub.
            </span>
          </h2>
          <p
            className="text-[16px] sm:text-[17px] leading-relaxed max-w-2xl mx-auto"
            style={{ color: 'var(--text-soft)' }}
          >
            Stop paying for eight different subscriptions and stitching them together by hand.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] items-stretch gap-6 lg:gap-4">
          {/* BEFORE column — chaotic grid of greyed-out tool boxes. */}
          <div
            className="rounded-2xl border p-6 sm:p-7 relative"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <p className="text-[11px] uppercase tracking-[0.15em] mb-5" style={{ color: 'var(--text-faint)' }}>
              The old way
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {OLD_STACK.map(t => (
                <div
                  key={t}
                  className="rounded-lg border px-3 py-2.5 text-[12px] text-center relative overflow-hidden"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.02)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-subtle)',
                  }}
                >
                  <span className="line-through opacity-80">{t}</span>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[12px] leading-relaxed" style={{ color: 'var(--text-subtle)' }}>
              Eight subscriptions. Eight tabs open. Copy-paste between them. Reformat for every platform. Forget what was where.
            </p>
            <p className="mt-3 text-[13px] font-semibold" style={{ color: 'var(--text-subtle)' }}>
              $500+/mo · hours per video
            </p>
          </div>

          {/* Arrow — horizontal on desktop, vertical on mobile/tablet. */}
          <div className="hidden lg:flex items-center justify-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #7C3AED, #C026D3)',
                boxShadow: '0 6px 20px rgba(124,58,237,0.35)',
              }}
            >
              <ArrowRight size={20} className="text-white" />
            </div>
          </div>
          <div className="lg:hidden flex items-center justify-center -my-2">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center rotate-90"
              style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}
            >
              <ArrowRight size={18} className="text-white" />
            </div>
          </div>

          {/* AFTER column — single MVP hub with a violet glow. */}
          <div
            className="rounded-2xl border p-6 sm:p-7 relative overflow-hidden"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'rgba(124,58,237,0.40)',
              boxShadow: '0 8px 32px rgba(124,58,237,0.15), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <p className="text-[11px] uppercase tracking-[0.15em] mb-5" style={{ color: '#9D6BFF' }}>
              The MVP way
            </p>
            <div
              className="rounded-xl p-5 flex items-center gap-4 mb-4"
              style={{
                background: 'linear-gradient(135deg, rgba(124,58,237,0.18), rgba(192,38,211,0.14))',
                border: '1px solid rgba(124,58,237,0.30)',
              }}
            >
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}
              >
                <Sparkles size={22} className="text-white" />
              </div>
              <div>
                <p className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                  MVP Central Hub
                </p>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-soft)' }}>
                  Every role. One workflow.
                </p>
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {NEW_BENEFITS.map(b => (
                <li key={b} className="flex items-start gap-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  <Check size={12} className="flex-shrink-0 mt-1 text-[#9D6BFF]" />
                  {b}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              From <span style={{ color: '#9D6BFF' }}>$49/mo</span> · 4 minutes per video
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

const OLD_STACK = [
  'Writing tool',
  'Image / thumbnail tool',
  'Newsletter platform',
  'Social scheduler',
  'WordPress plugin',
  'SEO add-on',
  'Comparison generator',
  'Brand kit tool',
]

const NEW_BENEFITS = [
  'One subscription instead of eight.',
  'Every output ready in minutes, not hours.',
  'No copy-paste between platforms.',
  'Same voice across blog, email, and social.',
]

/** Footer — closes the page with a clean lockup of navigation, legal,
 *  and social links. Required before this preview can replace the live
 *  root landing.
 *
 *  Layout: 4-column desktop (Product / Resources / Company / Legal),
 *  collapsing to 2 columns on tablet and 1 column on mobile. Brand
 *  lockup + tagline sit on top spanning the full width.
 *
 *  All links are placeholders pointing at expected routes — the user
 *  can adjust each href once the actual destinations exist.
 */
function Footer() {
  return (
    <footer
      className="px-6 lg:px-8 pt-16 pb-10 mt-12 border-t"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="max-w-6xl mx-auto">
        {/* Brand row */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 pb-10 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg"
                style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}
              >
                <Sparkles size={14} className="text-white" />
              </span>
              <span className="text-[16px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                MVP Affiliate
              </span>
            </div>
            <p className="text-[13px] max-w-md leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              Your central content hub. One review video, every output, your voice — grounded in what you actually said.
            </p>
          </div>
          <a
            href="/signup"
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-white whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}
          >
            Start free →
          </a>
        </div>

        {/* Link columns */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 py-10">
          <FooterCol
            title="Product"
            links={[
              { label: 'Roles', href: '#roles' },
              { label: 'Workflow', href: '#how-it-works' },
              { label: 'Pricing', href: '#pricing' },
              { label: 'FAQ', href: '#faq' },
              { label: 'Watch intro', href: '#demo' },
            ]}
          />
          <FooterCol
            title="Resources"
            links={[
              { label: 'WordPress setup', href: '/setup' },
              { label: 'Connection Doctor', href: '/setup/wp-doctor' },
              { label: 'Help center', href: '/help' },
              { label: 'Blog', href: '/blog' },
            ]}
          />
          <FooterCol
            title="Company"
            links={[
              { label: 'About', href: '/about' },
              { label: 'Contact', href: '/contact' },
              { label: 'Affiliates', href: '/affiliates' },
            ]}
          />
          <FooterCol
            title="Legal"
            links={[
              { label: 'Privacy', href: '/privacy' },
              { label: 'Terms', href: '/terms' },
              { label: 'Cookie policy', href: '/cookies' },
            ]}
          />
        </div>

        {/* Bottom strip — copyright + small print */}
        <div className="pt-8 border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            © {new Date().getFullYear()} MVP Affiliate. All rights reserved. Built by a creator, for creators.
          </p>
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Your WordPress site stays yours, forever.
          </p>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.15em] mb-4 font-semibold" style={{ color: 'var(--text)' }}>
        {title}
      </p>
      <ul className="flex flex-col gap-2.5">
        {links.map(l => (
          <li key={l.href}>
            <a
              href={l.href}
              className="text-[13px] transition-colors"
              style={{ color: 'var(--text-soft)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-soft)')}
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Sticky bottom CTA bar — slim chrome that fades in after the user
 *  scrolls past the hero. Always-visible "Start free trial" while they
 *  read the rest of the page. Dismissible per-session via localStorage
 *  so we don't nag users who've already declined once.
 *
 *  Why session-scoped (not permanent): a user who dismisses on Monday
 *  and comes back Friday is a different context. Re-show.
 *
 *  Why fade-in instead of always-on: doesn't compete with the hero CTAs
 *  while the user is still in the "what is this?" mode. Once they've
 *  scrolled past the hero, the bar reinforces the offer without being
 *  in the way.
 */
function StickyBottomBar() {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Hide on first paint if user dismissed in this session.
    if (sessionStorage.getItem('mvp-landing-cta-dismissed') === '1') {
      setDismissed(true)
      return
    }
    const onScroll = () => {
      // Show once scrolled past ~80% of the viewport height (past hero
      // on most screens). Hide when back near top.
      const trigger = window.innerHeight * 0.8
      setVisible(window.scrollY > trigger)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (dismissed) return null

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30 transition-transform duration-300 pointer-events-none"
      style={{
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
      }}
    >
      <div
        className="mx-auto max-w-4xl m-4 rounded-2xl backdrop-blur-md border px-4 py-3 flex items-center gap-3 pointer-events-auto"
        style={{
          // Slightly translucent so the page peeks through and the bar
          // doesn't feel like a hard popup.
          backgroundColor: 'rgba(14,14,17,0.85)',
          borderColor: 'rgba(124,58,237,0.30)',
          boxShadow: '0 10px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(124,58,237,0.10)',
        }}
      >
        <span
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}
        >
          <Sparkles size={14} className="text-white" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium leading-tight" style={{ color: '#F5F5F7' }}>
            Try MVP free — 5 posts, no card.
          </p>
          <p className="text-[11px] hidden sm:block" style={{ color: 'rgba(255,255,255,0.55)' }}>
            See if it fits your workflow before you pay a cent.
          </p>
        </div>
        <a
          href="/signup"
          className="px-3.5 py-2 rounded-lg text-[12px] font-semibold text-white whitespace-nowrap inline-flex items-center gap-1.5"
          style={{ background: 'linear-gradient(135deg, #7C3AED, #C026D3)' }}
        >
          Start free
          <ArrowRight size={12} />
        </a>
        <button
          onClick={() => {
            sessionStorage.setItem('mvp-landing-cta-dismissed', '1')
            setDismissed(true)
          }}
          className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors hover:bg-white/10"
          style={{ color: 'rgba(255,255,255,0.55)' }}
          aria-label="Dismiss CTA"
        >
          <XIcon size={13} />
        </button>
      </div>
    </div>
  )
}
