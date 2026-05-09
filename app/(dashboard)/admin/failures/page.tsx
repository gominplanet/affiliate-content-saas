'use client'

import { useState } from 'react'
import Header from '@/components/layout/Header'
import { RefreshCw, Trash2, AlertCircle, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react'

type JobType = 'blog_generation' | 'wp_publish' | 'social_draft' | 'youtube_sync'
type FailureStatus = 'pending_retry' | 'retrying' | 'resolved' | 'dismissed'

interface Failure {
  id: string
  jobType: JobType
  videoTitle: string
  errorMessage: string
  errorCode: string
  failedAt: string
  retryCount: number
  status: FailureStatus
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
  dismissed:     { label: 'Dismissed',   style: 'bg-gray-100 text-[#86868b] dark:text-[#8e8e93]' },
}

// User-facing error messages — no API names, no technical codes
const friendlyError: Record<string, string> = {
  WP_AUTH_401:          "Couldn't connect to your blog. Your WordPress password may need updating.",
  ANTHROPIC_RATE_LIMIT: 'Content generation was busy — will retry automatically shortly.',
  YOUTUBE_QUOTA_EXCEEDED: 'YouTube sync is paused for today and will resume automatically overnight.',
  GEMINI_EMPTY_RESPONSE: "Couldn't generate content for this video — try retrying manually.",
}

const friendlyFix: Record<string, string> = {
  WP_AUTH_401:          'Go to Settings → Integrations and re-enter your WordPress password.',
  ANTHROPIC_RATE_LIMIT: 'No action needed — the job is queued and will retry automatically. If this keeps happening, consider upgrading your plan.',
  YOUTUBE_QUOTA_EXCEEDED: 'No action needed — YouTube resets daily limits overnight and the sync will resume automatically.',
  GEMINI_EMPTY_RESPONSE: 'Click Retry below. If it fails again, try editing the video title to be more specific.',
}

const mockFailures: Failure[] = [
  {
    id: 'f1',
    jobType: 'wp_publish',
    videoTitle: 'ConvertKit vs Mailchimp — Full Review',
    errorMessage: 'Authentication failed: WordPress returned 401. Check your application password.',
    errorCode: 'WP_AUTH_401',
    failedAt: '1 hr ago',
    retryCount: 2,
    status: 'pending_retry',
  },
  {
    id: 'f2',
    jobType: 'blog_generation',
    videoTitle: 'GetResponse Deep Dive 2025',
    errorMessage: 'Anthropic API rate limit exceeded. Retry after 60 seconds.',
    errorCode: 'ANTHROPIC_RATE_LIMIT',
    failedAt: '3 hr ago',
    retryCount: 1,
    status: 'pending_retry',
  },
  {
    id: 'f3',
    jobType: 'youtube_sync',
    videoTitle: '—',
    errorMessage: 'YouTube Data API quota exhausted for today. Resets at midnight PST.',
    errorCode: 'YOUTUBE_QUOTA_EXCEEDED',
    failedAt: '5 hr ago',
    retryCount: 0,
    status: 'dismissed',
  },
  {
    id: 'f4',
    jobType: 'social_draft',
    videoTitle: 'Best Funnel Builder — My Verdict',
    errorMessage: 'Gemini API returned an empty response. Possible content policy filter.',
    errorCode: 'GEMINI_EMPTY_RESPONSE',
    failedAt: '1 day ago',
    retryCount: 3,
    status: 'resolved',
  },
]

function FailureRow({ failure }: { failure: Failure }) {
  const [expanded, setExpanded] = useState(false)
  const jt = jobTypeLabel[failure.jobType]
  const st = statusConfig[failure.status]
  const message = friendlyError[failure.errorCode] ?? failure.errorMessage
  const fix = friendlyFix[failure.errorCode]
  const isActive = failure.status === 'pending_retry' || failure.status === 'retrying'

  return (
    <>
      <tr
        className="border-b border-gray-100 hover:bg-gray-50/60 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-3 px-4 w-8">
          <button className="text-[#86868b] dark:text-[#8e8e93]">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="py-3 px-4">
          <span className={`badge ${jt.color}`}>{jt.label}</span>
        </td>
        <td className="py-3 px-4">
          <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] max-w-[220px] truncate">
            {failure.videoTitle}
          </p>
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-1.5 max-w-[300px]">
            {failure.status === 'resolved'
              ? <CheckCircle2 size={13} className="text-[#34c759] flex-shrink-0" />
              : <AlertCircle size={13} className="text-[#ff9500] flex-shrink-0" />
            }
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] truncate">{message}</p>
          </div>
        </td>
        <td className="py-3 px-4">
          <span className="text-xs text-[#86868b] dark:text-[#8e8e93] whitespace-nowrap">{failure.failedAt}</span>
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
            <button className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] hover:bg-[#ff3b30]/8 transition-colors">
              <Trash2 size={11} />
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
  const [typeFilter, setTypeFilter] = useState<JobType | 'all'>('all')

  const filtered = mockFailures.filter(f =>
    typeFilter === 'all' ? true : f.jobType === typeFilter,
  )
  const open = mockFailures.filter(f => f.status === 'pending_retry' || f.status === 'retrying').length

  return (
    <>
      <Header
        title="Issues"
        subtitle={open > 0 ? `${open} item${open !== 1 ? 's' : ''} need attention.` : 'Everything is running smoothly.'}
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

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-100 bg-[#f5f5f7] dark:bg-[#000]/60">
              <th className="py-2.5 px-4 w-8" />
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b] dark:text-[#8e8e93]">Type</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b] dark:text-[#8e8e93]">Video</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b] dark:text-[#8e8e93]">What happened</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b] dark:text-[#8e8e93]">When</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b] dark:text-[#8e8e93]">Status</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b] dark:text-[#8e8e93]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(f => <FailureRow key={f.id} failure={f} />)}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-sm text-[#86868b] dark:text-[#8e8e93]">
                  No issues found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
