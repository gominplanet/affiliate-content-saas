// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// On sale now: the creator's own covered products that are on sale today,
// and the promo for each, one press away.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Tag, Copy, Wand2, MessageSquare, Send, ExternalLink, Zap, RefreshCw, Pin, Eraser, Check } from 'lucide-react'
import { getScoutStatus, requestPinComment } from '@/lib/extension-frame'
import { scoutAtLeast, SCOUT_PIN_MIN_VERSION } from '@/lib/scout-version'
import PageHero from '@/components/layout/PageHero'
import QuickPostModal, { type QuickPostDeal } from '@/components/deal/QuickPostModal'

const ACCENT = '#E4572E'

interface Source {
  kind: 'video' | 'storefront'
  youtubeVideoId?: string
  title?: string
  views?: number | null
  thumbnail?: string | null
  visibility?: 'public' | 'unlisted' | 'not_public' | null
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
  videoNotPublic: { title: string; visibility: 'unlisted' | 'not_public' } | null
  promo: { short: { hook: string; script: string; onScreen: string[] }; community: string; comment: string; commentLasting: string; social: string; socialForSheet: string }
  sale: { label: string }
}

interface SaleComment {
  id: string
  asin: string
  youtube_video_id: string
  video_title: string | null
  comment_id: string
  sale_label: string | null
  state: 'on_sale' | 'updated' | 'gone' | 'failed'
  pinned: boolean | null
  pin_error: string | null
  last_error: string | null
  posted_at: string
  updated_at: string
}

interface Share { asin: string; ok_platforms: string[]; scheduled_for: string | null; created_at: string }

const PLATFORM_NAMES: Record<string, string> = {
  facebook: 'Facebook', x: 'X', twitter: 'X', threads: 'Threads', bluesky: 'Bluesky', linkedin: 'LinkedIn',
  instagram: 'Instagram', instagram_story: 'Instagram Story', pinterest: 'Pinterest', tiktok: 'TikTok', telegram: 'Telegram',
}
const platformName = (p: string) => PLATFORM_NAMES[p] ?? p.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * DONE ALREADY, AT A GLANCE: whether this product has a sale comment on
 * YouTube and whether it went to socials, from what MVP recorded actually
 * happening. A comment whose sale was taken out reads as an earlier sale, so
 * a new sale does not look covered when it is not.
 */
function DoneTags({ comment, share }: { comment: SaleComment | null; share: Share | null }) {
  const tags: Array<{ text: string; done: boolean }> = []
  if (comment && (comment.state === 'on_sale' || comment.state === 'failed')) {
    tags.push({ text: `Commented on YouTube${comment.pinned ? ' and pinned' : ''}, ${shortDate(comment.posted_at)}`, done: true })
  } else if (comment && comment.state === 'updated') {
    tags.push({ text: `Commented in an earlier sale, ${shortDate(comment.posted_at)}`, done: false })
  }
  if (share && share.ok_platforms.length) {
    tags.push({ text: `Posted to ${share.ok_platforms.map(platformName).join(', ')}, ${shortDate(share.created_at)}`, done: true })
  } else if (share && share.scheduled_for) {
    tags.push({ text: `Scheduled to socials for ${shortDate(share.scheduled_for)}`, done: true })
  }
  if (!tags.length) return null
  return (
    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
      {tags.map((t) => (
        <span key={t.text} className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded"
          style={t.done ? { background: 'rgba(16,185,129,0.12)', color: '#10B981' } : { border: '1px solid var(--border)', color: 'var(--text-soft)' }}>
          {t.done ? <Check size={11} /> : null}{t.text}
        </span>
      ))}
    </div>
  )
}

/**
 * PIN THROUGH SCOUT, AND SAY WHAT HAPPENED. YouTube has no pin API, so SCOUT
 * does it in the creator's own signed-in YouTube and reports whether the
 * pinned badge showed. That report is saved, so the list says "Pinned" only
 * when it was seen, and says why when it was not.
 */
async function pinViaScout(youtubeVideoId: string, commentId: string, saleCommentId: string | null): Promise<{ pinned: boolean; error?: string }> {
  const scout = await getScoutStatus()
  if (!scout.installed) return { pinned: false, error: 'SCOUT is not installed in this browser. Pin it in Studio instead.' }
  if (!scoutAtLeast(scout.version, SCOUT_PIN_MIN_VERSION)) {
    return { pinned: false, error: `SCOUT ${scout.version ?? ''} cannot pin yet. Chrome updates it to ${SCOUT_PIN_MIN_VERSION} by itself soon; until then, pin it in Studio.` }
  }
  const r = await requestPinComment(youtubeVideoId, commentId)
  const pinned = !!(r.ok && r.pinned)
  // WHAT SCOUT SAW, step by step, beside a failure: the step that failed is
  // then on screen, not one line that could mean anything.
  if (!pinned && r.steps) r.error = `${r.error || 'SCOUT could not pin it.'} What SCOUT saw: ${r.steps}.`
  if (saleCommentId) {
    await fetch(`/api/on-sale/comments/${saleCommentId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pin_result', pinned, error: pinned ? undefined : r.error }),
    }).catch(() => {})
  }
  return pinned ? { pinned } : { pinned, error: r.error || 'SCOUT could not pin it.' }
}

/** Said beside a video that is not public, so a missing comment button has a reason on screen. */
function visibilityNote(v: Source['visibility']): string | null {
  if (v === 'unlisted') return 'Unlisted'
  if (v === 'not_public') return 'Private or scheduled'
  return null
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

function ProductCard({ p, onShare, onPosted, lastComment, lastShare }: {
  p: Product; onShare: (d: QuickPostDeal, caption: string) => void; onPosted: () => void
  lastComment: SaleComment | null; lastShare: Share | null
}) {
  const [promo, setPromo] = useState<Promo | null>(null)
  const [writing, setWriting] = useState(false)
  const [posting, setPosting] = useState(false)
  const [posted, setPosted] = useState<{ studioUrl: string; watchUrl: string; commentId: string; saleCommentId: string | null; trackError: string | null } | null>(null)
  const [pinning, setPinning] = useState(false)
  const [pin, setPin] = useState<{ pinned: boolean; error?: string } | null>(null)
  const [ended, setEnded] = useState(false)
  const videos = p.sources.filter((s) => s.kind === 'video')
  const publicVideos = videos.filter((v) => v.visibility === 'public' || v.visibility == null).length
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

  async function pinIt(target?: { videoId: string; commentId: string; saleCommentId: string | null }) {
    const t = target ?? (promo?.video && posted?.commentId
      ? { videoId: promo.video.youtubeVideoId, commentId: posted.commentId, saleCommentId: posted.saleCommentId }
      : null)
    if (!t) return
    setPinning(true)
    try {
      const r = await pinViaScout(t.videoId, t.commentId, t.saleCommentId)
      setPin(r)
      if (r.pinned) toast.success('Pinned. SCOUT saw it pinned on the video.')
      else toast.error(r.error || 'Not pinned.')
      onPosted()
    } finally { setPinning(false) }
  }

  async function comment() {
    if (!promo?.video) return
    setPosting(true)
    try {
      const r = await fetch('/api/on-sale/comment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeVideoId: promo.video.youtubeVideoId, text: promo.promo.comment,
          lastingText: promo.promo.commentLasting, asin: p.asin, saleLabel: promo.sale?.label,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'YouTube did not take the comment.'); return }
      setPosted({ studioUrl: j.studioUrl, watchUrl: j.watchUrl, commentId: j.commentId, saleCommentId: j.saleCommentId ?? null, trackError: j.trackError ?? null })
      setPin(null)
      toast.success('Comment posted on your video')
      onPosted()
      // PINNED BY ITSELF, straight after posting, when SCOUT can. What SCOUT
      // saw is what the card then says; the button stays for a retry.
      if (j.commentId) void pinIt({ videoId: promo.video.youtubeVideoId, commentId: j.commentId, saleCommentId: j.saleCommentId ?? null })
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
          <DoneTags comment={lastComment} share={lastShare} />
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-soft)' }}>
            {videos.length > 0
              ? `In ${videos.length} of your videos${inStore ? ' and your storefront' : ''}${publicVideos === 0 ? ', none of them public yet' : ''}`
              : 'In your storefront, no video yet'}
          </p>
          {videos.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {videos.slice(0, 3).map((v) => (
                <li key={v.youtubeVideoId} className="text-[12px] truncate">
                  <a href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noreferrer"
                    className="underline" style={{ color: 'var(--text)' }}>{v.title || v.youtubeVideoId}</a>
                  {v.views != null && <span style={{ color: 'var(--text-faint)' }}> · {v.views.toLocaleString()} views</span>}
                  {visibilityNote(v.visibility) && (
                    <span className="ml-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(217,119,6,0.12)', color: '#d97706' }}>
                      {visibilityNote(v.visibility)}
                    </span>
                  )}
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
          <CopyBlock title="Script for a new Short, Reel or Story (15 to 30 seconds)"
            text={`${promo.promo.short.hook}\n\n${promo.promo.short.script}${promo.promo.short.onScreen.length ? `\n\nOn screen:\n${promo.promo.short.onScreen.map((l) => `• ${l}`).join('\n')}` : ''}`}>
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
              Film yourself saying this with the product in hand, vertical, and add the on-screen lines as text. Post it as a YouTube Short
              with the link in its description, a TikTok, or an Instagram or Facebook Story with a link sticker. It sends people back to a
              product they already trust you on while the price is down.
            </p>
          </CopyBlock>
          <CopyBlock title="YouTube Community post" text={promo.promo.community}>
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
              YouTube has no way for apps to post these: in YouTube Studio press Create, then Post, and paste it. The links in it are clickable there.
            </p>
          </CopyBlock>
          {/* THE COMMENT ONLY WHERE SOMEONE WILL READ IT: on a public video.
              A private or scheduled video, or none at all, says so instead of
              offering a button whose success would change nothing. */}
          {promo.video ? (
            <CopyBlock title={`Comment for "${promo.video.title}"`} text={promo.promo.comment}>
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
                      {pin?.pinned ? (
                        <span className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: '#10B981' }}><Pin size={11} /> Pinned</span>
                      ) : (
                        <button type="button" onClick={() => void pinIt()} disabled={pinning}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60"
                          style={{ background: '#0EA5A4' }}>
                          {pinning ? <Loader2 size={12} className="animate-spin" /> : <Pin size={12} />}
                          {pinning ? 'Pinning…' : 'Pin it with SCOUT'}
                        </button>
                      )}
                      <a href={posted.studioUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] underline" style={{ color: 'var(--text)' }}>
                        Pin it in Studio <ExternalLink size={11} />
                      </a>
                      <a href={posted.watchUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] underline" style={{ color: 'var(--text-soft)' }}>
                        See it <ExternalLink size={11} />
                      </a>
                    </>
                  )}
                </div>
              )}
              {posted && pin && !pin.pinned && pin.error && (
                <p className="text-[11.5px] mt-1.5" style={{ color: '#d97706' }}>Not pinned: {pin.error}</p>
              )}
              {posted && !posted.trackError && (
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
                  YouTube has no pin option for apps, so right after posting SCOUT opens the video for a few seconds and pins it for you. Pinning replaces the comment you have pinned on this video now, if any.
                </p>
              )}
              {posted?.trackError && (
                <p className="text-[11.5px] mt-1.5" style={{ color: '#d97706' }}>
                  Posted, but MVP could not save it, so it will not take the sale out when the sale ends ({posted.trackError}). Edit the comment by hand then.
                </p>
              )}
              <div className="mt-2 rounded-lg p-2" style={{ background: 'var(--surface-hover)' }}>
                <span className="text-[11px] font-semibold block mb-0.5" style={{ color: 'var(--text-soft)' }}>When the sale ends, MVP edits it to this. It stays on the video, pin included:</span>
                <p className="text-[12px] whitespace-pre-wrap" style={{ color: 'var(--text-soft)' }}>{promo.promo.commentLasting}</p>
              </div>
            </CopyBlock>
          ) : promo.videoNotPublic ? (
            <div className="rounded-xl border p-3 text-[12.5px]" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
              <span className="text-[11px] font-semibold uppercase tracking-wide block mb-1" style={{ color: 'var(--text-soft)' }}>YouTube comment</span>
              Your video &quot;{promo.videoNotPublic.title}&quot; is {promo.videoNotPublic.visibility === 'unlisted' ? 'unlisted' : 'private or scheduled'},
              so a comment there would not be seen. Once it is public, press Write it again and the comment button appears.
            </div>
          ) : (
            <div className="rounded-xl border p-3 text-[12.5px]" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
              <span className="text-[11px] font-semibold uppercase tracking-wide block mb-1" style={{ color: 'var(--text-soft)' }}>YouTube comment</span>
              This one is in your storefront with no video yet, so there is no video to comment on. The Short script and the social post above and below work without one.
            </div>
          )}
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

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** One posted comment, and what actually happened to it. */
function SaleCommentRow({ c, onChange }: { c: SaleComment; onChange: () => void }) {
  const [busy, setBusy] = useState<'out' | 'pin' | null>(null)
  const watch = `https://www.youtube.com/watch?v=${c.youtube_video_id}&lc=${encodeURIComponent(c.comment_id)}`
  const state = c.state === 'on_sale' ? { text: 'Says it is on sale', color: ACCENT }
    : c.state === 'updated' ? { text: `Sale taken out ${when(c.updated_at)}`, color: '#10B981' }
      : c.state === 'gone' ? { text: 'No longer on YouTube', color: 'var(--text-soft)' }
        : { text: 'Could not update', color: '#ef4444' }
  async function takeOut() {
    setBusy('out')
    try {
      const r = await fetch(`/api/on-sale/comments/${c.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'take_sale_out' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) toast.error(j?.error || 'The comment could not be edited.')
      else toast.success('Edited on YouTube. The sale is out of it.')
      onChange()
    } catch { toast.error('Could not reach the server. Nothing was changed.') } finally { setBusy(null) }
  }
  async function pinIt() {
    setBusy('pin')
    try {
      const r = await pinViaScout(c.youtube_video_id, c.comment_id, c.id)
      if (r.pinned) toast.success('Pinned. SCOUT saw it pinned on the video.')
      else toast.error(r.error || 'Not pinned.')
      onChange()
    } finally { setBusy(null) }
  }
  return (
    <li className="rounded-xl border p-3 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <a href={watch} target="_blank" rel="noreferrer" className="font-semibold underline truncate max-w-[60%]" style={{ color: 'var(--text)' }}>
          {c.video_title || c.youtube_video_id}
        </a>
        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ color: state.color, border: '1px solid var(--border)' }}>{state.text}</span>
        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ color: c.pinned ? '#10B981' : 'var(--text-soft)', border: '1px solid var(--border)' }}>
          {c.pinned ? 'Pinned' : c.pinned === false ? 'Not pinned' : 'Pin not tried'}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>Posted {when(c.posted_at)}{c.sale_label ? ` · ${c.sale_label}` : ''}</span>
      </div>
      {c.state === 'failed' && c.last_error && <p className="text-[11.5px] mt-1" style={{ color: '#ef4444' }}>{c.last_error} MVP tries again every few hours while the sale is over.</p>}
      {c.pinned === false && c.pin_error && <p className="text-[11.5px] mt-1" style={{ color: '#d97706' }}>Not pinned: {c.pin_error}</p>}
      {c.state !== 'gone' && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {(c.state === 'on_sale' || c.state === 'failed') && (
            <button type="button" onClick={() => void takeOut()} disabled={busy !== null}
              className="inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-md border disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              {busy === 'out' ? <Loader2 size={11} className="animate-spin" /> : <Eraser size={11} />} Take the sale out now
            </button>
          )}
          {!c.pinned && (
            <button type="button" onClick={() => void pinIt()} disabled={busy !== null}
              className="inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-md border disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              {busy === 'pin' ? <Loader2 size={11} className="animate-spin" /> : <Pin size={11} />} Pin it with SCOUT
            </button>
          )}
        </div>
      )}
    </li>
  )
}

export default function OnSale() {
  const [data, setData] = useState<{ covered: number; checked: number; skipped: number; videosCovered: number; onSale: Product[]; visibilityChecked?: boolean; checkedAt: string } | null>(null)
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

  const [comments, setComments] = useState<{ list: SaleComment[]; shares: Share[]; missingTable: boolean } | null>(null)
  const loadComments = useCallback(async () => {
    try {
      const r = await fetch('/api/on-sale/comments')
      const j = await r.json().catch(() => ({}))
      if (r.ok) setComments({ list: j.comments ?? [], shares: j.shares ?? [], missingTable: !!j.missingTable })
    } catch { /* the list is extra; the page works without it */ }
  }, [])
  useEffect(() => { void loadComments() }, [loadComments])

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
                <span style={{ color: '#d97706' }}> {data.skipped} not checked yet. Each <b>Check again</b> checks the next 50, and the daily check works through the rest.</span>
              )}
              {data.visibilityChecked === false && (
                <span style={{ color: '#d97706' }}> YouTube did not say which videos are public just now, so none are labelled. The comment button still checks before it posts.</span>
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
              <ProductCard key={p.asin} p={p} onShare={(deal, caption) => setShare({ deal, caption })} onPosted={() => void loadComments()}
                lastComment={comments?.list.find((c) => c.asin === p.asin && c.state !== 'gone') ?? null}
                lastShare={comments?.shares.find((s) => s.asin === p.asin) ?? null} />
            ))}
          </ul>
          {comments && (comments.missingTable || comments.list.length > 0) && (
            <section className="mt-6">
              <h2 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text)' }}>Your sale comments</h2>
              <p className="text-[12px] mb-2" style={{ color: 'var(--text-soft)' }}>
                Every few hours MVP checks the price of each one. When the sale is over it edits the comment on YouTube to the version
                with no sale in it, so the comment stays up, pinned, and true.
              </p>
              {comments.missingTable ? (
                <p className="text-[12.5px]" style={{ color: '#ef4444' }}>
                  The sale_comments table is missing (migration 374), so posted comments are not remembered and will not be updated when the sale ends.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {comments.list.map((c) => <SaleCommentRow key={c.id} c={c} onChange={() => void loadComments()} />)}
                </ul>
              )}
            </section>
          )}
          <p className="text-[11.5px] mt-4" style={{ color: 'var(--text-faint)' }}>
            Prices are checked against the usual price for the last 90 days. The promo never states a price or a percentage,
            because a sale price can change within hours while a post stays up.
          </p>
        </>
      )}

      {share && <QuickPostModal deal={share.deal} initialCaption={share.caption} onClose={() => setShare(null)}
        source="on_sale" onDone={() => void loadComments()} />}
    </div>
  )
}
