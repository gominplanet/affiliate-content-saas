/**
 * POST /api/admin/announcement
 *
 * Admin-only. Manage the dashboard news banner.
 *   Body { action: 'publish', title, body, ctaLabel?, ctaHref? }
 *     → deactivates any current announcement and inserts a NEW active one
 *       (fresh id, so it re-shows to everyone, even prior dismissers).
 *   Body { action: 'hide' }
 *     → deactivates all announcements (banner disappears).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Admin gate (same pattern as the other admin routes).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caller } = await (supabase as any)
      .from('integrations').select('tier').eq('user_id', user.id).single()
    if (caller?.tier !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const body = await request.json() as {
      action?: 'publish' | 'hide'
      title?: string
      body?: string
      ctaLabel?: string
      ctaHref?: string
      variant?: string
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const now = new Date().toISOString()

    if (body.action === 'hide') {
      await admin.from('announcements').update({ active: false, updated_at: now }).eq('active', true)
      return NextResponse.json({ ok: true, hidden: true })
    }

    // Default action = publish.
    const title = (body.title ?? '').trim()
    const text = (body.body ?? '').trim()
    if (!title || !text) {
      return NextResponse.json({ error: 'title and body are required' }, { status: 400 })
    }
    const ctaLabel = (body.ctaLabel ?? '').trim() || null
    const ctaHref = (body.ctaHref ?? '').trim() || null
    if ((ctaLabel && !ctaHref) || (!ctaLabel && ctaHref)) {
      return NextResponse.json({ error: 'Provide both a button label and link, or neither.' }, { status: 400 })
    }
    const variant = body.variant === 'feature' ? 'feature' : 'news'

    // Deactivate the current banner, then publish the new one.
    await admin.from('announcements').update({ active: false, updated_at: now }).eq('active', true)
    const { data, error } = await admin
      .from('announcements')
      .insert({
        active: true,
        title,
        body: text,
        cta_label: ctaLabel,
        cta_href: ctaHref,
        variant,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
