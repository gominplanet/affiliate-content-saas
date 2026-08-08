// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Saved Campaigns — the shelf where everything the creator saved (from the
// dashboard "Campaigns picked for you" digest OR the CC Campaigns browse page)
// lives as a card grid. Each card keeps its Buy / Contact-brand actions and a
// Remove that deletes it for good. Backed by the shared cc_saved_finds store
// via /api/campaigns/saved.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Bookmark, Loader2, ExternalLink, MessageSquare, Trash2, Star, PenLine, Handshake } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import MessageBrandModal, { type MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'
import { FromLinkModal } from '@/components/content/FromLinkModal'
import { requestFindCampaign } from '@/lib/extension-frame'
import { acceptCampaignViaScout } from '@/lib/accept-campaign'

interface SavedCampaign {
  id: string
  asin: string
  source: string
  campaign_id: string | null
  title: string | null
  brand: string | null
  image_url: string | null
  commission_pct: number | null
  price: number | null
  monthly_sales: number | null
  rating: number | null
  has_video: boolean | null
  marketplace: string | null
  details_url: string | null
  created_at: string
}

// The CC message-page URL the outreach modal opens. Prefer the stored one; fall
// back to the constructible campaign request URL.
function detailsUrlFor(s: SavedCampaign): string {
  if (s.details_url) return s.details_url
  if (s.campaign_id) return `https://affiliate-program.amazon.com/p/connect/request?campaignId=${encodeURIComponent(s.campaign_id)}&type=affiliate-plus&status=active`
  return ''
}

export default function SavedCampaignsPage() {
  const [items, setItems] = useState<SavedCampaign[] | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [msgModal, setMsgModal] = useState<MessageBrandCampaign | null>(null)
  const [createFor, setCreateFor] = useState<SavedCampaign | null>(null)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<Set<string>>(new Set())

  const accept = async (s: SavedCampaign) => {
    if (accepting) return
    setAccepting(s.id)
    const ok = await acceptCampaignViaScout({
      detailsUrl: detailsUrlFor(s), asin: s.asin, campaignId: s.campaign_id,
      brand: s.brand, commissionPct: s.commission_pct, productTitle: s.title,
    })
    if (ok) setAccepted((prev) => new Set(prev).add(s.id))
    setAccepting(null)
  }

  const load = useCallback(() => {
    fetch('/api/campaigns/saved')
      .then((r) => r.json())
      .then((d) => setItems(d?.ok && Array.isArray(d.saved) ? d.saved : []))
      .catch(() => setItems([]))
  }, [])

  useEffect(() => { load() }, [load])

  const remove = async (id: string) => {
    if (removing) return
    setRemoving(id)
    const prev = items
    setItems((cur) => (cur ? cur.filter((x) => x.id !== id) : cur)) // optimistic
    try {
      const res = await fetch(`/api/campaigns/saved?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      setItems(prev ?? null) // restore on failure
      toast.error('Could not remove that. Try again.')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <>
      <PageHero
        title="Saved Campaigns"
        subtitle="Every campaign you've saved — from Creator Connections or MVP x Wayward. Revisit it, message the brand, or remove it for good."
      />

      {items === null ? (
        <div className="flex items-center justify-center py-16 text-[var(--text-3)]">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="card p-8 max-w-md mx-auto flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-500/15 flex items-center justify-center">
            <Bookmark size={22} className="text-amber-500" />
          </div>
          <p className="text-sm font-semibold text-[var(--text)]">Nothing saved yet</p>
          <p className="text-xs text-[var(--text-3)] max-w-sm">
            Hit <span className="font-semibold">Save</span> on any campaign in <span className="font-semibold">Campaigns picked for you</span> on your dashboard, or on the <span className="font-semibold">CC Campaigns</span> page, and it lands here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((s) => (
            <div key={s.id} className="card p-4 flex flex-col gap-3">
              <div className="flex gap-3">
                <div className="w-16 h-16 rounded-lg bg-[var(--surface-2)] border border-[var(--border-2)] flex items-center justify-center overflow-hidden flex-shrink-0">
                  {s.image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={s.image_url} alt="" className="w-full h-full object-contain p-1" loading="lazy" decoding="async" />
                    : <span className="text-[10px] text-[var(--text-3)]">No image</span>}
                </div>
                <div className="min-w-0 flex-1">
                  {s.brand && <p className="text-[11px] text-[var(--text-3)] truncate">{s.brand}</p>}
                  <p className="text-sm font-medium text-[var(--text)] leading-snug line-clamp-2">{s.title || s.asin}</p>
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    {s.commission_pct != null && (
                      <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgba(52,199,89,0.15)', color: '#1c7a35' }}>
                        {s.commission_pct}% commission
                      </span>
                    )}
                    {s.price != null && (
                      <span className="text-[10px] font-semibold rounded-full border border-[var(--border-2)] px-2 py-0.5 text-[var(--text-3)]">
                        ${Number(s.price).toFixed(0)}
                      </span>
                    )}
                    {s.rating != null && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold rounded-full border border-[var(--border-2)] px-2 py-0.5 text-[var(--text-3)]">
                        <Star size={9} className="fill-amber-400 text-amber-400" /> {Number(s.rating).toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 mt-auto pt-1">
                {/* Wayward finds aren't CC campaigns — there's nothing to Accept.
                    Instead we hand the creator straight to Wayward (product
                    pre-selected) where they can mint a link or generate a post. */}
                {s.source === 'wayward' ? (
                  <a
                    href={`/wayward?asin=${encodeURIComponent(s.asin)}`}
                    className="btn-secondary w-full flex items-center gap-1.5 text-xs justify-center"
                    style={{ background: 'rgba(124,58,237,0.10)', color: '#7C3AED', borderColor: 'rgba(124,58,237,0.25)' }}
                    title="Open this product in MVP x Wayward"
                  >
                    <ExternalLink size={13} /> View on Wayward
                  </a>
                ) : accepted.has(s.id) ? (
                  /* Accept — SCOUT clicks Accept on the user's Amazon session, no
                     tab-hopping. Turns into a confirmation once accepted. */
                  <div className="flex items-center gap-1.5 text-xs font-medium text-[#7C3AED]">
                    <Handshake size={13} /> Accepted on Amazon
                  </div>
                ) : (
                  <button
                    onClick={() => accept(s)}
                    disabled={accepting === s.id}
                    className="btn-secondary w-full flex items-center gap-1.5 text-xs justify-center disabled:opacity-50"
                    title="Accept this campaign on Amazon via SCOUT — no tab-hopping"
                  >
                    {accepting === s.id ? <Loader2 size={13} className="animate-spin" /> : <Handshake size={13} />}
                    {accepting === s.id ? 'Accepting via SCOUT…' : 'Accept campaign'}
                  </button>
                )}
                {/* Primary actions. Contact-the-brand is CC-specific (SCOUT pitches
                    the Amazon CC brand), so Wayward cards show Buy + Create only. */}
                <div className={`grid gap-1.5 ${s.source === 'wayward' ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  <a
                    href={`https://www.amazon.com/dp/${s.asin}`} target="_blank" rel="noopener noreferrer"
                    className="btn-secondary px-2 flex items-center justify-center gap-1 text-xs min-w-0"
                    title="View the product on Amazon"
                  >
                    <ExternalLink size={13} className="flex-shrink-0" /> <span className="truncate">Buy</span>
                  </a>
                  {s.source !== 'wayward' && (
                    <button
                      onClick={() => setMsgModal({ product: s.title || s.asin, asin: s.asin, commissionPct: s.commission_pct, detailsUrl: detailsUrlFor(s), brandLabel: s.brand || undefined })}
                      className="btn-secondary px-2 flex items-center justify-center gap-1 text-xs min-w-0"
                      title="Draft + send a pitch to the brand via SCOUT"
                    >
                      <MessageSquare size={13} className="flex-shrink-0" /> <span className="truncate">Contact</span>
                    </button>
                  )}
                  <button
                    onClick={() => setCreateFor(s)}
                    className="btn-secondary px-2 flex items-center justify-center gap-1 text-xs min-w-0"
                    title="Write a blog post from this product"
                  >
                    <PenLine size={13} className="flex-shrink-0" /> <span className="truncate">Create</span>
                  </button>
                </div>
                {/* Remove — secondary + destructive, on its own subtle line so it
                    never crowds the primary actions out of the card. */}
                <button
                  onClick={() => remove(s.id)}
                  disabled={removing === s.id}
                  className="self-end inline-flex items-center gap-1 text-[11px] text-[var(--text-3)] hover:text-[#ff3b30] disabled:opacity-50"
                  title="Remove from Saved Campaigns (permanent)"
                >
                  {removing === s.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
          initialName={createFor.title || ''}
          onClose={() => setCreateFor(null)}
          onDone={() => setCreateFor(null)}
        />
      )}
    </>
  )
}
