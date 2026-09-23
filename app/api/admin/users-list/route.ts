/**
 * GET /api/admin/users-list?page=1&perPage=50&segment=all|trial|paid
 *
 * Paginated list of all users for the Admin · Users page (so admins can browse,
 * not only search by exact email). Admin-only: non-admins get 403.
 *
 * Enriches each auth user with tier + WordPress URL + brand name via TWO bulk
 * queries per page (in(user_id, ids)), so no per-user N+1. Post count is
 * deliberately omitted here (it's a per-user count query); it's shown in the
 * detail card that opens when an admin clicks a row (via /api/admin/user-lookup).
 *
 * ── THE SEGMENT IS RESOLVED HERE, NOT IN THE BROWSER, AND SO IS ITS TOTAL ──
 *
 * The obvious way to add "show me only the trial users" is to filter the rows
 * already on screen. It is also wrong twice over, and both mistakes are ones
 * this codebase has made before.
 *
 * GoTrue pages the users; the screen holds fifty of them. Filtering those
 * fifty gives "the trial users on page 1", displayed in a place that reads as
 * "the trial users". Counting a fetched array as a total has shipped here
 * three times. And the people most worth emailing are the newest signups and
 * the ones who went quiet, who are the least likely to be on whichever page
 * happens to be open.
 *
 * So the segment is applied across every user before the page is cut, and the
 * response carries `total` for the segment and `totalAll` for the account,
 * both counted rather than inferred. A page is a page and a total is a total,
 * and the screen can say which is which.
 *
 * `tier` absent on a user means trial, matching what /api/admin/broadcast does
 * when it resolves the same segments. A brand-new signup has no integrations
 * row for a moment, and treating that as "no tier" would drop the newest
 * account in the system out of the trial list, which is the one segment it is
 * certainly in.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { inSegment, type Segment } from '@/lib/admin-segments'

const NO_MATCH = '00000000-0000-0000-0000-000000000000' // placeholder so .in([]) is never empty
const AUTH_PAGE = 1000
const MAX_AUTH_PAGES = 50 // 50k accounts, well past current scale

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
    const segment = (url.searchParams.get('segment') || 'all') as Segment

    const admin = createAdminClient()

    // Tier per user id, in one query. Needed BEFORE paging, because the page
    // is cut out of the filtered set rather than the other way round.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRows } = await (admin as any)
      .from('integrations').select('user_id,tier')
    const tierById = new Map<string, string>()
    for (const r of (tierRows ?? []) as { user_id: string; tier: string | null }[]) {
      if (r.user_id) tierById.set(r.user_id, r.tier || 'trial')
    }

    // Walk every account once. At this scale that is one or two calls, and it
    // is what /api/admin/broadcast already does to resolve the same segments,
    // so the list on screen and the recipients of a send agree by construction
    // rather than by coincidence.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const everyone: any[] = []
    let truncated = false
    for (let p = 1; p <= MAX_AUTH_PAGES; p++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: chunk, error: pageErr } = await (admin.auth.admin as any)
        .listUsers({ page: p, perPage: AUTH_PAGE })
      if (pageErr) return NextResponse.json({ error: pageErr.message }, { status: 500 })
      const got = chunk?.users ?? []
      everyone.push(...got)
      if (got.length < AUTH_PAGE) break
      // Ran out of pages before running out of users. Say so rather than
      // letting a capped walk print a confident total.
      if (p === MAX_AUTH_PAGES) truncated = true
    }

    const nonAdmin = everyone.filter((u) => inSegment(tierById.get(u.id) ?? 'trial', 'all'))
    const matching = everyone.filter((u) => inSegment(tierById.get(u.id) ?? 'trial', segment))
    // Newest first ACROSS THE SEGMENT, not within a page. The accounts worth
    // emailing are the newest signups, and sorting after the cut left them
    // wherever GoTrue happened to put them.
    matching.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

    const total = matching.length
    const start = (page - 1) * perPage
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authUsers: any[] = matching.slice(start, start + perPage)
    const ids: string[] = authUsers.map((u) => u.id)
    const inIds = ids.length ? ids : [NO_MATCH]

    const [{ data: integs }, { data: brands }] = await Promise.all([
      admin.from('integrations').select('user_id,tier,wordpress_url,last_seen_at').in('user_id', inIds),
      admin.from('brand_profiles').select('user_id,name').in('user_id', inIds),
    ])

    const integByUser = new Map<string, { tier: string; wordpress_url: string | null; last_seen_at: string | null }>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (integs ?? []) as any[]) integByUser.set(r.user_id, { tier: r.tier, wordpress_url: r.wordpress_url, last_seen_at: r.last_seen_at ?? null })
    const brandByUser = new Map<string, string>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (brands ?? []) as any[]) if (r.name) brandByUser.set(r.user_id, r.name)

    const users = authUsers.map((u) => ({
      id: u.id,
      email: u.email ?? '',
      createdAt: u.created_at,
      // Real activity when we have it (heartbeat), else the auth last-sign-in as
      // a floor. last_sign_in_at alone only moves on an explicit sign-in, so it
      // read as "== signed up" for anyone who stays logged in.
      lastSignInAt: integByUser.get(u.id)?.last_seen_at ?? u.last_sign_in_at ?? null,
      tier: integByUser.get(u.id)?.tier ?? 'trial',
      wordpressUrl: integByUser.get(u.id)?.wordpress_url ?? null,
      brandName: brandByUser.get(u.id) ?? null,
    }))
    return NextResponse.json({
      ok: true,
      users,
      page,
      perPage,
      segment,
      // `total` is the size of the SEGMENT and `totalAll` the size of the
      // account, both counted. The screen shows a page; without these it has
      // no way to say so, and a page read as a total is the mistake this
      // codebase has shipped three times.
      total,
      totalAll: nonAdmin.length,
      // True only if the walk hit its ceiling, in which case both totals are
      // floors and the screen must not present them as counts.
      truncated,
      hasMore: start + authUsers.length < total,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
