// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
/**
 * Shared Pinterest publish — used by /api/blog/pinterest-post (modal)
 * and /api/blog/pinterest-auto (one-click campaign pill). Single source
 * of truth for: banned-word scrub, blog-only link enforcement, and
 * one-board-per-category routing.
 */
import { PinterestService } from '@/services/pinterest'
import { createWordPressService } from '@/services/wordpress'
import { scrubBanned } from '@/lib/scrub'

const GENERIC = /^(blog|uncategorized|general|news|misc|other|posts?)$/i

export class PinPublishError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

interface PublishArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: any   // blog_posts row (needs title, wordpress_url, wordpress_post_id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ig: any  // integrations row (Pinterest tokens + per-user settings)
  /** Optional: per-site WP credentials for fetching THIS post's WP categories.
   *  When the post's wordpress_site_id is known, pass the resolved site so
   *  the category lookup hits the right WP install. When absent, we skip
   *  category-based board resolution (still works via fallback board chain). */
  site?: {
    wordpress_url: string
    wordpress_username: string
    wordpress_app_password: string
    wordpress_api_token: string | null
  } | null
  title: string
  description: string
  imageBase64?: string | null
  mediaType?: string | null
  fallbackImageUrl?: string | null
  /** Explicit destination the creator chose in the preview modal. When set to a
   *  valid https URL (the direct product link), the pin links there instead of
   *  the blog post. Default (unset) keeps the blog-post link. The creator opts
   *  into this per pin, so it overrides the blog-only default. */
  linkOverride?: string | null
}

export async function publishPinForPost(args: PublishArgs): Promise<{ pinId: string }> {
  const { p, ig, site } = args
  if (!ig?.pinterest_access_token) throw new PinPublishError('Pinterest not connected', 400)
  // A board is NOT a precondition — it's resolved below (category board,
  // then the saved board, then a default we create). Fresh and sandbox
  // accounts have zero boards, so hard-failing here was wrong.

  // Destination: the blog post by default (safest for Amazon Associates +
  // Pinterest ToS). The creator can opt a single pin to the direct product link
  // via the preview modal's toggle — linkOverride then carries that URL and wins.
  const override = (args.linkOverride || '').trim()
  const useOverride = /^https?:\/\//i.test(override)
  const blogLink = (p.wordpress_url as string | null) || ''
  if (!useOverride && !/^https?:\/\//i.test(blogLink)) {
    throw new PinPublishError('This post has no blog URL to link the pin to.', 400)
  }
  const destLink = useOverride ? override : blogLink

  // Never fall back to a raw (unscrubbed) value — that would leak the
  // banned word in the edge case where the scrubbed string is empty.
  const safeDescription = scrubBanned(args.description)
  const safeTitle = (scrubBanned(args.title) || scrubBanned(p.title) || '').slice(0, 100)

  const pinterest = new PinterestService(ig.pinterest_access_token)

  // Board resolution, in priority order: the post's category board
  // (auto-created) → the user's named fallback board → the
  // previously-selected board → "Reviews". Don't pre-seed from the
  // saved board id, or it would shadow the user's explicit fallback
  // name for uncategorized posts. Never hard-fail: sandbox/new
  // accounts start with zero boards.
  // Explicit board pick (board picker) wins over everything: the creator chose
  // exactly where their pins go. NULL target → fall through to per-category.
  let targetBoardId = (ig.pinterest_pin_target || '').trim()
  try {
    // Only auto-resolve a category board when the creator hasn't picked one.
    if (!targetBoardId) {
      // Multi-site: category lookup must hit the SAME WP install the post
      // lives on. Use the per-site credentials passed in; fall back to ig's
      // legacy fields when no site was resolved (covers single-site users).
      const wpUrl = site?.wordpress_url ?? ig.wordpress_url
      const wpUser = site?.wordpress_username ?? ig.wordpress_username
      const wpPass = site?.wordpress_app_password ?? ig.wordpress_app_password
      const wpToken = site?.wordpress_api_token ?? ig.wordpress_api_token
      if (p.wordpress_post_id && wpUrl) {
        const wpSvc = createWordPressService(
          wpUrl, wpUser, wpPass, wpToken || undefined,
        )
        const cats = await wpSvc.getPostCategoryNames(p.wordpress_post_id)
        const cat = cats.map((c: string) => (c || '').trim()).find((c: string) => c && !GENERIC.test(c))
        if (cat) {
          const board = await pinterest.findOrCreateBoard(cat)
          targetBoardId = board.id
        }
      }
    }
  } catch { /* keep selected board as fallback */ }

  if (!targetBoardId) {
    // No category board. Order: the user's named fallback board → the
    // previously-selected board id → "Reviews". The typed name wins
    // over the saved id so an explicit choice is honored, and it
    // works on accounts with zero boards (created on demand).
    const fbName = (ig.pinterest_fallback_board || '').trim()
    if (fbName) {
      targetBoardId = (await pinterest.findOrCreateBoard(fbName)).id
    } else if (ig.pinterest_board_id) {
      targetBoardId = ig.pinterest_board_id
    } else {
      targetBoardId = (await pinterest.findOrCreateBoard('Reviews')).id
    }
  }

  try {
    // Resilient create: if targetBoardId turns out to be a stale sandbox board
    // (created while the app was in Pinterest trial access), the call retries
    // once on a freshly-created real board instead of failing the publish.
    let pin: { id: string; boardId: string; recovered: boolean }
    if (args.imageBase64 && args.mediaType) {
      pin = await pinterest.createPinWithBase64Resilient({
        boardId: targetBoardId, title: safeTitle, description: safeDescription,
        imageBase64: args.imageBase64, mediaType: args.mediaType, link: destLink,
      })
    } else if (args.fallbackImageUrl) {
      pin = await pinterest.createPinResilient({
        boardId: targetBoardId, title: safeTitle, description: safeDescription,
        imageUrl: args.fallbackImageUrl, link: destLink,
      })
    } else {
      throw new PinPublishError('No image available for pin', 400)
    }
    // If we recovered onto a fresh board, heal the stored board id so the stale
    // sandbox board is never reached for this user again.
    if (pin.recovered && ig.user_id) {
      try {
        // Also move an explicit pin_target that turned out to be a sandbox board
        // onto the recovered one, so the failed create+recover doesn't repeat
        // every publish (the pin_target shadows pinterest_board_id in resolution).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const heal: any = { pinterest_board_id: pin.boardId, pinterest_board_name: PinterestService.RECOVERY_BOARD }
        if ((ig.pinterest_pin_target || '').trim()) heal.pinterest_pin_target = pin.boardId
        const { createAdminClient } = await import('@/lib/supabase/admin')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (createAdminClient() as any).from('integrations').update(heal).eq('user_id', ig.user_id)
      } catch { /* best-effort heal — the pin already published */ }
    }
    return { pinId: pin.id }
  } catch (e) {
    if (e instanceof PinPublishError) throw e
    const aborted = e instanceof DOMException && e.name === 'TimeoutError'
    throw new PinPublishError(
      aborted ? 'Pinterest took too long to accept the pin. Please try again.'
              : (e instanceof Error ? e.message : 'Pinterest pin failed'),
      502,
    )
  }
}
