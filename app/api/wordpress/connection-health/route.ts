/**
 * GET /api/wordpress/connection-health
 *
 * Lightweight signal for the topbar "Fix connection" button: has this owner
 * had a RECENT blog generation fail because WordPress refused the publish
 * (firewall/WAF block, deactivated plugin, header-stripping, bad app password)?
 *
 * We don't re-probe the site here — that'd be slow on every page load. Instead
 * we read the last few days of the owner's failed generation_jobs and match the
 * error text against the connection-failure phrases our WP client throws
 * (services/wordpress/index.ts). A match means the doctor at /setup/wp-doctor
 * is worth a look, so the button self-reveals; no match → it stays hidden.
 *
 * Response: { needsAttention: boolean, lastFailedAt?: string }
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

// Phrases our WordPress client emits when the SITE (not our code) rejected the
// write. Kept broad on purpose — a false positive just shows a "check your
// connection" nudge, which is harmless; a false negative leaves a stuck user
// with no hint. Includes the pre-fix raw parse error so already-failed jobs
// still light the button up.
const CONNECTION_ERROR_PATTERNS = [
  'WordPress firewall',
  'Connection Doctor',
  'did not accept the connection',
  'Could not reach WordPress',
  'is not valid JSON',            // legacy "Unexpected token '<'" HTML-as-JSON
  'non-JSON',
  'rest_cannot_create',
  'rest_no_route',
]

const LOOKBACK_DAYS = 4

export async function GET() {
  const supabase = await createServerClient()
  const authCtx = await getAuthAndOwner(supabase)
  if (authCtx.error) return authCtx.error
  const { ownerId } = authCtx

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Pull BOTH failed and completed recent jobs so we can compare timelines:
  // a connection failure only matters if the user hasn't published SUCCESSFULLY
  // since. Once a publish goes through, the connection is demonstrably healthy
  // and the button must self-clear — not nag for the rest of the lookback.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('generation_jobs')
    .select('status, error, updated_at')
    .eq('owner_id', ownerId)
    .eq('kind', 'blog')
    .in('status', ['failed', 'done'])
    .gte('created_at', since)
    .order('updated_at', { ascending: false })
    .limit(40)

  // Never let a diagnostic-health probe throw an error into the topbar — if we
  // can't read, assume healthy (the button just stays hidden).
  if (error) return NextResponse.json({ needsAttention: false })

  const rows = (data ?? []) as Array<{ status: string; error: string | null; updated_at: string }>

  const isConnErr = (e: string | null) =>
    CONNECTION_ERROR_PATTERNS.some(p => (e || '').toLowerCase().includes(p.toLowerCase()))

  // Rows are newest-first. The most recent connection failure and the most
  // recent successful publish tell us the CURRENT state.
  const lastConnFail = rows.find(r => r.status === 'failed' && isConnErr(r.error))
  const lastSuccess = rows.find(r => r.status === 'done')

  // Alert only if a connection failure is the more recent event — i.e. the user
  // has NOT published successfully since it broke.
  const needsAttention = !!lastConnFail
    && (!lastSuccess || lastConnFail.updated_at > lastSuccess.updated_at)

  return NextResponse.json({
    needsAttention,
    ...(needsAttention ? { lastFailedAt: lastConnFail.updated_at } : {}),
  })
}
