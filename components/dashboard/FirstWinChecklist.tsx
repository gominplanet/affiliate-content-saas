'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, ArrowRight, X } from 'lucide-react'

/**
 * First-win onboarding checklist. Unlike the manual external-accounts list, this
 * reads the user's REAL state (passed from the dashboard server component) and
 * checks steps off automatically as they connect things and publish. It points
 * at the single next step so a new user always knows what to do to reach their
 * first published post, instead of facing 15 nav items cold.
 *
 * Auto-hides once the core path is done (brand + a content source + first post),
 * or when dismissed. Dismiss is remembered so returning users aren't nagged.
 */

const STORAGE_KEY = 'mvp_first_win_dismissed'

interface Props {
  brandReady: boolean
  wpConnected: boolean
  youtubeConnected: boolean
  hasContent: boolean
  socialConnected: boolean
}

interface Step { id: string; label: string; desc: string; href: string; cta: string; done: boolean }

export default function FirstWinChecklist(p: Props) {
  const [dismissed, setDismissed] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try { if (localStorage.getItem(STORAGE_KEY) === '1') setDismissed(true) } catch { /* private mode */ }
    setHydrated(true)
  }, [])

  const steps: Step[] = [
    { id: 'brand', label: 'Set up your Brand Profile', desc: 'Your name, logo and colours — used across every post and page.', href: '/brand', cta: 'Set up brand', done: p.brandReady },
    { id: 'source', label: 'Connect YouTube or your blog', desc: 'Connect a YouTube channel to turn videos into content, and your WordPress blog to publish.', href: p.youtubeConnected ? '/wordpress' : '/connect-youtube', cta: 'Connect', done: p.youtubeConnected || p.wpConnected },
    { id: 'content', label: 'Create your first post', desc: 'Turn a video or any product link into a full review, thumbnail and pins.', href: '/content', cta: 'Create a post', done: p.hasContent },
    { id: 'social', label: 'Connect a social account', desc: 'Push your posts to Instagram, Facebook, Pinterest and more.', href: '/connect-socials', cta: 'Connect socials', done: p.socialConnected },
  ]

  const doneCount = steps.filter(s => s.done).length
  const allDone = doneCount === steps.length
  const next = steps.find(s => !s.done)

  if (!hydrated || dismissed || allDone) return null

  function close() {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'rgba(124,58,237,0.25)', background: 'rgba(124,58,237,0.05)' }}>
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold bg-[#7C3AED]/12 text-[#7C3AED]">
            {doneCount}/{steps.length}
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Get your first post live</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">
              {next ? <>Next: <span className="font-medium">{next.label}</span></> : 'Almost there'}
            </p>
          </div>
        </div>
        <button onClick={close} aria-label="Dismiss" className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">
          <X size={16} />
        </button>
      </div>

      <div className="border-t" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
        {steps.map((s, i) => (
          <div
            key={s.id}
            className={`flex items-start gap-3 px-5 py-3 ${i !== steps.length - 1 ? 'border-b' : ''} ${!s.done && s.id === next?.id ? 'bg-[#7C3AED]/[0.04]' : ''}`}
            style={{ borderColor: 'rgba(0,0,0,0.06)' }}
          >
            {s.done
              ? <CheckCircle2 size={19} className="text-[#34c759] mt-0.5 flex-shrink-0" />
              : <Circle size={19} className="text-[#c7c7cc] dark:text-[#48484a] mt-0.5 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${s.done ? 'text-[#86868b] dark:text-[#8e8e93] line-through' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>{s.label}</p>
              {!s.done && <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-0.5">{s.desc}</p>}
            </div>
            {!s.done && (
              <Link
                href={s.href}
                className={`flex-shrink-0 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${s.id === next?.id ? 'text-white bg-[#7C3AED] hover:opacity-90' : 'text-[#7C3AED] hover:underline'}`}
              >
                {s.cta} {s.id === next?.id && <ArrowRight size={12} />}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
