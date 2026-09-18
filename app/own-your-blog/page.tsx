// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /own-your-blog — THE PAID-ADS LANDING PAGE, for Amazon Influencers.
//
// Separate from / and from /amazon-influencer on purpose, and the reason is the
// whole design of this file.
//
//   /                  sells the product to everybody: organic visitors,
//                      returning users, people comparing tools. It has a nav,
//                      an audience splitter, and sixteen sections, because it
//                      has to serve all of them.
//   /amazon-influencer sells the $99 storefront plan to somebody who does NOT
//                      want a blog. The opposite buyer to this page.
//   this page          sells ONE promise to ONE stranger who clicked ONE ad.
//
// So it is built the way an ad landing page is built, and every difference from
// the homepage is deliberate:
//
//   NO NAVIGATION. Not a smaller nav, none. Every link that is not the CTA is a
//   way to leave a page we paid to put them on. The logo does not link home.
//
//   ONE PROMISE, repeated. It is the promise the ad makes: your storefront is
//   rented, this builds the one you own. If the ad says something else, this
//   page is the wrong page for it and a second one should be made.
//
//   ONE CTA, repeated four times, always the same words and the same
//   destination. A visitor deciding between two calls to action is a visitor
//   not deciding.
//
//   OBJECTIONS ANSWERED IN ORDER. The four an Amazon Influencer actually has,
//   as opposed to the four we would like them to have: is it AI slop, do I need
//   a website already, does this get me banned, what if it does not work.
//
// Proof comes from lib/testimonials, the same list the homepage reads, so a
// quote added once appears on both. There is no second list to forget.

import type { Metadata } from 'next'
import NextImage from 'next/image'
import {
  ArrowRight, Check, X as XIcon, ShieldCheck, Globe, Scissors,
  FileText, Send, Sparkles,
} from 'lucide-react'
import { TESTIMONIALS } from '@/lib/testimonials'
import { TIERS } from '@/lib/tier'
import { SALES_PAUSED } from '@/lib/sales-paused'
import MetaTrack from '@/components/analytics/MetaTrack'

export const metadata: Metadata = {
  title: 'Own the blog Amazon cannot take away | MVP Affiliate',
  description:
    'Your Amazon storefront is rented. MVP turns the reviews you are already filming into SEO articles, social posts and shoppable clips on a blog that is yours forever.',
  // An ad landing page has no business in search results competing with the
  // homepage for the same terms, and a thin page that ranks is a page that
  // dilutes the one meant to.
  robots: { index: false, follow: false },
}

/** The one call to action. Spelled once so all four uses cannot drift, which is
 *  the failure that turns a single-offer page into a page with four offers. */
const CTA_HREF = '/signup?tier=pro'
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

/** Reassurance under every CTA. The three objections that stop a cold click,
 *  answered before they are asked, in six words each. */
function CtaSubtext() {
  return (
    <p className="mt-3 text-[13px]" style={{ color: 'rgba(0,0,0,0.5)' }}>
      No card to start · {TIERS.trial.lifetimeMax} full reviews free · 30-day money-back guarantee
    </p>
  )
}

const LOOP: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <FileText size={18} />,
    title: 'Your video becomes an article',
    body: 'Written from your own transcript, in your voice, from what you actually said on camera. Published to your own domain, not a storefront.',
  },
  {
    icon: <Sparkles size={18} />,
    title: 'And the upload finishes itself',
    body: 'Description, tags, affiliate links and a tested thumbnail, back on the YouTube video you just filmed.',
  },
  {
    icon: <Send size={18} />,
    title: 'Then it goes everywhere',
    body: 'Pinterest, Instagram, Facebook, Threads and the rest, on a schedule, with the images made for you.',
  },
  {
    icon: <Scissors size={18} />,
    title: 'And your long videos get cut up',
    body: 'Vertical clips with captions, pulled from the moments that actually land, ready to post with a shoppable link.',
  },
]

const OLD_NEW: { old: string; mvp: string }[] = [
  {
    old: 'Your business lives on a storefront Amazon owns and can change.',
    mvp: 'It also lives on a blog on your own domain, which is yours whatever Amazon does next.',
  },
  {
    old: 'A video gets filmed, uploaded, and that is the end of its life.',
    mvp: 'One video becomes an article, a description, tags, a thumbnail, social posts and vertical clips.',
  },
  {
    old: 'International clicks land on the wrong Amazon and earn nothing.',
    mvp: 'Every shopper is routed to their own country’s Amazon. Unlimited, and no cost per click.',
  },
  {
    old: 'A dead product link sits there for weeks before anyone notices.',
    mvp: 'Broken and off-style links are found, counted link by link, and repaired in one pass.',
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Is this just AI slop?',
    a: 'It writes from your transcript, so the opinions in the article are the ones you gave on camera: what you liked, what annoyed you, who it is for. It will not invent a feature you never mentioned or a price you never checked. If you did not film a video for it, it says so rather than inventing an experience you never had.',
  },
  {
    q: 'Do I need a website already?',
    a: 'No. If you have one, connect it. If you do not, you will need a domain and WordPress hosting, and setup walks you through it. The blog is yours: your domain, your content, your traffic, and it stays yours if you ever stop paying us.',
  },
  {
    q: 'Will this get my Amazon account in trouble?',
    a: 'No. Sending traffic to Amazon from your own site is what the Associates programme is for, and off-site content is how most established affiliates earn. Your disclosure goes on every post automatically.',
  },
  {
    q: 'What if it does not work for me?',
    a: 'Start on the free tier with no card. If you subscribe and it is not for you, there is a 30-day money-back guarantee, no questions.',
  },
  {
    q: 'How much of my time does this take?',
    a: 'You film the review, which you are doing anyway. Connect the channel once and each new video turns into a published article and a week of social posts without you opening anything.',
  },
]

export default function OwnYourBlogPage() {
  const hasProof = TESTIMONIALS.length > 0
  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#1D1D1F] font-[Inter,system-ui,sans-serif]">
      <MetaTrack event="ViewContent" />

      {/* ── Hero ───────────────────────────────────────────────────────────
          A logo that does NOT link anywhere. On a page bought with ad money,
          the logo is the most-clicked escape route there is. */}
      <header className="px-6 lg:px-8 pt-7">
        <div className="max-w-5xl mx-auto flex items-center gap-2">
          <NextImage src="/png/mvp-affiliate-pro.png" alt="MVP Affiliate" width={120} height={32} className="h-7 w-auto" priority />
        </div>
      </header>

      <section className="px-6 lg:px-8 pt-10 pb-16 sm:pb-20">
        <div className="max-w-3xl mx-auto text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border bg-white text-[11px] uppercase tracking-[0.16em] font-medium border-black/10 text-black/55">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
            For Amazon Influencers
          </span>
          <h1 className="mt-5 text-[38px] sm:text-[56px] font-extrabold tracking-[-0.035em] leading-[1.0]">
            Your Amazon storefront is rented.{' '}
            <span style={{ background: 'linear-gradient(120deg, #F97316 0%, #C026D3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Build the one you own.
            </span>
          </h1>
          <p className="mt-6 text-[17px] sm:text-[19px] leading-relaxed text-black/70">
            You already buy the products, film the reviews and know what is worth recommending. MVP turns each of those videos into a published article on <span className="font-semibold text-black">your own domain</span>, finishes the YouTube upload, posts it everywhere, and cuts your long videos into shoppable clips.
          </p>
          <div className="mt-9">
            <Cta />
            <CtaSubtext />
          </div>
        </div>
      </section>

      {/* ── The problem, stated once and plainly ──────────────────────────── */}
      <section className="px-6 lg:px-8 py-14" style={{ background: '#16091E' }}>
        <div className="max-w-3xl mx-auto text-center text-white">
          <h2 className="text-[28px] sm:text-[38px] font-extrabold tracking-[-0.03em] leading-[1.08]">
            Everything you have built sits on land you rent.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-white/75">
            Your storefront, your commission rate, your category, your account. Amazon sets all of it and can change any of it, and none of it follows you anywhere. The videos are yours. The audience that watches them is not, yet.
          </p>
          <p className="mt-4 text-[16px] leading-relaxed text-white/90 font-semibold">
            A blog on your own domain is the one asset in this business that nobody can switch off.
          </p>
        </div>
      </section>

      {/* ── What it does ──────────────────────────────────────────────────── */}
      <section className="px-6 lg:px-8 py-16 sm:py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-[30px] sm:text-[42px] font-extrabold tracking-[-0.03em] leading-[1.05]">
              One video in. A week of work out.
            </h2>
            <p className="mt-4 text-[15.5px] text-black/60">
              You film. Everything below happens without you opening anything.
            </p>
          </div>
          <div className="mt-11 grid sm:grid-cols-2 gap-4">
            {LOOP.map((s, i) => (
              <div key={s.title} className="rounded-2xl border border-black/10 bg-white p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg,#7C3AED,#C026D3)' }}>
                    {s.icon}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-black/35">Step {i + 1}</span>
                </div>
                <h3 className="text-[17px] font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-black/65">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-11">
            <Cta size="md" />
          </div>
        </div>
      </section>

      {/* ── Old way / new way ─────────────────────────────────────────────── */}
      <section className="px-6 lg:px-8 py-14 bg-white border-y border-black/5">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-[28px] sm:text-[38px] font-extrabold tracking-[-0.03em] leading-[1.05] text-center">
            Same videos. Completely different business.
          </h2>
          <div className="mt-9 grid md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-black/10 p-5 sm:p-6 bg-[#FAFAF8]">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-4 text-black/35">Today</p>
              <ul className="flex flex-col gap-3.5">
                {OLD_NEW.map((r) => (
                  <li key={r.old} className="flex gap-2.5 text-[14px] leading-relaxed text-black/60">
                    <XIcon size={15} className="mt-0.5 flex-shrink-0 text-[#ff3b30]" />
                    <span>{r.old}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border p-5 sm:p-6" style={{ borderColor: 'rgba(124,58,237,0.25)', background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(192,38,211,0.04))' }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-4 text-[#7C3AED]">With MVP</p>
              <ul className="flex flex-col gap-3.5">
                {OLD_NEW.map((r) => (
                  <li key={r.mvp} className="flex gap-2.5 text-[14px] leading-relaxed">
                    <Check size={15} className="mt-0.5 flex-shrink-0 text-[#34c759]" />
                    <span>{r.mvp}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Proof. Shares the homepage's list, so one edit updates both. ──── */}
      {hasProof && (
        <section className="px-6 lg:px-8 py-16">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-[28px] sm:text-[38px] font-extrabold tracking-[-0.03em] text-center leading-[1.05]">
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
          <h2 className="text-[30px] sm:text-[42px] font-extrabold tracking-[-0.03em] leading-[1.05]">
            Try it on the videos you have already filmed.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-white/75">
            Start free with no card. Connect a channel, pick a video, and read what it writes before you decide anything. You get {TIERS.trial.lifetimeMax} full published reviews on the free tier to make your mind up with.
          </p>
          <div className="mt-8 flex flex-col items-center">
            <Cta />
            <p className="mt-3 text-[13px] text-white/55">
              No card to start · {TIERS.trial.lifetimeMax} full reviews free · 30-day money-back guarantee
            </p>
          </div>
          <div className="mt-9 grid sm:grid-cols-3 gap-3 text-left">
            {[
              { icon: <ShieldCheck size={15} />, t: 'Yours to keep', b: 'The blog, the domain and every post stay yours if you leave.' },
              { icon: <Globe size={15} />, t: 'Every country counts', b: 'Shoppers are routed to their own Amazon. Unlimited, no per-click fee.' },
              { icon: <Check size={15} />, t: '30-day guarantee', b: 'If it is not for you, you get your money back.' },
            ].map((f) => (
              <div key={f.t} className="rounded-xl border border-white/12 bg-white/[0.05] p-4">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-white">{f.icon}{f.t}</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/60">{f.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Objections ────────────────────────────────────────────────────── */}
      <section className="px-6 lg:px-8 py-16">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-[28px] sm:text-[36px] font-extrabold tracking-[-0.03em] text-center leading-[1.05]">
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

      {/* Sales-paused gate. The CTA above goes to signup rather than checkout,
          so it keeps working, but promising a start we cannot deliver would be
          the one lie this page cannot afford. */}
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
