'use client'

import { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'

/**
 * Lightweight tooltip for "what does this do?" explainers.
 *
 * Usage:
 *   <InfoTip>Your brand voice gets injected into every post we generate. Spend 5 minutes here.</InfoTip>
 *
 * Inline by default — pairs with the label of a field. Click-to-open on touch,
 * hover-to-open on desktop. Auto-positions above the trigger; flips below if
 * there isn't enough room.
 */
export function InfoTip({
  children,
  size = 14,
  className = '',
}: {
  children: React.ReactNode
  size?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top')
  const wrapperRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open || !wrapperRef.current) return
    const rect = wrapperRef.current.getBoundingClientRect()
    // If less than 180px of room above the trigger, flip below.
    setPlacement(rect.top < 180 ? 'bottom' : 'top')
  }, [open])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent | TouchEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span
      ref={wrapperRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="More info"
        onClick={() => setOpen(o => !o)}
        className="text-[#86868b] hover:text-[#0071e3] dark:hover:text-[#4ea3ff] transition-colors inline-flex items-center"
      >
        <Info size={size} />
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute z-50 left-1/2 -translate-x-1/2 w-64 rounded-lg bg-[#1d1d1f] dark:bg-[#f5f5f7] text-white dark:text-[#1d1d1f] text-[12px] leading-relaxed font-normal p-3 shadow-xl ${
            placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {children}
        </span>
      )}
    </span>
  )
}
