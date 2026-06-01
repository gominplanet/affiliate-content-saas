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
 *  positioned spoke nodes share the same geometry. */
const CX = 360
const CY = 260
const RADIUS = 220

interface Spoke {
  /** Angle in degrees, 0 = right, 90 = down, -90 = up. */
  angle: number
  label: string
  icon: React.ReactNode
}

const SPOKES: Spoke[] = [
  { angle: -90, label: 'Blog post',       icon: <FileText size={13} /> },
  { angle: -45, label: 'Thumbnail',       icon: <ImageIcon size={13} /> },
  { angle:   0, label: 'TikTok',          icon: <Music2 size={13} /> },
  { angle:  45, label: 'Instagram Reel',  icon: <Instagram size={13} /> },
  { angle:  90, label: 'Pinterest pin',   icon: <Bookmark size={13} /> },
  { angle: 135, label: 'Newsletter',      icon: <Mail size={13} /> },
  { angle: 180, label: 'Comparison post', icon: <Scale size={13} /> },
  { angle: 225, label: 'Scheduled queue', icon: <Calendar size={13} /> },
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
      `}</style>

      <Nav theme={theme} onToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <Hero />

      {/* Placeholder for sections 2–9. Looks like a banner so when you
          scroll past the hero the page doesn't feel suspiciously short. */}
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
            Sections 2 – 9 coming next
          </p>
          <p className="text-[15px] max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            We&apos;re locking each section&apos;s copy in chat before building. Section 2 is &ldquo;The roles MVP plays&rdquo; (planner / scheduler / collaborator / script writer / social generator / WordPress publisher / SEO optimizer / thumbnail studio). After you approve it, I&apos;ll extend this page.
          </p>
        </div>
      </section>
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

      <div className="relative max-w-7xl mx-auto px-8 pt-20 pb-28 grid lg:grid-cols-[1fr_720px] gap-12 items-center">
        {/* ── Left: copy + CTAs ────────────────────────────────────── */}
        <div>
          {/* Pill */}
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] uppercase tracking-[0.16em] font-medium mb-6"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text-soft)',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
            For affiliate creators
          </div>

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

          {/* CTAs */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="/signup"
              className="px-5 py-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-[14px] font-semibold text-white inline-flex items-center gap-2 transition-colors shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
            >
              Start your free trial — keep your WordPress site forever
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

          {/* Trust strip */}
          <p className="mt-6 text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Built by a $3M/yr affiliate creator. No card to start.
          </p>
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
    <div className="relative w-full max-w-[720px] mx-auto" style={{ height: 520 }}>
      <svg
        viewBox="0 0 720 520"
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
