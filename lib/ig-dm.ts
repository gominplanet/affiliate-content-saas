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
import { renderMessage, PUBLIC_REPLY, oneWordKeyword } from '@/lib/ig-dm-message'
import { nextDmAt, publicReply, PUBLIC_REPLIES, DM_HOURLY_CAP, DM_REPLY_WINDOW_MS } from '@/lib/ig-pace'
import { confirmLinkStores } from '@/lib/link-store'
import { sendPrivateReply, replyToComment, refreshLongLivedToken } from '@/services/instagram'
import { maybeDecrypt, maybeEncrypt } from '@/lib/secrets'
import { resolveCloakedLink } from '@/lib/link-cloak'
import { postProductDestination, postProductAsin, type PostLinkStyle } from '@/lib/post-product-link'

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
}, opts?: { linkStyle?: PostLinkStyle }): string | null {
  return postProductDestination(post, opts)
}

// Re-exported so the many call sites that already import from here keep
// working; the ordering itself lives in lib/post-product-link.ts and is tested.
export { postProductDestination, postProductAsin }
export type { PostLinkStyle }

// The message itself (renderMessage, stripStopLine, PUBLIC_REPLY) lives in
// lib/ig-dm-message, pure, so the posting window previews the exact DM.
export { renderMessage, stripStopLine, PUBLIC_REPLY, DEFAULT_DM_TEMPLATE, oneWordKeyword } from '@/lib/ig-dm-message'

/** The settings row read as a whole (`select('*')`), so a column a migration has
 *  not added yet reads as its default instead of failing the read, which would
 *  silently turn every DM into "Auto-DM is off". */
export type DmSettings = {
  enabled?: boolean
  keyword?: string
  message_template?: string
  reply_to_comment?: boolean
  any_post?: boolean | null
  fallback_link?: string | null
}

/** Every post, not only the ones MVP published, unless the creator turned it off. */
export function anyPostOn(s: DmSettings | null | undefined): boolean {
  return s?.any_post !== false
}

/** The creator's Link in Bio shop, when it is published. */
export async function shopPageUrl(sb: Sb, userId: string): Promise<string | null> {
  try {
    const { data } = await sb.from('link_pages').select('handle,published').eq('user_id', userId).maybeSingle()
    const handle = String(data?.handle ?? '').trim()
    if (!handle || data?.published === false) return null
    const origin = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io').replace(/\/+$/, '')
    return `${origin}/shop/${encodeURIComponent(handle)}`
  } catch {
    return null
  }
}

/** The link for a comment on a post MVP did not publish: the creator's own
 *  choice, else their Link in Bio shop. Never an invented product link. */
export async function fallbackDmLink(sb: Sb, userId: string, s: DmSettings | null | undefined): Promise<string | null> {
  const own = String(s?.fallback_link ?? '').trim()
  if (/^https?:\/\//i.test(own)) return own
  return shopPageUrl(sb, userId)
}

/**
 * ONE ROW PER COMMENT, saying what happened (Seb, 2026-10-09). The log used to
 * hold a row only when a DM went out or failed, so a comment skipped because
 * the keyword was missing, the feature was off, or the post was not MVP's left
 * nothing behind, and that looked exactly like Meta never sending the comment.
 * The comment id is unique, so a redelivery of the same comment adds nothing.
 */
export async function logDmOutcome(sb: Sb, row: {
  user_id: string | null; comment_id: string; media_id: string | null; commenter_id: string | null
  platform: 'instagram' | 'facebook'; why: string; keyword?: string | null
}): Promise<void> {
  try {
    await sb.from('ig_dm_sends').insert({
      user_id: row.user_id, comment_id: row.comment_id, media_id: row.media_id, commenter_id: row.commenter_id,
      keyword: row.keyword ?? null, status: 'skipped', error: row.why.slice(0, 400), platform: row.platform,
    })
  } catch { /* a log row is never a reason to fail the webhook */ }
}

/** The MVP user behind an Instagram account id from a webhook. The webhook can
 *  carry either the app-scoped id or the professional account id (migration
 *  170), so both are tried. */
export async function ownerOfIgAccount(sb: Sb, igAccountId: string): Promise<string | null> {
  const id = String(igAccountId || '').replace(/[^0-9]/g, '')
  if (!id) return null
  try {
    const { data } = await sb.from('integrations').select('user_id')
      .or(`instagram_user_id.eq.${id},instagram_business_id.eq.${id}`).limit(1).maybeSingle()
    if (data?.user_id) return String(data.user_id)
  } catch { /* instagram_business_id missing: try the publishing id alone */ }
  try {
    const { data } = await sb.from('integrations').select('user_id').eq('instagram_user_id', id).limit(1).maybeSingle()
    return data?.user_id ? String(data.user_id) : null
  } catch {
    return null
  }
}

/** The DM a link sends, exactly as the webhook sends it: the creator's message,
 *  the link, the store it leads to and the disclosure. A link whose address
 *  hides its store (Passport, Geniuslink, Bitly) is followed to it first, so a
 *  Reel's cloaked Amazon link says Amazon. The posting window's preview
 *  (/api/instagram/dm-preview) is built here too: what the creator reads before
 *  posting is what goes out. Never throws. */
export async function dmMessageFor(userId: string, template: string | null | undefined, link: string, amazonDestination = false): Promise<{ message: string; store: string | null }> {
  let store: string | null = amazonDestination ? 'Amazon' : null
  if (!store) {
    try { store = (await confirmLinkStores(userId, link)).confirmed[0]?.store ?? null } catch { /* not confirmed: no store named */ }
  }
  return { message: renderMessage(template || '', link, amazonDestination, store), store }
}

/** Give a Reel that was just published its own Auto-DM: commenting `keyword`
 *  on it DMs `link`. Says why when it could not, so a posting window never
 *  reports an Auto-DM that was not attached (the insert error used to be a
 *  console line while the window said only "Reel live"). Never throws. */
export async function attachReelAutoDm(sb: Sb, row: {
  userId: string; mediaId: string | null | undefined; keyword: unknown; link: unknown
  productName?: string | null; caption?: string | null; videoUrl?: string | null
}): Promise<{ ok: true; keyword: string; link: string } | { ok: false; error: string }> {
  const link = String(row.link ?? '').trim()
  if (!/^https?:\/\//i.test(link)) return { ok: false, error: 'There was no link to send, so Auto-DM was not attached.' }
  const media = String(row.mediaId ?? '').trim()
  if (!media) return { ok: false, error: 'Instagram gave back no post id, so MVP could not attach Auto-DM to this Reel.' }
  const keyword = oneWordKeyword(row.keyword)
  try {
    const { error } = await sb.from('ig_dm_campaigns').insert({
      user_id: row.userId, ig_media_id: media, keyword, link,
      product_name: (row.productName || '').trim() || null,
      caption: row.caption ?? null, video_url: row.videoUrl ?? null, status: 'active',
    })
    if (error) return { ok: false, error: `MVP could not save the Auto-DM for this Reel (${String(error.message || error).slice(0, 160)}).` }
  } catch (e) {
    return { ok: false, error: `MVP could not save the Auto-DM for this Reel (${(e instanceof Error ? e.message : String(e)).slice(0, 160)}).` }
  }
  return { ok: true, keyword, link }
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
  // DECRYPT ON READ, ENCRYPT ON WRITE (2026-10-06 security audit): the token is
  // stored encrypted, and a refreshed one was written back in plain text.
  let accessToken = (maybeDecrypt(integ?.instagram_access_token as string | null | undefined) || undefined) as string | undefined
  const igUserId = integ?.instagram_user_id as string | undefined
  if (!accessToken || !igUserId) return null
  const expiry = Number(integ?.instagram_token_expiry || 0)
  if (expiry && expiry - Date.now() < REFRESH_THRESHOLD_MS) {
    try {
      const refreshed = await refreshLongLivedToken(accessToken)
      accessToken = refreshed.accessToken
      await admin.from('integrations')
        .update({ instagram_access_token: maybeEncrypt(accessToken), instagram_token_expiry: refreshed.expiresAt })
        .eq('user_id', userId)
    } catch { /* keep the current token — it may still be valid */ }
  }
  return { igUserId, accessToken }
}

/**
 * Process one comment webhook event end-to-end. Idempotent + best-effort:
 * nothing throws (the webhook must always 200 to Meta), and every comment
 * leaves one row in the log saying what happened to it.
 *
 * Resolution is driven by the MEDIA id first. Three link sources, in order:
 *   A) an ig_dm_campaigns row: a Reel published with Auto-DM, or any existing
 *      post the creator picked on the Auto-DM page, with its own keyword + link;
 *   B) an MVP-published blog post: the global keyword + that post's own link;
 *   C) any other post on the account (unless "every post" is off): the global
 *      keyword + the creator's fallback link, else their Link in Bio shop.
 *      Before C, a comment on a post MVP did not publish was dropped, and most
 *      creators post from their phone.
 */
export async function processCommentEvent(ev: IgCommentEvent): Promise<string> {
  const sb: Sb = createAdminClient()

  // Ignore the account's own comments/replies, including MVP's public reply.
  if (ev.commenterId && ev.commenterId === ev.igAccountId) return 'skip:self'
  // MVP's public reply, in any of its wordings (lib/ig-pace PUBLIC_REPLIES).
  if (ev.text.trim() === PUBLIC_REPLY || PUBLIC_REPLIES.includes(ev.text.trim())) return 'skip:self'

  const media = ev.mediaId ? String(ev.mediaId).replace(/[^0-9]/g, '') : ''
  if (!media) return 'skip:no-media'

  let userId: string | null = null
  let keyword = ''
  let link: string | null = null
  // Whether the link lands on Amazon, captured where we still know: after the
  // cloak it is unreadable from the URL.
  let amazonDest = false
  let settings: DmSettings | null = null
  let source: 'campaign' | 'global' | 'any' = 'global'
  const skip = async (why: string, code: string): Promise<string> => {
    await logDmOutcome(sb, {
      user_id: userId, comment_id: ev.commentId, media_id: ev.mediaId, commenter_id: ev.commenterId,
      platform: 'instagram', why, keyword: keyword || null,
    })
    return code
  }
  const readSettings = async (uid: string): Promise<DmSettings | null> => {
    const { data } = await sb.from('ig_dm_settings').select('*').eq('user_id', uid).maybeSingle()
    return (data ?? null) as DmSettings | null
  }

  // A) A per-post campaign?
  const { data: campaign } = await sb
    .from('ig_dm_campaigns')
    .select('user_id,keyword,link,status')
    .eq('ig_media_id', media)
    .maybeSingle()
  if (campaign) {
    userId = campaign.user_id
    keyword = campaign.keyword
    if (campaign.status !== 'active') return skip('Auto-DM is turned off for this post.', 'skip:campaign-inactive')
    link = campaign.link
    source = 'campaign'
    settings = await readSettings(campaign.user_id)
  } else {
    // B) An MVP-published blog post: global settings + that post's own link.
    const { data: post } = await sb
      .from('blog_posts')
      .select('user_id,geniuslink_code,content,wordpress_url')
      .or(`instagram_image_post_id.eq.${media},instagram_reel_id.eq.${media},instagram_story_id.eq.${media}`)
      .limit(1)
      .maybeSingle()
    if (post) {
      userId = post.user_id
      settings = await readSettings(post.user_id)
      keyword = settings?.keyword || ''
      if (!settings?.enabled) return skip('Auto-DM is turned off.', 'skip:disabled')
      link = resolvePostDmLink(post)
      // Cloak it the same way every other surface does: a post generated while
      // Geniuslink was connected still sends the creator's current link style.
      if (link) {
        amazonDest = !!postProductAsin(post)
        link = await resolveCloakedLink({
          supabase: sb, userId: post.user_id, destination: link, asin: postProductAsin(post),
          channel: 'instagram', source: 'instagram', label: null,
        })
      }
    } else {
      // C) Any other post on the account.
      userId = await ownerOfIgAccount(sb, ev.igAccountId)
      if (!userId) return skip(`No MVP account is connected to Instagram account ${ev.igAccountId || '(none given)'}.`, 'skip:no-user')
      settings = await readSettings(userId)
      keyword = settings?.keyword || ''
      if (!settings?.enabled) return skip('Auto-DM is turned off.', 'skip:disabled')
      if (!anyPostOn(settings)) return skip('Not a post MVP published, and Auto-DM is set to MVP posts only.', 'skip:not-mvp-post')
      link = await fallbackDmLink(sb, userId, settings)
      source = 'any'
    }
  }

  // Keyword gate.
  if (!matchesKeyword(ev.text, keyword)) return skip(`The comment did not contain "${keyword}".`, 'skip:no-keyword')
  if (!link) {
    return skip(source === 'any'
      ? 'No link to send: this post was not made by MVP, and there is no backup link or published Link in Bio shop.'
      : 'No link to send: MVP found no product link on this post.', 'skip:no-link')
  }

  // Dedupe: claim the comment (unique comment_id). A conflict means it was
  // already handled (Meta redelivery), so no second DM.
  //
  // CLAIMED AS "sending", NOT "sent". It used to be written as sent before the
  // DM went out, so a run cut off mid-send left a row saying sent for a DM that
  // never left. Only Meta's answer turns it into sent.
  const { error: claimErr } = await sb.from('ig_dm_sends').insert({
    user_id: userId,
    comment_id: ev.commentId,
    media_id: ev.mediaId,
    commenter_id: ev.commenterId,
    keyword,
    status: 'sending',
    link_sent: link,
    platform: 'instagram',
  })
  if (claimErr) return 'skip:duplicate'

  // Token + send.
  const tok = await getValidIgToken(sb, userId as string)
  if (!tok) {
    await sb.from('ig_dm_sends').update({ status: 'failed', error: 'Instagram is not connected in MVP (no token). Reconnect Instagram.' }).eq('comment_id', ev.commentId)
    return 'fail:no-token'
  }

  // AT A HUMAN PACE (lib/ig-pace; Seb, 2026-10-26, Alejandro's account was
  // flagged): a DM goes at least 20 seconds after this account's last one and
  // no more than DM_HOURLY_CAP an hour. One that would go sooner waits its
  // turn, and the ig-dm-queue job sends it. Before migration 458 it goes now.
  const due = await dmDueAt(sb, userId as string)
  if (due != null && due > Date.now() + 1000) {
    const { error: qErr } = await sb.from('ig_dm_sends').update({ status: 'queued', send_after: new Date(due).toISOString() }).eq('comment_id', ev.commentId)
    if (!qErr) return 'queued'
  }

  const { message } = await dmMessageFor(userId as string, settings?.message_template, link, amazonDest)
  const out = await deliverDm(sb, { commentId: ev.commentId, message, token: tok, replyPublicly: settings?.reply_to_comment !== false })
  if (!out) return 'fail:send'
  return source === 'campaign' ? 'sent:campaign' : source === 'any' ? 'sent:any' : 'sent'
}

/** When this account's next DM may go, or null before migration 458 (no
 *  sent_at), when MVP cannot pace and sends at once as before. */
async function dmDueAt(sb: Sb, userId: string): Promise<number | null> {
  const now = Date.now()
  const { data: sent, error } = await sb.from('ig_dm_sends').select('sent_at')
    .eq('user_id', userId).eq('platform', 'instagram').eq('status', 'sent')
    .gte('sent_at', new Date(now - 3_600_000).toISOString())
    .order('sent_at', { ascending: false }).limit(DM_HOURLY_CAP + 5)
  if (error) return null
  const { data: q } = await sb.from('ig_dm_sends').select('send_after')
    .eq('user_id', userId).eq('platform', 'instagram').eq('status', 'queued')
    .order('send_after', { ascending: false }).limit(1)
  const times = ((sent || []) as Array<{ sent_at: string | null }>).map((r) => Date.parse(String(r.sent_at))).filter(Number.isFinite)
  const lastQueued = Date.parse(String((q || [])[0]?.send_after ?? ''))
  return nextDmAt({ now, lastSentAt: times[0] ?? null, sentInHour: times, lastQueuedAt: Number.isFinite(lastQueued) ? lastQueued : null })
}

/** Send one DM and say so in the log: sent with when it went, or failed with
 *  Meta's words. The public reply under the comment, in one of its wordings.
 *  True when Meta took it. */
async function deliverDm(sb: Sb, o: { commentId: string; message: string; token: { igUserId: string; accessToken: string }; replyPublicly: boolean }): Promise<boolean> {
  try {
    const sent = await sendPrivateReply({ igUserId: o.token.igUserId, commentId: o.commentId, message: o.message, accessToken: o.token.accessToken })
    const patch = { status: 'sent', error: sent.messageId ? null : 'Meta accepted it but returned no message id.' }
    // sent_at from migration 458; without it the row still says sent.
    const { error: e1 } = await sb.from('ig_dm_sends').update({ ...patch, sent_at: new Date().toISOString() }).eq('comment_id', o.commentId)
    if (e1) await sb.from('ig_dm_sends').update(patch).eq('comment_id', o.commentId)
  } catch (e) {
    await sb.from('ig_dm_sends').update({ status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 400) }).eq('comment_id', o.commentId)
    return false
  }
  // Optional public reply (best-effort), worded differently each time: the
  // same words under every comment read as a bot.
  if (o.replyPublicly) await replyToComment({ commentId: o.commentId, message: publicReply(), accessToken: o.token.accessToken })
  return true
}

/** THE DMS THAT WAITED THEIR TURN (app/api/cron/ig-dm-queue): the ones due
 *  now, oldest first, at most `perAccount` for one account a run, spaced as
 *  lib/ig-pace says. Each is claimed before it is sent, so two runs never send
 *  one twice; one past Instagram's 7 days for a reply is said and left. */
export async function sendQueuedDms(perAccount: number, budgetMs: number): Promise<{ sent: number; failed: number; late: number; moved: number }> {
  const sb: Sb = createAdminClient()
  const started = Date.now()
  const { data } = await sb.from('ig_dm_sends').select('id, user_id, comment_id, link_sent, created_at, send_after')
    .eq('status', 'queued').eq('platform', 'instagram').lte('send_after', new Date().toISOString())
    .order('send_after', { ascending: true }).limit(60)
  const rows = (data || []) as Array<{ id: string; user_id: string; comment_id: string; link_sent: string | null; created_at: string; send_after: string }>
  const byUser = new Map<string, typeof rows>()
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) || []), r])
  let sent = 0, failed = 0, late = 0, moved = 0
  await Promise.all(Array.from(byUser.entries()).map(async ([userId, list]) => {
    const { data: settings } = await sb.from('ig_dm_settings').select('*').eq('user_id', userId).maybeSingle()
    const tok = await getValidIgToken(sb, userId)
    for (const r of list.slice(0, perAccount)) {
      if (Date.now() - started > budgetMs) return
      if (Date.now() - Date.parse(r.created_at) > DM_REPLY_WINDOW_MS) {
        await sb.from('ig_dm_sends').update({ status: 'skipped', error: 'Instagram takes a reply to a comment for 7 days, and this one waited longer than that.' }).eq('id', r.id).eq('status', 'queued')
        late++; continue
      }
      // Still its turn? Another DM may have gone since it was queued.
      const due = await dmDueAt(sb, userId)
      if (due != null && due > Date.now() + 1000) {
        if (due - Date.now() < 30_000 && Date.now() - started + (due - Date.now()) < budgetMs) await new Promise((res) => setTimeout(res, due - Date.now()))
        else { await sb.from('ig_dm_sends').update({ send_after: new Date(due).toISOString() }).eq('id', r.id).eq('status', 'queued'); moved++; return }
      }
      const { data: claimed } = await sb.from('ig_dm_sends').update({ status: 'sending' }).eq('id', r.id).eq('status', 'queued').select('id')
      if (!(claimed || []).length) continue
      if (!settings?.enabled) { await sb.from('ig_dm_sends').update({ status: 'skipped', error: 'Auto-DM was turned off before this one went.' }).eq('id', r.id); continue }
      if (!tok || !r.link_sent) { await sb.from('ig_dm_sends').update({ status: 'failed', error: tok ? 'No link was kept for this DM.' : 'Instagram is not connected in MVP (no token). Reconnect Instagram.' }).eq('id', r.id); failed++; continue }
      const { message } = await dmMessageFor(userId, settings?.message_template, r.link_sent, /amazon\.|amzn\.to|a\.co\//i.test(r.link_sent))
      if (await deliverDm(sb, { commentId: r.comment_id, message, token: tok, replyPublicly: settings?.reply_to_comment !== false })) sent++
      else failed++
    }
  }))
  return { sent, failed, late, moved }
}
