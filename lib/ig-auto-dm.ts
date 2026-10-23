// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AUTO-DM ON EVERY INSTAGRAM POST MVP MAKES (Seb, 2026-10-23: "anywhere a
// user can use instagram, this auto dm feature should be set up and ready to
// use"). Until now only a Reel posted from Clip Factory, Shorts Studio or the
// Auto-DM page carried its own keyword and link. A blog post's Reel, a Short,
// an Amazon or deal post, a scheduled post and an Instagram burner Reel had
// none, and a comment on them got the account-wide backup link at best, and
// only with the account-wide switch on.
//
// Every Reel and feed post MVP publishes now goes through here:
//   1. autoDmPlan, before publishing: the creator's keyword and THIS post's own
//      link (its Link in Bio product page, its blog post, or its product link,
//      lib/dm-link-options autoDmLink), unless the creator turned "posts MVP
//      makes" off (ig_dm_settings.mvp_posts, migration 454) or cannot use
//      Auto-DM. `ready` says whether the account is set to receive comments.
//   2. captionForPlan: "Comment LINK and I'll DM you the link." goes in the
//      caption only when the account is ready, so a caption never promises a
//      DM that cannot come.
//   3. finishAutoDm, after publishing: the post's own Auto-DM row, the product
//      put on the Link in Bio page the DM points at, comment alerts on. What
//      happened comes back in words (autoDmWords) for the window or note.
// A posting window that shows the Auto-DM block (components/instagram/
// ReelAutoDm) sends the creator's own choice instead, or false when they
// unticked it, and that is respected. Stories take no comments, so no Story
// gets one. Server only. Never throws.

import { canUseIgDm } from '@/lib/ig-dm-access'
import { attachReelAutoDm } from '@/lib/ig-dm'
import { oneWordKeyword } from '@/lib/ig-dm-message'
import { withDmCta } from '@/lib/dm-caption-cta'
import { dmLinkOptions, autoDmLink, type DmLinkKind, type DmLinkOptions } from '@/lib/dm-link-options'
import { commentSubscription, subscribeToComments } from '@/services/instagram'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type AutoDmPlan = {
  keyword: string
  link: string
  kind: DmLinkKind | null
  /** The account is set to send comments to MVP. */
  ready: boolean
  /** For a Link in Bio product page: the product to put on it. */
  tile: { asin: string; title: string; url: string } | null
  /** Chosen by the creator in a posting window (the caption is theirs). */
  chosen: boolean
}

/** What a posting window sends: its choice, false (unticked), or nothing (no
 *  block shown, or an automatic post). */
export type AutoDmChoice = { link?: string; keyword?: string; kind?: string; productName?: string } | false | null | undefined

export type AutoDmOutcome = { ok: true; keyword: string; link: string; ready: boolean } | { ok: false; error: string }

/** The product a Link in Bio product page needs on it: the affiliate link
 *  for its tile. Null when the product is not known. */
function shopTile(o: DmLinkOptions, name?: string | null): AutoDmPlan['tile'] {
  const aff = o.options.find((x) => x.kind === 'amazon')
  return o.asin && aff ? { asin: o.asin, title: (String(name ?? '').trim() || o.title || 'Shop this').trim(), url: aff.url } : null
}

/** The plan for one post. `find` is what MVP knows about it, to find its
 *  links; `link` is the caller's own product link when it has no better. */
export async function autoDmPlan(sb: Db, opts: {
  userId: string
  tier: string | null | undefined
  choice?: AutoDmChoice
  find?: { videoId?: string | null; postId?: string | null; product?: string | null }
  link?: string | null
  igUserId?: string | null
  accessToken?: string | null
}): Promise<AutoDmPlan | null> {
  try {
    if (opts.choice === false) return null
    if (!canUseIgDm(opts.tier)) return null
    const ready = async () => {
      if (!opts.igUserId || !opts.accessToken) return false
      const sub = await commentSubscription({ igUserId: opts.igUserId, accessToken: opts.accessToken })
      return !!sub.fields?.includes('comments')
    }

    // The creator's own choice in a window.
    if (opts.choice && typeof opts.choice === 'object') {
      const link = String(opts.choice.link ?? '').trim()
      if (!/^https?:\/\//i.test(link)) return null
      const k = opts.choice.kind
      const kind: DmLinkKind | null = k === 'shop' || k === 'blog' || k === 'amazon' ? k : null
      let tile: AutoDmPlan['tile'] = null
      if (kind === 'shop' && opts.find) {
        try { tile = shopTile(await dmLinkOptions(sb, opts.userId, opts.find), opts.choice.productName) } catch { /* no tile */ }
      }
      return { keyword: oneWordKeyword(opts.choice.keyword), link, kind, ready: await ready(), tile, chosen: true }
    }

    // Automatic: the creator's keyword and this post's own link.
    const { data: settings } = await sb.from('ig_dm_settings').select('*').eq('user_id', opts.userId).maybeSingle()
    if (settings?.mvp_posts === false) return null
    let link = ''
    let kind: DmLinkKind | null = null
    let tile: AutoDmPlan['tile'] = null
    if (opts.find) {
      const o = await dmLinkOptions(sb, opts.userId, opts.find)
      const pick = autoDmLink(o)
      if (pick) {
        link = pick.url
        kind = pick.kind
        if (pick.kind === 'shop') tile = shopTile(o)
      }
    }
    if (!link) {
      const own = String(opts.link ?? '').trim()
      if (/^https?:\/\//i.test(own)) link = own
    }
    if (!link) return null
    return { keyword: oneWordKeyword(settings?.keyword), link, kind, ready: await ready(), tile, chosen: false }
  } catch {
    return null
  }
}

/** The caption with the Auto-DM line, for an automatic plan on an account
 *  that can answer. A window's caption is the creator's and is left as sent. */
export function captionForPlan(caption: string, plan: AutoDmPlan | null): string {
  if (!plan || plan.chosen || !plan.ready) return caption
  return withDmCta(caption, plan.keyword)
}

/** After publishing: the post's own Auto-DM, the Link in Bio tile its DM
 *  points at, comment alerts on. Null when there was no plan. */
export async function finishAutoDm(sb: Db, plan: AutoDmPlan | null, post: {
  userId: string; mediaId: string | null | undefined; caption?: string | null; videoUrl?: string | null; productName?: string | null
  igUserId?: string | null; accessToken?: string | null
}): Promise<AutoDmOutcome | null> {
  if (!plan) return null
  const att = await attachReelAutoDm(sb, {
    userId: post.userId, mediaId: post.mediaId, keyword: plan.keyword, link: plan.link,
    productName: post.productName ?? plan.tile?.title ?? null, caption: post.caption ?? null, videoUrl: post.videoUrl ?? null,
  })
  if (!att.ok) return att
  // THE PAGE THE DM SENDS PEOPLE TO HAS THE PRODUCT ON IT.
  if (plan.tile) {
    try {
      const { syncLinkInBioTile } = await import('@/lib/amazon-social-publish')
      await syncLinkInBioTile(sb, post.userId, plan.tile, false)
    } catch { /* the DM still goes; the page just lacks the tile */ }
  }
  if (post.igUserId && post.accessToken) {
    try { await subscribeToComments({ igUserId: post.igUserId, accessToken: post.accessToken }) } catch { /* non-fatal */ }
  }
  return { ok: true, keyword: att.keyword, link: att.link, ready: plan.ready }
}

/** What happened, in one sentence for a window or a post's note. */
export function autoDmWords(o: AutoDmOutcome | null): string | null {
  if (!o) return null
  if (!o.ok) return `Auto-DM was not attached: ${o.error}`
  const on = `Auto-DM is on: anyone who comments ${o.keyword.toUpperCase()} gets ${o.link}`
  return o.ready ? `${on}.` : `${on} once Instagram sends comments to MVP. The Instagram Auto-DM page says what to fix.`
}
