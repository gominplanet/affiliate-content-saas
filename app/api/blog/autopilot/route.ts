// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/blog/autopilot  → { enabled, lastRunAt, pausedReason }
// PUT  /api/blog/autopilot  { enabled: boolean }
//
// Auto-pilot: when ON, a daily cron (/api/cron/auto-blog) turns the creator's
// next un-blogged YouTube video into a published blog post (hero + internal
// images), ONE per day, no social push. State lives in
// brand_profiles.blog_customizations.autoBlog so there's no migration.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, TIERS } from '@/lib/tier'

export const runtime = 'nodejs'

interface AutoBlogState {
  enabled: boolean
  lastRunAt: string | null
  pausedReason: string | null
  pausedAt: string | null
}

function readState(customizations: unknown): AutoBlogState {
  const c = (customizations && typeof customizations === 'object' ? customizations : {}) as Record<string, unknown>
  const a = (c.autoBlog && typeof c.autoBlog === 'object' ? c.autoBlog : {}) as Record<string, unknown>
  return {
    enabled: a.enabled === true,
    lastRunAt: typeof a.lastRunAt === 'string' ? a.lastRunAt : null,
    pausedReason: typeof a.pausedReason === 'string' ? a.pausedReason : null,
    pausedAt: typeof a.pausedAt === 'string' ? a.pausedAt : null,
  }
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await (supabase as any)
    .from('brand_profiles').select('blog_customizations').eq('user_id', user.id).maybeSingle()
  return NextResponse.json({ autopilot: readState(brand?.blog_customizations) })
}

export async function PUT(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Paid tiers only — auto-pilot publishes real posts against the monthly cap.
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (TIERS[tier].postsPerMonth === 0) {
    return NextResponse.json({ error: 'Auto-pilot is available on paid plans.', code: 'tier_not_allowed' }, { status: 403 })
  }

  let body: { enabled?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const enabled = body.enabled === true

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await (supabase as any)
    .from('brand_profiles').select('blog_customizations').eq('user_id', user.id).maybeSingle()
  const current = (brand?.blog_customizations && typeof brand.blog_customizations === 'object' ? brand.blog_customizations : {}) as Record<string, unknown>
  const prev = readState(brand?.blog_customizations)

  const autoBlog: AutoBlogState = {
    enabled,
    // Preserve the last-run stamp so toggling off then on doesn't fire twice
    // in one day. Clear any pause when the user explicitly re-enables.
    lastRunAt: prev.lastRunAt,
    pausedReason: enabled ? null : prev.pausedReason,
    pausedAt: enabled ? null : prev.pausedAt,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('brand_profiles')
    .upsert({ user_id: user.id, blog_customizations: { ...current, autoBlog } }, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ error: 'Could not save.' }, { status: 500 })

  return NextResponse.json({ autopilot: autoBlog })
}
