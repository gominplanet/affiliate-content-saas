// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PUBLISH THE POSTS WORDPRESS FORGOT.
//
// MVP schedules most posts wp-native: created with status=future and a date,
// handed to WordPress, never looked at again. WordPress runs its scheduler only
// when somebody loads the site, so a blog with little traffic sits on its own
// scheduled posts indefinitely. WordPress records a "Missed schedule".
//
// This was diagnosed months ago. app/api/admin/missed-schedules already spells
// it out, down to "nothing in MVP would ever say so, because nothing asks", and
// it reports the problem to an ADMIN screen no creator can open. A creator on
// Hostinger found his the way anyone would: by logging into his host.
//
//   "Nada. Nothing was posted. I decided to check WP Admin through Hostinger,
//    and I can see that the posts are being saved as drafts. They never publish,
//    and they also disappear from the schedule in MVP."
//
// Reporting it to him is better than silence, and it still leaves him pressing a
// button every day for something he already told us to do. A schedule that needs
// a human to finish it is not a schedule. So the cron finishes it.
//
// AND THERE ARE TWO WAYS TO GET STUCK, not one. The paragraph above is the
// wp-native story and it is only half of it. In DRAFT-FLIP mode the post is
// created as a draft for OUR OWN cron to flip, so a stuck draft-flip post is
// our bug, not WordPress's. The creator above turned out to be almost entirely
// draft-flip: the fix written for WP-Cron would have walked past all ten of his
// posts. See mayAutoPublish.
//
// ── WHAT IT WILL AND WILL NOT TOUCH ────────────────────────────────────────
//
// 'future', in any mode. WordPress is holding the post AS SCHEDULED and simply
// has not run. Publishing it carries out the creator's own instruction, late.
//
// 'draft', ONLY in draft-flip mode, where the draft is MVP's own staging state
// and the flip is the step we failed to take.
//
// NEVER a draft in any other mode, and never 'pending'. Those can be a human
// decision: a creator who unpublished their own post, or an editor holding it
// back. Auto-publishing over that would be MVP overruling a person, which is a
// worse failure than the one being fixed. They are reported in the schedule
// list with a button, and the creator decides.
//
// A GRACE PERIOD, so this never races WordPress's own cron and publishes a post
// a second time or a minute early.
//
// A PER-CREATOR CAP PER TICK, so a long-abandoned backlog drains steadily
// instead of dumping forty articles onto a blog in one minute.

import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

/** Under this a post is not late, it is in flight. WordPress's own cron gets
 *  first refusal on every scheduled post, always. */
export const GRACE_MINUTES = 30
/** Older than this we still REPORT it (the schedule list does), but we stop
 *  publishing it on the creator's behalf: at some point a post nobody chased is
 *  a decision rather than an oversight. */
export const MAX_AGE_DAYS = 30
/** Per creator, per tick. The cron runs every minute, so a backlog still clears
 *  quickly, without forty posts landing at once. */
export const MAX_PER_USER_PER_TICK = 3
/** Across all creators, per tick, so one enormous backlog cannot starve the
 *  social publishing this cron also has to do. */
export const MAX_PER_TICK = 25

export interface HealCandidate {
  id: string
  user_id: string
  title: string | null
  wordpress_post_id: number
  wordpress_site_id: string | null
  wordpress_url: string | null
  scheduled_for: string
  /** 'draft-flip' means MVP created it as a draft for OUR cron to flip, so a
   *  lingering draft is our unfinished work rather than the creator's choice. */
  schedule_mode: string | null
}

export interface HealOutcome {
  /** Posts WordPress had not published and this run published. */
  published: Array<{ id: string; userId: string; title: string | null; url: string | null }>
  /** Posts WordPress had already published. Their schedule is cleared so they
   *  stop being re-checked every minute for the rest of the window. */
  confirmed: string[]
  /** Posts left alone on purpose, with the status that stopped us. */
  skipped: Array<{ id: string; wpStatus: string }>
  /** Sites that could not be reached or read this tick. Not a diagnosis. */
  unreachable: number
  errors: string[]
}

/**
 * Take at most MAX_PER_USER_PER_TICK per creator, oldest first, up to the
 * global cap. Exported and pure so the fairness rule is testable without a
 * database: a single creator with 200 stuck posts must not consume the tick.
 */
export function takeFairly(
  candidates: HealCandidate[],
  perUser = MAX_PER_USER_PER_TICK,
  total = MAX_PER_TICK,
): HealCandidate[] {
  const byUser = new Map<string, number>()
  const out: HealCandidate[] = []
  // Oldest due first, so the post that has been waiting longest goes first.
  const ordered = [...candidates].sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
  for (const c of ordered) {
    if (out.length >= total) break
    const n = byUser.get(c.user_id) ?? 0
    if (n >= perUser) continue
    byUser.set(c.user_id, n + 1)
    out.push(c)
  }
  return out
}

/**
 * Is this a status we are willing to publish on the creator's behalf?
 *
 * Exported because it is the whole safety rule and deserves its own test. The
 * mistake it guards against is publishing a post somebody deliberately pulled
 * down, which would be MVP overruling a human rather than serving one.
 *
 * ── WHY THE MODE MATTERS, AND WHY THE FIRST VERSION WAS WRONG ─────────────
 *
 * 'future' is safe in any mode: WordPress is holding the post AS SCHEDULED and
 * simply has not run its cron.
 *
 * 'draft' is where this gets interesting, and the first version of this
 * function refused it outright. That was right for wp-native, where a draft can
 * only be a human decision, and WRONG for draft-flip, where the draft is MVP's
 * OWN STAGING STATE. In draft-flip mode we deliberately create the post as a
 * draft so that our cron can flip it to publish. A draft-flip post sitting at
 * 'draft' past its time is not somebody's decision; it is our own unfinished
 * work.
 *
 * Found by checking rather than reasoning. The creator who reported this has
 * schedule_mode 'draft-flip' on nearly every stuck post, so the WP-Cron story
 * did not apply to him at all, and the heal written for it would have walked
 * straight past all ten of his posts. Ten URLs, fetched: every one a 404.
 * app/api/admin/missed-schedules had said so in advance, in one line nobody
 * had connected to this: "a late draft-flip post is ours and is a bug on
 * this side."
 */
export function mayAutoPublish(
  wpStatus: string | null | undefined,
  scheduleMode: string | null | undefined,
): boolean {
  if (wpStatus === 'future') return true
  // MVP put it in this state on purpose and then failed to take it out again.
  if (wpStatus === 'draft' && scheduleMode === 'draft-flip') return true
  return false
}

/**
 * One sweep. Never throws: this runs inside a cron that also publishes social
 * posts, and a WordPress wobble must not take that down with it.
 */
export async function healMissedSchedules(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  now: Date = new Date(),
): Promise<HealOutcome> {
  const out: HealOutcome = { published: [], confirmed: [], skipped: [], unreachable: 0, errors: [] }
  try {
    const dueBefore = new Date(now.getTime() - GRACE_MINUTES * 60_000).toISOString()
    const notBefore = new Date(now.getTime() - MAX_AGE_DAYS * 24 * 60 * 60_000).toISOString()

    const { data, error } = await admin
      .from('blog_posts')
      .select('id,user_id,title,wordpress_post_id,wordpress_site_id,wordpress_url,scheduled_for,schedule_mode')
      .not('scheduled_for', 'is', null)
      .not('wordpress_post_id', 'is', null)
      .lt('scheduled_for', dueBefore)
      .gt('scheduled_for', notBefore)
      .order('scheduled_for', { ascending: true })
      .limit(400)
    if (error) { out.errors.push(`query: ${error.message}`); return out }

    const picked = takeFairly((data ?? []) as HealCandidate[])
    if (!picked.length) return out

    // One WordPress service per (creator, site). A creator with three blogs has
    // three sets of credentials and three separate sites to ask.
    const groups = new Map<string, HealCandidate[]>()
    for (const c of picked) {
      const key = `${c.user_id}::${c.wordpress_site_id ?? '__default__'}`
      groups.set(key, [...(groups.get(key) ?? []), c])
    }

    for (const [key, group] of groups) {
      try {
        const [userId, siteKey] = key.split('::')
        const creds = await getWordPressCredentials(admin, userId, siteKey === '__default__' ? null : siteKey)
        if (!creds) { out.unreachable += group.length; continue }
        const wp = createWordPressService(
          creds.wordpress_url, creds.wordpress_username,
          creds.wordpress_app_password, creds.wordpress_api_token || undefined,
        )
        const statuses = await wp.getPostStatuses(group.map((g) => g.wordpress_post_id))
        // null is "could not ask", which is not "not published". Treating those
        // the same is the mistake that let this hide for months.
        if (!statuses) { out.unreachable += group.length; continue }

        for (const c of group) {
          const status = statuses.get(c.wordpress_post_id) ?? null

          // Gone from WordPress. Clear the schedule so it stops being swept
          // every minute; the post itself is the creator's business.
          if (status === null) {
            await clearSchedule(admin, c.id)
            out.skipped.push({ id: c.id, wpStatus: 'missing' })
            continue
          }

          // Already live. WordPress's own cron did its job, which is the normal
          // case. Clear the schedule so this post leaves the sweep for good
          // rather than costing a request every minute until it ages out.
          if (status === 'publish') {
            await clearSchedule(admin, c.id)
            out.confirmed.push(c.id)
            continue
          }

          if (!mayAutoPublish(status, c.schedule_mode)) {
            // A draft or a pending post may be somebody's decision. Left alone,
            // and the schedule left in place so the creator keeps seeing it
            // reported with its Publish it now button.
            out.skipped.push({ id: c.id, wpStatus: status })
            continue
          }

          // Publish it, clearing the stale future date at the same time: a post
          // that goes live still carrying a future date can be re-filed as
          // scheduled by WordPress, which would put it straight back here.
          const updated = await wp.updatePost(c.wordpress_post_id, {
            status: 'publish',
            date: new Date().toISOString(),
          } as never)

          // VERIFY. A 200 from the PATCH is what MVP has been believing for
          // months; the answer is what WordPress says the status is now.
          const after = await wp.getPostStatuses([c.wordpress_post_id])
          if (after && after.get(c.wordpress_post_id) !== 'publish') {
            out.errors.push(`${c.id}: WordPress accepted the update and still reports "${after.get(c.wordpress_post_id)}"`)
            continue
          }

          const link = (updated?.link || '').trim() || c.wordpress_url || null
          await clearSchedule(admin, c.id, link && link !== c.wordpress_url ? link : null)
          out.published.push({ id: c.id, userId: c.user_id, title: c.title, url: link })
        }
      } catch (e) {
        out.errors.push(`${key}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  } catch (e) {
    out.errors.push(e instanceof Error ? e.message : String(e))
  }
  return out
}

/** Drop the post out of the sweep. Stripped and retried when the column is
 *  missing, because PostgREST rejects the whole statement over one absent
 *  column and a failed bookkeeping write must not undo a real publish. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function clearSchedule(admin: any, id: string, freshUrl: string | null = null): Promise<void> {
  const patch: Record<string, unknown> = { scheduled_for: null }
  if (freshUrl) patch.wordpress_url = freshUrl
  try {
    const { error } = await admin.from('blog_posts').update(patch).eq('id', id)
    if (error && /column .* does not exist/i.test(error.message || '')) {
      if (freshUrl) await admin.from('blog_posts').update({ wordpress_url: freshUrl }).eq('id', id)
    }
  } catch { /* the publish already happened; bookkeeping is not worth failing it */ }
}
