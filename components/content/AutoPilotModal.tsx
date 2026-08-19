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

type Cadence = 'daily' | 'alternate' | '3x_week' | '2x_week' | '1x_week'
interface AutoState { enabled: boolean; lastRunAt: string | null; pausedReason: string | null; socials: string[]; cadence: Cadence; days: number[] }

const CADENCE_OPTIONS: Array<{ key: Cadence; label: string; cap: number }> = [
  { key: 'daily', label: 'Every day', cap: 0 },
  { key: 'alternate', label: 'Every other day', cap: 0 },
  { key: '3x_week', label: '3 times a week', cap: 3 },
  { key: '2x_week', label: 'Twice a week', cap: 2 },
  { key: '1x_week', label: 'Once a week', cap: 1 },
]
const DOW = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' }, { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 0, label: 'Sun' },
]

const SOCIALS: Array<{ key: string; label: string }> = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'twitter', label: 'X' },
  { key: 'threads', label: 'Threads' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'bluesky', label: 'Bluesky' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'pinterest', label: 'Pinterest' },
]

export default function AutoPilotModal({ onClose, onChange }: { onClose: () => void; onChange?: (enabled: boolean) => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [state, setState] = useState<AutoState>({ enabled: false, lastRunAt: null, pausedReason: null, socials: [], cadence: 'daily', days: [] })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/blog/autopilot')
        const d = await res.json()
        if (!cancelled && d.autopilot) setState({ socials: [], cadence: 'daily', days: [], ...d.autopilot })
      } catch { /* keep defaults */ } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function save(patch: { enabled?: boolean; socials?: string[]; cadence?: Cadence; days?: number[] }) {
    setSaving(true)
    try {
      const res = await fetch('/api/blog/autopilot', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not save')
      setState({ socials: [], cadence: 'daily', days: [], ...d.autopilot })
      onChange?.(d.autopilot?.enabled === true)
      if (patch.enabled !== undefined) toast.success(patch.enabled ? 'Auto-pilot on — one post a day' : 'Auto-pilot off')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }
  const setEnabled = (enabled: boolean) => save({ enabled })
  function toggleSocial(key: string) {
    const next = state.socials.includes(key) ? state.socials.filter(s => s !== key) : [...state.socials, key]
    save({ enabled: state.enabled, socials: next })
  }
  const capFor = (c: Cadence) => CADENCE_OPTIONS.find(o => o.key === c)?.cap ?? 0
  function setCadence(cadence: Cadence) {
    const cap = capFor(cadence)
    // Keep at most `cap` chosen days when switching into a weekly cadence.
    const days = cap > 0 ? state.days.slice(0, cap) : []
    save({ enabled: state.enabled, cadence, days })
  }
  function toggleDay(n: number) {
    const cap = capFor(state.cadence)
    if (cap === 0) return
    let next: number[]
    if (state.days.includes(n)) next = state.days.filter(d => d !== n)
    else next = [...state.days, n].slice(-cap) // keep newest within the cap (FIFO)
    save({ enabled: state.enabled, cadence: state.cadence, days: next.sort((a, b) => a - b) })
  }

  const pausedNote = state.pausedReason === 'cap'
    ? "Paused: you've used this month's post allowance. It resumes next billing cycle."
    : state.pausedReason === 'spend'
    ? 'Paused: monthly AI-spend safety limit reached. It resumes next billing cycle.'
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="card w-full max-w-lg p-0 max-h-[86vh] flex flex-col bg-white dark:bg-[#18181b]" onClick={e => e.stopPropagation()}>
        <div className="shrink-0 flex items-start justify-between px-5 pt-5 pb-3 border-b border-[var(--border-2,#e5e5e7)]">
          <div className="flex items-center gap-2">
            <Rocket size={18} className="text-[#7C3AED]" />
            <div>
              <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Auto-pilot</h3>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Hands-off publishing on your schedule.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white p-1" title="Close"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#86868b] py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-lg border border-[var(--border-2,#e5e5e7)] px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Auto-publish on a schedule</div>
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

            {state.enabled && (
              <div>
                <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">How often</label>
                <div className="flex flex-col gap-1.5">
                  {CADENCE_OPTIONS.map(o => {
                    const on = state.cadence === o.key
                    return (
                      <div key={o.key}>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setCadence(o.key)}
                          className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition disabled:opacity-60"
                          style={{ borderColor: on ? '#7C3AED' : 'var(--border-2,#e5e5e7)', background: on ? 'rgba(124,58,237,0.08)' : 'transparent', color: 'var(--text,#1d1d1f)' }}
                        >
                          <span>{o.label}</span>
                          <span className="text-[10px] font-bold" style={{ color: on ? '#7C3AED' : '#c7c7cc' }}>{on ? 'ON' : ''}</span>
                        </button>
                        {on && o.cap > 0 && (
                          <div className="mt-1.5 mb-1 pl-1">
                            <div className="flex flex-wrap gap-1">
                              {DOW.map(d => {
                                const dOn = state.days.includes(d.n)
                                return (
                                  <button
                                    key={d.n}
                                    type="button"
                                    disabled={saving}
                                    onClick={() => toggleDay(d.n)}
                                    className="rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:opacity-60"
                                    style={{ borderColor: dOn ? '#7C3AED' : 'var(--border-2,#e5e5e7)', background: dOn ? '#7C3AED' : 'transparent', color: dOn ? '#fff' : 'var(--text-faint,#86868b)' }}
                                  >
                                    {d.label}
                                  </button>
                                )
                              })}
                            </div>
                            <p className="text-[10px] text-[#86868b] mt-1">Pick {o.cap} {o.cap === 1 ? 'day' : 'days'}.{state.days.length > 0 ? '' : ' No day picked yet — it won’t post until you choose.'}</p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {state.enabled && (
              <div>
                <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Also auto-post to socials</label>
                <div className="grid grid-cols-2 gap-2">
                  {SOCIALS.map(s => {
                    const on = state.socials.includes(s.key)
                    return (
                      <button
                        key={s.key}
                        type="button"
                        disabled={saving}
                        onClick={() => toggleSocial(s.key)}
                        className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition disabled:opacity-60"
                        style={{ borderColor: on ? '#7C3AED' : 'var(--border-2,#e5e5e7)', background: on ? 'rgba(124,58,237,0.08)' : 'transparent', color: 'var(--text,#1d1d1f)' }}
                      >
                        <span>{s.label}</span>
                        <span className="text-[10px] font-bold" style={{ color: on ? '#7C3AED' : '#c7c7cc' }}>{on ? 'ON' : ''}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-[#86868b] mt-1.5">When the daily post goes live it also posts to the channels you pick here (default caption: title + link). Only connected channels on your plan will fire.</p>
              </div>
            )}

            <details className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0]">
              <summary className="cursor-pointer text-[#7C3AED] font-medium">How it works</summary>
              <ul className="space-y-1.5 leading-relaxed mt-2">
                <li>• Turns your next un-blogged YouTube video into a full post (hero + in-article images).</li>
                <li>• Posts on the schedule above (up to one a day), from your monthly post allowance. Every day suits Studio and Pro; on Creator, pick a lighter cadence so it lasts the month.</li>
                <li>• Blog only by default. Turn on socials above to auto-post as each post goes live.</li>
                <li>• Out of monthly allowance? It pauses, emails you, and resumes next cycle. Want more sooner? Generate posts manually.</li>
              </ul>
            </details>
          </div>
        )}
        </div>

        <div className="shrink-0 flex justify-end px-5 py-3 border-t border-[var(--border-2,#e5e5e7)]">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9]">Done</button>
        </div>
      </div>
    </div>
  )
}
