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
import { pickLinkStyle, geniuslinkCreds } from '@/lib/link-style'

/** The Geniuslink credentials to wrap this share with, or null when Geniuslink
 *  is not the creator's chosen style. The rule is lib/link-style pickLinkStyle,
 *  the same function getLinkStyle uses, so a share link and a YouTube
 *  description can never disagree about a creator's style. Only the read is
 *  local: link-cloak imports this module, so calling back into it would be a
 *  cycle. Answering with the credentials rather than a yes/no is what stops the
 *  other half of the bug: a caller that passed no keys used to get the plain URL
 *  even when the creator's row had a perfectly good pair sitting in it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function geniuslinkStyleCreds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, userId: string,
  apiKey?: string | null, apiSecret?: string | null,
): Promise<{ key: string; secret: string } | null> {
  try {
    const { data: ig } = await supabase
      .from('integrations')
      .select('passport_links_enabled, tier, blog_social_link_mode, wrap_blog_geniuslink, geniuslink_api_key, geniuslink_api_secret')
      .eq('user_id', userId).maybeSingle()
    if (!ig) return null
    if (!!ig.passport_links_enabled && canUsePassport(normalizeTier(ig.tier))) return null // Passport wins
    const creds = geniuslinkCreds(
      { geniuslinkKey: ig.geniuslink_api_key as string | null, geniuslinkSecret: ig.geniuslink_api_secret as string | null },
      { geniuslink_api_key: apiKey, geniuslink_api_secret: apiSecret },
    )
    const style = pickLinkStyle({
      passportEligible: false, // already ruled out above
      mode: (ig.blog_social_link_mode as string | null) || (ig.wrap_blog_geniuslink === true ? 'geniuslink' : ''),
      hasBitly: false, // irrelevant: this only asks "is it geniuslink?"
      hasGeniuslink: !!creds,
    })
    return style === 'geniuslink' ? creds : null
  } catch { return null }
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
  // The style decides FIRST, before the creds and channel checks below.
  // `fallback` prefers a geni.us cached on the post, and a creator who has since
  // moved to Passport still has that cached value sitting on every post they
  // generated back then. Reaching the old ordering with no Geniuslink keys (the
  // exact state after disconnecting Geniuslink) handed that stale link straight
  // back, which is how a Passport creator kept sharing geni.us links.
  const creds = await geniuslinkStyleCreds(supabase, userId, apiKey, apiSecret)
  if (!creds) return base || fallback
  // No destination or a channel we don't group → best plain URL.
  if (!base || !key) return fallback

  // Cached per-channel short link on the post.
  const cache = (post.geniuslink_channel_urls && typeof post.geniuslink_channel_urls === 'object')
    ? post.geniuslink_channel_urls : {}
  const cached = cache[key]
  if (cached && /geni\.us/i.test(cached)) return cached

  try {
    const groupId = await resolveGeniuslinkChannelGroupId({ supabase, userId, channel: key, apiKey: creds.key, apiSecret: creds.secret })
    if (!groupId) return fallback
    const svc = createGeniuslinkService(creds.key, creds.secret)
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
  if (!key) return destination
  // Only geni.us-wrap when Geniuslink is the creator's chosen style; otherwise
  // (Passport / Bitly / Direct) return the destination as-is.
  const creds = await geniuslinkStyleCreds(supabase, userId, apiKey, apiSecret)
  if (!creds) return destination
  try {
    const groupId = await resolveGeniuslinkChannelGroupId({ supabase, userId, channel: key, apiKey: creds.key, apiSecret: creds.secret })
    if (!groupId) return destination
    const svc = createGeniuslinkService(creds.key, creds.secret)
    const url = await svc.createLink(destination, (label || 'Link').slice(0, 120), { groupId })
    return (url && /geni\.us/i.test(url)) ? url : destination
  } catch {
    return destination
  }
}
