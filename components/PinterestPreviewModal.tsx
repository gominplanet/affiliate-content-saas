'use client'

import { useState } from 'react'
import { Pin, X, Edit3, Loader2 } from 'lucide-react'

export interface PinPreviewData {
  postId: string
  title: string
  description: string
  hashtags: string[]
  disclaimer: string
  complianceTags: string
  link: string
  imageBase64: string | null
  mediaType: string | null
  fallbackImageUrl: string | null
  boardName: string
}

/** Editable Pinterest pin preview. Shared by Library & Social Push and
 *  the CC & EPC Campaign pills so the review/edit UX is identical. */
export function PinterestPreviewModal({
  data,
  onPublish,
  onClose,
}: {
  data: PinPreviewData
  onPublish: (description: string, title: string) => Promise<{ ok: boolean; error?: string }>
  onClose: () => void
}) {
  const [title, setTitle] = useState(data.title)
  const [description, setDescription] = useState(data.description)
  const [publishing, setPublishing] = useState(false)
  const [pubError, setPubError] = useState<string | null>(null)

  const tagLine = data.hashtags.length ? data.hashtags.map(t => `#${t}`).join(' ') : ''

  const imageSrc = data.imageBase64
    ? `data:${data.mediaType};base64,${data.imageBase64}`
    : data.fallbackImageUrl || null

  async function publish() {
    setPublishing(true)
    setPubError(null)
    // Compliance tags always last, at the very end of the description.
    const composed = [description, tagLine, data.disclaimer, data.complianceTags].filter(Boolean).join('\n\n')
    const result = await onPublish(composed, title.trim() || data.title)
    if (!result.ok) {
      setPubError(result.error || 'Publish failed. Try again.')
      setPublishing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: '#E60023' }}>
              <Pin size={12} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Preview your Pin</span>
            <span className="text-xs text-[#86868b] dark:text-[#8e8e93] ml-1">→ {data.boardName}</span>
          </div>
          <button onClick={onClose} className="text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:text-[#f5f5f7] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex gap-6 p-6">
          {/* Pin image preview — Pinterest 2:3 (1000×1500) */}
          <div className="flex-shrink-0 w-[170px]">
            <div className="w-[170px] rounded-xl overflow-hidden bg-gray-100" style={{ aspectRatio: '2/3' }}>
              {imageSrc ? (
                <img src={imageSrc} alt={data.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#86868b] dark:text-[#8e8e93]">
                  <Pin size={24} />
                </div>
              )}
            </div>
            {data.imageBase64 && (
              <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] text-center mt-1.5">AI-generated image</p>
            )}
          </div>

          {/* Pin details */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            {/* Title — curiosity-driven, editable */}
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <p className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">Title</p>
                <Edit3 size={10} className="text-[#86868b] dark:text-[#8e8e93]" />
                <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">editable · {title.length}/100</span>
              </div>
              <input
                value={title}
                maxLength={100}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:border-[#E60023]/50 focus:ring-1 focus:ring-[#E60023]/20 transition-colors"
              />
            </div>

            {/* Description — editable */}
            <div className="flex-1">
              <div className="flex items-center gap-1.5 mb-1">
                <p className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">Description</p>
                <Edit3 size={10} className="text-[#86868b] dark:text-[#8e8e93]" />
                <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">editable</span>
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full text-sm text-[#1d1d1f] dark:text-[#f5f5f7] border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-[#E60023]/50 focus:ring-1 focus:ring-[#E60023]/20 transition-colors"
              />
            </div>

            {/* Hashtags — relevant, SEO + viral, auto-appended */}
            {data.hashtags.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide mb-1.5">Tags — auto-appended</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.hashtags.map(t => (
                    <span key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#E60023]/8 text-[#c0001a] dark:text-[#ff6b81]">#{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Disclaimer + compliance tags */}
            <div className="rounded-lg p-3" style={{ background: '#fff8f0', border: '1px solid #ffe4cc' }}>
              <p className="text-[10px] font-semibold text-[#ff9500] uppercase tracking-wide mb-0.5">Affiliate disclaimer + tags — auto-appended</p>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">{data.disclaimer}</p>
              <p className="text-[11px] font-semibold text-[#c0001a] mt-1.5">{data.complianceTags}</p>
            </div>

            {/* Pin destination — always the blog post itself */}
            <div>
              <p className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide mb-1">Links to (blog post)</p>
              {data.link ? (
                <a href={data.link} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#0071e3] hover:underline break-all">{data.link}</a>
              ) : (
                <p className="text-[11px] text-[#ff3b30]">No blog URL — this post can&apos;t be pinned.</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={publish}
                disabled={publishing}
                className="flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
                style={{ background: publishing ? '#c0001a' : '#E60023' }}
              >
                {publishing
                  ? <><Loader2 size={14} className="animate-spin" /> Publishing…</>
                  : <><Pin size={14} /> Publish Pin</>
                }
              </button>
              <button onClick={onClose} className="text-sm text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:text-[#f5f5f7] transition-colors">
                Cancel
              </button>
              {pubError && <span className="text-xs text-[#ff3b30] flex-1">{pubError}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
