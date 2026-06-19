'use client'

/**
 * OrphanPostShare — the social fan-out row for a published post that has NO
 * source YouTube video (a "from a link" post, or an older orphan). The rich
 * VideoCard is video-coupled, so video-less posts used to land in the "Older
 * posts archive" with View / Images / Edit / Delete only — no way to push
 * them to socials. This restores that: every social push route
 * (/api/blog/<platform>-post) keys off the WordPress post id alone, so a
 * video-less post can fan out exactly like a video-backed one.
 *
 * Mirrors the horizontal SocialPill block inside VideoCard: one pill per
 * connected text platform, gated by tier, opening the shared
 * SocialPreviewModal (preview → edit → publish/schedule). Facebook reuses the
 * modal's manual-share block (Meta's API can't post to Groups).
 */

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Facebook, MessageCircle, Pin } from 'lucide-react'
import { SocialPill } from '@/components/content/SocialPill'
import { tierAllowsSocial } from '@/lib/tier'
import type { Tier } from '@/lib/tier'
import type { PinPreviewData } from '@/components/PinterestPreviewModal'

const SocialPreviewModal = dynamic(
  () => import('@/components/content/SocialPreviewModal').then(m => ({ default: m.SocialPreviewModal })),
  { ssr: false },
)

type SchedulablePlatform = 'facebook' | 'threads' | 'twitter' | 'linkedin' | 'bluesky' | 'telegram'

const X_ICON = <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
const LINKEDIN_ICON = <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
const BLUESKY_ICON = <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364-3.911.58-7.386 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z" /></svg>
const TELEGRAM_ICON = <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>

interface PlatformCfg {
  key: SchedulablePlatform
  label: string
  postedLabel: string
  brand: string
  icon: React.ReactNode
  endpoint: string
  connected: boolean
}

export function OrphanPostShare(props: {
  postId: string
  postUrl: string | null
  /** Title + image of the WordPress post — used to publish a WP-only post
   *  (no blog_posts row) directly, so social pushes don't 404. */
  postTitle?: string | null
  postImage?: string | null
  userTier: Tier
  fbConnected: boolean
  pinterestConnected: boolean
  threadsConnected: boolean
  linkedInConnected: boolean
  twitterConnected: boolean
  blueskyConnected: boolean
  telegramConnected: boolean
  brandDisclaimer?: string
  brandFacebookGroups?: Array<{ name: string; url: string }>
  fbAccounts?: Array<{ id: string; externalId: string; displayName: string | null; isDefault: boolean }>
  /** Bubble the generated pin assets up to the page-level PinterestPreviewModal
   *  (shared with VideoCard) — Pinterest uses an image flow, not the text
   *  SocialPreviewModal the other platforms here use. */
  onPinPreview: (data: PinPreviewData) => void
}) {
  const {
    postId, postUrl, postTitle, postImage, userTier,
    fbConnected, pinterestConnected, threadsConnected, linkedInConnected, twitterConnected, blueskyConnected, telegramConnected,
    brandDisclaimer, brandFacebookGroups, fbAccounts, onPinPreview,
  } = props

  const [posted, setPosted] = useState<Set<SchedulablePlatform>>(new Set())
  const [open, setOpen] = useState<PlatformCfg | null>(null)
  const [pinLoading, setPinLoading] = useState(false)

  // Pinterest pins an IMAGE, so it doesn't use the text SocialPreviewModal —
  // fetch the pin assets, then hand them to the page's PinterestPreviewModal
  // (the exact flow VideoCard uses). The pinterest-preview/-post routes resolve
  // this row's WordPress post id to the blog_posts row server-side.
  async function handlePinPreview() {
    setPinLoading(true)
    try {
      const res = await fetch('/api/blog/pinterest-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, postUrl, postTitle, postImage }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Failed to generate pin preview'); return }
      onPinPreview({ postId, postUrl, ...d })
    } catch { toast.error('Failed to generate pin preview') }
    finally { setPinLoading(false) }
  }

  const platforms: PlatformCfg[] = [
    { key: 'twitter', label: 'X', postedLabel: 'On X', brand: '#000000', icon: X_ICON, endpoint: '/api/blog/twitter-post', connected: twitterConnected },
    { key: 'linkedin', label: 'LinkedIn', postedLabel: 'On LinkedIn', brand: '#0A66C2', icon: LINKEDIN_ICON, endpoint: '/api/blog/linkedin-post', connected: linkedInConnected },
    { key: 'bluesky', label: 'Bluesky', postedLabel: 'On Bluesky', brand: '#1185fe', icon: BLUESKY_ICON, endpoint: '/api/blog/bluesky-post', connected: blueskyConnected },
    { key: 'telegram', label: 'Telegram', postedLabel: 'On Telegram', brand: '#229ED9', icon: TELEGRAM_ICON, endpoint: '/api/blog/telegram-post', connected: telegramConnected },
    { key: 'facebook', label: 'Facebook', postedLabel: 'On Facebook', brand: '#1877F2', icon: <Facebook size={11} />, endpoint: '/api/blog/facebook-post', connected: fbConnected },
    { key: 'threads', label: 'Threads', postedLabel: 'On Threads', brand: '#000000', icon: <MessageCircle size={11} />, endpoint: '/api/blog/threads-post', connected: threadsConnected },
  ]

  const visible = platforms.filter(p => p.connected)
  if (visible.length === 0 && !pinterestConnected) return null

  const defaultFbAccount = fbAccounts?.find(a => a.isDefault) || fbAccounts?.[0]

  return (
    <div className="flex items-center gap-1.5 flex-wrap pt-2 mt-2 border-t border-[#e5e5ea] dark:border-white/10">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mr-1">Publish to</span>
      {visible.map(p => (
        <SocialPill
          key={p.key}
          brand={p.brand}
          icon={p.icon}
          label={p.label}
          postedLabel={p.postedLabel}
          posted={posted.has(p.key)}
          loading={false}
          onClick={() => setOpen(p)}
          locked={!tierAllowsSocial(userTier, p.key)}
        />
      ))}

      {/* Pinterest — image flow, opens the shared page-level preview modal. */}
      {pinterestConnected && (
        <SocialPill
          brand="#E60023"
          icon={<Pin size={11} />}
          label="Pinterest"
          postedLabel="Pinned"
          posted={false}
          loading={pinLoading}
          onClick={handlePinPreview}
          locked={!tierAllowsSocial(userTier, 'pinterest')}
        />
      )}

      {open && (
        <SocialPreviewModal
          platform={open.label}
          platformKey={open.key}
          brandColor={open.brand}
          endpoint={open.endpoint}
          postId={postId}
          // postUrl lets the server resolve video-less rows to their blog_posts
          // row by WordPress permalink when the WP id can't be mapped (the
          // "Post not found" fix). socialAccountId rides along for Facebook.
          extraBody={{
            ...(postUrl ? { postUrl } : {}),
            ...(open.key === 'facebook' && defaultFbAccount ? { socialAccountId: defaultFbAccount.id } : {}),
          }}
          onClose={() => setOpen(null)}
          onPublished={() => { setPosted(prev => new Set(prev).add(open.key)); setOpen(null) }}
          onScheduled={() => { setPosted(prev => new Set(prev).add(open.key)); setOpen(null) }}
          {...(open.key === 'facebook'
            ? {
                shareUrl: postUrl || undefined,
                shareDisclaimer: brandDisclaimer,
                facebookGroups: brandFacebookGroups,
                publishTargetLabel: defaultFbAccount?.displayName || undefined,
              }
            : {})}
        />
      )}
    </div>
  )
}
