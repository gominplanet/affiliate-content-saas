/**
 * GET  /api/newsletter/subscribers          — paginated list for the dashboard
 * GET  /api/newsletter/subscribers?format=csv — CSV download of active subs
 * DELETE /api/newsletter/subscribers?id=…    — manually remove a subscriber
 *                                              (different from unsubscribe —
 *                                              this fully removes the row,
 *                                              for GDPR delete requests).
 *
 * All variants require the authenticated dashboard user; scoped to the
 * caller's own subscribers via RLS.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const format = req.nextUrl.searchParams.get('format')
  const status = req.nextUrl.searchParams.get('status') // 'pending' | 'active' | 'unsubscribed' | 'bounced'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = supabase
    .from('newsletter_subscribers')
    .select('id,email,status,source,source_url,confirmed_at,unsubscribed_at,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  if (status && ['pending', 'active', 'unsubscribed', 'bounced'].includes(status)) {
    query = query.eq('status', status)
  } else {
    // Default: hide unsubscribed + bounced from the main list view — they're
    // still queryable with ?status=unsubscribed but they shouldn't clutter
    // the "your audience" feeling.
    query = query.in('status', ['pending', 'active'])
  }

  const { data, error } = await query.limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data || []) as Array<{
    id: string
    email: string
    status: string
    source: string | null
    source_url: string | null
    confirmed_at: string | null
    unsubscribed_at: string | null
    created_at: string
  }>

  if (format === 'csv') {
    // RFC 4180-ish — quote fields with commas/quotes, escape quotes by
    // doubling them. Standards-compliant enough for Numbers + Excel.
    const esc = (v: string | null) => {
      if (v == null) return ''
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
      return v
    }
    const header = 'email,status,source,confirmed_at,created_at\n'
    const body = rows.map(r => [
      esc(r.email),
      esc(r.status),
      esc(r.source),
      esc(r.confirmed_at),
      esc(r.created_at),
    ].join(',')).join('\n')
    const filename = `newsletter-subscribers-${new Date().toISOString().slice(0, 10)}.csv`
    return new NextResponse(header + body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  // Counts for the dashboard header — single round-trip via aggregation
  // would be nicer but we don't have a postgres function for it. Three
  // separate count queries is fine at the per-user volumes we'd see.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [activeCount, pendingCount, unsubCount] = await Promise.all([
    supabase.from('newsletter_subscribers').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active'),
    supabase.from('newsletter_subscribers').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'pending'),
    supabase.from('newsletter_subscribers').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'unsubscribed'),
  ])

  return NextResponse.json({
    subscribers: rows,
    counts: {
      active: activeCount.count ?? 0,
      pending: pendingCount.count ?? 0,
      unsubscribed: unsubCount.count ?? 0,
    },
  })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // RLS scopes to user_id automatically, so a creator can't delete someone
  // else's subscriber even by guessing the id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase
    .from('newsletter_subscribers')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
