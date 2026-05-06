'use client'

import { useState } from 'react'
import Header from '@/components/layout/Header'
import { Twitter, Linkedin, Instagram, Check, X, Edit3, Copy, ChevronDown } from 'lucide-react'

type Platform = 'twitter' | 'linkedin' | 'instagram'
type Status = 'pending' | 'approved' | 'rejected'

interface Draft {
  id: string
  platform: Platform
  status: Status
  videoTitle: string
  content: string
  createdAt: string
  charCount: number
  charLimit: number
}

const PlatformMeta: Record<Platform, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  twitter: { label: 'X (Twitter)', icon: Twitter, color: 'text-[#1d1d1f]', bg: 'bg-gray-100' },
  linkedin: { label: 'LinkedIn', icon: Linkedin, color: 'text-[#0A66C2]', bg: 'bg-[#0A66C2]/8' },
  instagram: { label: 'Instagram', icon: Instagram, color: 'text-[#E1306C]', bg: 'bg-[#E1306C]/8' },
}

const statusStyle: Record<Status, { label: string; badge: string; border: string }> = {
  pending: { label: 'Pending review', badge: 'bg-[#ff9500]/10 text-[#ff9500]', border: 'border-[#ff9500]/20' },
  approved: { label: 'Approved', badge: 'bg-[#34c759]/10 text-[#34c759]', border: 'border-[#34c759]/20' },
  rejected: { label: 'Rejected', badge: 'bg-[#ff3b30]/10 text-[#ff3b30]', border: 'border-[#ff3b30]/20' },
}

const mockDrafts: Draft[] = [
  {
    id: '1',
    platform: 'twitter',
    status: 'pending',
    videoTitle: 'Top 5 Affiliate Marketing Tools 2025',
    content: "🔥 Just dropped a full breakdown of the 5 affiliate tools that made me $8K last month.\n\nSpoiler: most people sleep on #3.\n\nWatch the full video 👇\nyoutube.com/watch?v=xxx",
    createdAt: '2 hr ago',
    charCount: 178,
    charLimit: 280,
  },
  {
    id: '2',
    platform: 'linkedin',
    status: 'pending',
    videoTitle: 'Top 5 Affiliate Marketing Tools 2025',
    content: "I've been affiliate marketing for 3 years, and these 5 tools are the reason I went from $0 to $8,000/month.\n\nMost beginners skip tool #3 entirely — and that's exactly why they plateau.\n\nIn my latest video, I break down:\n• Which tools are actually worth the cost\n• My exact workflow from content to commission\n• The single biggest mistake most affiliates make\n\nLink in comments 👇",
    createdAt: '2 hr ago',
    charCount: 412,
    charLimit: 3000,
  },
  {
    id: '3',
    platform: 'instagram',
    status: 'approved',
    videoTitle: 'How to Use ClickFunnels for Beginners',
    content: "ClickFunnels changed my business. Here's the exact setup I use for affiliate campaigns:\n\n1️⃣ Simple opt-in page\n2️⃣ Thank you page with OTO\n3️⃣ Email sequence that converts\n\nFull tutorial on YouTube — link in bio 🔗\n\n#affiliatemarketing #clickfunnels #makemoneyonline #passiveincome #digitalmarketing",
    createdAt: '5 hr ago',
    charCount: 298,
    charLimit: 2200,
  },
  {
    id: '4',
    platform: 'twitter',
    status: 'rejected',
    videoTitle: 'ConvertKit vs Mailchimp',
    content: "ConvertKit is way better than Mailchimp for affiliates. Change my mind.",
    createdAt: '1 day ago',
    charCount: 71,
    charLimit: 280,
  },
]

function DraftCard({ draft }: { draft: Draft }) {
  const platform = PlatformMeta[draft.platform]
  const status = statusStyle[draft.status]
  const Icon = platform.icon
  const pct = Math.round((draft.charCount / draft.charLimit) * 100)

  return (
    <div className={`card p-5 border ${status.border}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-7 h-7 rounded-lg ${platform.bg} flex items-center justify-center`}>
            <Icon size={14} className={platform.color} />
          </div>
          <div>
            <p className="text-xs font-semibold text-[#1d1d1f]">{platform.label}</p>
            <p className="text-xs text-[#86868b] truncate max-w-[240px]">{draft.videoTitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${status.badge}`}>{status.label}</span>
          <span className="text-xs text-[#86868b]">{draft.createdAt}</span>
        </div>
      </div>

      {/* Content */}
      <div className="bg-[#f5f5f7] rounded-xl p-4 mb-3">
        <p className="text-sm text-[#1d1d1f] leading-relaxed whitespace-pre-line">{draft.content}</p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-24 h-1 rounded-full bg-gray-200 overflow-hidden">
            <div
              className={`h-full rounded-full ${pct > 90 ? 'bg-[#ff3b30]' : 'bg-[#0071e3]'}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className="text-xs text-[#86868b]">{draft.charCount}/{draft.charLimit}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button className="btn-secondary text-xs px-2.5 py-1.5" title="Copy">
            <Copy size={12} />
          </button>
          <button className="btn-secondary text-xs px-2.5 py-1.5" title="Edit">
            <Edit3 size={12} />
          </button>
          {draft.status === 'pending' && (
            <>
              <button className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#ff3b30]/8 text-[#ff3b30] hover:bg-[#ff3b30]/15 transition-colors">
                <X size={12} /> Reject
              </button>
              <button className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#34c759]/8 text-[#34c759] hover:bg-[#34c759]/15 transition-colors">
                <Check size={12} /> Approve
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DraftsPage() {
  const [platformFilter, setPlatformFilter] = useState<Platform | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all')

  const filtered = mockDrafts.filter((d) => {
    if (platformFilter !== 'all' && d.platform !== platformFilter) return false
    if (statusFilter !== 'all' && d.status !== statusFilter) return false
    return true
  })

  const pending = mockDrafts.filter((d) => d.status === 'pending').length

  return (
    <>
      <Header
        title="Social Drafts"
        subtitle={`${pending} draft${pending !== 1 ? 's' : ''} waiting for review.`}
        actions={
          <button className="btn-secondary text-sm">
            Bulk approve <ChevronDown size={13} />
          </button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-6 mb-5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-[#6e6e73] mr-1">Platform</span>
          {(['all', 'twitter', 'linkedin', 'instagram'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                platformFilter === p
                  ? 'bg-[#1d1d1f] text-white'
                  : 'bg-white border border-gray-200 text-[#6e6e73] hover:border-gray-300'
              }`}
            >
              {p === 'all' ? 'All' : PlatformMeta[p].label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-[#6e6e73] mr-1">Status</span>
          {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-[#1d1d1f] text-white'
                  : 'bg-white border border-gray-200 text-[#6e6e73] hover:border-gray-300'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Draft list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-[#86868b]">
          <p className="text-sm">No drafts match the current filters.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((draft) => (
            <DraftCard key={draft.id} draft={draft} />
          ))}
        </div>
      )}
    </>
  )
}
