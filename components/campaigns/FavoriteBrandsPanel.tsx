// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Favorite brands watchlist. Add the brands you always want in (e.g. Levoit);
// MVP checks them on a schedule so you don't have to watch daily for a full
// campaign to reopen. Each brand shows how many campaigns are open right now,
// and you can bulk-accept or bulk-message every open one in a click.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Star, Plus, X, Loader2, Handshake, MessageCircle, RefreshCw } from 'lucide-react'
import { requestAcceptCampaign, requestCcBrandSearch } from '@/lib/extension-frame'
import BulkMessageBrandModal, { type BulkCampaign } from '@/components/campaigns/BulkMessageBrandModal'

interface FavBrand { brand: string; label: string; openCount: number; joinedCount: number; totalCount: number; lastCheckedAt: string | null }

interface BrandCampaign {
  campaignId: string
  name: string | null
  brand: string | null
  repAsin: string | null
  commissionPct: number | null
  detailsUrl: string
  isFull: boolean
}

export default function FavoriteBrandsPanel({ onChanged }: { onChanged?: () => void }) {
  const [brands, setBrands] = useState<FavBrand[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null) // brand key being accepted
  const [refreshingLive, setRefreshingLive] = useState(false)
  const [msgCampaigns, setMsgCampaigns] = useState<BulkCampaign[] | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/campaigns/favorite-brands').then(r => r.json()).catch(() => ({}))
      setBrands(Array.isArray(d?.brands) ? d.brands : [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const add = useCallback(async () => {
    const brand = input.trim()
    if (!brand) return
    setAdding(true)
    try {
      const r = await fetch('/api/campaigns/favorite-brands', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d.error || 'Could not add that brand.'); return }
      setInput('')
      await load()
    } finally { setAdding(false) }
  }, [input, load])

  const remove = useCallback(async (key: string) => {
    setBrands(prev => prev.filter(b => b.brand !== key))
    await fetch(`/api/campaigns/favorite-brands?brand=${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {})
  }, [])

  // Pull each favorite brand's live grid straight from Amazon (via SCOUT) and top up
  // the shared catalog, so the counts below reflect what's actually open right now
  // instead of the last snapshot. This is why a brand can read "all full" while a
  // live search shows an open slot — the snapshot lagged.
  const refreshAllLive = useCallback(async () => {
    if (brands.length === 0) return
    setRefreshingLive(true)
    const tId = 'fav-live'
    try {
      let installed = true, totalFound = 0
      toast.loading('Checking Amazon for open campaigns…', { id: tId, duration: Infinity })
      for (const b of brands) {
        const res = await requestCcBrandSearch(b.label, { maxPages: 20 })
        if (res.error === 'not-installed') { installed = false; break }
        const found = res.ok ? (res.campaigns || []) : []
        if (found.length) {
          totalFound += found.length
          await fetch('/api/campaigns/ingest-live', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaigns: found }),
          }).catch(() => {})
        }
      }
      if (!installed) {
        toast.error('Install SCOUT to pull live campaigns from your Amazon grid.', { id: tId })
        return
      }
      await load()
      toast.success(`Refreshed from Amazon — ${totalFound} live ${totalFound === 1 ? 'campaign' : 'campaigns'} found.`, { id: tId, duration: 5000 })
      onChanged?.()
    } finally { setRefreshingLive(false) }
  }, [brands, load, onChanged])

  // onlyOpen=true → just the campaigns with a free slot (used for Accept all, since you
  // can't join a full one). onlyOpen=false → every campaign for the brand you haven't
  // already joined, full or not, so you can still message a brand whose slots are full.
  const fetchCampaigns = useCallback(async (label: string, onlyOpen = true): Promise<BrandCampaign[]> => {
    const d = await fetch(`/api/campaigns/favorite-brands/campaigns?brand=${encodeURIComponent(label)}&onlyOpen=${onlyOpen ? '1' : '0'}`).then(r => r.json()).catch(() => ({}))
    return Array.isArray(d?.campaigns) ? d.campaigns : []
  }, [])

  const acceptAll = useCallback(async (b: FavBrand) => {
    setBusy(b.brand)
    const tId = `fav-accept-${b.brand}`
    try {
      const list = (await fetchCampaigns(b.label, true)).filter(c => !!c.repAsin && !!c.detailsUrl)
      if (list.length === 0) { toast(`No open ${b.label} campaigns right now.`); return }
      let joined = 0, already = 0, failed = 0, done = 0
      toast.loading(`Accepting 0 of ${list.length}…`, { id: tId, duration: Infinity })
      for (const c of list) {
        try {
          const r = await requestAcceptCampaign(c.detailsUrl)
          if (r.ok && r.already) already++
          else if (r.ok) {
            joined++
            void fetch('/api/campaigns/mark-accepted', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ asin: c.repAsin, campaignId: c.campaignId, detailsUrl: c.detailsUrl, brand: c.brand, commissionPct: c.commissionPct, productTitle: c.name }),
            }).catch(() => {})
          } else failed++
        } catch { failed++ }
        done++
        toast.loading(`Accepting ${done} of ${list.length}…`, { id: tId, duration: Infinity })
        if (done < list.length) await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500))
      }
      toast.success(`${b.label}: accepted ${joined} · ${already} already joined${failed ? ` · ${failed} failed` : ''}`, { id: tId, duration: 7000 })
      onChanged?.()
      // Refresh the watchlist so the open count drops by what we just joined.
      await load()
    } finally { setBusy(null) }
  }, [fetchCampaigns, onChanged, load])

  const messageAll = useCallback(async (b: FavBrand) => {
    setBusy(b.brand)
    try {
      // Message every campaign for the brand you haven't already joined — full ones
      // included, so you can get on the brand's radar before a slot reopens.
      const list = (await fetchCampaigns(b.label, false)).filter(c => !!c.repAsin && !!c.detailsUrl)
      if (list.length === 0) { toast(`No ${b.label} campaigns to message right now.`); return }
      setMsgCampaigns(list.map(c => ({
        campaignId: c.campaignId, product: c.name || c.repAsin || '', asin: c.repAsin || '',
        brand: c.brand, detailsUrl: c.detailsUrl, commissionPct: c.commissionPct,
      })))
    } finally { setBusy(null) }
  }, [fetchCampaigns])

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }}>
      <div className="flex items-center gap-2 mb-1">
        <Star size={16} style={{ color: '#f59e0b' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Favorite brands</h3>
        {brands.length > 0 && (
          <button type="button" onClick={() => void refreshAllLive()} disabled={refreshingLive}
            title="Pull the latest campaigns for every favorite brand straight from your Amazon grid"
            className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[12px] font-semibold border disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            {refreshingLive ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh from Amazon
          </button>
        )}
      </div>
      <p className="text-[12px] mb-3" style={{ color: 'var(--text-2)' }}>
        Track the brands you always want in. MVP checks them for you, so you don&apos;t have to watch daily for a full campaign to reopen. Accept or message every open one in a click.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void add() }}
          placeholder="Add a brand, e.g. Anker"
          className="flex-1 h-9 px-3 text-sm rounded-lg border bg-transparent outline-none focus:border-[#7C3AED]"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
        />
        <button type="button" onClick={() => void add()} disabled={adding || !input.trim()}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-60" style={{ background: '#7C3AED' }}>
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
        </button>
      </div>

      {loading ? (
        <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>Loading…</p>
      ) : brands.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>No favorite brands yet. Add one above to start tracking it.</p>
      ) : (
        <div className="space-y-2">
          {brands.map(b => (
            <div key={b.brand} className="flex items-center gap-2 flex-wrap rounded-lg border p-2.5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{b.label}</span>
                <span className="text-[11px] ml-2 px-2 py-0.5 rounded-full font-semibold"
                  style={b.openCount > 0
                    ? { color: '#fff', background: '#34c759' }
                    : { color: 'var(--text-3)', background: 'var(--surface-2)' }}>
                  {b.openCount > 0
                    ? `${b.openCount} open`
                    : b.joinedCount > 0
                      ? (b.totalCount > b.joinedCount ? 'all full' : `${b.joinedCount} joined`)
                      : (b.totalCount > 0 ? 'all full' : 'none found')}
                </span>
                {b.openCount === 0 && b.joinedCount > 0 && b.totalCount > b.joinedCount && (
                  <span className="text-[11px] ml-1.5" style={{ color: 'var(--text-3)' }}>{b.joinedCount} joined</span>
                )}
              </div>
              <button type="button" onClick={() => void acceptAll(b)} disabled={busy === b.brand || b.openCount === 0}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: '#34c759' }}>
                {busy === b.brand ? <Loader2 size={13} className="animate-spin" /> : <Handshake size={13} />} Accept all
              </button>
              <button type="button" onClick={() => void messageAll(b)} disabled={busy === b.brand || (b.totalCount - b.joinedCount) <= 0}
                title="Message every campaign for this brand you haven't joined — full ones included, so you're on their radar when a slot reopens"
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[12px] font-semibold border disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                <MessageCircle size={13} /> Message all
              </button>
              <button type="button" onClick={() => void remove(b.brand)} title="Remove" className="p-1.5 rounded-lg" style={{ color: 'var(--text-3)' }}>
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {msgCampaigns && (
        <BulkMessageBrandModal
          campaigns={msgCampaigns}
          alreadyMessaged={new Set()}
          alreadyAccepted={new Set()}
          onClose={() => setMsgCampaigns(null)}
          onDone={() => { setMsgCampaigns(null); onChanged?.() }}
        />
      )}
    </div>
  )
}
