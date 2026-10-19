// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW THE FREE WEEK WORKS, step by step, the same everywhere it is explained.
// Seb, 2026-10-19: "We really need to make sure that the seven-day free on the
// monthly plan is really well explained." A card taken at signup is the part
// people worry about, so every step says what the card is charged that day,
// and the only one that is not $0 is day 8.
//
// No hooks, so it renders on the server pages (home, pricing, the sales page)
// and inside the client signup form alike. The steps and the price come from
// lib/guarantee and lib/tier, so no page can describe a different week.

import { ArrowRight } from 'lucide-react'
import { TIERS } from '@/lib/tier'
import { FREE_WEEK_CTA, FREE_WEEK_ON_US, FREE_WEEK_ONCE, freeWeekSteps, freeWeekUnderButton } from '@/lib/guarantee'

/** 'auto' follows the site theme. 'light' is for the sales pages that are
 *  drawn light whatever the theme. */
type Tone = 'auto' | 'light'

const TONES: Record<Tone, { bg: string; border: string; tile: string; text: string; soft: string; faint: string; zero: string }> = {
  auto: {
    bg: 'var(--surface)', border: 'var(--border)', tile: 'rgba(124,58,237,0.05)',
    text: 'var(--text)', soft: 'var(--text-soft)', faint: 'var(--text-faint)',
    zero: 'text-[#047857] dark:text-[#34D399]',
  },
  light: {
    bg: '#FFFFFF', border: 'rgba(0,0,0,0.08)', tile: 'rgba(124,58,237,0.05)',
    text: '#1D1D1F', soft: 'rgba(0,0,0,0.72)', faint: 'rgba(0,0,0,0.5)',
    zero: 'text-[#047857]',
  },
}

export default function FreeWeekSteps({
  tone = 'auto',
  cta = true,
  href = '/signup?tier=pro',
  compact = false,
}: {
  tone?: Tone
  /** The "Try MVP Affiliate free for 7 days" button under the steps. */
  cta?: boolean
  href?: string
  /** A short list for the signup form, where the reader is already joining. */
  compact?: boolean
}) {
  const t = TONES[tone]
  const steps = freeWeekSteps(TIERS.pro.price)

  if (compact) {
    return (
      <ol className="rounded-xl border px-3.5 py-3 flex flex-col gap-2" style={{ borderColor: t.border, background: t.tile }} aria-label="How the free week works">
        {steps.map((s, i) => (
          <li key={s.when} className="flex items-baseline gap-3 text-[12.5px] leading-snug">
            <span className={`w-12 flex-shrink-0 text-right font-bold tabular-nums ${i === steps.length - 1 ? '' : t.zero}`} style={i === steps.length - 1 ? { color: t.text } : undefined}>{s.charge}</span>
            <span style={{ color: t.soft }}><strong style={{ color: t.text }}>{s.when}.</strong> {s.what}</span>
          </li>
        ))}
      </ol>
    )
  }

  return (
    <section className="w-full rounded-[22px] border p-5 sm:p-8" style={{ background: t.bg, borderColor: t.border }} aria-labelledby="free-week-steps">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C3AED]">{FREE_WEEK_ON_US}</p>
      <h3 id="free-week-steps" className="mt-1.5 text-[22px] sm:text-[26px] font-bold tracking-tight" style={{ color: t.text, textWrap: 'balance' }}>
        How the free week works
      </h3>
      <p className="mt-1.5 text-[14px] leading-relaxed max-w-2xl" style={{ color: t.soft }}>
        On the monthly plan your card is taken at signup and nothing is charged for a week. Here is every day that matters, and what your card pays on it.
      </p>

      <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => {
          const last = i === steps.length - 1
          return (
            <li key={s.when} className="rounded-2xl border p-4 flex flex-col gap-2" style={{ borderColor: last ? 'rgba(124,58,237,0.35)' : t.border, background: t.tile }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: t.faint }}>{s.when}</span>
                <span className={`text-[20px] font-extrabold tabular-nums leading-none ${last ? '' : t.zero}`} style={last ? { color: t.text } : undefined}>
                  {s.charge}
                </span>
              </div>
              <p className="text-[13.5px] leading-relaxed" style={{ color: t.soft }}>{s.what}</p>
            </li>
          )
        })}
      </ol>

      {cta && (
        <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <a
            href={href}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]"
            style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)', boxShadow: '0 6px 22px rgba(124,58,237,0.32)' }}
          >
            {FREE_WEEK_CTA}
            <ArrowRight size={16} />
          </a>
          <p className="text-[13px]" style={{ color: t.soft }}>{freeWeekUnderButton(TIERS.pro.price)}</p>
        </div>
      )}

      <p className="mt-5 text-[12px] leading-relaxed" style={{ color: t.faint }}>
        The yearly plan has no free week and is charged when you join. {FREE_WEEK_ONCE}
      </p>
    </section>
  )
}
