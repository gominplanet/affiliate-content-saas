// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Queue a pinned first comment for a video from the server: Liftoff's uploads,
// and older videos picked in bulk. The cron (app/api/cron/first-comments) posts
// it the moment the video is public, and SCOUT pins it from the browser.
//
// ONE PER VIDEO, whoever asks first. A video that already has a row (posted,
// waiting, or given up on) is left alone and the answer says so, so a Liftoff
// retry or a second bulk pass never adds a second comment.
import { writeFirstComment } from '@/lib/first-comment-writer'
import { productLinkIn } from '@/lib/first-comment-text'
import { nameLinkStores } from '@/lib/link-store'

export type QueueOutcome =
  | { queued: true; id: string; written: 'sent' | 'ai' | 'plain' }
  | { queued: false; why: 'already' | 'missing_table' | 'error'; id?: string; state?: string; detail?: string }

export async function queueFirstComment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  a: {
    userId: string; tier?: string | null; youtubeVideoId: string; channelId?: string | null
    title: string | null; description?: string | null; text?: string | null; publishAt?: string | null
  },
): Promise<QueueOutcome> {
  const { data: existing, error: exErr } = await sb.from('video_first_comments')
    .select('id,state').eq('user_id', a.userId).eq('youtube_video_id', a.youtubeVideoId).maybeSingle()
  if (exErr) return { queued: false, why: exErr.code === '42P01' ? 'missing_table' : 'error', detail: exErr.message }
  if (existing) return { queued: false, why: 'already', id: existing.id, state: existing.state }

  let text = String(a.text || '').trim().slice(0, 1500)
  let written: 'sent' | 'ai' | 'plain' = 'sent'
  if (!text) {
    const w = await writeFirstComment({ userId: a.userId, tier: a.tier, title: a.title, description: a.description, link: productLinkIn(a.description) })
    text = w.text.slice(0, 1500)
    written = w.written
  }
  // The store each link opens, confirmed and named before it (lib/link-store).
  text = (await nameLinkStores(a.userId, text)).text.slice(0, 1500)
  const channel = /^UC[\w-]{22}$/.test(String(a.channelId || '')) ? String(a.channelId) : null
  const { data: ins, error } = await sb.from('video_first_comments').insert({
    user_id: a.userId, youtube_video_id: a.youtubeVideoId, channel_id: channel,
    text, video_title: a.title ? a.title.slice(0, 200) : null,
    ...(a.publishAt ? { publish_at: a.publishAt } : {}),
  }).select('id').single()
  // Two askers at once: the unique index keeps the first, and this one is told.
  if (error?.code === '23505') return { queued: false, why: 'already' }
  if (error || !ins) return { queued: false, why: 'error', detail: error?.message }
  return { queued: true, id: ins.id, written }
}
