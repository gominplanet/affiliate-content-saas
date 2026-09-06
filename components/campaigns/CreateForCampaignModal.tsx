'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Make something for a campaign you joined, from the campaign's own card.
//
// The Joined Campaigns page can tell a creator which campaign is worth the work
// and why. Until this existed it then sent them somewhere else to do it, which is
// where the intent gets lost: the whole point of joining at the moment of intent
// is that the making follows immediately.
//
// Two routes, and which one leads is the window's decision, not a preference,
// because a blog post published into a campaign that ends before Google finds it
// earns the ordinary rate for the same work. The runway logic decides that and
// this only reflects it.
//
// The social side is the existing fan-out component rather than a second
// implementation of it. It already knows which networks are connected, designs
// one shared brief so the set looks like one campaign, and posts to each. A
// second copy would drift.

import { useCallback, useEffect, useState } from 'react'
import { X, PenLine, Loader2, ExternalLink, Check } from 'lucide-react'
import PostToAll from '@/components/amazon/PostToAll'
import type { LibraryRow } from '@/lib/campaign-library'

interface CampaignProduct {
  asin: string
  title: string | null
  imageUrl: string | null
  priceCents: number | null
  rating: number | null
  monthlySold: number | null
}

const money = (cents: number) => cents % 100 === 0 ? `$${(cents / 100).toLocaleString()}` : `$${(cents / 100).toFixed(2)}`

export default function CreateForCampaignModal({ row, onClose, onWrite, writing }: {
  row: LibraryRow
  onClose: () => void
  /** Runs the blog generator. Owned by the page so the list refreshes after. */
  onWrite: (row: LibraryRow) => Promise<void>
  writing: boolean
}) {
  const [wrote, setWrote] = useState<string | null>(null)
  const blogViable = row.runway.blog.viable
  const videoViable = row.runway.video.viable
  const name = row.product || row.brand || row.asin

  // Which product this campaign is about.
  //
  // A campaign can cover a dozen, and MVP was choosing one silently: Amazon's
  // rep_asin where there is one, otherwise the first entry in the list, which is
  // an arbitrary choice nobody made. The default is still that one, because it is
  // usually the campaign's headline product, but the rest are now visible and
  // switching changes what gets written and what gets posted.
  const others = (row.asins ?? []).filter(a => a !== row.asin)
  const [asin, setAsin] = useState(row.asin)
  const [products, setProducts] = useState<CampaignProduct[] | null>(null)
  const [picking, setPicking] = useState(false)

  const loadProducts = useCallback(async () => {
    if (products || !others.length) return
    try {
      const r = await fetch('/api/campaigns/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asins: row.asins }),
      })
      const d = await r.json() as { products?: CampaignProduct[] }
      setProducts(d.products ?? [])
    } catch { setProducts([]) }
  }, [products, others.length, row.asins])
  useEffect(() => { if (picking) void loadProducts() }, [picking, loadProducts])

  const chosen = products?.find(p => p.asin === asin) ?? null
  const chosenName = asin === row.asin ? name : (chosen?.title || asin)

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-lg my-8 rounded-2xl overflow-hidden bg-white dark:bg-[#111113]" style={{ border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>

        <div className="flex items-start gap-3 p-5 pb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {row.imageUrl
            ? <img src={row.imageUrl} alt="" className="w-14 h-14 rounded-lg object-contain flex-shrink-0" style={{ background: 'var(--surface-2)' }} />
            : <div className="w-14 h-14 rounded-lg flex-shrink-0" style={{ background: 'var(--surface-2)' }} />}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold leading-snug" style={{ color: 'var(--text)' }}>{name}</h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
              {row.brand ? `${row.brand} · ` : ''}
              {row.commissionPct != null ? `${row.commissionPct}%` : 'commission unknown'}
              {row.perSaleCents != null ? ` · ${money(row.perSaleCents)} a sale` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-md hover:bg-black/5" style={{ color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>

        {/* What the remaining window can carry, said once, before the buttons. */}
        <div className="mx-5 mb-4 rounded-lg border p-2.5 text-[12px] leading-relaxed" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text-soft)' }}>
          {row.runway.headline}
        </div>

        <div className="px-5 pb-5 flex flex-col gap-4">
          {/* ── Which product ─────────────────────────────────────────────── */}
          <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>
                Making it about <span style={{ color: '#7C3AED' }}>{chosenName}</span>
              </p>
              {others.length > 0 && (
                <button type="button" onClick={() => setPicking(v => !v)}
                  className="text-[12px] font-semibold hover:underline flex-shrink-0" style={{ color: '#7C3AED' }}>
                  {picking ? 'Keep this one' : `Pick another (${others.length + 1})`}
                </button>
              )}
            </div>
            <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              {others.length === 0
                ? 'This campaign covers one product.'
                : `This campaign covers ${others.length + 1} products. MVP defaults to the one Amazon lists first, which is not always the one worth writing about.`}
            </p>
            {picking && (
              <div className="mt-2.5 flex flex-col gap-1 max-h-64 overflow-y-auto">
                {products === null ? (
                  <span className="text-[12px] inline-flex items-center gap-1.5 py-2" style={{ color: 'var(--text-faint)' }}>
                    <Loader2 size={12} className="animate-spin" /> Looking these up…
                  </span>
                ) : products.map(p => (
                  <button key={p.asin} type="button" onClick={() => { setAsin(p.asin); setPicking(false) }}
                    className="flex items-center gap-2.5 rounded-lg border p-2 text-left"
                    style={{ borderColor: p.asin === asin ? '#7C3AED' : 'var(--border)', background: p.asin === asin ? 'rgba(124,58,237,0.06)' : 'transparent' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.imageUrl
                      ? <img src={p.imageUrl} alt="" className="w-9 h-9 rounded object-contain flex-shrink-0" style={{ background: 'var(--surface-2)' }} />
                      : <div className="w-9 h-9 rounded flex-shrink-0" style={{ background: 'var(--surface-2)' }} />}
                    <span className="min-w-0 flex-1">
                      <span className="text-[12.5px] font-medium block truncate" style={{ color: 'var(--text)' }}>
                        {p.asin === row.asin ? name : (p.title || p.asin)}
                      </span>
                      <span className="text-[11px] block" style={{ color: 'var(--text-faint)' }}>
                        {p.asin}
                        {p.priceCents != null ? ` · ${money(p.priceCents)}` : ''}
                        {p.rating != null ? ` · ${p.rating.toFixed(1)}★` : ''}
                        {p.monthlySold ? ` · ${p.monthlySold.toLocaleString()} a month` : ''}
                        {p.title || p.priceCents != null ? '' : ' · nothing known about this one yet'}
                      </span>
                    </span>
                    {p.asin === asin && <Check size={14} style={{ color: '#7C3AED', flexShrink: 0 }} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Blog post ─────────────────────────────────────────────────── */}
          <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>Blog post</p>
                <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: blogViable === false ? '#b45309' : 'var(--text-soft)' }}>
                  {row.runway.blog.note}
                </p>
              </div>
              {wrote ? (
                <a href={wrote} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold flex-shrink-0"
                  style={{ border: '1px solid var(--border)', color: '#1c7a35' }}>
                  <Check size={13} /> View post <ExternalLink size={11} />
                </a>
              ) : (
                <button
                  onClick={async () => {
                    // Both the product id AND the name the writer is given, so a
                    // switched product does not get written up under the
                    // campaign's headline product's name.
                    await onWrite({ ...row, asin, product: asin === row.asin ? row.product : (chosen?.title ?? null) })
                    setWrote('done')
                  }}
                  disabled={writing}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50 flex-shrink-0"
                  style={{ background: blogViable === false ? 'var(--text-faint)' : 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}>
                  {writing ? <Loader2 size={13} className="animate-spin" /> : <PenLine size={13} />}
                  {writing ? 'Writing…' : 'Write it'}
                </button>
              )}
            </div>
          </div>

          {/* ── Socials ───────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>Social posts</p>
              <p className="text-[11.5px]" style={{ color: 'var(--text-soft)' }}>
                {videoViable === true ? 'Also worth a video: the sample usually lands in a few days' : 'Reaches people the same day'}
              </p>
            </div>
            {/* Every connected network, from the one component that knows which
                are connected. Opened already, and with no product field, because
                the campaign card has already answered both questions. */}
            <PostToAll key={asin} presetProduct={{ value: asin, nonce: 1 }} defaultOpen hideProductInput />
          </div>
        </div>
      </div>
    </div>
  )
}
