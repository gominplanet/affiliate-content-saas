// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The connect strip that sits above the Social Influencer columns. One card per
// network (Pinterest, Instagram, Facebook) showing connected/not-connected in a
// single place, so creators wire up their accounts before composing and never
// wonder where the connection lives.
//
// It carries id="connections" because it is the destination for every "connect
// it" link on this page. Those links used to point at /connect-socials, which
// the dashboard shell intercepts for the Amazon plan with a card reading "go to
// Social Influencer" — the page they were already on. A creator who could not
// publish clicked the only thing offered and was sent back where they started.
'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Plus, Settings } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'

type PlatformKey = 'pinterest' | 'instagram' | 'facebook'
interface Conn { connected: boolean; name: string | null }
type Status = Record<PlatformKey, Conn>

const PLATFORMS: { key: PlatformKey; name: string; color: string; blurb: string }[] = [
  { key: 'pinterest', name: 'Pinterest', color: '#E60023', blurb: 'Publish Pins to your boards' },
  { key: 'instagram', name: 'Instagram', color: '#E1306C', blurb: 'Reel covers + Link-in-Bio' },
  { key: 'facebook', name: 'Facebook', color: '#1877F2', blurb: 'Post to your Page' },
]

function GlyphDot({ color }: { color: string }) {
  return (
    <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}1a` }}>
      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
    </span>
  )
}

export default function SocialConnections() {
  const [status, setStatus] = useState<Status | null>(null)
  const tier = useEffectiveTier()
  // /connect-socials is walled off for the Amazon plan (it connects its three
  // approved networks here instead), so offering it is offering a door that
  // opens onto this page. Shown to everyone else, who has other networks there.
  const canManageAll = tier !== null && tier !== 'amazon'

  useEffect(() => {
    fetch('/api/amazon/social-status')
      .then(r => r.json())
      .then((d: Status) => setStatus(d))
      .catch(() => setStatus(null))
  }, [])

  return (
    <div id="connections" className="mb-6 scroll-mt-24">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>
          Your connections
        </h2>
        {/* amazon-safe: rendered only when canManageAll, which excludes the
            Amazon plan. Studio and Pro reach this page too and do have other
            networks over there. */}
        {canManageAll && (
          <a href="/connect-socials" className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline" style={{ color: 'var(--text-soft)' }}>
            <Settings size={11} /> Manage all
          </a>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PLATFORMS.map((p) => {
          const conn = status?.[p.key]
          const isConnected = !!conn?.connected
          return (
            <div key={p.key} className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
              <GlyphDot color={p.color} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-bold leading-tight" style={{ color: 'var(--text)' }}>{p.name}</span>
                  {isConnected && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#34c759]">
                      <Check size={11} /> Connected
                    </span>
                  )}
                </div>
                <p className="text-[11px] truncate" style={{ color: 'var(--text-soft)' }}>
                  {status == null ? ' ' : isConnected ? (conn?.name || 'Ready to post') : p.blurb}
                </p>
              </div>
              {status == null ? (
                <Loader2 size={15} className="animate-spin flex-shrink-0" style={{ color: 'var(--text-soft)' }} />
              ) : isConnected ? (
                <a href={`/api/auth/${p.key}`} className="text-[11px] font-medium hover:underline flex-shrink-0" style={{ color: 'var(--text-soft)' }}>
                  Reconnect
                </a>
              ) : (
                <a href={`/api/auth/${p.key}`} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg text-white flex-shrink-0 transition hover:opacity-90" style={{ backgroundColor: p.color }}>
                  <Plus size={13} /> Connect
                </a>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
