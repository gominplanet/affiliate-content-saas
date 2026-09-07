// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Instagram comment→DM automation core (Phase 1). Given a comment event, work
// out whether to auto-DM the commenter that post's affiliate link, dedupe it,
// and send it via Meta Private Replies. Called from the webhook route.
//
// LIVE only once Meta approves the messaging/comment permissions (Phase 2). This
// module + the webhook are built now so the engine is ready + testable against
// the operator's own account under Standard Access. See project_ig_comment_to_dm.

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureDisclaimer } from '@/lib/social-disclaimer'
import { sendPrivateReply, replyToComment, refreshLongLivedToken } from '@/services/instagram'
import { resolveCloakedLink } from '@/lib/link-cloak'
import { postProductDestination, postProductAsin } from '@/lib/post-product-link'

export interface IgCommentEvent {
  igAccountId: string   // the IG account that received the comment (webhook entry.id)
  commentId: string
  text: string
  commenterId: string   // IGSID of the person who commented
  mediaId: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000 // refresh when <7 days left

/** Does the comment contain the trigger keyword as a whole word? Case-insensitive. */
export function matchesKeyword(text: string, keyword: string): boolean {
  const kw = (keyword || '').trim()
  if (!kw || !text) return false
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(text)
}

/** The link a post's DM should send: its product destination, else the blog post
 *  URL as a safe fallback. Cloak the result before sending it. */
export function resolvePostDmLink(post: {
  geniuslink_code?: string | null
  content?: string | null
  wordpress_url?: string | null
}): string | null {
  return postProductDestination(post) || post.wordpress_url || null
}

/** Just the post's product link, with NO blog-URL fallback. Returns null when
 *  the post has no distinct affiliate link — used for the optional "buy it now"
 *  CTA, which must never fall back to the blog URL (that's already the primary
 *  CTA). */
export function resolvePostAffiliateLink(post: {
  geniuslink_code?: string | null
  content?: string | null
}): string | null {
  return postProductDestination(post)
}

// Re-exported so the many call sites that already import from here keep
// working; the ordering itself lives in lib/post-product-link.ts and is tested.
export { postProductDestination, postProductAsin }

/**
 * Fill the {link} placeholder, then guarantee the two things a DM carrying an
 * affiliate link has to say.
 *
 * The template is the creator's to write, and the default was "Here you go
 * {link}". Next to a cloaked link that is a bare mvpl.ink URL with no retailer
 * named and no disclosure, in a private message, which is the least transparent
 * place a link can land. Amazon policy 6(w) wants the placement to make clear it
 * goes to an Amazon Site, and the FTC wants the relationship disclosed where the
 * recommendation is made, not only on a blog somewhere else.
 *
 * Neither is added when the creator already said it, so a template that reads
 * naturally is left exactly as written.
 */
export function renderMessage(template: string, link: string, amazonDestination = false): string {
  const t = (template && template.trim()) || 'Here you go \u{1F517} {link}'
  let out = t.includes('{link}') ? t.replace(/\{link\}/g, link) : `${t}\n${link}`
  if (amazonDestination && !/\bamazon\b/i.test(out)) out = `${out}\n\nThis link goes to Amazon.`
  return ensureDisclaimer(out)
}

/** Read the user's IG token, refreshing + persisting it if it's near expiry. */
async function getValidIgToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
): Promise<{ igUserId: string; accessToken: string } | null> {
  const { data: integ } = await admin
    .from('integrations')
    .select('instagram_user_id,instagram_access_token,instagram_token_expiry')
    .eq('user_id', userId)
    .maybeSingle()
  let accessToken = integ?.instagram_access_token as string | undefined
  const igUserId = integ?.instagram_user_id as string | undefined
  if (!accessToken || !igUserId) return null
  const expiry = Number(integ?.instagram_token_expiry || 0)
  if (expiry && expiry - Date.now() < REFRESH_THRESHOLD_MS) {
    try {
      const refreshed = await refreshLongLivedToken(accessToken)
      accessToken = refreshed.accessToken
      await admin.from('integrations')
        .update({ instagram_access_token: accessToken, instagram_token_expiry: refreshed.expiresAt })
        .eq('user_id', userId)
    } catch { /* keep the current token — it may still be valid */ }
  }
  return { igUserId, accessToken }
}

/**
 * Process one comment webhook event end-to-end. Idempotent + best-effort:
 * every early-return is a deliberate skip, and nothing throws (the webhook must
 * always 200 to Meta). Returns a short outcome for logging.
 *
 * Resolution is driven by the MEDIA id, not the account id. A media id is
 * globally unique and MVP stored it at publish time, so `media → user + link`
 * sidesteps the app-scoped-vs-Business-Account id mismatch that plagues the
 * webhook's entry.id (see migration 170) — we never need to match the account.
 *
 * Two link sources, checked in order:
 *   A) a standalone ig_dm_campaigns row (the upload-a-Reel feature) — its own
 *      keyword + link, self-gated by status='active';
 *   B) an MVP-published blog post — the user's global ig_dm_settings keyword +
 *      that post's own resolved affiliate link.
 */
export async function processCommentEvent(ev: IgCommentEvent): Promise<string> {
  const sb: Sb = createAdminClient()

  // Ignore the account's own comments/replies.
  if (ev.commenterId && ev.commenterId === ev.igAccountId) return 'skip:self'

  const media = ev.mediaId ? String(ev.mediaId).replace(/[^0-9]/g, '') : ''
  if (!media) return 'skip:no-media'

  let userId: string | undefined
  let keyword = ''
  let link: string | null = null
  // Whether the link lands on Amazon, captured where we still know: after the
  // cloak it is unreadable from the URL.
  let amazonDest = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let settings: any = null
  let source: 'campaign' | 'global' = 'global'

  // A) Standalone per-post campaign?
  const { data: campaign } = await sb
    .from('ig_dm_campaigns')
    .select('user_id,keyword,link,status')
    .eq('ig_media_id', media)
    .maybeSingle()
  if (campaign) {
    if (campaign.status !== 'active') return 'skip:campaign-inactive'
    userId = campaign.user_id
    keyword = campaign.keyword
    link = campaign.link
    source = 'campaign'
    // Pull the user's template/public-reply prefs (optional) for the DM body.
    const { data: s } = await sb
      .from('ig_dm_settings')
      .select('message_template,reply_to_comment')
      .eq('user_id', userId)
      .maybeSingle()
    settings = s
  } else {
    // B) MVP-published blog post → global settings + that post's own link.
    const { data: post } = await sb
      .from('blog_posts')
      .select('user_id,geniuslink_code,content,wordpress_url')
      .or(`instagram_image_post_id.eq.${media},instagram_reel_id.eq.${media},instagram_story_id.eq.${media}`)
      .maybeSingle()
    if (!post) {
      // Diagnostic trace row (user_id null, mig 171) so a "webhook fired but we
      // don't recognise the media" miss is visible in the DB — vs. no row at
      // all, which means the webhook never fired (Meta subscription issue).
      console.warn('[ig-dm] no campaign/post for media', media)
      await sb.from('ig_dm_sends').insert({
        comment_id: ev.commentId, media_id: ev.mediaId, commenter_id: ev.commenterId,
        status: 'skipped', error: `no campaign/post for media ${media}`,
      }).then(() => {}, () => {})
      return 'skip:no-media-match'
    }
    userId = post.user_id
    const { data: s } = await sb
      .from('ig_dm_settings')
      .select('enabled,keyword,message_template,reply_to_comment')
      .eq('user_id', userId)
      .maybeSingle()
    if (!s?.enabled) return 'skip:disabled'
    settings = s
    keyword = s.keyword
    link = resolvePostDmLink(post)
    // Cloak it the same way every other surface does. This path used to send
    // whatever resolvePostDmLink returned, which for any post generated while
    // Geniuslink was connected meant a geni.us link going out in DMs long after
    // the creator moved to Passport. A campaign link (branch A) is the
    // creator's own pasted URL and is left exactly as they typed it.
    if (link) {
      amazonDest = !!postProductAsin(post)
      link = await resolveCloakedLink({
        supabase: sb, userId: userId as string, destination: link, asin: postProductAsin(post),
        channel: 'instagram', source: 'instagram', label: null,
      })
    }
  }

  if (!userId) return 'skip:no-user'

  // Keyword gate.
  if (!matchesKeyword(ev.text, keyword)) return 'skip:no-keyword'

  // Dedupe — claim the comment (unique comment_id). A conflict = already handled
  // (Meta redelivery), so we skip without a second DM.
  const { error: claimErr } = await sb.from('ig_dm_sends').insert({
    user_id: userId,
    comment_id: ev.commentId,
    media_id: ev.mediaId,
    commenter_id: ev.commenterId,
    keyword,
    status: 'sent', // optimistic; downgraded to 'failed' below on error
  })
  if (claimErr) return 'skip:duplicate'

  if (!link) {
    await sb.from('ig_dm_sends').update({ status: 'skipped', error: 'no link for media' }).eq('comment_id', ev.commentId)
    return 'skip:no-link'
  }

  // Token + send.
  const tok = await getValidIgToken(sb, userId)
  if (!tok) {
    await sb.from('ig_dm_sends').update({ status: 'failed', error: 'no IG token' }).eq('comment_id', ev.commentId)
    return 'fail:no-token'
  }

  const message = renderMessage(settings?.message_template || '', link, amazonDest)
  try {
    await sendPrivateReply({ igUserId: tok.igUserId, commentId: ev.commentId, message, accessToken: tok.accessToken })
    await sb.from('ig_dm_sends').update({ status: 'sent', link_sent: link }).eq('comment_id', ev.commentId)
  } catch (e) {
    await sb.from('ig_dm_sends').update({ status: 'failed', link_sent: link, error: (e instanceof Error ? e.message : String(e)).slice(0, 400) }).eq('comment_id', ev.commentId)
    return 'fail:send'
  }

  // Optional public "Sent you a DM!" reply (best-effort).
  if (settings?.reply_to_comment) {
    await replyToComment({ commentId: ev.commentId, message: 'Sent you a DM! 📩', accessToken: tok.accessToken })
  }
  return source === 'campaign' ? 'sent:campaign' : 'sent'
}
