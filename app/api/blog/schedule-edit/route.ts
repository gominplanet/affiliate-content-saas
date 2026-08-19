// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PATCH /api/blog/schedule-edit
//   Edit an ALREADY-scheduled blog post without regenerating it:
//     • move the scheduled date/time (shifts the social cascade with it), and/or
//     • add social platforms (e.g. Facebook, now that it's connected), and/or
//     • remove queued platforms.
//
// Body: {
//   blogPostId: string,
//   scheduledFor?: string,          // ISO, future — new publish time
//   addPlatforms?: string[],        // schedulable socials to queue
//   removePlatforms?: string[],     // queued socials to drop
//   siteId?: string | null,
// }
//
// Only touches PENDING schedules (a post that hasn't fired yet). The blog post
// already exists in WordPress as future/draft, so we never re-run generation.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, normalizeTier, type Tier } from '@/lib/tier'
import { DEFAULT_SOCIAL_OFFSETS_MIN, type SchedulableSocial } from '@/lib/schedule-types'
import { getConnectedPlatforms } from '@/lib/channel-health'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'

export const runtime = 'nodejs'

const SUPPORTED_SOCIALS: SchedulableSocial[] = ['facebook', 'threads', 'twitter', 'linkedin', 'bluesky', 'telegram', 'pinterest']

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function PATCH(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await request.json()) as {
      blogPostId?: string
      scheduledFor?: string
      addPlatforms?: string[]
      removePlatforms?: string[]
      /** Per-channel caption edits: { facebook: "...", linkedin: "..." }. Applied
       *  to both newly-added rows and existing pending rows for that platform. */
      bodies?: Record<string, string>
      siteId?: string | null
    }
    const blogPostId = (body.blogPostId || '').trim()
    if (!blogPostId) return NextResponse.json({ error: 'blogPostId required' }, { status: 400 })

    const addPlatforms = [...new Set((Array.isArray(body.addPlatforms) ? body.addPlatforms : []).filter(p => SUPPORTED_SOCIALS.includes(p as SchedulableSocial)))] as SchedulableSocial[]
    const removePlatforms = [...new Set((Array.isArray(body.removePlatforms) ? body.removePlatforms : []).filter(Boolean))]
    const bodies: Record<string, string> = (body.bodies && typeof body.bodies === 'object') ? body.bodies : {}

    // Load the post + confirm ownership + that it's actually scheduled.
    const { data: post } = await (supabase as any)
      .from('blog_posts')
      .select('id, title, wordpress_url, wordpress_post_id, wordpress_site_id, scheduled_for, schedule_mode, scheduled_social_platforms, status')
      .eq('id', blogPostId).eq('user_id', user.id).maybeSingle()
    if (!post) return NextResponse.json({ error: 'Scheduled post not found.' }, { status: 404 })
    if (!post.scheduled_for) return NextResponse.json({ error: 'This post is not scheduled.' }, { status: 400 })

    const oldBaseMs = new Date(post.scheduled_for as string).getTime()
    const scheduleMode = (post.schedule_mode as string) || 'wp-native'

    const { data: tierRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier: Tier = normalizeTier(tierRow?.tier)

    // Pending schedule rows for this post (social children + any blog_publish parent).
    const { data: pendingRows } = await (supabase as any)
      .from('scheduled_posts')
      .select('id, kind, platform, scheduled_at')
      .eq('user_id', user.id).eq('blog_post_id', blogPostId).eq('status', 'pending')
    const pending = (pendingRows ?? []) as Array<{ id: string; kind: string | null; platform: string | null; scheduled_at: string }>

    // ── 1. Reschedule ──────────────────────────────────────────────────────
    let newBaseMs = oldBaseMs
    if (typeof body.scheduledFor === 'string' && body.scheduledFor.trim()) {
      newBaseMs = new Date(body.scheduledFor).getTime()
      if (isNaN(newBaseMs)) return NextResponse.json({ error: 'scheduledFor is not a valid timestamp.' }, { status: 400 })
      if (newBaseMs <= Date.now() + 60_000) return NextResponse.json({ error: 'New time must be at least 1 minute in the future.' }, { status: 400 })

      const newIso = new Date(newBaseMs).toISOString()
      await (supabase as any).from('blog_posts').update({ scheduled_for: newIso }).eq('id', blogPostId).eq('user_id', user.id)

      // wp-native: WordPress owns the publish — move the WP post's date.
      if (scheduleMode !== 'draft-flip' && post.wordpress_post_id) {
        try {
          const creds = await getWordPressCredentials(supabase, user.id, (post.wordpress_site_id as string) ?? body.siteId ?? null)
          if (creds) {
            const wp = createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password, creds.wordpress_api_token ?? undefined)
            await wp.updatePost(post.wordpress_post_id as number, { status: 'future', date: newIso })
          }
        } catch (e) {
          console.warn('[schedule-edit] WP reschedule failed:', e instanceof Error ? e.message : e)
        }
      }

      // Shift every pending row (blog_publish parent + social children) by the
      // same delta so the cascade keeps its spacing.
      const delta = newBaseMs - oldBaseMs
      if (delta !== 0 && pending.length) {
        await Promise.all(pending.map(r =>
          (supabase as any).from('scheduled_posts')
            .update({ scheduled_at: new Date(new Date(r.scheduled_at).getTime() + delta).toISOString() })
            .eq('id', r.id),
        ))
      }
    }

    // ── 2. Remove platforms ────────────────────────────────────────────────
    if (removePlatforms.length) {
      await (supabase as any).from('scheduled_posts')
        .delete()
        .eq('user_id', user.id).eq('blog_post_id', blogPostId).eq('status', 'pending').eq('kind', 'social')
        .in('platform', removePlatforms)
    }

    // ── 2b. Edit captions on EXISTING queued platforms ─────────────────────
    // (platforms that stay put — not being added this call, not removed).
    {
      const existingSocial = new Set(pending.filter(r => r.kind === 'social' && r.platform).map(r => r.platform as string))
      const edits = Object.entries(bodies).filter(([p, text]) =>
        typeof text === 'string' && text.trim() &&
        existingSocial.has(p) &&
        !addPlatforms.includes(p as SchedulableSocial) &&
        !removePlatforms.includes(p),
      )
      if (edits.length) {
        await Promise.all(edits.map(([p, text]) =>
          (supabase as any).from('scheduled_posts')
            .update({ body_text: text.trim().slice(0, 900) })
            .eq('user_id', user.id).eq('blog_post_id', blogPostId).eq('status', 'pending').eq('kind', 'social').eq('platform', p),
        ))
      }
    }

    // ── 3. Add platforms ───────────────────────────────────────────────────
    const skipped: string[] = []
    const added: string[] = []
    if (addPlatforms.length) {
      const connected = await getConnectedPlatforms(supabase, user.id)
      const alreadyQueued = new Set(pending.filter(r => r.kind === 'social' && r.platform).map(r => r.platform as string))
      const parentId = pending.find(r => r.kind === 'blog_publish')?.id ?? null
      const title = (post.title as string) || 'New post'
      const link = (post.wordpress_url as string) || ''
      const defaultBody = `${title}${link ? `\n\n${link}` : ''}`.slice(0, 900)

      const rows: any[] = []
      for (const p of addPlatforms) {
        if (alreadyQueued.has(p)) continue // already scheduled — no dupe
        if (!tierAllowsSocial(tier, p)) { skipped.push(`${p} (not on your plan)`); continue }
        if (!connected.has(p)) { skipped.push(`${p} (not connected)`); continue }
        const offset = DEFAULT_SOCIAL_OFFSETS_MIN[p] ?? 0
        const caption = (typeof bodies[p] === 'string' && bodies[p].trim()) ? bodies[p].trim().slice(0, 900) : defaultBody
        rows.push({
          user_id: user.id,
          blog_post_id: blogPostId,
          platform: p,
          scheduled_at: new Date(newBaseMs + offset * 60_000).toISOString(),
          body_text: caption,
          status: 'pending',
          kind: 'social',
          parent_id: parentId,
        })
        added.push(p)
      }
      if (rows.length) {
        // Same migration-103 fallback the create route uses.
        let { error } = await (supabase as any).from('scheduled_posts').insert(rows)
        if (error && /column .* does not exist|does not exist|unknown column/i.test(error.message || '')) {
          const legacy = rows.map(({ kind, parent_id, ...r }) => r)
          error = (await (supabase as any).from('scheduled_posts').insert(legacy)).error
        }
        if (error) return NextResponse.json({ error: `Could not add platforms: ${error.message}` }, { status: 500 })
      }
    }

    // ── 4. Sync the ticked-platforms list on the post ──────────────────────
    const current = new Set<string>(Array.isArray(post.scheduled_social_platforms) ? post.scheduled_social_platforms : [])
    for (const p of added) current.add(p)
    for (const p of removePlatforms) current.delete(p)
    await (supabase as any).from('blog_posts')
      .update({ scheduled_social_platforms: [...current] })
      .eq('id', blogPostId).eq('user_id', user.id)
      .then((r: any) => { if (r?.error) console.warn('[schedule-edit] ticked-platforms sync:', r.error.message) }, () => {})

    return NextResponse.json({
      ok: true,
      scheduledFor: new Date(newBaseMs).toISOString(),
      platforms: [...current],
      added,
      removed: removePlatforms,
      skipped,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
