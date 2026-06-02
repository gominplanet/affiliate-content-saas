/**
 * /landing-preview — public-facing sales page mockup.
 *
 * Section 1 (Hero) is the only section built so far — we're locking
 * remaining sections in chat before extending. The full page will replace
 * the live root landing at app/page.tsx once approved.
 *
 * Sits outside /preview/* so it doesn't inherit the dashboard preview's
 * sidebar/topbar layout. Uses the same CSS-variable theme system so the
 * sun/moon toggle works identically.
 */
'use client'

import { useState, useEffect } from 'react'
import {
  FileText, Image as ImageIcon, Music2, Instagram, Mail, Scale, Calendar,
  Play, Sun, Moon, Sparkles, ArrowRight, Bookmark,
  Twitter, AtSign, Cloud, Send, Facebook,
  Compass, HeartHandshake, PenLine, Share2, Globe, TrendingUp, Wand2,
  Youtube, ShieldCheck, Zap, Upload, X as XIcon, Check, Quote,
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
      <DemoVideoSection />
      <RolesSection />
      <WorkflowSection />
      <GroundedSection />

      {/* Placeholder for sections 6–9. */}
      <section className="px-8 py-24 max-w-5xl mx-auto text-center">
        <div
          className="rounded-2xl border px-8 py-12"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <Sparkles size={20} className="mx-auto mb-3 text-[#7C3AED]" />
          <p className="text-[13px] uppercase tracking-[0.18em] mb-3" style={{ color: 'var(--text-faint)' }}>
            Sections 6 – 9 coming next
          </p>
          <p className="text-[15px] max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            Sections 1–5 locked. Next: pricing → social proof → FAQ → final CTA.
          </p>
        </div>
      </section>
    </div>
  )
}

/** Demo video section — large centered video frame with a clickable play
 *  overlay. Currently a CSS-styled placeholder (gradient backdrop + mock
 *  dashboard hint + play button); swap the inner content for a real video
 *  poster image / embed when the demo is recorded. The play button has a
 *  gentle breathing pulse so it reads as "alive and clickable" from any
 *  distance on the page. */
function DemoVideoSection() {
  return (
    <section id="demo" className="px-6 lg:px-8 pb-24 -mt-8 relative">
      <div className="max-w-5xl mx-auto">
        {/* Section eyebrow + heading */}
        <div className="text-center mb-8">
          <p
            className="text-[11px] uppercase tracking-[0.18em] font-medium mb-3"
            style={{ color: 'var(--text-faint)' }}
          >
            See it in motion
          </p>
          <h2
            className="text-[28px] lg:text-[36px] font-semibold tracking-tight leading-tight max-w-2xl mx-auto"
            style={{ color: 'var(--text)' }}
          >
            One review video.{' '}
            <span style={{ color: 'var(--text-soft)' }}>Nine outputs.</span>{' '}
            <span style={{ color: 'var(--text-soft)' }}>Ten minutes.</span>
          </h2>
        </div>

        {/* The video frame. Wrapper provides the violet outer glow + soft
            shadow. Inner div is what the visitor clicks. */}
        <div
          className="relative rounded-2xl overflow-hidden cursor-pointer group transition-transform duration-200 hover:scale-[1.005]"
          style={{
            boxShadow: '0 24px 80px -16px rgba(124,58,237,0.35), 0 8px 24px rgba(0,0,0,0.15), 0 0 0 1px var(--border)',
          }}
          onClick={() => {
            // Hook up to a real video modal or YouTube embed here.
            // For now, the click is just a visual indicator.
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

            {/* Mock dashboard preview hint — three subtle rectangular
                "cards" that imply "this is the actual MVP interface" without
                trying to fake a screenshot. */}
            <div className="absolute inset-x-12 top-12 bottom-20 grid grid-cols-3 gap-3 opacity-30">
              <div className="rounded-lg border border-white/10 bg-white/[0.04]" />
              <div className="rounded-lg border border-white/10 bg-white/[0.04]" />
              <div className="rounded-lg border border-white/10 bg-white/[0.04]" />
            </div>

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
                  aria-label="Play demo video"
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
          90 seconds. No talking head. Just the workflow: drop a YouTube URL → MVP turns it into 9 platforms → click publish.
        </p>
      </div>
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
            Plans, writes, schedules, optimizes, publishes — so you focus on what only you can do.
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
    line: 'Your AI partner — trained on your voice. Always ready to think with you.',
  },
  {
    icon: <PenLine size={18} />,
    label: 'Script writer',
    line: 'Long-form video scripts in your voice. From idea to teleprompter in minutes.',
  },
  {
    icon: <Share2 size={18} />,
    label: 'Social generator',
    line: 'Nine social platforms. Each post written native to that one — no copy-paste.',
  },
  {
    icon: <Globe size={18} />,
    label: 'WordPress publisher',
    line: 'Publish straight to your WordPress. Pro: up to 5 sites from one account.',
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
            From video to nine outputs — fact-grounded and in your voice.
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
    body: 'MVP already has your YouTube channel synced — transcript, product, gallery, and timestamps are pre-loaded. No URLs to paste. No copy-paste.',
  },
  {
    icon: <ShieldCheck size={18} />,
    title: 'It grounds everything in real facts.',
    body: 'No invented features. No fabricated stories. Just what you actually said in the video — pulled straight from the transcript and the scraped product data.',
  },
  {
    icon: <Sparkles size={18} />,
    title: 'Generate 9 outputs in one click.',
    body: 'Blog post, comparison, thumbnail, newsletter, plus 6 native social posts — all in your voice, all in about four minutes.',
  },
  {
    icon: <Upload size={18} />,
    title: 'Publish or schedule.',
    body: 'Hit your WordPress site, the social queue, or the calendar — your call. Everything you make stays yours, on your domain, forever.',
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
            If MVP can&apos;t prove it from your transcript or the product page — MVP doesn&apos;t say it.
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
            — Built by a creator who&apos;s done{' '}
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
    mvpWay: 'Trained on your channel — your phrasing, your hooks.',
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

/** Top nav — minimal: logo + sign in + theme toggle. Sticky so it stays
 *  accessible while scrolling. Will gain Pricing/Demo links when those
 *  sections exist further down the page. */
function Nav({ theme, onToggle }: { theme: 'dark' | 'light'; onToggle: () => void }) {
  return (
    <nav
      className="sticky top-0 z-20 backdrop-blur-md px-8 py-4 flex items-center justify-between"
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
                Watch the 90-second demo
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
