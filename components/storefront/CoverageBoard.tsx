// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The whole international Amazon feature, on one page.
//
// There were three surfaces doing this job: a Launchpad stepper for a new file,
// a Storefront Sync page for one master video, and a Back Catalogue that
// scanned the channel. All three ended in the same sync jobs, and each had its
// own idea of what the unit of work was, so a creator had to know which door to
// use before they could ask the only question they actually have.
//
// THREE SECTIONS, IN THE ORDER THE WORK HAPPENS.
//
//   COUNTRIES  which stores you want, and whether you can reach them. Ticking
//              is your decision; signed in is a fact only your own browser can
//              establish, so SCOUT checks and this shows what it found.
//   COVERAGE   how much of your catalogue is earning in each one, and what the
//              rest is waiting on. No runs. Every video has a row in every
//              ticked country, permanently, and the background worker keeps
//              moving them without anyone opening this page.
//   UPLOAD     the only part that needs you. Everything else is server side.
//
// UPLOADED IS NOT LIVE, and the board keeps them apart. Uploaded means SCOUT
// finished; live means the video was afterwards found on the storefront.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Globe, Check, Upload, LogIn, RefreshCw } from 'lucide-react'
import {
  requestStorefrontPreflight, requestStorefrontLogin, requestStorefrontDelivery,
} from '@/lib/extension-frame'

interface MarketRow {
  domain: string; code: string; country: string; langName: string | null
  needsTranslation: boolean; enabled: boolean
  signin: string; signinLabel: string; signinDetail: string | null
  deliverable: boolean
}
interface Reason { reason: string; count: number }
interface Coverage {
  domain: string; country: string; langName: string | null
  signin: string; signinLabel: string; deliverable: boolean
  live: number; uploaded: number; ready: number; preparing: number; blocked: number
  /** Waiting on the product check, which runs before anything is translated or
   *  dubbed. Shown apart from `preparing` so a check that has stopped running
   *  cannot sit here reading as steady progress. */
  checking: number
  blockedReasons: Reason[]
}
interface ReadyItem { id: string; videoId: string; domain: string; country: string; title: string; thumbnail: string | null }
interface Board {
  ok: boolean
  headline?: { videos: number; earningAbroad: number }
  markets?: Coverage[]
  ready?: { total: number; unreachable: number; items: ReadyItem[] }
  error?: string
  detail?: string | null
}

const muted = { color: 'var(--muted)' }
const text = { color: 'var(--text)' }

export default function CoverageBoard() {
  const [markets, setMarkets] = useState<MarketRow[] | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [checking, setChecking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busyDomain, setBusyDomain] = useState<string | null>(null)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadMarkets = useCallback(async () => {
    try {
      const r = await fetch('/api/coverage/markets')
      const j = await r.json()
      if (j?.markets) setMarkets(j.markets)
    } catch { /* the board below still renders; the next load lands */ }
  }, [])

  const loadBoard = useCallback(async () => {
    try {
      const r = await fetch('/api/coverage')
      setBoard(await r.json())
    } catch { /* a dropped poll is not worth a toast */ }
  }, [])

  // THE DRAIN RUNS WHETHER OR NOT THIS IS OPEN, so the page is a window onto
  // it rather than the thing doing the work. Polling keeps the window honest.
  useEffect(() => {
    void loadMarkets(); void loadBoard()
    poll.current = setInterval(() => { void loadBoard() }, 10_000)
    return () => { if (poll.current) clearInterval(poll.current) }
  }, [loadMarkets, loadBoard])

  async function toggle(domain: string, enabled: boolean) {
    setBusyDomain(domain)
    try {
      const r = await fetch('/api/coverage/markets', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain, enabled }),
      })
      const j = await r.json()
      if (!r.ok || !j?.ok) { toast.error(j?.error || 'Could not save that.', { duration: 8000 }); return }
      await loadMarkets(); await loadBoard()
      toast.success(enabled
        ? 'Added. Your catalogue joins that store over the next few minutes.'
        : 'Removed. Nothing already done is thrown away, so you can add it back any time.')
    } finally { setBusyDomain(null) }
  }

  /** SCOUT checks every ticked store from the creator's own browser. Only it
   *  can: a server has no session on amazon.de and would be guessing. */
  async function checkSignIn() {
    const ticked = (markets ?? []).filter((m) => m.enabled).map((m) => m.domain)
    if (ticked.length === 0) { toast.error('Tick a country first.'); return }
    setChecking(true)
    try {
      const res = await requestStorefrontPreflight(ticked)
      if (!res?.ok || !Array.isArray(res.results)) {
        toast.error(res?.error || 'SCOUT did not answer. Is the extension installed?', { duration: 10000 })
        return
      }
      await fetch('/api/coverage/markets', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signin: res.results.map((x) => ({ domain: x.domain, status: x.status })) }),
      })
      await loadMarkets(); await loadBoard()
      const ready = res.results.filter((x) => x.status === 'ready').length
      toast.success(`Signed in on ${ready} of ${res.results.length}.`)
    } catch {
      toast.error('Could not reach SCOUT.', { duration: 8000 })
    } finally { setChecking(false) }
  }

  async function signIn(domain: string) {
    setBusyDomain(domain)
    try {
      const r = await requestStorefrontLogin(domain)
      if (!r?.ok) toast.error(r?.error || 'Could not open that store.', { duration: 8000 })
      else toast.success('Sign in on the tab SCOUT opened, then press Check sign-in again.', { duration: 10000 })
    } finally { setBusyDomain(null) }
  }

  /** Hand everything prepared to SCOUT. The queue it reads is the same one a
   *  single video's sync fills, so there is no second delivery path. */
  async function uploadReady() {
    setUploading(true)
    try {
      const q = await fetch('/api/global-sync/deliver/queue')
      const j = await q.json()
      const all = Array.isArray(j?.items) ? j.items : []

      // A MARKET THAT WANTED A DUB AND HAS NOT GOT ONE IS NOT UPLOADED.
      //
      // The queue serves the master render when a target has no dubbed file,
      // which is right for the English stores and right for a creator who
      // deliberately chose to skip the dub on one video. It is wrong here:
      // nothing in the catalogue grid ever skips a dub on purpose, so a master
      // fallback in this list is a dub that has not finished. Uploading it
      // would put English audio on amazon.fr under a French title, which is
      // invisible from every angle except a French shopper pressing play.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = all.filter((i: any) => !i?.audioIsMasterFallback)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const waiting = all.filter((i: any) => i?.audioIsMasterFallback)

      if (items.length === 0) {
        toast.error(waiting.length > 0
          // SAID, not silently dropped. "Nothing is prepared" would be a lie
          // about work that is genuinely under way.
          ? `${waiting.length} ${waiting.length === 1 ? 'listing is' : 'listings are'} still waiting on their translated audio. They go up as soon as the voiceover is done.`
          : 'Nothing is prepared yet. The background worker fills this as it goes.',
          { duration: 8000 })
        return
      }
      if (waiting.length > 0) {
        toast(`${waiting.length} held back until their translated audio is ready.`, { duration: 7000 })
      }
      const res = await requestStorefrontDelivery(items)
      if (!res?.ok) {
        toast.error(res?.error || 'SCOUT could not upload.', { duration: 12000 })
        return
      }
      await loadBoard()
      toast.success('Uploaded. The board updates as each one is confirmed.')
    } catch {
      toast.error('Could not reach SCOUT.', { duration: 8000 })
    } finally { setUploading(false) }
  }

  const head = board?.headline
  const ticked = (markets ?? []).filter((m) => m.enabled)
  const unreachable = ticked.filter((m) => !m.deliverable)

  return (
    <div className="max-w-4xl">
      {board?.error && (
        <p className="mb-5 text-[13px]" style={{ color: '#dc2626' }}>
          {board.error}{board.detail ? ` (${board.detail})` : ''}
        </p>
      )}

      {/* ── 1. COUNTRIES ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-[15px] font-semibold" style={text}>Countries you sell in</h2>
          <button
            type="button" onClick={() => void checkSignIn()} disabled={checking || ticked.length === 0}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium disabled:opacity-50"
            style={{ color: '#0EA5A4' }}
          >
            {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Check sign-in
          </button>
        </div>
        <p className="mt-1 text-[12.5px]" style={muted}>
          Tick a store and your whole catalogue starts working towards it in the background.
          Uploading needs you signed in to that country&rsquo;s Creator account, which only your own
          browser can confirm, so SCOUT checks and reports back.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {(markets ?? []).map((m) => (
            <div key={m.domain} className="rounded-xl border p-3 flex items-center justify-between gap-3"
              style={{ borderColor: m.enabled ? '#7C3AED55' : 'var(--border)', background: m.enabled ? 'rgba(124,58,237,0.05)' : 'transparent' }}>
              <label className="flex items-center gap-2.5 cursor-pointer min-w-0">
                <input
                  type="checkbox" checked={m.enabled} disabled={busyDomain === m.domain}
                  onChange={(e) => void toggle(m.domain, e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="text-[13.5px] font-medium block truncate" style={text}>
                    {m.country} <span style={muted}>{m.langName}</span>
                  </span>
                  {/* THE FACT, not the tick. These are different things and a
                      screen that merges them promises listings in a country the
                      creator cannot reach. */}
                  <span className="text-[11.5px]" style={
                    m.signin === 'ready' ? { color: '#10B981' }
                      : m.signin === 'unknown' ? muted
                      : { color: '#d97706' }
                  }>
                    {m.enabled ? m.signinLabel : 'Not selected'}
                  </span>
                </span>
              </label>
              {m.enabled && m.signin !== 'ready' && (
                <button
                  type="button" onClick={() => void signIn(m.domain)} disabled={busyDomain === m.domain}
                  className="inline-flex items-center gap-1 text-[12px] font-medium whitespace-nowrap disabled:opacity-50"
                  style={{ color: '#0EA5A4' }}
                >
                  <LogIn size={12} /> Sign in
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── 2. COVERAGE ──────────────────────────────────────────────────── */}
      {head && (
        <section className="mt-5 rounded-2xl border p-5" style={{ borderColor: 'var(--border)' }}>
          {/* THE NUMBER THIS FEATURE EXISTS TO MOVE. Not how many were scanned,
              not a percentage: how many of your videos earn somewhere else. */}
          <p className="text-[15px] font-semibold" style={text}>
            {head.earningAbroad} of {head.videos} videos are earning outside your home store
          </p>
          {ticked.length === 0 && (
            <p className="mt-1.5 text-[12.5px]" style={{ color: '#d97706' }}>
              Tick a country above and MVP starts working through your catalogue for it.
            </p>
          )}

          <div className="mt-4 flex flex-col gap-2">
            {(board?.markets ?? []).map((m) => (
              <div key={m.domain} className="rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <p className="text-[13.5px] font-semibold" style={text}>{m.country}</p>
                  <p className="text-[12.5px]" style={m.deliverable ? { color: '#10B981' } : { color: '#d97706' }}>
                    {m.signinLabel}
                  </p>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" style={muted}>
                  {/* Live and uploaded are shown apart, always. One is confirmed
                      on the storefront and the other is only what SCOUT did. */}
                  {m.live > 0 && <span><strong style={{ color: '#10B981' }}>{m.live}</strong> live</span>}
                  {m.uploaded > 0 && <span><strong style={{ color: '#0EA5A4' }}>{m.uploaded}</strong> uploaded</span>}
                  {m.ready > 0 && <span><strong style={{ color: '#7C3AED' }}>{m.ready}</strong> ready to upload</span>}
                  {/* Named as its own step. These have not been translated or
                      dubbed yet: we are still checking whether Amazon sells the
                      product in this country at all, which is what stops a dub
                      being rendered for a listing that cannot exist. */}
                  {m.checking > 0 && <span>{m.checking} checking the product</span>}
                  {m.preparing > 0 && <span>{m.preparing} being prepared</span>}
                  {m.blocked > 0 && <span>{m.blocked} cannot go</span>}
                </div>
                {m.blockedReasons.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-0.5">
                    {m.blockedReasons.slice(0, 4).map((b) => (
                      <li key={b.reason} className="text-[12px]" style={muted}>
                        <strong style={text}>{b.count}</strong> · {b.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 3. UPLOAD ────────────────────────────────────────────────────── */}
      {board?.ready && (board.ready.total > 0 || board.ready.unreachable > 0) && (
        <section className="mt-5 rounded-2xl border p-5" style={{ borderColor: '#7C3AED' }}>
          <h2 className="text-[15px] font-semibold" style={text}>
            {board.ready.total} listings ready to go up
          </h2>
          <p className="mt-1 text-[12.5px]" style={muted}>
            Everything else runs on our side. This last step goes through your own Amazon Creator
            account in this browser, so it needs SCOUT running and this tab open.
          </p>

          {/* COUNTED APART, because a queue that looks busy while nothing can
              move is the worst kind of progress. */}
          {board.ready.unreachable > 0 && (
            <p className="mt-2 text-[12.5px]" style={{ color: '#d97706' }}>
              Another {board.ready.unreachable} are prepared for countries you are not signed in to.
              Sign in above and they join the queue.
            </p>
          )}

          {board.ready.total > 0 && (
            <button
              type="button" onClick={() => void uploadReady()} disabled={uploading}
              className="mt-4 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
              style={{ background: '#7C3AED' }}
            >
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              Upload them now
            </button>
          )}

          {board.ready.items.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-[0.08em]" style={muted}>
                What goes up next
              </summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {board.ready.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-2.5">
                    {i.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.thumbnail} alt="" className="rounded object-cover flex-shrink-0" style={{ width: 56, height: 32 }} />
                    )}
                    <span className="text-[12.5px] truncate" style={text}>{i.title}</span>
                    <span className="text-[12px] whitespace-nowrap" style={muted}>{i.country}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {!board && (
        <p className="mt-5 text-[12.5px] inline-flex items-center gap-2" style={muted}>
          <Loader2 size={13} className="animate-spin" /> Reading your coverage…
        </p>
      )}

      {board && head && ticked.length > 0 && (board.ready?.total ?? 0) === 0 && unreachable.length === 0 && (
        <p className="mt-5 text-[12.5px] inline-flex items-center gap-2" style={muted}>
          <Globe size={13} /> Nothing is waiting on you. MVP keeps working through your catalogue in
          the background and this fills up on its own.
        </p>
      )}
    </div>
  )
}
