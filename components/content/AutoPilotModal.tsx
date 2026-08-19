'use client'

/**
 * AutoPilotModal — the "Auto-pilot" toggle opened from the Blog Post Generator
 * toolbar. When on, a daily cron publishes ONE post a day from the creator's
 * next un-blogged YouTube video (hero + internal images), no social push. One
 * per day for every plan; more is manual. Reads/writes /api/blog/autopilot.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Rocket } from 'lucide-react'

interface AutoState { enabled: boolean; lastRunAt: string | null; pausedReason: string | null }

export default function AutoPilotModal({ onClose, onChange }: { onClose: () => void; onChange?: (enabled: boolean) => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [state, setState] = useState<AutoState>({ enabled: false, lastRunAt: null, pausedReason: null })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/blog/autopilot')
        const d = await res.json()
        if (!cancelled && d.autopilot) setState(d.autopilot)
      } catch { /* keep defaults */ } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function setEnabled(enabled: boolean) {
    setSaving(true)
    try {
      const res = await fetch('/api/blog/autopilot', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not save')
      setState(d.autopilot)
      onChange?.(d.autopilot?.enabled === true)
      toast.success(enabled ? 'Auto-pilot on — one post a day' : 'Auto-pilot off')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const pausedNote = state.pausedReason === 'cap'
    ? "Paused: you've used this month's post allowance. It resumes next billing cycle."
    : state.pausedReason === 'spend'
    ? 'Paused: monthly AI-spend safety limit reached. It resumes next billing cycle.'
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="card w-full max-w-md p-5 bg-white dark:bg-[#18181b]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Rocket size={18} className="text-[#7C3AED]" />
            <div>
              <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Auto-pilot</h3>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">One published post a day, hands-off.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white p-1" title="Close"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#86868b] py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-lg border border-[var(--border-2,#e5e5e7)] px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Publish one post a day</div>
                <div className="text-[11px] text-[#86868b] mt-0.5">{state.enabled ? 'On' : 'Off'}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={state.enabled}
                disabled={saving}
                onClick={() => setEnabled(!state.enabled)}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-60"
                style={{ background: state.enabled ? '#7C3AED' : '#c7c7cc' }}
              >
                <span className="inline-block h-5 w-5 transform rounded-full bg-white transition" style={{ transform: state.enabled ? 'translateX(22px)' : 'translateX(2px)' }} />
              </button>
            </div>

            {pausedNote && (
              <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(245,158,11,0.12)', color: '#b45309' }}>
                {pausedNote}
              </div>
            )}

            <ul className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0] space-y-1.5 leading-relaxed">
              <li>• Turns your next un-blogged YouTube video into a full post (hero + in-article images).</li>
              <li>• Up to one post a day, drawn from your monthly post allowance. Studio and Pro cover a post every day; Creator posts daily until its monthly posts are used, then pauses.</li>
              <li>• No social posting, just your blog.</li>
              <li>• When your monthly allowance runs out it pauses, emails you, and resumes next cycle. Want more before then? Generate posts manually.</li>
            </ul>

            <div className="flex justify-end border-t border-[var(--border-2,#e5e5e7)] pt-3">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] hover:bg-[var(--surface-hover,#f5f5f7)]">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
