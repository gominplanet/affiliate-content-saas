/**
 * POST /api/admin/user-lookup
 *
 * Look up a user by email. Returns user_id, current tier, post count,
 * and signup date. Admin-only — non-admins get 403.
 *
 * Uses the service-role client to query auth.users (regular client can't).
 *
 * Body: { email: string }
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Admin gate — must be admin tier in their integrations row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caller } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    if (caller?.tier !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const { email } = await request.json() as { email?: string }
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
    const normalized = email.trim().toLowerCase()

    const admin = createAdminClient()

    // listUsers paginates — earlier code did `perPage: 1000` once and
    // silently 404'd for anyone whose user was on page 2+. We now
    // walk pages until found or the list runs out (bounded by a hard
    // safety cap to avoid runaway loops on huge tenants). Audit fix
    // 2026-06-02 (#145).
    const PAGE_SIZE = 1000
    const MAX_PAGES = 50 // 50k users — way past current scale
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let target: any = null
    for (let page = 1; page <= MAX_PAGES; page++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: userList, error: listErr } = await (admin.auth.admin as any).listUsers({ page, perPage: PAGE_SIZE })
      if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      target = userList.users.find((u: any) => (u.email ?? '').toLowerCase() === normalized)
      if (target) break
      if (!userList.users || userList.users.length < PAGE_SIZE) break // last page
    }
    if (!target) {
      return NextResponse.json({ error: 'No user with that email' }, { status: 404 })
    }

    const targetId: string = target.id

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [{ data: integration }, { count: postCount }, { data: profile }] = await Promise.all([
      admin.from('integrations').select('tier,wordpress_url').eq('user_id', targetId).maybeSingle(),
      admin.from('blog_posts').select('id', { count: 'exact', head: true }).eq('user_id', targetId),
      admin.from('brand_profiles').select('name,author_name').eq('user_id', targetId).maybeSingle(),
    ])

    return NextResponse.json({
      ok: true,
      user: {
        id: targetId,
        email: target.email,
        createdAt: target.created_at,
        lastSignInAt: target.last_sign_in_at,
        tier: integration?.tier ?? 'trial',
        wordpressUrl: integration?.wordpress_url ?? null,
        brandName: profile?.name ?? null,
        authorName: profile?.author_name ?? null,
        postCount: postCount ?? 0,
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
