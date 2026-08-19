'use client'

/**
 * ScheduleEditModal — edit an already-scheduled blog post's date/time and its
 * social platforms (add e.g. Facebook now that it's connected, or drop one)
 * WITHOUT regenerating the post. Calls PATCH /api/blog/schedule-edit. The server
 * validates connection + plan and reports any platforms it had to skip.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { X, Loader2, CalendarClock } from 'lucide-react'

const PLATFORMS: Array<{ key: string; label: string }> = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'twitter', label: 'X' },
  { key: 'threads', label: 'Threads' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'bluesky', label: 'Bluesky' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'pinterest', label: 'Pinterest' },
]

/** ISO → value for <input type="datetime-local"> in the viewer's local zone. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ScheduleEditModal({
  blogPostId, scheduledAt, platforms, title, onClose, onSaved,
}: {
  blogPostId: string
  scheduledAt: string
  platforms: string[]
  title?: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const original = new Set(platforms)
  const [when, setWhen] = useState(isoToLocalInput(scheduledAt))
  const [selected, setSelected] = useState<Set<string>>(new Set(platforms))
  const [saving, setSaving] = useState(false)

  function toggle(key: string) {
    setSelected(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  async function save() {
    const iso = when ? new Date(when).toISOString() : null
    if (when && (isNaN(new Date(when).getTime()))) { toast.error('Pick a valid date and time'); return }
    if (iso && new Date(iso).getTime() <= Date.now() + 60_000) { toast.error('Pick a time at least a minute from now'); return }

    const addPlatforms = [...selected].filter(p => !original.has(p))
    const removePlatforms = [...original].filter(p => !selected.has(p))
    const rescheduled = iso && isoToLocalInput(scheduledAt) !== when

    if (!rescheduled && addPlatforms.length === 0 && removePlatforms.length === 0) {
      toast.message('Nothing changed'); return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/blog/schedule-edit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blogPostId,
          ...(rescheduled ? { scheduledFor: iso } : {}),
          addPlatforms,
          removePlatforms,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not update the schedule')
      if (Array.isArray(d.skipped) && d.skipped.length) {
        toast.message(`Skipped: ${d.skipped.join(', ')}`)
      }
      toast.success('Schedule updated')
      onSaved()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the schedule')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="card w-full max-w-md p-5 bg-white dark:bg-[#18181b]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <CalendarClock size={18} className="text-[#7C3AED]" />
            <div>
              <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Edit schedule</h3>
              {title && <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 truncate max-w-[300px]">{title}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white p-1" title="Close"><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Publish date &amp; time</label>
            <input
              type="datetime-local"
              value={when}
              onChange={e => setWhen(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] bg-[var(--surface,#fff)] text-sm focus:outline-none focus:border-[#7C3AED]"
            />
            <p className="text-[10px] text-[#86868b] mt-1">Social posts shift with it, keeping their spacing.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Post to socials</label>
            <div className="grid grid-cols-2 gap-2">
              {PLATFORMS.map(p => {
                const on = selected.has(p.key)
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => toggle(p.key)}
                    className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition"
                    style={{
                      borderColor: on ? '#7C3AED' : 'var(--border-2,#e5e5e7)',
                      background: on ? 'rgba(124,58,237,0.08)' : 'transparent',
                      color: 'var(--text,#1d1d1f)',
                    }}
                  >
                    <span>{p.label}</span>
                    <span className="text-[10px] font-bold" style={{ color: on ? '#7C3AED' : '#c7c7cc' }}>{on ? 'ON' : ''}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-[#86868b] mt-1.5">Newly added channels post with a default caption (title + link). Only connected channels on your plan will queue.</p>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-2,#e5e5e7)] pt-3">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] hover:bg-[var(--surface-hover,#f5f5f7)]">Cancel</button>
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
