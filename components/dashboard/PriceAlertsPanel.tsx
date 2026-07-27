// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Price Alerts — a dashboard box that surfaces Keepa-detected price events on
// products the creator watches (or has posted about): a genuine new all-time
// low ("re-share it now"), or a price that drifted away from what a published
// post claims ("refresh the post"). Powered by /api/price-watch, written by the
// check-price-watches cron.

'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, TrendingDown, RefreshCw, ExternalLink, X as CloseIcon, Send, Sparkles } from 'lucide-react'
import QuickPostModal, { type QuickPostDeal } from '@/components/deal/QuickPostModal'

interface PriceAlert {
  id: string
  asin: string
  kind: 'new_low' | 'stale_price' | 'new_niche_deal'
  title: string | null
  image_url: string | null
  price_now_cents: number | null
  price_ref_cents: number | null
  label: string | null
  blog_post_id: string | null
  seen: boolean
  created_at: string
}

const money = (cents: number | null) => (cents == null ? null : `$${(cents / 100).toFixed(2)}`)

export default function PriceAlertsPanel() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [amazonTag, setAmazonTag] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [repost, setRepost] = useState<QuickPostDeal | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/price-watch')
      const data = await res.json()
      if (res.ok) {
        setAlerts(Array.isArray(data.alerts) ? data.alerts : [])
        setAmazonTag(data.amazonTag || null)
      }
    } catch { /* silent — the box just stays empty */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const dismiss = async (id: string) => {
    setAlerts((a) => a.filter((x) => x.id !== id)) // optimistic
    try { await fetch('/api/price-watch/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) }) } catch { /* no-op */ }
  }
  const dismissAll = async () => {
    setAlerts([])
    try { await fetch('/api/price-watch/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) }) } catch { /* no-op */ }
  }

  const unseen = alerts.filter((a) => !a.seen)

  // Stay out of the way until we know there's something to show.
  if (loading || unseen.length === 0) return null

  const amazonUrl = (asin: string) =>
    amazonTag ? `https://www.amazon.com/dp/${asin}?tag=${encodeURIComponent(amazonTag)}` : `https://www.amazon.com/dp/${asin}`

  // Offer a one-tap re-share when the news is a price DROP worth posting: any
  // new all-time low, or a stale-price alert where the price fell.
  const canRepost = (a: PriceAlert) =>
    a.kind === 'new_low' || a.kind === 'new_niche_deal' ||
    (a.kind === 'stale_price' && a.price_now_cents != null && a.price_ref_cents != null && a.price_now_cents < a.price_ref_cents)

  return (
    <>
    <div className="rounded-2xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-600"><Bell size={15} /></span>
          Price Alerts
          <span className="text-xs font-bold rounded-full bg-amber-500 text-white px-2 py-0.5">{unseen.length}</span>
        </div>
        <button onClick={dismissAll} className="text-xs text-muted-foreground hover:text-foreground">Clear all</button>
      </div>

      <ul className="divide-y">
        {unseen.map((a) => {
          const head = a.kind === 'new_low'
            ? { icon: <TrendingDown size={13} />, cls: 'text-emerald-600', label: a.label || 'All-time low' }
            : a.kind === 'new_niche_deal'
              ? { icon: <Sparkles size={13} />, cls: 'text-violet-600 dark:text-violet-400', label: a.label || 'New deal in your niche' }
              : { icon: <RefreshCw size={13} />, cls: 'text-amber-600', label: a.label || 'Price changed' }
          return (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              {a.image_url
                ? <img src={a.image_url} alt="" className="h-12 w-12 rounded-lg object-contain bg-white border shrink-0" />
                : <div className="h-12 w-12 rounded-lg bg-muted shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <span className={`inline-flex items-center gap-1 ${head.cls}`}>{head.icon} {head.label}</span>
                  {money(a.price_now_cents) && <span className="text-muted-foreground">· now {money(a.price_now_cents)}</span>}
                </div>
                <div className="text-sm truncate">{a.title || a.asin}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {canRepost(a) && (
                  <button
                    onClick={() => setRepost({ asin: a.asin, title: a.title || a.asin, imageUrl: a.image_url })}
                    className="inline-flex items-center gap-1 text-xs font-semibold rounded-full bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 transition"
                  >
                    <Send size={12} /> Post the drop
                  </button>
                )}
                {a.kind === 'stale_price' && a.blog_post_id ? (
                  <Link href="/content" className="text-xs font-medium rounded-full border px-3 py-1.5 hover:bg-accent">Refresh post</Link>
                ) : (
                  <a href={amazonUrl(a.asin)} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1 text-xs font-medium rounded-full border px-3 py-1.5 hover:bg-accent">
                    <ExternalLink size={12} /> View
                  </a>
                )}
                <button onClick={() => dismiss(a.id)} title="Dismiss" className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                  <CloseIcon size={14} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
    {repost && <QuickPostModal deal={repost} onClose={() => setRepost(null)} />}
    </>
  )
}
