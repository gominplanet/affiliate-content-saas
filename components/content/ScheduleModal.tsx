// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// ScheduleModal — pick a future date/time + which socials to cascade.
//
// Triggered from the "Schedule" button on each Library row. Calls
// /api/blog/schedule-publish which generates the post NOW (so the user
// gets immediate preview + the credit is consumed up front) and queues:
//
//   - kind='blog_publish' parent row (draft-flip mode only; wp-native
//     scheduling leaves the actual go-live to WP's own cron)
//   - one kind='social' child row per chosen channel, at scheduledFor +
//     per-platform offset
//
// Two modes (a checkbox toggle inside the modal):
//   - WP-native (default): WP holds the post with status=future +
//     post_date=scheduledFor. WP cron handles publish. Most reliable.
//   - draft-flip: WP holds it as draft; our cron flips it. Use when
//     the creator wants the editing window between gen and publish.
//
// The "Publish to all"-style cascade defaults to firing every connected
// channel 5 minutes after the blog goes live (so the URL is reliably
// live before any link-bearing push).
//
// Newsletter is intentionally NOT in the cascade — the Resend-backed
// send flow has its own scheduling (lib/newsletter-send.ts + the
// newsletter compose page) with subject lines, segments, and A/B
// support. Wiring it through this modal would be duplicate UX with
// worse capability. Use the Newsletter page to schedule a blast.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Calendar, Loader2, X } from 'lucide-react'
import type { SchedulableSocial, ScheduleMode } from '@/lib/schedule-types'
import { DEFAULT_SOCIAL_OFFSETS_MIN } from '@/lib/schedule-types'

/** Platforms surfaced in the modal. Order is intentional — cheapest,
 *  fastest, lowest-friction channels at the top. Pinterest / Instagram
 *  / TikTok aren't in the cron's social switch yet, so they're excluded;
 *  add when the cron worker gains a publishOne case for them. */
const CHANNEL_OPTIONS: Array<{ key: SchedulableSocial; label: string }> = [
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'threads', label: 'Threads' },
  { key: 'twitter', label: 'X / Twitter' },
  { key: 'bluesky', label: 'Bluesky' },
]

export interface ScheduleModalProps {
  /** youtube_videos.id — the source video to generate the post FROM. */
  videoId: string
  /** Video title for the modal header. */
  videoTitle: string
  /** Which channels the user has actually connected. Channels not in
   *  this set render disabled with "Connect to use". */
  connectedChannels: ReadonlySet<SchedulableSocial>
  /** Multi-site (Pro): wordpress_sites.id the post should land on. */
  siteId?: string | null
  /** Open/close control. Owned by the parent (the row). */
  open: boolean
  onClose: () => void
  /** Fired on a successful schedule. Parent uses this to refresh the
   *  Scheduled tab and show a success toast. */
  onScheduled: (result: { parentScheduleId: string | null; childScheduleIds: string[]; mode: ScheduleMode; scheduledFor: string }) => void
}

/**
 * Minimum allowed schedule time. The route enforces +1 min server-side;
 * we default the picker to +1 hour for a saner first-time UX (typing in
 * a time 2 min from now usually meant "right now").
 */
function defaultScheduleIso(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() + 60)
  // Round to the nearest 15 min — feels like a sensible default.
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15)
  d.setSeconds(0)
  d.setMilliseconds(0)
  // <input type="datetime-local"> wants YYYY-MM-DDTHH:mm (local, no Z).
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ScheduleModal({
  videoId, videoTitle, connectedChannels, siteId, open, onClose, onScheduled,
}: ScheduleModalProps) {
  const [scheduledFor, setScheduledFor] = useState<string>(() => defaultScheduleIso())
  const [draftFlip, setDraftFlip] = useState(false)
  // Default to all CONNECTED channels selected — every channel the user
  // already wired up gets the cascade. Channels they haven't connected
  // can't be toggled on. Recomputed when the connected set changes (e.g.
  // user closed + reopened the modal after connecting LinkedIn).
  const [selectedChannels, setSelectedChannels] = useState<Set<SchedulableSocial>>(() => new Set(CHANNEL_OPTIONS.map(c => c.key).filter(k => connectedChannels.has(k))))
  useEffect(() => {
    if (open) setSelectedChannels(new Set(CHANNEL_OPTIONS.map(c => c.key).filter(k => connectedChannels.has(k))))
  }, [open, connectedChannels])

  // Show / hide the Advanced per-channel offset overrides. Defaults are
  // good for almost everyone; power users get the knob.
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [offsetOverrides, setOffsetOverrides] = useState<Partial<Record<SchedulableSocial, number>>>({})

  const [submitting, setSubmitting] = useState(false)
  // Reset the submitting flag whenever the modal opens. Important: the
  // dynamic-imported modal stays mounted, so local state persists across
  // open/close cycles. Without this reset, a previous submit's pending
  // setSubmitting(false) could race with the next open, leaving the
  // defensive `submitting` guard locked to hidden.
  useEffect(() => { if (open) setSubmitting(false) }, [open])

  const scheduleMode: ScheduleMode = draftFlip ? 'draft-flip' : 'wp-native'

  // Derive a friendly summary for the bottom of the modal so the user
  // sees exactly what they're queueing before clicking Schedule.
  const summary = useMemo(() => {
    const t = scheduledFor ? new Date(scheduledFor) : null
    if (!t || isNaN(t.getTime())) return null
    const dt = t.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
    const list = [...selectedChannels].map(p => CHANNEL_OPTIONS.find(c => c.key === p)?.label || p).join(', ') || 'no social pushes'
    return { dt, list }
  }, [scheduledFor, selectedChannels])

  // Defensive close: hide the modal whenever `submitting` flips on, even
  // if the parent's onClose() prop hasn't fully propagated through React's
  // cross-component batching yet. Without this, a slow parent re-render
  // can leave the modal visibly stuck on "Scheduling…" until the fetch
  // returns 30-60s later — exactly the bug the user reported.
  if (!open || submitting) return null

  /**
   * Submit handler. Closes the modal IMMEDIATELY then runs the schedule
   * as a background promise — so the user can keep using the rest of
   * the Library while their post is being generated + queued.
   *
   * A persistent sonner toast carries the status:
   *   "Writing post & scheduling…" (loading, persistent)
   *      ↓
   *   "Scheduled for X" (success) OR "Schedule failed: msg" (error)
   *
   * The fetch promise survives the modal unmount (it lives in a JS
   * closure, not the React tree), so closing the window during the
   * 30-60s gen wait doesn't cancel it. The success toast + Library
   * row badge update both fire whether the modal is still open or not.
   */
  function handleSubmit() {
    const whenMs = new Date(scheduledFor).getTime()
    if (isNaN(whenMs)) {
      toast.error('Pick a valid date/time')
      return
    }
    if (whenMs <= Date.now() + 60_000) {
      toast.error('Pick a time at least 1 minute in the future')
      return
    }

    // Snapshot every input the background fetch needs BEFORE we close
    // the modal — closing unmounts the component and React resets the
    // useState values, but the closure here keeps these references alive.
    const socials = [...selectedChannels].map(platform => ({
      platform,
      offsetMinutes: offsetOverrides[platform],
      bodyText: videoTitle.slice(0, 280),
    }))
    const localIso = new Date(scheduledFor).toISOString()
    const localScheduleMode = scheduleMode
    const localVideoId = videoId
    const localSiteId = siteId ?? null
    const localVideoTitle = videoTitle

    // Show a persistent loading toast — survives the modal unmount and
    // updates in place when the fetch resolves. The id lets us swap
    // loading → success/error on the SAME toast row so the user sees
    // continuity rather than a flicker.
    const toastId = toast.loading(`Writing "${localVideoTitle.slice(0, 40)}${localVideoTitle.length > 40 ? '…' : ''}" & scheduling…`, {
      duration: Infinity,
    })

    // Close the modal NOW. Submit state is briefly visible during the
    // few-ms gap before close — set it for the disabled-button visual
    // but don't block on it.
    setSubmitting(true)
    onClose()

    // Fire the fetch and detach. Anything below runs regardless of
    // whether the modal is still mounted.
    void (async () => {
      try {
        const res = await fetch('/api/blog/schedule-publish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            videoId: localVideoId,
            siteId: localSiteId,
            scheduleMode: localScheduleMode,
            scheduledFor: localIso,
            socials,
            includeImages: true,
          }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
          parentScheduleId?: string | null
          childScheduleIds?: string[]
          warning?: string
        }
        if (!res.ok || !json.ok) {
          toast.error(json.error || `Schedule failed (${res.status})`, { id: toastId, duration: 8_000 })
          return
        }
        if (json.warning) toast.warning(json.warning)
        toast.success(`Scheduled for ${new Date(localIso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`, {
          id: toastId,
          duration: 6_000,
        })
        onScheduled({
          parentScheduleId: json.parentScheduleId ?? null,
          childScheduleIds: json.childScheduleIds ?? [],
          mode: localScheduleMode,
          scheduledFor: localIso,
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Schedule failed', { id: toastId, duration: 8_000 })
      } finally {
        // Component might already be unmounted by now (modal closed) —
        // React 18+ tolerates state writes on unmounted components, so
        // this is safe even though the value won't be read again.
        setSubmitting(false)
      }
    })()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-xl rounded-2xl border shadow-2xl"
        style={{ backgroundColor: 'var(--bg, #0E0E11)', color: 'var(--text, #F5F5F7)', borderColor: 'var(--border, rgba(255,255,255,0.08))' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-modal-title"
      >
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-[#7C3AED]" />
            <h2 id="schedule-modal-title" className="text-lg font-semibold">Schedule post</h2>
          </div>
          <button onClick={onClose} className="opacity-60 hover:opacity-100 transition-opacity" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Video title — context */}
          <div>
            <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint, rgba(255,255,255,0.5))' }}>
              Source video
            </p>
            <p className="text-sm font-medium truncate">{videoTitle}</p>
          </div>

          {/* Date / time picker */}
          <div>
            <label htmlFor="schedule-when" className="block text-sm font-medium mb-1.5">
              Publish on
            </label>
            <input
              id="schedule-when"
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm"
              style={{ borderColor: 'var(--border-bright, rgba(255,255,255,0.14))', color: 'var(--text, #F5F5F7)' }}
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint, rgba(255,255,255,0.5))' }}>
              Your local time. Must be at least 1 minute in the future.
            </p>
          </div>

          {/* Draft-flip toggle */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={draftFlip}
              onChange={(e) => setDraftFlip(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-[#7C3AED]"
            />
            <div>
              <p className="text-sm font-medium">Save as draft until then so I can edit before it goes live</p>
              <p className="text-[12px]" style={{ color: 'var(--text-faint, rgba(255,255,255,0.5))' }}>
                {draftFlip
                  ? 'WordPress holds the post as a draft. MVP flips it to publish at the chosen time.'
                  : 'WordPress holds the post as scheduled (status=future) and publishes it natively at the chosen time. Most reliable.'}
              </p>
            </div>
          </label>

          {/* Social cascade */}
          <div>
            <p className="text-sm font-medium mb-2">Push to socials when it goes live</p>
            <div className="grid grid-cols-2 gap-2">
              {CHANNEL_OPTIONS.map((opt) => {
                const isConnected = connectedChannels.has(opt.key)
                const isChecked = selectedChannels.has(opt.key)
                return (
                  <label
                    key={opt.key}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${isConnected ? '' : 'opacity-50 cursor-not-allowed'}`}
                    style={{
                      borderColor: isChecked ? '#7C3AED' : 'var(--border, rgba(255,255,255,0.08))',
                      backgroundColor: isChecked ? 'rgba(124,58,237,0.10)' : 'transparent',
                    }}
                    title={isConnected ? '' : 'Connect this channel in Setup → Connect Socials to enable scheduling'}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked && isConnected}
                      disabled={!isConnected}
                      onChange={(e) => {
                        setSelectedChannels((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(opt.key)
                          else next.delete(opt.key)
                          return next
                        })
                      }}
                      className="w-3.5 h-3.5 rounded accent-[#7C3AED]"
                    />
                    <span className="text-sm">{opt.label}</span>
                    {!isConnected && (
                      <span className="ml-auto text-[10px] opacity-70">Connect to use</span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>

          {/* Advanced offsets */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(s => !s)}
              className="text-xs underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100"
            >
              {showAdvanced ? 'Hide advanced' : 'Advanced: per-channel offset'}
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-2">
                <p className="text-[11px]" style={{ color: 'var(--text-faint, rgba(255,255,255,0.5))' }}>
                  Minutes after the blog goes live that each channel fires.
                  Default {DEFAULT_SOCIAL_OFFSETS_MIN.linkedin} min for all socials.
                </p>
                {CHANNEL_OPTIONS.map((opt) => {
                  if (!selectedChannels.has(opt.key)) return null
                  const value = offsetOverrides[opt.key] ?? DEFAULT_SOCIAL_OFFSETS_MIN[opt.key]
                  return (
                    <div key={opt.key} className="flex items-center gap-2">
                      <span className="text-sm w-28">{opt.label}</span>
                      <input
                        type="number"
                        min={0}
                        max={1440}
                        value={value}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10)
                          setOffsetOverrides((prev) => ({ ...prev, [opt.key]: isNaN(n) ? 0 : n }))
                        }}
                        className="w-20 px-2 py-1 rounded border bg-transparent text-sm"
                        style={{ borderColor: 'var(--border-bright, rgba(255,255,255,0.14))', color: 'var(--text, #F5F5F7)' }}
                      />
                      <span className="text-xs opacity-70">min</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Summary */}
          {summary && (
            <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', backgroundColor: 'var(--surface, rgba(255,255,255,0.03))' }}>
              <p>
                <span className="font-semibold">Goes live:</span> {summary.dt}
              </p>
              <p className="mt-1">
                <span className="font-semibold">Then pushes to:</span>{' '}
                <span className={selectedChannels.size === 0 ? 'opacity-60' : ''}>{summary.list}</span>
              </p>
            </div>
          )}
        </div>

        <div className="p-5 border-t flex items-center justify-end gap-2" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 rounded-lg text-sm font-medium opacity-80 hover:opacity-100 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 bg-gradient-to-r from-[#7C3AED] to-[#5856D6] text-white shadow-md hover:shadow-lg transition-shadow disabled:opacity-60"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />}
            {submitting ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
