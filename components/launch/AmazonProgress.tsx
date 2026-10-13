'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The live Amazon upload on Bulk Amazon upload: each store's step, the real
// share of the file sent, which video of how many (SCOUT 1.46.1), how long it
// has run, and a plain warning when SCOUT has gone quiet. Reads SCOUT only;
// nothing depends on it. See lib/amazon-progress.

import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { requestStorefrontProgress, type StorefrontProgress } from '@/lib/extension-frame'
import { readAmazonProgress, clock, STALL_SECONDS } from '@/lib/amazon-progress'
import { marketByDomain } from '@/lib/markets'
import { explainAmazonUpload } from '@/lib/amazon-upload-errors'

const TEAL = '#0EA5A4'

export default function AmazonProgress({ running, startedAt, listings, watch }: {
  /** This page is running an Amazon upload now. */
  running: boolean
  /** When it started (ms), so a previous run's report is not shown. */
  startedAt: number | null
  /** How many listings were handed to SCOUT, once known. */
  listings: number | null
  /** Also show an upload SCOUT is doing from its background tab. */
  watch: boolean
}) {
  const [progress, setProgress] = useState<StorefrontProgress>({})
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running && !watch) { setProgress({}); return }
    let stopped = false
    const tick = async () => {
      try { const p = await requestStorefrontProgress(); if (!stopped) setProgress(p) } catch { /* keep the last report */ }
      if (!stopped) setNow(Date.now())
    }
    void tick()
    const iv = setInterval(tick, running ? 2000 : 8000)
    return () => { stopped = true; clearInterval(iv) }
  }, [running, watch])
  // The running clock moves every second even between reports.
  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [running])

  const view = readAmazonProgress(progress, { since: running ? startedAt : null, now, running })
  if (!running && view.rows.length === 0) return null
  // The automatic check runs every two minutes and is usually done in a
  // moment with nothing to send: no bar flashing up for that.
  if (running && listings == null && view.rows.length === 0 && startedAt && now - startedAt < 4000) return null

  const elapsed = running && startedAt ? clock((now - startedAt) / 1000) : null
  const head = view.total != null
    ? `${view.done} of ${view.total} video${view.total === 1 ? '' : 's'} on Amazon`
    : listings
      ? `Uploading ${listings} video${listings === 1 ? '' : 's'} to Amazon`
      : running ? 'Getting ready: checking what is ready and that you are signed in to Amazon' : 'SCOUT is uploading to Amazon from its background tab'

  return (
    <div className="mt-3 rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }} aria-live="polite">
      <div className="flex items-center gap-2 flex-wrap">
        <Loader2 size={13} className="animate-spin shrink-0" style={{ color: TEAL }} />
        <span className="text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>{head}</span>
        {elapsed && <span className="ml-auto text-[11.5px] tabular-nums" style={{ color: 'var(--text-2)' }}>running {elapsed}</span>}
      </div>
      {view.overallPct != null && (
        <div className="mt-2">
          <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
            <div className="h-full rounded-full" style={{ width: `${view.overallPct}%`, background: TEAL, transition: 'width .4s ease' }} />
          </div>
          <p className="text-[10.5px] mt-0.5 tabular-nums" style={{ color: 'var(--text-2)' }}>{view.overallPct}% of the whole run</p>
        </div>
      )}
      {view.rows.map((r) => {
        const country = marketByDomain(r.domain)?.country ?? r.domain
        const which = r.total != null && r.current != null && !r.finished
          ? `video ${Math.min(r.current, r.total)} of ${r.total}${r.attempt && r.attempt > 1 ? `, try ${r.attempt} of ${r.attempts ?? 3}` : ''}`
          : null
        return (
          <div key={r.domain} className="mt-2">
            <div className="flex items-baseline gap-2 text-[11.5px]">
              <span className="font-semibold" style={{ color: 'var(--text)' }}>{country}</span>
              <span style={{ color: r.step === 'Failed' ? '#d97706' : 'var(--text-2)' }}>
                {r.finished ? (r.total != null ? `done, ${r.total} video${r.total === 1 ? '' : 's'}` : r.step) : [which, r.step].filter(Boolean).join(': ')}
              </span>
              {!r.finished && r.pct != null && <span className="ml-auto tabular-nums" style={{ color: 'var(--text-2)' }}>{r.pct}%</span>}
            </div>
            {!r.finished && r.title && <p className="text-[10.5px] truncate" style={{ color: 'var(--text-2)' }} title={r.title}>{r.title}</p>}
            {/* A RESTART FROM 0% SAYS WHY (Seb, 2026-10-13: "keeps going to 100%
                and back to 0%"). */}
            {!r.finished && r.lastError && (
              <p className="text-[11px] mt-0.5" style={{ color: '#d97706' }}>
                Starting this video again. The last try stopped: {explainAmazonUpload(r.lastError, r.domain) || r.lastError}
              </p>
            )}
            {!r.finished && (
              <div className="mt-1 h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                {/* A real number while the file moves; a sliding stripe for a
                    step that has no size, never a made up percentage. */}
                <div className={r.pct == null ? 'h-full w-1/3 rounded-full mvp-amz-slide' : 'h-full rounded-full'}
                  style={{ width: r.pct == null ? undefined : `${r.pct}%`, background: TEAL, transition: r.pct == null ? undefined : 'width .35s ease' }} />
              </div>
            )}
          </div>
        )
      })}
      {view.quiet ? (
        <p className="mt-2 text-[11.5px] inline-flex items-start gap-1.5" style={{ color: '#d97706' }}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          No word from SCOUT for {clock(view.quietFor ?? STALL_SECONDS)}. A big video can sit on one step for a few minutes, but if this keeps climbing, look at the Amazon tab SCOUT opened: it may be asking you to sign in.
        </p>
      ) : view.quietFor != null && (running || view.rows.length > 0) ? (
        <p className="mt-2 text-[10.5px] tabular-nums" style={{ color: 'var(--text-2)' }}>SCOUT last reported {view.quietFor <= 3 ? 'just now' : `${clock(view.quietFor)} ago`}. Keep Chrome open.</p>
      ) : null}
      <style>{`
        @keyframes mvpAmzSlide { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }
        .mvp-amz-slide { animation: mvpAmzSlide 1.3s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) { .mvp-amz-slide { animation: none; width: 100% } }
      `}</style>
    </div>
  )
}
