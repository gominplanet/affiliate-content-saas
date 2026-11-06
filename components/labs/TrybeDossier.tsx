'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BRAND PAGE (Seb, 2026-11-06: "a very high-end output of information, of
// data that comes from Tribe ... everything needs to have a place and a
// reason to be there"). One page for one brand, opened from wherever its name
// is: the verdict and the six things behind it, its numbers on TRYBE, its
// Meta ads over time, its products and which take sample requests, its videos
// in TRYBE's Top 100, what MVP creators got back from it, what happened to it
// on TRYBE, and where it stands with you. Then the next step, in one press.
//
// Before it, a brand was drawn ten different ways with ten different subsets
// of its numbers. What is not read says so, by name; nothing is guessed.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Globe, ExternalLink, Loader2, AlertTriangle, MessageCircle, Send, Clapperboard, Star, PlayCircle, Package, History, Users, Megaphone } from 'lucide-react'
import { readBrandCard } from '@/lib/trybe-brand-page'
import { payLines } from '@/lib/trybe-pay'
import { requestTrybeApi } from '@/lib/extension-frame'
import { scorecard, verdictOf, seriesMove, readLiveBrand, type LiveBrandRead, type Dimension, type SamplePool, type ReplyPool, type DossierProduct, type TimelineItem, type SeriesPoint } from '@/lib/trybe-dossier'
import { adLibraryUrl } from '@/lib/trybe-pick'
import { CHANGE_WORDS } from '@/lib/trybe-changes'
import { GRADE, ui, Section, Tag, Meter, ScoreRing, Figure, AreaChart, Btn } from '@/components/labs/trybe-ui'
import TrybeLink from '@/components/labs/TrybeLink'
import type { PeekActions } from '@/components/labs/TrybeBrandPeek'

/** What the brand page reads, from 'browse' by id (the listing) and 'dossier' (the rest). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listing = Record<string, any>
interface DossierRead {
  brand: { id: string; name: string; website: string | null; categories: string[]; about: string | null; firstSeen: string | null; lastSeen: string | null; left: boolean } | null
  pub: { logo: string | null; description: string | null; products: DossierProduct[]; read: boolean; error: string | null } | null
  timeline: TimelineItem[]
  meta: SeriesPoint[]
  pool: { approvalRate: number | null; payPerApproved: number | null; reviewDays: number | null; slowShare: number | null; why: string | null } | null
  poolError: string | null
  samples: SamplePool | null
  replies: ReplyPool | null
  top: Array<{ id: string; creator: string | null; rank: number | null; seconds: number | null; hook: string | null; thumbnail: string | null; video: string | null }>
  you: { status: string | null; sentAt: string | null; repliedAt: string | null; draftedAt: string | null; fit: number | null; fitReason: string | null; samples: Array<{ product: string; requestedAt: string | null; receivedAt: string | null; filmedAt: string | null; submittedAt: string | null }> }
}

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}`)
  return j
}

/** A website link names where it goes. */
const siteName = (url: string) => { try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '') } catch { return 'its website' } }
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '')
const daysSince = (iso: string | null | undefined) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)) : null)

/** Where the brand stands with you, in one line. */
function standing(d: DossierRead['you'] | undefined, listing: Listing | null): string {
  const s = d?.status ?? listing?.status ?? null
  if (d?.repliedAt) return `You messaged it ${day(d.sentAt)}. It answered ${day(d.repliedAt)}.`
  if (s === 'sent') return `You messaged it ${day(d?.sentAt)}. No answer yet.`
  if (s === 'already') return 'You had already asked to join it on TRYBE.'
  if (s === 'drafted') return 'A message to it is written and waiting in Ready to send.'
  if (s === 'sending') return 'SCOUT is sending your message to it now.'
  if (s === 'failed') return 'Your message to it did not go. Open Ready to send to try again.'
  if (s === 'skipped') return 'You passed on it.'
  if (s === 'removed') return 'You removed it from your list.'
  if (s === 'not_fit') return 'MVP judged it not a fit for your channel.'
  return 'Not on your list yet.'
}

export default function TrybeDossier({ brandId, name, onClose, actions, scout = false, onScripts, canDetails = false, isAdmin = false }: {
  brandId: string
  /** The name, shown while the page loads. */
  name?: string
  onClose: () => void
  /** Write and send, as Find brands does. Absent: details only. */
  actions?: PeekActions
  /** SCOUT can open the brand on TRYBE. */
  scout?: boolean
  /** Go to Make videos with this brand. */
  onScripts?: (brandId: string, name: string) => void
  /** SCOUT can read the brand's own page on TRYBE (1.45.0). */
  canDetails?: boolean
  /** The team sees which fields TRYBE sent. */
  isAdmin?: boolean
}) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [d, setD] = useState<DossierRead | null>(null)
  const [err, setErr] = useState<{ listing: string | null; dossier: string | null }>({ listing: null, dossier: null })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'message' | 'send' | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  // LIVE FROM TRYBE: the brand's own page, read through SCOUT just now.
  const [live, setLive] = useState<{ state: 'reading' | 'read' | 'failed'; read?: LiveBrandRead; rules?: string[]; brief?: string | null; briefUrl?: string | null; error?: string } | null>(null)
  const readLive = useCallback(async () => {
    if (!canDetails) return
    setLive({ state: 'reading' })
    const r = await requestTrybeApi('GET', `/backend/api/creator/v2/brands/${encodeURIComponent(brandId)}/details`).catch(() => ({ ok: false as const, error: 'SCOUT did not answer.', json: undefined }))
    if (!r.ok || r.json == null) { setLive({ state: 'failed', error: ('error' in r && r.error) || 'no answer' }); return }
    const card = readBrandCard(r.json)
    setLive({ state: 'read', read: readLiveBrand(r.json), rules: payLines(r.json), brief: card.brief, briefUrl: card.briefUrl })
  }, [brandId, canDetails])
  useEffect(() => { void readLive() }, [readLive])

  const load = useCallback(async () => {
    setLoading(true)
    const [a, b] = await Promise.allSettled([post({ action: 'browse', ids: [brandId], limit: 1, includeMine: true }), post({ action: 'dossier', brandId })])
    setListing(a.status === 'fulfilled' ? ((a.value.brands || []) as Listing[]).find((x) => x.brand_id === brandId) ?? null : null)
    setD(b.status === 'fulfilled' ? (b.value as DossierRead) : null)
    setErr({ listing: a.status === 'rejected' ? String(a.reason?.message || a.reason) : null, dossier: b.status === 'rejected' ? String(b.reason?.message || b.reason) : null })
    setLoading(false)
  }, [brandId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    panel.current?.focus()
    const was = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = was }
  }, [onClose])

  const title = d?.brand?.name || listing?.name || name || 'Brand'
  const website = d?.brand?.website || listing?.website || null
  const productsOpen = d?.pub?.read ? { open: d.pub.products.filter((p) => p.samples).length, total: d.pub.products.length } : null
  const dims: Dimension[] = scorecard({
    pay: { dollars: listing?.pay_est?.dollars ?? d?.pool?.payPerApproved ?? null, short: listing?.pay_est?.short ?? listing?.pay_text ?? null, basis: listing?.pay_est?.dollars != null ? listing?.pay_est?.basis ?? null : d?.pool?.payPerApproved != null ? 'members' : null },
    meta: { count: typeof listing?.meta_ads === 'number' ? listing.meta_ads : null, own: listing?.meta_trust === 'own' || listing?.meta_trust === 'unchecked', fresh: !!listing?.meta_fresh, top100Hits: typeof listing?.top100_hits === 'number' ? listing.top100_hits : null },
    samples: { trybe: listing?.stats?.samples ?? null, products: productsOpen, pool: d?.samples ?? null },
    pool: d?.pool ? { approvalRate: d.pool.approvalRate, reviewDays: d.pool.reviewDays ?? listing?.review?.reviewDays ?? null, slowShare: d.pool.slowShare } : listing?.review ? { approvalRate: null, reviewDays: listing.review.reviewDays ?? null, slowShare: listing.review.slowShare ?? null } : null,
    crowd: listing?.crowd ? { level: listing.crowd.level ?? null, why: listing.crowd.why ?? null } : null,
    replies: d?.replies ?? null,
  })
  const verdict = verdictOf(dims)
  const mine = actions?.mineOf(brandId) ?? null
  const status = mine?.status ?? d?.you.status ?? listing?.status ?? null
  const move = d ? seriesMove(d.meta, 'ads') : null
  const onTrybe = daysSince(listing?.stats?.joinedAt ?? null)

  async function act(kind: 'message' | 'send') {
    if (!actions) return
    setBusy(kind)
    try { await (kind === 'message' ? actions.message(brandId) : actions.send(brandId)); await load() } finally { setBusy(null) }
  }

  // On the page itself, above everything the dashboard draws (its sidebar
  // and top bar), whatever box it is opened from.
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 flex justify-end" style={{ zIndex: 1000 }} role="dialog" aria-modal="true" aria-label={`${title} on TRYBE`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default" style={{ background: 'rgba(5,15,16,0.46)', backdropFilter: 'blur(2px)' }} />
      <div ref={panel} tabIndex={-1} className="relative h-full w-full max-w-[780px] overflow-y-auto outline-none trybe-dossier-in" style={{ background: 'var(--bg, var(--surface))', boxShadow: '-24px 0 60px rgba(0,0,0,0.18)' }}>
        <style>{`@keyframes trybeIn{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}.trybe-dossier-in{animation:trybeIn 220ms ease-out}@media (prefers-reduced-motion: reduce){.trybe-dossier-in{animation:none}}`}</style>

        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-10 px-5 sm:px-7 pt-5 pb-4" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-start gap-4">
            <Logo src={d?.pub?.logo ?? null} name={title} website={website} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[22px] sm:text-[24px] font-bold leading-tight truncate" style={{ ...ui.num, ...ui.text }}>{title}</h2>
                {listing?.starred && <Star size={16} fill="#F59E0B" stroke="#F59E0B" aria-label="Starred" />}
                {listing?.is_new && <Tag tone="accent">New on TRYBE</Tag>}
                {(d?.brand?.left || listing?.not_listed) && <Tag tone="bad">Not on TRYBE&rsquo;s list now</Tag>}
              </div>
              <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1 text-[12.5px]" style={ui.soft}>
                {(d?.brand?.categories || listing?.categories || []).slice(0, 3).map((c: string) => <span key={c}>{c}</span>)}
                {website && <a href={/^https?:/i.test(website) ? website : `https://${website}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold hover:underline" style={{ color: ui.accentText }}><Globe size={12} /> {siteName(website)}</a>}
                <TrybeLink brandId={brandId} name={title} scout={scout} label="Open on TRYBE" />
              </div>
              <p className="text-[12.5px] mt-1.5" style={ui.mid}>{standing(d?.you, listing)}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-full p-2 hover:brightness-95" style={{ background: 'var(--surface-2)', color: 'var(--text)' }}><X size={18} /></button>
          </div>
          {actions && (
            <div className="flex gap-2 flex-wrap mt-4">
              {status === 'drafted' || mine?.draft
                ? <Btn kind="solid" onClick={() => void act('send')} disabled={!!busy}>{busy === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send the message now</Btn>
                : status === 'sent' || status === 'already' || status === 'sending'
                  ? null
                  : <Btn kind="solid" onClick={() => void act('message')} disabled={!!busy}>{busy === 'message' ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />} Write it a message</Btn>}
              {onScripts && <Btn onClick={() => onScripts(brandId, title)}><Clapperboard size={14} /> Make scripts for it</Btn>}
              <Btn href={adLibraryUrl(title)}><Megaphone size={14} /> Its ads on Meta Ad Library <ExternalLink size={12} /></Btn>
            </div>
          )}
        </header>

        <div className="px-5 sm:px-7 py-6 flex flex-col gap-8">
          {loading && !listing && !d && (
            <div className="flex items-center gap-2 text-[13px]" style={ui.soft}><Loader2 size={15} className="animate-spin" /> Reading everything MVP knows about {title}&hellip;</div>
          )}
          {(err.listing || err.dossier) && (
            <div className="rounded-xl px-4 py-3 text-[13px] flex items-start gap-2" style={{ background: GRADE.fair.soft, color: 'var(--text)' }}>
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{err.listing && err.dossier ? `MVP could not read this brand: ${err.dossier}` : err.dossier ? `Part of this page did not load (${err.dossier}). Its TRYBE listing is below.` : `Its TRYBE listing did not load (${err.listing}). What MVP creators saw is below.`}{' '}
                <button type="button" onClick={() => void load()} className="font-semibold underline">Read it again</button></span>
            </div>
          )}

          {/* ── VERDICT ──────────────────────────────────────────────────── */}
          {(listing || d) && (
            <div className="rounded-[20px] p-5 sm:p-6 flex flex-col sm:flex-row gap-5 sm:items-center" style={ui.card}>
              <ScoreRing score={verdict.score} label="of 100" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase" style={{ ...ui.soft, letterSpacing: '0.08em' }}>MVP&rsquo;s read</p>
                <p className="text-[26px] font-bold leading-tight" style={{ ...ui.num, ...ui.text }}>{verdict.word}</p>
                <p className="text-[13px] mt-1" style={ui.mid}>{verdict.line}</p>
                <p className="text-[12px] mt-2" style={ui.soft}>{verdict.read} of {verdict.of} read. Each is scored only from what MVP could check, and says where it came from.</p>
              </div>
            </div>
          )}

          {/* ── THE SIX ──────────────────────────────────────────────────── */}
          {(listing || d) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {dims.map((x) => (
                <div key={x.id} className="rounded-2xl p-4 flex flex-col gap-2" style={ui.card}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold" style={ui.mid}>{x.label}</span>
                    <span className="text-[10.5px] font-bold uppercase" style={{ color: x.grade === 'unknown' ? 'var(--text-3)' : 'var(--text-2)', letterSpacing: '0.07em' }}>{GRADE[x.grade].word}</span>
                  </div>
                  <span className="text-[20px] font-bold leading-tight" style={{ ...ui.num, ...ui.text, opacity: x.score == null ? 0.6 : 1 }}>{x.value}</span>
                  <Meter score={x.score} grade={x.grade} />
                  <span className="text-[11.5px] leading-snug" style={ui.soft}>{x.source}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── LIVE FROM TRYBE ──────────────────────────────────────────── */}
          {canDetails && live && (
            <Section title="Live from TRYBE" aside="Its own page on TRYBE, read just now through SCOUT">
              <div className="rounded-2xl p-5 flex flex-col gap-5" style={ui.card}>
                {live.state === 'reading' && <p className="text-[13px] inline-flex items-center gap-2" style={ui.soft}><Loader2 size={14} className="animate-spin" /> Reading its page on TRYBE&hellip;</p>}
                {live.state === 'failed' && <p className="text-[13px]" style={ui.text}><AlertTriangle size={14} className="inline -mt-0.5 mr-1" style={{ color: '#F59E0B' }} />SCOUT could not read its page on TRYBE: {live.error}. <button type="button" onClick={() => void readLive()} className="font-semibold underline">Read it again</button></p>}
                {live.state === 'read' && live.read && (<>
                  {live.read.numbers.length
                    ? <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">{live.read.numbers.map((n) => <Figure key={n.id} label={n.label} value={n.value} sub={n.sub} />)}</div>
                    : <p className="text-[13px]" style={ui.soft}>Its TRYBE page shows no creator, video or score counts to MVP.</p>}
                  {(live.rules?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase mb-1.5" style={{ ...ui.soft, letterSpacing: '0.07em' }}>Its pay, as TRYBE says it</p>
                      <ul className="flex flex-col gap-1">{live.rules!.map((r, i) => <li key={i} className="text-[13.5px] font-semibold" style={ui.text}>{r}</li>)}</ul>
                    </div>
                  )}
                  {(live.read.program || live.read.approval) && <p className="text-[12.5px]" style={ui.mid}>{[live.read.program ? `Program: ${live.read.program}` : null, live.read.approval].filter(Boolean).join('. ')}.</p>}
                  {live.brief && (
                    <details className="rounded-xl px-4 py-3" style={ui.well}>
                      <summary className="text-[13px] font-semibold cursor-pointer" style={ui.text}>Its creative brief</summary>
                      <p className="text-[13px] leading-relaxed mt-2 whitespace-pre-line" style={ui.mid}>{live.brief}</p>
                    </details>
                  )}
                  {live.briefUrl && <a href={live.briefUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold inline-flex items-center gap-1 hover:underline" style={{ color: ui.accentText }}>Open its brief on {siteName(live.briefUrl)} <ExternalLink size={12} /></a>}
                  {!live.brief && !live.briefUrl && <p className="text-[12.5px]" style={ui.soft}>It has no creative brief on TRYBE.</p>}
                  {isAdmin && <p className="text-[11px]" style={ui.soft}>For the team: TRYBE sent {live.read.keys.join(', ') || 'nothing'}.</p>}
                </>)}
              </div>
            </Section>
          )}

          {/* ── ITS NUMBERS ON TRYBE ─────────────────────────────────────── */}
          {listing && (
            <Section title="Its numbers on TRYBE" aside="From TRYBE&rsquo;s brand list and MVP&rsquo;s daily reads">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5 rounded-2xl p-5" style={ui.card}>
                <Figure label="Pay" value={listing.pay_est?.short || listing.pay_text || 'Not shown'} sub={listing.pay_est?.plus?.length ? listing.pay_est.plus.slice(0, 2).join('; ') : listing.pay_est?.guaranteed ? 'Part of it is guaranteed' : undefined} />
                <Figure label="Creators earned" value={listing.earnings_bucket || 'Not shown'} sub={listing.tier_up ? `Up from ${listing.tier_up.before || 'less'} on ${day(listing.tier_up.at)}` : 'TRYBE’s payout range'} tone={listing.tier_up ? 'strong' : undefined} />
                <Figure label="Rating" value={typeof listing.review_rating === 'number' ? `${listing.review_rating.toFixed(1)} ★` : 'No rating'} sub={typeof listing.review_count === 'number' ? `${listing.review_count} creator review${listing.review_count === 1 ? '' : 's'}` : 'Creators have not rated it'} />
                <Figure label="Top 100" value={typeof listing.top100_hits === 'number' && listing.top100_hits > 0 ? `${listing.top100_hits} video${listing.top100_hits === 1 ? '' : 's'}` : 'None seen'} sub={listing.top100_best_rank ? `Best place #${listing.top100_best_rank}` : 'In TRYBE’s Top 100 ads'} tone={listing.top100_hits > 0 ? 'strong' : undefined} />
                <Figure label="On TRYBE" value={onTrybe != null ? `${onTrybe} day${onTrybe === 1 ? '' : 's'}` : d?.brand?.firstSeen ? `Since ${day(d.brand.firstSeen)}` : 'Not known'} sub={onTrybe != null ? `Joined ${day(listing.stats?.joinedAt)}` : 'First seen by MVP'} />
                <Figure label="How known" value={typeof listing.web_rank === 'number' ? `#${listing.web_rank.toLocaleString()}` : typeof listing.google_searches === 'number' ? `${listing.google_searches} searches` : 'Not read'} sub={typeof listing.web_rank === 'number' ? 'Website rank on the web (lower is bigger)' : 'Google suggestions for its name'} />
              </div>
            </Section>
          )}

          {/* ── META ADS OVER TIME ───────────────────────────────────────── */}
          {d && (
            <Section title="Its Meta ads over time" aside={move ? `${move[0].toUpperCase()}${move.slice(1)}` : undefined}>
              <div className="rounded-2xl p-5" style={ui.card}>
                {d.meta.length >= 2
                  ? <AreaChart points={d.meta} unit="ads" ariaLabel={`${title}'s Meta ads running, ${move || ''}`} />
                  : <p className="text-[13px]" style={ui.soft}>{d.meta.length === 1 ? `${d.meta[0].value} Meta ads running when MVP counted on ${day(d.meta[0].at)}. The line starts once the count changes.` : 'MVP has not counted its Meta ads yet. Find brands counts them through SCOUT.'}</p>}
                <p className="text-[11.5px] mt-3" style={ui.soft}>Counted in Meta&rsquo;s Ad Library. A brand running more ads is spending more, and every approved TRYBE video can run as one of them.</p>
              </div>
            </Section>
          )}

          {/* ── MVP CREATORS WITH THIS BRAND ─────────────────────────────── */}
          {d && (
            <Section title="What MVP creators got back" aside={<span className="inline-flex items-center gap-1"><Users size={12} /> Only shown once 5 creators have results, never one creator&rsquo;s own</span>}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5 rounded-2xl p-5" style={ui.card}>
                <Figure label="Approved" value={d.pool?.approvalRate != null ? `${d.pool.approvalRate}%` : 'Not yet'} sub={d.pool?.approvalRate != null ? 'of their videos' : d.pool?.why || 'No results yet'} />
                <Figure label="Paid" value={d.pool?.payPerApproved != null ? `$${d.pool.payPerApproved}` : 'Not yet'} sub={d.pool?.payPerApproved != null ? 'per approved video' : 'Not enough results yet'} />
                <Figure label="Samples" value={d.samples?.shown && d.samples.arrivedRate != null ? `${d.samples.arrivedRate}%` : 'Not yet'} sub={d.samples?.shown ? `arrived${d.samples.medianDays ? `, in ${d.samples.medianDays} days` : ''}${d.samples.waitingLong ? `; ${d.samples.waitingLong} still waiting 3+ weeks` : ''}` : d.samples?.why || 'Not read'} />
                <Figure label="Answered" value={d.replies?.shown && d.replies.rate != null ? `${d.replies.rate}%` : 'Not yet'} sub={d.replies?.shown ? `of messages${d.replies.medianDays != null ? `, in ${d.replies.medianDays} days` : ''}` : d.replies?.why || 'Not read'} />
              </div>
            </Section>
          )}

          {/* ── PRODUCTS ─────────────────────────────────────────────────── */}
          {d?.pub && (
            <Section title="Its products on TRYBE" aside={d.pub.read ? `${d.pub.products.filter((p) => p.samples).length} of ${d.pub.products.length} take sample requests` : undefined}>
              {d.pub.read && d.pub.products.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {d.pub.products.slice(0, 9).map((p) => (
                    <div key={p.name} className="rounded-2xl overflow-hidden flex flex-col" style={ui.card}>
                      <div className="aspect-square flex items-center justify-center" style={{ background: '#fff' }}>
                        {p.image ? <img src={p.image} alt="" loading="lazy" className="w-full h-full object-contain" /> : <Package size={28} style={{ color: '#9AA9AB' }} />}
                      </div>
                      <div className="p-3 flex flex-col gap-1.5">
                        <span className="text-[12.5px] font-semibold leading-snug line-clamp-2" style={ui.text}>{p.name}</span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {p.price && <span className="text-[12px] font-semibold" style={{ ...ui.num, ...ui.mid }}>{p.price}</span>}
                          <Tag tone={p.samples ? 'good' : 'bad'}>{p.samples ? 'Samples open' : 'No samples'}</Tag>
                          {p.featured && <Tag tone="accent">Featured</Tag>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[13px] rounded-2xl p-4" style={{ ...ui.card, ...ui.soft }}>{d.pub.error || 'It lists no products on TRYBE.'}</p>}
              {d.pub.read && d.pub.products.length > 9 && <p className="text-[12px]" style={ui.soft}>And {d.pub.products.length - 9} more on TRYBE.</p>}
            </Section>
          )}

          {/* ── TOP 100 VIDEOS ───────────────────────────────────────────── */}
          {d && d.top.length > 0 && (
            <Section title="Its videos in TRYBE&rsquo;s Top 100" aside="The openings that made its best ads">
              <div className="flex flex-col gap-2">
                {d.top.slice(0, 6).map((t) => (
                  <div key={t.id} className="rounded-2xl p-3 flex items-center gap-3" style={ui.card}>
                    <div className="w-[54px] h-[72px] rounded-lg overflow-hidden shrink-0 flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
                      {t.thumbnail ? <img src={t.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover" /> : <PlayCircle size={20} style={ui.soft} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[11.5px] font-semibold" style={ui.soft}>
                        {t.rank && <span style={{ ...ui.num, color: 'var(--text)' }}>#{t.rank}</span>}
                        {t.creator && <span>{t.creator}</span>}
                        {t.seconds && <span>{t.seconds}s</span>}
                      </div>
                      <p className="text-[13.5px] mt-0.5 leading-snug" style={ui.text}>{t.hook ? `“${t.hook}”` : 'Its words were not read.'}</p>
                    </div>
                    {t.video && <a href={t.video} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold shrink-0 hover:underline" style={{ color: ui.accentText }}>Watch on TRYBE</a>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── YOUR SAMPLES FROM IT ─────────────────────────────────────── */}
          {d && d.you.samples.length > 0 && (
            <Section title="Your samples from it">
              <div className="flex flex-col gap-2">
                {d.you.samples.map((s, i) => (
                  <div key={i} className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={ui.card}>
                    <span className="text-[13px] font-semibold" style={ui.text}>{s.product || 'A product'}</span>
                    <span className="flex gap-1.5 flex-wrap">
                      <Tag tone={s.receivedAt ? 'good' : 'warn'}>{s.receivedAt ? `Arrived ${day(s.receivedAt)}` : `Asked ${day(s.requestedAt)}`}</Tag>
                      {s.filmedAt && <Tag tone="good">Filmed</Tag>}
                      {s.submittedAt && <Tag tone="good">Sent to the brand</Tag>}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── WHAT HAPPENED ────────────────────────────────────────────── */}
          {d && (
            <Section title="What happened to it on TRYBE" aside={<span className="inline-flex items-center gap-1"><History size={12} /> From MVP&rsquo;s daily copy of TRYBE</span>}>
              {d.timeline.length ? (
                <ol className="rounded-2xl p-2" style={ui.card}>
                  {d.timeline.slice(0, 12).map((t, i) => (
                    <li key={i} className="flex items-start gap-3 px-3 py-2.5" style={{ borderTop: i ? '1px solid var(--border)' : undefined }}>
                      <span className="text-[12px] w-16 shrink-0 pt-px" style={{ ...ui.soft, ...ui.num }}>{day(t.at)}</span>
                      <span className="min-w-0">
                        <span className="text-[11px] font-bold uppercase block" style={{ ...ui.soft, letterSpacing: '0.06em' }}>{CHANGE_WORDS[t.kind]}</span>
                        <span className="text-[13px]" style={ui.text}>{t.line}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-[13px] rounded-2xl p-4" style={{ ...ui.card, ...ui.soft }}>Nothing has changed for it since MVP first saw it{d.brand?.firstSeen ? ` on ${day(d.brand.firstSeen)}` : ''}.</p>}
            </Section>
          )}

          {/* ── ABOUT ────────────────────────────────────────────────────── */}
          {(d?.pub?.description || d?.brand?.about || listing?.about) && (
            <Section title="About it">
              <p className="text-[13.5px] leading-relaxed rounded-2xl p-5" style={{ ...ui.card, ...ui.mid }}>{d?.pub?.description || d?.brand?.about || listing?.about}</p>
              {d?.you.fitReason && <p className="text-[12.5px]" style={ui.soft}>Why it fits you{typeof d.you.fit === 'number' ? ` (${d.you.fit} of 100)` : ''}: {d.you.fitReason}</p>}
            </Section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The brand's logo from TRYBE, its website's icon, or its first letter. */
function Logo({ src, name, website }: { src: string | null; name: string; website: string | null }) {
  const [bad, setBad] = useState(0)
  let host = ''
  try { host = website ? new URL(/^https?:/i.test(website) ? website : `https://${website}`).hostname : '' } catch { host = '' }
  const tries = [src, host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128` : null].filter(Boolean) as string[]
  const url = tries[bad]
  const box = 'w-14 h-14 sm:w-16 sm:h-16 rounded-2xl shrink-0'
  if (!url) return <span className={`${box} flex items-center justify-center text-[24px] font-bold`} style={{ background: 'rgb(var(--brand-rgb) / 0.12)', color: 'var(--accent-text, var(--accent))', ...ui.num }} aria-hidden="true">{(name.trim()[0] || '?').toUpperCase()}</span>
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" onError={() => setBad((n) => n + 1)} className={`${box} object-contain p-1.5`} style={{ background: '#fff', border: '1px solid var(--border)' }} />
}
