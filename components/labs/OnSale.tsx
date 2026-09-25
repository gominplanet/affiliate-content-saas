// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// On sale now: the creator's own covered products that are on sale today,
// and the promo for each, one press away.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Tag, Copy, Wand2, MessageSquare, Send, ExternalLink, Zap, RefreshCw } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import QuickPostModal, { type QuickPostDeal } from '@/components/deal/QuickPostModal'

const ACCENT = '#E4572E'

interface Source {
  kind: 'video' | 'storefront'
  youtubeVideoId?: string
  title?: string
  views?: number | null
  thumbnail?: string | null
}
interface Verdict {
  pct: number | null
  nowCents: number | null
  refCents: number | null
  basis: 'deal' | 'lightning' | 'avg90' | 'all-time-low' | null
  lightningEndsAt: string | null
  allTimeLow: boolean
}
interface Product { asin: string; title: string; image: string | null; sources: Source[]; verdict: Verdict }
interface Promo {
  link: string
  video: { youtubeVideoId: string; title: string } | null
  promo: { short: { hook: string; script: string; onScreen: string[] }; community: string; comment: string; social: string; socialForSheet: string }
}

const money = (c: number | null) => (c == null ? null : `$${(c / 100).toFixed(2)}`)

function label(v: Verdict): string {
  if (v.basis === 'lightning') return v.pct ? `Lightning deal, ${v.pct}% off` : 'Lightning deal'
  if (v.allTimeLow) return v.pct ? `Lowest price ever, ${v.pct}% under usual` : 'Lowest price ever'
  return v.pct ? `${v.pct}% off` : 'On sale'
}

function timeLeft(iso: string | null): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'ending now'
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`
}

function CopyBlock({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>{title}</span>
        <button type="button" onClick={() => { void navigator.clipboard.writeText(text); toast.success('Copied') }}
          className="inline-flex items-center gap-1 text-[11.5px] px-2 py-0.5 rounded-md border" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
          <Copy size={11} /> Copy
        </button>
      </div>
      <p className="text-[13px] whitespace-pre-wrap" style={{ color: 'var(--text)' }}>{text}</p>
      {children}
    </div>
  )
}

function ProductCard({ p, onShare }: { p: Product; onShare: (d: QuickPostDeal, caption: string) => void }) {
  const [promo, setPromo] = useState<Promo | null>(null)
  const [writing, setWriting] = useState(false)
  const [posting, setPosting] = useState(false)
  const [posted, setPosted] = useState<{ studioUrl: string; watchUrl: string } | null>(null)
  const [ended, setEnded] = useState(false)
  const videos = p.sources.filter((s) => s.kind === 'video')
  const inStore = p.sources.some((s) => s.kind === 'storefront')
  const left = p.verdict.basis === 'lightning' ? timeLeft(p.verdict.lightningEndsAt) : null

  async function write() {
    setWriting(true)
    try {
      const r = await fetch('/api/on-sale/promo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asin: p.asin }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not write the promo.'); if (j?.ended) setEnded(true); return }
      // A NEW COMMENT HAS NOT BEEN POSTED. "Posted." beside rewritten text
      // would say something that is not true of it.
      setPosted(null)
      setPromo(j as Promo)
    } catch { toast.error('Could not reach the server.') } finally { setWriting(false) }
  }

  async function comment() {
    if (!promo?.video) return
    setPosting(true)
    try {
      const r = await fetch('/api/on-sale/comment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeVideoId: promo.video.youtubeVideoId, text: promo.promo.comment }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'YouTube did not take the comment.'); return }
      setPosted({ studioUrl: j.studioUrl, watchUrl: j.watchUrl })
      toast.success('Comment posted on your video')
    } catch { toast.error('Could not reach the server. Nothing was posted.') } finally { setPosting(false) }
  }

  return (
    <li className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-start gap-3">
        {p.image
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={p.image} alt="" className="w-16 h-16 rounded-xl object-contain bg-white border shrink-0" />
          : <div className="w-16 h-16 rounded-xl shrink-0" style={{ background: 'var(--surface-hover)' }} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(228,87,46,0.12)', color: ACCENT }}>
              {p.verdict.basis === 'lightning' ? <Zap size={11} /> : <Tag size={11} />} {label(p.verdict)}
            </span>
            {money(p.verdict.nowCents) && (
              <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-soft)' }}>
                now {money(p.verdict.nowCents)}{money(p.verdict.refCents) ? `, usually ${money(p.verdict.refCents)}` : ''}
              </span>
            )}
            {left && <span className="text-[12px] font-semibold" style={{ color: ACCENT }}>{left}</span>}
          </div>
          <p className="text-[14px] font-semibold mt-1 line-clamp-2" style={{ color: 'var(--text)' }}>{p.title}</p>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-soft)' }}>
            {videos.length > 0
              ? `In ${videos.length} of your videos${inStore ? ' and your storefront' : ''}`
              : 'In your storefront'}
          </p>
          {videos.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {videos.slice(0, 3).map((v) => (
                <li key={v.youtubeVideoId} className="text-[12px] truncate">
                  <a href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noreferrer"
                    className="underline" style={{ color: 'var(--text)' }}>{v.title || v.youtubeVideoId}</a>
                  {v.views != null && <span style={{ color: 'var(--text-faint)' }}> · {v.views.toLocaleString()} views</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {ended && !promo && (
          <span className="shrink-0 text-[12px] font-semibold" style={{ color: 'var(--text-soft)' }}>Sale ended</span>
        )}
        {!promo && !ended && (
          <button type="button" onClick={() => void write()} disabled={writing}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12.5px] font-semibold text-white disabled:opacity-60"
            style={{ background: ACCENT }}>
            {writing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            {writing ? 'Writing…' : 'Write the promo'}
          </button>
        )}
      </div>

      {promo && (
        <div className="mt-3 grid gap-2">
          <CopyBlock title="Short or story (15 to 30 seconds)"
            text={`${promo.promo.short.hook}\n\n${promo.promo.short.script}${promo.promo.short.onScreen.length ? `\n\nOn screen:\n${promo.promo.short.onScreen.map((l) => `• ${l}`).join('\n')}` : ''}`} />
          <CopyBlock title="YouTube Community post" text={promo.promo.community}>
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
              YouTube has no way for apps to post these, so paste it into Studio under Create, then Post.
            </p>
          </CopyBlock>
          <CopyBlock title={promo.video ? `Comment for "${promo.video.title}"` : 'Comment'} text={promo.promo.comment}>
            {promo.video && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {!posted ? (
                  <button type="button" onClick={() => void comment()} disabled={posting}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60"
                    style={{ background: '#0EA5A4' }}>
                    {posting ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />}
                    Post it on the video
                  </button>
                ) : (
                  <>
                    <span className="text-[12px] font-semibold" style={{ color: '#10B981' }}>Posted.</span>
                    <a href={posted.studioUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] underline" style={{ color: 'var(--text)' }}>
                      Pin it in Studio <ExternalLink size={11} />
                    </a>
                    <a href={posted.watchUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] underline" style={{ color: 'var(--text-soft)' }}>
                      See it <ExternalLink size={11} />
                    </a>
                  </>
                )}
                <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>YouTube does not let apps pin a comment, so pinning is one click in Studio.</span>
              </div>
            )}
          </CopyBlock>
          <CopyBlock title="Social post" text={promo.promo.social}>
            <button type="button" onClick={() => onShare({ asin: p.asin, title: p.title, imageUrl: p.image }, promo.promo.socialForSheet)}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold text-white"
              style={{ background: ACCENT }}>
              <Send size={12} /> Post to my socials
            </button>
          </CopyBlock>
          <button type="button" onClick={() => void write()} disabled={writing}
            className="justify-self-start inline-flex items-center gap-1 text-[12px] underline disabled:opacity-50" style={{ color: 'var(--text-soft)' }}>
            {writing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Write it again
          </button>
        </div>
      )}
    </li>
  )
}

export default function OnSale() {
  const [data, setData] = useState<{ covered: number; checked: number; skipped: number; videosCovered: number; onSale: Product[]; checkedAt: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [share, setShare] = useState<{ deal: QuickPostDeal; caption: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/on-sale')
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j?.error || 'Could not check your products.'); return }
      setData(j)
    } catch { setError('Could not reach the server.') } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <div className="max-w-4xl mx-auto">
      <PageHero
        accent={ACCENT}
        title="On sale now"
        subtitle="Products you already made videos about, on sale today. Your audience trusts you on these, so this is when those videos sell best."
      />

      {loading && (
        <div className="flex items-center gap-2 text-[13px] py-10 justify-center" style={{ color: 'var(--text-soft)' }}>
          <Loader2 size={15} className="animate-spin" /> Checking today&apos;s prices on everything you have covered…
        </div>
      )}
      {error && <p className="text-[13px] py-6 text-center" style={{ color: '#ef4444' }}>{error}</p>}

      {data && !loading && (
        <>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <p className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
              {data.videosCovered} products from your videos, {data.covered} in all. Prices known for {data.checked}.{' '}
              <b style={{ color: 'var(--text)' }}>{data.onSale.length} on sale</b> right now.
              {data.skipped > 0 && (
                <span style={{ color: '#d97706' }}> {data.skipped} not checked this time (past today&apos;s price-check limit), so they may be on sale too.</span>
              )}
            </p>
            <button type="button" onClick={() => void load()}
              className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-lg border" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              <RefreshCw size={12} /> Check again
            </button>
          </div>

          {data.covered === 0 && (
            <p className="text-[13px] rounded-2xl border p-5" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
              None of your videos has a product set yet, and your storefront is not synced. Set the product on your videos
              (YouTube Co-Pilot does this) or sync your storefront, and this page watches them for you.
            </p>
          )}
          {data.covered > 0 && data.onSale.length === 0 && (
            <p className="text-[13px] rounded-2xl border p-5" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
              Nothing you have covered is on sale today. MVP checks every day and puts an alert in Price Alerts on your dashboard when one is.
            </p>
          )}
          <ul className="grid gap-3">
            {data.onSale.map((p) => (
              <ProductCard key={p.asin} p={p} onShare={(deal, caption) => setShare({ deal, caption })} />
            ))}
          </ul>
          <p className="text-[11.5px] mt-4" style={{ color: 'var(--text-faint)' }}>
            Prices are checked against the usual price for the last 90 days. The promo never states a price or a percentage,
            because a sale price can change within hours while a post stays up.
          </p>
        </>
      )}

      {share && <QuickPostModal deal={share.deal} initialCaption={share.caption} onClose={() => setShare(null)} />}
    </div>
  )
}
