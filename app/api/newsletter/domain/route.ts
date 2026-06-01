/**
 * POST   /api/newsletter/domain   register a sender subdomain with Resend
 * GET    /api/newsletter/domain   re-check Resend's verification status
 * DELETE /api/newsletter/domain   remove the domain from Resend + clear DB
 *
 * Milestone 2 of the newsletter feature — the "send from your own domain"
 * setup flow. The dashboard's "Sender Domain" card calls these three.
 *
 * Flow from the user's POV:
 *   1. They type "mail.gominreviews.com" into the subdomain field.
 *   2. POST here adds it to OUR Resend account (Resend bills MVP for the
 *      send volume, but each creator's domain has its own reputation
 *      because that's how DKIM signing works).
 *   3. We save Resend's id + DKIM records to newsletter_settings and
 *      surface the records in the dashboard with copy buttons.
 *   4. The user pastes them into their DNS host (Hostinger/Cloudflare/…).
 *   5. They hit "Verify" → GET here re-polls Resend → status flips to
 *      'verified' once Resend sees the records propagate (usually 5-60
 *      minutes).
 *   6. From that point on, deriveFromAddress() in lib/newsletter uses
 *      newsletter@<their-subdomain> on every outgoing email.
 *
 * Auth: standard dashboard session. Each creator can only touch their own
 * newsletter_settings row (enforced by RLS + the user_id scope below).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  createResendDomain,
  getResendDomain,
  verifyResendDomain,
  deleteResendDomain,
  normaliseDomainStatus,
  isEmailConfigured,
} from '@/services/email'

/** Bare-domain validator. We accept things like:
 *    mail.gominreviews.com   ✓ (recommended subdomain)
 *    gominreviews.com        ✓ (root — works but rep risk)
 *  And reject:
 *    https://foo.com         ✗ (scheme)
 *    foo                     ✗ (no TLD)
 *    foo.bar/path            ✗ (path)
 *  Same shape Resend accepts. */
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

// ── POST: add the domain to Resend + save records to newsletter_settings ───
export async function POST(req: Request) {
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Email service is not configured on the server (RESEND_API_KEY missing).' }, { status: 503 })
  }
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { subdomain?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const raw = (body.subdomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (!raw || !DOMAIN_RE.test(raw)) {
    return NextResponse.json({ error: 'Enter a domain like "mail.yourdomain.com" — no http://, no path.' }, { status: 400 })
  }

  // If they already have a verified domain on file, refuse — they need to
  // remove the old one first. Prevents silently abandoning Resend domains
  // that we lose track of (and that count against our Resend quota).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await supabase
    .from('newsletter_settings')
    .select('resend_domain_id,sender_domain,domain_status')
    .eq('user_id', user.id)
    .maybeSingle()
  if (existing?.resend_domain_id && existing?.sender_domain && existing.sender_domain !== raw) {
    return NextResponse.json({
      error: `You already have ${existing.sender_domain} set up (${existing.domain_status}). Remove it first if you want to switch.`,
    }, { status: 409 })
  }

  let domain
  try {
    domain = await createResendDomain(raw)
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'Couldn\'t register domain with Resend.',
    }, { status: 502 })
  }

  // Upsert the settings row with the Resend identifiers + DNS records the
  // user needs to add. domain_checked_at is now so the dashboard can show
  // "Last checked: <time ago>".
  const patch = {
    user_id: user.id,
    sender_domain: domain.name,
    resend_domain_id: domain.id,
    domain_status: normaliseDomainStatus(domain.status),
    dkim_records: domain.records ?? [],
    domain_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  // patch.dkim_records is a typed ResendDnsRecord[]; the schema column is
  // Json (JSONB). Cast at the boundary — the runtime payload IS valid JSON,
  // it just doesn't satisfy TS's recursive Json type structurally.
  const { data, error } = await supabase
    .from('newsletter_settings')
    .upsert(patch as never, { onConflict: 'user_id' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, settings: data })
}

// ── GET: re-check verification + refresh records from Resend ───────────────
// Called from the dashboard's "Verify" button. Two-step: first ask Resend
// to re-check (POST /domains/:id/verify in their API), then read back the
// updated state and persist.
export async function GET() {
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Email service is not configured.' }, { status: 503 })
  }
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await supabase
    .from('newsletter_settings')
    .select('resend_domain_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!row?.resend_domain_id) {
    return NextResponse.json({ error: 'No domain registered yet — add one first.' }, { status: 404 })
  }

  let domain
  try {
    // Trigger Resend's re-check (cheap, doesn't actually re-query DNS more
    // than once per minute on their side, so it's safe to mash repeatedly).
    domain = await verifyResendDomain(row.resend_domain_id as string)
  } catch (e) {
    // Fall back to a plain GET — verify() can transiently 4xx with "already
    // verifying" right after a previous call. We still want fresh status.
    try {
      domain = await getResendDomain(row.resend_domain_id as string)
    } catch (e2) {
      return NextResponse.json({
        error: e2 instanceof Error ? e2.message : (e instanceof Error ? e.message : 'Failed to query Resend.'),
      }, { status: 502 })
    }
  }

  const patch = {
    domain_status: normaliseDomainStatus(domain.status),
    dkim_records: domain.records ?? [],
    domain_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  // Same Json-vs-typed-array boundary as the upsert above.
  const { data, error } = await supabase
    .from('newsletter_settings')
    .update(patch as never)
    .eq('user_id', user.id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, settings: data })
}

// ── DELETE: remove from Resend + clear the settings columns ────────────────
// The settings row stays (so enabled / sender_name / mailing_address etc.
// survive a domain removal), only the four domain-specific columns clear.
export async function DELETE() {
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Email service is not configured.' }, { status: 503 })
  }
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await supabase
    .from('newsletter_settings')
    .select('resend_domain_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (row?.resend_domain_id) {
    // Best-effort — if Resend's delete fails (already removed, transient
    // 5xx, …) we still clear our side so the dashboard isn't permanently
    // stuck on a half-detached domain. The Resend orphan can be cleaned
    // up manually in their dashboard.
    try { await deleteResendDomain(row.resend_domain_id as string) }
    catch (e) { console.warn('[newsletter/domain] Resend delete failed (non-fatal):', e instanceof Error ? e.message : e) }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase
    .from('newsletter_settings')
    .update({
      sender_domain: null,
      resend_domain_id: null,
      domain_status: 'pending',
      dkim_records: null,
      domain_checked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
