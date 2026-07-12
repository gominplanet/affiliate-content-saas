/**
 * GET /api/admin/users-list?page=1&perPage=50
 *
 * Paginated list of all users for the Admin · Users page (so admins can browse,
 * not only search by exact email). Admin-only — non-admins get 403.
 *
 * Enriches each auth user with tier + WordPress URL + brand name via TWO bulk
 * queries per page (in(user_id, ids)) — no per-user N+1. Post count is
 * deliberately omitted here (it's a per-user count query); it's shown in the
 * detail card that opens when an admin clicks a row (via /api/admin/user-lookup).
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const NO_MATCH = '00000000-0000-0000-0000-000000000000' // placeholder so .in([]) is never empty

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Admin gate — same check as user-lookup.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caller } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((caller as any)?.tier !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const url = new URL(request.url)
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
    const perPage = Math.min(100, Math.max(10, parseInt(url.searchParams.get('perPage') || '50', 10) || 50))

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: list, error } = await (admin.auth.admin as any).listUsers({ page, perPage })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authUsers: any[] = list?.users ?? []
    const ids: string[] = authUsers.map((u) => u.id)
    const inIds = ids.length ? ids : [NO_MATCH]

    const [{ data: integs }, { data: brands }] = await Promise.all([
      admin.from('integrations').select('user_id,tier,wordpress_url').in('user_id', inIds),
      admin.from('brand_profiles').select('user_id,name').in('user_id', inIds),
    ])

    const integByUser = new Map<string, { tier: string; wordpress_url: string | null }>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (integs ?? []) as any[]) integByUser.set(r.user_id, { tier: r.tier, wordpress_url: r.wordpress_url })
    const brandByUser = new Map<string, string>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (brands ?? []) as any[]) if (r.name) brandByUser.set(r.user_id, r.name)

    const users = authUsers.map((u) => ({
      id: u.id,
      email: u.email ?? '',
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      tier: integByUser.get(u.id)?.tier ?? 'trial',
      wordpressUrl: integByUser.get(u.id)?.wordpress_url ?? null,
      brandName: brandByUser.get(u.id) ?? null,
    }))
    // Newest first within the page (GoTrue order isn't guaranteed newest-first).
    users.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

    return NextResponse.json({
      ok: true,
      users,
      page,
      perPage,
      hasMore: authUsers.length === perPage,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
