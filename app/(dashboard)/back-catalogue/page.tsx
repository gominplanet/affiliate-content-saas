// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /back-catalogue — the videos YouTube has already dubbed, sent to a storefront.
//
// YouTube auto-dubs a slice of a channel. One creator: 197 of 525 videos already
// carry a German track. Those are 197 amazon.de listings available today, at no
// dub cost, and until now nothing in MVP could see them: it only ever looked at
// the one video being published.
//
// NOT A DOWNLOADER, which is the whole design. The obvious build is "scan the
// channel, fetch the dubbed files, hand over a folder", and that is a to-do
// list: the creator still has to open Creator Hub, pick the marketplace, upload,
// retype the title and attach the ASIN. This runs the normal storefront
// pipeline instead, so a run ends in listings and no file touches their machine.
//
// THE SKIPPED VIDEOS ARE THE REPORT. "197 of 525" is the number a bulk scanner
// gives and it explains nothing about the other 328. Every video that is not
// going gets a reason, grouped, because "no German track" and "no product
// attached" are different problems and only one is fixable by the creator.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { toast } from 'sonner'
import { Loader2, Send, Globe } from 'lucide-react'
import { MARKETS } from '@/lib/markets'

interface Totals {
  videos: number; pending: number; eligible: number
  skipped: number; queued: number; delivered: number; failed: number
}
interface EligibleItem { itemId: string; videoId: string; youtubeVideoId: string | null; title: string }
interface SkippedReason { reason: string; count: number }
interface RunState {
  ok: boolean
  run?: { id: string; domain: string; country: string; langName: string | null; state: string }
  totals?: Totals
  eligible?: EligibleItem[]
  skippedReasons?: SkippedReason[]
  error?: string
}

const DUBBED_MARKETS = MARKETS.filter((m) => m.needsTranslation)

export default function BackCataloguePage() {
  const [domain, setDomain] = useState(DUBBED_MARKETS[0]?.domain ?? 'amazon.de')
  const [runId, setRunId] = useState<string | null>(null)
  const [state, setState] = useState<RunState | null>(null)
  const [starting, setStarting] = useState(false)
  const [queueing, setQueueing] = useState(false)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/catalogue/${id}`)
      setState(await r.json())
    } catch { /* a dropped poll is not worth a toast; the next one lands */ }
  }, [])

  // Polled while the scan is running. Each item is a yt-dlp lookup on a trickle,
  // so a big catalogue resolves over minutes and the page has to keep up on its
  // own rather than making the creator refresh.
  useEffect(() => {
    if (!runId) return
    void load(runId)
    poll.current = setInterval(() => { void load(runId) }, 5000)
    return () => { if (poll.current) clearInterval(poll.current) }
  }, [runId, load])

  useEffect(() => {
    if (state?.run?.state === 'ready' && poll.current) { clearInterval(poll.current); poll.current = null }
  }, [state?.run?.state])

  async function start() {
    setStarting(true)
    try {
      const r = await fetch('/api/catalogue/start', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain }),
      })
      const j = await r.json()
      if (!r.ok || !j?.ok) { toast.error(j?.error || 'Could not start the run.'); return }
      setRunId(j.runId)
      toast.success(j.resumed ? 'Picking up the run already in progress.' : `Checking ${j.videos} videos.`)
    } catch {
      toast.error('Could not reach the server.')
    } finally { setStarting(false) }
  }

  async function queueAll() {
    if (!runId) return
    setQueueing(true)
    try {
      // Looped because the route works in batches: a long catalogue is several
      // requests rather than one that runs past the function budget.
      for (;;) {
        const r = await fetch('/api/catalogue/queue', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ runId }),
        })
        const j = await r.json()
        if (!r.ok || !j?.ok) { toast.error(j?.error || 'Could not queue the videos.'); break }
        if (Array.isArray(j.failed) && j.failed.length > 0) {
          toast.error(`${j.failed.length} could not be queued: ${j.failed[0].error}`, { duration: 12000 })
        }
        await load(runId)
        if (!j.remaining || j.queued === 0) break
      }
      toast.success('Queued. Open Storefront Sync with SCOUT running to send them up.')
    } finally { setQueueing(false) }
  }

  const t = state?.totals
  const scanning = state?.run?.state === 'scanning' && (t?.pending ?? 0) > 0
  const market = DUBBED_MARKETS.find((m) => m.domain === domain)

  return (
    <div className="max-w-3xl mx-auto">
      <PageHero
        title="Back catalogue"
        subtitle="YouTube has already dubbed part of your channel. This finds those videos and sends them to one Amazon storefront, translated, with the product attached. You never download anything."
      />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium" style={{ color: 'var(--muted)' }}>Marketplace</span>
          <select
            value={domain}
            onChange={(e) => { setDomain(e.target.value); setRunId(null); setState(null) }}
            disabled={!!runId}
            className="rounded-xl border px-3 py-2.5 text-[14px] disabled:opacity-60"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            {DUBBED_MARKETS.map((m) => (
              <option key={m.domain} value={m.domain}>{m.domain} · {m.country} · {m.langName}</option>
            ))}
          </select>
        </label>
        <button
          type="button" onClick={start} disabled={starting || !!runId}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
          style={{ background: '#7C3AED' }}
        >
          {starting ? <Loader2 size={15} className="animate-spin" /> : <Globe size={15} />}
          {runId ? 'Run in progress' : 'Find videos'}
        </button>
      </div>

      <p className="mt-2 text-[12.5px]" style={{ color: 'var(--muted)' }}>
        Checking a video reads its track list only. Nothing is downloaded and no dub is paid for.
      </p>

      {state?.error && <p className="mt-5 text-[13px]" style={{ color: '#dc2626' }}>{state.error}</p>}

      {t && (
        <div className="mt-7 rounded-2xl border p-5" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <p className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
              {scanning
                ? `Checking your videos… ${t.videos - t.pending} of ${t.videos}`
                : `${t.eligible} of ${t.videos} videos already have ${market?.langName} audio`}
            </p>
            {scanning && <Loader2 size={15} className="animate-spin" style={{ color: 'var(--muted)' }} />}
          </div>

          {/* Counts for every state, so a video is never simply missing from
              the picture. queued + delivered matter after the hand-off. */}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]" style={{ color: 'var(--muted)' }}>
            <span>{t.eligible} ready</span>
            <span>{t.skipped} skipped</span>
            {t.pending > 0 && <span>{t.pending} still checking</span>}
            {t.queued > 0 && <span>{t.queued} queued</span>}
            {t.delivered > 0 && <span>{t.delivered} delivered</span>}
            {t.failed > 0 && <span style={{ color: '#dc2626' }}>{t.failed} failed</span>}
          </div>

          {t.eligible > 0 && (
            <button
              type="button" onClick={queueAll} disabled={queueing}
              className="mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
              style={{ background: '#16a34a' }}
            >
              {queueing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Send {t.eligible} to {state?.run?.domain}
            </button>
          )}

          {/* SAID OUT LOUD. The upload runs through the creator's own Creator
              Hub session, so a run prepares everything unattended and the
              listings go out when they open Storefront Sync with SCOUT. A
              progress bar that implied otherwise would be the lie. */}
          {t.queued > 0 && (
            <p className="mt-3 text-[12.5px]" style={{ color: 'var(--muted)' }}>
              Queued videos are localized and dubbed in the background. They upload through your own
              Amazon Creator account, so open Storefront Sync with SCOUT running to send them up.
            </p>
          )}

          {(state?.skippedReasons?.length ?? 0) > 0 && (
            <div className="mt-6">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
                Not going, and why
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {state!.skippedReasons!.map((s) => (
                  <li key={s.reason} className="text-[13.5px]" style={{ color: 'var(--text)' }}>
                    <strong>{s.count}</strong> · {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(state?.eligible?.length ?? 0) > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
                The {state!.eligible!.length} that are going
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {state!.eligible!.map((e) => (
                  <li key={e.itemId} className="text-[13px]" style={{ color: 'var(--text)' }}>{e.title}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
