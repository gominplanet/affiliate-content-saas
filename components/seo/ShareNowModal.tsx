'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SHARE IT, RIGHT HERE (Seb, 2026-10-12: "these share it buttons should open
// the modals to share directly"). The SEO page's Share it buttons used to send
// the creator to Content with the title typed into the search box, to find the
// post again and press a platform there. This opens the same buttons in place:
// one per connected account, each opening the same preview the Content page
// uses (edit, then publish or schedule), and Pinterest's pin preview.
//
// Connections are read the way the publisher reads them (/api/social/connected,
// VA-aware), so a button here is a post that can be made. When MVP cannot tell
// what is connected it says so instead of showing no buttons.

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { toast } from 'sonner'
import { X, Loader2, Share2, ExternalLink } from 'lucide-react'
import { OrphanPostShare } from '@/components/content/OrphanPostShare'
import { createBrowserClient } from '@/lib/supabase/client'
import type { Tier } from '@/lib/tier'
import type { PinPreviewData } from '@/components/PinterestPreviewModal'

const PinterestPreviewModal = dynamic(
  () => import('@/components/PinterestPreviewModal').then((m) => ({ default: m.PinterestPreviewModal })),
  { ssr: false },
)

interface Setup {
  /** False when MVP could not read which accounts are connected. */
  known: boolean
  on: Set<string>
  disclaimer: string
  groups: Array<{ name: string; url: string }>
  fbAccounts: Array<{ id: string; externalId: string; displayName: string | null; isDefault: boolean }>
}

// Read once per visit: every Share it on the page uses the same accounts.
let setupCache: Promise<Setup> | null = null
function loadSetup(tier: Tier | null): Promise<Setup> {
  if (setupCache) return setupCache
  setupCache = (async () => {
    const [conn, brand, fb] = await Promise.all([
      fetch('/api/social/connected', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      (async () => {
        try {
          const sb = createBrowserClient()
          const { data: { user } } = await sb.auth.getUser()
          if (!user) return null
          const { data } = await sb.from('brand_profiles').select('affiliate_disclaimer,facebook_groups').eq('user_id', user.id).maybeSingle()
          return data as { affiliate_disclaimer?: string | null; facebook_groups?: unknown } | null
        } catch { return null }
      })(),
      tier === 'pro' || tier === 'admin'
        ? fetch('/api/social-accounts?platform=facebook').then((r) => r.json()).catch(() => null)
        : Promise.resolve(null),
    ])
    const known = !!conn && conn.known !== false && Array.isArray(conn.connected)
    return {
      known,
      on: new Set<string>(known ? conn.connected : []),
      disclaimer: brand?.affiliate_disclaimer || '',
      groups: Array.isArray(brand?.facebook_groups) ? (brand!.facebook_groups as Array<{ name: string; url: string }>) : [],
      fbAccounts: Array.isArray(fb?.accounts) ? fb.accounts : [],
    }
  })()
  // A failed read is not kept: the next Share it asks again.
  setupCache.then((s) => { if (!s.known) setupCache = null }).catch(() => { setupCache = null })
  return setupCache
}

/** The board says "x" for X; the share buttons say "twitter". */
const toShareKey = (p: string) => (p === 'x' ? 'twitter' : p)

export interface SharePost { postId: string; title: string; url: string | null; shared?: string[] }

export default function ShareNowModal({ post, tier, onClose, onShared }: {
  post: SharePost
  tier: Tier | null
  onClose: () => void
  /** A platform it was just published to, so the page can show it. */
  onShared?: (platform: string) => void
}) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [pin, setPin] = useState<PinPreviewData | null>(null)
  const [pinBusy, setPinBusy] = useState(false)
  const [pinned, setPinned] = useState((post.shared ?? []).includes('pinterest'))

  useEffect(() => { let live = true; void loadSetup(tier).then((s) => { if (live) setSetup(s) }); return () => { live = false } }, [tier])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pin) onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose, pin])

  async function publishPin(description: string, title: string, linkTarget: 'blog' | 'product' | 'shop' = 'blog'): Promise<{ ok: boolean; error?: string }> {
    if (!pin) return { ok: false, error: 'No pin to publish' }
    setPinBusy(true)
    try {
      const res = await fetch('/api/blog/pinterest-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: pin.postId, postUrl: pin.postUrl, title, description, imageBase64: pin.imageBase64, mediaType: pin.mediaType, fallbackImageUrl: pin.fallbackImageUrl, linkTarget }),
        signal: AbortSignal.timeout(70_000),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: d.error || `Pinterest refused the pin (${res.status})` }
      setPinned(true)
      setPin(null)
      onShared?.('pinterest')
      if (d.pinTargetNote) toast(d.pinTargetNote as string)
      else toast.success('Pinned on Pinterest')
      return { ok: true }
    } catch (e) {
      const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')
      return { ok: false, error: timedOut ? 'Pinterest did not answer in time. Check your Pinterest before trying again.' : (e instanceof Error ? e.message : 'Publish failed') }
    } finally { setPinBusy(false) }
  }

  const on = setup?.on
  const anyConnected = !!on && ['facebook', 'pinterest', 'threads', 'linkedin', 'twitter', 'bluesky', 'telegram'].some((p) => on.has(p))
  const shared = (post.shared ?? []).map(toShareKey)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => { if (!pin) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="share-now-title" className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-5 border-b border-gray-100 dark:border-white/10">
          <Share2 size={18} className="text-[#7C3AED] mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 id="share-now-title" className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Share this post</h3>
            <p className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] mt-1 line-clamp-2">{post.title}</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#a1a1a6] mt-1.5 leading-relaxed">Pick where to share it. Each button opens a preview you can edit before anything posts, or schedule for later.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] flex-shrink-0"><X size={18} /></button>
        </div>
        <div className="p-5">
          {!setup ? (
            <p className="text-[13px] text-[#86868b] inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Reading your connected accounts…</p>
          ) : !setup.known ? (
            <p className="text-[13px] text-[#ff9500]">MVP could not read which accounts are connected just now. Close this and press Share it again, or share it from <Link href={`/content?tab=posts&q=${encodeURIComponent(post.title.slice(0, 60))}`} className="font-semibold text-[#7C3AED] hover:underline">Content</Link>.</p>
          ) : !anyConnected ? (
            <div className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">
              <p>No social account is connected yet, so there is nowhere to share it from MVP.</p>
              <Link href="/connect-socials" className="mt-2 inline-flex items-center gap-1 font-semibold text-[#7C3AED] hover:underline">Connect your socials <ExternalLink size={12} /></Link>
            </div>
          ) : (
            <OrphanPostShare
              postId={post.postId}
              postUrl={post.url}
              postTitle={post.title}
              initialPosted={shared}
              pinned={pinned}
              userTier={(tier || 'amazon') as Tier}
              fbConnected={setup.on.has('facebook')}
              pinterestConnected={setup.on.has('pinterest')}
              threadsConnected={setup.on.has('threads')}
              linkedInConnected={setup.on.has('linkedin')}
              twitterConnected={setup.on.has('twitter')}
              blueskyConnected={setup.on.has('bluesky')}
              telegramConnected={setup.on.has('telegram')}
              brandDisclaimer={setup.disclaimer}
              brandFacebookGroups={setup.groups}
              fbAccounts={setup.fbAccounts}
              onPinPreview={setPin}
              onPublished={(p) => onShared?.(p)}
            />
          )}
          {setup?.known && anyConnected && (
            <p className="mt-3 text-[11px] text-[#86868b]">A button that says &ldquo;On&nbsp;X&rdquo; or &ldquo;Pinned&rdquo; was already shared there from MVP. Instagram and TikTok need a video, so they are on the Content page.</p>
          )}
        </div>
      </div>
      {pin && (
        <div onClick={(e) => e.stopPropagation()}>
          <PinterestPreviewModal data={pin} onPublish={publishPin} onClose={() => { if (!pinBusy) setPin(null) }} />
        </div>
      )}
    </div>
  )
}
