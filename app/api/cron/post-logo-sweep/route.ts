// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/post-logo-sweep, every 15 minutes.
//
// Looks at the pictures in published posts, newest first, a few a run, and
// records any carrying a store's logo (lib/post-logo-sweep). The Logo check
// page lists them per creator with a button to replace the pictures.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createAnthropicClient } from '@/lib/anthropic'
import { sweepPostLogos } from '@/lib/post-logo-sweep'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const report = await sweepPostLogos(createAdminClient(), createAnthropicClient(), { deadline: Date.now() + 240_000 })
    return NextResponse.json({ ok: !report.error, ...report }, { status: report.error ? 500 : 200 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }, { status: 500 })
  }
}
