// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// BulkScheduleVideosModal — generate + schedule a batch of un-generated
// videos as a content calendar.
//
// Given N selected videos, the user picks a start time + cadence
// (1/day, 2/day, every-N-hours, every-N-days) + which socials to push
// for each. The modal calls /api/blog/schedule-publish once per video
// with a staggered timestamp. Per-video progress bar as each generation
// completes.
//
// Use case: you imported 30 videos from a YouTube channel, want a
// month-long content drip with auto-publish + auto-social-push. One
// click instead of 30 manual Schedule clicks.
//
// NOT for: scheduling individual social pushes for already-live posts
// — that's the existing BulkScheduleModal. Different problem space.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Calendar, Loader2, X, CheckCircle2, AlertCircle } from 'lucide-react'
import type { SchedulableSocial, ScheduleMode } from '@/lib/schedule-types'
import { DEFAULT_SOCIAL_OFFSETS_MIN } from '@/lib/schedule-types'

interface VideoItem {
  id: string
  title: string
}

const CHANNEL_OPTIONS: Array<{ key: SchedulableSocial; label: string }> = [
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'threads', label: 'Threads' },
  { key: 'twitter', label: 'X / Twitter' },
  { key: 'bluesky', label: 'Bluesky' },
  { key: 'pinterest', label: 'Pinterest' },
]

type Cadence = 'every-30min' | 'every-1hr' | 'every-3hr' | 'every-6hr' | '2-per-day' | '1-per-day' | 'every-2-days' | 'every-3-days' | 'every-7-days'

const CADENCE_OPTIONS: Array<{ key: Cadence; label: string; minutesBetween: number }> = [
  { key: 'every-30min',   label: 'Every 30 minutes',     minutesBetween: 30 },
  { key: 'every-1hr',     label: 'Every hour',           minutesBetween: 60 },
  { key: 'every-3hr',     label: 'Every 3 hours',        minutesBetween: 180 },
  { key: 'every-6hr',     label: 'Every 6 hours',        minutesBetween: 360 },
  { key: '2-per-day',     label: '2 per day (12h apart)', minutesBetween: 720 },
  { key: '1-per-day',     label: 'One per day',          minutesBetween: 1440 },
  { key: 'every-2-days',  label: 'Every 2 days',         minutesBetween: 2880 },
  { key: 'every-3-days',  label: 'Every 3 days',         minutesBetween: 4320 },
  { key: 'every-7-days',  label: 'Weekly',               minutesBetween: 10080 },
]

interface RowStatus {
  videoId: string
  state: 'queued' | 'running' | 'success' | 'error'
  message?: string
  scheduledFor: string
}

export interface BulkScheduleVideosModalProps {
  videos: VideoItem[]
  connectedChannels: ReadonlySet<SchedulableSocial>
  siteId?: string | null
  open: boolean
  onClose: () => void
  /** Fired when ALL videos have been processed. Parent uses this to
   *  refresh the Library + Scheduled tab. result.successCount and
   *  result.failureCount let the caller decide how to toast. */
  onDone: (result: { successCount: number; failureCount: number; videoIds: string[] }) => void
}

function defaultStartIso(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() + 60)
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15)
  d.setSeconds(0)
  d.setMilliseconds(0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function BulkScheduleVideosModal({
  videos, connectedChannels, siteId, open, onClose, onDone,
}: BulkScheduleVideosModalProps) {
  const [startIso, setStartIso] = useState<string>(() => defaultStartIso())
  const [cadence, setCadence] = useState<Cadence>('1-per-day')
  const [draftFlip, setDraftFlip] = useState(false)
  const [selectedChannels, setSelectedChannels] = useState<Set<SchedulableSocial>>(() => new Set(CHANNEL_OPTIONS.map(c => c.key).filter(k => connectedChannels.has(k))))

  const [running, setRunning] = useState(false)
  const [rowStatuses, setRowStatuses] = useState<RowStatus[]>([])

  useEffect(() => {
    if (open) {
      setSelectedChannels(new Set(CHANNEL_OPTIONS.map(c => c.key).filter(k => connectedChannels.has(k))))
      setRowStatuses([])
      setRunning(false)
    }
  }, [open, connectedChannels])

  // Pre-compute the schedule plan — every video's scheduled timestamp.
  // Recomputed any time start/cadence/videos changes so the user can
  // see "Video 1 → Mon Jun 9 at 9am, Video 2 → Tue Jun 10 at 9am, …"
  // before clicking Schedule.
  const plan = useMemo(() => {
    const cadenceMin = CADENCE_OPTIONS.find(c => c.key === cadence)?.minutesBetween ?? 1440
    const startMs = new Date(startIso).getTime()
    if (isNaN(startMs)) return []
    return videos.map((v, i) => ({
      videoId: v.id,
      title: v.title,
      scheduledFor: new Date(startMs + i * cadenceMin * 60_000).toISOString(),
    }))
  }, [videos, startIso, cadence])

  const scheduleMode: ScheduleMode = draftFlip ? 'draft-flip' : 'wp-native'

  if (!open) return null

  async function handleSubmit() {
    if (plan.length === 0) {
      toast.error('No videos selected')
      return
    }
    const startMs = new Date(startIso).getTime()
    if (isNaN(startMs) || startMs <= Date.now() + 60_000) {
      toast.error('Pick a start time at least 1 minute in the future')
      return
    }
    setRunning(true)

    // Seed all rows as queued.
    const initial: RowStatus[] = plan.map(p => ({
      videoId: p.videoId,
      state: 'queued',
      scheduledFor: p.scheduledFor,
    }))
    setRowStatuses(initial)

    // Fire requests with limited concurrency — each schedule-publish does
    // a full blog generation (~30-60s), so running them all in parallel
    // would overwhelm both client and server. Use a small worker pool.
    const CONCURRENCY = 3
    const queue = [...plan]
    let successCount = 0
    let failureCount = 0

    async function worker() {
      while (queue.length > 0) {
        const job = queue.shift()
        if (!job) return
        setRowStatuses(prev => prev.map(r => r.videoId === job.videoId ? { ...r, state: 'running' } : r))
        try {
          const res = await fetch('/api/blog/schedule-publish', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              videoId: job.videoId,
              siteId: siteId ?? null,
              scheduleMode,
              scheduledFor: job.scheduledFor,
              socials: [...selectedChannels].map(p => ({
                platform: p,
                offsetMinutes: DEFAULT_SOCIAL_OFFSETS_MIN[p],
                bodyText: job.title.slice(0, 280),
              })),
              includeImages: true,
            }),
          })
          const j = await res.json().catch(() => ({}))
          if (!res.ok || !j.ok) {
            failureCount++
            setRowStatuses(prev => prev.map(r => r.videoId === job.videoId
              ? { ...r, state: 'error', message: j.error || `Failed (${res.status})` }
              : r))
          } else {
            successCount++
            setRowStatuses(prev => prev.map(r => r.videoId === job.videoId
              ? { ...r, state: 'success' }
              : r))
          }
        } catch (e) {
          failureCount++
          const msg = e instanceof Error ? e.message : String(e)
          setRowStatuses(prev => prev.map(r => r.videoId === job.videoId
            ? { ...r, state: 'error', message: msg }
            : r))
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, plan.length) }, () => worker())
    await Promise.all(workers)
    setRunning(false)

    if (successCount > 0) toast.success(`Scheduled ${successCount}/${plan.length} ${successCount === 1 ? 'post' : 'posts'}`)
    if (failureCount > 0) toast.error(`${failureCount} failed — see the modal for details`)
    onDone({ successCount, failureCount, videoIds: plan.map(p => p.videoId) })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={running ? undefined : onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-2xl rounded-2xl border shadow-2xl flex flex-col max-h-[90vh]"
        style={{ backgroundColor: 'var(--bg, #0E0E11)', color: 'var(--text, #F5F5F7)', borderColor: 'var(--border, rgba(255,255,255,0.08))' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-[#7C3AED]" />
            <h2 className="text-lg font-semibold">Bulk schedule {videos.length} videos</h2>
          </div>
          {!running && (
            <button onClick={onClose} className="opacity-60 hover:opacity-100 transition-opacity" aria-label="Close">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {/* Start time */}
          <div>
            <label htmlFor="bulk-start" className="block text-sm font-medium mb-1.5">Start time</label>
            <input
              id="bulk-start"
              type="datetime-local"
              value={startIso}
              disabled={running}
              onChange={(e) => setStartIso(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm disabled:opacity-60"
              style={{ borderColor: 'var(--border-bright, rgba(255,255,255,0.14))', color: 'var(--text, #F5F5F7)' }}
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint, rgba(255,255,255,0.5))' }}>
              First video fires at this time. Subsequent videos follow the cadence below.
            </p>
          </div>

          {/* Cadence */}
          <div>
            <label htmlFor="bulk-cadence" className="block text-sm font-medium mb-1.5">Cadence</label>
            <select
              id="bulk-cadence"
              value={cadence}
              disabled={running}
              onChange={(e) => setCadence(e.target.value as Cadence)}
              className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm disabled:opacity-60"
              style={{ borderColor: 'var(--border-bright, rgba(255,255,255,0.14))', color: 'var(--text, #F5F5F7)' }}
            >
              {CADENCE_OPTIONS.map(o => (
                <option key={o.key} value={o.key} style={{ background: '#0E0E11' }}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Draft-flip toggle */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={draftFlip}
              disabled={running}
              onChange={(e) => setDraftFlip(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-[#7C3AED]"
            />
            <div>
              <p className="text-sm font-medium">Save all as drafts so I can edit before each goes live</p>
              <p className="text-[12px]" style={{ color: 'var(--text-faint, rgba(255,255,255,0.5))' }}>
                {draftFlip
                  ? 'Posts land as drafts. Our cron flips each to publish at its scheduled time.'
                  : 'Posts land scheduled (status=future). WordPress publishes each natively.'}
              </p>
            </div>
          </label>

          {/* Social cascade */}
          <div>
            <p className="text-sm font-medium mb-2">Push to socials after each blog goes live</p>
            <div className="grid grid-cols-2 gap-2">
              {CHANNEL_OPTIONS.map((opt) => {
                const isConnected = connectedChannels.has(opt.key)
                const isChecked = selectedChannels.has(opt.key)
                return (
                  <label
                    key={opt.key}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${isConnected ? '' : 'opacity-50 cursor-not-allowed'} ${running ? 'opacity-60 cursor-not-allowed' : ''}`}
                    style={{
                      borderColor: isChecked ? '#7C3AED' : 'var(--border, rgba(255,255,255,0.08))',
                      backgroundColor: isChecked ? 'rgba(124,58,237,0.10)' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked && isConnected}
                      disabled={!isConnected || running}
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
                    {!isConnected && <span className="ml-auto text-[10px] opacity-70">Connect to use</span>}
                  </label>
                )
              })}
            </div>
          </div>

          {/* Plan preview / per-row progress */}
          <div>
            <p className="text-sm font-medium mb-2">Schedule plan ({plan.length})</p>
            <div className="rounded-lg border max-h-[240px] overflow-y-auto" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
              {plan.map((p, i) => {
                const rs = rowStatuses.find(r => r.videoId === p.videoId)
                const when = new Date(p.scheduledFor)
                const dt = when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                return (
                  <div key={p.videoId} className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--border, rgba(255,255,255,0.06))' }}>
                    <span className="text-xs opacity-50 w-6 tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate" title={p.title}>{p.title}</p>
                      <p className="text-[10px] opacity-60">{dt}</p>
                    </div>
                    <div className="flex-shrink-0 w-20 text-right">
                      {!rs && <span className="text-[10px] opacity-50">queued</span>}
                      {rs?.state === 'queued' && <span className="text-[10px] opacity-60">queued</span>}
                      {rs?.state === 'running' && <Loader2 size={12} className="animate-spin inline text-[#7C3AED]" />}
                      {rs?.state === 'success' && <CheckCircle2 size={12} className="inline text-[#34c759]" />}
                      {rs?.state === 'error' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[#ff3b30]" title={rs.message}>
                          <AlertCircle size={11} /> error
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="p-5 border-t flex items-center justify-end gap-2" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
          <button
            onClick={onClose}
            disabled={running}
            className="px-3 py-2 rounded-lg text-sm font-medium opacity-80 hover:opacity-100 disabled:opacity-40"
          >
            {running ? 'Working — please wait' : 'Cancel'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={running || plan.length === 0}
            className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 bg-gradient-to-r from-[#7C3AED] to-[#5856D6] text-white shadow-md hover:shadow-lg transition-shadow disabled:opacity-60"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />}
            {running ? `Scheduling ${rowStatuses.filter(r => r.state === 'success' || r.state === 'error').length}/${plan.length}…` : `Schedule ${plan.length}`}
          </button>
        </div>
      </div>
    </div>
  )
}
