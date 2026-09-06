'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Make me wear it" — one control, every builder.
//
// Nobody holds a jacket up to the camera to review it. The whole reason apparel
// converts is seeing it worn, and every design MVP made put the product beside
// the person instead of on them.
//
// This lives in one file because there are five screens that build a design with
// a face in it (the Amazon thumbnail page, the Pinterest and post composers, the
// one-click fan-out, and the boost panel Launchpad uses), and a toggle written
// five times is a toggle that behaves five ways. The state persists, so a creator
// who works in apparel does not re-tick it on every product.
//
// It only ever means something with a face selected: there is nobody to dress
// without one. And it only ever DOES something when the product turns out to be
// wearable, which the server decides from the product's name, so leaving it on
// for a power bank changes nothing.

import { useCallback, useEffect, useState } from 'react'
import { WEAR_CAVEAT } from '@/lib/wear-product'

const LS_KEY = 'mvp_thumb_wear_product'

/** Shared state for the toggle, persisted like the other design controls. */
export function useWearProduct(): [boolean, (v: boolean) => void] {
  const [wear, setWearState] = useState(false)
  useEffect(() => {
    try { setWearState(localStorage.getItem(LS_KEY) === '1') } catch { /* private window */ }
  }, [])
  const setWear = useCallback((v: boolean) => {
    setWearState(v)
    try { localStorage.setItem(LS_KEY, v ? '1' : '0') } catch { /* private window */ }
  }, [])
  return [wear, setWear]
}

export default function WearProductToggle({ wear, onChange, disabled, compact }: {
  wear: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  /** Tighter, for a panel that is already dense. */
  compact?: boolean
}) {
  return (
    <div
      className={`rounded-xl border ${compact ? 'p-2' : 'p-2.5'}`}
      style={{
        borderColor: wear ? 'rgba(217,119,6,0.4)' : 'var(--border)',
        background: wear ? 'rgba(217,119,6,0.06)' : 'transparent',
      }}
    >
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox" checked={wear} disabled={disabled}
          onChange={() => onChange(!wear)}
          className="accent-[#d97706] w-4 h-4 flex-shrink-0 mt-[2px]"
        />
        <span className={`${compact ? 'text-[12px]' : 'text-[12.5px]'} leading-relaxed`} style={{ color: 'var(--text-soft)' }}>
          <b style={{ color: 'var(--text)' }}>Make me wear it</b>{' '}
          (clothing, shoes, watches, bags, glasses). It goes on you instead of being held up beside you.
          Nothing changes for a product nobody wears.
        </span>
      </label>
      {wear && (
        <p className={`${compact ? 'text-[11px]' : 'text-[11.5px]'} mt-1.5 pl-6 leading-relaxed`} style={{ color: '#b45309' }}>
          {WEAR_CAVEAT}
        </p>
      )}
    </div>
  )
}
