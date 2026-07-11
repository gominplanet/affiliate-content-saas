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
import { sendPrivateReply, replyToComment, refreshLongLivedToken } from '@/services/instagram'

export interface IgCommentEvent {
  igAccountId: string   // the IG account that received the comment (webhook entry.id)
  commentId: string
  text: string
  commenterId: string   // IGSID of the person who commented
  mediaId: string | null
}

const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000 // refresh when <7 days left

/** Does the comment contain the trigger keyword as a whole word? Case-insensitive. */
export function matchesKeyword(text: string, keyword: string): boolean {
  const kw = (keyword || '').trim()
  if (!kw || !text) return false
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(text)
}

/** The link a post's DM should send: geni.us from the stored code → the first
 *  affiliate link in the post body → the blog post URL as a safe fallback. */
export function resolvePostDmLink(post: {
  geniuslink_code?: string | null
  content?: string | null
  wordpress_url?: string | null
}): string | null {
  if (post.geniuslink_code) return `https://geni.us/${post.geniuslink_code}`
  const html = post.content || ''
  // First geni.us or Amazon product link in the body (the CTA).
  const m = html.match(/https?:\/\/(?:geni\.us\/[A-Za-z0-9]+|(?:www\.)?amazon\.[a-z.]+\/[^\s"'<>]*(?:\/dp\/|\/gp\/)[^\s"'<>]*)/i)
  if (m) return m[0]
  return post.wordpress_url || null
}

/** Fill the {link} placeholder in the message template. */
export function renderMessage(template: string, link: string): string {
  const t = (template && template.trim()) || 'Here you go 🔗 {link}'
  return t.includes('{link}') ? t.replace(/\{link\}/g, link) : `${t}\n${link}`
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
 */
export async function processCommentEvent(ev: IgCommentEvent): Promise<string> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // Ignore the account's own comments/replies.
  if (ev.commenterId && ev.commenterId === ev.igAccountId) return 'skip:self'

  // 1. Which user owns this IG account?
  const { data: integ } = await sb
    .from('integrations')
    .select('user_id')
    .eq('instagram_user_id', ev.igAccountId)
    .maybeSingle()
  const userId = integ?.user_id as string | undefined
  if (!userId) return 'skip:no-user'

  // 2. Automation settings — must be enabled.
  const { data: settings } = await sb
    .from('ig_dm_settings')
    .select('enabled,keyword,message_template,reply_to_comment')
    .eq('user_id', userId)
    .maybeSingle()
  if (!settings?.enabled) return 'skip:disabled'

  // 3. Keyword gate.
  if (!matchesKeyword(ev.text, settings.keyword)) return 'skip:no-keyword'

  // 4. Dedupe — claim the comment (unique comment_id). A conflict = already
  //    handled (Meta redelivery), so we skip without a second DM.
  const { error: claimErr } = await sb.from('ig_dm_sends').insert({
    user_id: userId,
    comment_id: ev.commentId,
    media_id: ev.mediaId,
    commenter_id: ev.commenterId,
    keyword: settings.keyword,
    status: 'sent', // optimistic; downgraded to 'failed' below on error
  })
  if (claimErr) return 'skip:duplicate'

  // 5. Resolve the link for the commented-on post.
  let link: string | null = null
  if (ev.mediaId) {
    const { data: post } = await sb
      .from('blog_posts')
      .select('geniuslink_code,content,wordpress_url')
      .eq('user_id', userId)
      .or(`instagram_image_post_id.eq.${ev.mediaId},instagram_reel_id.eq.${ev.mediaId},instagram_story_id.eq.${ev.mediaId}`)
      .maybeSingle()
    if (post) link = resolvePostDmLink(post)
  }
  if (!link) {
    await sb.from('ig_dm_sends').update({ status: 'skipped', error: 'no link for media' }).eq('comment_id', ev.commentId)
    return 'skip:no-link'
  }

  // 6. Token + send.
  const tok = await getValidIgToken(sb, userId)
  if (!tok) {
    await sb.from('ig_dm_sends').update({ status: 'failed', error: 'no IG token' }).eq('comment_id', ev.commentId)
    return 'fail:no-token'
  }

  const message = renderMessage(settings.message_template, link)
  try {
    await sendPrivateReply({ igUserId: tok.igUserId, commentId: ev.commentId, message, accessToken: tok.accessToken })
    await sb.from('ig_dm_sends').update({ status: 'sent', link_sent: link }).eq('comment_id', ev.commentId)
  } catch (e) {
    await sb.from('ig_dm_sends').update({ status: 'failed', link_sent: link, error: (e instanceof Error ? e.message : String(e)).slice(0, 400) }).eq('comment_id', ev.commentId)
    return 'fail:send'
  }

  // 7. Optional public "Sent you a DM!" reply (best-effort).
  if (settings.reply_to_comment) {
    await replyToComment({ commentId: ev.commentId, message: 'Sent you a DM! 📩', accessToken: tok.accessToken })
  }
  return 'sent'
}
