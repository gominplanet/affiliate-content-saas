// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/link-report — anyone reports an mvpl.ink link (migration 378).
//
// Public, no session: the people who find a bad link are visitors, not
// creators. The form on /report-a-link posts here as a plain HTML form, with
// no script, so it works for a reviewer with JavaScript off, and the answer is
// a redirect back to the form saying what happened.
//
// WHAT HAPPENED IS WHAT THE FORM SAYS: sent only when the row was written.
// A report that could not be saved says so and gives the email address, so a
// failure never looks like a report someone is going to read.

import { NextResponse, after } from 'next/server'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { readLinkReport, LINK_REPORTS_PER_HOUR, LINK_REPORT_REASONS } from '@/lib/link-trust'
import { alertOps } from '@/lib/ops-alert'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function back(req: Request, params: Record<string, string>) {
  const url = new URL('/report-a-link', req.url)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  // 303: the browser follows with a GET, so a refresh does not send it twice.
  return NextResponse.redirect(url, 303)
}

export async function POST(req: Request) {
  let form: FormData
  try { form = await req.formData() } catch { return back(req, { error: 'form' }) }
  const link = String(form.get('link') ?? '')
  // A field people never see. A bot that fills every box fills this one too.
  if (String(form.get('website') ?? '').trim()) return back(req, { sent: '1' })

  const verdict = readLinkReport({ link, reason: form.get('reason'), details: form.get('details'), email: form.get('email') })
  if (!verdict.ok) return back(req, { error: verdict.error, link: link.slice(0, 200) })

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
  const reporterHash = createHash('sha256').update(`link-report:${ip}`).digest('hex').slice(0, 32)

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const since = new Date(Date.now() - 3_600_000).toISOString()
    const { count } = await admin.from('link_reports').select('id', { count: 'exact', head: true })
      .eq('reporter_hash', reporterHash).gte('created_at', since)
    if ((count ?? 0) >= LINK_REPORTS_PER_HOUR) return back(req, { error: 'too_many' })

    const { data: row } = await admin.from('passport_links').select('user_id').eq('code', verdict.code).maybeSingle()
    const { error } = await admin.from('link_reports').insert({
      code: verdict.code, reason: verdict.reason, details: verdict.details, reporter_email: verdict.email,
      reporter_hash: reporterHash, link_user_id: row?.user_id ?? null, link_found: !!row,
    })
    if (error) {
      console.error('[link-report] could not save:', error.message)
      return back(req, { error: 'save', link: link.slice(0, 200) })
    }
    // Told the moment it lands: the policy promises every report is reviewed,
    // and a report nobody hears about is not reviewed.
    const reasonLabel = LINK_REPORT_REASONS.find((r) => r.key === verdict.reason)?.label ?? verdict.reason
    after(() => alertOps(`mvpl.ink link reported: ${verdict.code}`,
      `${reasonLabel}${row ? '' : ' (no link with this code exists)'}${verdict.details ? `\n\n${verdict.details}` : ''}\n\nReview it under Admin, Link reports.`))
    return back(req, { sent: '1' })
  } catch (e) {
    console.error('[link-report] failed:', e instanceof Error ? e.message : e)
    return back(req, { error: 'save', link: link.slice(0, 200) })
  }
}
