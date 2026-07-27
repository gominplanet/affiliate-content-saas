/**
 * GET /api/link-click?i=<itemId> — public tile click-through.
 *
 * Best-effort increments the tile + page click counters, then 302-redirects to
 * the tile's destination (affiliate) URL. No auth: this is hit from the public
 * bio page. Uses the service-role client to read/write the counters.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('i') || ''
  const home = new URL('/', request.url)
  if (!/^[0-9a-f-]{10,}$/i.test(id)) return NextResponse.redirect(home)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: item } = await admin.from('link_page_items').select('url,clicks,page_id').eq('id', id).maybeSingle()
  if (!item?.url) return NextResponse.redirect(home)

  // Best-effort counters — never block the redirect on them.
  try {
    await admin.from('link_page_items').update({ clicks: (item.clicks ?? 0) + 1 }).eq('id', id)
    const { data: page } = await admin.from('link_pages').select('clicks').eq('id', item.page_id).maybeSingle()
    if (page) await admin.from('link_pages').update({ clicks: (page.clicks ?? 0) + 1 }).eq('id', item.page_id)
  } catch { /* counters are best-effort */ }

  return NextResponse.redirect(item.url as string, { status: 302 })
}
