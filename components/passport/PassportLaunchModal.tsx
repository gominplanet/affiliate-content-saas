'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One-time launch modal for Passport Links (graduated out of Labs). Studio + Pro
// get the "it's live, go use it" version; lower tiers get an upgrade tease. Shown
// once per viewer (localStorage), skips admin. Bump LAUNCH_KEY to re-announce a
// future milestone.

import { useEffect, useState } from 'react'
import { Globe, X, ArrowRight, Check } from 'lucide-react'
import { canUsePassport } from '@/lib/feature-access'
import { normalizeTier, type Tier } from '@/lib/tier'

const LAUNCH_KEY = 'mvp_passport_launch_v1'

export default function PassportLaunchModal({ tier }: { tier?: Tier | string | null }) {
  const [show, setShow] = useState(false)
  const t = normalizeTier(tier)
  const canUse = canUsePassport(t)
  const isAdmin = t === 'admin'

  useEffect(() => {
    if (isAdmin) return
    try { if (localStorage.getItem(LAUNCH_KEY) === '1') return } catch { /* private mode → show */ }
    setShow(true)
  }, [isAdmin])

  if (!show || isAdmin) return null

  function close() {
    try { localStorage.setItem(LAUNCH_KEY, '1') } catch { /* ignore */ }
    setShow(false)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={close}>
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.16), rgba(52,199,89,0.12))' }}>
          <button onClick={close} aria-label="Close" className="absolute top-3 right-3" style={{ color: 'var(--text-faint)' }}><X size={18} /></button>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: 'linear-gradient(135deg, #7C3AED, #34c759)', color: '#fff' }}>
            <Globe size={24} />
          </div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: '#7C3AED' }}>{canUse ? 'Now live' : 'New on Studio & Pro'}</p>
          <h2 className="text-[20px] font-bold mt-1" style={{ color: 'var(--text)' }}>Introducing Passport Links</h2>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            One link that sends every shopper to their <b>own country&rsquo;s Amazon</b> with your tag there, so you earn on international clicks instead of losing them. Built into MVP, free, and it works on your blog and socials alike.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {[
              'Each visitor is geo-routed to their local Amazon store',
              'Organize links into groups and see clicks by country, product, and group',
              'No Geniuslink or OneLink needed, it’s all built in',
            ].map((t) => (
              <div key={t} className="flex items-start gap-2 text-[12.5px]" style={{ color: 'var(--text)' }}>
                <Check size={15} className="flex-shrink-0 mt-0.5" style={{ color: '#34c759' }} />
                <span>{t}</span>
              </div>
            ))}
          </div>

          {!canUse && (
            <div className="mt-4 rounded-lg px-3 py-2.5" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)' }}>
              <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>
                Passport Links is available on the <b>Studio</b> and <b>Pro</b> plans. Upgrade to turn every link into a worldwide-earning link.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex items-center gap-2">
          {canUse ? (
            <a href="/passport" onClick={close} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-semibold text-white" style={{ background: '#7C3AED' }}>
              Open Passport Links <ArrowRight size={15} />
            </a>
          ) : (
            <a href="/pricing" onClick={close} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-semibold text-white" style={{ background: '#7C3AED' }}>
              See plans <ArrowRight size={15} />
            </a>
          )}
          <button onClick={close} className="px-4 py-2.5 rounded-lg text-[13px] font-medium" style={{ color: 'var(--text-soft)' }}>
            {canUse ? 'Later' : 'Not now'}
          </button>
        </div>
      </div>
    </div>
  )
}
