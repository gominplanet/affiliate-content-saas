'use client'

/**
 * WhatsNewCard — a "What's new" changelog for EXISTING users. Renders as a small
 * pill ("✨ What's new · N"); clicking it opens a centered MODAL with the full
 * changelog, so it never pushes the page around. On a new release the modal
 * auto-opens once; after that it stays as the pill until clicked.
 *
 * To publish a new batch: bump RELEASE_ID and replace UPDATES. The new RELEASE_ID
 * auto-opens the modal once more for everyone. "Seen" is stored per-release in
 * localStorage.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Sparkles, ArrowUpRight, X } from 'lucide-react'

// Bump this whenever UPDATES changes — auto-opens the modal once for everyone.
const RELEASE_ID = '2026-10-14-5'
const STORAGE_KEY = 'mvp_whats_new_seen'

interface Update {
  badge: string
  tone: string // accent color for the badge chip
  title: string
  desc: string
  href?: string
}

const UPDATES: Update[] = [
  // TRYBE, the fifth release of the day (Seb, 2026-10-14: from six TRYBE
  // strategy videos, "build 1, 2, 3, and 4"). Newest first.
  {
    badge: 'NEW',
    tone: '#16A34A',
    title: 'TRYBE retainers: when to ask, the ask, and the deal',
    desc: 'My brands shows the brands ready for a retainer (25+ videos in 30 days, 10+ approved, and a payout), drafts the ask from your real numbers for you to send, and tracks the deal once they say yes: videos due, days left and the top up.',
    href: '/trybe?tab=brands',
  },
  {
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'What each video needs: the hook or the body',
    desc: 'Your best videos now read hook rate against click rate: a hook that stops the wrong people, a good body behind a weak hook, or a winner. Plus a remix to try: the hook of one video with the body of another.',
    href: '/trybe?tab=brands',
  },
  {
    badge: 'IMPROVED',
    tone: '#B45309',
    title: 'Sample guard and rate lock watch',
    desc: 'Before you ask for more samples, MVP tells you how many are waiting to be filmed. And when a brand changes its pay while your videos are in review, My brands lists them with a friendly nudge to send.',
    href: '/trybe?tab=week',
  },
  // TRYBE, the fourth release of the day (Seb, 2026-10-14: Huntr's five and
  // Keighly Hart's four). Newest first.
  {
    badge: 'NEW',
    tone: '#16A34A',
    title: 'TRYBE: ready made lists and how fast brands decide',
    desc: 'Find brands has one tap lists: Untapped, New this week, Big spenders, Fast deciders and Pays $25+ a video. Each brand now shows a verdict (Strong pick, Worth a look, Skip) and how fast it approves or rejects videos, from MVP members\u2019 own results.',
    href: '/trybe?tab=find',
  },
  {
    badge: 'NEW',
    tone: '#EA580C',
    title: 'The best new brands, and the hooks winning on TRYBE',
    desc: 'What changed opens with the best new brands on TRYBE, ranked for you, and the Today list tells you when new ones land. Make videos shows the opening lines of this week\u2019s Top 100 videos, and every video plan learns from them.',
    href: '/trybe?tab=changes',
  },
  {
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'Road to 500 and your monthly video goal',
    desc: 'Your stage now shows how many videos you have sent on the road to 500. This week has a monthly goal (250 to start, change it any time) with the weekly pace that reaches it.',
    href: '/trybe?tab=week',
  },
  {
    badge: 'IMPROVED',
    tone: '#B45309',
    title: 'Move on when a video does not run, and keep a mix',
    desc: 'Your ads, live now points out brands whose videos got no ad results, so you move to a new angle or the next brand. MVP keeps a mix of small and big brands in every batch it finds, and Find brands shows your mix.',
    href: '/trybe?tab=brands',
  },
  // TRYBE, the third release of the day (Seb, 2026-10-14, after Rob's Oink
  // Suite video: "build all 4"). Newest first.
  {
    badge: 'NEW',
    tone: '#16A34A',
    title: 'TRYBE: what a video pays, before you ask',
    desc: 'Every brand in Find brands now shows what an approved video pays: from your own results with it, MVP members\u2019 results, or its flat fee and guaranteed retainer. A % of sales or of ad spend is said as such, never guessed. Press how? to see the math. Two new pay filters: % of ad spend and Guaranteed.',
    href: '/trybe?tab=find',
  },
  {
    badge: 'NEW',
    tone: '#B45309',
    title: 'OPEN, FILLING or CROWDED',
    desc: 'One word on each brand says whether you would be early or one of hundreds: its creators, how many joined, and its videos over the last 30 days. Open only shows the brands with room for you.',
    href: '/trybe?tab=find',
  },
  {
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'Your ads, live',
    desc: 'My brands now opens with what your videos do as ads on TRYBE: earned, live ads, impressions, link clicks, hook rate, click rate and watch time, for 7, 14 or 30 days, plus your best videos. Brands winning on ads count as your winners to double down on. Needs SCOUT 1.47.0, which Chrome installs by itself. On the Pro plan.',
    href: '/trybe?tab=brands',
  },
  {
    badge: 'IMPROVED',
    tone: '#0B1B38',
    title: 'NEW brands, and statics',
    desc: 'Brands new on TRYBE carry a NEW badge. Your priorities now asks what you make (videos, videos and statics, or mostly statics), and brands that take statics say so.',
    href: '/trybe?tab=find',
  },
  // TRYBE, the second release of the day (Seb, 2026-10-14: "update the
  // what's new"). Newest first; the first release's items follow.
  {
    badge: 'NEW',
    tone: '#16A34A',
    title: 'TRYBE: see what you already filmed on Amazon, everywhere',
    desc: 'Every TRYBE brand and product now says when you already have Amazon videos of it: in Make videos (each product you filmed says so), Ready to send, Sent, My brands, the Inbox and This week. When a brand says yes, MVP tells you to submit those Amazon videos on TRYBE first: paid videos with no new filming. On the Pro plan.',
    href: '/trybe?tab=create',
  },
  {
    badge: 'NEW',
    tone: '#4F46E5',
    title: 'Your TRYBE samples as a PDF',
    desc: 'On This week, Download my samples (PDF) gives you every sample by brand, with the brand\u2019s logo, where each one stands, the dates, the ones to chase, and the Amazon videos you already have of them. On the Pro plan.',
    href: '/trybe?tab=week',
  },
  {
    badge: 'IMPROVED',
    tone: '#0B1B38',
    title: 'Your weekly planner, in MVP\u2019s design',
    desc: 'The TRYBE weekly planner PDF now has MVP\u2019s logo, colors and type, a cover, and page numbers on every page.',
    href: '/trybe?tab=week',
  },
  {
    badge: 'IMPROVED',
    tone: '#6d28d9',
    title: 'Replies that fit TRYBE',
    desc: 'Suggested replies to TRYBE brands never ask about rates or terms: on TRYBE the brand sets the pay. They answer the brand, show you fit and move to the next step: the sample, the brief, the videos.',
    href: '/trybe?tab=inbox',
  },
  // TRYBE (Seb, 2026-10-14). TRYBE is open to the Pro plan, so every item
  // says so; each links to its own tab (?tab= on /trybe).
  {
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'TRYBE: your whole TRYBE business in one place',
    desc: 'Find brands that fit your channel, message them in your own words, answer them, plan your videos and see what each brand pays you. Three groups in one menu: Create, Get brands and Track. On the Pro plan, under Find products, with SCOUT in Chrome. On the Amazon plan, Find brands is open to browse.',
    href: '/trybe',
  },
  {
    badge: 'NEW',
    tone: '#E4572E',
    title: 'Make videos: pick a brand, pick your product, get ten scripts',
    desc: 'MVP lists the brand\u2019s own products from its TRYBE profile, with your samples first. Pick the one you have on hand and get ten shooting scripts that follow the brand\u2019s brief, each with a hook written for the viewer. Every idea is kept for that brand.',
    href: '/trybe?tab=create',
  },
  {
    badge: 'NEW',
    tone: '#16A34A',
    title: 'Find brands: see who you already filmed on Amazon',
    desc: 'Each brand says if you already have Amazon videos of its products, if its products are in your storefront, and if it pays Amazon creators on Creator Connections. Rank brands by what matters to you, filter by pay per video, creators, samples and more, and star or pass on any brand. Open on the Amazon plan too; messaging brands is on Pro.',
    href: '/trybe?tab=find',
  },
  {
    badge: 'NEW',
    tone: '#0E7490',
    title: 'Your stage: volume first, then double down',
    desc: 'At first, ask many brands and film for every one that says yes. Once your own numbers show which brands pay and approve you, MVP names them as your winners and tells you to put most of your videos into them, while you keep testing new brands.',
    href: '/trybe?tab=find',
  },
  {
    badge: 'NEW',
    tone: '#C2410C',
    title: 'This week: samples, a 7 day plan and a planner PDF',
    desc: 'Your TRYBE sample requests come in by themselves and tick off as they arrive. MVP plans your next seven days from what you have on hand and your monthly target, and makes a clean weekly planner PDF with scripts, top videos to watch and your earnings as charts.',
    href: '/trybe?tab=week',
  },
  {
    badge: 'NEW',
    tone: '#BE185D',
    title: 'My brands, What changed and What\u2019s working',
    desc: 'See what each brand paid you and approved, which ones to focus on, and videos stuck in review. Every day MVP notes new brands, pay changes and new Meta ads, your brands first. Check your own hook before you film, and see how the videos in TRYBE\u2019s Top 100 open, with examples to watch.',
    href: '/trybe?tab=brands',
  },
  {
    badge: 'IMPROVED',
    tone: '#6d28d9',
    title: 'Inbox with a suggested reply',
    desc: 'Your TRYBE chats inside MVP, each with a reply suggested in your voice. Unread replies show in the menu and on your Today list.',
    href: '/trybe?tab=inbox',
  },
]

export default function WhatsNewCard() {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)

  // On mount: enable the portal, and auto-open the modal once per release.
  useEffect(() => {
    setMounted(true)
    let seen: string | null = null
    try { seen = localStorage.getItem(STORAGE_KEY) } catch { /* private mode */ }
    if (seen !== RELEASE_ID) setOpen(true)
  }, [])

  // Lock body scroll + close on Escape while the modal is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function markSeen() {
    try { localStorage.setItem(STORAGE_KEY, RELEASE_ID) } catch { /* ignore */ }
  }
  function close() { setOpen(false); markSeen() }
  function openModal() { setOpen(true) }

  return (
    <>
      {/* Trigger pill — sits inline in the hero pills row (next to Tutorials).
          Filled gradient + a pulsing dot so it's noticeable. */}
      <button
        onClick={openModal}
        className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold text-white shadow-sm transition-all hover:opacity-90 hover:-translate-y-px"
        style={{ background: 'linear-gradient(135deg, #FF5A1F 0%, #E11900 100%)' }}
        aria-label="Open what's new"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: '#FFD400' }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: '#FFD400' }} />
        </span>
        <Sparkles size={12} />
        What&apos;s new
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/25">
          {UPDATES.length}
        </span>
      </button>

      {/* Modal — centered overlay, doesn't affect page layout. */}
      {mounted && open && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-start sm:items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="What's new in MVP"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

          <div
            className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl border shadow-2xl bg-white dark:bg-[#141418]"
            style={{ borderColor: 'rgba(124, 58, 237, 0.30)' }}
          >
            {/* Sticky header */}
            <div
              className="sticky top-0 z-10 flex items-center gap-3 px-5 py-4 border-b bg-white/95 dark:bg-[#141418]/95 backdrop-blur"
              style={{ borderColor: 'var(--border, rgba(0,0,0,0.08))' }}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
                style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #bc1888 100%)' }}
              >
                <Sparkles size={16} className="text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] font-bold leading-tight" style={{ color: 'var(--text)' }}>
                  What&apos;s new in MVP
                </h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  {UPDATES.length} updates from the last few days · tap any to open it
                </p>
              </div>
              <button
                onClick={close}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                style={{ color: 'var(--text-faint)' }}
                aria-label="Close"
              >
                <X size={17} />
              </button>
            </div>

            {/* Grid */}
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5 p-5">
              {UPDATES.map((u, i) => {
                const inner = (
                  <div
                    className="h-full rounded-xl border p-3.5 bg-black/[0.015] dark:bg-white/[0.035] transition-all duration-200 hover:shadow-sm hover:-translate-y-px"
                    style={{ borderColor: `${u.tone}33` }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{ color: u.tone, backgroundColor: `${u.tone}1f` }}
                      >
                        {u.badge}
                      </span>
                      {u.href && (
                        <ArrowUpRight
                          size={13}
                          style={{ color: u.tone }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      )}
                    </div>
                    <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text)' }}>
                      {u.title}
                    </p>
                    <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                      {u.desc}
                    </p>
                  </div>
                )
                return (
                  <li key={i} className="group">
                    {u.href
                      // The free guide is a static page behind a rewrite, which
                      // an in-app Link can fail to reach: a plain link loads it.
                      ? u.href.startsWith('/freeguide')
                        ? <a href={u.href} onClick={close} className="block h-full">{inner}</a>
                        : <Link href={u.href} onClick={close} className="block h-full">{inner}</Link>
                      : inner}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
