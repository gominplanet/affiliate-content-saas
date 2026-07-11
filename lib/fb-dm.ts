// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Facebook Page comment→DM automation — the Facebook twin of lib/ig-dm.ts.
// A viewer comments the keyword on a Page post MVP published → we DM them that
// post's affiliate link via Meta Private Replies. Shares the user's global
// settings (ig_dm_settings) and the send/dedupe log (ig_dm_sends) with the
// Instagram engine, and reuses its link-resolution + keyword helpers.
//
// LIVE once Meta approves pages_messaging (same App Review as Instagram). Built
// now, dormant + signature-verified. See project_ig_comment_to_dm.

import { createAdminClient } from '@/lib/supabase/admin'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { resolvePostDmLink, matchesKeyword, renderMessage } from '@/lib/ig-dm'
import { sendPrivateReply, replyToCommentPublic } from '@/services/facebook'

export interface FbCommentEvent {
  pageId: string           // the Page that received the comment (webhook entry.id)
  commentId: string
  postId: string | null    // the commented-on Page post (PAGEID_POSTID)
  commenterId: string
  text: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/**
 * Process one Facebook comment webhook event end-to-end. Idempotent +
 * best-effort: every early-return is a deliberate skip and nothing throws (the
 * webhook must always 200 to Meta). Returns a short outcome for logging.
 */
export async function processFacebookCommentEvent(ev: FbCommentEvent): Promise<string> {
  const sb: Sb = createAdminClient()

  // Ignore the Page's own comments/replies.
  if (ev.commenterId && ev.commenterId === ev.pageId) return 'skip:self'
  const page = String(ev.pageId).replace(/[^0-9]/g, '')
  if (!page) return 'skip:bad-page'

  // 1. Which user owns this Page? The webhook entry.id is the Page id, which we
  //    stored on connect — no app-scoped/business id mismatch like Instagram.
  const { data: integRaw } = await sb
    .from('integrations')
    .select('user_id,facebook_page_id,facebook_page_access_token')
    .eq('facebook_page_id', page)
    .maybeSingle()
  const integ = decryptIntegrationRow(integRaw) // page token is stored encrypted
  const userId = integ?.user_id as string | undefined
  if (!userId) {
    // Diagnostic trace (mig 171 nullable user_id) so a "webhook fired but no
    // matching Page" miss is visible — vs. no row, which means it never fired.
    console.warn('[fb-dm] no user for page', page)
    await sb.from('ig_dm_sends').insert({
      comment_id: ev.commentId, media_id: ev.postId, commenter_id: ev.commenterId,
      status: 'skipped', error: `no-user for page ${page}`, platform: 'facebook',
    }).then(() => {}, () => {})
    return 'skip:no-user'
  }
  const pageToken = integ?.facebook_page_access_token as string | undefined
  if (!pageToken) return 'skip:no-token'

  // 2. Global settings — shared with Instagram. Must be enabled.
  const { data: settings } = await sb
    .from('ig_dm_settings')
    .select('enabled,keyword,message_template,reply_to_comment')
    .eq('user_id', userId)
    .maybeSingle()
  if (!settings?.enabled) return 'skip:disabled'

  // 3. Keyword gate.
  if (!matchesKeyword(ev.text, settings.keyword)) return 'skip:no-keyword'

  // 4. Dedupe — claim the comment (unique comment_id). A conflict = already
  //    handled (Meta redelivery), so skip without a second DM.
  const { error: claimErr } = await sb.from('ig_dm_sends').insert({
    user_id: userId,
    comment_id: ev.commentId,
    media_id: ev.postId,
    commenter_id: ev.commenterId,
    keyword: settings.keyword,
    status: 'sent',
    platform: 'facebook',
  })
  if (claimErr) return 'skip:duplicate'

  // 5. Resolve the link for the commented-on Page post.
  let link: string | null = null
  if (ev.postId) {
    const { data: post } = await sb
      .from('blog_posts')
      .select('geniuslink_code,content,wordpress_url')
      .eq('user_id', userId)
      .eq('facebook_post_id', ev.postId)
      .maybeSingle()
    if (post) link = resolvePostDmLink(post)
  }
  if (!link) {
    await sb.from('ig_dm_sends').update({ status: 'skipped', error: 'no link for post' }).eq('comment_id', ev.commentId)
    return 'skip:no-link'
  }

  // 6. Send the private reply.
  const message = renderMessage(settings.message_template, link)
  try {
    await sendPrivateReply({ commentId: ev.commentId, message, pageAccessToken: pageToken })
    await sb.from('ig_dm_sends').update({ status: 'sent', link_sent: link }).eq('comment_id', ev.commentId)
  } catch (e) {
    await sb.from('ig_dm_sends').update({ status: 'failed', link_sent: link, error: (e instanceof Error ? e.message : String(e)).slice(0, 400) }).eq('comment_id', ev.commentId)
    return 'fail:send'
  }

  // 7. Optional public "Sent you a DM!" reply (best-effort).
  if (settings.reply_to_comment) {
    await replyToCommentPublic({ commentId: ev.commentId, message: 'Sent you a DM! 📩', pageAccessToken: pageToken })
  }
  return 'sent'
}
