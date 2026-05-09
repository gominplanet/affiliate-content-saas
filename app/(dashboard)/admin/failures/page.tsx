'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/Header'
import { RefreshCw, Trash2, AlertCircle, ChevronDown, ChevronRight, CheckCircle2, Loader2 } from 'lucide-react'

type JobType = 'blog_generation' | 'wp_publish' | 'social_draft' | 'youtube_sync'
type FailureStatus = 'pending_retry' | 'retrying' | 'resolved' | 'dismissed'

interface Failure {
  id: string
  job_type: JobType
  error_message: string
  error_code: string | null
  retry_count: number
  status: FailureStatus
  created_at: string
  youtube_videos: { title: string } | null
}

const jobTypeLabel: Record<JobType, { label: string; color: string }> = {
  blog_generation: { label: 'Content creation', color: 'bg-[#0071e3]/8 text-[#0071e3]' },
  wp_publish:      { label: 'Blog publishing',  color: 'bg-[#ff9500]/8 text-[#ff9500]' },
  social_draft:    { label: 'Social posts',     color: 'bg-purple-50 text-purple-600' },
  youtube_sync:    { label: 'YouTube sync',     color: 'bg-red-50 text-red-500' },
}

const statusConfig: Record<FailureStatus, { label: string; style: string }> = {
  pending_retry: { label: 'Will retry',  style: 'bg-[#ff9500]/10 text-[#ff9500]' },
  retrying:      { label: 'Retrying…',   style: 'bg-[#0071e3]/10 text-[#0071e3]' },
  resolved:      { label: 'Resolved',    style: 'bg-[#34c759]/10 text-[#34c759]' },
  dismissed:     { label: 'Dismissed',   style: 'bg-gray-100 text-[#86868b]' },
}

const friendlyError: Record<string, string> = {
  WP_AUTH_401:            "Couldn't connect to your blog. Your WordPress password may need updating.",
  ANTHROPIC_RATE_LIMIT:   'Content generation was busy — will retry automatically shortly.',
  YOUTUBE_QUOTA_EXCEEDED: 'YouTube sync is paused for today and will resume automatically overnight.',
  GEMINI_EMPTY_RESPONSE:  "Couldn't generate content for this video — try retrying manually.",
}

const friendlyFix: Record<string, string> = {
  WP_AUTH_401:            'Go to Settings → Integrations and re-enter your WordPress password.',
  ANTHROPIC_RATE_LIMIT:   'No action needed — the job is queued and will retry automatically. If this keeps happening, consider upgrading your plan.',
  YOUTUBE_QUOTA_EXCEEDED: 'No action needed — YouTube resets daily limits overnight and the sync will resume automatically.',
  GEMINI_EMPTY_RESPONSE:  'Click Retry below. If it fails again, try editing the video title to be more specific.',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}hr ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function FailureRow({
  failure, onDismiss,
}: {
  failure: Failure
  onDismiss: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const jt = jobTypeLabel[failure.job_type]
  const st = statusConfig[failure.status]
  const code = failure.error_code ?? ''
  const message = friendlyError[code] ?? failure.error_message
  const fix = friendlyFix[code]
  const isActive = failure.status === 'pending_retry' || failure.status === 'retrying'
  const videoTitle = failure.youtube_videos?.title ?? '—'

  async function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation()
    setDismissing(true)
    try {
      await fetch('/api/failures', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: failure.id, status: 'dismissed' }),
      })
      onDismiss(failure.id)
    } finally {
      setDismissing(false)
    }
  }

  return (
    <>
      <tr
        className="border-b border-gray-100 hover:bg-gray-50/60 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-3 px-4 w-8">
          <button className="text-[#86868b]">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="py-3 px-4">
          <span className={`badge ${jt.color}`}>{jt.label}</span>
        </td>
        <td className="py-3 px-4">
          <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] max-w-[220px] truncate">
            {videoTitle}
          </p>
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-1.5 max-w-[300px]">
            {failure.status === 'resolved'
              ? <CheckCircle2 size={13} className="text-[#34c759] flex-shrink-0" />
              : <AlertCircle size={13} className="text-[#ff9500] flex-shrink-0" />}
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] truncate">{message}</p>
          </div>
        </td>
        <td className="py-3 px-4">
          <span className="text-xs text-[#86868b] whitespace-nowrap">{timeAgo(failure.created_at)}</span>
        </td>
        <td className="py-3 px-4">
          <span className={`badge ${st.style}`}>{st.label}</span>
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            {isActive && (
              <button className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#0071e3]/8 text-[#0071e3] hover:bg-[#0071e3]/15 transition-colors">
                <RefreshCw size={11} /> Retry
              </button>
            )}
            <button
              onClick={handleDismiss}
              disabled={dismissing}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-[#86868b] hover:text-[#ff3b30] hover:bg-[#ff3b30]/8 transition-colors disabled:opacity-40"
              title="Dismiss"
            >
              {dismissing ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            </button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-[#f5f5f7] dark:bg-[#000]/60">
          <td colSpan={7} className="px-6 py-4">
            <div className="flex flex-col gap-1.5 max-w-xl">
              <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">What happened</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{message}</p>
              {fix && (
                <>
                  <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mt-2">What to do</p>
                  <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{fix}</p>
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function FailuresPage() {
  const [failures, setFailures] = useState<Failure[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<JobType | 'all'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/failures')
      const data = await res.json()
      setFailures(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function dismiss(id: string) {
    setFailures(f => f.filter(x => x.id !== id))
  }

  const filtered = failures.filter(f =>
    typeFilter === 'all' ? true : f.job_type === typeFilter,
  )
  const open = failures.filter(f => f.status === 'pending_retry' || f.status === 'retrying').length

  return (
    <>
      <Header
        title="Issues"
        subtitle={loading ? '' : open > 0 ? `${open} item${open !== 1 ? 's' : ''} need attention.` : 'Everything is running smoothly.'}
        actions={
          open > 0 && (
            <button className="btn-primary flex items-center gap-2">
              <RefreshCw size={14} /> Retry all
            </button>
          )
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-1.5 mb-5">
        {(['all', 'blog_generation', 'wp_publish', 'social_draft', 'youtube_sync'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              typeFilter === t
                ? 'bg-[#1d1d1f] text-white'
                : 'bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'
            }`}
          >
            {t === 'all' ? 'All' : jobTypeLabel[t].label}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#86868b] py-12 justify-center">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-[#f5f5f7] dark:bg-[#000]/60">
                <th className="py-2.5 px-4 w-8" />
                <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">Type</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">Video</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">What happened</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">When</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">Status</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <FailureRow key={f.id} failure={f} onDismiss={dismiss} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-[#86868b]">
                    {failures.length === 0 ? 'No issues — everything looks good.' : 'No issues in this category.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
