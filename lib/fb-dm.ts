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
import { resolvePostDmLink, matchesKeyword, renderMessage, logDmOutcome, fallbackDmLink, anyPostOn, PUBLIC_REPLY, type DmSettings } from '@/lib/ig-dm'
import { postProductAsin } from '@/lib/post-product-link'
import { resolveCloakedLink } from '@/lib/link-cloak'
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
 * best-effort: nothing throws (the webhook must always 200 to Meta), and every
 * comment leaves one row in the log saying what happened to it.
 *
 * A comment on a Page post MVP published sends that post's own link. Any other
 * Page post (unless "every post" is off) sends the creator's backup link, else
 * their Link in Bio shop.
 */
export async function processFacebookCommentEvent(ev: FbCommentEvent): Promise<string> {
  const sb: Sb = createAdminClient()

  // Ignore the Page's own comments/replies, including MVP's public reply.
  if (ev.commenterId && ev.commenterId === ev.pageId) return 'skip:self'
  if (ev.text.trim() === PUBLIC_REPLY) return 'skip:self'
  const page = String(ev.pageId).replace(/[^0-9]/g, '')
  if (!page) return 'skip:bad-page'

  let userId: string | null = null
  let keyword = ''
  const skip = async (why: string, code: string): Promise<string> => {
    await logDmOutcome(sb, {
      user_id: userId, comment_id: ev.commentId, media_id: ev.postId, commenter_id: ev.commenterId,
      platform: 'facebook', why, keyword: keyword || null,
    })
    return code
  }

  // 1. Which user owns this Page? The webhook entry.id is the Page id, which we
  //    stored on connect.
  const { data: integRaw } = await sb
    .from('integrations')
    .select('user_id,facebook_page_id,facebook_page_access_token')
    .eq('facebook_page_id', page)
    .maybeSingle()
  const integ = decryptIntegrationRow(integRaw) // page token is stored encrypted
  userId = (integ?.user_id as string | undefined) ?? null
  if (!userId) return skip(`No MVP account is connected to Facebook Page ${page}.`, 'skip:no-user')
  const pageToken = integ?.facebook_page_access_token as string | undefined
  if (!pageToken) return skip('Facebook is not connected in MVP (no Page token). Reconnect Facebook.', 'skip:no-token')

  // 2. Global settings, shared with Instagram. Read whole so a column a
  //    migration has not added yet cannot fail the read.
  const { data: settingsRow } = await sb.from('ig_dm_settings').select('*').eq('user_id', userId).maybeSingle()
  const settings = (settingsRow ?? null) as DmSettings | null
  keyword = settings?.keyword || ''
  if (!settings?.enabled) return skip('Auto-DM is turned off.', 'skip:disabled')

  // 3. Keyword gate.
  if (!matchesKeyword(ev.text, keyword)) return skip(`The comment did not contain "${keyword}".`, 'skip:no-keyword')

  // 4. The link: the MVP post's own, else the backup for any other post.
  let link: string | null = null
  let mvpPost = false
  if (ev.postId) {
    const { data: post } = await sb
      .from('blog_posts')
      .select('geniuslink_code,content,wordpress_url')
      .eq('user_id', userId)
      .eq('facebook_post_id', ev.postId)
      .limit(1)
      .maybeSingle()
    if (post) {
      mvpPost = true
      link = resolvePostDmLink(post)
      // Cloak per the creator's chosen link style, the same as every other surface.
      if (link) {
        link = await resolveCloakedLink({
          supabase: sb, userId, destination: link, asin: postProductAsin(post),
          channel: 'facebook', source: 'facebook', label: null,
        })
      }
    }
  }
  if (!mvpPost) {
    if (!anyPostOn(settings)) return skip('Not a post MVP published, and Auto-DM is set to MVP posts only.', 'skip:not-mvp-post')
    link = await fallbackDmLink(sb, userId, settings)
  }
  if (!link) {
    return skip(mvpPost
      ? 'No link to send: MVP found no product link on this post.'
      : 'No link to send: this post was not made by MVP, and there is no backup link or published Link in Bio shop.', 'skip:no-link')
  }

  // 5. Dedupe: claim the comment as "sending". Only Meta's answer makes it sent.
  const { error: claimErr } = await sb.from('ig_dm_sends').insert({
    user_id: userId,
    comment_id: ev.commentId,
    media_id: ev.postId,
    commenter_id: ev.commenterId,
    keyword,
    status: 'sending',
    link_sent: link,
    platform: 'facebook',
  })
  if (claimErr) return 'skip:duplicate'

  // 6. Send the private reply.
  const message = renderMessage(settings.message_template || '', link)
  try {
    const id = await sendPrivateReply({ commentId: ev.commentId, message, pageAccessToken: pageToken })
    await sb.from('ig_dm_sends').update({ status: 'sent', error: id ? null : 'Meta accepted it but returned no message id.' }).eq('comment_id', ev.commentId)
  } catch (e) {
    await sb.from('ig_dm_sends').update({ status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 400) }).eq('comment_id', ev.commentId)
    return 'fail:send'
  }

  // 7. Optional public "Sent you a DM!" reply (best-effort).
  if (settings.reply_to_comment !== false) {
    await replyToCommentPublic({ commentId: ev.commentId, message: PUBLIC_REPLY, pageAccessToken: pageToken })
  }
  return mvpPost ? 'sent' : 'sent:any'
}
