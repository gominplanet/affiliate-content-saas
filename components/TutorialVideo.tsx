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
import { getTutorial } from '@/lib/tutorials'

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
  /** Unique key for localStorage. Use kebab-case, e.g. "brand-profile".
   *  If the key matches one in lib/tutorials.ts, videoId/title/description
   *  can be omitted — they'll be looked up from the registry. */
  sectionKey: string
  /** YouTube video ID. Optional if registered in lib/tutorials.ts. */
  videoId?: string
  title?: string
  description?: string
}

export function TutorialVideo({ sectionKey, videoId, title, description }: Props) {
  // Fall back to the registry so pages can write <TutorialVideo sectionKey="brand-profile" />
  // and stay in sync with the all-in-one /tutorials page.
  const reg = getTutorial(sectionKey)
  const resolvedVideoId = videoId || reg?.videoId
  const resolvedTitle = title || reg?.title
  const resolvedDescription = description || reg?.description
  if (!resolvedVideoId) return null
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
    <div className="card p-4 mb-6 relative max-w-3xl mx-auto" style={{ background: 'linear-gradient(180deg, rgba(0,113,227,0.04) 0%, transparent 100%)' }}>
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#7C3AED]/10 flex items-center justify-center">
          <GraduationCap size={16} className="text-[#7C3AED]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            {resolvedTitle || 'Quick tutorial'}
          </p>
          {resolvedDescription && (
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">{resolvedDescription}</p>
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
      <div className="aspect-video w-full rounded-lg overflow-hidden border border-gray-200 dark:border-white/10 bg-black">
        <iframe
          src={`https://www.youtube.com/embed/${resolvedVideoId}`}
          title={resolvedTitle || 'Tutorial video'}
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
