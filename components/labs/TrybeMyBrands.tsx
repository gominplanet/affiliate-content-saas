'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MY BRANDS, TRYBE Outreach's own tab (Cole on Oink; Seb 2026-10-12: "build
// 1, 2 and 3"). From the creator's own TRYBE numbers, read through SCOUT:
//   1. the board: per brand what you earned, sent, got approved, have in
//      review and got rejected, the approval rate, and which 4 or 5 to focus
//      on and which to drop (lib/trybe-mybrands judgeBrands);
//   2. stuck: videos in review more than 5 days, with a short nudge sent into
//      the brand's own TRYBE chat (the same safe send as the first message);
//   3. copy what wins: each brand's best videos next to its video ideas.
// Nothing here is saved by MVP: it is read fresh from TRYBE each visit. A
// count MVP could not read shows as a dash with the reason, never as 0.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RotateCcw, Send, Copy, Check, AlertTriangle, Clock, Target, TrendingDown, ChevronDown, ChevronUp, MessageCircle, ExternalLink } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { type Conversation } from '@/components/labs/TrybeInbox'
import { sendInTrybeChat } from '@/components/labs/trybe-chat-send'
import TrybeVideoIdeas from '@/components/labs/TrybeVideoIdeas'
import TrybeBrandScripts from '@/components/labs/TrybeBrandScripts'
import { useTrybeAds, type AdsRead } from '@/components/labs/useTrybeAds'
import { brandAdTotals } from '@/lib/trybe-analytics'
import { adLibraryUrl } from '@/lib/trybe-pick'
import TrybeLink from '@/components/labs/TrybeLink'
import { AmazonLine } from '@/components/labs/TrybeFinderControls'
import { useTrybeAmazon } from '@/components/labs/useTrybeAmazon'
import { type Pooled, POOL_MIN } from '@/lib/trybe-changes'
import { fetchChanges } from '@/components/labs/TrybeChanges'
import { readBrandStats, readSubmissions, withSubmissions, judgeBrands, stuckOf, nudgeText, keysOf, daysAgo, reviewOf, reviewWords, rateLockOf, RATE_LOCK_DAYS, STUCK_DAYS, FOCUS_COUNT,
  type MyBrand, type Submission, type Verdict } from '@/lib/trybe-mybrands'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'

/** Pages of a brand's submissions read, 50 each. */
const SUB_PAGES = 4
const SUB_LIMIT = 50
const NUDGED_KEY = 'mvp.trybe.nudged'

interface SubRead { subs: Submission[]; error: string | null; complete: boolean }

const apiWords = (e: string | undefined, status?: number) =>
  e === 'not-allowed' ? 'This needs SCOUT 1.46.0 or newer. Update SCOUT, then reload this page.'
    : status === 401 || status === 403 ? 'TRYBE says you are signed out. Sign in to TRYBE in this browser, then press Read again.'
      : `${e || 'SCOUT did not answer.'}${status ? ` (TRYBE answered ${status})` : ''}`

export async function readBrandSubs(brandId: string): Promise<SubRead> {
  const subs: Submission[] = []
  for (let page = 1; page <= SUB_PAGES; page++) {
    const r = await requestTrybeApi('GET', `/backend/api/creator/v2/brands/${encodeURIComponent(brandId)}/submissions?period=all&page=${page}&limit=${SUB_LIMIT}`)
    if (!r.ok) return { subs, error: apiWords(r.error, r.status), complete: false }
    const got = readSubmissions(r.json)
    subs.push(...got)
    const pg = (r.json && typeof r.json === 'object' ? (r.json as { pagination?: { totalPages?: number } }).pagination : undefined)
    if (got.length < SUB_LIMIT || (pg?.totalPages != null && page >= pg.totalPages)) return { subs, error: null, complete: true }
  }
  return { subs, error: null, complete: false }
}

function readNudged(): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(NUDGED_KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
function markNudged(brandId: string) {
  try { const v = readNudged(); v[brandId] = new Date().toISOString(); localStorage.setItem(NUDGED_KEY, JSON.stringify(v)) } catch { /* shown on screen either way */ }
}

const NA = 'not read'
const money = (n: number | null) => n == null ? NA : `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
const count = (n: number | null) => n == null ? NA : n.toLocaleString('en-US')
const pct = (r: number | null) => r == null ? NA : `${Math.round(r * 100)}%`

const VERDICT: Record<Verdict, { label: string; color: string; bg: string }> = {
  focus: { label: 'Focus', color: GREEN, bg: 'rgba(22,163,74,0.10)' },
  keep: { label: 'Keep', color: 'var(--text-soft)', bg: 'var(--surface-2, rgba(0,0,0,0.05))' },
  early: { label: 'Too early', color: 'var(--text-soft)', bg: 'var(--surface-2, rgba(0,0,0,0.05))' },
  drop: { label: 'Drop', color: RED, bg: 'rgba(220,38,38,0.08)' },
}

/** The brand's TRYBE chat by its whole name, never a group (the same rule as
 *  the Sent tab). */
function chatFor(brand: string, convos: Conversation[]): Conversation | null {
  const n = (t: string) => t.toLowerCase().replace(/\(dm\)/g, ' ').replace(/[^a-z0-9()]+/g, ' ').replace(/\b(team|official)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const b = n(brand)
  if (b.length < 2) return null
  return convos.filter(c => !/\(group\)/i.test(c.name) && n(c.name) === b).sort((x, y) => y.at - x.at)[0] || null
}

export default function TrybeMyBrands({ canRead, canSend, convos, me, myName, isAdmin, scoutOpens, needsUpdate, poolOptOut = false, onPoolOptOut }: {
  /** The member turned off "Include my results in members' combined numbers". */
  poolOptOut?: boolean
  onPoolOptOut?: (v: boolean) => void
  /** SCOUT 1.46.0+ allowed on TRYBE. */
  canRead: boolean
  /** SCOUT can post into a TRYBE chat (the Inbox works). */
  canSend: boolean
  /** The TRYBE chats from the Inbox; null while not read. */
  convos: Conversation[] | null
  me: string[]
  myName: string
  isAdmin: boolean
  scoutOpens: boolean
  /** Words for an older SCOUT; null when SCOUT is new enough or missing. */
  needsUpdate: string | null
}) {
  const [brands, setBrands] = useState<MyBrand[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [subs, setSubs] = useState<Record<string, SubRead>>({})
  const [subProgress, setSubProgress] = useState<{ done: number; of: number } | null>(null)
  const [readAt, setReadAt] = useState<number | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [nudged, setNudged] = useState<Record<string, string>>({})
  // MEMBERS' COMBINED NUMBERS (migration 428): this member's numbers go in
  // once each read is whole (unless they turned it off), and every brand's
  // combined figure comes back. Not read is said, never shown as nothing.
  const [pooled, setPooled] = useState<Record<string, Pooled> | null>(null)
  const [poolNote, setPoolNote] = useState<string | null>(null)
  // Whether your own results were kept this time: a failed save is said next
  // to the box that promises it, never silent.
  const [myStatsNote, setMyStatsNote] = useState<string | null>(null)
  const sentFor = useRef<number | null>(null)

  useEffect(() => { setNudged(readNudged()) }, [])

  const load = useCallback(async () => {
    if (!canRead) return
    setLoading(true); setError(null); setSubProgress(null); setSubs({})
    try {
      const r = await requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all')
      if (!r.ok) { setError(`MVP could not read your brands on TRYBE: ${apiWords(r.error, r.status)}`); return }
      const list = readBrandStats(r.json)
      const root = r.json && typeof r.json === 'object' ? (r.json as { data?: { brandStats?: unknown } }).data : undefined
      const emptyAnswer = !!root && root.brandStats != null && typeof root.brandStats === 'object' && Object.keys(root.brandStats as object).length === 0
      if (!list.length && !emptyAnswer) {
        setError(`TRYBE answered, but MVP could not read your brands from its answer.${isAdmin ? ` (TRYBE sent: ${keysOf(r.json)})` : ' Press Read again. If it keeps happening, TRYBE changed how it sends this.'}`)
        setBrands([])
        return
      }
      setBrands(list); setReadAt(Date.now())
      // Each brand's submissions, one brand at a time: in review and rejected
      // counts, and the videos stuck in review. Only brands with videos that
      // are not all approved need it.
      const todo = list.filter(b => b.submitted == null || b.approved == null || b.submitted > b.approved)
      const next: Record<string, SubRead> = {}
      setSubProgress({ done: 0, of: todo.length })
      for (let i = 0; i < todo.length; i++) {
        next[todo[i].id] = await readBrandSubs(todo[i].id).catch((e) => ({ subs: [], error: e instanceof Error ? e.message : 'SCOUT did not answer.', complete: false }))
        setSubs({ ...next })
        setSubProgress({ done: i + 1, of: todo.length })
      }
    } finally { setLoading(false) }
  }, [canRead, isAdmin])

  // Read once on opening; after that only Read again reads, so a failed read
  // is not repeated on its own.
  const tried = useRef(false)
  useEffect(() => { if (canRead && !tried.current) { tried.current = true; void load() } }, [canRead, load])

  // Totals with in review and rejected counts from submissions read in full.
  // A brand with every video approved has none in review and none rejected.
  const filled = useMemo(() => (brands || []).map(b => {
    const s = subs[b.id]
    if (s && s.complete && !s.error) return withSubmissions(b, s.subs)
    if (!s && b.submitted != null && b.approved != null && b.submitted <= b.approved) return { ...b, pending: 0, rejected: 0 }
    return b
  }), [brands, subs])
  const judged = useMemo(() => judgeBrands(filled), [filled])
  // THE AMAZON MATCH for each brand you work with (Seb, 2026-10-14).
  const amzBrands = useMemo(() => judged.map((j) => ({ id: j.brand.id, name: j.brand.name })), [judged])
  const amz = useTrybeAmazon(amzBrands, [], amzBrands.length > 0)
  // TRYBE's own numbers for each of your videos, the last 30 days: which run
  // as ads, and what the brand spent on them (the AdsLine on each brand).
  const ads = useTrybeAds(canRead, '30d')

  useEffect(() => {
    if (!readAt || loading || !filled.length || sentFor.current === readAt) return
    if (subProgress && subProgress.done < subProgress.of) return
    sentFor.current = readAt
    void (async () => {
      const post = async (b: Record<string, unknown>) => {
        const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(30_000) })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
        return d
      }
      // How fast each brand decides your videos (reviewOf), from submissions
      // read in full only: a part read would make a brand look faster.
      const reviewFor = (id: string) => { const s = subs[id]; if (!s || !s.complete || s.error) return {}; const r = reviewOf(s.subs); return { review_days: r.days, review_n: r.n, slow: r.slow, recent: r.recent } }
      if (!poolOptOut) try { await post({ action: 'my_stats', brands: filled.map(b => ({ id: b.id, name: b.name, submitted: b.submitted, approved: b.approved, rejected: b.rejected, earnings: b.earnings, ...reviewFor(b.id) })) }); setMyStatsNote(null) }
      catch (e) { setMyStatsNote(`Your results were not added this time: ${e instanceof Error ? e.message.replace(/\.$/, '') : 'MVP did not answer'}. MVP tries again next time you open My brands.`) }
      try { const d = await post({ action: 'pooled', brandIds: filled.map(b => b.id) }); setPooled(d.pooled || {}); setPoolNote(null) }
      catch (e) { setPoolNote(e instanceof Error ? e.message : 'MVP could not read members\' combined numbers.') }
    })()
  }, [readAt, loading, filled, subProgress, poolOptOut, subs])

  const [poolSaving, setPoolSaving] = useState(false)
  async function setPool(include: boolean) {
    setPoolSaving(true)
    try {
      const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pool_setting', optOut: !include }), signal: AbortSignal.timeout(30_000) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Not saved (${r.status})`)
      onPoolOptOut?.(!include)
      toast.success(include ? 'Your results are included in members\' combined numbers.' : 'Your results are left out, and what was kept is deleted.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Not saved.') }
    finally { setPoolSaving(false) }
  }
  const stuck = useMemo(() => (brands || []).map(b => ({ b, list: stuckOf(subs[b.id]?.subs || []) })).filter(x => x.list.length > 0), [brands, subs])
  // RATE LOCK WATCH (lib/trybe-mybrands rateLockOf): a brand of yours that
  // changed its pay in the last 14 days while your videos wait in review.
  const [payChanges, setPayChanges] = useState<Array<{ brand_id: string; at: string; before: string | null; after: string | null }> | null>(null)
  useEffect(() => { if (canRead) fetchChanges(14).then(c => setPayChanges(c.changes.filter(x => x.kind === 'pay'))).catch(() => setPayChanges(null)) }, [canRead])
  const locks = useMemo(() => (brands || []).map(b => {
    const ch = (payChanges || []).filter(c => c.brand_id === b.id).sort((x, y) => Date.parse(y.at) - Date.parse(x.at))[0]
    const s = subs[b.id]
    if (!ch || !s || !s.complete || s.error) return null
    const lock = rateLockOf(s.subs, ch)
    return lock.pending.length && lock.lower !== false ? { b, ch, lock } : null
  }).filter((x): x is NonNullable<typeof x> => !!x), [brands, subs, payChanges])
  const subErrors = Object.entries(subs).filter(([, s]) => s.error)

  const totals = useMemo(() => {
    const earned = filled.reduce((n, b) => n + (b.earnings ?? 0), 0)
    const approved = filled.reduce((n, b) => n + (b.approved ?? 0), 0)
    const submitted = filled.reduce((n, b) => n + (b.submitted ?? 0), 0)
    // Brands TRYBE gave no figure for: said under the tile, never added as 0.
    const earnedUnread = filled.filter(b => b.earnings == null).length
    const countUnread = filled.filter(b => b.approved == null || b.submitted == null).length
    const focus = judged.filter(j => j.verdict === 'focus')
    const focusEarned = focus.reduce((n, j) => n + (j.brand.earnings ?? 0), 0)
    return { earned, approved, submitted, earnedUnread, countUnread, focus, focusShare: earned > 0 ? focusEarned / earned : null }
  }, [filled, judged])

  const soft = { color: 'var(--text-soft)' }
  const card = 'rounded-xl border px-4 py-3'
  const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }

  if (!canRead) {
    return (
      <div className={card} style={cardStyle}>
        <p className="text-[14px] font-semibold">My brands needs SCOUT on TRYBE</p>
        <p className="text-[13px] mt-1" style={soft}>{needsUpdate || 'Install SCOUT, allow it on TRYBE and sign in to TRYBE in this browser. MVP then reads what each brand paid you, what it approved and what is stuck in review.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] flex-1 min-w-[220px]" style={soft}>
          Read from your TRYBE account through SCOUT{readAt ? ` at ${new Date(readAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}. Cole&rsquo;s rule: put your videos into the 4 or 5 brands that pay and approve, and stop filming for the ones that don&rsquo;t.
        </p>
        {/* Read again reads the ad lines too: their error says to press it. */}
        <button onClick={() => { ads.reload(); void load() }} disabled={loading} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ border: '1px solid var(--border)' }}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Read again
        </button>
      </div>

      {error && <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: RED }}><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</p>}
      {loading && !brands && <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading your brands on TRYBE. SCOUT reads it in a tab behind this one.</p>}
      {subProgress && subProgress.done < subProgress.of && (
        <p className="text-[12px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading each brand&rsquo;s videos for what is in review: {subProgress.done} of {subProgress.of}.</p>
      )}

      {brands && brands.length === 0 && !error && (
        <div className={card} style={cardStyle}>
          <p className="text-[14px] font-semibold">No brands on your TRYBE account yet</p>
          <p className="text-[13px] mt-1" style={soft}>TRYBE lists no brand you work with. Once a brand accepts you and you submit a video, it shows here with what it paid you.</p>
        </div>
      )}

      {brands && brands.length > 0 && (<>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Tile label="Earned on TRYBE, all time" value={money(totals.earned)} hint={totals.earnedUnread ? `${brands.length - totals.earnedUnread} of ${brands.length} brands read; TRYBE gave no figure for ${totals.earnedUnread}` : `${brands.length} brand${brands.length === 1 ? '' : 's'}`} tone={totals.earnedUnread ? AMBER : undefined} />
          <Tile label="Approved, all time" value={`${count(totals.approved)} of ${count(totals.submitted)}`} hint={totals.countUnread ? `videos sent; not read for ${totals.countUnread} brand${totals.countUnread === 1 ? '' : 's'}` : 'videos sent'} tone={totals.countUnread ? AMBER : undefined} />
          <Tile label="Focus brands" value={String(totals.focus.length)} hint={totals.focusShare != null && totals.focus.length ? `${Math.round(totals.focusShare * 100)}% of what you earned` : 'none has paid yet'} tone={totals.focus.length ? GREEN : undefined} />
          <Tile label="Stuck in review" value={subProgress && subProgress.done < subProgress.of ? '…' : String(stuck.reduce((n, x) => n + x.list.length, 0))} hint={`over ${STUCK_DAYS} days`} tone={stuck.length ? AMBER : undefined} />
        </div>

        {locks.length > 0 && (
          <section className={card} style={{ ...cardStyle, borderColor: 'rgba(220,38,38,0.35)' }}>
            <p className="text-[14px] font-semibold inline-flex items-center gap-1.5"><AlertTriangle size={15} style={{ color: RED }} /> Pay changed while your videos wait</p>
            <p className="text-[12px] mt-0.5" style={soft}>These brands changed their pay while your videos are still in review. Some creators say a video keeps the old rate for {RATE_LOCK_DAYS} days after you send it (not confirmed by TRYBE), so a friendly nudge now is worth it. The nudge asks about the videos, never the pay.</p>
            <div className="mt-3 space-y-3">
              {locks.map(({ b, ch, lock }) => (
                <div key={b.id}>
                  <p className="text-[12.5px] mb-1">
                    <b>{b.name}</b> changed its pay {new Date(ch.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{ch.before && ch.after ? ` (was ${ch.before}, now ${ch.after})` : ''}{lock.lower ? ': lower' : ''}.
                    {' '}{lock.pending.length} of your videos {lock.pending.length === 1 ? 'is' : 'are'} still in review{lock.lockEnds ? `; the oldest reaches ${RATE_LOCK_DAYS} days on ${new Date(lock.lockEnds).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${lock.daysLeft != null ? ` (${lock.daysLeft} day${lock.daysLeft === 1 ? '' : 's'} left)` : ''}` : ''}.
                  </p>
                  <StuckBrand b={b} list={lock.pending} chat={convos ? chatFor(b.name, convos) : null} convosRead={!!convos} canSend={canSend}
                    me={me} myName={myName} nudgedAt={nudged[b.id] || null} scoutOpens={scoutOpens}
                    onNudged={() => { markNudged(b.id); setNudged(readNudged()) }} />
                </div>
              ))}
            </div>
          </section>
        )}

        {stuck.length > 0 && (
          <section className={card} style={{ ...cardStyle, borderColor: 'rgba(180,83,9,0.35)' }}>
            <p className="text-[14px] font-semibold inline-flex items-center gap-1.5"><Clock size={15} style={{ color: AMBER }} /> Stuck in review</p>
            <p className="text-[12px] mt-0.5" style={soft}>Videos a brand has not approved or rejected after {STUCK_DAYS} days. A short, friendly nudge in their TRYBE chat usually gets them looked at.</p>
            <div className="mt-3 space-y-3">
              {stuck.map(({ b, list }) => (
                <StuckBrand key={b.id} b={b} list={list} chat={convos ? chatFor(b.name, convos) : null} convosRead={!!convos} canSend={canSend}
                  me={me} myName={myName} nudgedAt={nudged[b.id] || null} scoutOpens={scoutOpens}
                  onNudged={() => { markNudged(b.id); setNudged(readNudged()) }} />
              ))}
            </div>
          </section>
        )}

        {subErrors.length > 0 && (
          <p className="text-[12px] inline-flex items-start gap-1.5" style={{ color: AMBER }}>
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            MVP could not read the videos of {subErrors.length} brand{subErrors.length === 1 ? '' : 's'} ({subErrors.slice(0, 3).map(([id]) => brands.find(b => b.id === id)?.name || id).join(', ')}{subErrors.length > 3 ? ', and more' : ''}), so their videos in review are not counted: {subErrors[0][1].error}
          </p>
        )}

        <section className="space-y-2">
          {judged.map(j => {
            const b = j.brand
            const v = VERDICT[j.verdict]
            const s = subs[b.id]
            const isOpen = open === b.id
            return (
              <div key={b.id} className={card} style={j.verdict === 'focus' ? { ...cardStyle, borderColor: 'rgba(22,163,74,0.4)' } : cardStyle}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {b.logo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={b.logo} alt="" className="w-9 h-9 rounded-lg object-contain border shrink-0" style={{ borderColor: 'var(--border)', background: '#fff' }} />
                    : <span className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-[14px] font-bold" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>{b.name.slice(0, 1).toUpperCase()}</span>}
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold flex flex-wrap items-center gap-2">
                      {b.name}
                      <span className="text-[11px] font-bold rounded-full px-2 py-0.5 inline-flex items-center gap-1" style={{ color: v.color, background: v.bg }}>
                        {j.verdict === 'focus' && <Target size={11} />}{j.verdict === 'drop' && <TrendingDown size={11} />}{v.label}
                      </span>
                    </p>
                    <p className="text-[12px]" style={j.verdict === 'drop' ? { color: RED } : soft}>{j.why}</p>
                  </div>
                  <span className="inline-flex items-center gap-3">
                    <TrybeLink brandId={b.id} name={b.name} scout={scoutOpens} />
                    {/* Their live ads on Meta (Seb, 2026-10-20: "I'd like to also
                        see the meta ads link that we had previously under find brands"). */}
                    <a href={adLibraryUrl(b.name)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PURPLE }}>Meta Ad Library <ExternalLink size={11} /></a>
                  </span>
                </div>
                <AmazonLine amazon={amz.brand(b.id)} className="mt-1.5 sm:ml-12" />
                <AdsLine b={b} ads={ads.read} loading={ads.loading} problem={ads.problem?.text ?? null} />
                <dl className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-1 text-[12px] tabular-nums">
                  <Num label="Earned, all time" value={money(b.earnings)} />
                  <Num label="Sent" value={count(b.submitted)} />
                  <Num label="Approved" value={count(b.approved)} />
                  <Num label="In review" value={b.pending == null && !s && loading ? '…' : count(b.pending)} why={b.pending == null ? (s?.error ? 'Not read: ' + s.error : s && !s.complete ? `More than ${SUB_PAGES * SUB_LIMIT} videos: not all read` : 'Reading...') : undefined} />
                  <Num label="Rejected" value={count(b.rejected)} why={b.rejected == null ? 'Not read yet' : undefined} />
                  {/* Two kinds of rate, named: Analytics' is out of all sent, this one out of decided when TRYBE said how many it rejected. */}
                  <Num label={j.rate != null && !j.exactRate ? 'Approved of sent' : 'Approved of decided'} value={pct(j.rate)} why={j.rate != null && !j.exactRate ? 'Approved out of all sent, videos in review included' : undefined} />
                </dl>
                {/* Your rate is compared only when it is the same kind: out of decided videos. */}
                <MembersLine p={pooled ? pooled[b.id] ?? null : undefined} note={poolNote} mine={j.exactRate ? j.rate : null} />
                <button onClick={() => setOpen(isOpen ? null : b.id)} className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PURPLE }}>
                  {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {isOpen ? 'Hide' : 'Their best videos and video ideas'}
                </button>
                {isOpen && (
                  <div className="mt-2">
                    <TrybeVideoIdeas brandId={b.id} name={b.name} plan={null} canRead={canRead} isAdmin={isAdmin} emphasize={j.verdict === 'focus'} />
                  </div>
                )}
              </div>
            )
          })}
        </section>
        <p className="text-[11px]" style={soft}>
          <label className="flex items-start gap-2 mb-2 cursor-pointer">
            <input type="checkbox" checked={!poolOptOut} disabled={poolSaving} onChange={(e) => void setPool(e.target.checked)} className="h-4 w-4 mt-0.5" style={{ accentColor: PURPLE }} />
            <span><b style={{ color: 'var(--text)' }}>Include my results in members&rsquo; combined numbers.</b> MVP shows a brand&rsquo;s approval rate and pay per approved video from members&rsquo; results only when at least {POOL_MIN} members have results for it and no one member is more than half. No member&rsquo;s own numbers are ever shown. Turning this off deletes what was kept.</span>
          </label>
          {myStatsNote && <span className="block mb-2" style={{ color: AMBER }}>{myStatsNote}</span>}
          Focus means one of your top {FOCUS_COUNT} by what it paid you. Drop means it approves fewer than 1 in 3 of the videos it decided, or it decided 5 in 30 days and approved none. Too early means fewer than 3 videos decided. Approval counts videos the brand decided on, not ones still in review; when TRYBE did not say how many it rejected, the rate is out of all sent, marked so, and never used to drop a brand. Earned and Approved are all time.
        </p>
        {/* Your brands' top videos, word for word (Seb, 2026-10-20). */}
        <TrybeBrandScripts brands={brands} isAdmin={isAdmin} />
      </>)}
    </div>
  )
}

/** WHETHER THE BRAND PUT ADS BEHIND YOUR VIDEOS (Seb, 2026-10-20: "see if
 *  they're actually putting ads behind my video"). TRYBE's own numbers for
 *  each of your videos, the last 30 days: running as an ad now, what the
 *  brand spent, impressions. Meta's Ad Library cannot be searched for one
 *  video, so this is the exact answer for ads run through TRYBE; the link
 *  beside it shows the brand's ads there. */
function AdsLine({ b, ads, loading, problem }: { b: MyBrand; ads: AdsRead | null; loading: boolean; problem: string | null }) {
  const soft = { color: 'var(--text-soft)' }
  if (!ads) return <p className="mt-1.5 text-[12px]" style={soft}>{loading ? 'Reading which of your videos run as ads…' : `Ads: ${problem || 'TRYBE’s ad numbers were not read.'}`}</p>
  if (ads.source !== 'full') return <p className="mt-1.5 text-[12px]" style={soft}>Ads: {problem || 'this SCOUT reads only what you earned, so MVP cannot say whether your videos run as ads.'}</p>
  // The videos did not answer: not read, never "none running".
  if (ads.videosRead === false) return <p className="mt-1.5 text-[12px]" style={{ color: AMBER }}>Ads: MVP could not read your ad videos from TRYBE just now. Press Read again.</p>
  const { totals, videos } = brandAdTotals(ads.videos, b)
  const live = videos.filter((v) => v.live === true)
  const ran = (totals.spend ?? 0) > 0 || (totals.impressions ?? 0) > 0
  const numbers = [totals.spend != null && totals.spend > 0 ? `${money(totals.spend)} spent` : '', totals.impressions ? `${totals.impressions.toLocaleString()} impressions` : '', totals.clicks ? `${totals.clicks.toLocaleString()} link clicks` : ''].filter(Boolean).join(', ')
  const text = !videos.length ? `TRYBE shows none of your videos for ${b.name} running as an ad in the last 30 days.`
    : live.length ? `${live.length} of your videos for ${b.name} ${live.length === 1 ? 'runs' : 'run'} as an ad now${numbers ? `: ${numbers} in the last 30 days` : ''}.`
    : ran ? `Your videos for ${b.name} ran as ads in the last 30 days, none running now${numbers ? `: ${numbers}` : ''}.`
    : `TRYBE lists ${videos.length} of your videos for ${b.name}, none running as an ad in the last 30 days.`
  return (
    <p className="mt-1.5 text-[12px] rounded-lg px-2.5 py-1.5" style={{ background: live.length || ran ? 'rgba(22,163,74,0.08)' : 'rgba(124,58,237,0.05)', color: live.length || ran ? GREEN : 'var(--text-soft)' }}>
      <b>Your videos as ads (TRYBE):</b> {text}
    </p>
  )
}

/** What MVP members see together for this brand, next to your own. */
function MembersLine({ p, note, mine }: { p: Pooled | null | undefined; note: string | null; mine: number | null }) {
  const soft = { color: 'var(--text-soft)' }
  if (p === undefined) return note ? <p className="mt-2 text-[12px]" style={{ color: AMBER }}>MVP members: {note}</p> : null
  const rw = reviewWords(p)
  if (!p || (p.approvalRate == null && p.payPerApproved == null && !rw)) {
    return <p className="mt-2 text-[12px]" style={soft}>MVP members: {p?.why || `shown once ${POOL_MIN} MVP members have results for this brand.`}</p>
  }
  const diff = p.approvalRate != null && mine != null ? Math.round((mine - p.approvalRate) * 100) : null
  return (
    <p className="mt-2 text-[12px] rounded-lg px-2.5 py-1.5" style={{ background: 'rgba(124,58,237,0.06)' }}>
      <b>MVP members ({p.members >= POOL_MIN ? `${POOL_MIN}+` : p.members}):</b>{' '}
      {p.approvalRate != null && <>approve {Math.round(p.approvalRate * 100)}% of videos{diff != null && diff !== 0 ? <span style={{ color: diff > 0 ? GREEN : AMBER }}> (you: {diff > 0 ? `${diff} points above` : `${-diff} points below`})</span> : null}</>}
      {p.approvalRate != null && p.payPerApproved != null && ' · '}
      {p.payPerApproved != null && <>about {money(p.payPerApproved)} per approved video</>}
      {rw && (p.approvalRate != null || p.payPerApproved != null) && ' · '}
      {rw && <span style={{ color: rw.tone === 'good' ? GREEN : rw.tone === 'bad' ? AMBER : undefined }}>{rw.text.charAt(0).toLowerCase() + rw.text.slice(1)}</span>}
    </p>
  )
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>{label}</p>
      <p className="text-[20px] font-bold leading-tight mt-0.5 tabular-nums" style={tone ? { color: tone } : undefined}>{value}</p>
      {hint && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-soft)' }}>{hint}</p>}
    </div>
  )
}

function Num({ label, value, why }: { label: string; value: string; why?: string }) {
  return (
    <div title={why}>
      <dt className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>{label}</dt>
      <dd className={value === NA ? 'text-[12px] font-medium' : 'text-[14px] font-semibold'} style={value === NA ? { color: 'var(--text-soft)' } : undefined}>{value}{why ? <span className="sr-only"> {why}</span> : null}</dd>
    </div>
  )
}

function StuckBrand({ b, list, chat, convosRead, canSend, me, myName, nudgedAt, scoutOpens, onNudged }: {
  b: MyBrand; list: Submission[]; chat: Conversation | null; convosRead: boolean; canSend: boolean
  me: string[]; myName: string; nudgedAt: string | null; scoutOpens: boolean; onNudged: () => void
}) {
  const [text, setText] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const now = Date.now()
  const lastNudge = nudgedAt ? Date.parse(nudgedAt) : NaN
  const nudgedDays = Number.isFinite(lastNudge) ? daysAgo(lastNudge, now) : null

  async function send() {
    if (!chat || !text?.trim()) return
    setSending(true); setNote(null)
    try {
      const r = await sendInTrybeChat(chat.id, text.trim(), me, myName)
      if (!r.sent) { setNote({ tone: r.tone, text: r.text }); return }
      onNudged()
      setText(null)
      setNote({ tone: 'ok', text: r.already ? 'This nudge is already in your TRYBE chat, so it was not sent again.' : `Sent. It shows in your TRYBE chat with ${b.name}.` })
    } catch (e) { setNote({ tone: 'bad', text: e instanceof Error ? e.message : 'Not sent.' }) }
    finally { setSending(false) }
  }

  async function copy() {
    if (!text) return
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { toast.error('Could not copy. Select the text instead.') }
  }

  const soft = { color: 'var(--text-soft)' }
  const btn = 'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50'
  const noChat = !convosRead ? 'MVP has not read your TRYBE chats yet. Open the Inbox tab once, or copy the nudge and send it on TRYBE.'
    : !chat ? `No TRYBE chat with ${b.name} in your inbox. Copy the nudge and send it from their page on TRYBE.` : null

  return (
    <div className="rounded-lg border px-3 py-2.5 text-[12px]" style={{ borderColor: 'var(--border)', background: 'var(--surface-2, rgba(0,0,0,0.03))' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">{b.name}</span>
        <span style={{ color: AMBER }}>{list.length} video{list.length === 1 ? '' : 's'} in review, the oldest {daysAgo(list[0].at ?? now, now)} days</span>
        {nudgedDays != null && <span style={soft}>You nudged them {nudgedDays === 0 ? 'today' : `${nudgedDays} day${nudgedDays === 1 ? '' : 's'} ago`} from MVP.</span>}
        <TrybeLink brandId={b.id} name={b.name} scout={scoutOpens} />
      </div>
      <ul className="mt-1 space-y-0.5" style={soft}>
        {list.slice(0, 4).map(s => <li key={s.id}>{s.product || 'A video'}: sent {s.at ? new Date(s.at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'on an unknown day'}, {s.rawStatus ? `TRYBE says "${s.rawStatus.toLowerCase().replace(/_/g, ' ')}"` : 'in review'}</li>)}
        {list.length > 4 && <li>and {list.length - 4} more</li>}
      </ul>
      {text == null ? (
        <button onClick={() => { setText(nudgeText(b.name, list, now)); setNote(null) }} className={`${btn} mt-2`} style={{ background: nudgedDays != null && nudgedDays < 3 ? 'transparent' : PURPLE, color: nudgedDays != null && nudgedDays < 3 ? PURPLE : '#fff', border: `1px solid ${PURPLE}` }}>
          <MessageCircle size={12} /> {nudgedDays != null ? 'Write another nudge' : 'Write a nudge'}
        </button>
      ) : (
        <div className="mt-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="w-full rounded-lg border p-2.5 text-[13px] whitespace-pre-wrap" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} />
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {chat && canSend && (
              <button onClick={() => void send()} disabled={sending || !text.trim()} className={btn} style={{ background: PURPLE, color: '#fff' }}>
                {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send on TRYBE
              </button>
            )}
            <button onClick={() => void copy()} className={btn} style={{ border: '1px solid var(--border)' }}>
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={() => setText(null)} className="text-[12px] font-semibold" style={soft}>Cancel</button>
            <span className="text-[11px]" style={soft}>{chat && canSend ? `Sent as shown into your chat with ${b.name}.` : noChat || 'SCOUT cannot post into TRYBE chats right now. Copy it and send it on TRYBE.'}</span>
          </div>
        </div>
      )}
      {note && <p className="mt-1.5 inline-flex items-start gap-1" style={{ color: note.tone === 'ok' ? GREEN : note.tone === 'warn' ? AMBER : RED }}>{note.tone !== 'ok' && <AlertTriangle size={12} className="mt-0.5 shrink-0" />}{note.text}</p>}
    </div>
  )
}
