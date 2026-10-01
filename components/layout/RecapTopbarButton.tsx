'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Week recap" in the top bar: flashes from Monday until the creator opens
// /recap for the new week, then stays as a quiet link. Which week is new comes
// from lib/week-window, and "opened" is remembered in this browser.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarCheck } from 'lucide-react'
import { RECAP_SEEN_KEY, weekWindow } from '@/lib/week-window'

export default function RecapTopbarButton() {
  const pathname = usePathname()
  const [fresh, setFresh] = useState(false)

  useEffect(() => {
    const check = () => {
      try { setFresh(localStorage.getItem(RECAP_SEEN_KEY) !== weekWindow().key) } catch { setFresh(false) }
    }
    check()
    window.addEventListener('mvp-recap-seen', check)
    return () => window.removeEventListener('mvp-recap-seen', check)
  }, [])

  const here = pathname === '/recap'
  return (
    <Link href="/recap" title={fresh ? 'Your week recap is ready' : 'Week recap'}
      className={`relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${fresh && !here ? 'text-white bg-[#7C3AED] motion-safe:animate-pulse' : ''}`}
      style={fresh && !here ? undefined : { color: 'var(--text-soft)' }}>
      <CalendarCheck size={14} />
      <span className="hidden sm:inline">Week recap</span>
      {fresh && !here && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#ff3b30] ring-2 ring-white dark:ring-black" aria-label="new" />}
    </Link>
  )
}
