// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE WHOLE LADDER, ON THE AD PAGE, WITH A WAY TO BUY ANY RUNG.
//
// Both landing pages used to sell the free trial and nothing else. A visitor
// who was already convinced had one button, "Start free, no card", and no way
// to see what anything costs. Somebody ready to pay on the first visit had to
// leave and find the pricing page, and most of them do not come back.
//
// Three columns rather than one card, because the page is read by people at
// different distances from buying: free for the sceptic, and both paid plans
// side by side so the one the page is arguing for is chosen rather than merely
// offered. The page's own tier is the highlighted column.
//
// The toggle is monthly-first on purpose. Yearly is the better deal for us and
// for them, but a yearly figure shown first reads as the price, and $999 next
// to a competitor's $29 loses a reader who never sees the monthly number.
//
// EVERY FIGURE IS READ FROM TIERS AND EVERY SAVING IS COMPUTED. The marketing
// site has been wrong about its own prices and caps in nine places at once,
// every one understating the plan, and "Save $50" once sat beside a real saving
// of $80 because somebody typed it. scripts/test-sales-page holds this file to
// reading rather than repeating.

'use client'

import { useState } from 'react'
import { Check, ArrowRight } from 'lucide-react'
import { TIERS } from '@/lib/tier'

type PaidTier = 'amazon' | 'pro'

/** What the plan MAKES, in the order this buyer cares about. Read, not typed. */
function capsFor(tier: PaidTier): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = TIERS[tier] as any
  const n = (v: number | null | undefined) =>
    v === null || v === undefined ? 'Unlimited' : v.toLocaleString('en-US')
  // A cap of 0 means the feature is not on the plan. "0 a month" reads as a
  // broken number rather than an absence, so those rows never render.
  const rows: Array<[string, number | null | undefined]> = tier === 'amazon'
    ? [
        ['art-directed thumbnails a month', t.thumbnailsPerMonth],
        ['Pinterest pins a month', t.pinsPerMonth],
        ['Reels covers a month', t.igPostsPerMonth],
        ['Facebook designs a month', t.facebookPostsPerMonth],
        ['brand-deal messages a month', t.collabsPerMonth],
        ['face models', t.maxFaces],
      ]
    : [
        ['published articles a month', t.postsPerMonth],
        ['art-directed thumbnails a month', t.thumbnailsPerMonth],
        ['video scripts a month', t.scriptsPerMonth],
        ['WordPress sites', t.sites],
        ['newsletter subscribers', t.newsletterSubscribers],
        ['virtual assistant seats', t.vaSeats],
      ]
  return rows.filter(([, v]) => v !== 0).map(([label, v]) => `${n(v)} ${label}`)
}

const EXTRAS: Record<PaidTier, string> = {
  amazon: 'Passport geo-links, unlimited and no cost per click',
  pro: 'Passport geo-links, unlimited and no cost per click',
}

function PlanCard({
  name, blurb, price, priceSuffix, note, features, ctaLabel, ctaHref, highlight, ribbon,
}: {
  name: string
  blurb: string
  price: string
  priceSuffix: string
  note: string | null
  features: string[]
  ctaLabel: string
  ctaHref: string
  highlight: boolean
  ribbon: string | null
}) {
  return (
    <div
      className="relative rounded-[24px] border bg-white flex flex-col"
      style={{
        borderColor: highlight ? '#7C3AED' : 'rgba(0,0,0,0.10)',
        borderWidth: highlight ? 2 : 1,
        boxShadow: highlight ? '0 16px 50px rgba(124,58,237,0.16)' : 'none',
      }}
    >
      {ribbon && (
        <span
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[11px] font-bold uppercase tracking-[0.12em] text-white whitespace-nowrap"
          style={{ background: '#7C3AED' }}
        >
          {ribbon}
        </span>
      )}
      <div className="px-6 sm:px-7 pt-9 pb-6 text-center border-b" style={{ borderColor: 'rgba(0,0,0,0.07)' }}>
        <h3 className="text-[20px] font-extrabold tracking-tight" style={{ color: '#1D1D1F' }}>{name}</h3>
        <p className="mt-1.5 text-[13.5px] leading-snug" style={{ color: 'rgba(0,0,0,0.55)' }}>{blurb}</p>
        <div className="mt-5 flex items-end justify-center gap-1">
          <span className="text-[44px] font-extrabold tracking-[-0.04em] leading-none tabular-nums" style={{ color: '#1D1D1F' }}>
            {price}
          </span>
          <span className="text-[15px] pb-1.5" style={{ color: 'rgba(0,0,0,0.5)' }}>{priceSuffix}</span>
        </div>
        {/* Reserved whether or not there is a note, so the three cards keep
            their feature lists on one line as the toggle flips. */}
        <p className="mt-2 text-[12.5px] min-h-[18px]" style={{ color: highlight ? '#7C3AED' : 'rgba(0,0,0,0.45)' }}>
          {note ?? ''}
        </p>
      </div>

      <ul className="px-6 sm:px-7 py-6 flex flex-col gap-3 flex-1">
        {features.map((f) => (
          <li key={f} className="flex gap-2.5 text-[14px] leading-snug" style={{ color: 'rgba(0,0,0,0.72)' }}>
            <Check size={16} className="mt-0.5 flex-shrink-0" style={{ color: '#7C3AED' }} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="px-6 sm:px-7 pb-7">
        <a
          href={ctaHref}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-[15px] font-semibold transition-colors"
          style={highlight
            ? { background: '#7C3AED', color: '#fff', boxShadow: '0 4px 18px rgba(124,58,237,0.32)' }
            : { border: '1.5px solid rgba(0,0,0,0.14)', color: '#1D1D1F' }}
        >
          {ctaLabel}
          {highlight && <ArrowRight size={16} />}
        </a>
      </div>
    </div>
  )
}

export default function AdPricingTable({ focus, freeHref }: { focus: PaidTier; freeHref: string }) {
  const [yearly, setYearly] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priceOf = (k: PaidTier) => (TIERS[k] as any).price as number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const annualOf = (k: PaidTier) => ((TIERS[k] as any).annualPrice as number | null) ?? null

  // The biggest honest saving across the plans that offer one, as a percentage,
  // so the toggle can say what it is worth without naming a figure for a plan
  // the reader has not picked yet.
  const pcts = (['amazon', 'pro'] as PaidTier[])
    .map((k) => { const a = annualOf(k); return a ? Math.round((1 - a / (priceOf(k) * 12)) * 100) : 0 })
    .filter((p) => p > 0)
  const bestPct = pcts.length ? Math.max(...pcts) : 0

  const paid = (k: PaidTier) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = TIERS[k] as any
    const annual = annualOf(k)
    const showYear = yearly && annual !== null
    const saving = annual ? t.price * 12 - annual : 0
    return {
      name: t.label,
      blurb: k === 'amazon'
        ? 'Storefront and socials, no blog needed'
        : 'The whole pipeline, blog included',
      price: showYear ? `$${annual!.toLocaleString('en-US')}` : `$${t.price}`,
      priceSuffix: showYear ? '/yr' : '/mo',
      note: showYear
        ? `Saves $${saving.toLocaleString('en-US')} against monthly`
        : (annual ? `Or $${annual.toLocaleString('en-US')} a year` : null),
      features: [...capsFor(k), EXTRAS[k]],
      ctaLabel: `Get ${t.label}`,
      ctaHref: `/signup?tier=${k}&plan=paid&billing=${showYear ? 'annual' : 'monthly'}`,
    }
  }

  const amazon = paid('amazon')
  const pro = paid('pro')

  return (
    <div>
      {/* ── Monthly / yearly ──────────────────────────────────────────────
          Monthly is the default. A yearly figure shown first reads as the
          price, and the annual number beside a competitor's monthly one loses
          a reader before they find the comparable figure. */}
      {bestPct > 0 && (
        <div className="flex justify-center mb-9">
          <div className="inline-flex p-1 rounded-full border" style={{ borderColor: 'rgba(0,0,0,0.12)', background: '#fff' }}>
            <button
              type="button"
              onClick={() => setYearly(false)}
              aria-pressed={!yearly}
              className="px-5 py-2 rounded-full text-[14px] font-semibold transition-colors"
              style={!yearly ? { background: '#7C3AED', color: '#fff' } : { color: 'rgba(0,0,0,0.6)' }}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setYearly(true)}
              aria-pressed={yearly}
              className="px-5 py-2 rounded-full text-[14px] font-semibold transition-colors"
              style={yearly ? { background: '#7C3AED', color: '#fff' } : { color: 'rgba(0,0,0,0.6)' }}
            >
              Yearly <span className="font-bold" style={{ color: yearly ? '#fff' : '#7C3AED' }}>save {bestPct}%</span>
            </button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-5 items-stretch">
        <PlanCard
          name="Free"
          blurb="See it work before you decide"
          price={`$${TIERS.trial.price}`}
          priceSuffix="/forever"
          note="No card required"
          features={[
            `${TIERS.trial.lifetimeMax} full published reviews`,
            `${TIERS.trial.thumbnailsPerMonth} art-directed thumbnails`,
            `${TIERS.trial.maxFaces} face model, ${TIERS.trial.photoboothPerMonth} headshots`,
            'Your own blog, connected to your domain',
          ]}
          ctaLabel="Start free, no card"
          ctaHref={freeHref}
          highlight={false}
          ribbon={null}
        />
        {/* The page's own tier is the highlighted one. The other paid plan is
            still shown: a reader who arrived on the wrong page should find the
            right plan here rather than bounce. */}
        {(['amazon', 'pro'] as PaidTier[]).map((k) => {
          const d = k === 'amazon' ? amazon : pro
          const isFocus = k === focus
          return (
            <PlanCard
              key={k}
              name={d.name}
              blurb={d.blurb}
              price={d.price}
              priceSuffix={d.priceSuffix}
              note={d.note}
              features={d.features}
              ctaLabel={d.ctaLabel}
              ctaHref={d.ctaHref}
              highlight={isFocus}
              ribbon={isFocus ? 'Recommended' : null}
            />
          )
        })}
      </div>

      <p className="mt-7 text-center text-[13px]" style={{ color: 'rgba(0,0,0,0.5)' }}>
        30-day money-back guarantee on every paid plan. Cancel any time, and everything you have already made stays yours.
      </p>
    </div>
  )
}
