// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Instagram / Facebook composer for the Social Influencer page. Same flow as the
// Pinterest one: product → MVP Art Director design → AI caption (written while
// the image renders) → affiliate link → publish now or schedule. Single caption
// box (no board), format-correct render per network.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, User, Package, Wand2, Send, AlertCircle, ExternalLink, Check, CalendarClock } from 'lucide-react'

interface FaceModel { id: string; name: string }
type Network = 'instagram' | 'facebook'

const CFG: Record<Network, { label: string; accent: string; format: 'ig' | 'fb'; endpoint: string; captionHint: string }> = {
  instagram: { label: 'Instagram', accent: '#E1306C', format: 'ig', endpoint: '/api/amazon/ig', captionHint: 'IG blocks caption links, so the link routes through your bio automatically.' },
  facebook: { label: 'Facebook', accent: '#1877F2', format: 'fb', endpoint: '/api/amazon/fb', captionHint: 'Your affiliate link is added to the caption automatically.' },
}

function defaultScheduleValue(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function PostComposer({ network, presetProduct }: { network: Network; presetProduct?: { value: string; nonce: number } }) {
  const cfg = CFG[network]
  const [product, setProduct] = useState('')
  const [mode, setMode] = useState<'face' | 'product'>('face')
  const [faces, setFaces] = useState<FaceModel[]>([])
  const [faceId, setFaceId] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [postType, setPostType] = useState<'feed' | 'story'>('feed') // IG only

  const [connected, setConnected] = useState<boolean | null>(null)
  const [caption, setCaption] = useState('')
  const [copyBusy, setCopyBusy] = useState(false)
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [scheduleAt, setScheduleAt] = useState('')
  const [pubBusy, setPubBusy] = useState(false)
  const [pubError, setPubError] = useState<string | null>(null)
  const [result, setResult] = useState<{ postUrl?: string; scheduledAt?: string; note: string | null } | null>(null)

  useEffect(() => {
    if (presetProduct?.value) setProduct(presetProduct.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetProduct?.nonce])

  useEffect(() => {
    (async () => {
      try {
        const d = await fetch('/api/face-models').then(r => r.json()).catch(() => ({}))
        const ready = (d.models || []).filter((m: { status?: string }) => m.status === 'ready').map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }))
        setFaces(ready)
        if (ready.length > 0) setFaceId(ready[0].id); else setMode('product')
      } catch { /* ignore */ }
      try {
        const s = await fetch('/api/amazon/social-status').then(r => r.json())
        setConnected(!!s?.[network]?.connected)
      } catch { setConnected(false) }
    })()
  }, [network])

  const generate = useCallback(async () => {
    const raw = product.trim()
    if (!raw) { setGenError('Paste an Amazon product link or ASIN first.'); return }
    if (mode === 'face' && !faceId) { setGenError('Pick a face, or switch to Product only.'); return }
    setGenBusy(true); setGenError(null); setThumbUrl(null); setResult(null); setCaption('')
    const isUrl = /^https?:\/\//i.test(raw)
    const isAsin = /^[A-Z0-9]{10}$/i.test(raw)
    const bk = `${(isAsin ? raw.toUpperCase() : raw)}::${Date.now()}`

    // Caption written in parallel with the image.
    setCopyBusy(true)
    fetch('/api/amazon/social-caption', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ network, ...(isUrl ? { productUrl: raw } : { asin: raw.toUpperCase() }) }),
    }).then(r => r.json()).then((c) => { if (c?.caption) setCaption(prev => prev || c.caption) })
      .catch(() => { /* best-effort */ }).finally(() => setCopyBusy(false))

    const fmt = network === 'instagram' && postType === 'story' ? 'story' : cfg.format
    const bodyReq: Record<string, unknown> = {
      videoTitle: 'Product spotlight', textMode: 'graphic', format: fmt, briefKey: bk,
      ...(isUrl ? { productUrl: raw } : isAsin ? { asin: raw.toUpperCase() } : { productUrl: raw }),
      ...(mode === 'product' ? { noHuman: true } : { faceModelId: faceId }),
    }
    try {
      const res = await fetch('/api/youtube/generate-thumbnail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(290000), body: JSON.stringify(bodyReq),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data.message as string) || (data.error as string) || 'Design failed. Try again.')
      const url = (Array.isArray(data.thumbnailUrls) && data.thumbnailUrls[0]) || data.thumbnailUrl
      if (!url) throw new Error('No design came back. Try again.')
      setThumbUrl(url)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Design failed. Try again.')
    } finally { setGenBusy(false) }
  }, [product, mode, faceId, network, cfg.format, postType])

  const publish = useCallback(async () => {
    if (!thumbUrl) return
    if (when === 'later' && !scheduleAt) { setPubError('Pick a date and time to schedule.'); return }
    setPubBusy(true); setPubError(null); setResult(null)
    const raw = product.trim()
    const isUrl = /^https?:\/\//i.test(raw)
    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
          imageUrl: thumbUrl,
          ...(isUrl ? { productUrl: raw } : { asin: raw.toUpperCase() }),
          caption: caption.trim() || undefined,
          ...(network === 'instagram' ? { postType } : {}),
          ...(when === 'later' ? { scheduledAt: new Date(scheduleAt).toISOString() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data.error as string) || 'Post failed. Try again.')
      if (data.caption && !caption) setCaption(data.caption)
      setResult({ postUrl: data.postUrl as string | undefined, scheduledAt: data.scheduledAt as string | undefined, note: (data.geniuslinkNote as string) || null })
    } catch (err) {
      setPubError(err instanceof Error ? err.message : 'Post failed. Try again.')
    } finally { setPubBusy(false) }
  }, [thumbUrl, product, caption, when, scheduleAt, cfg.endpoint, network, postType])

  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#a1a1a6]'
  const selCls = (active: boolean) => `flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition ${active ? 'bg-[var(--a)]/5' : 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'}`

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 flex flex-col gap-5" style={{ ['--a' as string]: cfg.accent }}>
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${cfg.accent}1a` }}>
          <Send size={16} style={{ color: cfg.accent }} />
        </span>
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--text)' }}>Create a {cfg.label} post</h2>
          <p className="text-[11px]" style={{ color: 'var(--text-soft)' }}>Design → AI caption → affiliate link → publish or schedule</p>
        </div>
      </div>

      {connected === false && (
        <div className="flex items-start gap-2 text-[13px] rounded-lg border p-3" style={{ color: 'var(--text-soft)', borderColor: `${cfg.accent}4d`, backgroundColor: `${cfg.accent}0d` }}>
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" style={{ color: cfg.accent }} />
          <span>{cfg.label} isn&apos;t connected yet. <Link href="/connect-socials" className="font-semibold hover:underline" style={{ color: cfg.accent }}>Connect it</Link> to publish.</span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Amazon product link or ASIN</span>
          <input value={product} onChange={e => setProduct(e.target.value)} placeholder="https://www.amazon.com/dp/B0…  or  B0D5H9M72G" className={inputCls} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setMode('face')} disabled={faces.length === 0} className={selCls(mode === 'face')} style={mode === 'face' ? { borderColor: cfg.accent, color: cfg.accent } : undefined}>
            <User size={15} /> With my face
          </button>
          <button onClick={() => setMode('product')} className={selCls(mode === 'product')} style={mode === 'product' ? { borderColor: cfg.accent, color: cfg.accent } : undefined}>
            <Package size={15} /> Product only
          </button>
        </div>
        {mode === 'face' && faces.length > 1 && (
          <select value={faceId} onChange={e => setFaceId(e.target.value)} className={inputCls}>
            {faces.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        {network === 'instagram' && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setPostType('feed')} className={selCls(postType === 'feed')} style={postType === 'feed' ? { borderColor: cfg.accent, color: cfg.accent } : undefined}>
              Feed post <span className="text-[10px] opacity-70">4:5</span>
            </button>
            <button onClick={() => { setPostType('story'); setWhen('now') }} className={selCls(postType === 'story')} style={postType === 'story' ? { borderColor: cfg.accent, color: cfg.accent } : undefined}>
              Story <span className="text-[10px] opacity-70">9:16</span>
            </button>
          </div>
        )}
        <button onClick={generate} disabled={genBusy}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#d2d2d7] dark:border-[#3a3a3c] text-sm font-semibold transition disabled:opacity-60" style={{ color: 'var(--text)' }}>
          {genBusy ? <><Loader2 size={16} className="animate-spin" /> Designing…</> : <><Wand2 size={16} /> {thumbUrl ? 'Regenerate design' : 'Generate design'}</>}
        </button>
        {genError && <p className="text-[13px] text-[#b91c1c] dark:text-[#f87171] flex items-start gap-1.5"><AlertCircle size={14} className="mt-0.5" />{genError}</p>}
      </div>

      {thumbUrl && (
        <div className="flex flex-col lg:flex-row gap-5 pt-1 border-t border-gray-100 dark:border-white/10">
          <div className="flex-shrink-0 w-full lg:w-56">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl} alt="Post preview" className="w-full max-w-[224px] mx-auto lg:mx-0 rounded-xl border border-gray-200 dark:border-white/10" />
          </div>
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
                Caption {copyBusy && <span className="inline-flex items-center gap-1 font-normal" style={{ color: 'var(--text-soft)' }}><Loader2 size={11} className="animate-spin" /> writing…</span>}
              </span>
              <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={5} placeholder={copyBusy ? 'AI is writing this…' : 'Caption'} className={`${inputCls} resize-none`} />
            </label>
            <p className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--text-soft)' }}>
              <Check size={12} className="mt-0.5 flex-shrink-0" style={{ color: '#34c759' }} /> {cfg.captionHint}
            </p>

            {!(network === 'instagram' && postType === 'story') && (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setWhen('now')} className={selCls(when === 'now')} style={when === 'now' ? { borderColor: cfg.accent, color: cfg.accent } : undefined}>
                  <Send size={14} /> Post now
                </button>
                <button onClick={() => { setWhen('later'); if (!scheduleAt) setScheduleAt(defaultScheduleValue()) }} className={selCls(when === 'later')} style={when === 'later' ? { borderColor: cfg.accent, color: cfg.accent } : undefined}>
                  <CalendarClock size={14} /> Schedule
                </button>
              </div>
            )}
            {when === 'later' && (
              <input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} className={inputCls} />
            )}

            <button onClick={publish} disabled={pubBusy || connected === false}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white font-semibold text-sm transition disabled:opacity-60" style={{ backgroundColor: cfg.accent }}>
              {pubBusy
                ? <><Loader2 size={16} className="animate-spin" /> {when === 'later' ? 'Scheduling…' : 'Posting…'}</>
                : when === 'later' ? <><CalendarClock size={16} /> Schedule post</> : <><Send size={16} /> Publish to {cfg.label}</>}
            </button>
            {pubError && <p className="text-[13px] text-[#b91c1c] dark:text-[#f87171] flex items-start gap-1.5"><AlertCircle size={14} className="mt-0.5" />{pubError}</p>}
            {result && (
              <div className="flex flex-col gap-1.5 rounded-lg border border-[#34c759]/30 bg-[#34c759]/5 p-3">
                {result.scheduledAt ? (
                  <span className="flex items-center gap-2 text-sm font-semibold text-[#34c759]"><CalendarClock size={15} /> Scheduled for {new Date(result.scheduledAt).toLocaleString()}</span>
                ) : (
                  <a href={result.postUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-semibold text-[#34c759]"><Check size={15} /> Posted <ExternalLink size={13} /></a>
                )}
                {result.note && <p className="text-[11px]" style={{ color: 'var(--text-soft)' }}>{result.note}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
