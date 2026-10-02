// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TODAY: ONE RANKED LIST OF WHAT NEEDS THE CREATOR, FOR PRO.
//
// Seb: one list instead of a dozen banners. Every source here is read from the
// database only (no Keepa, no Claude, no Search Console), so the list is cheap
// enough to load on every dashboard visit.
//
// A source that cannot be read is NAMED in `unread`, never dropped. An empty
// list therefore means "every source was read and nothing needs you", and the
// card says which sources it could not check when that is not true.

import { getDeadChannels, AUTO_SKIP_PREFIX, AUTO_FAILED_PREFIX, RESOLVED_PREFIX } from '@/lib/channel-health'
import { HELD_FOR_PAID_PROMOTION } from '@/lib/launch-batch'
import { canUsePreview } from '@/lib/labs-preview'
import { REFRESH_AFTER_DAYS } from '@/lib/post-refresh'
import { listDealPosts } from '@/lib/deal-aftercare-server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export type TodayKind =
  | 'reconnect' | 'liftoff_blocked' | 'liftoff_held' | 'liftoff_launch' | 'liftoff_amazon'
  | 'failed_posts' | 'held_posts' | 'encore' | 'pin_comments' | 'failed_comments'
  | 'cc_matches' | 'price_alerts' | 'ended_deals' | 'refresh_due'

export type TodayItem = {
  kind: TodayKind
  /** Higher first. Broken things, then money on the table, then upkeep. */
  rank: number
  title: string
  detail: string
  href: string
  cta: string
  count: number
  tone: 'urgent' | 'money' | 'upkeep'
}

export type TodayReport = { items: TodayItem[]; unread: string[] }

const RANK: Record<TodayKind, number> = {
  reconnect: 100,
  liftoff_blocked: 92,
  failed_posts: 90,
  liftoff_held: 88,
  liftoff_amazon: 86,
  liftoff_launch: 84,
  failed_comments: 80,
  held_posts: 78,
  encore: 70,
  cc_matches: 66,
  pin_comments: 60,
  price_alerts: 50,
  ended_deals: 40,
  refresh_due: 30,
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function item(kind: TodayKind, tone: TodayItem['tone'], count: number, title: string, detail: string, href: string, cta: string): TodayItem {
  return { kind, rank: RANK[kind], tone, count, title, detail, href, cta }
}

/** Highest rank first; ties by the bigger count. Pure. */
export function rankToday(items: TodayItem[]): TodayItem[] {
  return [...items].filter((i) => i.count > 0).sort((a, b) => b.rank - a.rank || b.count - a.count)
}

/**
 * Everything waiting on this creator today. `ownerId` is whose data is read
 * (an agency member reads the owner's); `tier` is the viewer's, for the gates.
 */
export async function gatherToday(sb: Sb, ownerId: string, tier: unknown, now: Date = new Date()): Promise<TodayReport> {
  const items: TodayItem[] = []
  const unread: string[] = []
  const DAY = 86_400_000

  async function read(label: string, fn: () => Promise<void>) {
    try { await fn() } catch { unread.push(label) }
  }
  // A Supabase error is a failed read, not an empty answer.
  const ok = <T,>(r: { data: T | null; error: { message?: string } | null }): T => {
    if (r.error) throw new Error(r.error.message || 'read failed')
    return (r.data ?? ([] as unknown as T))
  }

  await Promise.all([
    read('connected accounts', async () => {
      const dead = await getDeadChannels(sb, ownerId)
      for (const d of dead) {
        items.push(item('reconnect', 'urgent', d.consecutiveFailures,
          `Reconnect ${d.label}`,
          `${plural(d.consecutiveFailures, 'post', 'posts')} in a row failed. Nothing goes to ${d.label} until it is reconnected.`,
          d.platform === 'youtube' ? '/connect-youtube' : '/connect-socials', 'Reconnect'))
      }
    }),

    read('Liftoff', async () => {
      const batches = ok<Array<{ id: string; name: string | null; state: string; markets: string[] | null; send_to_youtube?: boolean | null }>>(
        await sb.from('launch_batches').select('id,name,state,markets,send_to_youtube')
          .eq('user_id', ownerId).gte('created_at', new Date(now.getTime() - 90 * DAY).toISOString())
          .order('created_at', { ascending: false }).limit(20))
      if (!batches.length) return
      const rows = ok<Array<{ batch_id: string; state: string; reason: string | null; youtube_video_id: string | null; planned_publish_at: string | null }>>(
        await sb.from('launch_items').select('batch_id,state,reason,youtube_video_id,planned_publish_at')
          .eq('user_id', ownerId).in('batch_id', batches.map((b) => b.id)))
      let blocked = 0, held = 0, waitingLaunch = 0
      const amazonReady: string[] = []
      for (const b of batches) {
        const its = rows.filter((r) => r.batch_id === b.id)
        const heldHere = its.filter((r) => r.state === 'blocked' && !!r.youtube_video_id && String(r.reason || '').startsWith(HELD_FOR_PAID_PROMOTION)).length
        held += heldHere
        blocked += its.filter((r) => r.state === 'blocked').length - heldHere
        if (b.state === 'ready') waitingLaunch += its.filter((r) => r.state === 'prepared' && !r.planned_publish_at).length
        // Part 2 is waiting when YouTube is done and no Amazon store was chosen.
        const launched = b.state === 'launching' || b.state === 'launched'
        const onYouTube = its.filter((r) => !!r.youtube_video_id && (r.state === 'scheduled' || r.state === 'published')).length
        const open = its.length - onYouTube - its.filter((r) => r.state === 'blocked').length
        if (canUsePreview('liftoff_split', tier) && b.send_to_youtube !== false && launched && onYouTube > 0 && open === 0 && !(b.markets ?? []).length) {
          amazonReady.push(b.name || 'a batch')
        }
      }
      if (blocked) items.push(item('liftoff_blocked', 'urgent', blocked, `${plural(blocked, 'Liftoff video', 'Liftoff videos')} could not go`, 'Each one says why on the Liftoff page.', '/liftoff', 'Open Liftoff'))
      if (held) items.push(item('liftoff_held', 'urgent', held, `${plural(held, 'video', 'videos')} kept private on YouTube`, 'YouTube did not confirm paid promotion. Tick it in YouTube Studio and MVP releases the video.', '/liftoff', 'See which'))
      if (amazonReady.length) items.push(item('liftoff_amazon', 'money', amazonReady.length, `YouTube is done for ${amazonReady.length === 1 ? amazonReady[0] : plural(amazonReady.length, 'batch', 'batches')}`, 'Start the Amazon uploads to the US store.', '/liftoff', 'Start Amazon'))
      if (waitingLaunch) items.push(item('liftoff_launch', 'money', waitingLaunch, `${plural(waitingLaunch, 'video is', 'videos are')} ready to launch`, 'Everything is prepared. They go when you press Launch.', '/liftoff', 'Launch'))
    }),

    read('scheduled posts', async () => {
      // Counted in the database: a read stops at 200 (and at 1,000 whatever it
      // asks for), which made a bad week look smaller than it was.
      const since = new Date(now.getTime() - 7 * DAY).toISOString()
      const failedCount = async (prefix?: string) => {
        let q = sb.from('scheduled_posts').select('id', { count: 'exact', head: true })
          .eq('user_id', ownerId).eq('status', 'failed').gte('updated_at', since)
        if (prefix) q = q.like('error_message', `${prefix}%`)
        const r = await q
        if (r.error) throw new Error(r.error.message)
        return r.count ?? 0
      }
      const [all, skipped, resolved, autoFailed] = await Promise.all([failedCount(), failedCount(AUTO_SKIP_PREFIX), failedCount(RESOLVED_PREFIX), failedCount(AUTO_FAILED_PREFIX)])
      const n = Math.max(0, all - skipped - resolved - autoFailed)
      if (n) items.push(item('failed_posts', 'urgent', n, `${plural(n, 'post', 'posts')} failed this week`, 'Each failed post shows its error and can be sent again.', '/content?tab=scheduled', 'Review'))
    }),

    read('held blog posts', async () => {
      const r = await sb.from('blog_posts').select('id', { count: 'exact', head: true }).eq('user_id', ownerId).not('aio->held', 'is', null)
      if (r.error) throw new Error(r.error.message)
      const held = r.count ?? 0
      if (held) items.push(item('held_posts', 'urgent', held, `${plural(held, 'post was', 'posts were')} kept as a draft`, 'The quality check held them and says why. Fix and publish, or publish as is.', '/content', 'Review'))
    }),

    read('price alerts', async () => {
      const rows = ok<Array<{ kind: string }>>(
        await sb.from('price_alerts').select('kind').eq('user_id', ownerId).eq('seen', false).limit(200))
      const sales = rows.filter((r) => r.kind === 'covered_sale').length
      const other = rows.length - sales
      if (sales && canUsePreview('on_sale', tier)) items.push(item('encore', 'money', sales, `${plural(sales, 'product', 'products')} you reviewed ${sales === 1 ? 'is' : 'are'} on sale`, 'Encore writes the comment for each video and pins it.', '/encore', 'Open Encore'))
      if (other) items.push(item('price_alerts', 'money', other, `${plural(other, 'price alert', 'price alerts')}`, 'New lows and stale prices on products you watch.', '/dashboard#price-alerts', 'See alerts'))
    }),

    read('Creator Connections', async () => {
      const today = now.toISOString().slice(0, 10)
      const r = await sb.from('cc_digest_cache').select('campaigns').eq('user_id', ownerId).eq('digest_date', today).maybeSingle()
      if (r.error) throw new Error(r.error.message)
      const n = Array.isArray(r.data?.campaigns) ? r.data.campaigns.length : 0
      if (n) items.push(item('cc_matches', 'money', n, `${plural(n, 'campaign matches', 'campaigns match')} your channel today`, 'Picked from your videos and posts. Open slots fill fast.', '/dashboard#cc-digest', 'See campaigns'))
    }),

    canUsePreview('first_comment', tier) && read('pinned comments', async () => {
      const rows = ok<Array<{ state: string; comment_id: string | null; pinned: boolean | null }>>(
        await sb.from('video_first_comments').select('state,comment_id,pinned')
          .eq('user_id', ownerId).gte('created_at', new Date(now.getTime() - 30 * DAY).toISOString()).limit(300))
      const toPin = rows.filter((r) => r.state === 'posted' && !!r.comment_id && r.pinned !== true).length
      const failed = rows.filter((r) => r.state === 'failed').length
      if (failed) items.push(item('failed_comments', 'urgent', failed, `${plural(failed, 'first comment', 'first comments')} could not post`, 'Each one says why. Try again from the Pinned Comments page.', '/first-comments', 'Review'))
      if (toPin) items.push(item('pin_comments', 'upkeep', toPin, `${plural(toPin, 'comment is', 'comments are')} posted but not pinned`, 'SCOUT pins them when YouTube Studio is open in Chrome.', '/first-comments', 'Pin them'))
    }),

    canUsePreview('deal_aftercare', tier) && read('ended deals', async () => {
      // The Ended Deals page's own reading, so the two cannot disagree: the
      // sale is over and the post is still a deal post.
      const { posts, error } = await listDealPosts(sb, ownerId)
      if (error) throw new Error(error)
      const n = posts.filter((p) => p.state === 'ended' && p.phase === 'deal').length
      if (n) items.push(item('ended_deals', 'upkeep', n, `${plural(n, 'deal post has', 'deal posts have')} ended`, 'Turn each into a lasting review so the page keeps earning.', '/ended-deals', 'Convert'))
    }),

    canUsePreview('post_refresh', tier) && read('posts due an update', async () => {
      const cutoff = new Date(now.getTime() - REFRESH_AFTER_DAYS * DAY).toISOString()
      // The whole rule in the query, counted there: 500 unordered rows then
      // filtered showed an arbitrary part of a big blog.
      const r = await sb.from('blog_posts').select('id', { count: 'exact', head: true })
        .eq('user_id', ownerId).eq('status', 'published').not('wordpress_post_id', 'is', null)
        .in('post_type', ['review', 'comparison']).lte('published_at', cutoff)
        .or(`refreshed_at.is.null,refreshed_at.lt.${cutoff}`)
        .or(`refresh_snoozed_until.is.null,refresh_snoozed_until.lt.${now.toISOString()}`)
      if (r.error) throw new Error(r.error.message)
      const n = r.count ?? 0
      if (n) items.push(item('refresh_due', 'upkeep', n, `${plural(n, 'review is', 'reviews are')} due a one-line update`, 'A first-hand line after 90 days keeps a review fresh for Google.', '/content', 'Update'))
    }),
  ].filter(Boolean))

  return { items: rankToday(items), unread: unread.sort() }
}
