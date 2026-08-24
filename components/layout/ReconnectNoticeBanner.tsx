'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One-time precautionary nudge after the recent social-posting fixes: asks
// creators to reconnect their social accounts so posting keeps working. Slim,
// dismissible, remembered in localStorage (versioned key — bump NOTICE_KEY to
// re-show after a future round of changes). Hides itself on the connect page.
// Skips admin. Matches the UsageNudge banner styling under the topbar.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { RefreshCw, X, ArrowRight } from 'lucide-react'

const NOTICE_KEY = 'mvp_reconnect_notice_2026_08'

export default function ReconnectNoticeBanner({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname()
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Only decide on the client (localStorage) to avoid an SSR flash.
    try { if (localStorage.getItem(NOTICE_KEY) === '1') { setShow(false); return } } catch { /* private mode → show */ }
    setShow(true)
  }, [])

  if (!show || isAdmin) return null
  // No point nagging while they're already on the reconnect page.
  if (pathname?.startsWith('/connect-socials')) return null

  function close() {
    try { localStorage.setItem(NOTICE_KEY, '1') } catch { /* ignore */ }
    setShow(false)
  }

  return (
    <div
      className="flex items-center gap-2.5 border-b px-6 py-2 text-[12px]"
      style={{ borderColor: 'var(--border)', backgroundColor: 'rgba(124,58,237,0.08)' }}
    >
      <RefreshCw size={14} style={{ color: '#7C3AED' }} className="flex-shrink-0" />
      <span style={{ color: 'var(--text)' }}>
        We shipped some big updates to social posting recently. As a precaution, please <b>reconnect your social accounts</b> so publishing keeps working smoothly.
      </span>
      <Link
        href="/connect-socials"
        onClick={close}
        className="ml-auto flex-shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white"
        style={{ background: '#7C3AED' }}
      >
        Reconnect socials <ArrowRight size={12} />
      </Link>
      <button onClick={close} aria-label="Dismiss" className="flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
        <X size={14} />
      </button>
    </div>
  )
}
