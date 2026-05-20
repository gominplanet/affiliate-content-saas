'use client'

/**
 * Shown when a tier-capped action returns `limitReached: true` from
 * the API. Renders a friendly amber banner with a direct Link to the
 * pricing page — far less hostile than a red error toast, and turns
 * a dead-end into an upgrade moment.
 *
 * Pages that consume this:
 * - YouTube Co-Pilot (thumbnail + metadata caps)
 * - Library / content (anywhere blog posts get capped)
 * - Collaborations (collab email cap)
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'

export interface CapInfo {
  cap: 'thumbnails' | 'metadata' | 'collabs' | 'posts' | string
  currentTier?: string
  upgrade?: { tier: string; label: string; limit: number | null } | null
}

const EVENT = 'mvp:cap-reached'

/** Fire from anywhere on the page (including a child component) to
 *  surface the global banner. The page must mount <CapBannerHost />
 *  at the top to listen. */
export function dispatchCapReached(message: string, info: CapInfo) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, info } }))
}

/** Drop one of these at the top of any dashboard page where a child
 *  component might hit a cap. Listens for dispatchCapReached events
 *  and renders the banner with auto-dismiss. */
export function CapBannerHost() {
  const [state, setState] = useState<{ message: string; info: CapInfo } | null>(null)
  useEffect(() => {
    function onCap(e: Event) {
      const detail = (e as CustomEvent).detail as { message: string; info: CapInfo }
      setState(detail)
      // Smooth-scroll the banner into view so an at-cap user doesn't
      // miss it when the trigger happened lower on the page.
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    }
    window.addEventListener(EVENT, onCap)
    return () => window.removeEventListener(EVENT, onCap)
  }, [])
  if (!state) return null
  return (
    <div className="mb-4">
      <CapReachedBanner
        message={state.message}
        info={state.info}
        onDismiss={() => setState(null)}
      />
    </div>
  )
}

const FEATURE_LABEL: Record<string, string> = {
  thumbnails: 'thumbnails',
  metadata: 'metadata generations',
  collabs: 'collaboration emails',
  posts: 'posts',
}

interface Props {
  /** Full server-side error message (already includes upgrade hint). */
  message: string
  /** Structured cap info from the 429 response — drives the CTA copy. */
  info?: CapInfo | null
  /** Optional dismiss handler — when omitted, the X is hidden. */
  onDismiss?: () => void
  className?: string
}

export function CapReachedBanner({ message, info, onDismiss, className = '' }: Props) {
  const featureLabel = info?.cap ? (FEATURE_LABEL[info.cap] ?? 'this action') : 'this action'
  const next = info?.upgrade
  return (
    <div className={`rounded-xl border border-[#ff9500]/30 bg-[#ff9500]/5 p-4 flex items-start gap-3 ${className}`}>
      <div className="w-8 h-8 rounded-full bg-[#ff9500]/15 flex items-center justify-center flex-shrink-0">
        <Sparkles size={16} className="text-[#ff9500]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
          You&apos;ve hit your {featureLabel} cap{info?.currentTier ? ` on the ${info.currentTier} plan` : ''}.
        </p>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
          {message}
        </p>
        <div className="flex items-center gap-3 mt-3">
          {next && (
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0062c4] transition-colors"
            >
              <Sparkles size={11} /> Upgrade to {next.label}
              {next.limit !== null && <span className="opacity-80">— {next.limit} / month</span>}
              {next.limit === null && <span className="opacity-80">— unlimited</span>}
            </Link>
          )}
          <Link
            href="/pricing"
            className="text-xs text-[#0071e3] hover:underline font-medium"
          >
            See all plans →
          </Link>
        </div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
