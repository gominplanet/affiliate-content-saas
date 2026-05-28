/**
 * GET  /api/newsletter/settings — load the caller's newsletter_settings row
 * PUT  /api/newsletter/settings — upsert the caller's row
 *
 * In Milestone 1 the writable fields are minimal: `enabled` (the master
 * switch the WP shortcode reads), `sender_name` (display name on outbound
 * emails), and `mailing_address` (CAN-SPAM footer requirement).
 *
 * Milestone 2 will extend this with sender_domain / DKIM setup + Resend
 * domain verification — those touch external state so they get their own
 * route (/api/newsletter/domain) rather than living here.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { pushNewsletterToWp } from '@/lib/wp-newsletter-sync'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('newsletter_settings')
    .select('user_id,sender_domain,sender_local_part,sender_name,domain_status,domain_checked_at,dkim_records,enabled,mailing_address,resend_domain_id,cta_title,cta_subtitle,cta_button')
    .eq('user_id', user.id)
    .maybeSingle()

  // Return a synthetic empty row when the user hasn't touched newsletter
  // yet — keeps the dashboard's "is it set up?" check simple (just check
  // .enabled).
  return NextResponse.json({
    settings: data || {
      user_id: user.id,
      sender_domain: null,
      sender_local_part: 'newsletter',
      sender_name: null,
      domain_status: 'pending',
      domain_checked_at: null,
      dkim_records: null,
      enabled: false,
      mailing_address: null,
      resend_domain_id: null,
      cta_title: null,
      cta_subtitle: null,
      cta_button: null,
    },
  })
}

export async function PUT(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    enabled?: boolean
    sender_name?: string | null
    mailing_address?: string | null
    cta_title?: string | null
    cta_subtitle?: string | null
    cta_button?: string | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  // Build the patch — only include the fields the caller actually sent. Lets
  // the UI submit a single field (e.g. toggling enabled) without clobbering
  // the others.
  const patch: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() }
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.sender_name === 'string') patch.sender_name = body.sender_name.trim().slice(0, 120) || null
  if (typeof body.mailing_address === 'string') patch.mailing_address = body.mailing_address.trim().slice(0, 400) || null
  // CTA overrides — empty string means "go back to the theme default",
  // which we model by storing NULL (a sentinel for "not customised").
  if (typeof body.cta_title === 'string') patch.cta_title = body.cta_title.trim().slice(0, 140) || null
  if (typeof body.cta_subtitle === 'string') patch.cta_subtitle = body.cta_subtitle.trim().slice(0, 320) || null
  if (typeof body.cta_button === 'string') patch.cta_button = body.cta_button.trim().slice(0, 40) || null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('newsletter_settings')
    .upsert(patch, { onConflict: 'user_id' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Push fresh status to WordPress so the auto-embedded form on the home
  // page + every blog-post sidebar reflects the toggle immediately. Fully
  // best-effort — if WP is offline or unreachable, the dashboard save
  // still succeeds; the next Customize Blog save (or a manual re-toggle)
  // re-pushes.
  void pushNewsletterToWp(supabase, user.id)

  return NextResponse.json({ ok: true, settings: data })
}
