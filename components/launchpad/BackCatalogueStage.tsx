// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BackCatalogueStage — the channel you already have, one card per video, a pill
// per Amazon storefront it could go to.
//
// The other half of Video Launchpad. The stepper starts from a file that is not
// on YouTube yet; this starts from the channel that exists, where YouTube has
// quietly dubbed part of the catalogue into other languages. One creator: 197 of
// 525 videos already carry a German track, which is 197 amazon.de listings
// available at no dub cost.
//
// THE PILL SAYS WHAT IT COSTS, which is the thing a list of counts cannot do.
// Every video has a different answer per country, and there are three of them:
//
//   Free       YouTube already dubbed it. /api/global-sync/dub pulls that track
//              instead of synthesizing, so the listing costs nothing.
//   Uses a dub MVP dubs it, the same lane the Launchpad stepper has always used.
//              Offered, never swept up by a bulk press.
//   Checking   the lookup has not landed. NOT the same as "no track", and shown
//              differently, because telling someone their video cannot be
//              localized when nobody has looked yet is the worst thing here.
//
// NOT A DOWNLOADER. The obvious build is "scan the channel, fetch the dubbed
// files, hand over a folder", and that is a to-do list: the creator still opens
// Creator Hub, picks the marketplace, uploads, retypes the title and attaches
// the ASIN. Pressing a pill runs the normal storefront pipeline, so a run ends
// in listings and no file touches their machine.

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Send, Globe, Check, Sparkles } from 'lucide-react'
import { MARKETS } from '@/lib/markets'

type MarketState = 'pending' | 'eligible' | 'paid' | 'queued' | 'delivered' | 'failed' | 'skipped'

interface CardMarket {
  domain: string; country: string; langName: string | null
  itemId: string | null; state: MarketState; reason: string | null
}
interface Card { videoId: string; title: string; thumbnail: string | null; markets: CardMarket[] }
interface Reason { reason: string; count: number }
interface PerMarket {
  domain: string; country: string; langName: string | null
  pending: number; free: number; paid: number
  skipped: number; queued: number; delivered: number; failed: number
  failedReasons: Reason[]
}
interface RunState {
  ok: boolean
  run?: { id: string; domains: string[]; state: string }
  videos?: {
    total: number; checked: number; pending: number; blocked: number
    actionable: number; shown: number; moreThanShown: boolean; resolving: number
  }
  blockedReasons?: Reason[]
  markets?: PerMarket[]
  cards?: Card[]
  totals?: { free: number; paid: number; queued: number; delivered: number; failed: number }
  error?: string
  // The route sends the underlying cause with the message. Dropping it here is
  // how a screen ends up printing a guess while the real error sits unread.
  detail?: string | null
}

/** Only the markets that need a dub. The English stores need no translation, so
 *  the normal Storefront Sync already covers them and this would add nothing. */
const DUBBED_MARKETS = MARKETS.filter((m) => m.needsTranslation)

const muted = { color: 'var(--muted)' }

/** How a pill looks and what it says. The label carries the cost, because a
 *  colour alone is not a statement and the creator is about to spend on it. */
function pillFace(state: MarketState, langName: string | null) {
  switch (state) {
    case 'eligible':  return { label: `${langName} · free`, fg: '#16a34a', bg: 'rgba(22,163,74,0.10)', border: '#16a34a', can: true }
    case 'paid':      return { label: `${langName} · uses a dub`, fg: '#7C3AED', bg: 'rgba(124,58,237,0.10)', border: '#7C3AED', can: true }
    case 'queued':    return { label: `${langName} · queued`, fg: '#0EA5A4', bg: 'rgba(14,165,164,0.10)', border: '#0EA5A4', can: false }
    case 'delivered': return { label: `${langName} · sent`, fg: '#0EA5A4', bg: 'rgba(14,165,164,0.16)', border: '#0EA5A4', can: false }
    case 'failed':    return { label: `${langName} · failed`, fg: '#dc2626', bg: 'rgba(220,38,38,0.10)', border: '#dc2626', can: false }
    case 'skipped':   return { label: `${langName} · cannot go`, fg: 'var(--muted)', bg: 'transparent', border: 'var(--border)', can: false }
    default:          return { label: `${langName} · checking`, fg: 'var(--muted)', bg: 'transparent', border: 'var(--border)', can: false }
  }
}

export default function BackCatalogueStage() {
  const [picked, setPicked] = useState<string[]>([DUBBED_MARKETS[0]?.domain ?? 'amazon.de'])
  const [runId, setRunId] = useState<string | null>(null)
  const [state, setState] = useState<RunState | null>(null)
  const [starting, setStarting] = useState(false)
  const [queueing, setQueueing] = useState(false)
  const [scope, setScope] = useState<{ total: number; considered: number } | null>(null)
  // Hand-picked pills, by item id. Empty means the creator has not chosen, and
  // the bulk buttons apply instead.
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  // A single pasted link. The whole catalogue is the point of the feature, but
  // "does this actually work" should not cost a 3000 video run to answer.
  const [onlyVideo, setOnlyVideo] = useState('')
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/catalogue/${id}`)
      setState(await r.json())
    } catch { /* a dropped poll is not worth a toast; the next one lands */ }
  }, [])

  // WHAT IS ALREADY HAPPENING, before anybody presses anything.
  //
  // Without this the page knew nothing until Find was pressed, so someone with
  // a run already open would paste a single video, be told to press Start a
  // different run, and find no such button: it only appears once the page is
  // holding a run. The instruction was correct and impossible to follow.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const r = await fetch('/api/catalogue/open')
        const j = await r.json()
        if (!alive || !j?.run?.id) return
        setRunId(j.run.id)
        if (Array.isArray(j.run.domains) && j.run.domains.length > 0) setPicked(j.run.domains)
      } catch { /* the page still works; Find will find it */ }
    })()
    return () => { alive = false }
  }, [])

  // Polled while the scan runs. Each video is one lookup on a trickle, so a big
  // catalogue resolves over minutes and the page keeps up on its own rather than
  // making the creator refresh.
  useEffect(() => {
    if (!runId) return
    void load(runId)
    poll.current = setInterval(() => { void load(runId) }, 5000)
    return () => { if (poll.current) clearInterval(poll.current) }
  }, [runId, load])

  // STOP ONLY WHEN THERE IS NOTHING LEFT TO LEARN. 'ready' means the lookups
  // finished, but queued listings keep resolving to sent or failed afterwards,
  // and a page that stopped polling at 'ready' would leave 150 pills reading
  // "queued" for the rest of the session no matter what actually happened.
  const stillMoving = (state?.totals?.queued ?? 0) > 0 || (state?.videos?.resolving ?? 0) > 0
  useEffect(() => {
    if (state?.run?.state === 'ready' && !stillMoving && poll.current) {
      clearInterval(poll.current); poll.current = null
    }
  }, [state?.run?.state, stillMoving])

  const reset = () => { setRunId(null); setState(null); setScope(null); setChosen(new Set()) }
  // Not cleared by reset: after a one-video test the creator usually wants to
  // run the same link again, or clear it deliberately to go full catalogue.

  const toggleMarket = (domain: string) => {
    reset()
    setPicked((p) => p.includes(domain) ? p.filter((d) => d !== domain) : [...p, domain])
  }

  const togglePill = (itemId: string) => setChosen((s) => {
    const next = new Set(s)
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId)
    return next
  })

  // What a hand-picked send would cost, so the creator reads it before pressing
  // rather than discovering it on the credits screen afterwards.
  const chosenCost = useMemo(() => {
    let free = 0, paid = 0
    for (const c of state?.cards ?? []) {
      for (const m of c.markets) {
        if (!m.itemId || !chosen.has(m.itemId)) continue
        if (m.state === 'eligible') free++
        else if (m.state === 'paid') paid++
      }
    }
    return { free, paid, total: free + paid }
  }, [chosen, state?.cards])

  // FORGETTING IS NOT ABANDONING. Clearing the local state left the run open on
  // the server, so the next Find resumed it with its original markets and the
  // creator's new selection was silently discarded.
  async function abandon() {
    if (!runId) { reset(); return }
    try {
      await fetch(`/api/catalogue/${runId}`, { method: 'DELETE' })
    } catch { /* the reset below still frees the screen; the run is re-offered */ }
    reset()
  }

  async function start() {
    if (picked.length === 0) { toast.error('Pick at least one marketplace.'); return }
    setStarting(true)
    try {
      const r = await fetch('/api/catalogue/start', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domains: picked, onlyVideo: onlyVideo.trim() || undefined }),
      })
      const j = await r.json()
      // A 409 means a run is already open. Show it, so the button the message
      // tells them to press is actually on the screen.
      if (r.status === 409 && j?.runId) setRunId(j.runId)
      if (!r.ok || !j?.ok) {
        // The route's own words, kept long enough to read: "sync your channel
        // first" and "close the run you already have" are instructions, not
        // decoration, and a three second toast loses them.
        // The detail as well as the message. A route that says "could not look
        // that video up" and then hides the database's own reason is the same
        // screen that printed a guess about cookies while the real error sat
        // unread.
        toast.error(
          `${j?.error || 'Could not start the run.'}${j?.detail ? ` (${j.detail})` : ''}`,
          { duration: 10000 },
        )
        return
      }
      setRunId(j.runId)
      // ADOPT THE RUN'S MARKETS. Resuming used to leave the local selection
      // pointing at something else, so pressing Start a different run
      // afterwards would silently go back to the stale pick.
      if (Array.isArray(j.domains) && j.domains.length > 0) setPicked(j.domains)
      // A one-video run is not looking at a slice of anything, so the amber
      // "your newest N out of M" line would be wrong on it.
      if (typeof j.total === 'number' && !j.onlyVideo) setScope({ total: j.total, considered: j.videos ?? 0 })
      toast.success(
        j.resumed ? 'Picking up the run already in progress. The markets above now show what it covers.'
        : j.onlyVideo ? 'Checking that one video.'
        : `Checking ${j.scannable ?? j.videos} videos.`,
        { duration: j.resumed ? 8000 : 4000 },
      )
    } catch {
      toast.error('Could not reach the server.')
    } finally { setStarting(false) }
  }

  async function send(payload: { domain?: string; itemIds?: string[]; includePaid?: boolean }) {
    if (!runId) return
    setQueueing(true)
    try {
      // Looped because the route works in batches: a long catalogue is several
      // requests rather than one that runs past the function budget.
      for (;;) {
        const r = await fetch('/api/catalogue/queue', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ runId, ...payload }),
        })
        const j = await r.json()
        if (!r.ok || !j?.ok) { toast.error(j?.error || 'Could not queue the videos.'); break }
        if (Array.isArray(j.failed) && j.failed.length > 0) {
          toast.error(`${j.failed.length} could not be queued: ${j.failed[0].error}`, { duration: 12000 })
        }
        await load(runId)
        if (!j.remaining || j.queued === 0) break
      }
      setChosen(new Set())
      toast.success('Queued. Open Storefront Sync with SCOUT running to send them up.')
    } finally { setQueueing(false) }
  }

  const v = state?.videos
  const scanning = state?.run?.state === 'scanning' && (v?.pending ?? 0) > 0
  const totals = state?.totals
  // The markets the run is ACTUALLY covering, which is not always what is
  // ticked: a resumed run keeps the markets it was started with.
  const runDomains = runId ? (state?.run?.domains ?? null) : null

  return (
    <div>
      <p className="text-[12.5px] mb-3" style={muted}>
        YouTube has already dubbed part of your channel. This finds those videos and sends them straight
        to the Amazon storefronts that speak those languages, with the product attached.
        You never download anything.
      </p>

      {/* ── pick the stores ─────────────────────────────────────────────────
          ONCE A RUN EXISTS, THESE SHOW THE RUN. Changing a tick clears the
          local run and pressing Find again resumes whatever run is still open
          on the server, which may well cover different markets. The ticks then
          described a selection that had nothing to do with the numbers below
          it: five stores' worth of results under two ticked countries. */}
      <p className="text-[12px] font-medium mb-1.5" style={muted}>
        {runId ? 'Marketplaces in this run' : 'Marketplaces to check'}
      </p>
      <div className="flex flex-wrap gap-2">
        {DUBBED_MARKETS.map((m) => {
          const on = runDomains ? runDomains.includes(m.domain) : picked.includes(m.domain)
          return (
            <button
              key={m.domain} type="button" onClick={() => toggleMarket(m.domain)} disabled={!!runId}
              className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] disabled:opacity-60"
              style={{
                borderColor: on ? '#7C3AED' : 'var(--border)',
                background: on ? 'rgba(124,58,237,0.10)' : 'transparent',
                color: on ? '#7C3AED' : 'var(--text)',
              }}
            >
              {on && <Check size={13} />}{m.country} · {m.langName}
            </button>
          )
        })}
      </div>

      {/* ── TRY ONE FIRST ────────────────────────────────────────────────────
          Identical code path on one row: same enumeration, same scanner, same
          queue, same delivery. The only difference is how many rows it makes,
          so a test here is worth something rather than exercising a shortcut
          the real run does not take. */}
      {!runId && (
        <div className="mt-4 rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[12.5px] font-medium" style={{ color: 'var(--text)' }}>Try one video first</p>
          <p className="mt-0.5 text-[12px]" style={muted}>
            Paste a YouTube link and MVP checks only that one. Same path as the full run, so what you
            see here is what the catalogue will do.
          </p>
          <input
            value={onlyVideo}
            onChange={(e) => setOnlyVideo(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="mt-2 w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button" onClick={start} disabled={starting || !!runId || picked.length === 0}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
          style={{ background: '#7C3AED' }}
        >
          {starting ? <Loader2 size={15} className="animate-spin" /> : <Globe size={15} />}
          {runId ? 'Run in progress' : onlyVideo.trim() ? 'Check that one video' : 'Check my catalogue'}
        </button>
        {runId && (
          <button type="button" onClick={() => void abandon()} className="text-[12px] underline" style={muted}>
            Start a different run
          </button>
        )}
      </div>

      {/* NO STANDING WARNING HERE. An earlier version compared the run's markets
          to the local selection and shouted whenever they differed, which was
          every resumed run: the ticks above had already switched to showing the
          RUN, so the line was contradicting a screen that was telling the truth.
          The mismatch only matters at the moment of resuming, and the toast on
          that response names the markets. */}
      <p className="mt-2 text-[12px]" style={muted}>
        Checking a video reads its track list only. Nothing is downloaded and no dub is paid for.
        One check answers every language at once, so adding stores costs nothing extra.
      </p>

      {state?.error && (
        <p className="mt-4 text-[13px]" style={{ color: '#dc2626' }}>
          {state.error}{state.detail ? ` (${state.detail})` : ''}
        </p>
      )}

      {v && (
        <div className="mt-5">
          {/* ── the summary above the cards ───────────────────────────────── */}
          <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <p className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
                {scanning ? `Checking your videos… ${v.checked} of ${v.total}` : `Checked ${v.total} videos`}
              </p>
              {scanning && <Loader2 size={15} className="animate-spin" style={muted} />}
            </div>

            {/* SAID OUT LOUD, because a cap that looks like a total is a lie
                about the size of someone's channel. */}
            {scope && scope.total > scope.considered && (
              <p className="mt-1.5 text-[12.5px]" style={{ color: '#d97706' }}>
                Your newest {scope.considered} videos, out of {scope.total} on the account. Run it again
                after these are sent to reach the rest.
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]" style={muted}>
              {(v.resolving ?? 0) > 0 && (
                <span><strong style={{ color: '#7C3AED' }}>{v.resolving}</strong> still finding the product</span>
              )}
              <span><strong style={{ color: '#16a34a' }}>{totals?.free ?? 0}</strong> listings free</span>
              <span><strong style={{ color: '#7C3AED' }}>{totals?.paid ?? 0}</strong> need a dub</span>
              {(totals?.queued ?? 0) > 0 && <span>{totals!.queued} queued</span>}
              {(totals?.delivered ?? 0) > 0 && <span>{totals!.delivered} sent</span>}
              {(totals?.failed ?? 0) > 0 && <span style={{ color: '#dc2626' }}>{totals!.failed} failed</span>}
            </div>

            {(state?.blockedReasons?.length ?? 0) > 0 && (
              <div className="mt-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={muted}>
                  Not going to any store, and why
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {state!.blockedReasons!.map((s) => (
                    <li key={s.reason} className="text-[13px]" style={{ color: 'var(--text)' }}>
                      <strong>{s.count}</strong> · {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(totals?.free ?? 0) > 0 && (
              <button
                type="button" onClick={() => void send({})} disabled={queueing}
                className="mt-4 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
                style={{ background: '#16a34a' }}
              >
                {queueing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Send the {totals!.free} free ones
              </button>
            )}
          </div>

          {/* ── one card per video ────────────────────────────────────────── */}
          {(state?.cards?.length ?? 0) > 0 && (
            <>
              <div className="mt-6 flex items-baseline justify-between gap-3 flex-wrap">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={muted}>
                  Your videos {v.moreThanShown
                    ? `· the first ${v.shown}, there are more`
                    : v.shown < v.actionable ? `· the first ${v.shown} of ${v.actionable}` : ''}
                </p>
                <p className="text-[12px]" style={muted}>Tap a country to send that one.</p>
              </div>

              <div className="mt-3 flex flex-col gap-2.5">
                {state!.cards!.map((c) => (
                  <div key={c.videoId} className="rounded-xl border p-3.5 flex gap-3.5" style={{ borderColor: 'var(--border)' }}>
                    {c.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumbnail} alt="" width={96} height={54}
                        className="rounded-lg object-cover flex-shrink-0" style={{ width: 96, height: 54 }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium truncate" style={{ color: 'var(--text)' }}>{c.title}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.markets.map((m) => {
                          const face = pillFace(m.state, m.langName)
                          const on = !!m.itemId && chosen.has(m.itemId)
                          return (
                            <button
                              key={m.domain} type="button"
                              title={m.reason ?? `${m.country} · ${m.domain}`}
                              disabled={!face.can || queueing}
                              onClick={() => m.itemId && togglePill(m.itemId)}
                              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium disabled:cursor-default"
                              style={{
                                borderColor: on ? face.fg : face.border,
                                background: on ? face.fg : face.bg,
                                color: on ? '#fff' : face.fg,
                              }}
                            >
                              {on && <Check size={11} />}
                              {m.country} · {face.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── the hand-picked send, priced before it is pressed ─────────── */}
          {chosenCost.total > 0 && (
            <div className="sticky bottom-4 mt-4 rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3"
              style={{ borderColor: '#7C3AED', background: 'var(--surface)' }}>
              <p className="text-[13px]" style={{ color: 'var(--text)' }}>
                {chosenCost.total} selected
                {chosenCost.paid > 0
                  ? <> · {chosenCost.free} free and <strong>{chosenCost.paid} using a dub</strong></>
                  : <> · all free</>}
              </p>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setChosen(new Set())} className="text-[12px] underline" style={muted}>Clear</button>
                <button
                  type="button" onClick={() => void send({ itemIds: [...chosen] })} disabled={queueing}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                  style={{ background: '#7C3AED' }}
                >
                  {queueing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Send these {chosenCost.total}
                </button>
              </div>
            </div>
          )}

          {/* SAID OUT LOUD. The upload runs through the creator's own Creator Hub
              session, so a run prepares everything unattended and the listings go
              out when they open Storefront Sync with SCOUT. A progress bar that
              implied otherwise would be the lie. */}
          {(totals?.queued ?? 0) > 0 && (
            <p className="mt-4 text-[12.5px]" style={muted}>
              Queued videos are localized and dubbed in the background. They upload through your own
              Amazon Creator account, so open <a href="/global-sync" className="underline" style={{ color: '#0EA5A4' }}>Storefront Sync</a> with
              SCOUT running to send them up.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
