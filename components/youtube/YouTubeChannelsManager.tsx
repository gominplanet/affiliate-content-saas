'use client'

/**
 * YouTubeChannelsManager — Pro multi-channel control panel (migration 127).
 * Lives on /connect-youtube under the main connect card. Lets a Pro user:
 *   - connect additional YouTube channels (account chooser),
 *   - pick which channel is their default,
 *   - choose the default channel per WordPress site,
 *   - remove a channel.
 * Single-channel / non-Pro users see their one channel + a Pro upsell for
 * adding more. Self-fetches from /api/youtube/channels.
 */

import { useEffect, useState, useCallback } from 'react'
import { Loader2, Plus, Star, Trash2, Youtube } from 'lucide-react'
import { toast } from 'sonner'

interface Channel { id: string; channelId: string; channelTitle: string; isDefault: boolean; hasOAuth: boolean }
interface SiteRow { id: string; label: string; channelRowId: string | null }

export function YouTubeChannelsManager() {
  const [loading, setLoading] = useState(true)
  const [channels, setChannels] = useState<Channel[]>([])
  const [sites, setSites] = useState<SiteRow[]>([])
  const [isPro, setIsPro] = useState(false)
  const [cap, setCap] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/youtube/channels')
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        setChannels(d.channels ?? [])
        setSites(d.sites ?? [])
        setCap(d.cap ?? 1)
        setIsPro(d.tier === 'pro' || d.tier === 'admin')
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function post(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey)
    try {
      const res = await fetch('/api/youtube/channels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Action failed.'); return false }
      await load()
      return true
    } catch { toast.error('Something went wrong.'); return false }
    finally { setBusy(null) }
  }

  // Nothing to manage until at least one channel is connected (the main connect
  // card above handles the zero-state).
  if (loading) return null
  if (channels.length === 0) return null

  const canAddMore = channels.length < cap

  return (
    <div className="card p-6 mt-4">
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your YouTube channels</p>
        {isPro && canAddMore && (
          <a
            href="/api/auth/youtube?returnTo=/connect-youtube&addChannel=1"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] transition-colors"
          >
            <Plus size={13} /> Connect another channel
          </a>
        )}
      </div>
      <p className="text-xs text-[#6e6e73] dark:text-[#8e8e93] mb-4">
        {isPro
          ? 'Run several channels from one account. Set a default, and choose which channel each blog pulls from below.'
          : 'Connecting more than one YouTube channel is a Pro feature.'}
      </p>

      {/* Channel list */}
      <div className="space-y-2">
        {channels.map(ch => (
          <div key={ch.id} className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-white/10 px-3 py-2.5">
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-[#ff0000]/10 text-[#ff0000] shrink-0">
              <Youtube size={15} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{ch.channelTitle}</p>
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] font-mono truncate">{ch.channelId}</p>
            </div>
            {ch.isDefault ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C3AED]"><Star size={12} className="fill-[#7C3AED]" /> Default</span>
            ) : (
              <button
                onClick={() => post({ action: 'setDefault', channelRowId: ch.id }, `def-${ch.id}`)}
                disabled={busy === `def-${ch.id}` || ch.id === 'legacy'}
                className="text-[11px] text-[#86868b] hover:text-[#7C3AED] disabled:opacity-50"
                title="Make this the default channel"
              >
                {busy === `def-${ch.id}` ? <Loader2 size={12} className="animate-spin" /> : 'Make default'}
              </button>
            )}
            {channels.length > 1 && ch.id !== 'legacy' && (
              <button
                onClick={() => post({ action: 'remove', channelRowId: ch.id }, `rm-${ch.id}`)}
                disabled={busy === `rm-${ch.id}`}
                className="text-[#86868b] hover:text-[#ff3b30] disabled:opacity-50"
                title="Disconnect this channel"
              >
                {busy === `rm-${ch.id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Per-site default channel mapping (Pro, multi-channel, has sites) */}
      {isPro && channels.length > 1 && sites.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-200 dark:border-white/10">
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Default channel per blog</p>
          <p className="text-[11px] text-[#6e6e73] dark:text-[#8e8e93] mb-3">
            Pick which channel each WordPress site pulls videos from by default. Leave on “Default channel” to use your default.
          </p>
          <div className="space-y-2">
            {sites.map(s => (
              <div key={s.id} className="flex items-center gap-3">
                <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] flex-1 min-w-0 truncate">{s.label}</span>
                <select
                  value={s.channelRowId ?? ''}
                  disabled={busy === `site-${s.id}`}
                  onChange={(e) => post({ action: 'setSiteChannel', siteId: s.id, channelRowId: e.target.value || null }, `site-${s.id}`)}
                  className="text-xs px-2 py-1.5 rounded-md bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#7C3AED] focus:outline-none max-w-[220px]"
                >
                  <option value="">Default channel</option>
                  {channels.filter(c => c.id !== 'legacy').map(c => (
                    <option key={c.id} value={c.id}>{c.channelTitle}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isPro && (
        <a href="/pricing" className="inline-block mt-4 text-xs font-semibold text-[#7C3AED] hover:underline">
          Upgrade to Pro to run multiple channels →
        </a>
      )}
    </div>
  )
}
