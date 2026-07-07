'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// NetworkOutreachModal — the "Message brand" flow for a Levanta / PartnerBoost
// product that has NO Amazon Affiliate+ (Creator Connections) campaign. MVP
// drafts ONE direct-outreach message (via /api/campaigns/outreach channel:
// 'direct'), the creator copies it, and opens the network page to paste it.
// (When the product DOES have an Affiliate+ campaign, MessageBrandFlow routes to
// MessageBrandModal's SCOUT auto-send instead.)

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Sparkles, Copy, ExternalLink, MessageSquare } from 'lucide-react'

export interface NetworkOutreachTarget {
  product: string
  brand: string
  network: 'Levanta' | 'PartnerBoost'
  networkUrl: string
  asin?: string | null
  commissionPct?: number | null
}

export default function NetworkOutreachModal({ target, onClose }: { target: NetworkOutreachTarget; onClose: () => void }) {
  const [drafting, setDrafting] = useState(false)
  const [message, setMessage] = useState('')

  const draft = useCallback(async () => {
    setDrafting(true)
    try {
      const res = await fetch('/api/campaigns/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'direct',
          network: target.network,
          product: target.product,
          brand: target.brand,
          asin: target.asin && /^[A-Z0-9]{10}$/.test(target.asin) ? target.asin : undefined,
          commissionPct: target.commissionPct ?? undefined,
          options: { includeLinks: true, requestSample: true },
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.message) throw new Error(d.error || 'Could not draft the message')
      setMessage(d.message)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Draft failed')
    } finally {
      setDrafting(false)
    }
  }, [target])

  useEffect(() => { draft() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const copy = useCallback(async () => {
    const t = message.trim()
    if (!t) { toast.error('Nothing to copy yet — draft a message first.'); return }
    try { await navigator.clipboard.writeText(t); toast.success('Message copied — paste it to the brand.') }
    catch { toast.error('Copy failed — select the text and copy manually.') }
  }, [message])

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[92vh]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <MessageSquare size={17} className="text-[#7C3AED]" /> Message the brand
            </h2>
            <p className="text-[13px] mt-0.5 truncate" style={{ color: 'var(--text-soft)' }}>
              {target.brand ? <span className="font-semibold">{target.brand}</span> : null}{target.brand ? ' · ' : ''}{target.product}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-md hover:bg-black/5" style={{ color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>

        <div className="px-5 pb-2">
          <p className="text-[12px] leading-relaxed mb-2" style={{ color: 'var(--text-soft)' }}>
            No Amazon Affiliate+ campaign for this product, so MVP drafts a direct message from your Outreach Profile. <b>Copy it</b>, then open {target.network} and paste it on the brand&rsquo;s page.
          </p>
          {drafting && !message ? (
            <div className="h-40 grid place-items-center"><Loader2 size={18} className="animate-spin text-[#7C3AED]" /></div>
          ) : (
            <textarea
              value={message} onChange={(e) => setMessage(e.target.value)}
              className="w-full text-[13px] leading-relaxed p-3 rounded-xl resize-y min-h-[200px] bg-white dark:bg-[#1c1c1e] border focus:outline-none"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              placeholder="Your message will appear here…" />
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap p-4 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <button onClick={draft} disabled={drafting}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border disabled:opacity-60"
            style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
            {drafting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {message ? 'Regenerate' : 'Generate'}
          </button>
          <button onClick={copy} disabled={drafting || !message.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60"
            style={{ background: '#7C3AED' }}>
            <Copy size={14} /> Copy message
          </button>
          <a href={target.networkUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-white ml-auto"
            style={{ background: 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)' }}
            title={`Open ${target.network} — find ${target.brand || 'the brand'} and paste your message`}>
            Open {target.network} <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  )
}
