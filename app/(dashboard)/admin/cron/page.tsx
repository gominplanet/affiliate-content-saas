// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /admin/cron — Queue health dashboard.
//
// Surfaces the state of the scheduled_posts queue at a glance so silent
// failures (the kind that bit us in the schedule-publish rollout) become
// instantly visible:
//
//   - Counts by status (pending now / processing now / 24h completed +
//     failed + cancelled)
//   - Last successful tick — if more than ~3 min ago AND there's a due
//     pending row, the cron is probably broken
//   - Rows stuck in 'processing' for >5min (claimed but never updated —
//     usually means the tick errored mid-flight)
//   - Last 20 failures with their full error_message, sorted newest-first
//
// Refreshes every 30s by default. Manual Refresh button at the top.
'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'

interface SchedRow {
  id: string
  user_id: string
  blog_post_id: string | null
  platform: string | null
  scheduled_at: string
  status: string
  attempts: number | null
  claimed_at: string | null
  last_attempt_at: string | null
  error_message: string | null
  updated_at: string | null
  created_at: string
}

interface Stats {
  counts: {
    pending: number
    processing: number
    completed_24h: number
    failed_24h: number
    cancelled_24h: number
  }
  lastCompletedAt: string | null
  nextDuePending: string | null
  stuckCount: number
  stuck: SchedRow[]
  recentFailures: SchedRow[]
  sampledAt: string
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}hr ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function timeUntil(iso: string | null): string {
  if (!iso) return 'none queued'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff < 0) return `${Math.floor(-diff / 1000)}s overdue`
  if (diff < 60_000) return `in ${Math.floor(diff / 1000)}s`
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `in ${mins}m`
  return `in ${Math.floor(mins / 60)}hr`
}

export default function AdminCronPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/cron-stats')
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Failed (${res.status})`)
      }
      const data = (await res.json()) as Stats
      setStats(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Auto-refresh every 30s — short enough to feel "live", long enough
    // not to hammer the admin DB on a tab the user leaves open.
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  // ── Health verdict ─────────────────────────────────────────────────────
  // If the next-due-pending is overdue AND the last completion was >3min
  // ago, the cron is probably down. This is the headline you want to see
  // at the top of the page on a bad day.
  const cronHealthy = (() => {
    if (!stats) return null
    const nowMs = Date.now()
    const lastTickMs = stats.lastCompletedAt ? new Date(stats.lastCompletedAt).getTime() : 0
    const nextDueMs = stats.nextDuePending ? new Date(stats.nextDuePending).getTime() : Infinity
    const isStale = nowMs - lastTickMs > 3 * 60_000
    const isDue = nextDueMs < nowMs
    // No rows due, never stale alarm — could just be quiet.
    if (!isDue && isStale && stats.counts.pending === 0) return true
    return !(isStale && isDue)
  })()

  async function retryRow(id: string) {
    try {
      const res = await fetch('/api/admin/cron-retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `Failed (${res.status})`)
      toast.success('Row re-queued')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      <PageHero
        title="Cron health"
        subtitle="Queue status for /api/cron/process-scheduled. Refreshes every 30 seconds."
      />

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border bg-white dark:bg-[#1c1c1e] border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-gray-50 dark:hover:bg-[#2c2c2e] transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
        {stats?.sampledAt && (
          <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Sampled {timeAgo(stats.sampledAt)}</span>
        )}
      </div>

      {error && (
        <div className="mt-4 card p-4 border-[#ff3b30]/30 bg-[#ff3b30]/5">
          <p className="text-sm text-[#ff3b30] font-semibold">Failed to load: {error}</p>
        </div>
      )}

      {/* ── Health verdict banner ──────────────────────────────────────── */}
      {stats && (
        <div
          className={`mt-4 card p-4 flex items-start gap-3 ${
            cronHealthy
              ? 'border-[#34c759]/30 bg-[#34c759]/5'
              : 'border-[#ff3b30]/30 bg-[#ff3b30]/5'
          }`}
        >
          {cronHealthy ? (
            <CheckCircle2 size={20} className="text-[#34c759] flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle size={20} className="text-[#ff3b30] flex-shrink-0 mt-0.5" />
          )}
          <div>
            <p className={`text-sm font-semibold ${cronHealthy ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>
              {cronHealthy ? 'Cron healthy' : 'Cron may be down'}
            </p>
            <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]/80 mt-0.5">
              Last successful tick: <strong>{timeAgo(stats.lastCompletedAt)}</strong>{' · '}
              Next due pending: <strong>{timeUntil(stats.nextDuePending)}</strong>
            </p>
            {!cronHealthy && (
              <p className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7]/70 mt-1">
                A row is due to fire but no completion has been written in &gt;3 minutes. Check Vercel cron logs for /api/cron/process-scheduled.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Counts grid ───────────────────────────────────────────────── */}
      {stats && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Pending" value={stats.counts.pending} hint="waiting to fire" tone="violet" />
          <StatCard
            label="Processing"
            value={stats.counts.processing}
            hint={stats.stuckCount > 0 ? `${stats.stuckCount} stuck >5min` : 'in flight'}
            tone={stats.stuckCount > 0 ? 'red' : 'amber'}
          />
          <StatCard label="Completed" value={stats.counts.completed_24h} hint="last 24h" tone="green" />
          <StatCard label="Failed" value={stats.counts.failed_24h} hint="last 24h" tone={stats.counts.failed_24h > 0 ? 'red' : 'neutral'} />
          <StatCard label="Cancelled" value={stats.counts.cancelled_24h} hint="last 24h" tone="neutral" />
        </div>
      )}

      {/* ── Stuck rows ────────────────────────────────────────────────── */}
      {stats && stats.stuck.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2 flex items-center gap-2">
            <Clock size={14} className="text-[#ff9500]" />
            Stuck in processing &gt;5 min ({stats.stuck.length})
          </h2>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-2">
            These rows were claimed by a cron tick that never wrote back a completed/failed status. Likely the tick errored or timed out. Use Retry to flip them back to pending.
          </p>
          <RowsTable rows={stats.stuck} onRetry={retryRow} />
        </div>
      )}

      {/* ── Recent failures ───────────────────────────────────────────── */}
      {stats && stats.recentFailures.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2 flex items-center gap-2">
            <AlertTriangle size={14} className="text-[#ff3b30]" />
            Recent failures ({stats.recentFailures.length})
          </h2>
          <RowsTable rows={stats.recentFailures} onRetry={retryRow} />
        </div>
      )}

      {stats && stats.stuck.length === 0 && stats.recentFailures.length === 0 && (
        <div className="mt-6 card p-6 text-center">
          <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">No stuck rows, no recent failures. 🎉</p>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: 'violet' | 'green' | 'amber' | 'red' | 'neutral' }) {
  const colors: Record<string, string> = {
    violet: 'text-[#7C3AED]',
    green: 'text-[#34c759]',
    amber: 'text-[#ff9500]',
    red: 'text-[#ff3b30]',
    neutral: 'text-[#1d1d1f] dark:text-[#f5f5f7]',
  }
  return (
    <div className="card p-3">
      <p className="text-[11px] uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93]">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${colors[tone]}`}>{value}</p>
      <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">{hint}</p>
    </div>
  )
}

function RowsTable({ rows, onRetry }: { rows: SchedRow[]; onRetry: (id: string) => void }) {
  return (
    <div className="card p-0 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-[#1c1c1e] text-[#86868b] dark:text-[#8e8e93]">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Platform</th>
            <th className="text-left px-3 py-2 font-medium">Scheduled</th>
            <th className="text-left px-3 py-2 font-medium">Claimed</th>
            <th className="text-left px-3 py-2 font-medium">Attempts</th>
            <th className="text-left px-3 py-2 font-medium">Error</th>
            <th className="text-right px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-gray-200 dark:border-white/5">
              <td className="px-3 py-2 font-mono text-[11px]">{r.platform ?? <span className="opacity-50">blog_publish</span>}</td>
              <td className="px-3 py-2">{timeAgo(r.scheduled_at)}</td>
              <td className="px-3 py-2">{r.claimed_at ? timeAgo(r.claimed_at) : '—'}</td>
              <td className="px-3 py-2 tabular-nums">{r.attempts ?? 0}</td>
              <td className="px-3 py-2 max-w-md truncate" title={r.error_message ?? undefined}>
                {r.error_message ?? <span className="opacity-50">—</span>}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => onRetry(r.id)}
                  className="text-[11px] font-medium text-[#7C3AED] hover:underline"
                >
                  Retry
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
