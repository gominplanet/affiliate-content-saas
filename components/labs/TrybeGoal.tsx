'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR MONTHLY VIDEO GOAL, on This week (Seb, 2026-10-14: "monthly video goal
// should be 250 per month"). The videos you sent TRYBE in the last 30 days,
// read through SCOUT, against your goal (250 unless you change it), and the
// weekly and batch pace that reaches it (lib/trybe-week goalOf). The goal is
// kept in this browser. A read that failed says so, never "0 sent".

import { useEffect, useState } from 'react'
import { Loader2, Target } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats } from '@/lib/trybe-mybrands'
import { goalOf, MONTHLY_GOAL, GOAL_CHOICES } from '@/lib/trybe-week'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const KEY = 'mvp.trybe.monthlyGoal'

export default function TrybeGoal({ canRead }: { canRead: boolean }) {
  const [goal, setGoal] = useState(MONTHLY_GOAL)
  const [sent, setSent] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { try { const g = Number(localStorage.getItem(KEY)); if (GOAL_CHOICES.includes(g)) setGoal(g) } catch { /* default */ } }, [])
  useEffect(() => {
    if (!canRead) return
    let gone = false
    requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=30d').then((r) => {
      if (gone) return
      if (!r.ok) { setError('MVP could not read your last 30 days from TRYBE just now.'); return }
      const list = readBrandStats(r.json)
      const known = list.map((b) => b.submitted).filter((n): n is number => typeof n === 'number')
      if (list.length && !known.length) { setError('TRYBE did not say how many videos you sent.'); return }
      setSent(known.reduce((a, b) => a + b, 0))
    }).catch(() => { if (!gone) setError('MVP could not read your last 30 days from TRYBE just now.') })
    return () => { gone = true }
  }, [canRead])
  const choose = (g: number) => { setGoal(g); try { localStorage.setItem(KEY, String(g)) } catch { /* this visit only */ } }
  const read = sent == null ? null : goalOf(sent, goal)
  const soft = { color: 'var(--text-soft)' }
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <Target size={16} style={{ color: PURPLE }} />
        <p className="text-[15px] font-semibold flex-1">Your monthly video goal</p>
        <label className="text-[12px] inline-flex items-center gap-1.5" style={soft}>
          Goal
          <select value={goal} onChange={(e) => choose(Number(e.target.value))} className="rounded-lg border px-2 py-1 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            {GOAL_CHOICES.map((n) => <option key={n} value={n}>{n} a month</option>)}
          </select>
        </label>
      </div>
      <p className="text-[12.5px] mb-2 max-w-[75ch]" style={soft}>A goal for the month, not a daily habit: many brands approve on a couple of days a week, so film in batches and keep the rest of your week for your other income.</p>
      {!canRead ? <p className="text-[13px]" style={soft}>Allow SCOUT on TRYBE and MVP counts the videos you sent in the last 30 days.</p>
        : error ? <p className="text-[13px]" style={{ color: AMBER }}>{error}</p>
          : !read ? <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Counting your videos on TRYBE...</p>
            : (<>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2, rgba(0,0,0,0.06))' }} role="progressbar" aria-valuemin={0} aria-valuemax={read.goal} aria-valuenow={Math.min(read.sent, read.goal)}>
                <div className="h-full rounded-full" style={{ width: `${read.pct}%`, background: read.sent >= read.goal ? GREEN : PURPLE }} />
              </div>
              <p className="text-[13px] mt-1.5"><b className="tabular-nums">{read.sent} / {read.goal}</b> <span style={{ color: 'var(--text-2)' }}>{read.says.replace(/^\d+ of \d+ in the last 30 days, /, 'in the last 30 days, ')}</span></p>
            </>)}
    </div>
  )
}
