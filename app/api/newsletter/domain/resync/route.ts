/**
 * POST /api/newsletter/domain/resync
 *
 * "Force re-sync from Resend" — find the user's sender domain in Resend
 * by NAME (not ID) and update our cached state. Handles two stuck cases
 * the regular Verify button can't:
 *
 *   1. ID drift — the resend_domain_id stored on newsletter_settings no
 *      longer matches what's in Resend (deleted + recreated, manual
 *      cleanup, migration to a different Resend project, etc.). Verify
 *      and Get both fail with 404 or return data for the wrong domain;
 *      this endpoint scans the domains list and patches the ID.
 *
 *   2. Cache desync — Resend's UI / API reports verified but our cached
 *      domain_status is still pending because the last Verify call hit
 *      Resend while the re-check was still in flight. Resend's
 *      domains.list returns the current parent status, so a single round
 *      trip refreshes us properly.
 *
 * Auth: dashboard session. RLS scopes the row to the user. No DB
 * mutation if the user has no domain registered.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  listResendDomains,
  getResendDomain,
  normaliseDomainStatus,
  isEmailConfigured,
} from '@/services/email'

export async function POST() {
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Email service is not configured.' }, { status: 503 })
  }
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await supabase
    .from('newsletter_settings')
    .select('sender_domain, resend_domain_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const senderDomain = (row?.sender_domain as string | null) ?? null
  const storedId = (row?.resend_domain_id as string | null) ?? null
  if (!senderDomain) {
    return NextResponse.json({ error: 'No sender domain registered — add one first.' }, { status: 404 })
  }

  // List every domain in our Resend account, then find the one whose
  // name matches what the user registered. Case-insensitive because
  // Resend lower-cases names on create but we don't want to depend on
  // that contract.
  let allDomains
  try {
    allDomains = await listResendDomains()
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'Failed to list Resend domains.',
    }, { status: 502 })
  }
  const match = allDomains.find(d => d.name?.toLowerCase() === senderDomain.toLowerCase())

  if (!match) {
    // Domain doesn't exist in Resend at all — most likely user (or admin)
    // deleted it directly. Clear our cached ID + status so the dashboard
    // shows the "no domain registered" empty state and they can add it
    // fresh. Don't auto-recreate (would lose DKIM key continuity).
    return NextResponse.json({
      error: `No Resend domain found matching "${senderDomain}". It may have been deleted in Resend — Remove the domain in MVP and add it again to generate fresh DKIM records.`,
    }, { status: 404 })
  }

  // The domains.list payload is sometimes a slim summary without
  // records[]. Fetch the full domain so the dashboard always has the
  // DKIM/SPF/MX rows to re-display.
  let full
  try {
    full = await getResendDomain(match.id)
  } catch {
    // Slim payload is fine if get() fails — we still have status from
    // the list call.
    full = match
  }

  const patch = {
    // ID drift case — overwrite even if it's the same value; cheap.
    resend_domain_id: full.id,
    domain_status: normaliseDomainStatus(full.status),
    dkim_records: full.records ?? [],
    domain_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase
    .from('newsletter_settings')
    .update(patch as never)
    .eq('user_id', user.id)
    .select()
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    settings: data,
    idChanged: storedId !== full.id,
    resendStatus: full.status,
  })
}
