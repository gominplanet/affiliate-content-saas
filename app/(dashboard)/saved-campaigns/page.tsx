// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Saved Campaigns — the shelf where everything the creator saved (from the
// dashboard "Campaigns picked for you" digest OR the CC Campaigns browse page)
// lives as a card grid. Each card keeps its Buy / Contact-brand actions and a
// Remove that deletes it for good. Backed by the shared cc_saved_finds store
// via /api/campaigns/saved.

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Bookmark, Loader2, ExternalLink, MessageSquare, Trash2, Star, PenLine, Handshake, Check, Send } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import MessageBrandModal, { type MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'
import BulkMessageBrandModal, { type BulkCampaign } from '@/components/campaigns/BulkMessageBrandModal'
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

// Same ceiling as Brand campaigns' bulk message (one background run).
const BULK_MAX = 100

export default function SavedCampaignsPage() {
  const [items, setItems] = useState<SavedCampaign[] | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  // A list that did not load is not an empty shelf.
  const [loadFailed, setLoadFailed] = useState(false)
  const [msgModal, setMsgModal] = useState<MessageBrandCampaign | null>(null)
  const [createFor, setCreateFor] = useState<SavedCampaign | null>(null)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<Set<string>>(new Set())

  // BULK MESSAGE (Seb, 2026-10-11: "saved campaigns should have the top 25,
  // top 50, top 100, select all button and then the message all brands
  // selected button next to it"). Same window as Brand campaigns: it folds
  // several products from one brand into one thread and skips brands already
  // messaged. Wayward finds are not CC campaigns, so they are never selected.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [messagedAsins, setMessagedAsins] = useState<Set<string>>(new Set())
  const [acceptedAsins, setAcceptedAsins] = useState<Set<string>>(new Set())
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns/list', { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
      if (!res.ok) return
      const j = await res.json().catch(() => ({}))
      const m = new Set<string>(), a = new Set<string>()
      for (const r of (Array.isArray(j?.campaigns) ? j.campaigns : []) as Array<{ asin?: string; messaged_at?: string | null; accepted_at?: string | null }>) {
        const asin = String(r.asin || '').toUpperCase()
        if (!asin) continue
        if (r.messaged_at) m.add(asin)
        if (r.accepted_at) a.add(asin)
      }
      setMessagedAsins(m); setAcceptedAsins(a)
    } catch { /* the selection still works; the window checks again */ }
  }, [])
  useEffect(() => { void loadStatus() }, [loadStatus])
  const ccItems = useMemo(() => (items ?? []).filter((s) => s.source !== 'wayward'), [items])
  const toggleSelect = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) { next.delete(id); return next }
    if (next.size >= BULK_MAX) { toast.error(`You can select up to ${BULK_MAX} campaigns at once.`); return prev }
    next.add(id)
    return next
  })
  // Top N skips brands already messaged; All takes every CC campaign (up to the ceiling).
  const selectTop = (n: number) => {
    const pick = ccItems.filter((s) => !messagedAsins.has(s.asin.toUpperCase())).slice(0, Math.min(n, BULK_MAX))
    setSelected(new Set(pick.map((s) => s.id)))
    if (pick.length === 0) toast('Every saved campaign here has already been messaged.')
  }
  const selectAll = () => {
    const pick = ccItems.slice(0, BULK_MAX)
    setSelected(new Set(pick.map((s) => s.id)))
    if (ccItems.length > BULK_MAX) toast(`Selected the first ${BULK_MAX}, the most one message run takes.`)
  }
  const selectedItems = useMemo(() => ccItems.filter((s) => selected.has(s.id)), [ccItems, selected])
  // How many messages will actually go out: one per brand, brands already messaged left out.
  const messageableCount = useMemo(() => {
    const seen = new Set<string>()
    let n = 0
    for (const s of selectedItems) {
      if (messagedAsins.has(s.asin.toUpperCase())) continue
      const b = (s.brand || '').trim().toLowerCase()
      if (b) { if (seen.has(b)) continue; seen.add(b) }
      n++
    }
    return n
  }, [selectedItems, messagedAsins])

  const accept = async (s: SavedCampaign) => {
    if (accepting) return
    setAccepting(s.id)
    const ok = await acceptCampaignViaScout({
      detailsUrl: detailsUrlFor(s), asin: s.asin, campaignId: s.campaign_id,
      brand: s.brand, commissionPct: s.commission_pct, productTitle: s.title,
      source: 'saved-campaigns',
    })
    if (ok) setAccepted((prev) => new Set(prev).add(s.id))
    setAccepting(null)
  }

  const load = useCallback(() => {
    setLoadFailed(false)
    fetch('/api/campaigns/saved')
      .then((r) => r.json())
      .then((d) => {
        if (!d?.ok || !Array.isArray(d.saved)) throw new Error('not a list')
        setItems(d.saved)
      })
      .catch(() => { setLoadFailed(true); setItems([]) })
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
        subtitle="Every campaign you've saved, from Creator Connections or MVP x Wayward. Revisit it, message the brand, or remove it for good."
      />

      {items === null ? (
        <div className="flex items-center justify-center py-16 text-[var(--text-3)]">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : loadFailed ? (
        <div className="card p-8 max-w-md mx-auto flex flex-col items-center text-center gap-3">
          <p className="text-sm font-semibold text-[var(--text)]">Your saved campaigns could not be loaded</p>
          <button onClick={() => { setItems(null); load() }} className="btn-secondary text-xs">Try again</button>
        </div>
      ) : items.length === 0 ? (
        <div className="card p-8 max-w-md mx-auto flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-500/15 flex items-center justify-center">
            <Bookmark size={22} className="text-amber-500" />
          </div>
          <p className="text-sm font-semibold text-[var(--text)]">Nothing saved yet</p>
          <p className="text-xs text-[var(--text-3)] max-w-sm">
            Hit <span className="font-semibold">Save</span> on any campaign in <span className="font-semibold">Campaigns picked for you</span> on your dashboard, or on the <span className="font-semibold">Brand campaigns</span> page, and it lands here.
          </p>
        </div>
      ) : (
        <>
        {ccItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4 text-[12px]">
            <span style={{ color: 'var(--text-3)' }}>Select:</span>
            {[25, 50, 100].map((n) => (
              <button key={n} onClick={() => selectTop(n)} className="px-2.5 py-1.5 rounded-md border font-medium" style={{ borderColor: 'var(--border-2)', color: 'var(--text-2)' }}>Top {n}</button>
            ))}
            <button onClick={selectAll} className="px-2.5 py-1.5 rounded-md border font-medium" style={{ borderColor: 'var(--border-2)', color: 'var(--text-2)' }}>Select all</button>
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} className="px-1.5 py-1.5 font-medium hover:underline" style={{ color: 'var(--text-soft)' }}>Clear</button>
            )}
            <button onClick={() => setBulkOpen(true)} disabled={messageableCount === 0}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full font-semibold text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}
              title={selected.size === 0 ? 'Select campaigns first' : messageableCount === 0 ? 'Every selected brand has already been messaged' : 'Message every selected brand, one at a time in the background'}>
              <Send size={13} /> {selected.size === 0 ? 'Message selected brands' : `Message ${messageableCount} ${messageableCount === 1 ? 'brand' : 'brands'}`}
            </button>
            {selected.size > 0 && (
              <span style={{ color: 'var(--text-3)' }}>
                {selected.size} selected{messageableCount !== selected.size ? ` · ${selected.size - messageableCount} already messaged or the same brand` : ''}
              </span>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((s) => (
            <div key={s.id} className="card p-4 flex flex-col gap-3 relative" style={selected.has(s.id) ? { outline: '2px solid #7C3AED', outlineOffset: -1 } : undefined}>
              {s.source !== 'wayward' && (
                <button type="button" onClick={() => toggleSelect(s.id)} aria-pressed={selected.has(s.id)}
                  aria-label={selected.has(s.id) ? 'Deselect' : 'Select for bulk message'}
                  title={selected.has(s.id) ? 'Selected: click to remove' : 'Select for bulk message'}
                  className="absolute top-2 left-2 z-10 w-6 h-6 rounded-md border flex items-center justify-center"
                  style={{ background: selected.has(s.id) ? '#7C3AED' : 'var(--surface)', borderColor: selected.has(s.id) ? '#7C3AED' : 'var(--border)' }}>
                  {selected.has(s.id) && <Check size={14} className="text-white" />}
                </button>
              )}
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
                    title="Accept this campaign on Amazon via SCOUT: no tab-hopping"
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
        </>
      )}

      {bulkOpen && (
        <BulkMessageBrandModal
          campaigns={selectedItems.map((s): BulkCampaign => ({
            campaignId: s.campaign_id || s.id,
            product: s.title || s.asin,
            asin: s.asin,
            brand: s.brand,
            detailsUrl: detailsUrlFor(s),
            commissionPct: s.commission_pct,
          }))}
          alreadyMessaged={messagedAsins}
          alreadyAccepted={acceptedAsins}
          onClose={() => { setBulkOpen(false); setSelected(new Set()); void loadStatus() }}
          onDone={() => void loadStatus()}
        />
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
