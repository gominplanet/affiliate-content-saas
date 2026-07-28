// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Interactive client islands for the public landing page (app/page.tsx).
// The landing page itself is a Server Component (all static marketing markup
// renders to HTML with no client JS); only these three small pieces need
// state/effects, so they live here as 'use client' leaves and are imported
// back in. Keeps the ~3k-line page from shipping as one giant client bundle.

'use client'

import { useState, useEffect } from 'react'
import { Play, X as XIcon, Plus, Minus, Sparkles, ArrowRight } from 'lucide-react'

/** Intro video section — large centered video frame with a clickable
 *  play overlay. Click opens a fullscreen modal lightbox that plays the
 *  founder's YouTube intro (id YT_DEMO_ID) via an embedded iframe. The
 *  poster shows the real YouTube thumbnail; the embed only mounts on click
 *  (no third-party iframe/cookies on scroll-by). Swapped from a self-hosted
 *  /demo/mvp-90s.mp4 to YouTube 2026-06-30. NOTE: section id stays "demo"
 *  to keep all #demo anchor links stable.
 *
 *  The play button has a gentle breathing pulse so it reads as "alive
 *  and clickable" from any distance on the page.
 *
 *  Modal close behaviors: ESC key, X button top-right, click anywhere
 *  outside the video frame. Body scroll is locked while the modal is
 *  open so the page doesn't jitter when the lightbox renders. */
export function DemoVideoSection() {
  const [open, setOpen] = useState(false)
  // Sales-page intro = the founder's YouTube upload. Click-to-play: a
  // self-hosted poster (/demo/intro-poster.jpg — pixel-perfect + instant, no YT
  // CDN dependency) and the YouTube embed only mounts on click, so no
  // third-party iframe/cookies load on scroll-by traffic.
  const YT_DEMO_ID = 'E5EEfQcZQts'

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
    <section id="demo" className="px-6 lg:px-8 pb-16 sm:pb-24 -mt-8 relative">
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
          aria-label="Play the introduction video"
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
              style={{ backgroundImage: 'url(/demo/intro-poster.jpg)' }}
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

            {/* Bottom-right: source pill — signals "this is a video", no fake
                duration (the YouTube upload length isn't hardcoded here). */}
            <div
              className="absolute bottom-4 right-4 px-2 py-1 rounded text-[11px] font-medium text-white/85 backdrop-blur-sm"
              style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
            >
              Watch
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
          The story behind MVP — what it does, and what you get free when you start.
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
            <div className="relative w-full aspect-video rounded-2xl overflow-hidden shadow-2xl bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${YT_DEMO_ID}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
                title="MVP Affiliate — introduction"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
                style={{ border: 0 }}
              />
            </div>
          </div>
        </div>
      )}
    </section>
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
export function FAQSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(0)
  return (
    <section id="faq" className="px-6 lg:px-8 pt-12 pb-16 sm:pb-28 relative">
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
  {
    q: 'Will my content actually rank — and how long does it take?',
    a: 'SEO is a slow game, and anyone promising overnight rankings is selling you something. What MVP gives you is the foundation ranking depends on: answer-first structure, Product / Review / FAQ schema, fast indexing, internal links, and content genuinely grounded in your real review (which Google\'s helpful-content system rewards). Low-competition terms can move in a few weeks; competitive terms take months and consistent volume — and MVP is what makes publishing that volume realistic.',
  },
  {
    q: 'Will my reviews show up in AI search — ChatGPT, Perplexity, Google\'s AI answers?',
    a: 'That\'s exactly what MVP is built for. AI engines quote sources they can parse and trust: the answer up top, schema they can read, and real specs and experience they can verify. MVP writes every review that way. No tool can guarantee a specific engine cites you, but content built to be citable is how you show up — and it\'s the opposite of the generic AI filler those engines are learning to skip.',
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
export function StickyBottomBar() {
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
