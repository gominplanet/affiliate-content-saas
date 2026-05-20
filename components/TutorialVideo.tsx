'use client'

/**
 * Inline YouTube tutorial embed shown at the top of dashboard sections.
 * - Dismissible per user (localStorage, keyed by `sectionKey`)
 * - Sidebar "Show tutorials" button calls `resetTutorials()` to bring
 *   every dismissed tutorial back across the whole workspace.
 *
 * Add new tutorials inline in any page:
 *   <TutorialVideo sectionKey="brand-profile" videoId="..." title="..." />
 */

import { useEffect, useState } from 'react'
import { X, GraduationCap } from 'lucide-react'

const STORAGE_KEY = 'mvp_tutorial_dismissed'
const RESET_EVENT = 'mvp:tutorial-reset'

function readDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : [])
  } catch { return new Set() }
}

function writeDismissed(s: Set<string>) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...s])) } catch { /* ignore */ }
}

/** Clear all dismissals + broadcast so live <TutorialVideo /> instances re-show. */
export function resetTutorials() {
  writeDismissed(new Set())
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RESET_EVENT))
}

interface Props {
  /** Unique key for localStorage. Use kebab-case, e.g. "brand-profile". */
  sectionKey: string
  /** YouTube video ID (the part after v= or in the /embed/ URL). */
  videoId: string
  title?: string
  description?: string
}

export function TutorialVideo({ sectionKey, videoId, title, description }: Props) {
  // null while hydrating so we don't flash the embed for users who dismissed it
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  useEffect(() => {
    setDismissed(readDismissed().has(sectionKey))
    const onReset = () => setDismissed(readDismissed().has(sectionKey))
    window.addEventListener(RESET_EVENT, onReset)
    return () => window.removeEventListener(RESET_EVENT, onReset)
  }, [sectionKey])

  if (dismissed !== false) return null

  function dismiss() {
    const next = readDismissed()
    next.add(sectionKey)
    writeDismissed(next)
    setDismissed(true)
  }

  return (
    <div className="card p-4 mb-4 relative" style={{ background: 'linear-gradient(180deg, rgba(0,113,227,0.04) 0%, transparent 100%)' }}>
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#0071e3]/10 flex items-center justify-center">
          <GraduationCap size={16} className="text-[#0071e3]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            {title || 'Quick tutorial'}
          </p>
          {description && (
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">{description}</p>
          )}
        </div>
        <button
          onClick={dismiss}
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          aria-label="Dismiss this tutorial"
          title="Hide this tutorial (bring it back from sidebar → Show tutorials)"
        >
          <X size={15} />
        </button>
      </div>
      <div className="aspect-video w-full max-w-2xl rounded-lg overflow-hidden border border-gray-200 dark:border-white/10 bg-black">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}`}
          title={title || 'Tutorial video'}
          frameBorder={0}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          className="w-full h-full"
        />
      </div>
    </div>
  )
}
