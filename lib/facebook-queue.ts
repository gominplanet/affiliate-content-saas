// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FACEBOOK POSTS WAIT FOR THE GROUP (Seb, 2026-10-13: scheduled and auto-pilot
// Facebook posts should "queue for the Group"). The rule on Facebook in MVP is
// "your Group holds the link, your Page points to it", but Facebook lets only
// the creator press Post in a Group. So a Facebook post MVP would have put on
// the Page with the affiliate link, while nobody is there to press Post, goes
// into the creator's Facebook queue instead (migration 426). In Meta Hub, Send
// has SCOUT fill the Group post, the creator presses Post, and MVP posts on the
// Page pointing to it.
//
// Only for a creator with Facebook set up the Group way (facebook_setup) and a
// Group saved: with no Group there is nothing to queue for, and the Page post
// goes out as before. Before migration 426 is run the post also goes out as
// before, and the caller is told why, so nothing stops working in between.

import { facebookSetupEnabled } from '@/lib/facebook-link-budget'
import { cleanNicheGroup } from '@/lib/facebook-niche'
import type { QueueSource } from '@/lib/facebook-queue-words'

export type QueueOutcome =
  | { queued: true; id: string }
  | { queued: false; why: 'off' | 'no-group' | 'no-table' | 'error'; detail?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

/** Saved Groups, cleaned the way the setup page cleans them. */
export async function savedGroups(admin: Admin, userId: string): Promise<Array<{ name: string; url: string }>> {
  const { data } = await admin.from('brand_profiles').select('facebook_groups').eq('user_id', userId).maybeSingle()
  const raw = (data as { facebook_groups?: unknown } | null)?.facebook_groups
  return (Array.isArray(raw) ? raw : []).map(cleanNicheGroup).filter(Boolean).map((g) => ({ name: (g as { name?: string }).name || 'my Group', url: (g as { url: string }).url }))
}

export async function queueForGroup(admin: Admin, o: {
  userId: string
  tier: unknown
  source: QueueSource
  sourceId?: string | null
  title?: string | null
  body: string
  link?: string | null
  imageUrl?: string | null
}): Promise<QueueOutcome> {
  if (!facebookSetupEnabled(o.tier)) return { queued: false, why: 'off' }
  const groups = await savedGroups(admin, o.userId).catch(() => [])
  if (!groups.length) return { queued: false, why: 'no-group' }
  // The same post twice (a retried cron run) is one entry.
  if (o.sourceId) {
    const { data: had, error: readErr } = await admin.from('facebook_queue').select('id')
      .eq('user_id', o.userId).eq('source', o.source).eq('source_id', o.sourceId).eq('status', 'waiting').maybeSingle()
    if (readErr && /facebook_queue/.test(readErr.message || '')) return { queued: false, why: 'no-table', detail: readErr.message }
    if (had?.id) return { queued: true, id: had.id }
  }
  const { data, error } = await admin.from('facebook_queue').insert({
    user_id: o.userId, source: o.source, source_id: o.sourceId ?? null,
    title: (o.title || '').slice(0, 300) || null, body: o.body.slice(0, 6000),
    link: o.link || null, image_url: o.imageUrl || null,
  }).select('id').single()
  if (error) return { queued: false, why: /facebook_queue|relation .* does not exist/i.test(error.message || '') ? 'no-table' : 'error', detail: error.message }
  return { queued: true, id: data.id as string }
}
