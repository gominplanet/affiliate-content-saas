// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/blog/autopilot  → { autopilot: { enabled, lastRunAt, pausedReason } }
// PUT  /api/blog/autopilot  { enabled: boolean }
//
// Auto-pilot: when ON, a daily cron (/api/cron/auto-blog) turns the creator's
// next un-blogged YouTube video into a published blog post (hero + internal
// images), ONE per day, no social push. State lives PER SITE in
// wordpress_sites.blog_customizations.autoBlog (that jsonb column already
// exists — no migration), on the creator's default site.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { normalizeTier, TIERS } from '@/lib/tier'

export const runtime = 'nodejs'

const SUPPORTED_SOCIALS = ['facebook', 'threads', 'twitter', 'linkedin', 'bluesky', 'telegram', 'pinterest']
const CADENCES = ['daily', 'alternate', '3x_week', '2x_week', '1x_week'] as const
type Cadence = typeof CADENCES[number]

interface AutoBlogState {
  enabled: boolean
  lastRunAt: string | null
  pausedReason: string | null
  pausedAt: string | null
  recentVideoIds?: string[]
  socials: string[]
  cadence: Cadence
  days: number[]
}

function readState(customizations: unknown): AutoBlogState {
  const c = (customizations && typeof customizations === 'object' ? customizations : {}) as Record<string, unknown>
  const a = (c.autoBlog && typeof c.autoBlog === 'object' ? c.autoBlog : {}) as Record<string, unknown>
  return {
    enabled: a.enabled === true,
    lastRunAt: typeof a.lastRunAt === 'string' ? a.lastRunAt : null,
    pausedReason: typeof a.pausedReason === 'string' ? a.pausedReason : null,
    pausedAt: typeof a.pausedAt === 'string' ? a.pausedAt : null,
    recentVideoIds: Array.isArray(a.recentVideoIds) ? (a.recentVideoIds as string[]) : [],
    socials: Array.isArray(a.socials) ? (a.socials as string[]).filter(p => SUPPORTED_SOCIALS.includes(p)) : [],
    cadence: CADENCES.includes(a.cadence as Cadence) ? (a.cadence as Cadence) : 'daily',
    days: Array.isArray(a.days) ? (a.days as number[]).filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : [],
  }
}

const OFF: AutoBlogState = { enabled: false, lastRunAt: null, pausedReason: null, pausedAt: null, socials: [], cadence: 'daily', days: [] }

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const site = await getWordPressCredentials(supabase, user.id)
  if (!site || site.site_id === 'legacy') return NextResponse.json({ autopilot: OFF, noSite: !site })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .from('wordpress_sites').select('blog_customizations').eq('id', site.site_id).maybeSingle()
  return NextResponse.json({ autopilot: readState(row?.blog_customizations) })
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

  const site = await getWordPressCredentials(supabase, user.id)
  if (!site) return NextResponse.json({ error: 'Connect a WordPress site first.' }, { status: 400 })
  if (site.site_id === 'legacy') {
    return NextResponse.json({ error: 'Reconnect your WordPress site (Setup → WordPress) to use auto-pilot.' }, { status: 400 })
  }

  let body: { enabled?: boolean; socials?: string[]; cadence?: string; days?: number[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const enabled = body.enabled === true
  // Socials/cadence/days are optional in the payload — only overwrite when
  // provided, so a plain on/off toggle doesn't wipe the saved config.
  const socials = Array.isArray(body.socials)
    ? [...new Set(body.socials.filter(p => SUPPORTED_SOCIALS.includes(p)))]
    : null
  const cadence = CADENCES.includes(body.cadence as Cadence) ? (body.cadence as Cadence) : null
  const days = Array.isArray(body.days)
    ? [...new Set(body.days.filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
    : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .from('wordpress_sites').select('blog_customizations').eq('id', site.site_id).maybeSingle()
  const current = (row?.blog_customizations && typeof row.blog_customizations === 'object' ? row.blog_customizations : {}) as Record<string, unknown>
  const prev = readState(row?.blog_customizations)

  const autoBlog: AutoBlogState = {
    enabled,
    lastRunAt: prev.lastRunAt,
    pausedReason: enabled ? null : prev.pausedReason,
    pausedAt: enabled ? null : prev.pausedAt,
    recentVideoIds: prev.recentVideoIds ?? [],
    socials: socials ?? prev.socials,
    cadence: cadence ?? prev.cadence,
    days: days ?? prev.days,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('wordpress_sites')
    .update({ blog_customizations: { ...current, autoBlog } })
    .eq('id', site.site_id)
    .eq('user_id', user.id)
  if (error) {
    console.error('[autopilot] save failed:', error.message)
    return NextResponse.json({ error: 'Could not save.' }, { status: 500 })
  }

  return NextResponse.json({ autopilot: autoBlog })
}
