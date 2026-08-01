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
import { X, Copy, Mail, ExternalLink, Loader2, Sparkles, Check, RotateCcw, Video, Send } from 'lucide-react'
import { fillRecapMessage, CC_GROUP_BREAK, type RecapLink, type BrandRecapSettings } from '@/lib/brand-recap'
import { requestAmazonVideoForAsin, requestFindCampaign, requestAcceptAndSendBrand, requestSendByCampaign } from '@/lib/extension-frame'

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
  // Creator Connections auto-send state. 'idle' → resolve the brand's CC chat
  // for this product's ASIN → 'sending' → 'done' | a fallback state that tells
  // the user why auto-send is not possible (no ASIN / no campaign / no SCOUT).
  // One-click flow: resolve → auto-accept if needed → send. No extra input.
  const [ccPhase, setCcPhase] = useState<'idle' | 'resolving' | 'accepting' | 'sending' | 'done'>('idle')
  const [ccNote, setCcNote] = useState<{ kind: 'info' | 'error' | 'ok'; text: string } | null>(null)
  // A compact "what SCOUT saw" line shown under the note on a find miss, so a
  // failure is diagnosable at a glance (which tabs, card counts, brands).
  const [ccDiag, setCcDiag] = useState<string | null>(null)
  // The resolved Creator Connections page for THIS product's campaign (cached
  // per ASIN once resolved by a send or a Smart Scan). When present, "Open
  // Campaigns" jumps straight to this campaign instead of the whole dashboard.
  const [ccDetailsUrl, setCcDetailsUrl] = useState<string | null>(null)
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

  // Look up this product's already-resolved CC campaign URL (cached per ASIN)
  // so "Open Campaigns" can jump straight to the campaign when we know it.
  useEffect(() => {
    const asin = (data?.product.asin || '').toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) { setCcDetailsUrl(null); return }
    let cancelled = false
    fetch(`/api/campaigns/message-link?asin=${encodeURIComponent(asin)}`)
      .then(r => r.json()).then(d => { if (!cancelled && d?.detailsUrl) setCcDetailsUrl(d.detailsUrl) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [data?.product.asin])

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true); setTimeout(() => setCopied(false), 1800)
      toast.success('Message copied — paste it anywhere')
    } catch {
      toast.error('Couldn’t copy — select the text and copy manually')
    }
  }

  // Send this recap to the brand THROUGH Amazon Creator Connections, to the
  // RIGHT brand automatically: resolve this product's ASIN to its CC campaign
  // chat (cache first, then a live SCOUT lookup), then hand the message to
  // SCOUT, which opens that campaign in the background and sends it — splitting
  // the message-group blocks itself, so nothing is ever hand-pasted. Falls back
  // with a clear reason when there's no ASIN, no live campaign, or no SCOUT.
  // ONE click does everything, no further input: resolve the campaign for this
  // product's ASIN → if it isn't accepted yet, accept it (Amazon only opens the
  // brand chat after acceptance) → send the message-group blocks.
  async function sendOnCc() {
    if (!data || ccPhase === 'resolving' || ccPhase === 'accepting' || ccPhase === 'sending') return
    const asin = (data.product.asin || '').toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      setCcNote({ kind: 'info', text: 'This product has no Amazon ASIN, so there is no Creator Connections chat to send through. Use Copy message or Email instead.' })
      return
    }

    setCcPhase('resolving'); setCcNote(null); setCcDiag(null)
    try {
      // Resolve the brand's CC campaign URL for this ASIN. Cache first (from a
      // prior message or a Smart Scan), then a live SCOUT grid lookup that also
      // tells us the campaign's status (opportunity / active / completed).
      // Look this ASIN up in OUR catalog FIRST — instant, and it gives us the
      // exact campaign_id(s) + brand with zero Amazon traffic.
      let inCatalog: boolean | null = null
      let catBrand: string | null = null
      let catCampaignIds: string[] = []
      let catBrandCampaignIds: string[] = []
      try {
        const c = await fetch(`/api/campaigns/catalog-by-asin?asin=${encodeURIComponent(asin)}`).then(r => r.json())
        inCatalog = c?.inCatalog ?? null
        catBrand = c?.brand ?? null
        catCampaignIds = Array.isArray(c?.campaignIds) ? c.campaignIds : []
        catBrandCampaignIds = Array.isArray(c?.brandCampaignIds) ? c.brandCampaignIds : []
      } catch { /* unknown — proceed to SCOUT */ }
      if (inCatalog === false) {
        setCcPhase('idle')
        setCcNote({ kind: 'info', text: 'This product isn’t in Creator Connections, so there’s no brand chat to send through. Email the brand instead (use Copy message or Email), or reach them from the product page.' })
        return
      }

      // FAST PATH (preferred — BEFORE any cached URL): the catalog gave us the
      // exact campaign_id(s), so deep-link STRAIGHT to the campaign and send — no
      // grid search, and never a stale cached link that could time out. SCOUT
      // verifies the ASIN on the page before typing.
      let directReason = ''
      if (catCampaignIds.length || catBrandCampaignIds.length) {
        const groups = message.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean)
        const ccText = groups.length > 1 ? groups.join(`\n\n${CC_GROUP_BREAK}\n\n`) : message
        setCcPhase('sending')
        setCcNote({ kind: 'info', text: 'Opening the campaign and sending your message…' })
        // Try the product's own campaign(s) first (ASIN-verified); if those have
        // ended, fall back to any LIVE campaign from the same brand — CC messaging
        // is per-brand, so it lands in the same chat.
        const direct = await requestSendByCampaign(catCampaignIds, ccText, asin, catBrandCampaignIds)
        if (direct.ok) {
          if (direct.detailsUrl) setCcDetailsUrl(direct.detailsUrl)
          setCcPhase('done')
          setCcNote({ kind: 'ok', text: `Sent to the brand on Creator Connections${direct.groups && direct.groups > 1 ? ` (${direct.groups} messages)` : ''}.` })
          toast.success('Sent to the brand on Creator Connections ✓')
          return
        }
        if (direct.error === 'not-installed') {
          setCcPhase('idle')
          setCcNote({ kind: 'info', text: 'Auto-send needs the SCOUT extension. Without it, use Copy message or Email.' })
          return
        }
        // VISIBLE-TAB path: SCOUT opened the brand chat in a real tab and pre-filled
        // your message. It couldn't confirm the auto-click went through, so rather
        // than open MORE tabs via the grid fallback, hand it to the user — the chat
        // is right there with the message typed in, one click from sent.
        if (direct.leftOpen) {
          if (direct.detailsUrl) setCcDetailsUrl(direct.detailsUrl)
          setCcPhase('idle')
          setCcDiag(direct.reason ? `SCOUT stopped at: ${direct.reason}` : null)
          setCcNote({ kind: 'info', text: 'SCOUT opened the brand chat in a new tab with your message ready. Switch to that tab and click Send to finish (if a “sharing personal information” box appears, click OK). It may already have gone through — check the chat.' })
          toast('Finish in the Amazon tab SCOUT just opened', { icon: '➡️' })
          return
        }
        // No tab was left open (e.g. couldn't open any campaign) → remember WHY and
        // fall through to the grid find as a last resort.
        directReason = `${direct.reason || direct.error || 'unknown'}${direct.groups ? ` (sent ${direct.groups})` : ''}`
        setCcDiag(`Direct send stopped at: ${directReason}`)
        setCcPhase('resolving')
      }

      // FALLBACK: a previously-resolved URL (cache), then a live grid find.
      let detailsUrl = ''
      let status: 'opportunity' | 'active' | 'completed' | null = null
      try {
        const r = await fetch(`/api/campaigns/message-link?asin=${encodeURIComponent(asin)}`)
        const d = await r.json().catch(() => ({}))
        if (d?.detailsUrl) { detailsUrl = d.detailsUrl; setCcDetailsUrl(d.detailsUrl) }
      } catch { /* fall through to live find */ }

      if (!detailsUrl) {
        // In the catalog (or couldn't tell) → resolve the campaign live with
        // SCOUT (fast ASIN search). Pass the catalog's brand so SCOUT can VERIFY
        // it opened the right campaign cheaply (no flaky details-page ASIN read),
        // and it also gives us the accept status.
        const find = await requestFindCampaign('', asin, catBrand, catCampaignIds)
        if (find.error === 'not-installed') {
          setCcPhase('idle')
          setCcNote({ kind: 'info', text: 'Auto-send needs the SCOUT extension (it sends inside your own Amazon session). Without it, use Copy message or Email, or message the brand from the product page.' })
          return
        }
        if (find.ok && find.found && find.detailsUrl) {
          detailsUrl = find.detailsUrl
          status = find.status ?? null
          setCcDetailsUrl(find.detailsUrl)
          void fetch('/api/campaigns/message-link', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin, campaignId: find.campaignId ?? null, detailsUrl }),
          }).catch(() => {})
        } else {
          // We know a campaign exists (it's in our catalog) but SCOUT couldn't
          // open it live — point them to accept it by hand. Surface what SCOUT saw
          // so a miss is diagnosable (which tabs, how many cards, which brands).
          setCcPhase('idle')
          const d = find.diag
          if (d?.tabs?.length) {
            const parts = d.tabs.map(t => {
              const b = t.brands?.length ? ` (${t.brands.slice(0, 4).join(', ')})` : ''
              return `${t.status}: ${t.cards} card${t.cards === 1 ? '' : 's'}${b}${t.matched ? ' ✓' : ''}`
            })
            setCcDiag(`${directReason ? `Direct: ${directReason} · ` : ''}SCOUT looked for “${d.wantBrand || catBrand || asin}” → ${parts.join(' · ')}`)
          }
          if (inCatalog === true) {
            setCcNote({ kind: 'info', text: `This product does have a Creator Connections campaign${catBrand ? ` from ${catBrand}` : ''}, but SCOUT couldn’t open it automatically just now. Click Open Campaigns to accept it on Amazon, then Send again — or use Copy message / Email.` })
          } else {
            setCcNote({ kind: 'info', text: 'Couldn’t confirm a Creator Connections campaign for this product right now. Use Copy message or Email, or try Open Campaigns to check on Amazon.' })
          }
          return
        }
      }

      if (status === 'completed') {
        setCcPhase('idle')
        setCcNote({ kind: 'info', text: 'This Creator Connections campaign has ended, so there is no brand chat. Use Copy message or Email instead.' })
        return
      }

      // Auto-accept unless we already know it's accepted (status='active'). The
      // accept is idempotent — SCOUT returns already=true if you're in — so on
      // the cache path (status unknown) it's a safe no-op when already joined.
      const knownAccepted = status === 'active'
      await deliverToCc(asin, detailsUrl, knownAccepted, false)
    } catch (e) {
      setCcPhase('idle')
      setCcNote({ kind: 'error', text: e instanceof Error ? e.message : 'Could not send through Creator Connections.' })
    }
  }

  // Accept-if-needed AND send, in ONE SCOUT tab. SCOUT opens the campaign once,
  // accepts it when it's an un-accepted opportunity, then sends on the same tab —
  // no cross-tab teardown race (the old "Frame with ID 0 was removed" failure).
  async function deliverToCc(asin: string, detailsUrl: string, knownAccepted: boolean, _retried: boolean) {
    const groups = message.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean)
    const ccText = groups.length > 1 ? groups.join(`\n\n${CC_GROUP_BREAK}\n\n`) : message
    // Copy reflects that it may accept first when we don't already know it's active.
    setCcPhase(knownAccepted ? 'sending' : 'accepting')
    setCcNote({ kind: 'info', text: knownAccepted ? 'Sending your message to the brand…' : 'Accepting the campaign, then sending your message…' })
    const res = await requestAcceptAndSendBrand(detailsUrl, ccText, asin)
    if (res.ok) {
      setCcPhase('done')
      setCcNote({ kind: 'ok', text: `Sent to the brand on Creator Connections${res.groups && res.groups > 1 ? ` (${res.groups} messages)` : ''}.` })
      toast.success('Sent to the brand on Creator Connections ✓')
      return
    }
    if (res.error === 'not-installed') {
      setCcPhase('idle')
      setCcNote({ kind: 'info', text: 'Auto-send needs the SCOUT extension. Without it, use Copy message or Email.' })
      return
    }
    // Give up: drop any stale cached URL so the next attempt re-resolves.
    void fetch(`/api/campaigns/message-link?asin=${encodeURIComponent(asin)}`, { method: 'DELETE' }).catch(() => {})
    setCcPhase('idle')
    // asin-mismatch = SCOUT opened a campaign that doesn't sell this product (a
    // stale link). We just cleared the cache; a second Send re-resolves fresh.
    if (res.reason === 'asin-mismatch') {
      setCcNote({ kind: 'error', text: 'The saved campaign link pointed to a different product, so nothing was sent (we’ve cleared it). Click Send again to look it up fresh, or use Copy message / Email.' })
      setCcDetailsUrl(null)
      return
    }
    setCcNote({ kind: 'error', text: `Could not send through Creator Connections (${res.reason || res.error || 'unknown'}). Use Copy message or Email, or Open on Amazon to do it by hand.` })
  }

  function emailMessage() {
    const subject = data?.product.name ? `Our review of ${data.product.name} is live` : 'Our review is live'
    // mailto: is handled by the OS mail client, not a page navigation — so set
    // location.href directly. window.open(mailto, '_blank') leaves an orphan
    // blank tab behind in most browsers.
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
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
      // No video matched on the product page — explain the most likely reason.
      if (res.signedOut) {
        // The background tab landed on Amazon's sign-in page, so the creator's
        // own "Content Made" link is never shown.
        setScanDiag('The Amazon tab opened on a sign-in screen. Sign in to Amazon in your browser, then try again — or paste the link below.')
        setShowPaste(true)
      } else if (res.contentMadeSeen) {
        // Amazon's "Content Made" section was on the page but we couldn't read a
        // usable video link — surface the manual copy path.
        setScanDiag('Couldn’t read a video link for this product. If you’ve uploaded your Amazon video, right-click its “Content Made” link → Copy link and paste it below.')
        setShowPaste(true)
      } else {
        // No creator-video signal at all → likely no video published yet for
        // this product (OINK can also help surface the link automatically).
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
        // Explicit SOLID background in both themes. --surface resolves to a
        // translucent/glassy value in dark mode, which let the page bleed
        // through the modal; force an opaque surface so it's always readable.
        className="card w-full max-w-lg max-h-[88vh] overflow-y-auto p-5 !bg-white dark:!bg-[#16161a]"
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

            {/* Actions.
                Two clear paths:
                  · Email / DM  → "Copy message" (clean text) or "Email".
                  · Creator Connections → "Send on Creator Connections", which
                    resolves THIS product's brand chat and has SCOUT send it to
                    the right brand automatically (it splits the message-group
                    blocks itself, so nobody ever pastes a marker). */}
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={copyMessage} title="Clean text with no markers. Use this for email or DMs." className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9]">
                {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy message <span className="font-normal opacity-80">· email / DM</span></>}
              </button>
              <button onClick={emailMessage} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[var(--border-2,#e5e5e7)] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[var(--surface-hover,#f5f5f7)]">
                <Mail size={13} /> Email
              </button>
              <button
                onClick={sendOnCc}
                disabled={ccPhase === 'resolving' || ccPhase === 'accepting' || ccPhase === 'sending'}
                title="One click: finds the campaign, accepts it if needed, and sends this recap to the brand automatically through Amazon Creator Connections (needs the SCOUT extension)."
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#FFC200] bg-[#FFF7DB] text-[#1d1d1f] hover:bg-[#FFEFB0] disabled:opacity-60"
              >
                {ccPhase === 'resolving'
                  ? <><Loader2 size={13} className="animate-spin" /> Finding the campaign…</>
                  : ccPhase === 'accepting'
                  ? <><Loader2 size={13} className="animate-spin" /> Accepting…</>
                  : ccPhase === 'sending'
                  ? <><Loader2 size={13} className="animate-spin" /> Sending…</>
                  : ccPhase === 'done'
                  ? <><Check size={13} /> Sent on CC</>
                  : <><Send size={13} /> Send on Creator Connections</>}
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
              {/* Open THIS product's Creator Connections campaign page directly
                  when we've resolved it (from a send or Smart Scan); otherwise
                  fall back to the campaigns dashboard filtered to New
                  Opportunities. Amazon fills in your creator id from the session. */}
              <a
                href={ccDetailsUrl || 'https://affiliate-program.amazon.com/p/connect/requests?status=opportunity&type=affiliate-plus'}
                target="_blank" rel="noopener noreferrer"
                title={ccDetailsUrl ? 'Open this product’s Creator Connections campaign on Amazon' : 'Open your Creator Connections campaigns (New Opportunities) on Amazon'}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#FFC200] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#FFF7DB]"
              >
                <ExternalLink size={13} /> {ccDetailsUrl ? 'Open this campaign' : 'Open Campaigns'}
              </a>
            </div>
            {ccNote && (
              <p className="text-[11px] -mt-1 leading-relaxed" style={{ color: ccNote.kind === 'error' ? '#ff3b30' : ccNote.kind === 'ok' ? '#1f8a3a' : '#86868b' }}>
                {ccNote.text}
              </p>
            )}
            {ccDiag && (
              <p className="text-[10px] -mt-1 font-mono leading-snug text-[#86868b] dark:text-[#8e8e93] break-words">
                {ccDiag}
              </p>
            )}
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] -mt-1 leading-relaxed">
              <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Emailing the brand?</strong> Use <strong>Copy message</strong> or <strong>Email</strong>: clean text, ready to send. <strong>Send on Creator Connections</strong> delivers this same recap to the right brand automatically through Amazon (it needs the SCOUT extension and a live campaign for this product).
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
