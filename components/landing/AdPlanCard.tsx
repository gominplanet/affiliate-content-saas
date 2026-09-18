// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PLAN, ON THE AD PAGE, WITH A WAY TO BUY IT.
//
// Both landing pages sold the free trial and nothing else. A visitor who was
// already convinced had one button, "Start free, no card", and no way to see
// what the plan costs or what is in it. Somebody ready to pay on the first
// visit had to go and find the pricing page, and most of them do not.
//
// So the page now ends the argument with the offer: the price, what the month
// actually contains, the yearly option, and two buttons — start free, or go
// straight to the plan.
//
// EVERY NUMBER IS READ FROM TIERS. The marketing site has been wrong about its
// own prices and caps in nine places at once, every one of them understating
// the plan, which is why scripts/test-sales-page-facts exists. Nothing here is
// typed by hand.

import { Check, ArrowRight } from 'lucide-react'
import { TIERS, type Tier } from '@/lib/tier'

/** A cap worth putting in front of a buyer, in the order a buyer cares. */
type Row = { label: string; value: number | null | undefined; unit: string }

function rows(tier: Tier): Row[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = TIERS[tier] as any
  const all: Row[] = tier === 'amazon'
    ? [
        { label: 'Art-directed thumbnails', value: t.thumbnailsPerMonth, unit: 'a month' },
        { label: 'Pinterest pins', value: t.pinsPerMonth, unit: 'a month' },
        { label: 'Instagram / Reels covers', value: t.igPostsPerMonth, unit: 'a month' },
        { label: 'Facebook designs', value: t.facebookPostsPerMonth, unit: 'a month' },
        { label: 'Brand-deal outreach messages', value: t.collabsPerMonth, unit: 'a month' },
        { label: 'Face models', value: t.maxFaces, unit: '' },
        { label: 'Photobooth headshots', value: t.photoboothPerMonth, unit: 'a month' },
      ]
    : [
        { label: 'Published articles', value: t.postsPerMonth, unit: 'a month' },
        { label: 'Art-directed thumbnails', value: t.thumbnailsPerMonth, unit: 'a month' },
        { label: 'Social designs', value: t.socialDesignsPerMonth ?? t.pinsPerMonth, unit: 'a month' },
        { label: 'Video scripts', value: t.scriptsPerMonth, unit: 'a month' },
        { label: 'WordPress sites', value: t.sites, unit: '' },
        { label: 'Newsletter subscribers', value: t.newsletterSubscribers, unit: '' },
        { label: 'Virtual assistant seats', value: t.vaSeats, unit: '' },
      ]
  // A cap of 0 means the feature is not on the plan. Printing "0 a month" reads
  // as a broken number rather than as an absence, so the row is dropped.
  return all.filter((r) => r.value !== 0)
}

const fmt = (v: number | null | undefined, unit: string): string => {
  if (v === null || v === undefined) return `Unlimited${unit ? ` ${unit}` : ''}`
  return `${v.toLocaleString('en-US')}${unit ? ` ${unit}` : ''}`
}

/** Everything on every paid plan, so the caps above are not the whole pitch. */
const ALWAYS: Record<'amazon' | 'pro', string[]> = {
  amazon: [
    'Passport geo-links: every shopper routed to their own country’s Amazon, unlimited, no cost per click',
    'Your look applied to every design, picked once and changeable any time',
    'Scheduling and publishing to every connected network',
    'Creator Connections campaigns surfaced daily, with the first message written',
  ],
  pro: [
    'Passport geo-links: every shopper routed to their own country’s Amazon, unlimited, no cost per click',
    'Articles written from your own transcript, in your voice',
    'Broken and off-style affiliate links found and repaired, counted link by link',
    'Vertical clips cut from your long videos, captioned and shoppable',
  ],
}

export default function AdPlanCard({
  tier, ctaHref, freeHref, freeLabel,
}: {
  tier: 'amazon' | 'pro'
  /** Straight to checkout for this plan. */
  ctaHref: string
  /** The no-card path, kept as the quieter option beside it. */
  freeHref: string
  freeLabel: string
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = TIERS[tier] as any
  const annual: number | null = t.annualPrice ?? null
  // COMPUTED, never typed. "Save $50" sat next to a real saving of $80 on the
  // pricing page for months because somebody typed it.
  const annualSaving = annual ? t.price * 12 - annual : 0

  return (
    <div className="rounded-[26px] border bg-white overflow-hidden" style={{ borderColor: 'rgba(124,58,237,0.28)', boxShadow: '0 12px 40px rgba(124,58,237,0.10)' }}>
      <div className="px-7 sm:px-9 pt-8 pb-7" style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.10), rgba(124,58,237,0.02))' }}>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#7C3AED' }}>
          {t.label} plan
        </p>
        <div className="mt-3 flex items-end gap-2.5 flex-wrap">
          <span className="text-[46px] font-extrabold tracking-[-0.04em] leading-none" style={{ color: '#1D1D1F' }}>
            ${t.price}
          </span>
          <span className="text-[15px] pb-1.5" style={{ color: 'rgba(0,0,0,0.55)' }}>per month</span>
          {t.regularPrice > t.price && (
            <span className="text-[15px] pb-1.5 line-through" style={{ color: 'rgba(0,0,0,0.35)' }}>
              ${t.regularPrice}
            </span>
          )}
        </div>
        {annual && (
          <p className="mt-2.5 text-[13.5px]" style={{ color: 'rgba(0,0,0,0.62)' }}>
            Or <span className="font-semibold" style={{ color: '#1D1D1F' }}>${annual.toLocaleString('en-US')} a year</span>, which saves you ${annualSaving.toLocaleString('en-US')}.
          </p>
        )}
      </div>

      <div className="px-7 sm:px-9 py-7">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-4" style={{ color: 'rgba(0,0,0,0.42)' }}>
          Every month you get
        </p>
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
          {rows(tier).map((r) => (
            <li key={r.label} className="flex items-baseline justify-between gap-3 text-[14px] border-b pb-2.5" style={{ borderColor: 'rgba(0,0,0,0.07)' }}>
              <span style={{ color: 'rgba(0,0,0,0.68)' }}>{r.label}</span>
              <span className="font-bold whitespace-nowrap tabular-nums" style={{ color: '#1D1D1F' }}>{fmt(r.value, r.unit)}</span>
            </li>
          ))}
        </ul>

        <ul className="mt-6 flex flex-col gap-2.5">
          {ALWAYS[tier].map((line) => (
            <li key={line} className="flex gap-2.5 text-[14px] leading-relaxed" style={{ color: 'rgba(0,0,0,0.68)' }}>
              <Check size={16} className="mt-0.5 flex-shrink-0" style={{ color: '#34c759' }} />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {/* TWO DOORS, and the order is deliberate. The paid button is the loud
            one because this block exists for the visitor who is already
            convinced and had nowhere to go. The free path stays right beside
            it, because it is still the lower-risk way in and it is what the ad
            promised. */}
        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <a
            href={ctaHref}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-4 text-[15px] font-semibold text-white transition-colors flex-1"
            style={{ background: '#7C3AED', boxShadow: '0 4px 20px rgba(124,58,237,0.32)' }}
          >
            Get {t.label} for ${t.price}/mo <ArrowRight size={16} />
          </a>
          <a
            href={freeHref}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-4 text-[15px] font-semibold border transition-colors flex-1"
            style={{ borderColor: 'rgba(0,0,0,0.14)', color: '#1D1D1F' }}
          >
            {freeLabel}
          </a>
        </div>
        <p className="mt-3 text-center text-[12.5px]" style={{ color: 'rgba(0,0,0,0.5)' }}>
          30-day money-back guarantee. Cancel any time, and the work you have already made stays yours.
        </p>
      </div>
    </div>
  )
}
