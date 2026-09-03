// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/global-sync/[id] — job status + per-market targets, for the UI to poll.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { marketByDomain } from '@/lib/global-sync'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: job } = await sb
    .from('global_sync_jobs')
    .select('id,status,asin,video_id,created_at')
    .eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: targets } = await sb
    .from('global_sync_targets')
    .select('domain,lang,dub,title,description,state,detail,video_url,delivered_at,asin')
    .eq('job_id', id).eq('user_id', user.id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((targets ?? []) as any[]).map(t => ({
    domain: t.domain as string,
    market: marketByDomain(t.domain as string)?.code || (t.domain as string),
    country: marketByDomain(t.domain as string)?.country || '',
    lang: t.lang as string,
    dub: !!t.dub,
    title: (t.title as string) || null,
    description: (t.description as string) || null,
    state: t.state as string,
    detail: (t.detail as string) || null,
    videoUrl: (t.video_url as string) || null,
    deliveredAt: (t.delivered_at as string) || null,
    // The product this market publishes with (its local ASIN when one was
    // resolved, otherwise the job's). Surfaced so the UI can show it before the
    // upload — Amazon locks a pending post, so a wrong product can't be fixed.
    asin: (t.asin as string) || null,
  }))

  return NextResponse.json({ ok: true, status: job.status, asin: job.asin, targets: rows })
}
