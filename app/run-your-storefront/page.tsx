// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /run-your-storefront — THE PAID-ADS LANDING PAGE for the Amazon tier.
//
// The second of two. Same discipline as /own-your-blog (no navigation, one CTA
// spelled once, noindex, objections answered in the order they are actually
// thought), and a completely different promise, because it is a different buyer:
//
//   /own-your-blog        Pro. "Your storefront is rented, build the one you
//                         own." For the creator who wants an asset off Amazon.
//   this page             Amazon. "Make the assets, not just the decisions."
//                         For the creator whose business IS the storefront and
//                         who is not looking to start a blog.
//
// WHY THE PROMISE IS WHAT IT IS. The two tools winning this click are priced at
// roughly $29 and $20 a month against our $99, so the page cannot win on price
// and must not try. It wins on category: they are Chrome extensions that help a
// creator WORK the storefront faster (scores, campaign intelligence, an inbox),
// and this makes the things the storefront needs. Thumbnails, designs, pins,
// Reels covers, outreach. Different job, not a more expensive version of theirs.
//
// The bundle argument is real too and is the SECOND beat, not the first: $99
// against a subscription plus a thumbnail tool plus a design tool plus a
// scheduler. "We are a different category" converts cold traffic; "we are a
// cheaper bundle" invites a spreadsheet.
//
// EVERY NUMBER IS READ FROM TIERS. Never typed. The marketing site has been
// wrong about its own prices and caps in nine places at once before, every one
// of them understating the plan, and scripts/test-sales-page-facts exists
// because of it.

import type { Metadata } from 'next'
import NextImage from 'next/image'
import {
  ArrowRight, Check, X as XIcon, ShieldCheck, Wand2, LayoutTemplate,
  Handshake, UserSquare,
} from 'lucide-react'
import { TESTIMONIALS } from '@/lib/testimonials'
import { TIERS } from '@/lib/tier'
import { AD_PAGE_LIGHT } from '@/lib/ad-page-theme'
import AdPlanCard from '@/components/landing/AdPlanCard'
import { SALES_PAUSED } from '@/lib/sales-paused'
import MetaTrack from '@/components/analytics/MetaTrack'

export const metadata: Metadata = {
  title: 'Make the assets your storefront needs | MVP Affiliate',
  description:
    'Thumbnails, shoppable designs, pins, Reels covers and brand-deal outreach for Amazon Influencers. The other tools help you decide. This one makes the work.',
  robots: { index: false, follow: false },
}

const CTA_HREF = '/signup?tier=amazon'
const CTA_LABEL = 'Start free, no card'

function Cta({ size = 'lg' }: { size?: 'lg' | 'md' }) {
  return (
    <a
      href={CTA_HREF}
      className={`inline-flex items-center gap-2 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold transition-colors shadow-[0_4px_20px_rgba(124,58,237,0.35)] ${
        size === 'lg' ? 'px-7 py-4 text-[16px]' : 'px-5 py-3 text-[14px]'
      }`}
    >
      {CTA_LABEL}
      <ArrowRight size={size === 'lg' ? 17 : 14} />
    </a>
  )
}

function CtaSubtext({ dark = false }: { dark?: boolean }) {
  return (
    <p className={`mt-3 text-[13px] ${dark ? 'text-white/55' : 'text-black/50'}`}>
      No card to start · {TIERS.trial.thumbnailsPerMonth} thumbnails free · 30-day money-back guarantee
    </p>
  )
}

/** What the plan MAKES, every figure read from the tier it describes. */
const MAKES: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <Wand2 size={18} />,
    title: `${TIERS.amazon.thumbnailsPerMonth} thumbnails a month`,
    body: 'Art-directed from one product photo. Tested layouts, your face on them if you want it, ready to upload.',
  },
  {
    icon: <LayoutTemplate size={18} />,
    title: `${TIERS.amazon.pinsPerMonth} pins, ${TIERS.amazon.igPostsPerMonth} Reels covers, ${TIERS.amazon.facebookPostsPerMonth} Facebook designs`,
    body: 'Shoppable designs for every surface your storefront traffic comes from, made and scheduled rather than briefed.',
  },
  {
    icon: <Handshake size={18} />,
    title: `${TIERS.amazon.collabsPerMonth} brand-deal outreach messages a month`,
    body: 'Creator Connections campaigns found and the first message written, so the pitch goes out the day you see the product.',
  },
  {
    icon: <UserSquare size={18} />,
    title: `${TIERS.amazon.maxFaces} face models, ${TIERS.amazon.photoboothPerMonth} headshots a month`,
    body: 'Your face on the designs without a shoot, so the whole storefront looks like one person made it.',
  },
]

const OLD_NEW: { old: string; mvp: string }[] = [
  {
    old: 'A tool tells you which product is worth your time.',
    mvp: 'And then you still have to make the thumbnail, the pin and the Reel yourself.',
  },
  {
    old: 'Thumbnails in one subscription, designs in another, scheduling in a third.',
    mvp: 'One plan makes all of them, from the product photo, in your look.',
  },
  {
    old: 'Brand deals are a tab you keep meaning to open.',
    mvp: 'Campaigns are surfaced and the first message is already written.',
  },
  {
    old: 'International clicks land on the wrong Amazon and earn nothing.',
    mvp: 'Every shopper is routed to their own country’s Amazon. Unlimited, and no cost per click.',
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'I already pay for an Amazon Influencer tool. Why this as well?',
    a: 'Most of them help you decide: which campaign to take, which product scores well, which message to send. Useful, and none of it makes a thumbnail. This makes the assets the storefront actually needs, so for a lot of creators it replaces the design tool and the scheduler rather than the tool they are already happy with.',
  },
  {
    q: `Why is this $${TIERS.amazon.price} when others are $29?`,
    a: 'Because it is doing a different job. A browser extension that reads Amazon pages costs what it costs; generating hundreds of art-directed images a month has a real cost per image behind it. Add up what you currently pay for thumbnails, designs and scheduling and the comparison usually goes the other way.',
  },
  {
    q: 'Do I need a website or a blog?',
    a: 'No. This plan is built for the storefront and the socials around it, with no WordPress involved. If you later decide you want a blog you own, that is a different plan and you can move up without losing anything.',
  },
  {
    q: 'Will the images look like AI made them?',
    a: 'They are art-directed from your own product photo, in a look you pick once and can change. You get to see them before anything goes out, and if you upload a face model your own face is on them.',
  },
  {
    q: 'What if it does not work for me?',
    a: `Start free with no card and make ${TIERS.trial.thumbnailsPerMonth} thumbnails before you decide anything. If you subscribe and it is not for you, there is a 30-day money-back guarantee.`,
  },
]

export default function RunYourStorefrontPage() {
  const hasProof = TESTIMONIALS.length > 0
  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#1D1D1F] font-[Inter,system-ui,sans-serif]" style={AD_PAGE_LIGHT}>
      <MetaTrack event="ViewContent" />

      <header className="px-6 lg:px-8 pt-7">
        <div className="max-w-5xl mx-auto flex items-center gap-2">
          <NextImage src="/png/mvp-affiliate-amz.png" alt="MVP Affiliate" width={120} height={32} className="h-7 w-auto" priority />
        </div>
      </header>

      <section className="px-6 lg:px-8 pt-10 pb-16 sm:pb-20">
        <div className="max-w-3xl mx-auto text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border bg-white text-[11px] uppercase tracking-[0.16em] font-medium border-black/10 text-black/55">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
            For Amazon Influencers
          </span>
          <h1 className="mt-5 text-[38px] sm:text-[56px] font-extrabold tracking-[-0.035em] leading-[1.0]" style={{ color: '#1D1D1F' }}>
            Other tools help you decide.{' '}
            <span style={{ color: '#C026D3', background: 'linear-gradient(120deg, #F97316 0%, #C026D3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              This one does the work.
            </span>
          </h1>
          <p className="mt-6 text-[17px] sm:text-[19px] leading-relaxed text-black/70">
            Scores, campaign feeds and inbox tools tell you what to go after. You still have to make the thumbnail, the pin, the Reel cover and the pitch. MVP makes all of them, from one product photo, in your look, at <span className="font-semibold text-black">${TIERS.amazon.price} a month</span>.
          </p>
          <div className="mt-9">
            <Cta />
            <CtaSubtext />
          </div>
        </div>
      </section>

      {/* ── The gap, named once ───────────────────────────────────────────── */}
      <section className="px-6 lg:px-8 py-14" style={{ background: '#16091E' }}>
        <div className="max-w-3xl mx-auto text-center text-white">
          <h2 className="text-[28px] sm:text-[38px] font-extrabold tracking-[-0.03em] leading-[1.08]" style={{ color: '#FFFFFF' }}>
            Knowing which product to post is the easy half.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-white/75">
            You already know what sells. What eats the week is making the thing: a thumbnail that gets the click, a pin that does not look like every other pin, a Reel cover, a message to a brand you meant to send on Tuesday.
          </p>
          <p className="mt-4 text-[16px] leading-relaxed text-white/90 font-semibold">
            That is the half nobody automated. It is the half this does.
          </p>
        </div>
      </section>

      {/* ── What it makes ─────────────────────────────────────────────────── */}
      <section className="px-6 lg:px-8 py-16 sm:py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-[30px] sm:text-[42px] font-extrabold tracking-[-0.03em] leading-[1.05]" style={{ color: '#1D1D1F' }}>
              What lands in your account every month
            </h2>
          </div>
          <div className="mt-11 grid sm:grid-cols-2 gap-4">
            {MAKES.map((s) => (
              <div key={s.title} className="rounded-2xl border border-black/10 bg-white p-6">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white mb-3" style={{ background: 'linear-gradient(135deg,#7C3AED,#C026D3)' }}>
                  {s.icon}
                </span>
                <h3 className="text-[17px] font-bold tracking-tight" style={{ color: '#1D1D1F' }}>{s.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-black/65">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-11">
            <Cta size="md" />
          </div>
        </div>
      </section>

      {/* ── The bundle argument, second beat ──────────────────────────────
          PAIRED ROWS. The first version ran two separate lists, so a reader had
          to count down both columns to see which answer belonged to which
          problem. Each row is now one problem and its answer on one line. */}
      <section className="px-6 lg:px-8 py-16 sm:py-20 bg-white border-y border-black/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-2xl mx-auto">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#7C3AED' }}>
              The difference
            </span>
            <h2 className="mt-3 text-[30px] sm:text-[42px] font-extrabold tracking-[-0.03em] leading-[1.04]" style={{ color: '#1D1D1F' }}>
              And it replaces most of the stack
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed" style={{ color: 'rgba(0,0,0,0.62)' }}>
              The research tool is not what this competes with. The subscriptions underneath it are.
            </p>
          </div>

          <div className="mt-11 flex flex-col gap-3">
            {OLD_NEW.map((r) => (
              <div key={r.old} className="grid md:grid-cols-[1fr_auto_1fr] items-stretch gap-3 md:gap-0 rounded-2xl border overflow-hidden" style={{ borderColor: 'rgba(0,0,0,0.09)' }}>
                <div className="p-5 sm:p-6 bg-[#FAFAF8] flex gap-3">
                  <XIcon size={17} className="mt-0.5 flex-shrink-0" style={{ color: '#ff3b30' }} />
                  <div>
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] mb-1.5" style={{ color: 'rgba(0,0,0,0.38)' }}>Today</p>
                    <p className="text-[15px] leading-relaxed" style={{ color: 'rgba(0,0,0,0.70)' }}>{r.old}</p>
                  </div>
                </div>
                <div className="hidden md:flex items-center justify-center px-2 bg-[#FAFAF8]">
                  <ArrowRight size={18} style={{ color: 'rgba(124,58,237,0.5)' }} />
                </div>
                <div className="p-5 sm:p-6 flex gap-3" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.07), rgba(192,38,211,0.04))' }}>
                  <Check size={17} className="mt-0.5 flex-shrink-0" style={{ color: '#34c759' }} />
                  <div>
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] mb-1.5" style={{ color: '#7C3AED' }}>With MVP</p>
                    <p className="text-[15px] leading-relaxed font-medium" style={{ color: '#1D1D1F' }}>{r.mvp}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The plan, and a way to buy it ───────────────────────────────── */}
      <section className="px-6 lg:px-8 py-16 sm:py-20">
        <div className="max-w-3xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-[30px] sm:text-[42px] font-extrabold tracking-[-0.03em] leading-[1.04]" style={{ color: '#1D1D1F' }}>
              What it costs, and what you get
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed" style={{ color: 'rgba(0,0,0,0.62)' }}>
              Start free with no card if you want to see it work first. If you already know you want it, skip the trial.
            </p>
          </div>
          <AdPlanCard tier="amazon" ctaHref="/signup?tier=amazon&plan=paid" freeHref={CTA_HREF} freeLabel={CTA_LABEL} />
        </div>
      </section>

      {hasProof && (
        <section className="px-6 lg:px-8 py-16">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-[28px] sm:text-[38px] font-extrabold tracking-[-0.03em] text-center leading-[1.05]" style={{ color: '#1D1D1F' }}>
              From creators already doing it
            </h2>
            <div className={`mt-9 gap-4 ${TESTIMONIALS.length === 1 ? 'max-w-xl mx-auto' : 'grid sm:grid-cols-2 lg:grid-cols-3'}`}>
              {TESTIMONIALS.map((t, i) => (
                <figure key={i} className="rounded-2xl border border-black/10 bg-white p-5 flex flex-col">
                  <div className="text-[13px] mb-2 text-[#F5A623]">★★★★★</div>
                  {t.result && <p className="text-[15px] font-bold leading-snug mb-2.5">{t.result}</p>}
                  <blockquote className={`text-[14px] leading-relaxed flex-1 ${t.result ? 'text-black/65' : ''}`}>“{t.quote}”</blockquote>
                  <figcaption className="mt-4 flex items-center gap-3">
                    {t.photo && (
                      <NextImage src={t.photo} alt={t.name} width={80} height={80} loading="lazy" className="w-10 h-10 rounded-full object-cover border border-black/10 flex-shrink-0" />
                    )}
                    <span className="text-[12.5px] leading-tight">
                      <span className="font-semibold block">{t.name}</span>
                      {(t.title || t.handle) && (
                        <span className="text-black/40">{t.title}{t.title && t.handle ? ' · ' : ''}{t.handle}</span>
                      )}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── The offer ─────────────────────────────────────────────────────── */}
      <section className="px-6 lg:px-8 py-16" style={{ background: 'linear-gradient(160deg, #16091E 0%, #2A0E3A 55%, #3A0E22 100%)' }}>
        <div className="max-w-2xl mx-auto text-center text-white">
          <h2 className="text-[30px] sm:text-[42px] font-extrabold tracking-[-0.03em] leading-[1.05]" style={{ color: '#FFFFFF' }}>
            Make {TIERS.trial.thumbnailsPerMonth} thumbnails before you decide anything.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-white/75">
            Start free with no card. Upload one product photo and see what comes back. If it is not better than what you are making now, you have lost nothing.
          </p>
          <div className="mt-8 flex flex-col items-center">
            <Cta />
            <CtaSubtext dark />
          </div>
          <div className="mt-9 grid sm:grid-cols-3 gap-3 text-left">
            {[
              { icon: <Wand2 size={15} />, t: `$${TIERS.amazon.price} a month`, b: `Against a list price of $${TIERS.amazon.regularPrice}, locked for as long as you stay.` },
              { icon: <LayoutTemplate size={15} />, t: 'No blog needed', b: 'Built for the storefront and the socials around it. No WordPress.' },
              { icon: <ShieldCheck size={15} />, t: '30-day guarantee', b: 'If it is not for you, you get your money back.' },
            ].map((f) => (
              <div key={f.t} className="rounded-xl border border-white/12 bg-white/[0.05] p-4">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-white">{f.icon}{f.t}</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/60">{f.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 lg:px-8 py-16">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-[28px] sm:text-[36px] font-extrabold tracking-[-0.03em] text-center leading-[1.05]" style={{ color: '#1D1D1F' }}>
            The things people ask first
          </h2>
          <div className="mt-8 flex flex-col gap-3">
            {FAQ.map((f) => (
              <details key={f.q} className="rounded-2xl border border-black/10 bg-white p-5 group">
                <summary className="cursor-pointer list-none font-semibold text-[15.5px] flex items-center justify-between gap-4">
                  {f.q}
                  <span className="text-black/30 group-open:rotate-45 transition-transform text-xl leading-none">+</span>
                </summary>
                <p className="mt-3 text-[14.5px] leading-relaxed text-black/65">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="text-center mt-10">
            <Cta />
            <CtaSubtext />
          </div>
        </div>
      </section>

      {SALES_PAUSED && (
        <p className="px-6 pb-10 text-center text-[13px] text-black/50">
          New subscriptions are paused right now. The free tier is still open.
        </p>
      )}

      <footer className="px-6 lg:px-8 py-10 border-t border-black/5">
        <div className="max-w-5xl mx-auto text-center text-[12px] text-black/40">
          <p>MVP Affiliate is an independent tool and is not affiliated with, endorsed by, or sponsored by Amazon.</p>
          <p className="mt-2">
            <a href="/privacy" className="hover:text-black/70">Privacy</a>
            <span className="mx-2">·</span>
            <a href="/terms" className="hover:text-black/70">Terms</a>
          </p>
        </div>
      </footer>
    </div>
  )
}
