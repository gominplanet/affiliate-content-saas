'use client'

/**
 * Dashboard reminder to install the MVP Affiliate browser extension. The
 * extension powers real-frame capture for thumbnails + in-article photos AND
 * scouts Amazon Creator Connections EPC campaigns — so everyone benefits.
 *
 * Auto-hides once the extension is detected; dismissible otherwise (the choice
 * persists, but it reappears if the extension still isn't installed on a fresh
 * browser since detection is the source of truth).
 */
import { useState, useEffect } from 'react'
import { Puzzle, X, Download, Check } from 'lucide-react'
import { isExtensionAvailable } from '@/lib/extension-frame'

const DISMISS_KEY = 'mvp_ext_reminder_dismissed'

export default function ExtensionReminder() {
  // 'checking' until we know; then 'installed' | 'show' | 'hidden'
  const [state, setState] = useState<'checking' | 'installed' | 'show' | 'hidden'>('checking')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let available = false
      try { available = await isExtensionAvailable() } catch { available = false }
      if (cancelled) return
      if (available) {
        // Installed — never nag again.
        try { localStorage.removeItem(DISMISS_KEY) } catch { /* ignore */ }
        setState('installed')
        return
      }
      let dismissed = false
      try { dismissed = localStorage.getItem(DISMISS_KEY) === '1' } catch { /* ignore */ }
      setState(dismissed ? 'hidden' : 'show')
    })()
    return () => { cancelled = true }
  }, [])

  if (state !== 'show') return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
    setState('hidden')
  }

  return (
    <div className="card p-5 mb-6 border border-[#5856d6]/25 bg-gradient-to-br from-[#f4f3ff] to-white dark:from-[#5856d6]/5 dark:to-transparent relative">
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-3 right-3 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
        title="Hide this reminder"
      >
        <X size={15} />
      </button>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-[#5856d6] flex items-center justify-center flex-shrink-0">
          <Puzzle size={18} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Install the MVP Affiliate browser extension</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4 leading-relaxed">
            One-time, 1-minute install. It grabs <strong>real frames from your videos</strong> so your
            thumbnails and in-article photos look like your actual footage, and it scouts <strong>Amazon
            Creator Connections (EPC)</strong> campaigns straight into your queue. Works in the background — install once and forget it.
          </p>

          <a
            href="/mvp-cc-scout.zip"
            download
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#5856d6] hover:bg-[#4a48c0] transition-colors"
          >
            <Download size={13} /> Download extension (.zip)
          </a>

          <details className="mt-3 group">
            <summary className="text-[11px] font-medium text-[#7C3AED] cursor-pointer select-none">
              How to install (1 min — no Chrome Web Store needed)
            </summary>
            <ol className="list-decimal ml-5 mt-2 space-y-1 text-[11px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed">
              <li>Download the .zip above and <strong>unzip it</strong> (you&apos;ll get a folder).</li>
              <li>Open <code className="font-mono">chrome://extensions</code> in Chrome.</li>
              <li>Turn on <strong>Developer mode</strong> (top-right toggle).</li>
              <li>Click <strong>Load unpacked</strong> and select the unzipped folder.</li>
              <li>Pin it. To scout EPC campaigns, paste your token from <strong>Creator Campaigns → EPC</strong>; the thumbnail/photo frame-grab needs no setup.</li>
            </ol>
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2 leading-relaxed flex items-center gap-1">
              <Check size={11} className="text-[#34c759] flex-shrink-0" />
              This reminder disappears automatically once the extension is detected.
            </p>
          </details>
        </div>
      </div>
    </div>
  )
}
