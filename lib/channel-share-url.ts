// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-channel share links. When a post/product goes out to a specific social
// channel, its link is minted into that channel's Geniuslink group (MVP-FACEBOOK,
// MVP-PINTEREST, …) so the Geniuslink dashboard shows clicks BY SOURCE — Facebook
// vs Pinterest vs X vs the blog. One geni.us link belongs to one group, so
// "per channel" means a separate short code per channel (same destination).
//
// Two entry points:
//   channelShareUrl  — the blog URL for a blog_posts row, cached per (post,
//                      channel) on blog_posts.geniuslink_channel_urls.
//   channelWrapLink  — any destination (a direct product/affiliate link, a deal
//                      URL) wrapped in the channel group, no per-post cache.
//
// Everything is best-effort: with no Geniuslink creds, an unknown channel, or an
// API hiccup, these return the plain URL so a post NEVER fails to go out.

import { createGeniuslinkService } from '@/services/geniuslink'
import { resolveGeniuslinkChannelGroupId, channelKey } from '@/lib/geniuslink-group'
import { canUsePassport } from '@/lib/feature-access'
import { normalizeTier } from '@/lib/tier'

/** Is Geniuslink the creator's CHOSEN link style? Only then do we geni.us-wrap a
 *  share link. This mirrors lib/link-cloak getLinkStyle's priority (Passport ON
 *  wins → not geniuslink; else the saved blog_social_link_mode, honoring the
 *  legacy wrap_blog_geniuslink flag), but is inlined here because link-cloak
 *  imports this module — importing it back would be a cycle. When this is false
 *  (Passport / Bitly / Direct) the share helpers return the plain URL, so a
 *  creator who picked another style never gets a surprise geni.us link. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function geniuslinkIsChosenStyle(supabase: any, userId: string): Promise<boolean> {
  try {
    const { data: ig } = await supabase
      .from('integrations')
      .select('passport_links_enabled, tier, blog_social_link_mode, wrap_blog_geniuslink')
      .eq('user_id', userId).maybeSingle()
    if (!ig) return false
    if (!!ig.passport_links_enabled && canUsePassport(normalizeTier(ig.tier))) return false // Passport wins
    const mode = (ig.blog_social_link_mode as string | null) || (ig.wrap_blog_geniuslink === true ? 'geniuslink' : 'direct')
    return String(mode).toLowerCase() === 'geniuslink'
  } catch { return false }
}

interface SharePost {
  id: string
  wordpress_url?: string | null
  geniuslink_blog_url?: string | null
  geniuslink_channel_urls?: Record<string, string> | null
  title?: string | null
}

interface ChannelShareOpts {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  post: SharePost
  channel: string
  userId: string
  apiKey: string | null | undefined
  apiSecret: string | null | undefined
}

/**
 * The link to share for THIS blog post on THIS channel. Returns a geni.us link
 * for the blog URL minted in the channel's group (cached per post+channel), or
 * the best available plain URL when per-channel routing isn't possible.
 */
export async function channelShareUrl(opts: ChannelShareOpts): Promise<string | null> {
  const { supabase, post, userId, apiKey, apiSecret } = opts
  const base = post.wordpress_url || null
  const fallback = post.geniuslink_blog_url || base
  const key = channelKey(opts.channel)
  // No destination, no creds, or a channel we don't group → best plain URL.
  if (!base || !apiKey || !apiSecret || !key) return fallback
  // Only geni.us-wrap when Geniuslink is the creator's chosen style. Passport /
  // Bitly / Direct → share the plain blog URL (no geni.us, no per-click cost).
  if (!(await geniuslinkIsChosenStyle(supabase, userId))) return base

  // Cached per-channel short link on the post.
  const cache = (post.geniuslink_channel_urls && typeof post.geniuslink_channel_urls === 'object')
    ? post.geniuslink_channel_urls : {}
  const cached = cache[key]
  if (cached && /geni\.us/i.test(cached)) return cached

  try {
    const groupId = await resolveGeniuslinkChannelGroupId({ supabase, userId, channel: key, apiKey, apiSecret })
    if (!groupId) return fallback
    const svc = createGeniuslinkService(apiKey, apiSecret)
    const url = await svc.createLink(base, (post.title || 'Blog post').slice(0, 120), { groupId })
    if (url && /geni\.us/i.test(url)) {
      // Merge into the per-channel cache on the row (best-effort).
      await supabase.from('blog_posts')
        .update({ geniuslink_channel_urls: { ...cache, [key]: url } })
        .eq('id', post.id)
        .then(() => undefined, () => undefined)
      return url
    }
  } catch { /* fall through to the plain URL */ }
  return fallback
}

interface ChannelWrapOpts {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  destination: string
  channel: string
  userId: string
  apiKey: string | null | undefined
  apiSecret: string | null | undefined
  label?: string
}

/**
 * Wrap an arbitrary destination (a direct product/affiliate link, a deal URL) in
 * the channel's Geniuslink group. Returns a geni.us link on success, otherwise
 * the destination unchanged. No per-post cache — use for one-off/quick-post links.
 * Skips wrapping a link that's already a geni.us link.
 */
export async function channelWrapLink(opts: ChannelWrapOpts): Promise<string> {
  const { supabase, destination, userId, apiKey, apiSecret, label } = opts
  if (!destination) return destination
  if (/geni\.us/i.test(destination)) return destination
  const key = channelKey(opts.channel)
  if (!apiKey || !apiSecret || !key) return destination
  // Only geni.us-wrap when Geniuslink is the creator's chosen style; otherwise
  // (Passport / Bitly / Direct) return the destination as-is.
  if (!(await geniuslinkIsChosenStyle(supabase, userId))) return destination
  try {
    const groupId = await resolveGeniuslinkChannelGroupId({ supabase, userId, channel: key, apiKey, apiSecret })
    if (!groupId) return destination
    const svc = createGeniuslinkService(apiKey, apiSecret)
    const url = await svc.createLink(destination, (label || 'Link').slice(0, 120), { groupId })
    return (url && /geni\.us/i.test(url)) ? url : destination
  } catch {
    return destination
  }
}
