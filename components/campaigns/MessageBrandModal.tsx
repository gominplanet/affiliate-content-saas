'use client'

/**
 * MessageBrandModal — compose + send a brand-outreach for one Creator
 * Connections campaign, from the /epc list.
 *
 * Tick what to include (the levers that get replies); MVP drafts the pitch from
 * your saved Brand Outreach Profile + what it knows about you, and shows it as
 * the SEPARATE messages that will actually be sent — one box per message. Edit
 * each, then Send hands them to SCOUT, which opens the campaign's Amazon page in
 * the background and sends them one after another (one Send per box).
 */

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Sparkles, Send, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { requestSendBrand } from '@/lib/extension-frame'

export interface MessageBrandCampaign {
  product: string
  asin: string
  commissionPct: number | null
  detailsUrl: string
  brandLabel?: string
}

// Only toggles that each visibly change a message. (The greeting + credibility +
// base content offer come from your saved Outreach Profile and are always there.)
interface Options {
  includeAsin: boolean       // → Message 2 (the product)
  includeLinks: boolean      // → Message 3 (our work)
  requestSample: boolean     // → Message 4 (the ask)
  shareAddress: boolean      // → Message 4 (shipping details)
  offerLivestream: boolean   // → Message 2 (extra offer)
  offerBannerAds: boolean    // → Message 2 (extra offer)
}

const DEFAULT_OPTIONS: Options = {
  includeAsin: true,
  includeLinks: true,
  requestSample: true,
  shareAddress: false,
  offerLivestream: false,
  offerBannerAds: false,
}

// v2 key — the option shape changed, so don't restore the old v1 blob.
const OPTS_KEY = 'mvp.messageBrand.opts.v2'
const ADDR_KEY = 'mvp.messageBrand.address.v1'
// The marker Amazon message groups split on (each segment = its own message).
const MARK = '---- Add to Message Group ----'

// Grouped by the message each one drives, so it's clear what ticking it does.
const CHECKS: { key: keyof Options; label: string; msg: string }[] = [
  { key: 'includeAsin', label: 'Name the exact product & ASIN', msg: 'Msg 2' },
  { key: 'offerLivestream', label: 'Also offer a livestream', msg: 'Msg 2' },
  { key: 'offerBannerAds', label: 'Also offer banner-ad placement', msg: 'Msg 2' },
  { key: 'includeLinks', label: 'Include my portfolio & links', msg: 'Msg 3' },
  { key: 'requestSample', label: 'Request a free sample', msg: 'Msg 4' },
  { key: 'shareAddress', label: 'Share my shipping address', msg: 'Msg 4' },
]

// Split a drafted message into its separate group-messages. Primary: the
// "---- Add to Message Group ----" marker; fallback: blank lines.
function splitSegments(msg: string): string[] {
  const s = (msg || '').trim()
  const hasMarker = /-{2,}\s*add to message group\s*-{2,}/i.test(s)
  const parts = hasMarker ? s.split(/\s*-{2,}\s*add to message group\s*-{2,}\s*/i) : s.split(/\n\s*\n+/)
  const out = parts.map(x => x.trim()).filter(Boolean)
  return out.length ? out : ['']
}

export default function MessageBrandModal({ campaign, onClose }: { campaign: MessageBrandCampaign; onClose: () => void }) {
  const [opts, setOpts] = useState<Options>(DEFAULT_OPTIONS)
  const [address, setAddress] = useState('')
  const [extraNotes, setExtraNotes] = useState('')
  // One entry per message that will be sent, in order.
  const [segments, setSegments] = useState<string[]>([''])
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
      setSegments(splitSegments(d.message))
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

  const updateSeg = (i: number, v: string) => setSegments(s => s.map((x, j) => (j === i ? v : x)))
  const removeSeg = (i: number) => setSegments(s => (s.length > 1 ? s.filter((_, j) => j !== i) : s))
  const addSeg = () => setSegments(s => [...s, ''])

  const cleanSegments = segments.map(s => s.trim()).filter(Boolean)
  const nothingToSend = cleanSegments.length === 0

  const send = useCallback(async () => {
    const toSend = segments.map(s => s.trim()).filter(Boolean)
    if (toSend.length === 0) { toast.error('Nothing to send — draft a message first.'); return }
    if (opts.shareAddress && address.trim()) { try { localStorage.setItem(ADDR_KEY, address.trim()) } catch { /* ignore */ } }
    setSending(true)
    try {
      toast.message(`Sending ${toSend.length} message${toSend.length === 1 ? '' : 's'} to the brand…`, { description: 'SCOUT is delivering them one after another in the background.' })
      // Rejoin with the marker; SCOUT splits again and sends one Send per box.
      const joined = toSend.join(`\n\n${MARK}\n\n`)
      const r = await requestSendBrand(campaign.detailsUrl, joined)
      if (r.ok) {
        toast.success(`Sent to the brand ✓${r.groups && r.groups > 1 ? ` (${r.groups} messages)` : ''}`)
        onClose()
      } else if (r.error === 'not-installed') toast.error('Install/enable SCOUT to message brands.')
      else {
        // Full diag (incl. the Send-button candidates SCOUT saw) → console.
        // eslint-disable-next-line no-console
        console.warn('[MVP] send-brand failed — full diagnostic:', r)
        toast.error(`Couldn't send: ${r.reason || r.error || 'unknown'} — open the browser console (⌥⌘J) for details.`, { duration: 12000 })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }, [segments, opts.shareAddress, address, campaign.detailsUrl, onClose])

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
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-faint)' }}>Add to the message</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {CHECKS.map(c => (
              <label key={c.key} className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--text)' }}>
                <input type="checkbox" checked={opts[c.key]} onChange={() => toggle(c.key)} className="accent-[#7C3AED] w-4 h-4 flex-shrink-0" />
                <span className="min-w-0">{c.label}</span>
                <span className="ml-auto text-[9px] font-bold uppercase tracking-wide px-1 py-[1px] rounded flex-shrink-0" style={{ background: 'rgba(124,58,237,0.10)', color: '#9D6BFF' }}>{c.msg}</span>
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
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              Messages {cleanSegments.length > 0 && <span style={{ color: 'var(--text-faint)' }}>· sent one after another</span>}
            </p>
            <button onClick={draft} disabled={drafting}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#7C3AED] hover:underline disabled:opacity-50">
              {drafting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {cleanSegments.length ? 'Regenerate' : 'Generate'}
            </button>
          </div>

          {drafting && cleanSegments.length === 0 ? (
            <div className="flex items-center gap-2 text-[13px] py-6 justify-center" style={{ color: 'var(--text-faint)' }}>
              <Loader2 size={14} className="animate-spin" /> Drafting your messages…
            </div>
          ) : (
            <div className="space-y-2.5">
              {segments.map((seg, i) => {
                const over = seg.length > 1000
                return (
                  <div key={i} className="rounded-lg border" style={{ borderColor: over ? '#ff3b30' : 'var(--border)' }}>
                    <div className="flex items-center justify-between px-2.5 pt-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-[1px] rounded" style={{ background: 'rgba(124,58,237,0.12)', color: '#7C3AED' }}>
                        Message {i + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] tabular-nums" style={{ color: over ? '#ff3b30' : 'var(--text-faint)' }}>{seg.length}/1000</span>
                        {segments.length > 1 && (
                          <button onClick={() => removeSeg(i)} aria-label={`Remove message ${i + 1}`} className="p-0.5 rounded hover:bg-black/5" style={{ color: 'var(--text-faint)' }}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea
                      value={seg}
                      onChange={e => updateSeg(i, e.target.value)}
                      rows={Math.min(6, Math.max(2, Math.ceil((seg.length || 1) / 55)))}
                      placeholder={`Message ${i + 1}…`}
                      className="w-full px-2.5 pb-2 pt-1 text-[13px] bg-transparent leading-relaxed outline-none resize-y"
                      style={{ color: 'var(--text)' }}
                    />
                  </div>
                )
              })}
              <button onClick={addSeg} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#7C3AED] hover:underline">
                <Plus size={13} /> Add a message
              </button>
            </div>
          )}
        </div>

        <div className="p-5 pt-3 flex items-center gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] font-semibold" style={{ color: 'var(--text-soft)' }}>Cancel</button>
          <button onClick={send} disabled={sending || drafting || nothingToSend}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}>
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send {cleanSegments.length > 1 ? `${cleanSegments.length} messages` : 'message'}
          </button>
        </div>
        <p className="px-5 pb-4 -mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          SCOUT briefly opens the campaign in your Amazon session and sends these {cleanSegments.length > 1 ? `${cleanSegments.length} messages one after another` : 'message'}, then returns you here. Review them above first; they go out as written.
        </p>
      </div>
    </div>
  )
}
