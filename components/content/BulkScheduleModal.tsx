'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, Calendar, CheckCircle, AlertCircle } from 'lucide-react'

/** Lowercase platform key — matches the cron worker's switch. */
type Platform = 'facebook' | 'threads' | 'twitter' | 'linkedin' | 'bluesky' | 'telegram'

interface PlatformOpt {
  key: Platform
  label: string
  color: string
  connected: boolean
  /** Endpoint used to dry-run-generate the body text per (post × platform). */
  dryRunEndpoint: string
}

interface QueuedPost {
  postId: string
  videoTitle: string
}

/**
 * Bulk-schedule modal. Given N selected posts and a set of connected
 * platforms, this:
 *
 *   1. Asks the user to pick which platforms to publish to.
 *   2. Asks for a first-post time + interval between posts (e.g. 30 min).
 *   3. For each (post × platform) combination, dry-run-generates the body
 *      text via the platform's own endpoint, then queues it via
 *      /api/blog/schedule-post with a staggered timestamp.
 *
 * Why client-side text generation: every social endpoint already supports
 * { dryRun: true } and returns the text. Doing it client-side keeps the
 * server simple and gives us a per-row progress bar.
 *
 * Stagger ensures posts don't all hit the same minute (rate limits + better
 * engagement). Math: post N goes at firstAt + N × intervalMins minutes.
 * One platform's stagger is independent of another's — both start at firstAt.
 */
export function BulkScheduleModal({
  posts,
  platforms,
  onClose,
  onScheduled,
}: {
  posts: QueuedPost[]
  platforms: PlatformOpt[]
  onClose: () => void
  /** Called once after the whole batch is done. */
  onScheduled: (counts: { ok: number; failed: number; firstError: string | null }) => void
}) {
  // Default selection: every connected platform is on.
  const initialSelected = useMemo(
    () => new Set<Platform>(platforms.filter(p => p.connected).map(p => p.key)),
    [platforms],
  )
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(initialSelected)
  const [firstAt, setFirstAt] = useState<string>(() => defaultStartString())
  const [intervalMins, setIntervalMins] = useState<number>(30)

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const totalJobs = posts.length * selectedPlatforms.size

  function togglePlatform(p: Platform) {
    setSelectedPlatforms(prev => {
      const next = new Set(prev)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })
  }

  async function run() {
    if (!totalJobs) return
    setRunning(true)
    setError(null)
    setProgress({ done: 0, total: totalJobs })

    let ok = 0
    let failed = 0
    let firstError: string | null = null
    let jobIdx = 0

    const startMs = new Date(firstAt).getTime()
    if (isNaN(startMs)) {
      setError('Invalid start time')
      setRunning(false)
      setProgress(null)
      return
    }

    // For each post × platform: dry-run-generate text, schedule with stagger.
    // Inner loop is platform so consecutive scheduled times alternate posts
    // (post 1 to platform A, post 1 to platform B, post 2 to platform A…) —
    // means a viewer who follows multiple platforms doesn't see the same
    // creator hit them with N back-to-back identical posts. Better feel.
    for (let p = 0; p < posts.length; p++) {
      for (const platform of selectedPlatforms) {
        const cfg = platforms.find(x => x.key === platform)!
        const offsetMins = jobIdx * intervalMins
        const scheduledAt = new Date(startMs + offsetMins * 60_000).toISOString()
        const postId = posts[p].postId

        try {
          // 1. Dry-run to get the body text (uses the same endpoint as the manual flow)
          const dryRes = await fetch(cfg.dryRunEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId, dryRun: true }),
          })
          const dryData = await dryRes.json().catch(() => ({}))
          if (!dryRes.ok) throw new Error(dryData.error || `Dry-run HTTP ${dryRes.status}`)
          const text: string = dryData.text ?? ''
          if (!text) throw new Error('Empty AI text')

          // 2. Schedule with the generated text + staggered timestamp
          const schedRes = await fetch('/api/blog/schedule-post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId, platform, scheduledAt, text }),
          })
          const schedData = await schedRes.json().catch(() => ({}))
          if (!schedRes.ok) throw new Error(schedData.error || `Schedule HTTP ${schedRes.status}`)
          ok++
        } catch (err) {
          failed++
          if (!firstError) firstError = err instanceof Error ? err.message : String(err)
        } finally {
          jobIdx++
          setProgress({ done: jobIdx, total: totalJobs })
        }
      }
    }

    setRunning(false)
    onScheduled({ ok, failed, firstError })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-[#0071e3]" />
              <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                Schedule {posts.length} post{posts.length !== 1 ? 's' : ''}
              </h3>
            </div>
            <button onClick={onClose} disabled={running} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] disabled:opacity-60">
              <X size={16} />
            </button>
          </div>

          {/* Step 1 — Platform selection */}
          <div className="mb-5">
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">1. Publish to</p>
            <div className="grid grid-cols-2 gap-2">
              {platforms.map(p => {
                const isSelected = selectedPlatforms.has(p.key)
                return (
                  <label
                    key={p.key}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      !p.connected
                        ? 'opacity-40 cursor-not-allowed border-gray-200 dark:border-white/10'
                        : isSelected
                          ? 'border-[#0071e3] bg-[#0071e3]/5'
                          : 'border-gray-200 dark:border-white/10 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!p.connected || running}
                      onChange={() => togglePlatform(p.key)}
                      className="w-3 h-3 rounded cursor-pointer accent-[#0071e3]"
                    />
                    <span
                      className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                      style={{ background: p.color }}
                    >
                      {p.label.charAt(0)}
                    </span>
                    <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{p.label}</span>
                    {!p.connected && <span className="text-[9px] text-[#86868b]">(not connected)</span>}
                  </label>
                )
              })}
            </div>
          </div>

          {/* Step 2 — Timing */}
          <div className="mb-5 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">2. First post at</p>
              <input
                type="datetime-local"
                value={firstAt}
                onChange={e => setFirstAt(e.target.value)}
                min={defaultStartString()}
                disabled={running}
                className="w-full text-xs px-2 py-1.5 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#0071e3] focus:outline-none"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">3. Stagger interval</p>
              <select
                value={intervalMins}
                onChange={e => setIntervalMins(Number(e.target.value))}
                disabled={running}
                className="w-full text-xs px-2 py-1.5 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#0071e3] focus:outline-none"
              >
                <option value={5}>5 minutes apart</option>
                <option value={15}>15 minutes apart</option>
                <option value={30}>30 minutes apart</option>
                <option value={60}>1 hour apart</option>
                <option value={180}>3 hours apart</option>
                <option value={360}>6 hours apart</option>
                <option value={720}>12 hours apart</option>
                <option value={1440}>1 day apart</option>
              </select>
            </div>
          </div>

          {/* Preview */}
          <div className="mb-5 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 p-3">
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Preview</p>
            <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
              {totalJobs === 0 ? (
                'Pick at least one platform.'
              ) : (
                <>
                  <strong>{totalJobs}</strong> post{totalJobs !== 1 ? 's' : ''}
                  {' '}({posts.length} × {selectedPlatforms.size} platform{selectedPlatforms.size !== 1 ? 's' : ''}).
                  {' '}First fires {formatLocal(firstAt)}, last fires {formatLocal(addMinutes(firstAt, (totalJobs - 1) * intervalMins))}.
                  AI text is generated for each now and locked in.
                </>
              )}
            </p>
          </div>

          {error && <p className="text-xs text-[#ff3b30] mb-3 flex items-center gap-1.5"><AlertCircle size={11} /> {error}</p>}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              disabled={running}
              className="text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] px-3 py-2 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={run}
              disabled={running || totalJobs === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50 transition-colors"
            >
              {running
                ? <><Loader2 size={12} className="animate-spin" /> Scheduling {progress?.done ?? 0}/{progress?.total ?? 0}…</>
                : <><CheckCircle size={12} /> Schedule {totalJobs}</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Now + 1 hour, rounded to next 5 min, formatted for datetime-local. */
function defaultStartString(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function addMinutes(dt: string, mins: number): string {
  const d = new Date(new Date(dt).getTime() + mins * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatLocal(dt: string): string {
  const d = new Date(dt)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
