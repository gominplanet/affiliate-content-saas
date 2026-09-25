// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The sale comments MVP posts on a creator's own videos, and taking the sale
// out of them when it ends (migration 374).
//
// TWO VERSIONS, WRITTEN TOGETHER. When the promo is written, the writer also
// writes the same comment with no sale in it. That lasting version is what
// the comment becomes when the sale ends: same place on the video, same link,
// same pin, and nothing on it that has stopped being true.
//
// THE LINK AND THE DISCLOSURE ARE CODE, NOT THE WRITER'S. Both versions end
// with the same two lines, and "Check the latest price" is true whether the
// price is down or not.

import { tidyCopy } from '@/lib/copy-rules'
import { findSales } from '@/lib/covered-sales'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { YouTubeOAuthService } from '@/services/youtube'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export const PRICE_LINE_LEAD = 'Check the latest price on Amazon here:'
export const DISCLOSURE = 'As an Amazon Associate I earn from qualifying purchases.'

/** Body, then the price line with the link, then the disclosure. */
export function commentWithLink(body: string, link: string): string {
  return `${body.trim()}\n\n${PRICE_LINE_LEAD} ${link}\n${DISCLOSURE}`
}

/** Anything that only holds while a sale is on. */
export const SALE_WORDING = /\b(on sale|sale|deals?|discount(ed)?|price drop|dropped|markdown|marked down|clearance|% off|percent off|save|saving|savings|cheaper|lowest|best price|right now|today only|limited time|while it lasts|hurry|grab it|ends? soon|lightning)\b/i

/**
 * The lasting version of the comment body. The writer's version when it has
 * no sale wording in it; otherwise a plain line that is true forever, so a
 * writer slip never leaves "on sale" on a video after the sale.
 */
export function lastingBody(written: unknown, productTitle: string): string {
  const clean = tidyCopy(written).replace(/https?:\/\/\S+/g, '').replace(/\{link\}/g, '').replace(/[ \t]{2,}/g, ' ').trim()
  if (clean && !SALE_WORDING.test(clean)) return clean
  const name = productTitle.split(/[,(|]/)[0].trim().slice(0, 60) || 'the product in this video'
  return `Here is the link to the ${name} from this video, if you want to take a closer look.`
}

export type SaleNow = 'on' | 'ended' | 'unknown'

/**
 * Is each product still on sale? Fresh prices only: deal rows and Keepa
 * answers under six hours old. A product nobody could check is "unknown",
 * never "ended": taking the sale out of a comment while the sale is still on
 * costs the creator sales, so only a real answer does it.
 */
export async function salesNow(admin: Sb, asins: string[]): Promise<Map<string, SaleNow>> {
  const out = new Map<string, SaleNow>()
  const unique = [...new Set(asins.map((a) => a.toUpperCase()))]
  if (!unique.length) return out
  let checked: string[] = []
  const on = await findSales(admin, unique.map((asin) => ({ asin, title: asin, image: null, sources: [] })), {
    keepaCap: 100, keepaMaxAgeDays: 0.25, dealMaxAgeHours: 8,
    onStats: (s) => { checked = s.checkedAsins },
  })
  const onSet = new Set(on.map((p) => p.asin))
  const checkedSet = new Set(checked.map((a) => a.toUpperCase()))
  for (const a of unique) out.set(a, onSet.has(a) ? 'on' : checkedSet.has(a) ? 'ended' : 'unknown')
  return out
}

export interface SaleCommentRow {
  id: string
  user_id: string
  youtube_video_id: string
  channel_id: string | null
  comment_id: string
  lasting_text: string
}

/**
 * Edit one comment to its lasting version, and record what actually
 * happened: 'updated', 'gone' (deleted on YouTube), or 'failed' with why.
 */
export async function takeSaleOut(admin: Sb, row: SaleCommentRow): Promise<{ state: 'updated' | 'gone' | 'failed'; error?: string }> {
  const at = new Date().toISOString()
  const save = async (state: 'updated' | 'gone' | 'failed', error: string | null) => {
    await admin.from('sale_comments').update({ state, last_error: error, last_checked_at: at, updated_at: at }).eq('id', row.id)
  }
  const token = await getChannelOAuthToken(admin, row.user_id, row.channel_id)
  if (!token) {
    const error = 'The channel this video is on is not connected for publishing any more. Reconnect it under Settings.'
    await save('failed', error)
    return { state: 'failed', error }
  }
  try {
    await new YouTubeOAuthService(token).updateComment(row.comment_id, row.lasting_text)
    await save('updated', null)
    return { state: 'updated' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/YouTube API error 404/.test(msg) || /commentNotFound/.test(msg)) {
      await save('gone', 'The comment is no longer on the video.')
      return { state: 'gone' }
    }
    const error = /quota/i.test(msg) ? "YouTube's daily limit for MVP is used up. It will try again later."
      : /403/.test(msg) ? 'YouTube refused the edit: the saved login may not be the channel that posted it. Reconnect it under Settings.'
        : `YouTube did not take the edit: ${msg.slice(0, 160)}`
    await save('failed', error)
    return { state: 'failed', error }
  }
}
