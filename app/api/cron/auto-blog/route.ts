// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Daily Auto-pilot: for each creator who turned the toggle ON, publish ONE blog
// post that day from their next un-blogged YouTube video (full pipeline: hero +
// internal images + schema, via the generation-job queue). No social push.
//
// HARD RULE: one post per user per day, for EVERY tier. Users who want more do
// it manually. Underneath, the normal monthly cap + spend gate still apply — when
// a user is out of monthly allowance, auto-pilot pauses and emails them once,
// then resumes automatically next cycle.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.
// State: brand_profiles.blog_customizations.autoBlog (no migration).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier, TIERS, billingWindow, type Tier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { enqueueGenerationJob } from '@/lib/generation-jobs'
import { sendEmail, isEmailConfigured } from '@/services/email'

export const runtime = 'nodejs'
export const maxDuration = 300

// Don't fire twice in one calendar day if the cron runs more than once or a
// deploy re-triggers it — 20h since the last run means "already went today".
const MIN_HOURS_BETWEEN_RUNS = 20

/* eslint-disable @typescript-eslint/no-explicit-any */

interface AutoBlogState {
  enabled?: boolean
  lastRunAt?: string | null
  pausedReason?: string | null
  pausedAt?: string | null
  recentVideoIds?: string[]
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient() as any
  const nowIso = new Date().toISOString()
  const results: Array<{ user: string; status: string; videoId?: string }> = []

  // Everyone with the toggle on. The JSON filter matches only rows that set it.
  const { data: rows } = await admin
    .from('brand_profiles')
    .select('user_id, blog_customizations')
    .eq('blog_customizations->autoBlog->>enabled', 'true')
    .limit(500)

  for (const row of (rows ?? []) as Array<{ user_id: string; blog_customizations: any }>) {
    const userId = row.user_id
    const customizations = (row.blog_customizations && typeof row.blog_customizations === 'object' ? row.blog_customizations : {}) as Record<string, any>
    const state: AutoBlogState = (customizations.autoBlog && typeof customizations.autoBlog === 'object' ? customizations.autoBlog : {})

    // Persist a patch to this user's autoBlog state (best-effort).
    const save = async (patch: Partial<AutoBlogState>) => {
      const next = { ...state, ...patch }
      await admin.from('brand_profiles')
        .upsert({ user_id: userId, blog_customizations: { ...customizations, autoBlog: next } }, { onConflict: 'user_id' })
    }

    try {
      // Already published today?
      if (state.lastRunAt) {
        const hrs = (Date.now() - new Date(state.lastRunAt).getTime()) / 36e5
        if (hrs < MIN_HOURS_BETWEEN_RUNS) { results.push({ user: userId, status: 'already_ran_today' }); continue }
      }

      const { data: integ } = await admin
        .from('integrations')
        .select('tier, subscription_period_start, subscription_period_end')
        .eq('user_id', userId).maybeSingle()
      const tier = normalizeTier(integ?.tier) as Tier
      const cap = TIERS[tier].postsPerMonth

      // Monthly cap (count-based, same window the app uses). null = unlimited.
      if (cap !== null) {
        const { startISO } = billingWindow({
          periodStart: integ?.subscription_period_start ?? null,
          periodEnd: integ?.subscription_period_end ?? null,
        })
        const { count } = await admin
          .from('blog_posts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('published_at', startISO)
        if ((count ?? 0) >= cap) {
          if (state.pausedReason !== 'cap') {
            await save({ pausedReason: 'cap', pausedAt: nowIso })
            await notifyPaused(admin, userId, 'cap').catch(() => {})
          }
          results.push({ user: userId, status: 'paused_cap' })
          continue
        }
      }

      // Spend circuit-breaker.
      const blocked = await spendGate(userId, tier)
      if (blocked) {
        if (state.pausedReason !== 'spend') { await save({ pausedReason: 'spend', pausedAt: nowIso }); await notifyPaused(admin, userId, 'spend').catch(() => {}) }
        results.push({ user: userId, status: 'paused_spend' })
        continue
      }

      // WordPress must be connected to publish.
      const site = await getWordPressCredentials(admin, userId)
      if (!site) { results.push({ user: userId, status: 'no_wp' }); continue }

      // Pick the next un-blogged video, newest first, excluding any we recently
      // attempted (so one non-review video can't block auto-pilot forever).
      const recent = new Set(Array.isArray(state.recentVideoIds) ? state.recentVideoIds : [])
      const [{ data: vids }, { data: bloggedRows }] = await Promise.all([
        admin.from('youtube_videos').select('id, published_at')
          .eq('user_id', userId).order('published_at', { ascending: false, nullsFirst: false }).limit(200),
        admin.from('blog_posts').select('video_id').eq('user_id', userId).not('video_id', 'is', null).limit(2000),
      ])
      const blogged = new Set((bloggedRows ?? []).map((b: any) => b.video_id as string))
      const nextVideo = (vids ?? []).find((v: any) => !blogged.has(v.id) && !recent.has(v.id)) as { id: string } | undefined
      if (!nextVideo) { results.push({ user: userId, status: 'no_videos_left' }); continue }

      // Enqueue the SAME blog pipeline the app uses (service-auth worker runs it).
      const jobId = await enqueueGenerationJob(admin, {
        userId, ownerId: userId, kind: 'blog', input: { videoId: nextVideo.id },
      })
      if (!jobId) { results.push({ user: userId, status: 'enqueue_failed' }); continue }

      const nextRecent = [nextVideo.id, ...(state.recentVideoIds ?? [])].slice(0, 10)
      await save({ lastRunAt: nowIso, pausedReason: null, pausedAt: null, recentVideoIds: nextRecent })
      results.push({ user: userId, status: 'enqueued', videoId: nextVideo.id })
    } catch (e) {
      console.error('[auto-blog] user', userId, e instanceof Error ? e.message : e)
      results.push({ user: userId, status: 'error' })
    }
  }

  return NextResponse.json({ ok: true, ran: results.length, results })
}

/** Email the creator once when auto-pilot pauses. Best-effort. */
async function notifyPaused(admin: any, userId: string, reason: 'cap' | 'spend'): Promise<void> {
  if (!isEmailConfigured()) return
  const { data } = await admin.auth.admin.getUserById(userId)
  const email = data?.user?.email
  if (!email) return
  const why = reason === 'cap'
    ? "you've used all of this month's post allowance"
    : "your account hit its monthly AI-spend safety limit"
  await sendEmail({
    to: email,
    subject: 'Auto-pilot paused for this cycle',
    text: `Heads up: your blog auto-pilot paused because ${why}. It resumes automatically at the start of your next billing cycle. To publish more before then, generate posts manually from the Blog Post Generator, or upgrade your plan for a higher monthly limit.\n\nSeb`,
  })
}
