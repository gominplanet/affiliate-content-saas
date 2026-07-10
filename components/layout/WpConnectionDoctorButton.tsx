'use client'

import { useEffect, useState } from 'react'
import { Stethoscope } from 'lucide-react'

/**
 * GLOBAL "Fix connection" alert in the dashboard top bar, a sibling to
 * <WpUpdateTopbarButton> and <ScoutTopbarButton>. Like them, it renders
 * NOTHING unless there's something to act on — here, a recent blog publish
 * that WordPress refused (firewall/WAF block, deactivated plugin, bad app
 * password). See /api/wordpress/connection-health for the detection.
 *
 * When it shows, one click opens the Connection Doctor at /setup/wp-doctor,
 * which names the exact plugin/firewall and gives fix steps. Amber so it reads
 * as "attention needed" without the louder orange of the update button.
 *
 * Mount only when a WordPress site is connected (no site → nothing to publish
 * to → no publish failures to surface).
 */
export default function WpConnectionDoctorButton() {
  const [needsAttention, setNeedsAttention] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/wordpress/connection-health')
        const data = await res.json().catch(() => ({}))
        if (!cancelled) setNeedsAttention(!!data.needsAttention)
      } catch {
        // Health probe is best-effort — on any error, stay hidden.
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!needsAttention) return null

  return (
    <a
      href="/setup/wp-doctor"
      title="A recent publish was blocked by your WordPress site (firewall or plugin). Click to run the Connection Doctor — it names the exact cause and gives fix steps."
      className="px-3 py-2 rounded-lg text-[12px] font-semibold text-white inline-flex items-center gap-1.5 transition-transform hover:-translate-y-0.5"
      style={{ background: 'linear-gradient(135deg, #F5A623 0%, #E8890B 100%)', boxShadow: '0 2px 10px rgba(232,137,11,0.35)' }}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70"></span>
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white"></span>
      </span>
      <Stethoscope size={13} /> Fix connection
    </a>
  )
}
