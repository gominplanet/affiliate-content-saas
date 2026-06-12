'use client'

/**
 * /connect-youtube — a focused, standalone YouTube connection page.
 *
 * YouTube is the most important integration (it's what every video→blog flow
 * starts from), so it gets its own SET UP entry rather than being buried in the
 * full Connect Socials grid. Reuses the same OAuth start/callback + disconnect
 * endpoints as the funnel and the Settings panel — single source of truth for
 * the token; this page is just a dedicated surface for it.
 */

import { useEffect, useState, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { createBrowserClient } from '@/lib/supabase/client'
import { Youtube, Check, Loader2, LogOut, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

export default function ConnectYouTubePage() {
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [channelId, setChannelId] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  const load = useCallback(async () => {
    try {
      const supabase = createBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from('integrations')
        .select('youtube_oauth_access_token, youtube_channel_id')
        .eq('user_id', user.id).maybeSingle()
      setConnected(!!data?.youtube_oauth_access_token)
      setChannelId(data?.youtube_channel_id ?? null)
    } catch { /* leave as not-connected */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // The OAuth callback returns here (returnTo=/connect-youtube) with a result
  // marker — surface it, refresh, then strip the params.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const ok = sp.get('youtube_oauth_connected')
    const err = sp.get('youtube_error')
    if (!ok && !err) return
    if (ok) { toast.success('YouTube connected.'); void load() }
    else if (err) toast.error(`Couldn’t connect YouTube: ${decodeURIComponent(err)}`)
    const url = new URL(window.location.href)
    url.searchParams.delete('youtube_oauth_connected')
    url.searchParams.delete('youtube_error')
    window.history.replaceState({}, '', url.pathname)
  }, [load])

  async function disconnect() {
    setDisconnecting(true)
    try {
      const res = await fetch('/api/auth/youtube/disconnect', { method: 'POST' })
      if (res.ok) { toast.success('YouTube disconnected.'); setConnected(false); setChannelId(null) }
      else toast.error('Could not disconnect. Try again.')
    } catch { toast.error('Something went wrong. Try again.') }
    finally { setDisconnecting(false) }
  }

  return (
    <>
      <PageHero
        title="Connect YouTube"
        subtitle="The heart of MVP — connect once and we can pull your videos and drafts to turn any of them into a blog post. One click, sign in with Google, done. We figure out your channel automatically."
      />

      <div className="max-w-2xl">
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-[#ff0000]/10 text-[#ff0000]">
              <Youtube size={20} />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">YouTube</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#8e8e93]">
                {loading ? 'Checking connection…' : connected ? 'Connected' : 'Not connected yet'}
              </p>
            </div>
            {!loading && connected && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#34c759]">
                <Check size={14} /> Connected
              </span>
            )}
          </div>

          {loading ? (
            <Loader2 size={18} className="animate-spin text-[#86868b]" />
          ) : connected ? (
            <div className="space-y-3">
              {channelId && (
                <p className="text-xs text-[#6e6e73] dark:text-[#8e8e93]">
                  Channel ID: <code className="font-mono text-[11px] bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded">{channelId}</code>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <a href="/co-pilot" className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] transition-colors">
                  Open YouTube Co-Pilot <ExternalLink size={13} />
                </a>
                <button
                  onClick={disconnect}
                  disabled={disconnecting}
                  className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:bg-black/[0.03] disabled:opacity-50 transition-colors"
                >
                  {disconnecting ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} Disconnect
                </button>
              </div>
            </div>
          ) : (
            <a
              href="/api/auth/youtube?returnTo=/connect-youtube"
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] transition-colors"
            >
              <Youtube size={16} /> Connect YouTube
            </a>
          )}
        </div>

        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-3">
          Need to connect Instagram, TikTok, Pinterest, X and the rest? Those live on{' '}
          <a href="/connect-socials" className="text-[#7C3AED] hover:underline">Connect Socials</a>.
        </p>
      </div>
    </>
  )
}
