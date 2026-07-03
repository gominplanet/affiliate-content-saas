'use client'

/**
 * MessageBrandModal — compose + send a brand-outreach message for one Creator
 * Connections campaign, from the /epc list.
 *
 * Tick what to include (the levers that get replies), MVP drafts a chat-length
 * pitch (your voice), you edit it, then Send to brand hands it to SCOUT, which
 * opens the campaign's Amazon page and drops the draft into the Message Brand
 * box for you to review + Send. SCOUT never clicks Send itself.
 */

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Sparkles, Send, MessageSquare } from 'lucide-react'
import { requestSendBrand } from '@/lib/extension-frame'

export interface MessageBrandCampaign {
  product: string
  asin: string
  commissionPct: number | null
  detailsUrl: string
  brandLabel?: string
}

interface Options {
  offerContent: boolean
  requestSample: boolean
  shareAddress: boolean
  includeMediaKit: boolean
  includePortfolio: boolean
  mentionPastCollabs: boolean
  offerBannerAds: boolean
  offerLivestream: boolean
}

const DEFAULT_OPTIONS: Options = {
  offerContent: true,
  requestSample: true,
  shareAddress: false,
  includeMediaKit: true,
  includePortfolio: true,
  mentionPastCollabs: false,
  offerBannerAds: false,
  offerLivestream: false,
}

const OPTS_KEY = 'mvp.messageBrand.opts.v1'
const ADDR_KEY = 'mvp.messageBrand.address.v1'

const CHECKS: { key: keyof Options; label: string }[] = [
  { key: 'offerContent', label: 'Offer to create authentic content' },
  { key: 'requestSample', label: 'Request a free sample' },
  { key: 'shareAddress', label: 'Share my shipping / forwarding address' },
  { key: 'includeMediaKit', label: 'Include my media kit link' },
  { key: 'includePortfolio', label: 'Include my portfolio / YouTube' },
  { key: 'mentionPastCollabs', label: 'Mention past brand collaborations' },
  { key: 'offerBannerAds', label: 'Offer bonus banner-ad placement' },
  { key: 'offerLivestream', label: 'Offer a livestream feature' },
]

export default function MessageBrandModal({ campaign, onClose }: { campaign: MessageBrandCampaign; onClose: () => void }) {
  const [opts, setOpts] = useState<Options>(DEFAULT_OPTIONS)
  const [address, setAddress] = useState('')
  const [extraNotes, setExtraNotes] = useState('')
  const [message, setMessage] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)

  // Restore saved preferences (options + forwarding address) once on open.
  useEffect(() => {
    try {
      const o = localStorage.getItem(OPTS_KEY)
      if (o) setOpts({ ...DEFAULT_OPTIONS, ...JSON.parse(o) })
      const a = localStorage.getItem(ADDR_KEY)
      if (a) setAddress(a)
    } catch { /* ignore */ }
  }, [])

  const draft = useCallback(async () => {
    setDrafting(true)
    try {
      const res = await fetch('/api/campaigns/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: campaign.product,
          asin: campaign.asin,
          commissionPct: campaign.commissionPct,
          brand: campaign.brandLabel || '',
          options: { ...opts, address: opts.shareAddress ? address : '' },
          extraNotes,
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
  }, [campaign, opts, address, extraNotes])

  // Draft once on open.
  useEffect(() => { draft() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const toggle = (k: keyof Options) => setOpts(o => {
    const next = { ...o, [k]: !o[k] }
    try { localStorage.setItem(OPTS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    return next
  })

  const send = useCallback(async () => {
    if (!message.trim()) { toast.error('Nothing to send — draft a message first.'); return }
    if (opts.shareAddress && address.trim()) { try { localStorage.setItem(ADDR_KEY, address.trim()) } catch { /* ignore */ } }
    setSending(true)
    try {
      toast.message('Sending to the brand…', { description: 'SCOUT is delivering it in the background.' })
      const r = await requestSendBrand(campaign.detailsUrl, message.trim())
      if (r.ok) { toast.success('Sent to the brand ✓'); onClose() }
      else if (r.error === 'not-installed') toast.error('Install/enable SCOUT to message brands.')
      else {
        // eslint-disable-next-line no-console
        console.warn('[MVP] send-brand failed:', r)
        const d = r.diag ? ` (${Object.entries(r.diag).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''
        toast.error(`Couldn't send: ${r.reason || r.error || 'unknown'}${d}`, { duration: 12000 })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }, [message, opts.shareAddress, address, campaign.detailsUrl, onClose])

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[92vh]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <MessageSquare size={17} className="text-[#7C3AED]" /> Message the brand
            </h2>
            <p className="text-[13px] mt-0.5 truncate" style={{ color: 'var(--text-soft)' }}>{campaign.product || campaign.asin}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-md hover:bg-black/5" style={{ color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>

        <div className="px-5 overflow-y-auto">
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-faint)' }}>Include in the message</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {CHECKS.map(c => (
              <label key={c.key} className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--text)' }}>
                <input type="checkbox" checked={opts[c.key]} onChange={() => toggle(c.key)} className="accent-[#7C3AED] w-4 h-4" />
                {c.label}
              </label>
            ))}
          </div>

          {opts.shareAddress && (
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Shipping / forwarding address for samples"
              className="mt-3 w-full px-3 py-2 rounded-lg border text-[13px] bg-transparent"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          )}

          <input
            value={extraNotes}
            onChange={e => setExtraNotes(e.target.value)}
            placeholder="Anything else to mention (optional)"
            className="mt-2 w-full px-3 py-2 rounded-lg border text-[13px] bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />

          <div className="flex items-center justify-between mt-4 mb-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>Message</p>
            <button onClick={draft} disabled={drafting}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#7C3AED] hover:underline disabled:opacity-50">
              {drafting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {message ? 'Regenerate' : 'Generate'}
            </button>
          </div>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={7}
            maxLength={1000}
            placeholder={drafting ? 'Drafting…' : 'Your message will appear here — edit freely.'}
            className="w-full px-3 py-2 rounded-lg border text-[13px] bg-transparent leading-relaxed"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <p className="text-[11px] mt-1 text-right" style={{ color: message.length > 950 ? '#ff3b30' : 'var(--text-faint)' }}>{message.length}/1000</p>
        </div>

        <div className="p-5 pt-3 flex items-center gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] font-semibold" style={{ color: 'var(--text-soft)' }}>Cancel</button>
          <button onClick={send} disabled={sending || drafting || !message.trim()}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}>
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send to brand
          </button>
        </div>
        <p className="px-5 pb-4 -mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          Send delivers this exact message from your Amazon session — SCOUT briefly opens the campaign, sends it, and returns you here. Review it above first; it goes out as written.
        </p>
      </div>
    </div>
  )
}
