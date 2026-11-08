'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE DASHBOARD IN THE TEAL POP LOOK (Seb, 2026-11-03: "I like A"; the look is
// behind Labs, lib/look). Seb's three complaints about the old one were that
// it is hard to see what to click, what each feature does, and where to go.
// So, top to bottom:
//
//   1. A dark welcome banner that says how many things need you today, with
//      the two biggest jobs as buttons.
//   2. This month: the plan's allowances as big numbers.
//   3. Needs you: the Today list (lib/today-list) as tiles you press.
//   4. Everything MVP does: every menu row this member can open, by job, each
//      with one line on what it does (lib/feature-lines). The rows come from
//      the menu itself (shell-nav-context), so nothing is listed that the menu
//      would not show.
//
// Every number and every count is read, never assumed: while a list loads it
// says so, a list that fails says it failed, and "nothing needs you" is only
// said when every source was read.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, BadgeDollarSign, ChevronRight, Loader2, Lock, Pin, PinOff, RefreshCw, Sparkles } from 'lucide-react'
import { bannerFor } from '@/lib/banner-art'
import type { TodayItem } from '@/lib/today-list'
import { featureLine } from '@/lib/feature-lines'
import { useShellNav, type ShellNavItem } from '@/components/layout/shell-nav-context'
import { useNavFavorites, MAX_NAV_FAVORITES } from '@/lib/nav-favorites'
import { pickBuckets, type UsageBucket } from '@/lib/usage-highlights'

type Usage = { buckets: UsageBucket[]; resetLabel: string | null; introNote?: string | null }

export interface TealDashboardProps {
  firstName: string
  /** "Tuesday, November 3". */
  today: string
  /** Site, plan, posts this period. */
  meta: string[]
  primary: { href: string; label: string }
  secondary: { href: string; label: string } | null
  /** This plan has the Today list (Pro and admin). */
  hasToday: boolean
  /** Banners and nudges that show only when they have something to say. */
  alerts?: React.ReactNode
  /** The panels that follow: price alerts, campaigns for you, channel stats. */
  below?: React.ReactNode
}

// The tiles in the order the Today list ranks them.
const TONE: Record<TodayItem['tone'], { label: string; ink: string; bg: string; icon: React.ReactNode }> = {
  urgent: { label: 'Fix', ink: 'var(--fix)', bg: 'var(--fix-bg)', icon: <AlertTriangle size={19} /> },
  money: { label: 'Earn', ink: 'var(--earn)', bg: 'var(--earn-bg)', icon: <BadgeDollarSign size={19} /> },
  upkeep: { label: 'Tidy', ink: 'var(--tidy)', bg: 'var(--tidy-bg)', icon: <Sparkles size={19} /> },
}
const FIRST_TILES = 6

const sora = { fontFamily: 'var(--font-sora), var(--font-jakarta), sans-serif' } as const

export default function TealDashboard({ firstName, today, meta, primary, secondary, hasToday, alerts, below }: TealDashboardProps) {
  // ── Today ──
  const [items, setItems] = useState<TodayItem[] | null>(null)
  const [unread, setUnread] = useState<string[]>([])
  const [todayError, setTodayError] = useState<string | null>(null)
  const [todayShut, setTodayShut] = useState(!hasToday)
  const [allTiles, setAllTiles] = useState(false)
  const loadToday = useCallback(async () => {
    if (!hasToday) return
    setTodayError(null); setItems(null)
    try {
      const r = await fetch('/api/today', { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (r.status === 403) { setTodayShut(true); return }
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setItems(Array.isArray(j.items) ? j.items : [])
      setUnread(Array.isArray(j.unread) ? j.unread : [])
    } catch (e) {
      setTodayError(e instanceof Error ? e.message : String(e))
    }
  }, [hasToday])
  useEffect(() => { loadToday() }, [loadToday])

  // ── This month ──
  const [usage, setUsage] = useState<Usage | null>(null)
  const [usageFailed, setUsageFailed] = useState(false)
  useEffect(() => {
    let alive = true
    fetch('/api/usage/summary', { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((d) => { if (alive) { if (d && Array.isArray(d.buckets)) setUsage(d as Usage); else setUsageFailed(true) } })
      .catch(() => { if (alive) setUsageFailed(true) })
    return () => { alive = false }
  }, [])

  const groups = useShellNav()
  // ── PINNED (Seb, 2026-11-07: "on the cards, have a little box that says
  // pin it to the top. And if I pin that card to the top, it becomes a
  // pinned card to the top of the dashboard"). Saved to the account so it
  // follows the member to every device. The one place pins show since the
  // menu's My features was taken out (Seb, 2026-11-08).
  const { favorites, toggle: togglePin, savedTo } = useNavFavorites()
  const [pinNote, setPinNote] = useState<string | null>(null)
  const isPinned = (f: ShellNavItem) => [f.href, ...(f.aliases || [])].some((h) => favorites.includes(h))
  const pin = (f: ShellNavItem) => {
    const { full } = togglePin(f.href, f.aliases || [])
    setPinNote(full ? `You can pin ${MAX_NAV_FAVORITES}. Unpin one to pin ${f.label}.` : null)
  }
  // The pinned cards, in the order they were pinned, each with its section's
  // colour. A pin on a tool this plan no longer opens is not shown.
  const pinned = (() => {
    if (!groups) return []
    const out: Array<ShellNavItem & { color: string; tint: string; section: string }> = []
    for (const h of favorites) {
      for (const g of groups) {
        const f = g.items.find((it) => !it.locked && (it.href === h || (it.aliases || []).includes(h)))
        if (f && !out.some((o) => o.href === f.href)) { out.push({ ...f, color: g.color, tint: g.tint, section: g.label }); break }
      }
    }
    return out
  })()

  // The banner's second line says what the Today list actually found.
  const loadingToday = !todayShut && items === null && !todayError
  const count = items?.length ?? 0
  const headline = todayShut ? 'Here is everything MVP can do for you.'
    : loadingToday ? 'Checking what needs you today…'
      : todayError ? 'Today’s list did not load.'
        : count > 0 ? `${count} ${count === 1 ? 'thing needs' : 'things need'} you today.`
          : unread.length ? 'Nothing found so far today.'
            : 'Nothing needs you today.'

  const tiles = items ? (allTiles ? items : items.slice(0, FIRST_TILES)) : []
  const buckets = usage ? pickBuckets(usage.buckets) : []

  return (
    <div className="flex flex-col gap-7">
      {/* ── 1. Welcome ── */}
      <section
        aria-label="Today"
        className="relative overflow-hidden rounded-[22px] border p-6 sm:p-9 flex flex-wrap items-center gap-6"
        style={{ background: 'var(--hero-bg)', borderColor: 'var(--hero-border)', color: '#fff' }}
      >
        <div className="relative flex-[1_1_360px] min-w-0 flex flex-col gap-3.5">
          <p className="text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: '#5EEAD4' }}>{today}</p>
          <h1 className="text-[30px] sm:text-[40px] xl:text-[46px] font-extrabold leading-[1.06]" style={{ color: '#fff' }}>
            Welcome back, {firstName}.<br />
            <span style={{ color: loadingToday ? '#B7CBCC' : '#fff' }}>{headline}</span>
          </h1>
          {meta.length > 0 && <p className="text-[15px]" style={{ color: '#B7CBCC' }}>{meta.join(' · ')}</p>}
          {todayError && (
            <p className="text-[13.5px]" style={{ color: '#FDBA74' }}>
              {todayError}.{' '}
              <button type="button" onClick={loadToday} className="font-bold underline">Try again</button>
            </p>
          )}
          {!todayError && unread.length > 0 && (
            <p className="text-[13.5px]" style={{ color: '#FDBA74' }}>Could not check {unread.join(', ')}. Anything waiting there is not counted.</p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-2.5">
            <Link
              href={primary.href}
              className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-[15px] font-extrabold transition-colors bg-[#14B8A6] hover:bg-[#2DD4BF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5EEAD4]"
              style={{ color: '#04201D' }}
            >
              {primary.label} <ArrowRight size={16} strokeWidth={2.6} />
            </Link>
            {secondary && (
              <Link
                href={secondary.href}
                className="inline-flex items-center rounded-full border-[1.5px] px-5 py-3 text-[15px] font-bold transition-colors border-[#3D5B5D] hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5EEAD4]"
                style={{ color: '#fff' }}
              >
                {secondary.label}
              </Link>
            )}
          </div>
        </div>
        {/* The Dashboard's picture (lib/banner-art), drawn for this dark card. */}
        <div aria-hidden="true" className="relative hidden md:block flex-[1_1_260px] max-w-[460px] min-h-[220px] self-stretch">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bannerFor('Dashboard') ?? ''} alt="" decoding="async" className="absolute inset-0 m-auto w-full h-full object-contain" />
        </div>
      </section>

      {alerts}

      {/* ── PINNED: the tools this member pinned, first. ── */}
      {groups && groups.length > 0 && (
        <section aria-labelledby="pinned-h" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="pinned-h" className="text-[20px] font-extrabold inline-flex items-center gap-2"><Pin size={18} style={{ color: 'var(--accent-text)' }} /> Pinned</h2>
            <p className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
              {pinned.length ? 'Your tools, first.' : ''}
              {savedTo === 'device' && <span style={{ color: 'var(--hot)' }}>{pinned.length ? ' ' : ''}Saved in this browser only for now, so they will not follow you to another computer yet.</span>}
            </p>
          </div>
          {pinned.length === 0 ? (
            <p className="rounded-[18px] border border-dashed px-5 py-4 text-[14px]" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
              Put the tools you use most right here. Press <Pin size={13} className="inline -mt-0.5" /> <b>Pin</b> on any tool under Everything MVP does below, and it shows at the top of your Dashboard every time you sign in.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {pinned.map((f) => {
                const line = featureLine(f.href)
                return (
                  <div key={f.href} className="relative rounded-[18px] border overflow-hidden transition-shadow hover:shadow-md" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                    <Link href={f.href} className="flex items-start gap-3 px-4 py-4 pr-12 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--accent)]">
                      <span className="shrink-0 w-10 h-10 rounded-xl inline-flex items-center justify-center" style={{ background: f.tint, color: f.color }} aria-hidden="true">{f.icon ?? <Pin size={17} />}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-[15.5px] font-extrabold" style={{ color: 'var(--text)' }}>{f.label}<Badge badge={f.badge} /></span>
                        <span className="block text-[11px] font-bold uppercase tracking-[0.06em] mt-0.5" style={{ color: f.color }}>{f.section}</span>
                        {line && <span className="block text-[13px] leading-snug mt-1" style={{ color: 'var(--text-faint)' }}>{line}</span>}
                      </span>
                    </Link>
                    <button type="button" onClick={() => pin(f)} aria-label={`Unpin ${f.label}`} title="Unpin: it goes back to Everything MVP does below"
                      className="absolute top-3 right-3 w-8 h-8 rounded-lg inline-flex items-center justify-center transition-colors hover:bg-[color:var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]" style={{ color: 'var(--text-dim)' }}>
                      <PinOff size={15} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          {pinNote && <p className="text-[13px] font-semibold" style={{ color: 'var(--hot)' }}>{pinNote}</p>}
        </section>
      )}

      {/* ── 2. This month ── */}
      {(buckets.length > 0 || usageFailed || usage === null) && (
        <section aria-labelledby="month-h" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="month-h" className="text-[20px] font-extrabold">This month</h2>
            <p className="text-[13px] flex items-center gap-3" style={{ color: 'var(--text-faint)' }}>
              {usage?.resetLabel && <span>Resets {usage.resetLabel}</span>}
              <Link href="/usage" className="font-bold hover:underline" style={{ color: 'var(--accent-text)' }}>All your usage →</Link>
            </p>
          </div>
          {usageFailed ? (
            <p className="rounded-[18px] border px-5 py-4 text-[13.5px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-soft)' }}>
              Your usage could not be read just now. <Link href="/usage" className="font-bold underline">Open Plan and usage</Link> to see it.
            </p>
          ) : usage === null ? (
            <div className="h-[92px] rounded-[18px] border motion-safe:animate-pulse" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} aria-busy="true" aria-label="Loading your usage" />
          ) : (
            // One pixel gaps over the border colour draw the dividers, however
            // many allowances the plan has and however they wrap.
            <div className="grid gap-px rounded-[18px] border overflow-hidden" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', borderColor: 'var(--border)', background: 'var(--border)' }}>
              {buckets.map((b) => {
                const ratio = b.limit ? b.used / b.limit : 0
                // Red at the cap, orange near it, teal otherwise.
                const ink = ratio >= 1 ? 'var(--fix)' : ratio >= 0.75 ? 'var(--hot)' : 'var(--accent-text)'
                return (
                  <div key={b.key} className="px-5 py-4" style={{ background: 'var(--bg-sidebar, var(--surface))' }}>
                    <p className="text-[28px] font-extrabold leading-none tabular-nums" style={{ ...sora, color: ink }}>
                      {b.used.toLocaleString()}
                      {b.limit != null && <span className="text-[15px] font-semibold" style={{ color: 'var(--text-faint)' }}> of {b.limit.toLocaleString()}</span>}
                    </p>
                    <p className="mt-1.5 text-[13px]" style={{ color: 'var(--text-faint)' }}>{b.label}{ratio >= 1 ? ', used up' : ''}</p>
                  </div>
                )
              })}
            </div>
          )}
          {usage?.introNote && <p className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}>{usage.introNote}</p>}
        </section>
      )}

      {/* ── 3. Needs you ── */}
      {!todayShut && (
        <section aria-labelledby="needs-h" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="needs-h" className="text-[20px] font-extrabold">Needs you</h2>
              <p className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
                {loadingToday ? 'Checking everything that might need you…' : todayError ? 'The list did not load.' : count ? 'Most important first.' : 'Every source was checked.'}
              </p>
            </div>
            <button
              type="button"
              onClick={loadToday}
              disabled={loadingToday}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-soft)' }}
            >
              {loadingToday ? <Loader2 size={14} className="motion-safe:animate-spin" /> : <RefreshCw size={14} />} Check again
            </button>
          </div>

          {loadingToday && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[150px] rounded-2xl border motion-safe:animate-pulse" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} />
              ))}
            </div>
          )}

          {todayError && (
            <div className="rounded-2xl border px-5 py-4 text-[13.5px] flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <span style={{ color: 'var(--fix)' }}>Today’s list could not load: {todayError}</span>
              <button type="button" onClick={loadToday} className="font-bold hover:underline" style={{ color: 'var(--accent-text)' }}>Try again</button>
            </div>
          )}

          {items && count === 0 && (
            <div className="rounded-2xl border px-5 py-4 text-[14px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-soft)' }}>
              {unread.length
                ? <>Nothing found, but {unread.join(', ')} could not be checked, so something may still be waiting there.</>
                : <>Nothing needs you today. Everything was checked.</>}
            </div>
          )}

          {tiles.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {tiles.map((it, i) => {
                const tone = TONE[it.tone]
                return (
                  <Link
                    key={`${it.kind}-${i}`}
                    href={it.href}
                    className="group flex flex-col gap-2.5 rounded-2xl border-[1.5px] p-[18px] transition-[border-color,box-shadow] hover:border-[color:var(--accent)] hover:shadow-[0_6px_18px_rgb(var(--brand-rgb)/0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: tone.bg, color: tone.ink }}>{tone.icon}</span>
                      <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em]" style={{ background: tone.bg, color: tone.ink }}>{tone.label}</span>
                    </span>
                    <span className="text-[16px] font-extrabold leading-snug">{it.title}</span>
                    <span className="text-[13.5px] leading-snug" style={{ color: 'var(--text-faint)' }}>{it.detail}</span>
                    <span className="mt-auto pt-1 inline-flex items-center gap-1 text-[14px] font-extrabold" style={{ color: 'var(--accent-text)' }}>
                      {it.cta} <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                )
              })}
            </div>
          )}

          {items && count > FIRST_TILES && (
            <button type="button" onClick={() => setAllTiles((v) => !v)} className="self-start text-[13.5px] font-bold hover:underline" style={{ color: 'var(--accent-text)' }}>
              {allTiles ? 'Show fewer' : `Show ${count - FIRST_TILES} more`}
            </button>
          )}
          {items && count > 0 && unread.length > 0 && (
            <p className="text-[12.5px]" style={{ color: 'var(--hot)' }}>Could not check {unread.join(', ')}. Anything waiting there is not shown here.</p>
          )}
        </section>
      )}

      {/* ── 4. Everything MVP does ── */}
      {groups && groups.length > 0 && (
        <section aria-labelledby="all-h" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="all-h" className="text-[20px] font-extrabold">Everything MVP does</h2>
            <p className="text-[13px]" style={{ color: 'var(--text-faint)' }}>Pick a job, then the tool. Each one says what it does. Pin the ones you use most to the top.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 items-start">
            {groups.map((g) => (
              <div key={g.label} className="rounded-[18px] border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="flex items-center gap-2.5 px-4 py-3.5" style={{ background: g.tint }}>
                  <span className="w-3 h-3 rounded-[4px] flex-shrink-0" style={{ background: g.color }} aria-hidden="true" />
                  <h3 className="text-[16px] font-extrabold" style={{ ...sora, color: g.color }}>{g.label}</h3>
                </div>
                <ul>
                  {g.items.map((f) => {
                    const line = featureLine(f.href)
                    const on = isPinned(f)
                    return (
                      <li key={f.href + f.label} className="border-t flex items-stretch" style={{ borderColor: 'var(--border)' }}>
                        <Link href={f.href} className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-2 py-3 transition-colors hover:bg-[color:var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--accent)]">
                          <span className="flex-1 min-w-0">
                            <span className="flex items-center gap-2 text-[14.5px] font-bold" style={{ color: 'var(--text)' }}>
                              {f.label}
                              {f.locked ? <ProChip /> : <Badge badge={f.badge} />}
                            </span>
                            {line && <span className="block text-[13px] leading-snug" style={{ color: 'var(--text-faint)' }}>{line}</span>}
                          </span>
                          <ChevronRight size={16} className="flex-shrink-0" style={{ color: 'var(--text-dim)' }} aria-hidden="true" />
                        </Link>
                        {/* PIN IT TO THE TOP: the one place pins live (the menu has no My
                            features). A Pro tool on a legacy plan is not pinned: it opens Get Pro. */}
                        {!f.locked && <button type="button" onClick={() => pin(f)} aria-pressed={on} aria-label={on ? `Unpin ${f.label}` : `Pin ${f.label} to the top of your Dashboard`}
                          title={on ? 'Pinned to the top of your Dashboard. Press to unpin.' : 'Pin to the top of your Dashboard'}
                          className="shrink-0 w-11 inline-flex items-center justify-center transition-colors hover:bg-[color:var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--accent)]"
                          style={{ color: on ? 'var(--accent-text)' : 'var(--text-dim)' }}>
                          <Pin size={15} fill={on ? 'currentColor' : 'none'} />
                        </button>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {below}
    </div>
  )
}

/** A Pro tool on a legacy plan (lib/pro-locked-nav): a lock and its plan. */
function ProChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-[2px] text-[10px] font-bold uppercase tracking-[0.05em]" style={{ background: 'var(--surface-bright)', color: 'var(--text-soft)' }}>
      <Lock size={10} aria-hidden="true" />Pro
    </span>
  )
}

/** A count is a red pill, "New" is orange, any other word is plain. */
function Badge({ badge }: { badge?: number | string }) {
  if (badge === undefined || badge === '') return null
  if (typeof badge === 'number') {
    if (badge <= 0) return null
    return <span className="rounded-full px-1.5 min-w-[18px] text-center text-[11px] font-bold text-white tabular-nums" style={{ background: '#E5484D' }}>{badge > 99 ? '99+' : badge}</span>
  }
  const isNew = badge === 'New'
  return (
    <span className="rounded-md px-1.5 py-[2px] text-[10px] font-bold uppercase tracking-[0.05em]" style={isNew ? { background: 'var(--new-bg)', color: 'var(--new-text)' } : { background: 'var(--surface-bright)', color: 'var(--text-soft)' }}>
      {badge}
    </span>
  )
}
