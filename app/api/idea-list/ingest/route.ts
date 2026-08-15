// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/idea-list/ingest   (called by the SCOUT extension, session-authed)
//   Two shapes:
//   1. { lists: [{ amazonListId, title, url, itemCount, coverImage }] }
//        — the storefront index: upsert list METADATA (no items yet).
//   2. { list: { amazonListId, title, url, itemCount, coverImage,
//                items: [{ asin, title, image }] } }
//        — one list opened: upsert metadata + the full captured product set.
//
// SCOUT posts with the signed-in mvpaffiliate.io cookie; writes go through the
// admin client (idea_lists RLS is select-only for the owner).
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 30

const clean = (s: unknown, n = 300) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : null)
const listId = (s: unknown) => (typeof s === 'string' && /^[A-Z0-9]{6,}$/i.test(s.trim()) ? s.trim() : null)

interface InItem { asin?: string; title?: string; image?: string }
function cleanItems(arr: unknown): Array<{ asin: string; title: string | null; image: string | null }> {
  if (!Array.isArray(arr)) return []
  const seen = new Set<string>()
  const out: Array<{ asin: string; title: string | null; image: string | null }> = []
  for (const raw of arr as InItem[]) {
    const asin = String(raw?.asin || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) continue
    seen.add(asin)
    out.push({ asin, title: clean(raw?.title, 300), image: clean(raw?.image, 500) })
    if (out.length >= 500) break
  }
  return out
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as {
      lists?: Array<{ amazonListId?: string; title?: string; url?: string; itemCount?: number; coverImage?: string }>
      list?: { amazonListId?: string; title?: string; url?: string; itemCount?: number; coverImage?: string; items?: unknown }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const now = new Date().toISOString()
    let upserted = 0

    // Shape 2 — a single list WITH its captured items.
    if (body.list) {
      const id = listId(body.list.amazonListId)
      if (!id) return NextResponse.json({ error: 'Missing list id.' }, { status: 400 })
      const items = cleanItems(body.list.items)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row: any = {
        user_id: user.id, amazon_list_id: id,
        title: clean(body.list.title, 200), url: clean(body.list.url, 600),
        item_count: Number.isFinite(Number(body.list.itemCount)) ? Number(body.list.itemCount) : items.length || null,
        cover_image: clean(body.list.coverImage, 500),
        updated_at: now,
      }
      if (items.length) { row.items = items; row.items_synced_at = now }
      const { error } = await admin.from('idea_lists').upsert(row, { onConflict: 'user_id,amazon_list_id' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, upserted: 1, items: items.length })
    }

    // Shape 1 — the storefront index (metadata only). Never overwrite items here.
    const lists = Array.isArray(body.lists) ? body.lists : []
    for (const l of lists.slice(0, 200)) {
      const id = listId(l.amazonListId)
      if (!id) continue
      const { error } = await admin.from('idea_lists').upsert({
        user_id: user.id, amazon_list_id: id,
        title: clean(l.title, 200), url: clean(l.url, 600),
        item_count: Number.isFinite(Number(l.itemCount)) ? Number(l.itemCount) : null,
        cover_image: clean(l.coverImage, 500),
        updated_at: now,
      }, { onConflict: 'user_id,amazon_list_id', ignoreDuplicates: false })
      if (!error) upserted++
    }
    return NextResponse.json({ ok: true, upserted })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ingest failed' }, { status: 500 })
  }
}

// GET — the creator's synced lists, for the dashboard grid.
export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('idea_lists')
      .select('id,amazon_list_id,title,url,item_count,cover_image,items,items_synced_at,updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(100)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lists = ((data ?? []) as any[]).map((r) => ({
      id: r.id, amazonListId: r.amazon_list_id, title: r.title, url: r.url,
      itemCount: r.item_count, coverImage: r.cover_image,
      syncedItems: Array.isArray(r.items) ? r.items.length : 0,
      hasItems: Array.isArray(r.items) && r.items.length > 0,
    }))
    return NextResponse.json({ ok: true, lists })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
