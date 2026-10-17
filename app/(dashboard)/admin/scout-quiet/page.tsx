// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /admin/scout-quiet — try each SCOUT job out of sight before every member
// gets it (lib/scout-quiet; Seb, 2026-10-17: "Make sure we don't have any
// pop-up windows or Scout being brought into the foreground").
//
// A try is kept in this browser only, and only an admin's tries reach SCOUT
// (ScoutQuietSync checks). The page shows what SCOUT says it holds after each
// change, so a SCOUT that did not take it reads differently from one that did.

'use client'

import { useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { QUIET_ANSWER_EVENT, QUIET_CHANGED_EVENT, QUIET_FOR_EVERYONE, QUIET_JOBS, QUIET_TEST_KEY, readQuietTries, type QuietAnswer, type QuietJob } from '@/lib/scout-quiet'
import { SCOUT_QUIET_MIN_VERSION } from '@/lib/scout-version'

export default function ScoutQuietPage() {
  const [tries, setTries] = useState<Partial<Record<QuietJob, boolean>>>({})
  const [answer, setAnswer] = useState<QuietAnswer | null>(null)

  useEffect(() => {
    setTries(readQuietTries() || {})
    const onAnswer = (e: Event) => setAnswer((e as CustomEvent<QuietAnswer>).detail)
    window.addEventListener(QUIET_ANSWER_EVENT, onAnswer)
    // Ask for a fresh answer: the first one may have come before this page.
    window.dispatchEvent(new Event(QUIET_CHANGED_EVENT))
    return () => window.removeEventListener(QUIET_ANSWER_EVENT, onAnswer)
  }, [])

  const toggle = (id: QuietJob, on: boolean) => {
    const next = { ...tries, [id]: on }
    setTries(next)
    try { window.localStorage.setItem(QUIET_TEST_KEY, JSON.stringify(next)) } catch { /* this visit only */ }
    setAnswer(null)
    window.dispatchEvent(new Event(QUIET_CHANGED_EVENT))
  }

  const scoutLine = !answer
    ? { tone: 'var(--text-faint)', text: 'Asking SCOUT…' }
    : !answer.installed
      ? { tone: '#B45309', text: 'SCOUT did not answer in this Chrome, so nothing reaches it.' }
      : !answer.ready
        ? { tone: '#B45309', text: `Your SCOUT is ${answer.version || 'an older version'}. These tries need SCOUT ${SCOUT_QUIET_MIN_VERSION}, which Chrome installs once the Web Store approves it.` }
        : !answer.held
          ? { tone: '#DC2626', text: `SCOUT ${answer.version} did not confirm the change. Reload the page to ask again.` }
          : { tone: '#15803D', text: `SCOUT ${answer.version} confirmed what it runs out of sight.` }

  return (
    <div className="max-w-3xl">
      <PageHero title="SCOUT out of sight" subtitle="Try each SCOUT job in its own minimized window before members get it. TRYBE already runs out of sight for everyone." />

      <p className="text-[13px] mb-4" style={{ color: scoutLine.tone }}>{scoutLine.text}</p>

      <div className="flex flex-col gap-3">
        {QUIET_JOBS.map((j) => {
          const on = typeof tries[j.id] === 'boolean' ? !!tries[j.id] : QUIET_FOR_EVERYONE[j.id]
          const held = answer?.held ? answer.held[j.id] === true : null
          return (
            <div key={j.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{j.label}</p>
                  <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-soft)' }}>{j.what}</p>
                </div>
                <label className="inline-flex items-center gap-2 text-[13px] font-semibold cursor-pointer" style={{ color: 'var(--text)' }}>
                  <input type="checkbox" checked={on} onChange={(e) => toggle(j.id, e.target.checked)} className="w-4 h-4 accent-[#7C3AED]" />
                  Try out of sight
                </label>
              </div>
              <p className="text-[12px] mt-2" style={{ color: 'var(--text-faint)' }}>To test: {j.test}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[12px]">
                {held === null
                  ? <span style={{ color: 'var(--text-faint)' }}>SCOUT: not confirmed yet</span>
                  : held
                    ? <span className="inline-flex items-center gap-1" style={{ color: '#15803D' }}><CheckCircle2 size={12} /> SCOUT runs it out of sight</span>
                    : <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-soft)' }}><AlertTriangle size={12} /> SCOUT brings it to the front, as before</span>}
                <span style={{ color: 'var(--text-faint)' }}>Members: {QUIET_FOR_EVERYONE[j.id] ? 'out of sight' : 'as before, until you say it works'}</span>
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-[12px] mt-5" style={{ color: 'var(--text-faint)' }}>
        If a job does not finish out of sight (nothing happens, or it stops part way), untick it: it goes back to coming to the front. When one works, it is turned on for every member in lib/scout-quiet (QUIET_FOR_EVERYONE), with no new SCOUT.
      </p>
    </div>
  )
}
