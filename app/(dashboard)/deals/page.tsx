// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Deals Hub page (Studio + Pro + Admin).
//
// User flow:
//   1. Paste an Amazon URL or ASIN.
//   2. Optional: promo code (string), promo URL (replaces the buy-button href).
//   3. Optional: pick an occasion (Prime Day, Black Friday, etc.) or leave
//      on "Auto-detect from today's date".
//   4. Optional: manual deal-end date when Amazon doesn't expose one.
//   5. Toggle: FULL AUTO (one-shot publish) vs LET ME SEE (preview the
//      scraped product + computed deal, edit, then publish).
//   6. Recent Deals list with View + Delete on each row.

'use client'

import { useEffect, useState, FormEvent } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  BadgePercent,
  Sparkles,
  ExternalLink,
  Loader2,
  ArrowRight,
  Zap,
  Eye,
  X,
  CheckCircle2,
  Trash2,
  Calendar,
  Clock,
  Tag,
  Link as LinkIcon,
  RotateCcw,
  DollarSign,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/useConfirm'
import DealsCsvImporter from './DealsCsvImporter'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { createBrowserClient } from '@/lib/supabase/client'
import { normalizeTier, type Tier } from '@/lib/tier'

interface DealRow {
  id: string
  title: string
  slug: string
  url: string | null
  wpPostId: number | null
  asin: string | null
  created_at: string
  seo_keyword: string | null
  occasion: string
  priceWas: string | null
  priceSale: string | null
  dealEndsAt: string | null
  /** 'published' (live now) or 'scheduled' (WP will publish at
   *  scheduledAt). Drives the per-row status pill on Recent Deals. */
  status?: string
  scheduledAt?: string | null
}

interface OccasionOption {
  slug: string
  label: string
  badgeLabel: string
}

interface ProductPreview {
  asin: string
  title: string
  price: string | null
  priceWas: string | null
  priceSale: string | null
  discountPct: number | null
  dealBadge: string | null
  dealEndsAt: string | null
  rating: string | null
  imageUrl: string | null
}

interface DealPreview {
  badgeLabel: string
  savingsLine: string | null
  hasExplicitDiscount: boolean
  mode: 'discount' | 'low_price_alert'
}

interface PreviewResp {
  preview: true
  product: ProductPreview
  deal: DealPreview
  occasion: { slug: string; label: string; badgeLabel: string }
  promo: { code: string | null; url: string | null }
}

type Mode = 'auto' | 'review'

export default function DealsHubPage() {
  const { confirm, ConfirmHost } = useConfirm()
  const [deals, setDeals] = useState<DealRow[]>([])
  const [occasions, setOccasions] = useState<OccasionOption[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  // When the server detects migration 093 hasn't been applied, this is set
  // to the migration name. The page renders a yellow banner at the top
  // with the SQL the user needs to run in Supabase. Without this, deal
  // posts publish to WP but never appear in Recent deals — exactly the
  // bug the user reported.
  const [migrationNeeded, setMigrationNeeded] = useState<string | null>(null)

  // Form state
  const [input, setInput] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [promoUrl, setPromoUrl] = useState('')
  const [occasion, setOccasion] = useState<string>('auto')
  const [manualDealEnd, setManualDealEnd] = useState<string>('')
  const [generating, setGenerating] = useState(false)

  // Full Auto vs Let-Me-See — persisted across visits.
  const [mode, setMode] = useState<Mode>('review')
  const [preview, setPreview] = useState<PreviewResp | null>(null)
  // Editable copy of preview values (so the user can adjust occasion/promo
  // before committing).
  const [previewOccasion, setPreviewOccasion] = useState<string>('auto')
  const [previewPromoCode, setPreviewPromoCode] = useState('')
  const [previewPromoUrl, setPreviewPromoUrl] = useState('')
  const [previewDealEnd, setPreviewDealEnd] = useState('')

  // Tier restructure 2026-06-04: Deals Hub is Studio + Pro only. Trial +
  // Creator see the FeatureLockedCard upsell. tier === null while loading
  // so non-Studio users don't see the form flash before the lock card.
  const [tier, setTier] = useState<Tier | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { if (!cancelled) setTier('trial'); return }
        const { data } = await supabase
          .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        if (!cancelled) setTier(normalizeTier((data as { tier?: string } | null)?.tier))
      } catch {
        if (!cancelled) setTier('trial')
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Load mode from localStorage on mount ────────────────────────────────
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('mvp_deals_mode')
      if (saved === 'auto' || saved === 'review') setMode(saved)
    } catch { /* ignore */ }
  }, [])

  function pickMode(m: Mode) {
    setMode(m)
    try { window.localStorage.setItem('mvp_deals_mode', m) } catch { /* ignore */ }
  }

  // ── Initial fetch: deal rows + occasion catalogue ───────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/deals')
        const j = await res.json() as {
          deals?: DealRow[]
          occasions?: OccasionOption[]
          error?: string
          dbError?: string
          migrationNeeded?: string
        }
        if (cancelled) return
        if (j.deals) setDeals(j.deals)
        if (j.occasions) setOccasions(j.occasions)
        if (j.migrationNeeded) setMigrationNeeded(j.migrationNeeded)
        if (j.dbError) toast.error(j.dbError)
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  // ── Submit handler. Calls /api/deals with preview when mode='review',
  //         straight publish when mode='auto'. ────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!input.trim() || generating) return

    setGenerating(true)
    try {
      const body: Record<string, unknown> = {
        url: input.trim(),
        promoCode: promoCode.trim() || undefined,
        promoUrl: promoUrl.trim() || undefined,
        occasion: occasion,
        manualDealEnd: manualDealEnd || undefined,
      }
      if (mode === 'review') body.preview = true

      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json()
      if (!res.ok) {
        toast.error(j.error || 'Generation failed')
        return
      }

      if (j.preview) {
        // Show the preview card — user edits then clicks Publish.
        setPreview(j as PreviewResp)
        setPreviewOccasion((j as PreviewResp).occasion.slug)
        setPreviewPromoCode((j as PreviewResp).promo.code || '')
        setPreviewPromoUrl((j as PreviewResp).promo.url || '')
        setPreviewDealEnd((j as PreviewResp).product.dealEndsAt || '')
        return
      }

      // Full auto path — publish completed.
      toast.success('Deal post published!', {
        action: j.url ? { label: 'View', onClick: () => window.open(j.url, '_blank') } : undefined,
      })
      if (j.migrationNeeded) setMigrationNeeded(j.migrationNeeded)
      // Reset + refresh.
      setInput('')
      setPromoCode('')
      setPromoUrl('')
      setManualDealEnd('')
      const list = await fetch('/api/deals').then(r => r.json()).catch(() => null)
      if (list?.deals) setDeals(list.deals)
      if (list?.migrationNeeded) setMigrationNeeded(list.migrationNeeded)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setGenerating(false)
    }
  }

  // ── Approve+Publish from preview ────────────────────────────────────────
  async function publishFromPreview() {
    if (!preview || generating) return
    setGenerating(true)
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: input.trim(),
          promoCode: previewPromoCode.trim() || undefined,
          promoUrl: previewPromoUrl.trim() || undefined,
          occasion: previewOccasion,
          manualDealEnd: previewDealEnd || undefined,
          // preview omitted → server runs the full publish path.
        }),
      })
      const j = await res.json()
      if (!res.ok) {
        toast.error(j.error || 'Publish failed')
        return
      }
      toast.success('Deal post published!', {
        action: j.url ? { label: 'View', onClick: () => window.open(j.url, '_blank') } : undefined,
      })
      // Reset preview + form, refresh list.
      setPreview(null)
      setInput('')
      setPromoCode('')
      setPromoUrl('')
      setManualDealEnd('')
      const list = await fetch('/api/deals').then(r => r.json()).catch(() => null)
      if (list?.deals) setDeals(list.deals)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setGenerating(false)
    }
  }

  // ── Refresh price on a deal ─────────────────────────────────────────────
  // Lighter cousin of Regenerate. Re-scrapes the product for current
  // pricing, runs a single Sonnet patch pass that updates ONLY the
  // price-bearing sentences (Deal at a glance section, hook savings
  // numbers, closing CTA, banner + end-of-article CTA atts), and UPDATES
  // the existing WP post in place — same URL, same SEO, same images,
  // same Why-this-deal / Before-you-buy paragraphs. ~15s vs ~45s for a
  // full regenerate.
  async function handleRefreshPrice(deal: DealRow) {
    const ok = await confirm({
      title: 'Refresh price on this deal?',
      description: `MVP will re-scrape Amazon for the latest pricing and update the deal box + savings line on "${deal.title}". The article body, images, and URL stay the same. Takes about 15 seconds.`,
      confirmLabel: 'Refresh price',
    })
    if (!ok) return

    setRefreshingId(deal.id)
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshPriceId: deal.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Refresh failed')
        return
      }
      const priceNote = j.newPrice ? ` New price: ${j.newPrice}.` : ''
      toast.success(`Price refreshed.${priceNote}`, {
        action: deal.url ? { label: 'View', onClick: () => window.open(deal.url!, '_blank') } : undefined,
      })
      // Refresh the list — same row id, but the priceWas/priceSale/end-date
      // pills under the row update to reflect the new data.
      const list = await fetch('/api/deals').then(r => r.json()).catch(() => null)
      if (list?.deals) setDeals(list.deals)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setRefreshingId(null)
    }
  }

  // ── Regenerate a deal ───────────────────────────────────────────────────
  // Re-runs the full generation pipeline (writer + images + WP publish)
  // using the same ASIN, promo code, promo URL, occasion, and end-date the
  // deal was originally created with. The server deletes the old WP post +
  // DB row after the new one safely publishes, so the row position in the
  // list naturally shifts to the top with a fresh created_at.
  async function handleRegenerate(deal: DealRow) {
    const ok = await confirm({
      title: 'Regenerate this deal post?',
      description: `MVP will re-write "${deal.title}" with the latest voice + layout. The current WordPress post will be replaced (same ASIN, same promo code if any). This takes 30-60 seconds.`,
      confirmLabel: 'Regenerate',
    })
    if (!ok) return

    setRegeneratingId(deal.id)
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerateId: deal.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Regenerate failed')
        return
      }
      toast.success('Deal post regenerated', {
        action: j.url ? { label: 'View', onClick: () => window.open(j.url, '_blank') } : undefined,
      })
      // Refresh the list — the old row is gone, the new one appears at the
      // top of the array (newest first by created_at).
      const list = await fetch('/api/deals').then(r => r.json()).catch(() => null)
      if (list?.deals) setDeals(list.deals)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setRegeneratingId(null)
    }
  }

  // ── Delete a deal ───────────────────────────────────────────────────────
  async function handleDelete(deal: DealRow) {
    const ok = await confirm({
      title: 'Delete this deal post?',
      description: `"${deal.title}" will be removed from WordPress and from your MVP library. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return

    setDeletingId(deal.id)
    // Optimistic remove.
    const prev = deals
    setDeals(prev.filter(d => d.id !== deal.id))
    try {
      const res = await fetch('/api/deals', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deal.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Delete failed')
        setDeals(prev) // rollback
      } else {
        toast.success('Deal deleted')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
      setDeals(prev)
    } finally {
      setDeletingId(null)
    }
  }

  // Tier gate — Trial + Creator see the upsell card instead of the form.
  // Render BEFORE everything else so the locked card replaces the page,
  // not appears alongside the deal form.
  if (tier !== null && tier !== 'studio' && tier !== 'pro' && tier !== 'admin') {
    return (
      <FeatureLockedCard
        icon={<BadgePercent size={28} strokeWidth={1.8} />}
        feature="Deals Hub"
        description="Paste an Amazon link (or any Geniuslink/amzn.to short link), optionally add a promo code, and MVP writes a timely deal post with a baked countdown thumbnail, end-date countdown, and your promo code wired into every CTA. Bulk-import a full Amazon Creator Connections CSV to schedule a month's worth of deal posts in one go."
        bullets={[
          'Single-link form: paste, customize, publish',
          'Bulk CSV import: drop the Amazon Associates "Export deals" file, generate or schedule rows individually',
          'Countdown banner + buy button wired into the deal end-date',
          'Promo-code support (writes the code into every CTA on the post)',
          'Occasion auto-detection (Prime Day, Black Friday, Lightning Deal, Lowest Price YTD, etc.)',
          'Refresh price action keeps live posts in sync with Amazon',
        ]}
        requiredTier="studio"
        currentTier={tier}
      />
    )
  }

  return (
    <>
      <ConfirmHost />
      <div className="flex flex-col gap-6">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" style={{ color: 'var(--fg)' }}>
              <BadgePercent className="w-7 h-7" style={{ color: '#7C3AED' }} />
              Deals Hub
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--fg-muted)' }}>
              Drop any product link, Amazon URL, Geniuslink, amzn.to short link, or a bare ASIN. The agent writes a timely deal post with a baked thumbnail, end-date countdown, and your promo code or special link wired into every CTA.
            </p>
          </div>
        </div>

        {/* Migration nag — server returned migrationNeeded=093_blog_posts_deal_meta.
            Without that column, INSERT errors and the WP post lives but the
            DB row never lands, so Recent deals stays empty even after a
            successful publish. We render the exact SQL the user needs to
            paste into Supabase (per the surface-migration-SQL house rule). */}
        {migrationNeeded && (
          <div className="rounded-2xl border p-4 bg-[#ff9500]/10 border-[#ff9500]/40">
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--fg)' }}>
              ⚠️ Database migration needed: <code className="text-xs">{migrationNeeded}</code>
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--fg-muted)' }}>
              Run this SQL in your Supabase project (SQL editor) so deal posts can save their pricing metadata. Without it, posts publish to WordPress but don&apos;t show up in Recent deals.
            </p>
            <pre className="text-[11px] p-3 rounded-lg overflow-x-auto bg-[#1d1d1f] text-[#f5f5f7] font-mono">{`alter table public.blog_posts
  add column if not exists deal_meta jsonb;

create index if not exists blog_posts_deal_meta_gin
  on public.blog_posts using gin (deal_meta)
  where deal_meta is not null;`}</pre>
            <p className="text-[11px] mt-2" style={{ color: 'var(--fg-muted)' }}>
              Safe to run multiple times (uses <code>if not exists</code>). The banner disappears once the column lands.
            </p>
          </div>
        )}

        {/* ── Mode toggle ────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 self-start">
          <button
            type="button"
            onClick={() => pickMode('auto')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              mode === 'auto'
                ? 'bg-[#7C3AED] text-white'
                : 'bg-gray-100 dark:bg-white/5 text-[#3a3a3c] dark:text-[#ebebf0] hover:bg-gray-200 dark:hover:bg-white/10'
            }`}
          >
            <Zap size={13} /> Full auto
          </button>
          <button
            type="button"
            onClick={() => pickMode('review')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              mode === 'review'
                ? 'bg-[#7C3AED] text-white'
                : 'bg-gray-100 dark:bg-white/5 text-[#3a3a3c] dark:text-[#ebebf0] hover:bg-gray-200 dark:hover:bg-white/10'
            }`}
          >
            <Eye size={13} /> Let me see
          </button>
          <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
            {mode === 'auto' ? 'One-shot publish.' : 'Preview the scraped product before publishing.'}
          </span>
        </div>

        {/* ── Preview card (review mode, after server returned data) ── */}
        {preview && (
          <div className="card p-6 border" style={{ borderColor: 'rgba(124,58,237,.3)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--fg)' }}>
                <CheckCircle2 size={16} className="text-[#34c759]" />
                Preview · ready to publish
              </h2>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] flex items-center gap-1"
                title="Cancel and pick a different product"
              >
                <X size={13} /> Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4 mb-4">
              {preview.product.imageUrl ? (
                <img
                  src={preview.product.imageUrl}
                  alt={preview.product.title}
                  className="w-full h-auto rounded-lg border border-gray-200 dark:border-white/10"
                />
              ) : (
                <div className="w-full aspect-square rounded-lg border border-dashed border-gray-300 dark:border-white/15 flex items-center justify-center text-xs text-[#86868b]">
                  No image
                </div>
              )}
              <div>
                <p className="text-sm font-semibold mb-2" style={{ color: 'var(--fg)' }}>{preview.product.title || '(no title scraped)'}</p>
                <div className="flex flex-wrap items-baseline gap-3 mb-2">
                  {preview.product.priceWas && (
                    <span className="text-sm line-through text-[#86868b]">{preview.product.priceWas}</span>
                  )}
                  {(preview.product.priceSale || preview.product.price) && (
                    <span className="text-lg font-bold text-[#34c759]">{preview.product.priceSale || preview.product.price}</span>
                  )}
                  {preview.deal.savingsLine && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold text-white bg-[#FF3B30]">
                      {preview.deal.savingsLine}
                    </span>
                  )}
                  {preview.deal.mode === 'low_price_alert' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#FF9500]/15 text-[#FF9500] border border-[#FF9500]/30">
                      No discount detected, posting as low-price alert
                    </span>
                  )}
                </div>
                {preview.product.dealBadge && (
                  <p className="text-xs text-[#86868b] mb-2">Amazon badge: <strong>{preview.product.dealBadge}</strong></p>
                )}
                {preview.product.rating && (
                  <p className="text-xs text-[#86868b]">Rating: {preview.product.rating}/5</p>
                )}
              </div>
            </div>

            {/* Editable knobs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#86868b]">Occasion</label>
                <select
                  value={previewOccasion}
                  onChange={(e) => setPreviewOccasion(e.target.value)}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] px-3 py-2"
                >
                  <option value="auto">Auto-detect from today&apos;s date</option>
                  {occasions.map(o => (
                    <option key={o.slug} value={o.slug}>{o.label} ({o.badgeLabel})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#86868b]">Deal end date (optional)</label>
                <input
                  type="date"
                  value={previewDealEnd.slice(0, 10)}
                  onChange={(e) => setPreviewDealEnd(e.target.value)}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#86868b]">Promo code (optional)</label>
                <input
                  type="text"
                  placeholder="SAVE20"
                  value={previewPromoCode}
                  onChange={(e) => setPreviewPromoCode(e.target.value)}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#86868b]">Special promo URL (optional)</label>
                <input
                  type="url"
                  placeholder="https://amzn.to/special-deal"
                  value={previewPromoUrl}
                  onChange={(e) => setPreviewPromoUrl(e.target.value)}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] px-3 py-2"
                />
              </div>
            </div>

            <Button onClick={publishFromPreview} disabled={generating} className="w-full sm:w-auto">
              {generating ? <><Loader2 size={14} className="animate-spin" /> Publishing...</> : <><Sparkles size={14} /> Write the deal post & publish</>}
            </Button>
          </div>
        )}

        {/* ── Input form (hide when previewing) ───────────────────────── */}
        {!preview && (
          <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-[#86868b]" htmlFor="deal-product">
                Product link or Amazon ASIN
              </label>
              <div className="relative">
                <LinkIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none" />
                <input
                  id="deal-product"
                  type="text"
                  required
                  placeholder="https://www.amazon.com/dp/...   ·   https://geni.us/...   ·   https://amzn.to/...   ·   B0XXXXXXXX"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={generating}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] pl-9 pr-3 py-2.5"
                />
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--fg-muted)' }}>
                Paste any link, Amazon URL, Geniuslink, amzn.to / a.co short link, or a bare ASIN. The agent unwraps the link, reads the underlying Amazon listing for the current price, the strike-through &quot;was&quot; price, any deal badge (Lightning Deal, Prime Day, etc.), and the expiration date if Amazon shows one.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-[#86868b]" htmlFor="deal-promo-code">
                  <Tag size={11} className="inline mr-1" /> Promo code (optional)
                </label>
                <input
                  id="deal-promo-code"
                  type="text"
                  placeholder="SAVE20"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  disabled={generating}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-[#86868b]" htmlFor="deal-promo-url">
                  <LinkIcon size={11} className="inline mr-1" /> Special promo URL (optional)
                </label>
                <input
                  id="deal-promo-url"
                  type="url"
                  placeholder="https://amzn.to/special-deal"
                  value={promoUrl}
                  onChange={(e) => setPromoUrl(e.target.value)}
                  disabled={generating}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-[#86868b]" htmlFor="deal-occasion">
                  <Sparkles size={11} className="inline mr-1" /> Occasion
                </label>
                <select
                  id="deal-occasion"
                  value={occasion}
                  onChange={(e) => setOccasion(e.target.value)}
                  disabled={generating}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] px-3 py-2"
                >
                  <option value="auto">Auto-detect from today&apos;s date</option>
                  {occasions.map(o => (
                    <option key={o.slug} value={o.slug}>{o.label} ({o.badgeLabel})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-[#86868b]" htmlFor="deal-end-date">
                  <Calendar size={11} className="inline mr-1" /> Deal end date (optional)
                </label>
                <input
                  id="deal-end-date"
                  type="date"
                  value={manualDealEnd}
                  onChange={(e) => setManualDealEnd(e.target.value)}
                  disabled={generating}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] px-3 py-2"
                />
              </div>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
                Promo code lands in the deal-box CTA copy. Promo URL replaces every buy-button href. Both can coexist.
              </p>
              <Button type="submit" disabled={generating || !input.trim()}>
                {generating ? (
                  <><Loader2 size={14} className="animate-spin" /> {mode === 'auto' ? 'Publishing...' : 'Reading the listing...'}</>
                ) : (
                  <><Sparkles size={14} /> {mode === 'auto' ? 'Generate & publish' : 'Preview the deal'} <ArrowRight size={13} /></>
                )}
              </Button>
            </div>
          </form>
        )}

        {/* ── Bulk CSV import (Amazon Creator Connections) ──────────── */}
        {/* Mounted between the single-product form and Recent Deals so
            users see it after they've made one deal post the "manual"
            way and want to scale up to a whole calendar of upcoming
            deals. onDealsChanged refreshes the Recent Deals list after
            each row publishes/schedules. */}
        <DealsCsvImporter
          onDealsChanged={() => {
            fetch('/api/deals')
              .then((r) => r.json())
              .then((j) => { if (j?.deals) setDeals(j.deals) })
              .catch(() => {})
          }}
        />

        {/* ── Recent deals list ──────────────────────────────────────── */}
        <div className="card p-6">
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--fg)' }}>Recent deals</h2>
          {loading ? (
            <p className="text-xs flex items-center gap-2" style={{ color: 'var(--fg-muted)' }}>
              <Loader2 size={12} className="animate-spin" /> Loading...
            </p>
          ) : deals.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
              No deal posts yet. Paste a product link above to ship your first one.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100 dark:divide-white/10">
              {deals.map(d => {
                const isDeleting = deletingId === d.id
                const isRegenerating = regeneratingId === d.id
                const isRefreshing = refreshingId === d.id
                // Any row-level operation in flight disables the others on
                // THIS row so the user can't double-fire. Doesn't block
                // operations on other rows.
                const rowBusy = isDeleting || isRegenerating || isRefreshing
                // Regenerate AND Refresh Price both need the saved ASIN.
                // Pre-meta legacy rows (rare; only matter for deals created
                // before the feature shipped) can't be replayed.
                const canRegenerate = !!d.asin
                const canRefresh = !!d.asin
                return (
                  <li key={d.id} className="py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{d.title}</p>
                      <div className="text-[11px] flex items-center gap-3 mt-0.5" style={{ color: 'var(--fg-muted)' }}>
                        <span>{new Date(d.created_at).toLocaleDateString()}</span>
                        {/* Scheduled pill: WP will publish this row at
                            d.scheduledAt. Wins visual priority over the
                            "ends" pill because the user's mental model is
                            "this hasn't gone live yet". */}
                        {d.status === 'scheduled' && d.scheduledAt && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#F59E0B]/15 text-[#F59E0B] text-[10px] font-semibold">
                            <Clock size={10} /> Publishes {new Date(d.scheduledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </span>
                        )}
                        {d.priceWas && d.priceSale && (
                          <span>
                            <span className="line-through">{d.priceWas}</span> → <span className="font-semibold text-[#34c759]">{d.priceSale}</span>
                          </span>
                        )}
                        {d.dealEndsAt && (
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={10} /> Ends {String(d.dealEndsAt).slice(0, 10)}
                          </span>
                        )}
                        {d.occasion && d.occasion !== 'none' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-semibold">
                            {d.occasion.replace(/_/g, ' ')}
                          </span>
                        )}
                        {isRegenerating && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#ff9500]/15 text-[#ff9500] text-[10px] font-semibold">
                            <Loader2 size={10} className="animate-spin" /> Regenerating...
                          </span>
                        )}
                        {isRefreshing && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#34c759]/15 text-[#34c759] text-[10px] font-semibold">
                            <Loader2 size={10} className="animate-spin" /> Refreshing price...
                          </span>
                        )}
                      </div>
                    </div>
                    {d.url && (
                      <Link
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs inline-flex items-center gap-1 text-[#7C3AED] hover:underline"
                      >
                        View <ExternalLink size={11} />
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRefreshPrice(d)}
                      disabled={rowBusy || !canRefresh}
                      className="p-1.5 rounded-md text-[#34c759] hover:bg-[#34c759]/10 disabled:opacity-40"
                      title={canRefresh ? 'Refresh the price on this deal (keeps article + images, updates only the numbers)' : 'This deal predates the refresh feature'}
                      aria-label={`Refresh price on ${d.title}`}
                    >
                      {isRefreshing ? <Loader2 size={13} className="animate-spin" /> : <DollarSign size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRegenerate(d)}
                      disabled={rowBusy || !canRegenerate}
                      className="p-1.5 rounded-md text-[#7C3AED] hover:bg-[#7C3AED]/10 disabled:opacity-40"
                      title={canRegenerate ? 'Regenerate this deal post with the latest voice + layout' : 'This deal predates the regenerate feature, delete and re-paste the link instead'}
                      aria-label={`Regenerate ${d.title}`}
                    >
                      {isRegenerating ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(d)}
                      disabled={rowBusy}
                      className="p-1.5 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 disabled:opacity-40"
                      title="Delete this deal post"
                      aria-label={`Delete ${d.title}`}
                    >
                      {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
