'use client'

/**
 * THE SCOUT NEWS CARD (Seb, 2026-10-17). Pops up once per SCOUT release with
 * news: the version, a line per new feature this member's plan has, and the
 * MVP Affiliate channel's three latest videos, the newest ready to play right
 * in the card and the other two a click away. Who sees what, and why a Web
 * Store install is never told to
 * "update now", is in lib/scout-news.ts.
 *
 * It waits for any other popup (What's new, an announcement) to close first,
 * so two never stack. Under the videos: Subscribe on YouTube and Join the
 * Facebook group, each in a new tab, leaving the card open.
 * "Got it" puts it away until the next release; "Later",
 * the X, Escape and a click outside put it away until the next visit.
 * ?scoutnews on any MVP page opens it again.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Check, ExternalLink, Facebook, Play, Telescope, X, Youtube } from 'lucide-react'
import { getScoutInstallKind } from '@/lib/extension-frame'
import { SCOUT_STORE_LISTING_URL } from '@/lib/scout-version'
import { FACEBOOK_GROUP_URL } from '@/lib/community'
import {
  FORCE_PARAM, LATER_KEY, MVP_CHANNEL_URL, MVP_SUBSCRIBE_URL, SCOUT_RELEASES, SEEN_KEY, scoutPopupPlan,
  type ChannelVideo, type PopupPlan, type ScoutRelease,
} from '@/lib/scout-news'

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
const otherPopupOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"]:not([data-scout-news])')

export default function ScoutNewsPopup() {
  const [plan, setPlan] = useState<PopupPlan | null>(null)
  const [installed, setInstalled] = useState<string | null>(null)
  const [videos, setVideos] = useState<ChannelVideo[]>([])
  const [videoError, setVideoError] = useState<string | null>(null)
  const [pick, setPick] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      await sleep(1200)
      const ua = navigator.userAgent
      const desktop = !/Android|iPhone|iPad|iPod|Mobile/i.test(ua) && /Chrome\/|Chromium\/|Edg\//.test(ua)
      const force = new URLSearchParams(window.location.search).has(FORCE_PARAM)
      const found = await getScoutInstallKind().catch(() => ({ kind: 'none' as const, version: null }))
      const base = { kind: found.kind, installed: found.version, seen: localGet(SEEN_KEY), later: sessionGet(LATER_KEY), desktop, force }
      // Nothing unseen even before the plan check: no request at all.
      if (!scoutPopupPlan({ ...base, later: null, releases: SCOUT_RELEASES })) return
      const res = await fetch('/api/scout/whats-new').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      if (!alive || !res) return
      const p = scoutPopupPlan({ ...base, releases: (res.releases || []) as ScoutRelease[] })
      if (!p) return
      const list = (res.videos || []) as ChannelVideo[]
      // Wait for any other popup to close, for up to two minutes.
      for (let i = 0; i < 80 && otherPopupOpen(); i++) { await sleep(1500); if (!alive) return }
      if (!alive || otherPopupOpen()) return
      setInstalled(found.version)
      setVideos(list)
      setVideoError(list.length ? null : (res.videoError || 'No videos came back.'))
      setPick(0)
      setPlan(p)
    })()
    return () => { alive = false }
  }, [])

  const later = () => { if (plan) sessionSet(LATER_KEY, plan.seenTo); setPlan(null) }
  const gotIt = () => { if (plan) localSet(SEEN_KEY, plan.seenTo); setPlan(null) }

  useEffect(() => {
    if (!plan) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') later() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan])

  const video = videos.length ? videos[pick % videos.length] : null
  const choose = (i: number) => { setPick(i); setPlaying(true) }
  const when = (iso: string | null) => {
    const t = iso ? Date.parse(iso) : NaN
    return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null
  }

  const words = useMemo(() => {
    if (!plan) return null
    if (plan.mode === 'updated') return {
      title: 'What’s new in SCOUT',
      sub: `Chrome updated SCOUT to ${plan.version}. Here is what it does now.`,
    }
    if (plan.mode === 'move') return {
      title: `New in SCOUT ${plan.version}`,
      sub: `Your SCOUT${installed ? ` (${installed})` : ''} is an old manual copy that Chrome cannot update. Add SCOUT from the Chrome Web Store to get these, then remove the old copy on Chrome’s Extensions page.`,
    }
    return {
      title: `New in SCOUT ${plan.version}`,
      sub: 'SCOUT is MVP’s Chrome extension. Add it from the Chrome Web Store to use these; Chrome keeps it up to date by itself.',
    }
  }, [plan, installed])

  if (!plan || !words) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-start sm:items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scout-news-title"
      data-scout-news=""
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={later} />
      <div
        className="relative w-full max-w-xl md:max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl border shadow-2xl bg-white dark:bg-[#141418]"
        style={{ borderColor: 'rgba(255,149,0,0.35)' }}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm" style={{ background: `linear-gradient(135deg, ${SCOUT} 0%, #E8590C 100%)` }}>
            <Telescope size={18} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-[10px] font-bold uppercase tracking-wider ${EYEBROW}`}>SCOUT {plan.version}</p>
            <h3 id="scout-news-title" className="text-[17px] font-bold leading-snug" style={{ color: 'var(--text)' }}>{words.title}</h3>
            <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>{words.sub}</p>
          </div>
          <button onClick={later} className="w-8 h-8 -mr-1 rounded-lg flex items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-white/10" style={{ color: 'var(--text-3)' }} aria-label="Close for now">
            <X size={17} />
          </button>
        </div>

        {/* Side by side from tablet width up, so the video is in view
            without scrolling; one column on a phone. */}
        <div className="grid gap-4 px-5 md:grid-cols-2 md:items-start">
        <ul className="flex flex-col gap-2">
          {plan.notes.map((n, i) => (
            <li key={i} className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5 bg-black/[0.015] dark:bg-white/[0.035]" style={{ borderColor: 'var(--border-2)' }}>
              <Check size={14} className="mt-0.5 flex-shrink-0" style={{ color: '#16A34A' }} />
              <p className="flex-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--text)' }}>
                {n.text}
                {n.href && (
                  <> <Link href={n.href} onClick={gotIt} className={`font-semibold whitespace-nowrap hover:underline ${LINK}`}>Open</Link></>
                )}
              </p>
            </li>
          ))}
        </ul>

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
          <div className="grid grid-cols-2 gap-2 mt-3">
            <a href={MVP_SUBSCRIBE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[12px] leading-tight text-center font-semibold transition-colors bg-[#FF0000]/[0.06] hover:bg-[#FF0000]/[0.12] border-[#FF0000]/25 text-[#CC0000] dark:text-[#FF7A7A]">
              <Youtube size={15} className="flex-shrink-0" /> Subscribe on YouTube
            </a>
            <a href={FACEBOOK_GROUP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[12px] leading-tight text-center font-semibold transition-colors bg-[#0866FF]/[0.06] hover:bg-[#0866FF]/[0.12] border-[#0866FF]/25 text-[#0866FF] dark:text-[#7FB0FF]">
              <Facebook size={15} className="flex-shrink-0" /> Join the Facebook group
            </a>
          </div>
        </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 mt-2">
          {plan.mode === 'updated' ? (
            <button onClick={gotIt} className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white" style={{ background: ACCENT }}>Got it</button>
          ) : (
            <>
              <button onClick={later} className="px-3 py-2 rounded-lg text-[13px] font-medium hover:bg-black/[0.04] dark:hover:bg-white/5" style={{ color: 'var(--text-2)' }}>Later</button>
              <a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer" onClick={gotIt} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white" style={{ background: SCOUT_BUTTON }}>
                {plan.mode === 'get' ? 'Get SCOUT' : 'Add SCOUT from the Chrome Web Store'} <ExternalLink size={13} />
              </a>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
