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

import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Sparkles, Send, MessageSquare, Plus, Trash2, Copy, Radar } from 'lucide-react'
import { requestSendBrand, type FindCampaignResult } from '@/lib/extension-frame'

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

export default function MessageBrandModal({ campaign, onClose, onSent, onFindCampaign }: {
  campaign: MessageBrandCampaign
  onClose: () => void
  onSent?: () => void
  // Optional live "is this a Creator Connections campaign?" lookup. When the modal
  // opens WITHOUT a campaign details URL (e.g. from the Product Finder) this powers
  // the "Search Creator Connections" button — on a hit, the modal flips from
  // compose+copy to auto-send. Returns the SCOUT find result.
  onFindCampaign?: () => Promise<FindCampaignResult>
}) {
  const [opts, setOpts] = useState<Options>(DEFAULT_OPTIONS)
  const [address, setAddress] = useState('')
  const [extraNotes, setExtraNotes] = useState('')
  // One entry per message that will be sent, in order.
  const [segments, setSegments] = useState<string[]>([''])
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendProgress, setSendProgress] = useState(0) // 0-100, estimated send gauge
  // Live-find state: a campaign discovered on Amazon after opening. Overrides the
  // (absent) campaign.detailsUrl so canSend flips true and Send targets it.
  const [finding, setFinding] = useState(false)
  const [liveDetailsUrl, setLiveDetailsUrl] = useState('')
  const [liveBrand, setLiveBrand] = useState('')
  const [findMiss, setFindMiss] = useState<string | null>(null)

  const effectiveDetailsUrl = campaign.detailsUrl || liveDetailsUrl
  const effectiveBrand = liveBrand || campaign.brandLabel || ''

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
          brand: effectiveBrand,
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
  }, [campaign, opts, address, extraNotes, effectiveBrand])

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
  // SCOUT can only auto-send through a Creator Connections campaign chat. When
  // there's no campaign details URL (e.g. opened from the Product Finder), we
  // switch to compose+copy — unless the live "Search Creator Connections" lookup
  // finds one, which fills liveDetailsUrl and flips this back to Send.
  const canSend = !!effectiveDetailsUrl

  // Live CC lookup: ask SCOUT whether this product is a running campaign. On a hit
  // we adopt its details URL (→ auto-send) and, if it surfaced the real brand,
  // re-draft so the greeting names the brand.
  // `silent` = the automatic on-open check (below). It stays quiet on the
  // not-installed / error cases (no toast) so a user who just wants to copy
  // isn't nagged; the manual button still surfaces the louder feedback.
  const runFind = useCallback(async (o?: { silent?: boolean }) => {
    if (!onFindCampaign) return
    setFinding(true); setFindMiss(null)
    try {
      const r = await onFindCampaign()
      if (r.ok && r.found && r.detailsUrl) {
        setLiveDetailsUrl(r.detailsUrl)
        const brand = (r.brand || '').trim()
        if (brand && brand.toLowerCase() !== effectiveBrand.toLowerCase()) { setLiveBrand(brand) }
        toast.success(`Found a Creator Connections campaign${brand ? ` from ${brand}` : ''} — you can auto-send now.`)
      } else if (r.ok) {
        setFindMiss(`No live campaign matched${typeof r.scanned === 'number' ? ` (checked ${r.scanned})` : ''}. You can still copy the pitch.`)
      } else if (r.error === 'not-installed') {
        if (o?.silent) setFindMiss('Connect SCOUT to auto-send this on Amazon — otherwise copy the pitch below.')
        else toast.error('Install / enable SCOUT to search Creator Connections.')
      } else if (r.error === 'timeout') {
        setFindMiss('The Creator Connections search timed out. You can still copy the pitch, or try again.')
      } else {
        setFindMiss(`Couldn't search Creator Connections (${r.error}). You can still copy the pitch.`)
      }
    } catch (e) {
      setFindMiss(e instanceof Error ? e.message : 'Search failed.')
    } finally {
      setFinding(false)
    }
  }, [onFindCampaign, effectiveBrand])

  // Auto-check Creator Connections the moment the modal opens. Every product that
  // reaches this modal is an Affiliate+ campaign (the Finder + saved shelf only
  // wire "Message brand" for campaign finds), but catalog-verified ones arrive
  // WITHOUT a campaign details URL — so kick off the live SCOUT lookup right away
  // to fetch it and flip the primary button from Copy → Send on its own, no
  // hunting for a button. Runs once; no-op when a details URL was already passed
  // (Levanta/PartnerBoost, or an imported campaign) or no lookup hook is wired.
  const autoFound = useRef(false)
  useEffect(() => {
    if (autoFound.current) return
    if (campaign.detailsUrl || !onFindCampaign) return
    if (!/^[A-Za-z0-9]{10}$/.test(campaign.asin || '')) return
    autoFound.current = true
    runFind({ silent: true })
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [])

  // When a live find surfaced a different brand, refresh the draft so the greeting
  // uses it. Runs only after liveBrand changes (not on first mount).
  useEffect(() => {
    if (liveBrand) draft()
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [liveBrand])

  const copyAll = useCallback(async () => {
    const toSend = segments.map(s => s.trim()).filter(Boolean)
    if (toSend.length === 0) { toast.error('Nothing to copy — draft a message first.'); return }
    try {
      await navigator.clipboard.writeText(toSend.join('\n\n'))
      toast.success(`Copied ${toSend.length} message${toSend.length === 1 ? '' : 's'} — paste them to the brand.`)
      onClose()
    } catch { toast.error('Copy failed — select the text above and copy manually.') }
  }, [segments, onClose])

  const send = useCallback(async () => {
    const toSend = segments.map(s => s.trim()).filter(Boolean)
    if (toSend.length === 0) { toast.error('Nothing to send — draft a message first.'); return }
    if (opts.shareAddress && address.trim()) { try { localStorage.setItem(ADDR_KEY, address.trim()) } catch { /* ignore */ } }
    setSending(true)
    setSendProgress(3)
    // Estimated gauge: SCOUT opens the campaign (~5s) + ~3s per message. We can't
    // stream real per-message progress through one chrome message, so advance the
    // bar over the expected duration and snap to 100% when it actually finishes.
    const expectedMs = 5000 + toSend.length * 3000
    const startedAt = Date.now()
    const iv = setInterval(() => {
      setSendProgress(Math.min(94, ((Date.now() - startedAt) / expectedMs) * 100))
    }, 150)
    try {
      // Rejoin with the marker; SCOUT splits again and sends one Send per box.
      const joined = toSend.join(`\n\n${MARK}\n\n`)
      const r = await requestSendBrand(effectiveDetailsUrl, joined)
      clearInterval(iv)
      setSendProgress(100)
      if (r.ok) {
        toast.success(`Sent to the brand ✓${r.groups && r.groups > 1 ? ` (${r.groups} messages)` : ''}`)
        // Record the outreach so /epc shows a "messaged" badge (best-effort).
        try {
          await fetch('/api/campaigns/mark-messaged', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin: campaign.asin, message: toSend.join('\n\n') }),
          })
        } catch { /* the message already went out — non-fatal */ }
        onSent?.()
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
      clearInterval(iv)
      setSending(false)
      setTimeout(() => setSendProgress(0), 700)
    }
  }, [segments, opts.shareAddress, address, effectiveDetailsUrl, campaign.asin, onClose, onSent])

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[92vh] bg-white dark:bg-[#111113]" style={{ border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
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

        {sending && (
          <div className="px-5 pt-3">
            <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: 'var(--text-soft)' }}>
              <span>Sending message {Math.min(cleanSegments.length || 1, Math.max(1, Math.ceil((sendProgress / 100) * (cleanSegments.length || 1))))} of {cleanSegments.length || 1}…</span>
              <span className="tabular-nums">{Math.round(sendProgress)}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div className="h-full transition-all duration-150 ease-linear" style={{ width: `${sendProgress}%`, background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }} />
            </div>
          </div>
        )}

        {/* Live "is this a Creator Connections campaign?" lookup — only when we
            weren't opened with a campaign chat and the caller provided the hook. */}
        {!campaign.detailsUrl && onFindCampaign && (
          <div className="px-5 pt-3">
            {liveDetailsUrl ? (
              <div className="flex items-center gap-2 text-[12px] rounded-lg px-3 py-2" style={{ background: 'rgba(52,199,89,0.10)', color: '#248a3d' }}>
                <Radar size={14} /> Creator Connections campaign found{liveBrand ? ` · ${liveBrand}` : ''} — this will auto-send on Amazon.
              </div>
            ) : (
              <>
                <button onClick={() => runFind()} disabled={finding || sending}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-semibold border disabled:opacity-60"
                  style={{ color: '#7C3AED', borderColor: '#d6c6fb', background: 'rgba(124,58,237,0.05)' }}>
                  {finding ? <Loader2 size={13} className="animate-spin" /> : <Radar size={13} />}
                  {finding ? 'Searching Creator Connections…' : 'Search Creator Connections — can I auto-send this?'}
                </button>
                {finding && (
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
                    SCOUT is checking Amazon in the background (search + ID match). This can take a minute — you won&apos;t leave this page.
                  </p>
                )}
                {findMiss && <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-soft)' }}>{findMiss}</p>}
              </>
            )}
          </div>
        )}

        <div className="p-5 pt-3 flex items-center gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] font-semibold" style={{ color: 'var(--text-soft)' }}>Cancel</button>
          <button onClick={canSend ? send : copyAll} disabled={sending || drafting || nothingToSend}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}>
            {canSend
              ? <>{sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send {cleanSegments.length > 1 ? `${cleanSegments.length} messages` : 'message'}</>
              : <><Copy size={14} /> Copy {cleanSegments.length > 1 ? `${cleanSegments.length} messages` : 'message'}</>}
          </button>
        </div>
        <p className="px-5 pb-4 -mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {canSend
            ? <>SCOUT sends {cleanSegments.length > 1 ? `these ${cleanSegments.length} messages one after another` : 'this message'} from your Amazon session — in the background, without leaving this page (it even fixes your Store ID if needed). Review {cleanSegments.length > 1 ? 'them' : 'it'} above first; {cleanSegments.length > 1 ? 'they go' : 'it goes'} out as written.</>
            : finding
            ? <>Checking Creator Connections for this campaign so SCOUT can auto-send it on Amazon — the button flips to <b>Send</b> the moment it&apos;s found. You can copy the pitch now instead if you&apos;d rather.</>
            : <>No live Creator Connections chat found for this one, so Amazon has no brand chat to auto-send through. Copy the pitch and send it wherever you reach the brand (email, their site, or their CC campaign if they run one).</>}
        </p>
      </div>
    </div>
  )
}
