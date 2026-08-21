// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Creator Hub videos → which products the creator has a shoppable video for.
// SCOUT reads the Creator Hub video table (each row is tied to a product ASIN)
// and POSTs the ASIN set here; we flag has_video=true on the matching
// storefront_catalog rows (inserting a row for any ASIN not already in the
// catalog, so a video-only product still shows up). Session-cookie auth,
// service-role write.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': 'https://www.amazon.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
}
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }) }

const ASIN_RE = /^[A-Z0-9]{10}$/
interface VideoIn { asin?: string; title?: string }

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: CORS })

    const body = await request.json().catch(() => ({})) as { videos?: VideoIn[] }
    const videos = Array.isArray(body.videos) ? body.videos : []
    const rows = videos
      .map((v) => {
        const asin = String(v.asin ?? '').trim().toUpperCase()
        if (!ASIN_RE.test(asin)) return null
        // No title here on purpose — don't clobber a catalog product name with a
        // video title. Existing rows keep their name; a video-only ASIN shows
        // its ASIN until a storefront import fills the name in.
        return { user_id: user.id, asin, has_video: true, synced_at: new Date().toISOString() }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .slice(0, 10000)
    if (!rows.length) return NextResponse.json({ ok: true, upserted: 0 }, { headers: CORS })

    const admin = createAdminClient()
    // Upsert on (user_id, asin): sets has_video=true, adds a catalog row for any
    // ASIN not already there. Existing catalog title/image are preserved unless
    // this row carries a title (a video-only product gets its video title).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from('storefront_catalog')
      .upsert(rows, { onConflict: 'user_id,asin' })
    if (error) {
      console.warn('[storefront/videos] upsert failed:', error.message)
      return NextResponse.json({ error: 'Could not save videos.' }, { status: 500, headers: CORS })
    }
    return NextResponse.json({ ok: true, upserted: rows.length }, { headers: CORS })
  } catch (e) {
    console.warn('[storefront/videos] POST error:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Videos ingest failed.' }, { status: 500, headers: CORS })
  }
}
