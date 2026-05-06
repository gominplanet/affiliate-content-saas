'use client'

import { useState } from 'react'
import Header from '@/components/layout/Header'
import { RefreshCw, Trash2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'

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
  blog_generation: { label: 'Blog generation', color: 'bg-[#0071e3]/8 text-[#0071e3]' },
  wp_publish: { label: 'WP publish', color: 'bg-[#ff9500]/8 text-[#ff9500]' },
  social_draft: { label: 'Social draft', color: 'bg-purple-50 text-purple-600' },
  youtube_sync: { label: 'YouTube sync', color: 'bg-red-50 text-red-500' },
}

const statusBadge: Record<FailureStatus, string> = {
  pending_retry: 'bg-[#ff9500]/10 text-[#ff9500]',
  retrying: 'bg-[#0071e3]/10 text-[#0071e3]',
  resolved: 'bg-[#34c759]/10 text-[#34c759]',
  dismissed: 'bg-gray-100 text-[#86868b]',
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

  return (
    <>
      <tr
        className="border-b border-gray-100 hover:bg-gray-50/60 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-3 px-4">
          <button className="text-[#86868b]">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="py-3 px-4">
          <span className={`badge ${jt.color}`}>{jt.label}</span>
        </td>
        <td className="py-3 px-4">
          <p className="text-sm text-[#1d1d1f] font-medium max-w-[220px] truncate">
            {failure.videoTitle}
          </p>
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-1.5 max-w-[260px]">
            <AlertCircle size={13} className="text-[#ff3b30] flex-shrink-0" />
            <p className="text-xs text-[#6e6e73] truncate">{failure.errorMessage}</p>
          </div>
        </td>
        <td className="py-3 px-4">
          <code className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-[#6e6e73]">
            {failure.errorCode}
          </code>
        </td>
        <td className="py-3 px-4">
          <span className="text-xs text-[#86868b]">{failure.failedAt}</span>
        </td>
        <td className="py-3 px-4">
          <span className="text-xs text-[#86868b]">{failure.retryCount}×</span>
        </td>
        <td className="py-3 px-4">
          <span className={`badge ${statusBadge[failure.status]}`}>
            {failure.status.replace('_', ' ')}
          </span>
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {failure.status !== 'resolved' && failure.status !== 'dismissed' && (
              <button className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#0071e3]/8 text-[#0071e3] hover:bg-[#0071e3]/15 transition-colors">
                <RefreshCw size={11} /> Retry
              </button>
            )}
            <button className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-[#86868b] hover:text-[#ff3b30] hover:bg-[#ff3b30]/8 transition-colors">
              <Trash2 size={11} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[#f5f5f7]/60">
          <td colSpan={9} className="px-4 py-3">
            <div className="flex gap-6 text-xs">
              <div>
                <p className="font-medium text-[#6e6e73] mb-1">Full error</p>
                <p className="text-[#1d1d1f] font-mono bg-white border border-gray-200 rounded-lg px-3 py-2 max-w-2xl">
                  {failure.errorMessage}
                </p>
              </div>
              <div>
                <p className="font-medium text-[#6e6e73] mb-1">Suggested fix</p>
                <p className="text-[#1d1d1f]">
                  {failure.errorCode === 'WP_AUTH_401' && 'Regenerate your WordPress application password in Settings → Integrations.'}
                  {failure.errorCode === 'ANTHROPIC_RATE_LIMIT' && 'Wait 60 seconds and retry. Consider upgrading your Anthropic plan.'}
                  {failure.errorCode === 'YOUTUBE_QUOTA_EXCEEDED' && 'YouTube API quota resets at midnight PST. Job will auto-retry tomorrow.'}
                  {failure.errorCode === 'GEMINI_EMPTY_RESPONSE' && 'The prompt may have triggered a safety filter. Review and rephrase the video title or description.'}
                </p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function FailuresPage() {
  const [typeFilter, setTypeFilter] = useState<JobType | 'all'>('all')

  const filtered = mockFailures.filter((f) =>
    typeFilter === 'all' ? true : f.jobType === typeFilter,
  )

  const open = mockFailures.filter((f) => f.status === 'pending_retry' || f.status === 'retrying').length

  return (
    <>
      <Header
        title="Failures"
        subtitle={`${open} job${open !== 1 ? 's' : ''} require attention.`}
        actions={
          <button className="btn-primary">
            <RefreshCw size={14} />
            Retry all pending
          </button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-1.5 mb-5">
        {(['all', 'blog_generation', 'wp_publish', 'social_draft', 'youtube_sync'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              typeFilter === t
                ? 'bg-[#1d1d1f] text-white'
                : 'bg-white border border-gray-200 text-[#6e6e73] hover:border-gray-300'
            }`}
          >
            {t === 'all' ? 'All jobs' : jobTypeLabel[t].label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-100 bg-[#f5f5f7]/60">
              <th className="py-2.5 px-4 w-8" />
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">Type</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">Video</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">Error</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">Code</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">When</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">Retries</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">Status</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-[#86868b]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <FailureRow key={f.id} failure={f} />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-sm text-[#86868b]">
                  No failures found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
