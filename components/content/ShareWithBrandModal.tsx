'use client'

/**
 * ShareWithBrandModal — the "Share with brand" action on each Blog Post
 * Generator card. Pulls every link MVP stored for the post, assembles a
 * ready-to-send recap message from the creator's template, and lets them:
 *   - Copy the message (paste into Creator Connections, an email, a DM)
 *   - Email it (opens a pre-filled draft)
 *   - Open the product page (so OINK users can message the brand on Creator
 *     Connections right from the Amazon listing)
 *   - Polish it with AI (optional, keeps every link intact)
 *
 * Brand name is an EDITABLE, pre-filled field — never sent blind. The message
 * re-fills live as the brand name / link toggles change, until the user hand-
 * edits it (then it leaves their text alone; "Reset" re-generates).
 */

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { X, Copy, Mail, ExternalLink, Loader2, Sparkles, Check, RotateCcw, Video } from 'lucide-react'
import { fillRecapMessage, type RecapLink, type BrandRecapSettings } from '@/lib/brand-recap'
import { requestAmazonVideoForAsin } from '@/lib/extension-frame'

/** MVP's OINK affiliate link (same as the sidebar Recommended Tools row). */
const OINK_AFFILIATE_URL = 'https://geni.us/2y5sBo'

interface RecapData {
  brandGuess: string
  product: { name: string; url: string | null; isAmazon: boolean; asin?: string | null }
  amazonVideoUrl?: string | null
  links: RecapLink[]
  settings: BrandRecapSettings
  message: string
}

export default function ShareWithBrandModal({ postId, wpUrl, onClose }: {
  postId: string
  wpUrl?: string | null
  onClose: () => void
}) {
  const [data, setData] = useState<RecapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [brand, setBrand] = useState('')
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [message, setMessage] = useState('')
  const [edited, setEdited] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [findingVideo, setFindingVideo] = useState(false)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteUrl, setPasteUrl] = useState('')
  const [scanDiag, setScanDiag] = useState<string | null>(null)
  const [oinkMissing, setOinkMissing] = useState(false)

  // While this modal is open, tell the content page NOT to auto-refresh on
  // visibilitychange — the auto-find opens an Amazon tab (focus leaves +
  // returns), and a list reload would tear this modal down mid-flow.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__mvpBrandModalOpen = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => { (window as any).__mvpBrandModalOpen = false }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const url = `/api/blog/brand-recap/${postId}${wpUrl ? `?wpUrl=${encodeURIComponent(wpUrl)}` : ''}`
        const res = await fetch(url)
        // Guard against an HTML error page (502/timeout) parsing as JSON —
        // otherwise the user sees a raw "Unexpected token <" instead of a
        // clean message.
        const d = await res.json().catch(() => ({} as Record<string, unknown>))
        if (!res.ok) throw new Error((d as { error?: string }).error || 'Could not load this post’s links')
        if (cancelled) return
        setData(d as RecapData)
        setBrand((d.brandGuess as string) || '')
        // Default every CONTENT link on, but the product link OFF — it's the
        // brand's own listing, so it doesn't belong in a "here's where our
        // content is live" recap (it stays available as the button + an opt-in).
        setEnabled(Object.fromEntries((d.links as RecapLink[]).map(l => [l.platform, l.platform !== 'product'])))
        setMessage((d.message as string) || '')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [postId, wpUrl])

  const refill = useCallback(() => {
    if (!data) return
    const active = data.links.filter(l => enabled[l.platform])
    setMessage(fillRecapMessage(data.settings.template, {
      brand, product: data.product.name, links: active,
      name: data.settings.senderName, site: data.settings.siteUrl,
    }))
  }, [data, brand, enabled])

  // Auto-refill on brand/toggle change — unless the user has hand-edited.
  useEffect(() => {
    if (!edited) refill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand, enabled])

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true); setTimeout(() => setCopied(false), 1800)
      toast.success('Message copied — paste it anywhere')
    } catch {
      toast.error('Couldn’t copy — select the text and copy manually')
    }
  }

  function emailMessage() {
    const subject = data?.product.name ? `Our review of ${data.product.name} is live` : 'Our review is live'
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`, '_blank')
  }

  async function polish() {
    if (!data) return
    setPolishing(true)
    try {
      const res = await fetch('/api/blog/brand-recap/polish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, tone: data.settings.tone }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) throw new Error((d as { error?: string }).error || 'Polish failed')
      setMessage((d as { message: string }).message); setEdited(true)
      toast.success(d.polished ? 'Polished ✨' : 'Kept your draft (couldn’t improve it safely)')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Polish failed')
    } finally {
      setPolishing(false)
    }
  }

  // Add an Amazon video (vdp) URL to the recap (shared by extension-find + paste).
  function addAmazonVideoLink(url: string) {
    setData(d => {
      if (!d) return d
      if (d.links.some(l => l.platform === 'amazon_video')) {
        return { ...d, amazonVideoUrl: url, links: d.links.map(l => l.platform === 'amazon_video' ? { ...l, url } : l) }
      }
      const at = d.links.findIndex(l => l.platform === 'product')
      const next = [...d.links]
      next.splice(at >= 0 ? at + 1 : 0, 0, { platform: 'amazon_video', label: 'Amazon video review', url })
      return { ...d, amazonVideoUrl: url, links: next }
    })
    setEnabled(s => ({ ...s, amazon_video: true }))
    setEdited(false)
  }

  async function saveAmazonVideo(url: string): Promise<boolean> {
    const res = await fetch(`/api/blog/brand-recap/${postId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amazonVideoUrl: url, wpUrl }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(d.error || 'Couldn’t save that link'); return false }
    addAmazonVideoLink(url)
    return true
  }

  // Find the creator's Amazon video by piggybacking on OINK: the extension
  // opens the product page for this ASIN and reads the "Content Made" /vdp/
  // link OINK injects there. If OINK isn't detected, recommend it.
  async function findAmazonVideo() {
    if (!data?.product.asin) return
    const asin = data.product.asin.toUpperCase()
    setFindingVideo(true); setScanDiag(null); setOinkMissing(false)
    try {
      const res = await requestAmazonVideoForAsin(asin)
      if (!res.ok) {
        toast.error(res.error === 'not-installed'
          ? 'Open MVP with the SCOUT extension installed, then try again.'
          : 'Couldn’t open Amazon — make sure you’re signed in, then try again.')
        setShowPaste(true)
        return
      }
      if (res.video?.vdpUrl) {
        if (await saveAmazonVideo(res.video.vdpUrl)) toast.success('Found your Amazon video — added to the recap.')
        return
      }
      // No video found on the product page.
      if (res.oinkDetected) {
        // OINK is there but had no "Content Made" link for this product.
        setScanDiag('OINK is installed, but it didn’t show a video for this product. Upload it on Amazon first, or paste the link below.')
        setShowPaste(true)
      } else {
        // No OINK → recommend it (it surfaces the video link automatically).
        setOinkMissing(true)
        setShowPaste(true)
      }
    } catch {
      toast.error('Couldn’t scan Amazon. Paste the link below instead.')
      setShowPaste(true)
    } finally {
      setFindingVideo(false)
    }
  }

  const productUrl = data?.product.url || null
  const productBtnLabel = data?.product.isAmazon ? 'Open on Amazon' : 'Open product page'
  const hasAmazonVideo = !!data?.links.some(l => l.platform === 'amazon_video')
  const canFindVideo = !!data?.product.asin && !hasAmazonVideo

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="card w-full max-w-lg max-h-[88vh] overflow-y-auto p-5"
        style={{ background: 'var(--surface, #fff)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Share with the brand</h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">A ready-to-send recap of everywhere this is live.</p>
          </div>
          <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white p-1" title="Close"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#86868b] py-12 justify-center">
            <Loader2 size={16} className="animate-spin" /> Gathering your links…
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-[#ff3b30]">{error}</p>
          </div>
        ) : data && (
          <div className="flex flex-col gap-4 mt-3">
            {/* Brand name — editable, pre-filled */}
            <div>
              <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Brand name <span className="font-normal text-[#86868b]">(check this is right)</span></label>
              <input
                value={brand}
                onChange={e => { setBrand(e.target.value); setEdited(false) }}
                placeholder="e.g. SHEHDS"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] bg-[var(--surface,#fff)] text-sm focus:outline-none focus:border-[#7C3AED]"
              />
            </div>

            {/* Links checklist */}
            <div>
              <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Links to include</p>
              {data.links.length === 0 ? (
                <p className="text-xs text-[#86868b]">No shareable links found yet — publish this post / its socials first.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {data.links.map(l => (
                    <label key={l.platform} className="flex items-center gap-2 text-xs cursor-pointer py-1">
                      <input
                        type="checkbox"
                        checked={!!enabled[l.platform]}
                        onChange={e => { setEnabled(s => ({ ...s, [l.platform]: e.target.checked })); setEdited(false) }}
                        className="accent-[#7C3AED] w-3.5 h-3.5"
                      />
                      <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7] w-28 shrink-0">
                        {l.label}
                        {l.platform === 'product' && <span className="block text-[10px] font-normal text-[#86868b]">their own listing</span>}
                      </span>
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline truncate flex-1" title={l.url}>{l.url}</a>
                    </label>
                  ))}
                </div>
              )}
              {canFindVideo && (
                <div className="mt-2.5 rounded-lg border border-[var(--border-2,#e5e5e7)] bg-[var(--surface-2,#f7f7f8)] p-2.5 flex flex-col gap-2">
                  <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5"><Video size={12} className="text-[#7C3AED]" /> Add your Amazon video</p>
                  <button
                    onClick={findAmazonVideo}
                    disabled={findingVideo}
                    title="Open the product page and grab your Amazon video link (works with the OINK extension installed)"
                    className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-50"
                  >
                    {findingVideo ? <Loader2 size={12} className="animate-spin" /> : <Video size={12} />}
                    {findingVideo ? 'Looking on Amazon…' : 'Find it automatically'}
                  </button>

                  {oinkMissing && (
                    <div className="rounded-md p-2 text-[10px] leading-snug" style={{ background: 'rgba(224,33,138,0.08)', border: '1px solid rgba(224,33,138,0.30)' }}>
                      <p className="text-[#1d1d1f] dark:text-[#f5f5f7]">Auto-detect needs the free <strong>OINK</strong> extension — it surfaces your Amazon video link right on the product page.</p>
                      <a href={OINK_AFFILIATE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 font-semibold" style={{ color: '#E0218A' }}>
                        Get OINK (free) <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                  {scanDiag && <p className="text-[10px] text-[#86868b] leading-snug">{scanDiag}</p>}

                  <div className="border-t border-[var(--border-2,#e5e5e7)] pt-2">
                    <p className="text-[10px] text-[#86868b] leading-snug mb-1">…or paste it: on the product page, right-click Amazon&rsquo;s <strong>&ldquo;Content Made&rdquo;</strong> link → <strong>Copy link</strong>.</p>
                    <div className="flex items-center gap-1.5">
                      <input
                        value={pasteUrl}
                        onChange={e => setPasteUrl(e.target.value)}
                        placeholder="https://www.amazon.com/vdp/…"
                        className="flex-1 px-2 py-1.5 rounded-md border border-[var(--border-2,#e5e5e7)] bg-[var(--surface,#fff)] text-[11px] font-mono focus:outline-none focus:border-[#7C3AED]"
                      />
                      <button
                        onClick={async () => { if (pasteUrl.trim() && await saveAmazonVideo(pasteUrl.trim())) { setPasteUrl(''); toast.success('Added your Amazon video.') } }}
                        className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold border border-[var(--border-2,#e5e5e7)] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[var(--surface-hover,#f0f0f2)]"
                      >Add</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Message */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Message</label>
                <div className="flex items-center gap-3">
                  {edited && (
                    <button onClick={() => { setEdited(false); refill() }} className="text-[11px] text-[#86868b] hover:text-[#7C3AED] inline-flex items-center gap-1"><RotateCcw size={11} /> Reset</button>
                  )}
                  <button onClick={polish} disabled={polishing} className="text-[11px] text-[#7C3AED] hover:underline inline-flex items-center gap-1 disabled:opacity-50">
                    {polishing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Polish with AI
                  </button>
                </div>
              </div>
              <textarea
                value={message}
                onChange={e => { setMessage(e.target.value); setEdited(true) }}
                rows={11}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] bg-[var(--surface,#fff)] text-[13px] leading-relaxed resize-none focus:outline-none focus:border-[#7C3AED]"
                spellCheck
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={copyMessage} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9]">
                {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy message</>}
              </button>
              <button onClick={emailMessage} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[var(--border-2,#e5e5e7)] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[var(--surface-hover,#f5f5f7)]">
                <Mail size={13} /> Email
              </button>
              {productUrl && (
                <a
                  href={productUrl} target="_blank" rel="noopener noreferrer"
                  title="Open the product page — message the brand on Creator Connections from here (e.g. with the Oink extension)"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#FFC200] text-[#1d1d1f] hover:bg-[#FFD000]"
                >
                  <ExternalLink size={13} /> {productBtnLabel}
                </a>
              )}
            </div>
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] -mt-1">
              Tip: on the product page you can message the brand directly through Amazon Creator Connections (e.g. with the Oink extension).
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
