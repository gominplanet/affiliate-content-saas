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
  ig: any  // integrations row (pinterest + wordpress creds)
  title: string
  description: string
  imageBase64?: string | null
  mediaType?: string | null
  fallbackImageUrl?: string | null
}

export async function publishPinForPost(args: PublishArgs): Promise<{ pinId: string }> {
  const { p, ig } = args
  if (!ig?.pinterest_access_token) throw new PinPublishError('Pinterest not connected', 400)
  if (!ig?.pinterest_board_id) throw new PinPublishError('No Pinterest board selected', 400)

  // Pin must link DIRECTLY to the blog post — never an Amazon/affiliate
  // redirect (Amazon Associates + Pinterest ToS).
  const blogLink = (p.wordpress_url as string | null) || ''
  if (!/^https?:\/\//i.test(blogLink)) {
    throw new PinPublishError('This post has no blog URL to link the pin to.', 400)
  }

  const safeDescription = scrubBanned(args.description) || args.description
  const safeTitle = (scrubBanned(args.title) || scrubBanned(p.title) || p.title || '').slice(0, 100)

  const pinterest = new PinterestService(ig.pinterest_access_token)

  // One board per category — auto-create; fall back to the selected board.
  let targetBoardId: string = ig.pinterest_board_id
  try {
    if (p.wordpress_post_id && ig.wordpress_url) {
      const wpSvc = createWordPressService(
        ig.wordpress_url, ig.wordpress_username, ig.wordpress_app_password, ig.wordpress_api_token || undefined,
      )
      const cats = await wpSvc.getPostCategoryNames(p.wordpress_post_id)
      const cat = cats.map((c: string) => (c || '').trim()).find((c: string) => c && !GENERIC.test(c))
      if (cat) {
        const board = await pinterest.findOrCreateBoard(cat)
        targetBoardId = board.id
      }
    }
  } catch { /* keep selected board as fallback */ }

  try {
    let pin: { id: string }
    if (args.imageBase64 && args.mediaType) {
      pin = await pinterest.createPinWithBase64({
        boardId: targetBoardId, title: safeTitle, description: safeDescription,
        imageBase64: args.imageBase64, mediaType: args.mediaType, link: blogLink,
      })
    } else if (args.fallbackImageUrl) {
      pin = await pinterest.createPin({
        boardId: targetBoardId, title: safeTitle, description: safeDescription,
        imageUrl: args.fallbackImageUrl, link: blogLink,
      })
    } else {
      throw new PinPublishError('No image available for pin', 400)
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
