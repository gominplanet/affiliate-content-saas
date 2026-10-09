// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/ingest-status — which build of the video service (Railway)
// is running, against the app's own build.
//
// WHY. The service deploys separately from the app, and whether Railway
// redeploys it on every push was never known, only guessed: its first real
// run 404'd on an endpoint that had shipped days before. The service reports
// the commit it was built from (/health `build`, from RAILWAY_GIT_COMMIT_SHA),
// so this says it plainly: the same commit as the app means Railway follows
// pushes; an older one means it has to be redeployed by hand.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: caller } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const base = (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
  const app = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 40) || null
  if (!base) return NextResponse.json({ ok: false, verdict: 'YOUTUBE_INGEST_URL is not set, so there is no video service to check.', app })

  let health: Record<string, unknown> | null = null
  let error: string | null = null
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
    health = r.ok ? await r.json() : null
    if (!r.ok) error = `The service answered ${r.status}.`
  } catch (e) { error = `The service did not answer: ${e instanceof Error ? e.message : String(e)}` }

  const raw = typeof health?.build === 'string' ? String(health.build) : ''
  const build = raw && raw !== 'unknown' ? raw : null
  const same = !!build && !!app && app.startsWith(build)
  // The proxy is checked with a real request now (ingest-service /health), so
  // a proxy that refuses traffic is the headline, not a footnote under "up".
  const proxyDown = health?.proxyOk === false
  const verdict = error
    ? error
    : proxyDown
      ? `The video service is up, but its proxy is refusing traffic, so every YouTube fetch fails: ${String(health?.proxyError || 'no reason given')}. A "402" means the proxy plan is out of credit: top it up with the provider in YT_DLP_PROXY on Railway.`
    : !build
      ? 'The service is up but does not report its build (it predates build reporting, or runs outside Railway). Redeploy it once so it reports one.'
      : same
        ? 'The video service runs the same commit as the app, so Railway redeploys it on every push.'
        : `The video service runs commit ${build.slice(0, 7)}; the app is on ${app ? app.slice(0, 7) : 'an unknown commit'}. If nothing in ingest-service changed between them this is fine; otherwise Railway is not following pushes and needs a manual redeploy (or Auto Deploy switched on for the main branch).`

  return NextResponse.json({ ok: !error && !proxyDown, verdict, serviceBuild: build, appBuild: app, health })
}
