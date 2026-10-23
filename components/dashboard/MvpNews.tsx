'use client'

/**
 * WHAT'S NEW IN MVP, ONCE A DAY (Seb, 2026-10-17: "we need to have this pop up
 * for anyone using MVP once a day when they use the tools.. list the new
 * things we offer or have updated from the past 7 days ... with the updates
 * on the left.. and the latest youtube videos on the right.. with the Join
 * Trybe button link (with our affiliate), with the Subscribe button for
 * youtube channel and join MVP's facebook group").
 *
 * One card for all the news, so two never stack:
 *   - the updates of the last 7 days this member's plan has (lib/whats-new);
 *   - on top of them, SCOUT's own news when a release has come in or is
 *     waiting (lib/scout-news decides who sees what, and never tells a Web
 *     Store install to "update now");
 *   - on the right, the MVP Affiliate channel's three latest videos, the
 *     newest ready to play, then Join TRYBE (MVP's referral link), Subscribe
 *     on YouTube and Join the Facebook group.
 *
 * It opens by itself once a day, on the first dashboard page, when there is
 * something new; opening counts as the day's. SCOUT's news keeps it coming
 * back until "Got it" (which records the release as seen); "Later", the X and
 * Escape leave SCOUT's news for the next visit. The What's new pill opens it
 * any time. ?whatsnew (or ?scoutnews) opens it too.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Check, ExternalLink, Facebook, Handshake, Play, Sparkles, Telescope, X, Youtube } from 'lucide-react'
import { getScoutInstallKind } from '@/lib/extension-frame'
import { SCOUT_STORE_LISTING_URL } from '@/lib/scout-version'
import { FACEBOOK_GROUP_URL } from '@/lib/community'
import { recentNews, NEWS_DAYS, localDay, opensToday, newsKey, type WhatsNewItem } from '@/lib/whats-new'
import {
  LATER_KEY, MVP_CHANNEL_URL, MVP_SUBSCRIBE_URL, SCOUT_RELEASES, SEEN_KEY, scoutPopupPlan,
  type ChannelVideo, type PopupPlan, type ScoutRelease,
} from '@/lib/scout-news'

/** MVP's referral link for joining TRYBE. */
export const TRYBE_JOIN_URL = 'https://jointrybe.com/r/HTLEJE47'
/** The day the card last opened by itself, YYYY-MM-DD in the member's time. */
export const DAY_KEY = 'mvp_news_day'
/** The newest entry the card showed (lib/whats-new newsKey). */
export const NEWEST_KEY = 'mvp_news_newest'
/** The What's new pill sends this to open the card. */
export const OPEN_EVENT = 'mvp-news-open'
const FORCE_PARAMS = ['whatsnew', 'scoutnews']

const SCOUT = '#FF9500'
/** SCOUT orange dark enough for white words on it. */
const SCOUT_BUTTON = '#C2410C'
const ACCENT = '#7C3AED'
/** Purple and orange words that stay readable on both themes. */
const LINK = 'text-[#7C3AED] dark:text-[#B9A2FF]'
const EYEBROW = 'text-[#C2410C] dark:text-[#FFB347]'
/** A thumbnail YouTube does not serve leaves the black frame, not a broken image. */
const hideBroken = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }

function localGet(k: string): string | null { try { return window.localStorage.getItem(k) } catch { return null } }
function localSet(k: string, v: string) { try { window.localStorage.setItem(k, v) } catch { /* private mode */ } }
function sessionGet(k: string): string | null { try { return window.sessionStorage.getItem(k) } catch { return null } }
function sessionSet(k: string, v: string) { try { window.sessionStorage.setItem(k, v) } catch { /* this visit only */ } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const otherPopupOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"]:not([data-mvp-news])')

type Res = { releases?: ScoutRelease[]; videos?: ChannelVideo[]; videoError?: string | null } | null

export default function MvpNews({ tier }: { tier: string }) {
  const updates = useMemo(() => recentNews(tier), [tier])
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<PopupPlan | null>(null)
  const [installed, setInstalled] = useState<string | null>(null)
  const [videos, setVideos] = useState<ChannelVideo[]>([])
  const [videoError, setVideoError] = useState<string | null>(null)
  const [pick, setPick] = useState(0)
  const [playing, setPlaying] = useState(false)

  // Videos and SCOUT's releases for this plan, read once per page.
  const load = useCallback(async (): Promise<Res> => {
    const res: Res = await fetch('/api/scout/whats-new').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    const list = (res?.videos || []) as ChannelVideo[]
    setVideos(list)
    setVideoError(list.length ? null : (res?.videoError || 'No videos came back.'))
    setPick(0)
    return res
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      await sleep(1200)
      const ua = navigator.userAgent
      const desktop = !/Android|iPhone|iPad|iPod|Mobile/i.test(ua) && /Chrome\/|Chromium\/|Edg\//.test(ua)
      const params = new URLSearchParams(window.location.search)
      const force = FORCE_PARAMS.some((p) => params.has(p))
      const found = await getScoutInstallKind().catch(() => ({ kind: 'none' as const, version: null }))
      const base = { kind: found.kind, installed: found.version, seen: localGet(SEEN_KEY), later: sessionGet(LATER_KEY), desktop, force: params.has('scoutnews') }
      const scoutMaybe = !!scoutPopupPlan({ ...base, later: null, releases: SCOUT_RELEASES })
      const today = localDay()
      // AN ENTRY THEY HAVE NOT SEEN opens it again the same day. Nothing was
      // kept before 2026-10-23, so on that day everyone sees the card once
      // more, which is the point: Instagram Auto-DM is for all of them.
      const newest = newsKey(updates)
      const newestSeen = localGet(NEWEST_KEY)
      const unseen = !!newest && newestSeen !== newest
      if (!opensToday({ today, shownDay: localGet(DAY_KEY), updates: updates.length, scout: scoutMaybe, force, newest, newestSeen })) return
      const res = await load()
      if (!alive) return
      const p = res ? scoutPopupPlan({ ...base, releases: (res.releases || []) as ScoutRelease[] }) : null
      // Nothing for this plan after all: SCOUT news filtered out and no updates.
      if (!p && !updates.length && !force) return
      if (!p && !force && !unseen && localGet(DAY_KEY) === today) return
      for (let i = 0; i < 80 && otherPopupOpen(); i++) { await sleep(1500); if (!alive) return }
      if (!alive || otherPopupOpen()) return
      setInstalled(found.version)
      setPlan(p)
      setOpen(true)
      // Counted as today's opening as soon as it is on screen.
      localSet(DAY_KEY, today)
      if (newest) localSet(NEWEST_KEY, newest)
    })()
    return () => { alive = false }
  }, [load, updates])

  // The What's new pill opens it any time, with SCOUT news if there is any.
  useEffect(() => {
    const onOpen = () => {
      void (async () => {
        if (!videos.length) await load()
        setPlaying(false)
        setOpen(true)
      })()
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [load, videos.length])

  const later = () => {
    if (plan) sessionSet(LATER_KEY, plan.seenTo)
    setOpen(false)
  }
  const gotIt = () => {
    localSet(DAY_KEY, localDay())
    if (plan) { localSet(SEEN_KEY, plan.seenTo); setPlan(null) }
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') later() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const video = videos.length ? videos[pick % videos.length] : null
  const choose = (i: number) => { setPick(i); setPlaying(true) }
  const when = (iso: string | null) => {
    const t = iso ? Date.parse(iso) : NaN
    return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null
  }
  const dayOf = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  const scoutWords = useMemo(() => {
    if (!plan) return null
    if (plan.mode === 'updated') return { title: `New in SCOUT ${plan.version}`, sub: `Chrome updated SCOUT to ${plan.version}.` }
    if (plan.mode === 'move') return { title: `New in SCOUT ${plan.version}`, sub: `Your SCOUT${installed ? ` (${installed})` : ''} is an old manual copy that Chrome cannot update. Add SCOUT from the Chrome Web Store to get these, then remove the old copy on Chrome’s Extensions page.` }
    return { title: `New in SCOUT ${plan.version}`, sub: 'SCOUT is MVP’s Chrome extension. Add it from the Chrome Web Store to use these; Chrome keeps it up to date by itself.' }
  }, [plan, installed])

  if (!open) return null

  const count = updates.length
  const sub = count
    ? `${count} update${count === 1 ? '' : 's'} from the last ${NEWS_DAYS} days. Tap any to open it.`
    : `Nothing new in the last ${NEWS_DAYS} days.`

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-start sm:items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mvp-news-title"
      data-mvp-news=""
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={later} />
      <div
        className="relative w-full max-w-xl md:max-w-5xl max-h-[92vh] overflow-y-auto rounded-2xl border shadow-2xl bg-white dark:bg-[#141418]"
        style={{ borderColor: 'rgba(124,58,237,0.30)' }}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm" style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #bc1888 100%)' }}>
            <Sparkles size={18} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="mvp-news-title" className="text-[17px] font-bold leading-snug" style={{ color: 'var(--text)' }}>What&apos;s new in MVP</h3>
            <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>{sub}</p>
          </div>
          <button onClick={later} className="w-8 h-8 -mr-1 rounded-lg flex items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-white/10" style={{ color: 'var(--text-3)' }} aria-label="Close for now">
            <X size={17} />
          </button>
        </div>

        {/* Side by side from tablet width up; the list scrolls on its own
            so the videos stay in view. One column on a phone. */}
        <div className="grid gap-5 px-5 md:grid-cols-[1.05fr_1fr] md:items-start">
          <div className="md:max-h-[64vh] md:overflow-y-auto md:pr-1 flex flex-col gap-2">
            {plan && scoutWords && (
              <div className="rounded-xl border p-3" style={{ borderColor: 'rgba(255,149,0,0.40)', background: 'rgba(255,149,0,0.06)' }}>
                {/* GET SCOUT, ALWAYS, at the top of the box (Seb, 2026-10-19:
                    "we also need a get scout button on the top left of this
                    window inside the orangey box"). It was only at the bottom,
                    and only when SCOUT was missing or an old copy, so a member
                    whose Chrome had just updated it had no way to the store,
                    say for another computer. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${SCOUT} 0%, #E8590C 100%)` }}><Telescope size={13} className="text-white" /></span>
                  <p className={`text-[12px] font-bold uppercase tracking-wider ${EYEBROW}`}>{scoutWords.title}</p>
                  <a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer" onClick={gotIt} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white" style={{ background: SCOUT_BUTTON }}>
                    Get SCOUT <ExternalLink size={12} />
                  </a>
                </div>
                <p className="text-[12px] mt-1" style={{ color: 'var(--text-2)' }}>{scoutWords.sub}</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {plan.notes.map((n, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--text)' }}>
                      <Check size={13} className="mt-1 flex-shrink-0" style={{ color: '#16A34A' }} />
                      <span>{n.text}{n.href && <> <Link href={n.href} onClick={gotIt} className={`font-semibold whitespace-nowrap hover:underline ${LINK}`}>Open</Link></>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {updates.map((u: WhatsNewItem, i) => {
              const inner = (
                <div className="rounded-xl border px-3 py-2.5 bg-black/[0.015] dark:bg-white/[0.035] transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.06]" style={{ borderColor: `${u.tone}33` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ color: u.tone, backgroundColor: `${u.tone}1f` }}>{u.badge}</span>
                    <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>{dayOf(u.date)}</span>
                  </div>
                  <p className="text-[13px] font-semibold leading-snug" style={{ color: 'var(--text)' }}>{u.title}</p>
                  <p className="text-[12px] mt-0.5 leading-relaxed line-clamp-3" style={{ color: 'var(--text-2)' }}>{u.desc}</p>
                </div>
              )
              return u.href
                ? u.href.startsWith('/freeguide')
                  ? <a key={i} href={u.href} onClick={gotIt} className="block">{inner}</a>
                  : <Link key={i} href={u.href} onClick={gotIt} className="block">{inner}</Link>
                : <div key={i}>{inner}</div>
            })}
            {!updates.length && !plan && (
              <p className="text-[12.5px] rounded-xl border px-3 py-3" style={{ borderColor: 'var(--border-2)', color: 'var(--text-2)' }}>Nothing new for your plan in the last {NEWS_DAYS} days. The videos on the right show what MVP does.</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Latest from MVP Affiliate</p>
              <a href={MVP_CHANNEL_URL} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 text-[11px] font-semibold hover:underline ${LINK}`}>
                All videos <ExternalLink size={11} />
              </a>
            </div>
            {video ? (
              <>
                <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: '16 / 9' }}>
                  {playing ? (
                    <iframe
                      key={video.id}
                      src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&playsinline=1`}
                      title={video.title || 'MVP Affiliate video'}
                      className="absolute inset-0 w-full h-full"
                      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  ) : (
                    <button onClick={() => setPlaying(true)} className="group absolute inset-0 w-full h-full" aria-label={`Play: ${video.title}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" onError={hideBroken} className="absolute inset-0 w-full h-full object-cover" />
                      <span className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors" />
                      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform group-hover:scale-105" style={{ background: '#FF0000' }}>
                        <Play size={22} className="text-white ml-0.5" fill="white" />
                      </span>
                    </button>
                  )}
                </div>
                <p className="text-[12px] mt-1.5 font-medium line-clamp-2" style={{ color: 'var(--text)' }}>{video.title}</p>
                {videos.length > 1 && (
                  <div className="grid grid-cols-3 gap-2 mt-2.5">
                    {videos.map((v, i) => (
                      <button
                        key={v.id}
                        onClick={() => choose(i)}
                        aria-pressed={i === pick}
                        aria-label={`Play: ${v.title}`}
                        className="text-left rounded-lg p-1 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/5 focus-visible:outline focus-visible:outline-2"
                        style={i === pick ? { boxShadow: `inset 0 0 0 2px ${ACCENT}` } : undefined}
                      >
                        <span className="relative block w-full overflow-hidden rounded-md bg-black" style={{ aspectRatio: '16 / 9' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" onError={hideBroken} className="absolute inset-0 w-full h-full object-cover" />
                          {i === pick && playing && <span className="absolute left-1 bottom-1 rounded px-1 py-px text-[9px] font-bold text-white" style={{ background: ACCENT }}>Playing</span>}
                        </span>
                        <span className="block mt-1 text-[10.5px] leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>{v.title}</span>
                        {when(v.published) && <span className="block text-[10px]" style={{ color: 'var(--text-3)' }}>{when(v.published)}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-xl border px-3 py-3 text-[12px]" style={{ borderColor: 'var(--border-2)', color: 'var(--text-2)' }} title={videoError || undefined}>
                The videos could not load right now.{' '}
                <a href={MVP_CHANNEL_URL} target="_blank" rel="noopener noreferrer" className={`font-semibold hover:underline ${LINK}`}>Open the MVP Affiliate channel</a>
              </div>
            )}
            <a href={TRYBE_JOIN_URL} target="_blank" rel="sponsored noopener noreferrer" className="mt-3 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90" style={{ background: ACCENT }}>
              <Handshake size={15} className="flex-shrink-0" /> Join TRYBE free: get paid to make brand videos <ExternalLink size={12} className="flex-shrink-0" />
            </a>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <a href={MVP_SUBSCRIBE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[12px] leading-tight text-center font-semibold transition-colors bg-[#FF0000]/[0.06] hover:bg-[#FF0000]/[0.12] border-[#FF0000]/25 text-[#CC0000] dark:text-[#FF7A7A]">
                <Youtube size={15} className="flex-shrink-0" /> Subscribe on YouTube
              </a>
              <a href={FACEBOOK_GROUP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[12px] leading-tight text-center font-semibold transition-colors bg-[#0866FF]/[0.06] hover:bg-[#0866FF]/[0.12] border-[#0866FF]/25 text-[#0866FF] dark:text-[#7FB0FF]">
                <Facebook size={15} className="flex-shrink-0" /> Join the Facebook group
              </a>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 mt-1">
          <button onClick={later} className="px-3 py-2 rounded-lg text-[13px] font-medium hover:bg-black/[0.04] dark:hover:bg-white/5" style={{ color: 'var(--text-2)' }}>Later</button>
          <button onClick={gotIt} className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white" style={{ background: ACCENT }}>Got it</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
