// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What a post waiting in the Facebook queue is called, wherever it shows
// (lib/facebook-queue). Imports nothing, so pages can read it too.

/** On a scheduled row: the post was handed to the Facebook queue, not posted
 *  and not failed. */
export const QUEUE_PREFIX = '[group-queue]'

export const QUEUED_NOTE = `${QUEUE_PREFIX} Waiting in your Facebook queue. Open Meta Hub and press Send: SCOUT fills your Group post, you press Post, and MVP posts on your Page pointing to it.`

export const isQueuedNote = (msg: string | null | undefined) => String(msg || '').startsWith(QUEUE_PREFIX)
export const queuedWords = (msg: string | null | undefined) => String(msg || '').replace(QUEUE_PREFIX, '').trim()

export type QueueSource = 'scheduled' | 'deal' | 'deal_scheduled' | 'amazon_design' | 'amazon_scheduled'

export const SOURCE_LABEL: Record<QueueSource, string> = {
  scheduled: 'Scheduled review',
  deal: 'Deal post',
  deal_scheduled: 'Scheduled deal post',
  amazon_design: 'Amazon design',
  amazon_scheduled: 'Scheduled Amazon design',
}
