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
  blogPostId, scheduledAt, platforms, title, link, bodies, onClose, onSaved,
}: {
  blogPostId: string
  scheduledAt: string
  platforms: string[]
  title?: string | null
  link?: string | null
  /** Current per-channel captions for already-queued platforms. */
  bodies?: Record<string, string>
  onClose: () => void
  onSaved: () => void
}) {
  const original = new Set(platforms)
  const defaultCaption = `${(title || 'New post').trim()}${link ? `\n\n${link}` : ''}`
  const [when, setWhen] = useState(isoToLocalInput(scheduledAt))
  const [selected, setSelected] = useState<Set<string>>(new Set(platforms))
  // Per-channel caption text. Seeded from the current queued bodies; a newly
  // toggled-on channel seeds with the default (title + link) so it's editable.
  const [captions, setCaptions] = useState<Record<string, string>>(() => ({ ...(bodies || {}) }))
  const [saving, setSaving] = useState(false)

  function toggle(key: string) {
    setSelected(s => {
      const n = new Set(s)
      if (n.has(key)) { n.delete(key) } else {
        n.add(key)
        setCaptions(c => (c[key] && c[key].trim()) ? c : { ...c, [key]: defaultCaption })
      }
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

    // Captions to send for every selected channel (new + edited existing).
    const outBodies: Record<string, string> = {}
    let captionChanged = false
    for (const p of selected) {
      const text = (captions[p] ?? '').trim()
      if (text) outBodies[p] = text
      if (text !== (bodies?.[p] ?? '').trim() && !addPlatforms.includes(p)) captionChanged = true
    }

    if (!rescheduled && addPlatforms.length === 0 && removePlatforms.length === 0 && !captionChanged) {
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
          bodies: outBodies,
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
    // Outer overlay scrolls too, as a fallback on very short screens. The card
    // is height-capped with a scrollable middle so the Save button is always
    // reachable — it used to grow past the viewport (all 7 platforms open) and
    // strand Save off-screen with no way to scroll inside the modal.
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/50 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-md bg-white dark:bg-[#18181b] max-h-[90vh] flex flex-col overflow-hidden my-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <CalendarClock size={18} className="text-[#7C3AED]" />
            <div>
              <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Edit schedule</h3>
              {title && <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 truncate max-w-[300px]">{title}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white p-1" title="Close"><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-4 px-5 overflow-y-auto overscroll-contain flex-1 min-h-0">
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
            <div className="flex flex-col gap-2">
              {PLATFORMS.map(p => {
                const on = selected.has(p.key)
                return (
                  <div key={p.key} className="rounded-lg border" style={{ borderColor: on ? '#7C3AED' : 'var(--border-2,#e5e5e7)', background: on ? 'rgba(124,58,237,0.06)' : 'transparent' }}>
                    <button
                      type="button"
                      onClick={() => toggle(p.key)}
                      className="flex w-full items-center justify-between px-3 py-2 text-sm"
                      style={{ color: 'var(--text,#1d1d1f)' }}
                    >
                      <span className="font-medium">{p.label}</span>
                      <span className="text-[10px] font-bold" style={{ color: on ? '#7C3AED' : '#c7c7cc' }}>{on ? 'ON' : 'OFF'}</span>
                    </button>
                    {on && (
                      <div className="px-3 pb-2.5">
                        <textarea
                          value={captions[p.key] ?? ''}
                          onChange={e => setCaptions(c => ({ ...c, [p.key]: e.target.value }))}
                          rows={2}
                          placeholder={`Caption for ${p.label}…`}
                          className="w-full px-2.5 py-2 rounded-md border text-[13px] leading-snug resize-y focus:outline-none focus:border-[#7C3AED]"
                          style={{ borderColor: 'var(--border-2,#e5e5e7)', background: 'var(--surface,#fff)', color: 'var(--text,#1d1d1f)' }}
                        />
                        <button
                          type="button"
                          onClick={() => setCaptions(c => ({ ...c, [p.key]: defaultCaption }))}
                          className="text-[10px] text-[#86868b] hover:text-[#7C3AED] mt-1"
                        >
                          Reset to default
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-[10px] text-[#86868b] mt-1.5">Edit each channel&rsquo;s caption above. Only connected channels on your plan will queue; the rest are skipped.</p>
          </div>
        </div>

        {/* Footer pinned below the scroll area — always reachable. */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-2,#e5e5e7)] px-5 py-3 flex-shrink-0">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] hover:bg-[var(--surface-hover,#f5f5f7)]">Cancel</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-60">
            {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save changes
          </button>
        </div>
      </div>
    </div>
  )
}
