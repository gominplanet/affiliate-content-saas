/**
 * POST /api/blog/schedule-cascade-only
 *
 * Schedule a social cascade for an ALREADY-LIVE blog post. No generation
 * happens — the post must already exist in blog_posts + WordPress. We
 * just queue scheduled_posts rows so the cron worker fires the chosen
 * social channels at the chosen time.
 *
 * Use cases:
 *   - You generated a post yesterday and forgot to push it to socials.
 *     Want to schedule LinkedIn + Telegram for tomorrow at 9am.
 *   - A schedule-publish call partially failed — the blog landed but
 *     the social cascade didn't queue. This route is the retry path.
 *   - Re-amplification: post is a week old, want to push it to socials
 *     again to drive traffic.
 *
 * Body:
 *   {
 *     postId: uuid (blog_posts.id)
 *     scheduledFor: ISO 8601 timestamp (when the FIRST social fires)
 *     socials: SocialScheduleEntry[] (per-channel body + offset)
 *   }
 *
 * Returns: { ok, childScheduleIds }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, normalizeTier, TIERS, type Tier } from '@/lib/tier'
import type { SocialScheduleEntry, SchedulableSocial } from '@/lib/schedule-types'
import { DEFAULT_SOCIAL_OFFSETS_MIN } from '@/lib/schedule-types'

const SUPPORTED_SOCIALS: SchedulableSocial[] = ['facebook', 'threads', 'twitter', 'linkedin', 'bluesky', 'telegram']

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await request.json()) as {
      postId?: string
      scheduledFor?: string
      socials?: SocialScheduleEntry[]
    }
    const { postId, scheduledFor } = body
    const socials = Array.isArray(body.socials) ? body.socials : []

    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
    if (!scheduledFor) return NextResponse.json({ error: 'scheduledFor required' }, { status: 400 })
    const whenMs = new Date(scheduledFor).getTime()
    if (isNaN(whenMs)) {
      return NextResponse.json({ error: 'scheduledFor is not a valid ISO timestamp' }, { status: 400 })
    }
    if (whenMs <= Date.now() + 30_000) {
      return NextResponse.json({ error: 'scheduledFor must be at least 30 seconds in the future' }, { status: 400 })
    }
    if (socials.length === 0) {
      return NextResponse.json({ error: 'At least one social channel required' }, { status: 400 })
    }

    // Verify the post exists and belongs to this user.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await supabase
      .from('blog_posts')
      .select('id,title')
      .eq('id', postId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    // Tier read for per-channel gate.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = (tierRow?.tier as Tier) ?? 'trial'

    // ── Per-month cascade-only cap ────────────────────────────────────────
    // Counts DISTINCT blog_post_ids the user has cascade-only-scheduled
    // this calendar month (kind='social' AND parent_id IS NULL). Re-cascading
    // the SAME post doesn't double-count — we exclude `postId` itself. Trial
    // gets 5/month, Creator 30/month, Studio+/Pro/Admin unlimited (null).
    // Defensive — wraps the query so a pre-migration-103 db (where kind +
    // parent_id don't exist) silently skips the cap rather than 500-ing.
    // 2026-06-07 anti-abuse for the free trial.
    const cap = TIERS[normalizeTier(tier)].cascadeOnlySchedulesPerMonth ?? null
    if (cap !== null) {
      const now = new Date()
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: prevRows, error: prevErr } = await (supabase as any)
          .from('scheduled_posts')
          .select('blog_post_id')
          .eq('user_id', user.id)
          .eq('kind', 'social')
          .is('parent_id', null)
          .gte('created_at', startOfMonth)
          .limit(2000)
        if (!prevErr && Array.isArray(prevRows)) {
          const distinctIds = new Set<string>(
            prevRows
              .map((r: { blog_post_id?: string }) => r.blog_post_id ?? '')
              .filter(Boolean),
          )
          // The user is re-cascading THIS post — don't make them burn a slot
          // they already burned.
          distinctIds.delete(postId)
          if (distinctIds.size >= cap) {
            return NextResponse.json(
              {
                error:
                  `Cascade-only schedule cap reached: ${distinctIds.size}/${cap} posts this month on ${tier}. ` +
                  `Upgrade Creator or higher to lift the cap.`,
                limitReached: true,
                cap: 'cascade-only-schedules',
                currentTier: tier,
                upgrade: tier === 'trial'
                  ? { tier: 'creator', label: 'Creator', limit: 30 }
                  : tier === 'creator'
                  ? { tier: 'studio', label: 'Studio', limit: null }
                  : null,
              },
              { status: 403 },
            )
          }
        }
      } catch (e) {
        // Pre-migration-103 schema — kind/parent_id columns absent. Don't
        // block the user, just log so we know the cap isn't being enforced
        // until migrations land.
        console.warn('[schedule-cascade-only] cap check skipped (migration 103?):', e)
      }
    }

    // Validate each social entry up front.
    for (const s of socials) {
      if (!s.platform || !SUPPORTED_SOCIALS.includes(s.platform)) {
        return NextResponse.json(
          { error: `social.platform must be one of ${SUPPORTED_SOCIALS.join(', ')}` },
          { status: 400 },
        )
      }
      if (!tierAllowsSocial(tier, s.platform)) {
        return NextResponse.json(
          { error: `${s.platform} auto-publish is not available on your plan.` },
          { status: 403 },
        )
      }
      if (!s.bodyText || !s.bodyText.trim()) {
        return NextResponse.json(
          { error: `social.bodyText required for ${s.platform}` },
          { status: 400 },
        )
      }
    }

    // Batched social_account_id lookup (audit perf fix 2026-06-06).
    const accountIdsRequested = socials
      .map(s => s.socialAccountId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    const allowedAccountIds = new Set<string>()
    if (accountIdsRequested.length > 0 && ['pro', 'admin'].includes(normalizeTier(tier))) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: accts } = await supabase
        .from('social_accounts')
        .select('id,platform')
        .in('id', accountIdsRequested)
        .eq('user_id', user.id)
      for (const a of (accts ?? []) as Array<{ id: string; platform: string }>) {
        allowedAccountIds.add(`${a.id}|${a.platform}`)
      }
    }

    const baseMs = new Date(scheduledFor).getTime()
    const childRows = []
    for (const s of socials) {
      const offsetMin = typeof s.offsetMinutes === 'number'
        ? s.offsetMinutes
        : DEFAULT_SOCIAL_OFFSETS_MIN[s.platform]
      const fireAt = new Date(baseMs + offsetMin * 60_000).toISOString()
      let resolvedAccountId: string | null = null
      if (s.socialAccountId && allowedAccountIds.has(`${s.socialAccountId}|${s.platform}`)) {
        resolvedAccountId = s.socialAccountId
      }
      childRows.push({
        user_id: user.id,
        blog_post_id: postId,
        platform: s.platform,
        scheduled_at: fireAt,
        body_text: s.bodyText.trim(),
        status: 'pending' as const,
        kind: 'social' as const,
        parent_id: null,           // no parent — this is a standalone cascade
        social_account_id: resolvedAccountId,
      })
    }

    // Defensive insert — handles pre-migration-103 databases by
    // retrying without kind/parent_id (legacy schema).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { data: inserted, error: insertErr } = await (supabase as any)
      .from('scheduled_posts')
      .insert(childRows)
      .select('id')
    const looksLikeMissingColumn =
      insertErr &&
      typeof insertErr.message === 'string' &&
      /column .* does not exist|does not exist|unknown column/i.test(insertErr.message)
    if (insertErr && looksLikeMissingColumn) {
      console.warn('[schedule-cascade-only] migration 103 not detected, retrying with legacy schema:', insertErr.message)
      const legacyRows = childRows.map(r => ({
        user_id: r.user_id,
        blog_post_id: r.blog_post_id,
        platform: r.platform,
        scheduled_at: r.scheduled_at,
        body_text: r.body_text,
        status: r.status,
        social_account_id: r.social_account_id,
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const retry = await (supabase as any)
        .from('scheduled_posts')
        .insert(legacyRows)
        .select('id')
      inserted = retry.data
      insertErr = retry.error
    }
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    const childScheduleIds = ((inserted ?? []) as Array<{ id: string }>).map(r => r.id)
    console.log('[schedule-cascade-only] queued', { postId, count: childScheduleIds.length })

    return NextResponse.json({ ok: true, childScheduleIds })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
