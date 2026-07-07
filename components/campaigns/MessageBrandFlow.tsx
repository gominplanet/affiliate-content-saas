'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MessageBrandFlow — the shared "Message brand" entry point for the Levanta &
// PartnerBoost Finders. On open it checks whether the product's ASIN has an
// Amazon Affiliate+ (Creator Connections) campaign:
//   • YES → MessageBrandModal (SCOUT auto-sends on Amazon — the existing flow).
//   • NO / no ASIN → NetworkOutreachModal (draft + copy + open the network page).

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import MessageBrandModal from '@/components/campaigns/MessageBrandModal'
import NetworkOutreachModal from '@/components/campaigns/NetworkOutreachModal'

export interface MessageBrandTarget {
  product: string
  brand: string
  asin?: string | null
  commissionPct?: number | null
  network: 'Levanta' | 'PartnerBoost'
  networkUrl: string
}

export default function MessageBrandFlow({ target, onClose }: { target: MessageBrandTarget; onClose: () => void }) {
  const [phase, setPhase] = useState<'checking' | 'cc' | 'direct'>('checking')
  const [detailsUrl, setDetailsUrl] = useState('')

  useEffect(() => {
    const asin = (target.asin || '').toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) { setPhase('direct'); return }
    let live = true
    fetch(`/api/campaigns/find-by-asin?asin=${encodeURIComponent(asin)}`)
      .then(r => r.json())
      .then(d => {
        if (!live) return
        if (d?.ok && d.found && d.detailsUrl) { setDetailsUrl(d.detailsUrl); setPhase('cc') }
        else setPhase('direct')
      })
      .catch(() => { if (live) setPhase('direct') })
    return () => { live = false }
  }, [target.asin])

  if (phase === 'checking') {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
        <div className="rounded-2xl px-6 py-5 flex items-center gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
          <Loader2 size={18} className="animate-spin text-[#7C3AED]" />
          <span className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Checking for an Affiliate+ campaign…</span>
        </div>
      </div>
    )
  }

  if (phase === 'cc') {
    return (
      <MessageBrandModal
        campaign={{
          product: target.product,
          asin: (target.asin || '').toUpperCase(),
          commissionPct: target.commissionPct ?? null,
          detailsUrl,
          brandLabel: target.brand || undefined,
        }}
        onClose={onClose}
      />
    )
  }

  return (
    <NetworkOutreachModal
      target={{
        product: target.product,
        brand: target.brand,
        network: target.network,
        networkUrl: target.networkUrl,
        asin: target.asin ?? null,
        commissionPct: target.commissionPct ?? null,
      }}
      onClose={onClose}
    />
  )
}
