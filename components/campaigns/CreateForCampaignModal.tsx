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

import { useState } from 'react'
import { X, PenLine, Loader2, ExternalLink, Check } from 'lucide-react'
import PostToAll from '@/components/amazon/PostToAll'
import type { LibraryRow } from '@/lib/campaign-library'

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
                  onClick={async () => { await onWrite(row); setWrote('done') }}
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
            <PostToAll presetProduct={{ value: row.asin, nonce: 1 }} defaultOpen hideProductInput />
          </div>
        </div>
      </div>
    </div>
  )
}
