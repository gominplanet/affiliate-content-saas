// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Post a saved TikTok Shop product to Facebook, Instagram or Pinterest.
//
// Every endpoint this calls already exists and is unchanged. The whole job is
// handing them the right three things:
//
//   the DESIGN      generate-thumbnail, given the product's own photo as a
//                   reference, so the picture is of the actual product rather
//                   than an invented one.
//   the CAPTION     social-caption, given the saved product id, so it writes
//                   from the facts read off the product page and obeys the same
//                   hands-on answer the blog post does.
//   the DESTINATION useShowcase + showcaseUrl, set to THIS product's pasted
//                   share link. resolvePostDestination then drops the ASIN,
//                   suppresses the Amazon price claims and swaps the Associates
//                   disclosure, exactly as it does for an account showcase.
//
// The share link is passed verbatim. It carries _t and u_code, which is what
// credits the sale, and a tidied version would strip them.
'use client'

import { useCallback, useState } from 'react'
import { Loader2, Send, CalendarClock, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'

type Network = 'facebook' | 'instagram' | 'pinterest'

const CFG: Record<Network, { label: string; accent: string; format: string; endpoint: string; hint: string }> = {
  facebook: { label: 'Facebook', accent: '#1877F2', format: 'fb', endpoint: '/api/amazon/fb', hint: 'Your product link goes in the caption.' },
  instagram: { label: 'Instagram', accent: '#E1306C', format: 'ig', endpoint: '/api/amazon/ig', hint: 'Instagram blocks caption links, so this routes through your bio.' },
  pinterest: { label: 'Pinterest', accent: '#E60023', format: 'pin', endpoint: '/api/amazon/pin', hint: 'The pin links straight to your product.' },
}

export interface PanelProduct {
  product_id: string
  share_url: string
  title: string
  image_url: string | null
}

export default function TikTokSocialPanel({ product, onClose }: { product: PanelProduct; onClose: () => void }) {
  const [network, setNetwork] = useState<Network>('facebook')
  const [designUrl, setDesignUrl] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState<'design' | 'publish' | null>(null)
  // Held on screen. A failed publish is the moment a creator most needs to read
  // what happened, and a toast is gone before they have finished reacting.
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [posted, setPosted] = useState<{ url?: string; scheduledAt?: string } | null>(null)
  const [scheduleAt, setScheduleAt] = useState('')

  const muted = { color: 'var(--text-2)' } as const
  const cfg = CFG[network]

  const design = useCallback(async () => {
    setBusy('design'); setError(null); setPosted(null)
    // The caption is written WHILE the image renders. It is a cheap Haiku call
    // against a slow image one, so serialising them would add a minute for
    // nothing.
    void fetch('/api/amazon/social-caption', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ network: network === 'pinterest' ? 'facebook' : network, tiktokProductId: product.product_id }),
    }).then(r => r.json()).then(c => { if (c?.caption) setCaption(prev => prev || (c.caption as string)) })
      .catch(() => { /* the box stays editable; a missing caption is not a failure */ })

    try {
      const r = await fetch('/api/youtube/generate-thumbnail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(290000),
        body: JSON.stringify({
          videoTitle: 'Product spotlight', textMode: 'graphic', format: cfg.format,
          noHuman: true,
          productTitle: product.title,
          // The product's OWN photo as the reference. Without it the designer
          // invents a plausible wrong product, which is the worst failure this
          // path has because it looks completely fine.
          ...(product.image_url ? { customProductImageUrls: [product.image_url] } : {}),
          briefKey: `${product.product_id}::${Date.now()}`,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((d.message as string) || (d.error as string) || 'The design failed. Try again.')
      const url = (Array.isArray(d.thumbnailUrls) && d.thumbnailUrls[0]) || d.thumbnailUrl
      if (!url) throw new Error('No design came back. Try again.')
      setDesignUrl(url as string)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The design failed. Try again.')
    } finally { setBusy(null) }
  }, [network, cfg.format, product])

  const publish = useCallback(async (when: 'now' | 'later') => {
    if (!designUrl) return
    if (when === 'later' && !scheduleAt) { setError('Pick a date and time to schedule.'); return }
    setBusy('publish'); setError(null); setNote(null)
    try {
      const r = await fetch(cfg.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
          imageUrl: designUrl,
          productTitle: product.title,
          // THE DESTINATION. An explicit per-post override, so this works
          // whatever the account default is set to and whether or not the
          // creator has an account-level showcase saved at all.
          useShowcase: true,
          showcaseUrl: product.share_url,
          caption: caption.trim() || undefined,
          ...(network === 'pinterest' ? { title: product.title.slice(0, 95), description: caption.trim() || undefined } : {}),
          ...(when === 'later' ? { scheduledAt: new Date(scheduleAt).toISOString() } : {}),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((d.error as string) || 'The post failed. Try again.')
      // Either of these can say the showcase was asked for and not used, which
      // is a successful post pointing somewhere the creator did not choose.
      const n = (d.geniuslinkNote as string) || (d.destinationNote as string) || null
      if (n) setNote(n)
      setPosted({ url: d.postUrl as string | undefined, scheduledAt: d.scheduledAt as string | undefined })
      toast.success(d.scheduledAt ? `Scheduled for ${cfg.label}.` : `Posted to ${cfg.label}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The post failed. Try again.')
    } finally { setBusy(null) }
  }, [designUrl, caption, cfg.endpoint, cfg.label, network, product, scheduleAt])

  return (
    <div className="rounded-xl border p-3 mt-2 flex flex-col gap-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
      <div className="flex items-center gap-1.5 flex-wrap">
        {(Object.keys(CFG) as Network[]).map(n => (
          <button key={n} type="button"
            onClick={() => { setNetwork(n); setDesignUrl(null); setCaption(''); setPosted(null); setError(null) }}
            className="px-2.5 py-1 rounded-lg border text-[11px] font-semibold"
            style={{
              borderColor: network === n ? CFG[n].accent : 'var(--border)',
              borderWidth: network === n ? 2 : 1,
              color: network === n ? CFG[n].accent : 'var(--text-2)',
            }}>{CFG[n].label}</button>
        ))}
        <button type="button" onClick={onClose} className="ml-auto text-[11px] underline" style={muted}>Close</button>
      </div>
      <p className="text-[11px]" style={muted}>{cfg.hint}</p>

      {designUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={designUrl} alt="" className="w-full rounded-lg border" style={{ borderColor: 'var(--border)' }} />
      ) : (
        <button type="button" onClick={() => void design()} disabled={busy !== null}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60"
          style={{ background: cfg.accent }}>
          {busy === 'design'
            ? <><Loader2 size={12} className="animate-spin" /> Designing…</>
            : <><ImageIcon size={12} /> Design the {cfg.label} post</>}
        </button>
      )}

      {designUrl && (
        <>
          <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={4}
            placeholder="Writing your caption…"
            className="w-full px-2.5 py-2 rounded-lg border text-[12px]"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void publish('now')} disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60"
              style={{ background: cfg.accent }}>
              {busy === 'publish' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Post now
            </button>
            <input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)}
              className="px-2 py-1.5 rounded-lg border text-[11px]"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }} />
            <button type="button" onClick={() => void publish('later')} disabled={busy !== null || !scheduleAt}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium disabled:opacity-60"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              <CalendarClock size={12} /> Schedule
            </button>
            <button type="button" onClick={() => void design()} disabled={busy !== null}
              className="text-[11px] underline ml-auto" style={muted}>Redesign</button>
          </div>
        </>
      )}

      {/* A post CAN succeed and still not point where the creator chose. That is
          not a failure of the request and it is not a success either, so it gets
          its own line rather than being folded into one or the other. */}
      {note && (
        <div className="rounded-lg border p-2.5" style={{ borderColor: '#d9770655', background: 'rgba(217,119,6,0.06)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text)' }}>{note}</p>
        </div>
      )}
      {error && (
        <div className="rounded-lg border p-2.5" style={{ borderColor: '#dc262655', background: 'rgba(220,38,38,0.06)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text)' }}>{error}</p>
        </div>
      )}
      {posted && (
        <p className="text-[11px]" style={{ color: '#10B981' }}>
          {posted.scheduledAt
            ? `Scheduled for ${new Date(posted.scheduledAt).toLocaleString()}.`
            : 'Posted.'}
          {posted.url && <> <a href={posted.url} target="_blank" rel="noreferrer" className="underline">View it</a></>}
        </p>
      )}
    </div>
  )
}
