// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Daily CC Campaign Digest — a dashboard card that surfaces ~25 Creator
// Connections campaigns picked FOR this creator each day, matched to their blog
// + YouTube topics (see /api/cc-digest). Per card the creator can buy the
// product, message the brand, or spin up a blog post from it — and thumbs each
// one up/down so tomorrow's picks realign. No campaign is ever shown twice.
//
// Self-hiding, like PriceAlertsPanel: stays out of the way until the API says
// there's a batch to show (and the user is CC-verified).

'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Sparkles, ExternalLink, MessageSquare, PenLine, ThumbsUp, ThumbsDown,
  Star, Clock, Users,
} from 'lucide-react'
import MessageBrandModal, { type MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'
import { FromLinkModal } from '@/components/content/FromLinkModal'
import { requestFindCampaign } from '@/lib/extension-frame'

interface DigestCampaign {
  campaignId: string
  name: string
  brand: string | null
  asin: string
  category: string | null
  commissionPct: number | null
  price: number | null
  priceWas: number | null
  discountPct: number | null
  rating: number | null
  reviewCount: number | null
  monthlySold: number | null
  imageUrl: string | null
  slotsOpen: number | null
  totalSlot: number | null
  daysLeft: number | null
  budgetPct: number | null
  buyUrl: string
  detailsUrl: string
}

const INITIAL_VISIBLE = 6

export default function DailyCcDigest() {
  const [campaigns, setCampaigns] = useState<DigestCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [reactions, setReactions] = useState<Record<string, 'up' | 'down'>>({})
  const [msgModal, setMsgModal] = useState<MessageBrandCampaign | null>(null)
  const [createFor, setCreateFor] = useState<DigestCampaign | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/cc-digest')
      const data = await res.json()
      if (res.ok && Array.isArray(data.campaigns)) setCampaigns(data.campaigns)
    } catch { /* silent — the card just stays hidden */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const react = async (campaignId: string, feedback: 'up' | 'down') => {
    // Toggle off if tapping the same thumb again.
    const next = reactions[campaignId] === feedback ? null : feedback
    setReactions((r) => {
      const copy = { ...r }
      if (next) copy[campaignId] = next
      else delete copy[campaignId]
      return copy
    })
    try {
      await fetch('/api/cc-digest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, feedback: next }),
      })
      if (next === 'down') toast.message('Got it — fewer like this next time.')
      else if (next === 'up') toast.message('Noted — more like this.')
    } catch { /* optimistic; ignore write failure */ }
  }

  // Stay hidden until we know there's a batch to show.
  if (loading || campaigns.length === 0) return null

  const shown = showAll ? campaigns : campaigns.slice(0, INITIAL_VISIBLE)

  return (
    <>
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300">
              <Sparkles size={15} />
            </span>
            Campaigns picked for you
            <span className="text-xs font-bold rounded-full bg-violet-600 text-white px-2 py-0.5">{campaigns.length}</span>
          </div>
          <span className="text-[11px] text-muted-foreground">Fresh daily · matched to your content</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-3">
          {shown.map((c) => (
            <CampaignCard
              key={c.campaignId}
              c={c}
              reaction={reactions[c.campaignId] ?? null}
              onReact={react}
              onContact={() => setMsgModal({
                product: c.name, asin: c.asin, commissionPct: c.commissionPct,
                detailsUrl: c.detailsUrl, brandLabel: c.brand || undefined,
              })}
              onCreate={() => setCreateFor(c)}
            />
          ))}
        </div>

        {campaigns.length > INITIAL_VISIBLE && (
          <div className="px-4 py-3 border-t text-center">
            <button
              onClick={() => setShowAll((v) => !v)}
              className="text-xs font-semibold text-violet-600 dark:text-violet-400 hover:underline"
            >
              {showAll ? 'Show fewer' : `Show all ${campaigns.length}`}
            </button>
          </div>
        )}
      </div>

      {msgModal && (
        <MessageBrandModal
          campaign={msgModal}
          onClose={() => setMsgModal(null)}
          onSent={() => setMsgModal(null)}
          onFindCampaign={() => requestFindCampaign(msgModal.brandLabel || msgModal.product || '', msgModal.asin || '')}
        />
      )}
      {createFor && (
        <FromLinkModal
          initialLink={createFor.asin}
          initialName={createFor.name}
          initialCategory={createFor.category || ''}
          onClose={() => setCreateFor(null)}
          onDone={() => setCreateFor(null)}
        />
      )}
    </>
  )
}

function CampaignCard({ c, reaction, onReact, onContact, onCreate }: {
  c: DigestCampaign
  reaction: 'up' | 'down' | null
  onReact: (id: string, f: 'up' | 'down') => void
  onContact: () => void
  onCreate: () => void
}) {
  return (
    <div className="rounded-xl border p-3 flex flex-col gap-2 bg-background/40">
      <div className="flex gap-3">
        {c.imageUrl
          ? <img src={c.imageUrl} alt="" className="h-16 w-16 rounded-lg object-contain bg-white border shrink-0" loading="lazy" decoding="async" />
          : <div className="h-16 w-16 rounded-lg bg-muted shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug line-clamp-2">{c.name}</p>
          {c.brand && <p className="text-xs text-muted-foreground truncate">{c.brand}</p>}
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {c.commissionPct != null && (
              <span className="text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 px-2 py-0.5">
                {c.commissionPct}% commission
              </span>
            )}
            {c.price != null && (
              <span className="text-[10px] font-semibold rounded-full border px-2 py-0.5 text-muted-foreground">
                ${c.price.toFixed(0)}
              </span>
            )}
            {c.rating != null && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold rounded-full border px-2 py-0.5 text-muted-foreground">
                <Star size={9} className="fill-amber-400 text-amber-400" /> {c.rating.toFixed(1)}
              </span>
            )}
            {c.daysLeft != null && c.daysLeft >= 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold rounded-full border px-2 py-0.5 text-muted-foreground">
                <Clock size={9} /> {c.daysLeft}d
              </span>
            )}
            {c.slotsOpen != null && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold rounded-full border px-2 py-0.5 text-muted-foreground">
                <Users size={9} /> {c.slotsOpen} spots
              </span>
            )}
          </div>
        </div>
      </div>

      {c.category && (
        <p className="text-[11px] text-muted-foreground">
          Matches your <span className="font-semibold text-foreground">{c.category}</span> content
        </p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1">
        <a
          href={c.buyUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold rounded-full bg-orange-500 hover:bg-orange-600 text-white px-2.5 py-1.5 transition"
        >
          <ExternalLink size={12} /> Buy
        </a>
        <button
          onClick={onContact}
          className="inline-flex items-center gap-1 text-xs font-medium rounded-full border px-2.5 py-1.5 hover:bg-accent"
        >
          <MessageSquare size={12} /> Contact
        </button>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1 text-xs font-medium rounded-full border px-2.5 py-1.5 hover:bg-accent"
        >
          <PenLine size={12} /> Create
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => onReact(c.campaignId, 'up')}
            title="More campaigns like this"
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${
              reaction === 'up' ? 'bg-emerald-500 border-emerald-500 text-white' : 'hover:bg-accent text-muted-foreground'
            }`}
          >
            <ThumbsUp size={13} />
          </button>
          <button
            onClick={() => onReact(c.campaignId, 'down')}
            title="Fewer campaigns like this"
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${
              reaction === 'down' ? 'bg-rose-500 border-rose-500 text-white' : 'hover:bg-accent text-muted-foreground'
            }`}
          >
            <ThumbsDown size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
