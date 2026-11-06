'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE TRYBE HOME (Seb, 2026-11-06: "I would like to wake up ... and see a
// different Tribe feature happening"). The first thing a creator sees: what
// needs them today, then what moved on TRYBE this week, read from MVP's own
// daily copy (lib/trybe-home): new brands, who is pouring money into Meta
// ads, who raised or cut pay, who climbed a payout tier, who entered the Top
// 100, new brands already advertising, and what TRYBE brands pay as a market.
// Every brand's name opens its page. Every figure says the window it covers.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Inbox, Send, Package, Search, TrendingUp, TrendingDown, Sparkles, Trophy, ArrowUpRight, RefreshCw } from 'lucide-react'
import { ui, Section, Tag, Spark } from '@/components/labs/trybe-ui'
import { BrandName } from '@/components/labs/trybe-dossier-context'
import { BrandMark } from '@/components/labs/TrybeFinderControls'
import { useTrybeAds } from '@/components/labs/useTrybeAds'
import { changeLine, CHANGE_WORDS, type ChangeKind } from '@/lib/trybe-changes'

interface Card { brand_id: string; name: string; website: string | null; categories: string[]; pay: string | null; metaAds: number | null; bucket: string | null; top100: number | null; rating: number | null }
interface HomeRead {
  at: string; listed: number | null; total: number | null; collectedAt: string | null; joinedSinceFirst: number | null; firstCountAt: string | null
  series: Record<string, number[]>; totals: Record<string, { now: number; before: number }>
  movers: Array<Card & { from: number; to: number; gain: number; at: string }>
  pays: Array<Card & { before: string; after: string; dir: 'up' | 'down' | 'changed'; delta: string | null; at: string }>
  tiers: Array<Card & { before: string | null; after: string | null; at: string }>
  tops: Array<Card & { rank: number | null; at: string }>
  fresh: Array<Card & { at: string }>
  newWeek: number
  payIndex: { brands: number; read: number; rows: Array<{ kind: string; label: string; brands: number; share: number; median: number | null; p25: number | null; p75: number | null; unit: '$' | '%' }>; flatBands: Array<{ label: string; n: number }> } | null
  kept?: boolean
}

const ago = (iso: string | null) => {
  if (!iso) return 'not yet'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (m < 60) return `${Math.max(1, m)} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const fmt = (n: number | null | undefined) => (n == null ? 'Not read' : n.toLocaleString())
const val = (n: number | null, unit: '$' | '%') => (n == null ? '' : unit === '$' ? `$${Math.round(n)}` : `${Math.round(n * 10) / 10}%`)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ForYou = Record<string, any>

export default function TrybeHome({ go, unread, queue, repliedWeek, inboxRead, forYou = [], forYouWhy = '', canMoney = false, yours = [] }: {
  /** Open a TRYBE tab. */
  go: (tab: 'find' | 'queue' | 'inbox' | 'week' | 'changes' | 'stars' | 'sent' | 'analytics') => void
  unread: number
  queue: number
  repliedWeek: number
  /** The inbox was read through SCOUT (so its counts are real). */
  inboxRead: boolean
  /** Find brands' best bets for the creator's niche, not yet on their list. */
  forYou?: ForYou[]
  /** The niche those were found for, in words. */
  forYouWhy?: string
  /** SCOUT can read the creator's own TRYBE earnings and ad results. */
  canMoney?: boolean
  /** What changed this week on brands already on the creator's list (What changed's read). */
  yours?: Array<{ brand_id: string; kind: ChangeKind; before: string | null; after: string | null; at: string; name: string | null; categories: string[] }>
}) {
  // YOUR TRYBE, LAST 30 DAYS: the same read as Earnings, shared, so opening
  // Earnings after this reads nothing twice.
  const ads = useTrybeAds(canMoney, '30d')
  const [d, setD] = useState<HomeRead | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [samples, setSamples] = useState<{ here: number; coming: number; late: number } | null>(null)

  const load = useCallback(async (fresh = false) => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'home', fresh }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `The server answered ${r.status}`)
      setD(j as HomeRead)
    } catch (e) { setErr(e instanceof Error ? e.message : 'no answer') } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    fetch('/api/labs/trybe/samples', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const list = (j?.samples || []) as Array<{ received_at: string | null; filmed_at: string | null; submitted_at: string | null; requested_at: string | null; done?: boolean | null }>
      const open = list.filter((s) => !s.submitted_at && !s.done)
      setSamples({
        here: open.filter((s) => s.received_at && !s.filmed_at).length,
        coming: open.filter((s) => !s.received_at).length,
        late: open.filter((s) => !s.received_at && s.requested_at && Date.now() - Date.parse(s.requested_at) > 21 * 86_400_000).length,
      })
    }).catch(() => setSamples(null))
  }, [])

  const t = d?.totals || {}
  const headline = d ? [
    t.new ? `${t.new.now.toLocaleString()} new brand${t.new.now === 1 ? '' : 's'}` : null,
    t.pay ? `${t.pay.now} pay change${t.pay.now === 1 ? '' : 's'}` : null,
    t.tier ? `${t.tier.now} climbed a payout tier` : null,
    t.top100 ? `${t.top100.now} entered the Top 100` : null,
  ].filter(Boolean) : []

  return (
    <div className="flex flex-col gap-8">
      {/* ── THE WEEK, IN ONE LINE ─────────────────────────────────────────── */}
      <div className="rounded-[22px] p-6 sm:p-7 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgb(var(--brand-rgb) / 0.10), rgb(var(--brand-rgb) / 0.02) 60%), var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 max-w-[720px]">
            <p className="text-[11px] font-bold uppercase" style={{ ...ui.soft, letterSpacing: '0.1em' }}>This week on TRYBE</p>
            <h2 className="text-[26px] sm:text-[30px] font-bold leading-[1.15] mt-1.5" style={{ ...ui.num, ...ui.text, textWrap: 'balance' as never }}>
              {d ? (headline.length ? `${headline.join(', ')}.` : 'A quiet week on TRYBE so far.') : loading ? 'Reading what moved on TRYBE…' : 'What moved on TRYBE'}
            </h2>
            <p className="text-[13px] mt-2" style={ui.mid}>
              {d ? <>MVP keeps its own copy of TRYBE&rsquo;s brand list: {fmt(d.listed)} brands listed now, checked {ago(d.collectedAt)}.{d.joinedSinceFirst != null && d.firstCountAt ? <> {d.joinedSinceFirst.toLocaleString()} joined since {day(d.firstCountAt)}.</> : null}</> : 'Counted from MVP’s daily copy of TRYBE.'}
            </p>
          </div>
          <button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-xl px-3 py-2 disabled:opacity-50" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {d?.kept ? `Counted ${ago(d.at)}` : 'Count again'}
          </button>
        </div>
        {err && <p className="mt-3 text-[13px] inline-flex items-center gap-1.5" style={{ color: 'var(--text)' }}><AlertTriangle size={14} style={{ color: '#F59E0B' }} /> MVP could not count this week: {err}. <button type="button" className="font-semibold underline" onClick={() => void load(true)}>Try again</button></p>}
      </div>

      {/* ── WHAT NEEDS YOU ────────────────────────────────────────────────── */}
      <Section title="What needs you today">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Desk icon={Inbox} label="Brand chats waiting" value={inboxRead ? String(unread) : 'Not read'} line={inboxRead ? (unread ? 'Answer while they are interested' : `All answered. ${repliedWeek} replied this week`) : 'SCOUT reads your TRYBE inbox'} hot={inboxRead && unread > 0} onClick={() => go('inbox')} cta="Open the inbox" />
          <Desk icon={Send} label="Messages ready to send" value={String(queue)} line={queue ? 'Written in your words, waiting for SCOUT' : 'Nothing written yet'} hot={queue > 0} onClick={() => go(queue ? 'queue' : 'find')} cta={queue ? 'Send them' : 'Find brands'} />
          <Desk icon={Package} label="Samples here, not filmed" value={samples ? String(samples.here) : 'Not read'} line={samples ? (samples.late ? `${samples.coming} on the way, ${samples.late} late by 3+ weeks` : `${samples.coming} on the way`) : 'From your samples list'} hot={!!samples?.here} onClick={() => go('week')} cta="Plan them" />
          <Desk icon={Search} label="New brands this week" value={d ? d.newWeek.toLocaleString() : '…'} line="Rank them for your channel" onClick={() => go('find')} cta="Find brands" />
        </div>
      </Section>

      {/* ── YOUR TRYBE, LAST 30 DAYS ──────────────────────────────────────── */}
      {canMoney && (
        <Section title="Your TRYBE, last 30 days" aside={<button type="button" onClick={() => go('analytics')} className="font-semibold hover:underline" style={{ color: 'var(--accent-text, var(--accent))' }}>Open Earnings</button>}>
          {ads.month ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Money label="Earned" value={ads.month.earned != null ? `$${Math.round(ads.month.earned).toLocaleString()}` : 'Not read'} line={ads.week?.earned != null ? `$${Math.round(ads.week.earned).toLocaleString()} in the last 7 days` : 'From TRYBE’s Analytics'} />
              <Money label="Running as ads" value={ads.month.liveAds != null ? String(ads.month.liveAds) : 'Not read'} line="Your videos brands run now" />
              <Money label="Brands spent" value={ads.month.spend != null ? `$${Math.round(ads.month.spend).toLocaleString()}` : 'Not read'} line="Running your videos as ads" />
              <Money label="Hook rate" value={ads.month.hookRate != null ? `${Math.round(ads.month.hookRate * 10) / 10}%` : 'Not read'} line="Stopped scrolling in 3 seconds" />
              <Money label="Click rate" value={ads.month.ctr != null ? `${Math.round(ads.month.ctr * 100) / 100}%` : 'Not read'} line="Clicked through to the brand" />
              <Money label="Watched" value={ads.month.avgWatchSec != null ? `${Math.round(ads.month.avgWatchSec)}s` : 'Not read'} line={ads.month.avgWatchPct != null ? `${Math.round(ads.month.avgWatchPct)}% of a video, on average` : 'Average watch time'} />
            </div>
          ) : ads.loading ? <p className="text-[13px] inline-flex items-center gap-2" style={ui.soft}><Loader2 size={14} className="animate-spin" /> Reading your earnings from TRYBE through SCOUT&hellip;</p>
            : <Empty>{ads.problem?.text || 'MVP could not read your earnings from TRYBE yet.'}</Empty>}
        </Section>
      )}

      {/* ── BEST BETS FOR YOU ─────────────────────────────────────────────── */}
      {forYou.length > 0 && (
        <Section title="Best bets for you" aside={forYouWhy ? `For ${forYouWhy}, not on your list yet` : 'Not on your list yet'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {forYou.map((b) => (
              <div key={b.brand_id} className="rounded-2xl p-4 flex flex-col gap-2.5" style={ui.card}>
                <div className="flex items-center gap-3 min-w-0">
                  <BrandMark name={b.name} website={b.website} size={38} />
                  <div className="min-w-0 flex-1">
                    <BrandName id={b.brand_id} name={b.name} className="text-[14px] font-semibold block truncate" style={ui.text} />
                    <span className="text-[11.5px] block truncate" style={ui.soft}>{(b.categories || []).slice(0, 2).join(', ') || 'No category'}</span>
                  </div>
                  {typeof b.pick === 'number' && <span className="text-[18px] font-bold shrink-0" style={{ ...ui.num, ...ui.text }} title="MVP pick, of 100">{Math.round(b.pick)}</span>}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {b.pay_est?.dollars != null ? <Tag tone="good">${Math.round(b.pay_est.dollars)} a video</Tag> : b.pay_est?.short ? <Tag>{String(b.pay_est.short).slice(0, 24)}</Tag> : null}
                  {typeof b.meta_ads === 'number' && b.meta_fresh && b.meta_ads > 0 && <Tag tone="good">{b.meta_ads} Meta ads</Tag>}
                  {b.stats?.samples === true && <Tag tone="good">Samples</Tag>}
                  {b.crowd?.level === 'open' && <Tag tone="accent">Room for you</Tag>}
                  {b.is_new && <Tag tone="accent">New</Tag>}
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => go('find')} className="self-start text-[13px] font-semibold hover:underline" style={{ color: 'var(--accent-text, var(--accent))' }}>See all of them in Find brands</button>
        </Section>
      )}

      {/* ── YOUR BRANDS THIS WEEK ─────────────────────────────────────────── */}
      {yours.length > 0 && (
        <Section title="Your brands this week" aside={<button type="button" onClick={() => go('changes')} className="font-semibold hover:underline" style={{ color: 'var(--accent-text, var(--accent))' }}>Every change</button>}>
          <div className="rounded-2xl overflow-hidden" style={ui.card}>
            {yours.slice(0, 8).map((c, i) => (
              <div key={`${c.brand_id}${c.kind}${i}`} className="flex items-start gap-3 px-4 py-3" style={{ borderTop: i ? '1px solid var(--border)' : undefined }}>
                <span className="text-[12px] w-14 shrink-0 pt-0.5" style={{ ...ui.soft, ...ui.num }}>{day(c.at)}</span>
                <div className="min-w-0 flex-1">
                  {c.name ? <BrandName id={c.brand_id} name={c.name} className="text-[13.5px] font-semibold" style={ui.text} /> : <span className="text-[13.5px] font-semibold" style={ui.text}>A brand MVP no longer lists</span>}
                  <span className="text-[12px] block" style={ui.mid}><span className="font-semibold">{CHANGE_WORDS[c.kind]}:</span> {changeLine(c)}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11.5px]" style={ui.soft}>Brands on your list: messaged, written to, or joined.</p>
        </Section>
      )}

      {/* ── THE MARKET, IN NUMBERS ────────────────────────────────────────── */}
      {d && (
        <Section title="TRYBE this week, in numbers" aside="Last 7 days next to the 7 before. The line is 30 days.">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Pulse label="New brands" k="new" d={d} good="up" />
            <Pulse label="Left TRYBE" k="left" d={d} good="down" />
            <Pulse label="Pay changes" k="pay" d={d} />
            <Pulse label="Payout tier up" k="tier" d={d} good="up" />
            <Pulse label="More Meta ads" k="ads" d={d} good="up" />
            <Pulse label="Into the Top 100" k="top100" d={d} good="up" />
          </div>
        </Section>
      )}

      {/* ── POURING MONEY INTO META ───────────────────────────────────────── */}
      {d && (
        <Section title="Pouring money into Meta ads" aside="Most new Meta ads in the last 14 days, counted in Meta’s Ad Library">
          {d.movers.length ? (
            <div className="rounded-2xl overflow-hidden" style={ui.card}>
              {d.movers.map((m, i) => {
                const max = Math.max(...d.movers.map((x) => x.to), 1)
                return (
                  <div key={m.brand_id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: i ? '1px solid var(--border)' : undefined }}>
                    <span className="w-5 text-[12px] font-bold text-right shrink-0" style={{ ...ui.num, ...ui.soft }}>{i + 1}</span>
                    <BrandMark name={m.name} website={m.website} size={34} />
                    <div className="min-w-0 flex-1">
                      <BrandName id={m.brand_id} name={m.name} className="text-[14px] font-semibold block truncate" style={ui.text} />
                      <span className="text-[11.5px] block truncate" style={ui.soft}>{[m.categories[0], m.pay].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="hidden sm:block w-[200px] shrink-0">
                      <div className="h-2 rounded-full relative" style={{ background: 'var(--surface-2)' }}>
                        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(m.from / max) * 100}%`, background: 'rgb(var(--brand-rgb) / 0.35)' }} />
                        <div className="absolute inset-y-0 rounded-full" style={{ left: `${(m.from / max) * 100}%`, width: `${((m.to - m.from) / max) * 100}%`, background: 'var(--accent)' }} />
                      </div>
                    </div>
                    <span className="text-right shrink-0 w-[92px]">
                      <span className="text-[15px] font-bold block" style={{ ...ui.num, ...ui.text }}>+{m.gain}</span>
                      <span className="text-[11px] block" style={{ ...ui.num, ...ui.soft }}>{m.from} to {m.to} ads</span>
                    </span>
                  </div>
                )
              })}
            </div>
          ) : <Empty>No brand&rsquo;s Meta ads grew in the last 14 days, or MVP has not counted them yet. Star brands counts them through SCOUT.</Empty>}
        </Section>
      )}

      {/* ── PAY ───────────────────────────────────────────────────────────── */}
      {d && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section title="Pay raised" aside="Last 14 days">
            <MoveList rows={d.pays.filter((p) => p.dir === 'up').slice(0, 8)} empty="No pay raises in the last 14 days." icon="up" />
          </Section>
          <Section title="Pay cut or changed" aside="Your rate is locked on the day you join">
            <MoveList rows={d.pays.filter((p) => p.dir !== 'up').slice(0, 8)} empty="No pay cuts in the last 14 days." icon="down" />
          </Section>
        </div>
      )}

      {/* ── TIERS AND TOP 100 ─────────────────────────────────────────────── */}
      {d && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section title="Climbed a payout tier" aside="What TRYBE shows it has paid creators">
            {d.tiers.length ? (
              <div className="rounded-2xl overflow-hidden" style={ui.card}>
                {d.tiers.slice(0, 8).map((x, i) => (
                  <Row key={`${x.brand_id}${i}`} c={x} first={!i} right={<span className="text-[12.5px] font-semibold whitespace-nowrap" style={{ ...ui.num, ...ui.text }}>{x.before || 'None'} <ArrowUpRight size={12} className="inline -mt-0.5" style={{ color: '#10B981' }} /> {x.after}</span>} sub={day(x.at)} />
                ))}
              </div>
            ) : <Empty>No brand climbed a payout tier in the last 14 days.</Empty>}
          </Section>
          <Section title="Into TRYBE&rsquo;s Top 100" aside="Its videos are running as winning ads">
            {d.tops.length ? (
              <div className="rounded-2xl overflow-hidden" style={ui.card}>
                {d.tops.slice(0, 8).map((x, i) => (
                  <Row key={`${x.brand_id}${i}`} c={x} first={!i} right={<span className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ ...ui.num, ...ui.text }}><Trophy size={13} style={{ color: '#F59E0B' }} />{x.rank ? `#${x.rank}` : 'In'}</span>} sub={day(x.at)} />
                ))}
              </div>
            ) : <Empty>No new brands in the Top 100 in the last 14 days.</Empty>}
          </Section>
        </div>
      )}

      {/* ── NEW, ALREADY ADVERTISING ──────────────────────────────────────── */}
      {d && d.fresh.length > 0 && (
        <Section title="New on TRYBE this week" aside="The ones already running Meta ads first">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {d.fresh.slice(0, 9).map((c) => (
              <div key={c.brand_id} className="rounded-2xl p-4 flex flex-col gap-2.5" style={ui.card}>
                <div className="flex items-center gap-3 min-w-0">
                  <BrandMark name={c.name} website={c.website} size={38} />
                  <div className="min-w-0">
                    <BrandName id={c.brand_id} name={c.name} className="text-[14px] font-semibold block truncate" style={ui.text} />
                    <span className="text-[11.5px] block truncate" style={ui.soft}>{c.categories.join(', ') || 'No category'} &middot; joined {day(c.at)}</span>
                  </div>
                </div>
                <p className="text-[12.5px] line-clamp-2 min-h-[2.4em]" style={ui.mid}>{c.pay || 'TRYBE shows no pay for it yet'}</p>
                <div className="flex gap-1.5 flex-wrap">
                  {c.metaAds != null ? <Tag tone={c.metaAds > 0 ? 'good' : 'plain'}>{c.metaAds > 0 ? `${c.metaAds} Meta ads` : 'No Meta ads'}</Tag> : <Tag>Meta ads not counted</Tag>}
                  {c.rating != null && <Tag>{c.rating.toFixed(1)} &#9733;</Tag>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── WHAT TRYBE BRANDS PAY ─────────────────────────────────────────── */}
      {d?.payIndex && d.payIndex.rows.length > 0 && (
        <Section title="What TRYBE brands pay" aside={`From the pay of ${d.payIndex.read.toLocaleString()} of ${d.payIndex.brands.toLocaleString()} listed brands MVP could read`}>
          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3">
            <div className="rounded-2xl overflow-x-auto" style={ui.card}>
              <table className="w-full text-[13px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr className="text-left text-[11px] uppercase" style={{ ...ui.soft, letterSpacing: '0.06em' }}>
                    <th className="px-4 py-3 font-semibold">Kind of pay</th><th className="px-2 py-3 font-semibold">Brands</th><th className="px-2 py-3 font-semibold w-[28%]">Share</th><th className="px-2 py-3 font-semibold">Middle</th><th className="px-4 py-3 font-semibold">Typical</th>
                  </tr>
                </thead>
                <tbody>
                  {d.payIndex.rows.map((r) => (
                    <tr key={r.kind} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-4 py-3 font-semibold" style={ui.text}>{r.label}</td>
                      <td className="px-2 py-3" style={ui.mid}>{r.brands.toLocaleString()}</td>
                      <td className="px-2 py-3"><div className="flex items-center gap-2"><div className="h-1.5 rounded-full flex-1" style={{ background: 'var(--surface-2)' }}><div className="h-full rounded-full" style={{ width: `${r.share}%`, background: 'var(--accent)' }} /></div><span className="text-[11.5px] w-9 text-right" style={ui.soft}>{r.share}%</span></div></td>
                      <td className="px-2 py-3 font-bold" style={{ ...ui.num, ...ui.text }}>{val(r.median, r.unit)}</td>
                      <td className="px-4 py-3 whitespace-nowrap" style={ui.mid}>{r.p25 != null && r.p75 != null && r.p25 !== r.p75 ? `${val(r.p25, r.unit)} to ${val(r.p75, r.unit)}` : val(r.median, r.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-2xl p-5" style={ui.card}>
              <p className="text-[12.5px] font-semibold" style={ui.mid}>Flat fees per approved video</p>
              <div className="flex items-end gap-2 h-[120px] mt-4">
                {d.payIndex.flatBands.map((b) => {
                  const max = Math.max(1, ...d.payIndex!.flatBands.map((x) => x.n))
                  return (
                    <div key={b.label} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                      <span className="text-[11px] font-bold" style={{ ...ui.num, ...ui.text }}>{b.n.toLocaleString()}</span>
                      <div className="w-full rounded-t-md" style={{ height: `${Math.max(3, (b.n / max) * 100)}%`, background: 'var(--accent)', opacity: 0.35 + 0.65 * (b.n / max) }} />
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-2 mt-2">
                {d.payIndex.flatBands.map((b) => <span key={b.label} className="flex-1 text-[10.5px] text-center leading-tight" style={ui.soft}>{b.label}</span>)}
              </div>
              <p className="text-[11.5px] mt-3" style={ui.soft}>A percent of sales or ad spend pays only when the brand runs your video as an ad. A flat fee pays on approval.</p>
            </div>
          </div>
        </Section>
      )}

      {d && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => go('changes')} className="text-[13px] font-semibold rounded-xl px-3.5 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>Every change, day by day</button>
          <button type="button" onClick={() => go('stars')} className="text-[13px] font-semibold rounded-xl px-3.5 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>Star brands</button>
        </div>
      )}
    </div>
  )
}

function Desk({ icon: Icon, label, value, line, hot, onClick, cta }: { icon: typeof Inbox; label: string; value: string; line: string; hot?: boolean; onClick: () => void; cta: string }) {
  return (
    <button type="button" onClick={onClick} className="text-left rounded-2xl p-4 flex flex-col gap-2 transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-md focus-visible:outline focus-visible:outline-2"
      style={{ ...ui.card, outlineColor: 'var(--accent)', borderColor: hot ? 'rgb(var(--brand-rgb) / 0.45)' : 'var(--border)' }}>
      <span className="flex items-center justify-between">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl" style={{ background: hot ? 'var(--accent)' : 'var(--surface-2)', color: hot ? '#fff' : 'var(--text-2)' }}><Icon size={15} /></span>
        <span className="text-[11.5px] font-semibold" style={{ color: 'var(--accent-text, var(--accent))' }}>{cta}</span>
      </span>
      <span className="text-[28px] font-bold leading-none mt-1" style={{ ...ui.num, ...ui.text }}>{value}</span>
      <span className="text-[12.5px] font-semibold" style={ui.text}>{label}</span>
      <span className="text-[11.5px] leading-snug" style={ui.soft}>{line}</span>
    </button>
  )
}

function Money({ label, value, line }: { label: string; value: string; line: string }) {
  const read = value !== 'Not read'
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-1" style={ui.card}>
      <span className="text-[11.5px] font-semibold" style={ui.mid}>{label}</span>
      <span className="font-bold leading-tight" style={{ ...ui.num, ...ui.text, fontSize: read ? 22 : 15, opacity: read ? 1 : 0.55 }}>{value}</span>
      <span className="text-[11px] leading-snug" style={ui.soft}>{line}</span>
    </div>
  )
}

function Pulse({ label, k, d, good }: { label: string; k: string; d: HomeRead; good?: 'up' | 'down' }) {
  const w = d.totals[k] || { now: 0, before: 0 }
  const diff = w.now - w.before
  const better = good == null || diff === 0 ? null : (good === 'up') === diff > 0
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-1.5" style={ui.card}>
      <span className="text-[11.5px] font-semibold" style={ui.mid}>{label}</span>
      <span className="text-[24px] font-bold leading-none" style={{ ...ui.num, ...ui.text }}>{w.now.toLocaleString()}</span>
      <span className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: better == null ? 'var(--text-3)' : better ? '#059669' : '#DC2626' }}>
        {diff > 0 ? <TrendingUp size={11} /> : diff < 0 ? <TrendingDown size={11} /> : null}
        {diff === 0 ? 'Same as the 7 days before' : `${Math.abs(diff).toLocaleString()} ${diff > 0 ? 'more' : 'fewer'} than the 7 days before`}
      </span>
      <Spark values={d.series[k] || []} width={120} height={26} />
    </div>
  )
}

function Row({ c, right, sub, first }: { c: Card; right: React.ReactNode; sub: string; first: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3" style={{ borderTop: first ? undefined : '1px solid var(--border)' }}>
      <BrandMark name={c.name} website={c.website} size={30} />
      <div className="min-w-0 flex-1">
        <BrandName id={c.brand_id} name={c.name} className="text-[13.5px] font-semibold block truncate" style={ui.text} />
        <span className="text-[11.5px] block truncate" style={ui.soft}>{[c.categories[0], sub].filter(Boolean).join(' · ')}</span>
      </div>
      {right}
    </div>
  )
}

function MoveList({ rows, empty, icon }: { rows: HomeRead['pays']; empty: string; icon: 'up' | 'down' }) {
  if (!rows.length) return <Empty>{empty}</Empty>
  return (
    <div className="rounded-2xl overflow-hidden" style={ui.card}>
      {rows.map((p, i) => (
        <div key={`${p.brand_id}${i}`} className="flex items-start gap-3 px-4 py-3" style={{ borderTop: i ? '1px solid var(--border)' : undefined }}>
          <BrandMark name={p.name} website={p.website} size={30} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <BrandName id={p.brand_id} name={p.name} className="text-[13.5px] font-semibold" style={ui.text} />
              <span className="text-[11px]" style={ui.soft}>{day(p.at)}</span>
            </div>
            <span className="text-[12px] block mt-0.5" style={ui.mid}>
              {icon === 'up' ? <TrendingUp size={12} className="inline -mt-0.5 mr-1" style={{ color: '#10B981' }} /> : <TrendingDown size={12} className="inline -mt-0.5 mr-1" style={{ color: p.dir === 'down' ? '#EF4444' : 'var(--text-3)' }} />}
              {p.delta || `${p.before} to ${p.after}`}
            </span>
            {p.delta && <span className="text-[11px] block mt-0.5 truncate" style={ui.soft}>Now: {p.after}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] rounded-2xl p-4 inline-flex items-start gap-2" style={{ ...ui.card, ...ui.soft }}><Sparkles size={14} className="mt-0.5 shrink-0" />{children}</p>
}
