// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /join/amazon — the ad destination for the Amazon Influencer campaign.
//
// Separate from /amazon-influencer on purpose. That page is a sales page: it
// answers every question, and it is the right page for somebody already
// considering $79. Cold traffic off a Meta ad has not decided anything. They
// have decided to look, and a page that opens with ten feature cards asks them
// to read before it gives them anything.
//
// So this is one screen: one promise, one field, and the proof underneath for
// whoever scrolls. The sales page is one click away for anyone who wants it.
//
// It is deliberately NOT a second copy of the offer. Every number comes from
// lib/free-trial and lib/tier, which is what the server enforces, so this page
// cannot drift into advertising a plan that does not exist.
//
// Route is /join/amazon, not /amazon: /amazon/* is the in-dashboard tool group.

import type { Metadata } from 'next'
import Link from 'next/link'
import NextImage from 'next/image'
import { Check, ShieldCheck, Wand2, UserSquare, Download } from 'lucide-react'
import MetaTrack from '@/components/analytics/MetaTrack'
import AmazonJoinForm from '@/components/landing/AmazonJoinForm'
import { FREE_TRIAL, freeTrialHighlights } from '@/lib/free-trial'
import { TIERS } from '@/lib/tier'

export const metadata: Metadata = {
  title: 'Your Amazon products, post-ready in one click',
  description:
    'Paste an Amazon product link and get a finished thumbnail or a ready-to-post design with your face on it. No website, no YouTube, no card.',
}

const ACCENT = '#C2410C'

const STEPS = [
  { icon: <Wand2 size={18} />, title: 'Paste an Amazon product link', body: 'Any product from your storefront. That is the whole input.' },
  { icon: <UserSquare size={18} />, title: 'Pick yourself, or product only', body: 'Add a few selfies once and MVP puts you in every design. Or skip it and keep them product-only.' },
  { icon: <Download size={18} />, title: 'Download the finished design', body: 'A scroll-stopping thumbnail or a ready-to-post pin, Reel cover or Facebook post. Yours to keep.' },
]

export default function AmazonJoinPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0b0b0d] text-[#1d1d1f] dark:text-[#f5f5f7]">
      {/* The ad lands here, so this is where the click becomes a measurable
          event. Its own content_name, separate from the sales page and from
          /pricing, so the three audiences never merge in reporting. */}
      <MetaTrack event="ViewContent" params={{ content_name: 'Amazon ad landing', content_category: 'amazon' }} />

      {/* ── One screen ───────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(60% 80% at 15% 0%, rgba(234,88,12,0.16), transparent 60%)' }}
        />
        <div className="relative max-w-3xl mx-auto px-5 sm:px-6 pt-12 pb-14">
          <NextImage src="/png/mvp-affiliate-amz.png" alt="" width={56} height={56} priority className="w-14 h-14 rounded-2xl shadow-sm mb-5" />
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-3" style={{ color: ACCENT }}>
            For Amazon Associates &amp; Influencers
          </p>
          <h1 className="text-3xl sm:text-[2.75rem] font-bold tracking-tight leading-[1.08]">
            Turn any Amazon product into a post-ready design. With your face on it.
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0]">
            Paste a product link, get a finished thumbnail or a ready-to-post pin, Reel cover or Facebook
            post. No website. No YouTube channel. No card.
          </p>

          <AmazonJoinForm />

          {/* What free actually is, in one line, right under the field. The
              numbers are the ones the server enforces. */}
          <p className="mt-3 text-[13px] text-[#86868b] dark:text-[#8e8e93]">
            Free: {FREE_TRIAL.thumbnails} thumbnails, {FREE_TRIAL.socialDesigns} designs, {FREE_TRIAL.photobooth} headshots
            of you, all yours to download. Then ${TIERS.amazon.price} a month if you want to publish from here.
          </p>
        </div>
      </section>

      {/* ── How, in three lines ──────────────────────────────────────────── */}
      <section className="border-t border-gray-200 dark:border-white/10">
        <div className="max-w-3xl mx-auto px-5 sm:px-6 py-12">
          <div className="flex flex-col gap-6">
            {STEPS.map((s, i) => (
              <div key={s.title} className="flex items-start gap-4">
                <span
                  className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0 text-white font-bold"
                  style={{ backgroundColor: ACCENT }}
                >
                  {s.icon}
                </span>
                <div>
                  {/* Numbered because this genuinely IS a sequence: each step
                      only makes sense after the one before it. */}
                  <p className="font-semibold text-[15px]">{i + 1}. {s.title}</p>
                  <p className="text-[13.5px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What free includes, stated rather than implied ───────────────── */}
      <section className="border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02]">
        <div className="max-w-3xl mx-auto px-5 sm:px-6 py-12">
          <div className="flex items-start gap-3 mb-5">
            <span className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0 text-white" style={{ backgroundColor: ACCENT }}>
              <ShieldCheck size={18} />
            </span>
            <div>
              <h2 className="text-xl font-bold tracking-tight">What you get before paying anything</h2>
              <p className="text-[13.5px] text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                One Amazon Associates tag and you are generating. Nothing to connect, no card.
              </p>
            </div>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {freeTrialHighlights().map((f) => (
              <li key={f} className="flex items-start gap-2 text-[13.5px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0]">
                <Check size={14} className="mt-1 flex-shrink-0" style={{ color: ACCENT }} />{f}
              </li>
            ))}
          </ul>
          <div className="mt-7">
            <AmazonJoinForm />
          </div>
        </div>
      </section>

      {/* ── The way out, for the two people this page is not for ─────────── */}
      <section className="border-t border-gray-200 dark:border-white/10">
        <div className="max-w-3xl mx-auto px-5 sm:px-6 py-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-[13.5px] text-[#6e6e73] dark:text-[#ebebf0]">
            Want every detail, the brand-deal side and the full plan?{' '}
            <Link href="/amazon-influencer" className="font-semibold hover:underline" style={{ color: ACCENT }}>
              Read the full page
            </Link>
            .
          </p>
          <p className="text-[13.5px] text-[#6e6e73] dark:text-[#ebebf0]">
            Have a blog or YouTube channel?{' '}
            <Link href="/pricing" className="font-semibold hover:underline" style={{ color: '#7C3AED' }}>
              That is a different product
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  )
}
