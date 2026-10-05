'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What a Virtual Assistant sees on Connect Socials: the OWNER's connected
// accounts, which are the ones every post goes through (lib/agency-publish).
// No connect or disconnect buttons: the owner connects each account once from
// their own login. A VA without "Publish to socials" is told so here, before
// they try to post.

import { useEffect, useState } from 'react'
import { Check, Loader2, Lock } from 'lucide-react'

const LABEL: Record<string, string> = {
  facebook: 'Facebook Page', instagram: 'Instagram', threads: 'Threads', pinterest: 'Pinterest', tiktok: 'TikTok',
  twitter: 'X', linkedin: 'LinkedIn', bluesky: 'Bluesky', telegram: 'Telegram', youtube: 'YouTube',
}

export type WhoAmI = { isVa: boolean; ownerEmail?: string | null; canPublish: boolean }

export default function VaConnections({ who }: { who: WhoAmI }) {
  const [connected, setConnected] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    fetch('/api/social/connected', { cache: 'no-store' }).then((r) => r.json())
      .then((d) => { if (d?.known) setConnected(Array.isArray(d.connected) ? d.connected : []); else setFailed(true) })
      .catch(() => setFailed(true))
  }, [])
  const owner = who.ownerEmail || 'the account owner'
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl px-4 py-3 text-[13px] leading-relaxed" style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.3)', color: 'var(--text-soft)' }}>
        You are a VA on <b style={{ color: 'var(--text)' }}>{owner}</b>&apos;s team.
        {' '}{who.canPublish
          ? 'Everything you post or schedule goes out through their connected accounts below. You never need their social logins.'
          : 'You can see their connected accounts, but posting is off for you. Ask them to turn on "Publish to socials" for you on the Team page.'}
        {' '}Only the owner can connect or disconnect an account, from their own login.
      </div>
      <div className="card rounded-xl p-4 flex flex-col gap-2">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Connected by the owner</p>
        {failed && <p className="text-[13px]" style={{ color: '#DC2626' }}>MVP could not check the owner&apos;s connections just now. Reload the page to try again.</p>}
        {!failed && !connected && <p className="text-[13px] flex items-center gap-2" style={{ color: 'var(--text-faint)' }}><Loader2 size={14} className="animate-spin" /> Checking…</p>}
        {connected && connected.length === 0 && <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Nothing is connected yet. Ask {owner} to connect their accounts on Connect Socials from their login.</p>}
        {connected && connected.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {connected.map((p) => (
              <li key={p} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold"
                style={who.canPublish ? { background: 'rgba(16,185,129,0.1)', color: '#10B981' } : { background: 'var(--surface-2, rgba(0,0,0,0.05))', color: 'var(--text-soft)' }}>
                {who.canPublish ? <Check size={13} /> : <Lock size={12} />} {LABEL[p] || p}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
