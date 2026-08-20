'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ProductSignalCard — the ONE product card used across Deal Radar, AMZ Research
// and CC Browse. "Signal-dense" layout (direction A, chosen 2026-08): brand
// eyebrow, title, price, then every Keepa signal on the face — rating + monthly
// sales, sales rank + its named category, the rank trend (rising/slipping vs the
// 90-day average), product age, the variation-family ASIN, carousel video, deal
// quality and estimated commission.
//
// It owns the VISUAL only. Each surface passes its normalized product as `model`
// and supplies its own action buttons via `footer` (plus `overlays` for image
// badges and `extra` for a campaign block), so the busy per-surface logic
// (quick-post, locked/tier states, save, message-brand) stays where it lives.
// Tokens are shadcn/Tailwind (bg-card, text-muted-foreground, …) so both themes
// resolve without per-surface CSS.

import type { ReactNode } from 'react'
import {
  Star, TrendingUp, TrendingDown, Minus, BarChart3, CalendarDays, Layers, Video, Coins,
} from 'lucide-react'
import { formatSalesRank, formatAgeWithDate, formatRankTrend } from '@/lib/product-card-signals'

export interface ProductCardModel {
  asin?: string | null
  parentAsin?: string | null
  imageUrl?: string | null
  /** Where the image links (usually the tagged Amazon URL). Omit for no link. */
  imageHref?: string | null
  brand?: string | null
  title?: string | null
  /** Prices in DOLLARS (not cents). */
  priceNow?: number | null
  priceWas?: number | null
  discountPct?: number | null
  rating?: number | null
  reviewCount?: number | null
  monthlySold?: number | null
  hasVideo?: boolean | null
  salesRank?: number | null
  salesRankAvg90?: number | null
  salesRankCategory?: string | null
  category?: string | null
  listedSince?: string | null
  /** Deal-quality sentence, e.g. "32% below its usual price". */
  qualityLabel?: string | null
  /** Estimated per-sale commission. cents = amount; ratePct/isBounty label it. */
  commission?: { cents: number; ratePct?: number | null; isBounty?: boolean } | null
}

const money = (n?: number | null) => (n == null ? null : `$${n.toFixed(2)}`)

export default function ProductSignalCard({
  model: m,
  overlays,
  extra,
  footer,
  aspect = '4 / 3',
  className = '',
}: {
  model: ProductCardModel
  /** Absolutely-positioned nodes over the image (badges, a Data button). */
  overlays?: ReactNode
  /** Rendered after the signal rows, before the footer (campaign block, verdict). */
  extra?: ReactNode
  /** The action area at the bottom of the card. */
  footer?: ReactNode
  aspect?: string
  className?: string
}) {
  const rank = formatSalesRank(m.salesRank, m.salesRankCategory)
  const trend = formatRankTrend(m.salesRank, m.salesRankAvg90)
  const age = formatAgeWithDate(m.listedSince)
  const TrendIcon = trend?.direction === 'rising' ? TrendingUp : trend?.direction === 'slipping' ? TrendingDown : Minus
  const trendColor = trend?.direction === 'rising'
    ? 'text-emerald-600 dark:text-emerald-400'
    : trend?.direction === 'slipping'
    ? 'text-rose-600 dark:text-rose-400'
    : 'text-muted-foreground'

  const ImageInner = (
    <>
      {m.imageUrl
        ? <img loading="lazy" decoding="async" src={m.imageUrl} alt="" className="absolute inset-0 w-full h-full object-contain p-3" />
        : <div className="absolute inset-0 grid place-items-center text-violet-300 dark:text-violet-500/40"><BarChart3 size={26} /></div>}
      {m.discountPct != null && m.discountPct > 0 && (
        <span className="absolute top-2 left-2 z-10 text-[11px] font-bold bg-red-600 text-white rounded-full px-2 py-0.5">-{m.discountPct}%</span>
      )}
      {overlays}
    </>
  )

  return (
    <div className={`rounded-xl border bg-card overflow-hidden flex flex-col h-full transition-shadow hover:shadow-md ${className}`}>
      {m.imageHref
        ? <a href={m.imageHref} target="_blank" rel="noopener noreferrer" className="relative block bg-white" style={{ aspectRatio: aspect }}>{ImageInner}</a>
        : <div className="relative bg-white" style={{ aspectRatio: aspect }}>{ImageInner}</div>}

      <div className="p-3 flex flex-col gap-1.5 flex-1">
        {m.brand && <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">{m.brand}</div>}
        <div className="text-sm font-medium line-clamp-2 leading-snug min-h-[2.5rem]">
          {m.title || <span className="font-mono text-[11px] text-muted-foreground">{m.asin}</span>}
        </div>

        {(money(m.priceNow) || money(m.priceWas)) && (
          <div className="flex items-center gap-2">
            {money(m.priceNow) && <span className="text-base font-bold tabular-nums">{money(m.priceNow)}</span>}
            {money(m.priceWas) && m.priceWas! > (m.priceNow ?? 0) && (
              <span className="text-xs text-muted-foreground line-through tabular-nums">{money(m.priceWas)}</span>
            )}
          </div>
        )}

        {(m.rating != null || m.monthlySold != null) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {m.rating != null && (
              <span className="inline-flex items-center gap-1">
                <Star size={12} className="fill-amber-400 text-amber-400" /> <span className="tabular-nums">{m.rating.toFixed(1)}</span>
                {m.reviewCount != null && <span className="tabular-nums">({m.reviewCount.toLocaleString()})</span>}
              </span>
            )}
            {m.monthlySold != null && (
              <span className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400">
                <TrendingUp size={12} /> <span className="tabular-nums">{m.monthlySold.toLocaleString()}+</span> bought/mo
              </span>
            )}
          </div>
        )}

        {(rank || trend || (!rank && m.category) || age || m.parentAsin) && (
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {rank && <span className="inline-flex items-center gap-1"><BarChart3 size={12} /> {rank}</span>}
            {trend && (
              <span className={`inline-flex items-center gap-1 font-medium ${trendColor}`} title={`${trend.label}: ${trend.detail}`}>
                <TrendIcon size={12} /> {trend.label} <span className="font-normal text-muted-foreground">{trend.detail}</span>
              </span>
            )}
            {!rank && m.category && <span className="inline-flex items-center gap-1"><Layers size={12} /> {m.category}</span>}
            {age && <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> {age}</span>}
            {m.parentAsin && m.asin && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] opacity-70"
                    title={m.parentAsin !== m.asin ? `One variation of family ${m.parentAsin}` : 'Standalone listing'}>
                <Layers size={11} /> {m.asin}{m.parentAsin !== m.asin ? ' · variation' : ''}
              </span>
            )}
          </div>
        )}

        {m.hasVideo && (
          <div className="inline-flex items-center gap-1 text-xs font-medium text-fuchsia-600 dark:text-fuchsia-400 w-fit"
               title="This listing has a product-carousel video — great for a Short or Reel">
            <Video size={12} /> Has video
          </div>
        )}

        {m.qualityLabel && (
          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5 w-fit">
            ✓ {m.qualityLabel}
          </div>
        )}

        {m.commission != null && m.commission.cents > 0 && (
          <div className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 w-fit"
               title={m.commission.isBounty ? 'Creator Connections bounty rate' : 'Estimated Amazon commission (category rate)'}>
            <Coins size={12} /> ≈ {money(m.commission.cents / 100)}/sale
            {m.commission.ratePct != null && (
              <span className="font-normal text-muted-foreground">· {m.commission.isBounty ? `${m.commission.ratePct}% bounty` : `${m.commission.ratePct}% est`}</span>
            )}
          </div>
        )}

        {extra}

        {footer && <div className="mt-auto pt-2 space-y-1.5">{footer}</div>}
      </div>
    </div>
  )
}
