// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The fork, and the table behind it.
//
// Amazon Influencer and the blog ladder look like one price range: $49, $79,
// $99, $199. Read that way, the $79 plan is the middle option, and a storefront
// creator has no reason to think it is the one built for them. It is a
// different product. One has no blog and needs no website or channel; the other
// three cannot start without both.
//
// Two server components, no interactivity, so they cost nothing to ship: a
// two-door chooser for someone who has not decided, and a comparison table for
// someone who wants to check. Both read their numbers from lib/plan-compare,
// which reads them from the plan config.

import Link from 'next/link'
import { Check, ArrowRight } from 'lucide-react'
import { planCompareRows, trackCards } from '@/lib/plan-compare'

const AMZ = '#C2410C'
const LADDER = '#7C3AED'

/** "Which one am I?" — two doors, side by side, above everything else. */
export function TrackPicker() {
  const cards = trackCards()
  return (
    <section className="w-full max-w-5xl mb-14">
      <div className="text-center mb-6">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
          Two different products. Start with which one you are.
        </h2>
        <p className="mt-3 text-[15px] text-[#6e6e73] dark:text-[#ebebf0] max-w-2xl mx-auto">
          MVP is not one ladder. One plan is built for creators who live on their Amazon storefront
          and never touch a website. The other three are a blog and YouTube engine. The prices sit
          close together, so pick by what you post, not by the number.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {cards.map((c) => {
          const accent = c.key === 'amazon' ? AMZ : LADDER
          return (
            <div
              key={c.key}
              className="rounded-2xl p-6 flex flex-col bg-white dark:bg-[#1c1c1e]"
              style={{ border: `1px solid ${accent}55` }}
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: accent }}>{c.eyebrow}</p>
              <h3 className="text-xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">{c.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0]">{c.blurb}</p>
              {/* The tie-breaker, stated plainly. Somebody who is unsure after
                  the blurb is unsure because nobody told them the rule. */}
              <p className="mt-3 text-[13px] font-semibold flex items-start gap-1.5" style={{ color: accent }}>
                <Check size={14} className="mt-0.5 flex-shrink-0" />{c.tell}
              </p>
              <div className="mt-auto pt-5 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{c.price}</span>
                <Link
                  href={c.href}
                  className="inline-flex items-center gap-1 text-sm font-bold hover:opacity-80"
                  style={{ color: accent }}
                >
                  See it <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** The same difference as a table, for whoever wants to check rather than be
 *  told. Decisive rows are marked so the boundary between the two products is
 *  readable at a glance instead of being one row among ten equals. */
export function TrackCompare({ className = '' }: { className?: string }) {
  const rows = planCompareRows()
  return (
    <section className={`w-full max-w-4xl ${className}`}>
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
          Amazon Influencer vs the blog plans
        </h2>
        <p className="mt-2 text-[14px] text-[#6e6e73] dark:text-[#ebebf0]">
          The rows in bold are the ones that decide it.
        </p>
      </div>
      {/* Its own scroller: three columns of prose do not fit a phone, and the
          page body must never scroll sideways. */}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e]">
        <table className="w-full text-left" style={{ minWidth: 560, borderCollapse: 'collapse' }}>
          <thead>
            <tr className="border-b border-gray-200 dark:border-white/10">
              <th className="p-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#86868b]"> </th>
              <th className="p-3 text-[12px] font-bold" style={{ color: AMZ }}>Amazon Influencer</th>
              <th className="p-3 text-[12px] font-bold" style={{ color: LADDER }}>Creator · Studio · Pro</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-gray-100 dark:border-white/5 align-top">
                <td className={`p-3 text-[13px] ${r.decisive ? 'font-bold text-[#1d1d1f] dark:text-[#f5f5f7]' : 'text-[#6e6e73] dark:text-[#ebebf0]'}`}>
                  {r.label}
                </td>
                <td className={`p-3 text-[13px] leading-relaxed ${r.decisive ? 'font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]' : 'text-[#6e6e73] dark:text-[#ebebf0]'}`}>
                  {r.amazon}
                </td>
                <td className={`p-3 text-[13px] leading-relaxed ${r.decisive ? 'font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]' : 'text-[#6e6e73] dark:text-[#ebebf0]'}`}>
                  {r.ladder}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12.5px] text-[#86868b] dark:text-[#8e8e93] text-center">
        On Studio or Pro the whole Amazon toolkit is already included, on top of the blog engine.
      </p>
    </section>
  )
}
