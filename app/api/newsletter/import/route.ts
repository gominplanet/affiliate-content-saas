/**
 * POST /api/newsletter/import — bulk-import an existing subscriber list
 *
 * Body: { csv: string } — first column is the email; everything else is
 * ignored. Header row is auto-detected (lower-cases the first cell, checks
 * for 'email' / 'address' / 'e-mail'). One-email-per-line plaintext is
 * accepted too.
 *
 * Imported rows go in as status='active' with source='csv_import' — we
 * trust that the creator already had consent on the previous platform.
 * That trust is also why we cap imports tightly: a creator who imports
 * a dirty 50k list could tank our shared Resend sender reputation
 * before we catch it.
 *
 * Returns { imported, skipped, errors } so the import UI can show a
 * clear "added 432 new emails, skipped 18 (already on your list)" message.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, allowedNewsletterSubscribers } from '@/lib/tier'
import { EMAIL_RE, normaliseEmail } from '@/lib/newsletter'

const MAX_IMPORT_BATCH = 2000 // Per request — keeps the route under Vercel's body limit + bounds Supabase insert size.

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let csv = ''
  try { csv = ((await req.json()) as { csv?: string }).csv ?? '' }
  catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  if (!csv.trim()) return NextResponse.json({ error: 'No CSV provided.' }, { status: 400 })

  // ── Tier cap pre-flight ────────────────────────────────────────────────────
  // Defensive read — see app/api/newsletter/send/route.ts for full
  // explanation. Until migration 100 runs, selecting
  // legacy_creator_newsletter would error out and silently downgrade
  // every creator to 'trial' (subscribers cap = 0).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type IntegRow = { tier?: string; legacy_creator_newsletter?: boolean } | null
  let integ: IntegRow = null
  const withLegacy = await supabase
    .from('integrations').select('tier, legacy_creator_newsletter').eq('user_id', user.id).maybeSingle()
  if (withLegacy.error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fallback = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    integ = (fallback.data as IntegRow) ?? null
  } else {
    integ = (withLegacy.data as IntegRow) ?? null
  }
  const tier = normalizeTier(integ?.tier)
  // Legacy-Creator grandfathering — see migration 100 + lib/tier.ts comment.
  // Users who were paying when the 2026-06-04 cap dropped get the old 1000.
  const cap = allowedNewsletterSubscribers(tier, {
    legacyCreatorNewsletter: Boolean(integ?.legacy_creator_newsletter),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: currentCount } = await supabase
    .from('newsletter_subscribers')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .in('status', ['pending', 'active'])
  const room = cap === null ? Number.POSITIVE_INFINITY : Math.max(0, cap - (currentCount ?? 0))
  if (room <= 0) {
    return NextResponse.json({
      error: `You're already at your tier's ${cap} subscriber cap. Upgrade to import more.`,
      limitReached: true,
    }, { status: 402 })
  }

  // ── Parse the CSV (best-effort) ────────────────────────────────────────────
  // Real CSVs are too varied to parse correctly in <50 lines, so we cheat: take
  // the FIRST column of every line, after a possible header. Good enough for
  // ConvertKit / Substack / Mailchimp exports, which are the realistic sources.
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return NextResponse.json({ error: 'CSV is empty.' }, { status: 400 })

  // Detect header row.
  const firstCell = (lines[0].split(',')[0] || '').replace(/^"|"$/g, '').toLowerCase().trim()
  const startIdx = ['email', 'address', 'e-mail', 'email_address'].includes(firstCell) ? 1 : 0

  // Build the candidate set — normalised, deduped within this import.
  const candidates = new Set<string>()
  const malformed: string[] = []
  for (let i = startIdx; i < lines.length; i++) {
    const cell = (lines[i].split(',')[0] || '').replace(/^"|"$/g, '').trim()
    const email = normaliseEmail(cell)
    if (!email) continue
    if (!EMAIL_RE.test(email) || email.length > 320) {
      if (malformed.length < 20) malformed.push(cell) // keep first ~20 for the report
      continue
    }
    candidates.add(email)
    if (candidates.size >= MAX_IMPORT_BATCH) break // hard cap per request
  }
  if (candidates.size === 0) {
    return NextResponse.json({
      error: `No valid emails in that CSV.${malformed.length ? ` First malformed entries: ${malformed.slice(0, 3).join(', ')}…` : ''}`,
    }, { status: 400 })
  }

  // Truncate to tier-cap room — so a 1000-row import on a Creator with 600
  // existing subs only inserts 400, with a clear "skipped due to cap" note.
  const candidateList = [...candidates]
  const overCap = Math.max(0, candidateList.length - room)
  const toInsert = candidateList.slice(0, room === Number.POSITIVE_INFINITY ? candidateList.length : room)

  // ── Find which of the candidates already exist (so we can report skipped) ─
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingRows } = await supabase
    .from('newsletter_subscribers')
    .select('email')
    .eq('user_id', user.id)
    .in('email', toInsert)
  const existingSet = new Set((existingRows as Array<{ email: string }> | null ?? []).map(r => r.email))
  const fresh = toInsert.filter(e => !existingSet.has(e))

  if (fresh.length === 0) {
    return NextResponse.json({
      imported: 0,
      skipped: existingSet.size,
      overCap,
      malformed: malformed.length,
      message: 'Every email in that file was already on your list.',
    })
  }

  // ── Insert ────────────────────────────────────────────────────────────────
  // Status 'active' + source 'csv_import'. We DO NOT generate confirm_tokens
  // for imports — the creator is vouching they already had consent.
  const rows = fresh.map(email => ({
    user_id: user.id,
    email,
    status: 'active',
    source: 'csv_import',
    // unsub_token defaults via the DB default expression so every imported
    // row still has a working one-click unsubscribe.
    confirmed_at: new Date().toISOString(),
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertErr } = await supabase
    .from('newsletter_subscribers')
    .insert(rows)
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    imported: fresh.length,
    skipped: existingSet.size,
    overCap,
    malformed: malformed.length,
  })
}
