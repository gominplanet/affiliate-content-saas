/**
 * POST /api/blog/schedule-post
 *
 * Queue a social post to fire at a future timestamp. Cron worker
 * (/api/cron/process-scheduled) picks it up from the scheduled_posts
 * table and publishes via the same service code the manual pills use.
 *
 * Body: {
 *   postId: string          // blog_posts.id
 *   platform: 'facebook' | 'threads' | 'twitter' | 'linkedin' | 'bluesky' | 'telegram'
 *   scheduledAt: string     // ISO 8601, must be in the future
 *   text: string            // body the user previewed + (possibly) edited
 * }
 *
 * Tier: requires the user's tier to allow that platform — same gate as
 * the immediate-publish endpoint.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, normalizeTier, type Tier, type Social } from '@/lib/tier'

const SUPPORTED: Social[] = ['facebook', 'threads', 'twitter', 'linkedin', 'bluesky', 'telegram']

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json() as {
      postId?: string
      platform?: string
      scheduledAt?: string
      text?: string
      socialAccountId?: string
    }

    const postId = body.postId
    const platform = body.platform as Social | undefined
    const scheduledAt = body.scheduledAt
    const text = (body.text ?? '').trim()
    const socialAccountId = body.socialAccountId

    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
    if (!platform || !SUPPORTED.includes(platform)) {
      return NextResponse.json({ error: `platform must be one of ${SUPPORTED.join(', ')}` }, { status: 400 })
    }
    if (!scheduledAt) return NextResponse.json({ error: 'scheduledAt required' }, { status: 400 })
    if (!text) return NextResponse.json({ error: 'text required (lock in the body before scheduling)' }, { status: 400 })

    const when = new Date(scheduledAt)
    if (isNaN(when.getTime())) return NextResponse.json({ error: 'scheduledAt is not a valid ISO timestamp' }, { status: 400 })
    if (when.getTime() <= Date.now() + 30_000) {
      // require at least 30s in the future — protects against accidental
      // immediate fires + gives the user a clear sense the schedule "took"
      return NextResponse.json({ error: 'scheduledAt must be at least 30 seconds in the future' }, { status: 400 })
    }

    // Tier gate (same as the immediate-publish endpoints)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).single()
    const tier = (tierRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsSocial(tier, platform)) {
      return NextResponse.json(
        { error: `${platform} auto-publish is not available on your plan.` },
        { status: 403 },
      )
    }

    // Make sure the post actually exists and belongs to the user
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postRow } = await supabase
      .from('blog_posts').select('id').eq('id', postId).eq('user_id', user.id).maybeSingle()
    if (!postRow) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    // Validate the chosen target account. Picking a specific account is a Pro
    // feature; for non-Pro users or a bogus id we store null so the cron
    // worker falls back to the user's default / legacy credentials.
    let resolvedAccountId: string | null = null
    if (socialAccountId && ['pro', 'admin'].includes(normalizeTier(tier))) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: acct } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('id', socialAccountId)
        .eq('user_id', user.id)
        .eq('platform', platform)
        .maybeSingle()
      if (acct?.id) resolvedAccountId = acct.id
    }

    // Insert the scheduled row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: insertErr } = await supabase
      .from('scheduled_posts')
      .insert({
        user_id: user.id,
        blog_post_id: postId,
        platform,
        scheduled_at: when.toISOString(),
        body_text: text,
        status: 'pending',
        social_account_id: resolvedAccountId,
      })
      .select('id,scheduled_at,platform')
      .single()
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, scheduled: inserted })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
