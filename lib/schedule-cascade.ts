// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SCHEDULED POST'S SOCIAL CASCADE, QUEUED WHERE THE POST IS WRITTEN.
//
// Reported 2026-11-20 (Seb's support inbox): "the blog post goes live as
// scheduled, but nothing gets posted to our social accounts". The creator's
// queue told the story: 60 scheduled posts with all seven socials to October 9,
// then six weeks of scheduled posts with no scheduled_posts row at all, not
// even the draft-flip parent, while every post still went live.
//
// The rows were written by /api/blog/schedule-publish AFTER its internal call
// to /api/blog/generate returned. That call runs 250 to 290 seconds against a
// 290 second budget inside a function Vercel cuts at 300. When writing runs
// long, schedule-publish gives up or is killed, but generate is a SEPARATE
// invocation: it finishes, makes the WordPress draft and writes scheduled_for
// and schedule_mode, and the missed-schedule sweep later publishes the draft.
// Only the cascade was lost: the parent that publishes the post and the
// children that post it everywhere. The same shape broke in September (a 30
// second default deadline); a deadline was the fix then, and the budget has
// been eaten since.
//
// So the cascade is queued by generate itself, right after it saves the post,
// in the invocation that cannot lose it. schedule-publish calls the same
// function after generate returns; it is idempotent (a platform already queued
// for the post is never queued twice), so the second call only returns the
// rows the first one wrote, or writes them if generate could not.

import type { Tier } from '@/lib/tier'
import { tierAllowsSocial, normalizeTier } from '@/lib/tier'
import { getConnectedPlatforms } from '@/lib/channel-health'
import { DEFAULT_SOCIAL_OFFSETS_MIN, type ScheduleMode, type SchedulableSocial, type SocialScheduleEntry } from '@/lib/schedule-types'

export const CASCADE_SOCIALS: SchedulableSocial[] = ['facebook', 'threads', 'twitter', 'linkedin', 'bluesky', 'telegram', 'pinterest']

export interface CascadeChildRow {
  user_id: string
  blog_post_id: string
  platform: SchedulableSocial
  scheduled_at: string
  body_text: string
  status: 'pending'
  kind: 'social'
  parent_id: string | null
  social_account_id: string | null
  options?: { includeAffiliateCta: boolean }
}

export interface CascadeResult {
  parentScheduleId: string | null
  childScheduleIds: string[]
  /** Ticked but not queued, each with why: not connected, not on the plan. */
  skippedPlatforms: string[]
  /** Migration 103 is missing, so no parent could be written (the caller
   *  degrades draft-flip to wp-native). */
  parentMissingColumn: boolean
  error: string | null
}

/** The child rows to write: one per ticked platform that is supported, on the
 *  plan, connected, has a caption and is not already queued for this post.
 *  Pure, so it is tested (scripts/test-schedule-cascade.ts). */
export function cascadeChildRows(input: {
  userId: string
  blogPostId: string
  scheduledFor: string
  socials: SocialScheduleEntry[]
  tier: Tier
  connected: Set<string>
  alreadyQueued: Set<string>
  allowedAccounts: Set<string>
  parentId: string | null
}): { rows: CascadeChildRow[]; skipped: string[] } {
  const rows: CascadeChildRow[] = []
  const skipped: string[] = []
  const baseMs = new Date(input.scheduledFor).getTime()
  const seen = new Set<string>()
  for (const s of input.socials) {
    if (!s || !CASCADE_SOCIALS.includes(s.platform) || seen.has(s.platform)) continue
    seen.add(s.platform)
    if (input.alreadyQueued.has(s.platform)) continue
    if (!tierAllowsSocial(input.tier, s.platform)) { skipped.push(s.platform); continue }
    if (!input.connected.has(s.platform)) { skipped.push(s.platform); continue }
    const text = typeof s.bodyText === 'string' ? s.bodyText.trim() : ''
    if (!text) { skipped.push(s.platform); continue }
    const offsetMin = typeof s.offsetMinutes === 'number' && Number.isFinite(s.offsetMinutes) ? s.offsetMinutes : DEFAULT_SOCIAL_OFFSETS_MIN[s.platform]
    const account = s.socialAccountId && input.allowedAccounts.has(`${s.socialAccountId}|${s.platform}`) ? s.socialAccountId : null
    rows.push({
      user_id: input.userId,
      blog_post_id: input.blogPostId,
      platform: s.platform,
      scheduled_at: new Date(baseMs + offsetMin * 60_000).toISOString(),
      body_text: text.slice(0, 900),
      status: 'pending',
      kind: 'social',
      parent_id: input.parentId,
      social_account_id: account,
      ...(s.platform === 'facebook' && s.includeAffiliateCta ? { options: { includeAffiliateCta: true } } : {}),
    })
  }
  return { rows, skipped }
}

const missingColumn = (m: string | undefined) => !!m && /column .* does not exist|does not exist|unknown column/i.test(m)

/** Queue the draft-flip parent (when asked for) and one social row per ticked
 *  platform for a scheduled post, unless already queued. Never throws. */
export async function queueCascade(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: { userId: string; blogPostId: string; scheduleMode: ScheduleMode; scheduledFor: string; title: string; socials: SocialScheduleEntry[] },
): Promise<CascadeResult> {
  const out: CascadeResult = { parentScheduleId: null, childScheduleIds: [], skippedPlatforms: [], parentMissingColumn: false, error: null }
  try {
    const socials = Array.isArray(input.socials) ? input.socials : []
    // What this post already has queued (any status: a row that fired is not re-queued).
    const { data: existing } = await db.from('scheduled_posts').select('id,platform').eq('user_id', input.userId).eq('blog_post_id', input.blogPostId)
    const rowsNow = (existing ?? []) as Array<{ id: string; platform: string | null }>
    const parent = rowsNow.find((r) => r.platform == null)
    const alreadyQueued = new Set(rowsNow.filter((r) => r.platform).map((r) => r.platform as string))
    out.childScheduleIds = rowsNow.filter((r) => r.platform).map((r) => r.id)

    // The platforms ticked, kept on the post so the Scheduled card says them
    // even when a channel is skipped (migration 231; best-effort).
    const ticked = [...new Set(socials.map((s) => s?.platform).filter((p): p is SchedulableSocial => CASCADE_SOCIALS.includes(p as SchedulableSocial)))]
    if (ticked.length) {
      await db.from('blog_posts').update({ scheduled_social_platforms: ticked }).eq('id', input.blogPostId).eq('user_id', input.userId)
        .then((r: { error?: { message?: string } } | null) => { if (r?.error) console.warn('[schedule-cascade] ticked platforms not kept:', r.error.message) }, () => {})
    }

    // 1. The draft-flip parent: what publishes the post at its time.
    if (input.scheduleMode === 'draft-flip') {
      if (parent) out.parentScheduleId = parent.id
      else {
        const { data: row, error } = await db.from('scheduled_posts').insert({
          user_id: input.userId,
          blog_post_id: input.blogPostId,
          kind: 'blog_publish',
          platform: null,
          scheduled_at: new Date(input.scheduledFor).toISOString(),
          body_text: `Publish: ${input.title || 'blog post'}`.slice(0, 500),
          status: 'pending',
        }).select('id').single()
        if (error && missingColumn(error.message)) out.parentMissingColumn = true
        else if (error || !row) { out.error = `Schedule write failed: ${error?.message || 'unknown'}`; return out }
        else out.parentScheduleId = row.id
      }
    }
    if (!socials.length) return out

    // 2. The socials.
    const { data: tierRow } = await db.from('integrations').select('tier').eq('user_id', input.userId).maybeSingle()
    const tier = normalizeTier(tierRow?.tier)
    const requested = socials.map((s) => s?.socialAccountId).filter((id): id is string => typeof id === 'string' && id.length > 0)
    const allowedAccounts = new Set<string>()
    if (requested.length && ['pro', 'admin'].includes(tier)) {
      const { data: accts } = await db.from('social_accounts').select('id,platform').in('id', requested).eq('user_id', input.userId)
      for (const a of (accts ?? []) as Array<{ id: string; platform: string }>) allowedAccounts.add(`${a.id}|${a.platform}`)
    }
    const connected = await getConnectedPlatforms(db, input.userId)
    const { rows, skipped } = cascadeChildRows({ userId: input.userId, blogPostId: input.blogPostId, scheduledFor: input.scheduledFor, socials, tier, connected, alreadyQueued, allowedAccounts, parentId: out.parentScheduleId })
    out.skippedPlatforms = skipped
    if (!rows.length) return out
    let { data: inserted, error } = await db.from('scheduled_posts').insert(rows).select('id')
    if (error && missingColumn(error.message)) {
      // Before migration 103: no kind or parent_id, the pushes still queue.
      const legacy = rows.map(({ user_id, blog_post_id, platform, scheduled_at, body_text, status, social_account_id }) => ({ user_id, blog_post_id, platform, scheduled_at, body_text, status, social_account_id }))
      const retry = await db.from('scheduled_posts').insert(legacy).select('id')
      inserted = retry.data
      error = retry.error
    }
    if (error) { out.error = `Social pushes failed to queue: ${error.message}`; return out }
    out.childScheduleIds = [...out.childScheduleIds, ...((inserted ?? []) as Array<{ id: string }>).map((r) => r.id)]
    return out
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e)
    return out
  }
}
