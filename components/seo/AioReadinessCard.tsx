'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AIO readiness rollup — how quotable the creator's published posts are by AI
// answer engines, across the whole site. Average score, grade spread, the checks
// that fail most (with the fix), and the lowest-scoring posts to fix first.
// Self-contained: fetches /api/seo/aio-summary (reads the aio score the generator
// persists on each post).

import { useEffect, useState } from 'react'
import { Loader2, Bot, ExternalLink, ChevronDown } from 'lucide-react'

interface Fix { label: string; hint: string; count: number; share: number }
interface Worst { id: string; title: string | null; url: string | null; score: number; grade: string }
interface Summary { ok?: boolean; scored?: number; avgScore?: number; grades?: Record<string, number>; topFixes?: Fix[]; worst?: Worst[] }

const AIO = '#7C3AED'
/** What the number actually means, for someone who has never seen it before. A
 *  bare 80 out of an unstated maximum tells nobody anything. */
function reading(s: number): string {
  if (s >= 85) return 'Strong. There is plenty here for an AI answer to quote.'
  if (s >= 70) return 'Decent. One or two changes would make these a lot more quotable.'
  if (s >= 50) return 'Thin. There is not much in these posts an AI answer can lift.'
  return 'Not quotable yet.'
}
function scoreColor(s: number) { return s >= 85 ? '#059669' : s >= 70 ? '#0d9488' : s >= 50 ? '#d97706' : '#e11d48' }

export default function AioReadinessCard() {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    fetch('/api/seo/aio-summary').then(r => r.json()).then(setData).catch(() => setData({ scored: 0 })).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="rounded-2xl border p-4 mb-5 flex items-center gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <Loader2 size={15} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
        <span className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Scoring your posts for AI-answer readiness…</span>
      </div>
    )
  }
  if (!data || !data.scored) {
    return (
      <div className="rounded-2xl border p-4 mb-5 flex items-start gap-2.5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="w-8 h-8 rounded-lg grid place-items-center flex-shrink-0" style={{ background: 'rgba(124,58,237,0.12)' }}><Bot size={17} style={{ color: AIO }} /></div>
        <div>
          <p className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>AI-answer readiness</p>
          <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-soft)' }}>Your next generated post gets an AIO score here — how likely ChatGPT, Perplexity, and Google AI Overviews are to quote it.</p>
        </div>
      </div>
    )
  }

  const { avgScore = 0, grades = {}, topFixes = [], worst = [], scored = 0 } = data
  const gradeOrder = ['A', 'B', 'C', 'D']

  return (
    <div className="rounded-2xl border mb-5 overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full px-4 sm:px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl grid place-items-center flex-shrink-0 font-bold text-[17px]" style={{ background: `${scoreColor(avgScore)}1a`, color: scoreColor(avgScore) }}>
            {avgScore}
          </div>
          <div className="text-left">
            <p className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>How quotable your posts are</p>
            <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>
              {avgScore} out of 100, across your {scored} scored post{scored === 1 ? '' : 's'}. {reading(avgScore)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ChevronDown size={16} style={{ color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </div>
      </button>

      {open && (
        <div className="px-4 sm:px-5 pb-4 flex flex-col gap-4">
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            When someone asks ChatGPT or Google for a recommendation, the answer is built by lifting passages out of pages
            it has read. This scores your posts on the eight things those engines look for before they will quote one.
            {gradeOrder.filter(g => grades[g]).length === 1
              ? ` All ${scored} of your posts score about the same, so anything that lifts one lifts all of them.`
              : ''}
          </p>
          {topFixes.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-faint)' }}>Fix these first (biggest lift)</p>
              <div className="flex flex-col gap-1.5">
                {topFixes.map((f, i) => (
                  <div key={i} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-2, var(--border))', background: 'var(--surface-2, transparent)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>{f.label}</span>
                      <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(217,119,6,0.14)', color: '#b45309' }}>{f.share}% of posts</span>
                    </div>
                    <p className="text-[11.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-soft)' }}>{f.hint}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {worst.length > 0 && worst[0].score < avgScore - 5 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-faint)' }}>Lowest-scoring posts</p>
              <div className="rounded-lg border divide-y" style={{ borderColor: 'var(--border-2, var(--border))' }}>
                {worst.map(w => (
                  <div key={w.id} className="flex items-center gap-2.5 px-3 py-2">
                    <span className="text-[11px] font-bold rounded-md px-1.5 py-0.5 flex-shrink-0" style={{ background: `${scoreColor(w.score)}1a`, color: scoreColor(w.score) }}>{w.score}</span>
                    <span className="text-[12.5px] flex-1 min-w-0 truncate" style={{ color: 'var(--text)' }}>{w.title || 'Untitled post'}</span>
                    {w.url && <a href={w.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0" style={{ color: 'var(--text-faint)' }} title="View post"><ExternalLink size={13} /></a>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            Every new post MVP writes is scored automatically and already includes these. The checks above are for posts you
            published before, and they are edits to the post itself rather than settings to change.
          </p>
        </div>
      )}
    </div>
  )
}
